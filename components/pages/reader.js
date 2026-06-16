// ============================================================
// components/reader.js — in-app BookStack content reader.
// Provides a headless-CMS reading experience without leaving
// the Hub. Manages #hub-content-area which overlays .page-content.
//
// Public API (on window.__hub_reader):
//   openBook(bookId, bookName, bookSlug)
//   openPage(pageId, pageName, bookId, bookName)
//
// URL scheme:
//   /            → home (dashboard)
//   /book/13     → book view (nav + welcome panel)
//   /book/13/page/42 → page view (nav + page content)
// ============================================================

import { fetchBook, fetchChapter, fetchPageContent, fetchAttachments, fetchAttachmentBlob } from "../../api/bookstack.js";
import { formatDate } from "../../utils/format.js";
import CONFIG from "../../config.js";

// ── State ────────────────────────────────────────────────────
let _state = "home"; // "home" | "book" | "page"
let _book  = null;   // { id, name, slug, description, contents }
let _page  = null;   // { id, name }
// Chapter pages cache: chapterId → pages array
const _chapterCache = {};
// Expanded chapters set
const _expandedChapters = new Set();

// ── DOM references ───────────────────────────────────────────
let _overlay      = null; // #hub-content-area
let _dashboard    = null; // .page-content

// ── Sanitize page HTML ───────────────────────────────────────
function sanitizeHtml(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");

  // Remove script and style tags
  doc.querySelectorAll("script, style").forEach(el => el.remove());

  // Strip event-handler attributes (onerror, onclick, onload, etc.)
  doc.body.querySelectorAll("*").forEach(el => {
    for (const attr of [...el.attributes]) {
      if (attr.name.toLowerCase().startsWith("on")) {
        el.removeAttribute(attr.name);
      }
    }
  });

  // Walk every element
  doc.body.querySelectorAll("*").forEach(el => {
    // Strip inline style attributes
    el.removeAttribute("style");

    // Fix image sources — BookStack embeds absolute URLs; rewrite to path-only so
    // the request goes through nginx (/docs/* → BookStack) regardless of server IP.
    if (el.tagName === "IMG" && el.hasAttribute("src")) {
      const src = el.getAttribute("src");
      if (src.includes("/docs/")) {
        el.setAttribute("src", src.substring(src.indexOf("/docs/")));
      }
    }

    // Rewrite internal BookStack links to open in the reader
    if (el.tagName === "A" && el.hasAttribute("href")) {
      const href = el.getAttribute("href");
      if (href && href.includes("/docs/books/")) {
        el.removeAttribute("href");
        el.style.cursor = "pointer";
        el.addEventListener("click", e => {
          e.preventDefault();
          // BookStack page URLs look like: /docs/books/{bookSlug}/page/{pageSlug}
          // Cannot reliably resolve page ID from slug without an extra API call,
          // so open in a new tab as fallback. Use window.location.origin to avoid
          // hardcoding the server IP.
          const abs = href.startsWith("http") ? href : window.location.origin + href;
          window.open(abs, "_blank", "noopener");
        });
      } else if (href && href.startsWith("/docs/")) {
        // Other internal docs links — make absolute using current origin, open in new tab
        el.setAttribute("href", window.location.origin + href);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener");
      }
    }
  });

  return doc.body.innerHTML;
}

// ── Spinner ──────────────────────────────────────────────────
function spinnerHtml() {
  return `<div class="hub-spinner" aria-label="Loading…"></div>`;
}

// ── Breadcrumb ───────────────────────────────────────────────
function breadcrumbHtml(parts) {
  // parts: [{ label, action }]  — action is a function or null (current item)
  return `
    <nav class="reader-breadcrumb" aria-label="Breadcrumb">
      ${parts.map((p, i) => {
        if (p.action) {
          return `<button class="bc-link" data-bc="${i}">${p.label}</button>`;
        }
        return `<span class="bc-current">${p.label}</span>`;
      }).join('<span class="bc-sep"> / </span>')}
    </nav>`;
}

function attachBreadcrumbHandlers(parts) {
  _overlay.querySelectorAll("[data-bc]").forEach(btn => {
    const idx = parseInt(btn.dataset.bc, 10);
    if (parts[idx] && parts[idx].action) {
      btn.addEventListener("click", parts[idx].action);
    }
  });
}

// ── Nav sidebar ──────────────────────────────────────────────
function navItemsHtml(contents, activePageId) {
  if (!contents || !contents.length) return "<p style='padding:16px;font-size:13px;color:var(--text-secondary)'>No pages found.</p>";

  let html = "";
  for (const item of contents) {
    if (item.type === "page") {
      const active = activePageId && item.id === activePageId ? " active" : "";
      html += `
        <div class="reader-nav-item${active}" data-page-id="${item.id}" data-page-name="${escAttr(item.name)}"
             role="button" tabindex="0" aria-current="${active ? 'page' : 'false'}">
          ${esc(item.name)}
        </div>`;
    } else if (item.type === "chapter") {
      const expanded = _expandedChapters.has(item.id);
      html += `
        <div class="reader-nav-chapter" data-chapter-id="${item.id}"
             role="button" tabindex="0" aria-expanded="${expanded}">
          <span class="chapter-arrow">${expanded ? "▾" : "▸"}</span> ${esc(item.name)}
        </div>`;
      if (expanded) {
        const pages = _chapterCache[item.id] || [];
        for (const pg of pages) {
          const active = activePageId && pg.id === activePageId ? " active" : "";
          html += `
            <div class="reader-nav-page${active}" data-page-id="${pg.id}" data-page-name="${escAttr(pg.name)}"
                 role="button" tabindex="0" aria-current="${active ? 'page' : 'false'}">
              ${esc(pg.name)}
            </div>`;
        }
      }
    }
  }
  return html;
}

function attachNavHandlers(overlayEl) {
  // Page items
  overlayEl.querySelectorAll("[data-page-id]").forEach(el => {
    el.addEventListener("click", () => {
      const pageId   = parseInt(el.dataset.pageId, 10);
      const pageName = el.dataset.pageName || "Page";
      openPage(pageId, pageName, _book.id, _book.name);
    });
    el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") el.click(); });
  });

  // Chapter items
  overlayEl.querySelectorAll("[data-chapter-id]").forEach(el => {
    el.addEventListener("click", async () => {
      const chapterId = parseInt(el.dataset.chapterId, 10);
      if (_expandedChapters.has(chapterId)) {
        _expandedChapters.delete(chapterId);
      } else {
        _expandedChapters.add(chapterId);
        if (!_chapterCache[chapterId]) {
          el.textContent = "Loading…";
          try {
            const chapter = await fetchChapter(chapterId);
            _chapterCache[chapterId] = chapter.pages || [];
          } catch (err) {
            console.error("[Hub Reader] chapter fetch error:", err);
            _chapterCache[chapterId] = [];
          }
        }
      }
      renderCurrentState();
    });
    el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") el.click(); });
  });
}

// ── Escape helpers ───────────────────────────────────────────
function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escAttr(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Count pages in a book contents array ─────────────────────
function countPages(contents) {
  return (contents || []).filter(c => c.type === "page").length;
}

// ── Main render functions ────────────────────────────────────

function renderBookView() {
  const bc = [
    { label: "Home", action: goHome },
    { label: esc(_book.name), action: null },
  ];

  const contents = _book.contents || [];

  // Count pages per chapter using chapter_id on each page item
  const pagesByChapter = {};
  contents.forEach(item => {
    if (item.type === "page" && item.chapter_id) {
      pagesByChapter[item.chapter_id] = (pagesByChapter[item.chapter_id] || 0) + 1;
    }
  });

  const chapters    = contents.filter(c => c.type === "chapter");
  const allPages    = contents.filter(c => c.type === "page");
  const pageCount   = allPages.length;

  // 3 most recently updated pages (requires updated_at on page items)
  const recentPages = allPages
    .filter(p => p.updated_at)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, 3);

  const chaptersHtml = chapters.length ? `
    <div class="dept-landing-section">
      <h2 class="dept-landing-heading">Contents</h2>
      <ul class="dept-chapter-list">
        ${chapters.map(ch => {
          const n = pagesByChapter[ch.id] || 0;
          return `<li class="dept-chapter-item">
            <span class="dept-chapter-name">${esc(ch.name)}</span>
            <span class="dept-chapter-count">${n} page${n !== 1 ? "s" : ""}</span>
          </li>`;
        }).join("")}
      </ul>
    </div>` : "";

  const recentHtml = recentPages.length ? `
    <div class="dept-landing-section">
      <h2 class="dept-landing-heading">Recently Updated</h2>
      <div class="dept-recent-grid">
        ${recentPages.map(p => `
          <button class="dept-recent-card" data-page-id="${p.id}" data-page-name="${escAttr(p.name)}">
            <span class="dept-recent-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </span>
            <span class="dept-recent-title">${esc(p.name)}</span>
            <span class="dept-recent-date">Updated ${esc(formatDate(p.updated_at))}</span>
          </button>`).join("")}
      </div>
    </div>` : "";

  _overlay.innerHTML = `
    ${breadcrumbHtml(bc)}
    <div class="reader-layout">
      <nav class="reader-nav" aria-label="Book navigation">
        <div class="reader-nav-header">${esc(_book.name)}</div>
        ${navItemsHtml(_book.contents, null)}
      </nav>
      <div class="reader-content">
        <div class="dept-landing">
          <h1 class="dept-landing-title">${esc(_book.name)}</h1>
          ${_book.description ? `<p class="dept-landing-desc">${esc(_book.description)}</p>` : ""}
          <p class="dept-landing-meta">
            ${pageCount} page${pageCount !== 1 ? "s" : ""}
            ${chapters.length ? ` &nbsp;·&nbsp; ${chapters.length} chapter${chapters.length !== 1 ? "s" : ""}` : ""}
            &nbsp;·&nbsp; Select a page from the left to start reading.
          </p>
          ${chaptersHtml}
          ${recentHtml}
        </div>
      </div>
    </div>`;

  attachBreadcrumbHandlers(bc);
  attachNavHandlers(_overlay);

  // Wire recent page card clicks
  _overlay.querySelectorAll(".dept-recent-card").forEach(btn => {
    btn.addEventListener("click", () => {
      const pageId   = parseInt(btn.dataset.pageId, 10);
      const pageName = btn.dataset.pageName || "Page";
      openPage(pageId, pageName, _book.id, _book.name);
    });
  });
}

function renderPageViewShell(pageName) {
  const bc = [
    { label: "Home",          action: goHome },
    { label: esc(_book.name), action: () => openBook(_book.id, _book.name, _book.slug) },
    { label: esc(pageName),   action: null },
  ];

  _overlay.innerHTML = `
    ${breadcrumbHtml(bc)}
    <div class="reader-layout">
      <nav class="reader-nav" aria-label="Book navigation">
        <div class="reader-nav-header">${esc(_book.name)}</div>
        ${navItemsHtml(_book.contents, _page ? _page.id : null)}
      </nav>
      <div id="reader-content-panel" class="reader-content">
        ${spinnerHtml()}
      </div>
    </div>`;

  attachBreadcrumbHandlers(bc);
  attachNavHandlers(_overlay);
}

function attachmentIcon(ext) {
  const icons = {
    pdf:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    docx: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    doc:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    xlsx: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`,
    xls:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`,
    pptx: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
  };
  return icons[ext?.toLowerCase()] || icons.doc;
}

function attachmentsHtml(attachments) {
  if (!attachments || !attachments.length) return "";

  const isPdf   = a => a.extension?.toLowerCase() === "pdf";
  const pdfs    = attachments.filter(isPdf);
  const others  = attachments.filter(a => !isPdf(a));

  let html = `<div class="attachments-section">
    <h2 class="attachments-heading">Documents</h2>`;

  // Embed PDFs inline — src is set async after inject via loadPdfIframes()
  for (const a of pdfs) {
    const downloadSrc = `/docs/attachments/${a.id}`;
    html += `
      <div class="attachment-pdf">
        <div class="attachment-pdf-label">
          ${attachmentIcon("pdf")}
          <span>${esc(a.name)}</span>
          <a href="${downloadSrc}" download="${escAttr(a.name)}" class="attachment-download">Download</a>
        </div>
        <div class="pdf-loading" id="pdf-wrap-${a.id}">
          <div class="hub-spinner" style="margin:40px auto"></div>
        </div>
      </div>`;
  }

  // Non-PDF file list — card is display-only; Download button triggers the save
  if (others.length) {
    html += `<div class="attachment-list">`;
    for (const a of others) {
      const src = `/docs/attachments/${a.id}`;
      html += `
        <div class="attachment-item">
          <span class="attachment-icon">${attachmentIcon(a.extension)}</span>
          <span class="attachment-name">${esc(a.name)}</span>
          <span class="attachment-ext">${esc((a.extension || "").toUpperCase())}</span>
          <a href="${src}" download="${escAttr(a.name)}" class="attachment-download">Download</a>
        </div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

/** After attachmentsHtml is injected, fetch each PDF as a blob and swap in a real iframe. */
async function loadPdfIframes(attachments) {
  const pdfs = (attachments || []).filter(a => a.extension?.toLowerCase() === "pdf");
  await Promise.allSettled(pdfs.map(async a => {
    const wrap = _overlay.querySelector(`#pdf-wrap-${a.id}`);
    if (!wrap) return;
    try {
      const blobUrl = await fetchAttachmentBlob(a.id, "application/pdf");
      const iframe  = document.createElement("iframe");
      iframe.src    = blobUrl;
      iframe.className = "pdf-embed";
      iframe.title  = a.name;
      wrap.replaceWith(iframe);
    } catch (err) {
      console.error("[Hub Reader] PDF blob fetch failed:", err);
      wrap.innerHTML = `<p style="padding:16px;color:#e53e3e">Could not load PDF preview.</p>`;
    }
  }));
}

function injectPageContent(pageData, attachments) {
  const panel = _overlay.querySelector("#reader-content-panel") || _overlay.querySelector(".reader-content");
  if (!panel) return;

  const safe        = sanitizeHtml(pageData.html || "");
  const hasRealBody = safe.trim().length > 0 && !safe.includes("See attached");

  panel.innerHTML = `
    <h1 class="page-heading">${esc(pageData.name)}</h1>
    ${hasRealBody ? `<div class="prose-body">${safe}</div>` : ""}
    ${attachmentsHtml(attachments)}`;

  // Load PDF previews async — does not block page render
  loadPdfIframes(attachments);
}

function renderCurrentState() {
  if (_state === "home") {
    goHome();
  } else if (_state === "book") {
    renderBookView();
  } else if (_state === "page") {
    renderPageViewShell(_page ? _page.name : "Page");
  }
}

// ── Show / hide overlay ──────────────────────────────────────
function showOverlay() {
  // Remove page-active classes that hide the reader overlay via !important
  const main = document.querySelector(".main");
  if (main) main.classList.remove("kb-active", "staff-active", "aml-active", "fees-active", "projects-active", "valuation-active", "companies-active");
  _overlay.classList.add("active");
  if (_dashboard) _dashboard.style.display = "none";
}

function hideOverlay() {
  _overlay.classList.remove("active");
  if (_dashboard) _dashboard.style.display = "";
}

// ── Navigation ───────────────────────────────────────────────
function navChange(section) {
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section } }));
}

function goHome() {
  _state = "home";
  _book  = null;
  _page  = null;
  _expandedChapters.clear();
  hideOverlay();
  window.history.pushState({ view: "home" }, "", "/");
  navChange("home");
}

async function openBook(bookId, bookName, bookSlug) {
  _state = "book";
  _page  = null;
  _expandedChapters.clear();

  showOverlay();
  _overlay.innerHTML = `
    <nav class="reader-breadcrumb" aria-label="Breadcrumb">
      <button class="bc-link" id="bc-home-tmp">Home</button>
      <span class="bc-sep"> / </span>
      <span class="bc-current">${esc(bookName)}</span>
    </nav>
    <div class="reader-layout">
      <nav class="reader-nav" aria-label="Book navigation">
        <div class="reader-nav-header">${esc(bookName)}</div>
        <div style="padding:16px;font-size:13px;color:var(--text-secondary)">${spinnerHtml()}</div>
      </nav>
      <div class="reader-content">${spinnerHtml()}</div>
    </div>`;

  _overlay.querySelector("#bc-home-tmp")?.addEventListener("click", goHome);

  window.history.pushState({ view: "book", bookId, bookName, bookSlug }, "", `/book/${bookId}`);
  navChange("kb");

  try {
    const book = await fetchBook(bookId);
    _book = book;
    renderBookView();
  } catch (err) {
    console.error("[Hub Reader] book fetch error:", err);
    const content = _overlay.querySelector(".reader-content");
    if (content) content.innerHTML = `
      <div style="padding:40px;text-align:center">
        <p style="color:#e53e3e;margin-bottom:16px">Failed to load book.</p>
        <button onclick="window.__hub_reader.openBook(${bookId},'${escAttr(bookName)}','${escAttr(bookSlug)}')"
                style="padding:8px 20px;background:var(--accent);border:none;border-radius:6px;cursor:pointer;font-weight:600">
          Try again
        </button>
      </div>`;
  }
}

async function openPage(pageId, pageName, bookId, bookName) {
  _state = "page";
  _page  = { id: pageId, name: pageName };

  // Ensure book is loaded
  if (!_book || _book.id !== bookId) {
    showOverlay();
    _overlay.innerHTML = `<div style="padding:40px">${spinnerHtml()}</div>`;
    try {
      _book = await fetchBook(bookId);
    } catch (err) {
      console.error("[Hub Reader] book fetch error:", err);
      _book = { id: bookId, name: bookName, slug: "", description: "", contents: [] };
    }
  }

  showOverlay();
  renderPageViewShell(pageName);

  window.history.pushState(
    { view: "page", pageId, pageName, bookId, bookName },
    "",
    `/book/${bookId}/page/${pageId}`
  );
  navChange("kb");

  try {
    const [pageData, attachments] = await Promise.all([
      fetchPageContent(pageId),
      fetchAttachments(pageId).catch(() => []),
    ]);
    _page = { id: pageData.id, name: pageData.name };
    injectPageContent(pageData, attachments);
    const panel = _overlay.querySelector("#reader-content-panel") || _overlay.querySelector(".reader-content");
    if (panel) panel.scrollTop = 0;
  } catch (err) {
    console.error("[Hub Reader] page fetch error:", err);
    const panel = _overlay.querySelector("#reader-content-panel") || _overlay.querySelector(".reader-content");
    if (panel) panel.innerHTML = `<p style="padding:24px;color:#e53e3e">Failed to load page. Please try again.</p>`;
  }
}

// ── popstate handler ─────────────────────────────────────────
function handlePopState(e) {
  const s = e.state;
  if (!s || s.view === "home") {
    _state = "home";
    _book  = null;
    _page  = null;
    _expandedChapters.clear();
    hideOverlay();
    navChange("home");
    return;
  }
  if (s.view === "book") {
    openBook(s.bookId, s.bookName, s.bookSlug);
    return;
  }
  if (s.view === "page") {
    openPage(s.pageId, s.pageName, s.bookId, s.bookName);
  }
}

// ── hub:openBook event listener ──────────────────────────────
function handleOpenBookEvent(e) {
  const { id, name, slug } = e.detail || {};
  if (id) openBook(id, name, slug);
}

// ── init ─────────────────────────────────────────────────────
export default async function init(_config) {
  _overlay   = document.getElementById("hub-content-area");
  _dashboard = document.querySelector(".page-content");

  if (!_overlay) {
    console.warn("[Hub Reader] #hub-content-area not found — reader disabled.");
    return;
  }

  // Register popstate once
  window.addEventListener("popstate", handlePopState);

  // Listen for hub:openBook events dispatched by other components
  document.addEventListener("hub:openBook", handleOpenBookEvent);

  // Expose public API
  window.__hub_reader = { openBook, openPage, goHome };

  // Handle direct URL access on load
  const path = window.location.pathname;
  const bookPageMatch = path.match(/^\/book\/(\d+)\/page\/(\d+)$/);
  const bookMatch     = path.match(/^\/book\/(\d+)$/);

  if (bookPageMatch) {
    await openPage(
      parseInt(bookPageMatch[2], 10),
      "Loading…",
      parseInt(bookPageMatch[1], 10),
      "Loading…"
    );
  } else if (bookMatch) {
    await openBook(parseInt(bookMatch[1], 10), "Loading…", "");
  } else {
    // Set initial home state so popstate works correctly
    window.history.replaceState({ view: "home" }, "", window.location.pathname);
  }
}

export { openBook, openPage, goHome };
