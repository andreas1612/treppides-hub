// ============================================================
// components/widgets/announcements.js
// Renders the Latest Announcements section as a social post feed.
// Mounts into: #section-announcements
// ============================================================

import { fetchPages, fetchPageContent } from "../../api/bookstack.js";
import { formatDate }      from "../../utils/format.js";
import { escapeHtml, renderSkeleton, renderError, renderEmpty } from "../../utils/dom.js?v=2";
import { setStatus }       from "../shell/topbar.js";
import CONFIG              from "../../config.js";

const SECTION_ID  = "section-announcements";
const CARDS_ID    = "announcements-cards";
const REFRESH_ID  = "announcements-refresh";

/**
 * Parse a BookStack page's HTML and extract media for inline display.
 * Returns { type: 'images'|'video'|'none', images: [], videoHtml: '' }
 */
function extractMedia(html) {
  if (!html) return { type: "none", images: [], videoHtml: "" };

  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  // Check for video (uploaded .mp4/.webm or iframe embed)
  const video  = tmp.querySelector("video");
  const iframe = tmp.querySelector("iframe");

  if (video) {
    return {
      type: "video",
      videoHtml: `<video class="post-video" controls preload="metadata"
                         src="${escapeHtml(video.src || video.getAttribute("src") || "")}">
                  </video>`,
    };
  }

  if (iframe) {
    const src = iframe.src || iframe.getAttribute("src") || "";
    return {
      type: "video",
      videoHtml: `<div class="post-iframe-wrap">
                    <iframe src="${escapeHtml(src)}" frameborder="0"
                            allow="accelerometer; autoplay; clipboard-write;
                                   encrypted-media; gyroscope; picture-in-picture"
                            allowfullscreen></iframe>
                  </div>`,
    };
  }

  // Check for images
  const imgs = [...tmp.querySelectorAll("img")].map(i => i.src || i.getAttribute("src")).filter(Boolean);
  if (imgs.length) {
    return { type: "images", images: imgs };
  }

  return { type: "none", images: [], videoHtml: "" };
}

/** Renders one announcement as a social post card. */
function cardHtml(page) {
  const title   = page.name || "Untitled";
  const date    = formatDate(page.updated_at);
  const rawHtml = page.html || page.preview_html?.content || "";
  const media   = extractMedia(rawHtml);

  // Strip HTML tags for text excerpt
  const tmp = document.createElement("div");
  tmp.innerHTML = rawHtml;
  tmp.querySelectorAll("video,iframe,img,.hub-media-grid,.hub-media-video").forEach(el => el.remove());
  const excerpt = (tmp.textContent || "").trim().slice(0, 160);

  // Build media block
  let mediaHtml = "";
  if (media.type === "video") {
    mediaHtml = `<div class="post-media">${media.videoHtml}</div>`;
  } else if (media.type === "images" && media.images.length === 1) {
    mediaHtml = `<div class="post-media">
                   <img class="post-img-single" src="${escapeHtml(media.images[0])}" alt="" loading="lazy">
                 </div>`;
  } else if (media.type === "images" && media.images.length > 1) {
    const grid = media.images.slice(0, 4).map(src =>
      `<img class="post-img-grid-item" src="${escapeHtml(src)}" alt="" loading="lazy">`
    ).join("");
    mediaHtml = `<div class="post-media post-img-grid post-img-grid-${Math.min(media.images.length, 4)}">${grid}</div>`;
  }

  return `
    <article class="post-card">
      ${mediaHtml}
      <div class="post-card-body">
        <h3 class="post-title">
          <a class="reader-link" href="#"
             data-page-id="${page.id}"
             data-page-name="${escapeHtml(title)}"
             data-book-id="${CONFIG.ANNOUNCEMENTS_BOOK_ID}"
             data-book-name="Announcements">
            ${escapeHtml(title)}
          </a>
        </h3>
        <div class="post-meta">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8"  y1="2" x2="8"  y2="6"/>
            <line x1="3"  y1="10" x2="21" y2="10"/>
          </svg>
          ${escapeHtml(date)}
        </div>
        ${excerpt ? `<p class="post-excerpt">${escapeHtml(excerpt)}</p>` : ""}
        <div class="post-card-footer">
          <a class="post-read-more reader-link" href="#"
             data-page-id="${page.id}"
             data-page-name="${escapeHtml(title)}"
             data-book-id="${CONFIG.ANNOUNCEMENTS_BOOK_ID}"
             data-book-name="Announcements">
            Read more →
          </a>
        </div>
      </div>
    </article>`;
}

// ── Carousel (paginated grid) ─────────────────────────────

let _allCards = [];   // full list of rendered card HTML strings
let _page = 0;        // current page index
let _perPage = 3;     // cards per page (recalculated on render)
let _ro = null;       // ResizeObserver on the feed (recalcs perPage on width change)

/** How many cards fit in one grid row at the current container width. */
function calcPerPage(feedEl) {
  const gap = 20;
  const minCard = 320;
  const w = feedEl.clientWidth;
  return Math.max(1, Math.floor((w + gap) / (minCard + gap)));
}

function totalPages() {
  return Math.max(1, Math.ceil(_allCards.length / _perPage));
}

function renderPage(container) {
  const feed = container.querySelector(".post-feed");
  const dotsWrap = container.querySelector(".carousel-dots");
  const prevBtn = container.querySelector(".carousel-arrow-prev");
  const nextBtn = container.querySelector(".carousel-arrow-next");
  const controls = container.querySelector(".carousel-controls");
  if (!feed) return;

  const start = _page * _perPage;
  feed.innerHTML = _allCards.slice(start, start + _perPage).join("");

  const pages = totalPages();
  if (controls) controls.classList.toggle("single-page", pages <= 1);
  if (prevBtn) prevBtn.disabled = _page <= 0;
  if (nextBtn) nextBtn.disabled = _page >= pages - 1;

  if (dotsWrap) {
    dotsWrap.innerHTML = Array.from({ length: pages }, (_, i) =>
      `<button class="carousel-dot ${i === _page ? "active" : ""}" data-page="${i}" aria-label="Page ${i + 1}"></button>`
    ).join("");
  }
}

function initCarousel(container) {
  const feed = container.querySelector(".post-feed");
  if (!feed) return;

  _perPage = calcPerPage(feed);
  _page = 0;
  renderPage(container);

  container.querySelector(".carousel-arrow-prev")?.addEventListener("click", () => {
    if (_page > 0) { _page--; renderPage(container); }
  });
  container.querySelector(".carousel-arrow-next")?.addEventListener("click", () => {
    if (_page < totalPages() - 1) { _page++; renderPage(container); }
  });
  container.querySelector(".carousel-dots")?.addEventListener("click", e => {
    const dot = e.target.closest(".carousel-dot");
    if (!dot) return;
    _page = parseInt(dot.dataset.page, 10);
    renderPage(container);
  });

  // Recalculate whenever the feed's width changes. A ResizeObserver (not a
  // window "resize" listener) is used deliberately: when the hub loads on a
  // non-home route, the home .page-content is display:none, so at init
  // feed.clientWidth is 0 and calcPerPage() is forced to 1 — the cards render
  // one-per-page. Navigating home makes the feed visible; ResizeObserver fires
  // on that hidden→visible transition (a window resize never does), letting us
  // recompute perPage and re-render into the correct grouped form. This also
  // covers ordinary viewport resizes.
  _ro?.disconnect();
  let resizeTimer;
  _ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!feed.clientWidth) return;   // still hidden — wait for a real width
      const newPer = calcPerPage(feed);
      if (newPer !== _perPage) {
        _perPage = newPer;
        _page = Math.min(_page, totalPages() - 1);
        renderPage(container);
      }
    }, 150);
  });
  _ro.observe(feed);
}

/** Fetches announcements and re-renders the feed. */
async function load() {
  const cardsEl    = document.getElementById(CARDS_ID);
  const refreshBtn = document.getElementById(REFRESH_ID);
  if (!cardsEl) return;

  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add("loading");
  }
  cardsEl.innerHTML = renderSkeleton();
  setStatus("Refreshing…");

  try {
    const pages = await fetchPages(CONFIG.ANNOUNCEMENTS_BOOK_ID, 10);

    if (!pages.length) {
      cardsEl.innerHTML = renderEmpty("No announcements yet.");
    } else {
      // Fetch full page HTML for each post so media (images/video) is included.
      // preview_html from the list API strips <img> tags.
      const fullPages = await Promise.all(
        pages.map(p => fetchPageContent(p.id).catch(() => p))
      );
      _allCards = fullPages.map(cardHtml);
      cardsEl.innerHTML = `
        <div class="post-carousel">
          <div class="post-feed"></div>
          <div class="carousel-controls">
            <button class="carousel-arrow carousel-arrow-prev" aria-label="Previous">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <div class="carousel-dots"></div>
            <button class="carousel-arrow carousel-arrow-next" aria-label="Next">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 6 15 12 9 18"/>
              </svg>
            </button>
          </div>
        </div>`;
      initCarousel(cardsEl);
    }

    setStatus("All systems operational");
  } catch (err) {
    console.error("[Hub] announcements fetch error:", err);
    cardsEl.innerHTML = renderError();
    setStatus("Knowledge base unreachable", true);
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove("loading");
    }
  }
}

/**
 * Initialises the Announcements section.
 * @param {object} _config - Hub config (values read from config.js internally).
 */
export default async function init(_config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  section.innerHTML = `
    <div class="hub-section">
      <div class="section-header">
        <div>
          <h2 class="section-title">Latest Announcements</h2>
          <p class="section-subtitle">10 most recent — pulled live from BookStack</p>
        </div>
        <button class="btn-refresh" id="${REFRESH_ID}" aria-label="Refresh announcements">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Refresh
        </button>
      </div>
      <div id="${CARDS_ID}"></div>
    </div>`;

  document.getElementById(REFRESH_ID)?.addEventListener("click", load);

  section.addEventListener("click", e => {
    const link = e.target.closest(".reader-link");
    if (!link) return;
    e.preventDefault();
    window.__hub_reader?.openPage(
      parseInt(link.dataset.pageId, 10),
      link.dataset.pageName,
      parseInt(link.dataset.bookId, 10),
      link.dataset.bookName
    );
  });

  await load();

  window.__hub_announcements = { refresh: load };
}
