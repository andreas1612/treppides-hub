// ============================================================
// components/shell/admin.js
// PIN-protected in-page admin panel for publishing content.
//
// Usage:  window.__hub_admin.open()   — triggered by sidebar button
// PIN:    set ADMIN_PIN in config.js (shared single PIN for all admins)
// Auth:   PIN stored in sessionStorage for the duration of the session
// ============================================================

import CONFIG from "../../config.js?v=1";
import { createPage, deletePage, fetchPages } from "../../api/bookstack.js";
import { escapeHtml } from "../../utils/dom.js?v=2";
import { getCurrentUser } from "../../js/auth.js";

// ---- Helpers --------------------------------------------------

/** Convert plain-text content to safe BookStack HTML. */
function textToHtml(text) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map(para => `<p>${escapeHtml(para.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/**
 * Convert a YouTube or Vimeo URL to an embed URL.
 * Returns null if the URL is not recognised.
 */
function youtubeEmbedUrl(url) {
  const patterns = [
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return `https://www.youtube.com/embed/${m[1]}?rel=0`;
  }
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

const SESSION_KEY = "hub_admin_auth";

function isAuthenticated() {
  return sessionStorage.getItem(SESSION_KEY) === "1";
}

function authenticate() {
  sessionStorage.setItem(SESSION_KEY, "1");
}

// ---- Upload helpers -------------------------------------------

async function uploadImages(files) {
  const urls = [];
  for (const file of files) {
    const fd = new FormData();
    fd.append("file", file);
    const resp = await fetch("/api/upload/image", { method: "POST", body: fd });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || `Image upload failed (HTTP ${resp.status})`);
    }
    const json = await resp.json();
    urls.push(json.url);
  }
  return urls;
}

async function uploadVideoFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const resp = await fetch("/api/upload/video", { method: "POST", body: fd });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `Video upload failed (HTTP ${resp.status})`);
  }
  const json = await resp.json();
  return json.url;
}

// ---- DOM builders ---------------------------------------------

function buildPinModal() {
  const el = document.createElement("div");
  el.id        = "hub-pin-backdrop";
  el.className = "hub-backdrop hidden";
  el.innerHTML = `
    <div class="hub-modal" id="hub-pin-modal" role="dialog"
         aria-modal="true" aria-labelledby="hub-pin-title">
      <div class="hub-modal-header">
        <div>
          <h2 class="hub-modal-title" id="hub-pin-title">Admin Access</h2>
          <p class="hub-modal-sub">Enter your admin PIN to continue.</p>
        </div>
        <button class="hub-modal-close" id="hub-pin-close" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6"  x2="6"  y2="18"/>
            <line x1="6"  y1="6"  x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="hub-field">
        <label class="hub-label" for="hub-pin-field">PIN</label>
        <input class="hub-pin-input" id="hub-pin-field" type="password"
               inputmode="numeric" maxlength="12"
               autocomplete="off" placeholder="••••" />
        <div class="hub-pin-error" id="hub-pin-error" role="alert"></div>
      </div>

      <div class="hub-modal-actions">
        <button class="hub-btn hub-btn-ghost" id="hub-pin-cancel">Cancel</button>
        <button class="hub-btn hub-btn-primary" id="hub-pin-submit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Access
        </button>
      </div>
    </div>`;
  return el;
}

function buildAdminModal(sections) {
  const options = sections
    .map(s => `<option value="${s.bookId}">${s.label}</option>`)
    .join("");

  const el = document.createElement("div");
  el.id        = "hub-admin-backdrop";
  el.className = "hub-backdrop hidden";
  el.innerHTML = `
    <div class="hub-modal" id="hub-admin-modal" role="dialog"
         aria-modal="true" aria-labelledby="hub-admin-title">
      <div class="hub-modal-header">
        <div>
          <h2 class="hub-modal-title" id="hub-admin-title">Admin Panel</h2>
          <p class="hub-modal-sub">Publish content or manage existing pages.</p>
        </div>
        <button class="hub-modal-close" id="hub-admin-close" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6"  x2="6"  y2="18"/>
            <line x1="6"  y1="6"  x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="hub-tabs" role="tablist">
        <button class="hub-tab active" data-tab="publish" role="tab">Publish</button>
        <button class="hub-tab"        data-tab="manage"  role="tab">Manage</button>
      </div>

      <!-- ── Publish panel ── -->
      <div id="hub-publish-panel">
        <div class="hub-field">
          <label class="hub-label" for="hub-admin-section">Section</label>
          <select class="hub-select" id="hub-admin-section">${options}</select>
        </div>
        <div class="hub-field">
          <label class="hub-label" for="hub-admin-title-input">Title</label>
          <input class="hub-input" id="hub-admin-title-input" type="text"
                 placeholder="e.g. Office closure — 14 April" maxlength="200" />
        </div>
        <div class="hub-field">
          <label class="hub-label" for="hub-admin-content">Content</label>
          <textarea class="hub-textarea" id="hub-admin-content" rows="4"
            placeholder="Type your content here. Press Enter twice to start a new paragraph."></textarea>
          <p class="hub-admin-hint">Plain text — blank line = new paragraph.</p>
        </div>

        <!-- Media type selector -->
        <div class="hub-field">
          <label class="hub-label">Media <span class="hub-optional">(optional)</span></label>
          <div class="hub-media-btns" id="hub-media-btns">
            <button class="hub-media-btn" id="hub-media-photo-btn" type="button">📷 Photo</button>
            <button class="hub-media-btn" id="hub-media-video-btn" type="button">🎥 Video</button>
            <button class="hub-media-btn" id="hub-media-yt-btn"    type="button">🔗 YouTube / Vimeo</button>
          </div>
        </div>

        <!-- Photo area -->
        <div id="hub-photo-area" hidden>
          <input type="file" id="hub-photo-input" accept="image/*" multiple hidden>
          <label for="hub-photo-input" class="hub-file-label">Choose images…</label>
          <div class="hub-photo-previews" id="hub-photo-previews"></div>
          <p class="hub-admin-hint">Max 4 images · 20 MB each.</p>
        </div>

        <!-- Video file area -->
        <div id="hub-video-area" hidden>
          <input type="file" id="hub-video-input" accept="video/mp4,video/quicktime,video/webm" hidden>
          <label for="hub-video-input" class="hub-file-label">Choose video (max 150 MB)…</label>
          <div id="hub-video-preview"></div>
        </div>

        <!-- YouTube / Vimeo area -->
        <div id="hub-yt-area" hidden>
          <input class="hub-input" id="hub-yt-input" type="url"
                 placeholder="https://www.youtube.com/watch?v=...">
          <div id="hub-yt-preview"></div>
        </div>

        <div class="hub-status" id="hub-admin-status"></div>
        <div class="hub-modal-actions">
          <button class="hub-btn hub-btn-ghost" id="hub-admin-cancel">Cancel</button>
          <button class="hub-btn hub-btn-primary" id="hub-admin-submit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
            Publish
          </button>
        </div>
      </div>

      <!-- ── Manage panel ── -->
      <div id="hub-manage-panel" hidden>
        <div class="hub-field">
          <label class="hub-label" for="hub-manage-section">Section</label>
          <select class="hub-select" id="hub-manage-section">${options}</select>
        </div>
        <button class="hub-btn hub-btn-ghost" id="hub-manage-load" style="margin-bottom:16px;">
          Load pages
        </button>
        <div id="hub-manage-list"></div>
        <div class="hub-status" id="hub-manage-status"></div>
      </div>
    </div>`;
  return el;
}

function buildAdminButton() {
  const btn = document.createElement("button");
  btn.className = "admin-toggle-btn";
  btn.id        = "hub-admin-btn";
  btn.title     = "Admin — publish content";
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="8" r="4"/>
      <path d="M6 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
      <line x1="18" y1="10" x2="22" y2="10"/>
      <line x1="20" y1="8"  x2="20" y2="12"/>
    </svg>
    Admin`;
  return btn;
}

// ---- Main init ------------------------------------------------

export default function init(config) {
  // Admin panel is SUPER-tier only — don't render anything for other tiers.
  if (getCurrentUser()?.tier !== "SUPER") return;

  const sections = [
    { label: "Announcements",          bookId: config.ANNOUNCEMENTS_BOOK_ID },
    { label: "Policies & Procedures",  bookId: config.POLICIES_BOOK_ID      },
    { label: "Training & Development", bookId: config.TRAINING_BOOK_ID      },
  ];

  const pinModal   = buildPinModal();
  const adminModal = buildAdminModal(sections);
  document.body.appendChild(pinModal);
  document.body.appendChild(adminModal);

  const footer = document.querySelector("#sidebar .sidebar-footer");
  if (footer) {
    const btn = buildAdminButton();
    footer.appendChild(btn);
    btn.addEventListener("click", openEntryPoint);
  }

  // ---- PIN modal ----

  function openEntryPoint() {
    if (isAuthenticated()) openAdminPanel();
    else openPinModal();
  }

  function openPinModal() {
    pinModal.classList.remove("hidden");
    setTimeout(() => document.getElementById("hub-pin-field")?.focus(), 50);
    document.getElementById("hub-pin-error").textContent = "";
    document.getElementById("hub-pin-field").value = "";
  }

  function closePinModal() {
    pinModal.classList.add("hidden");
  }

  document.getElementById("hub-pin-close").addEventListener("click",  closePinModal);
  document.getElementById("hub-pin-cancel").addEventListener("click", closePinModal);
  pinModal.addEventListener("click", e => { if (e.target === pinModal) closePinModal(); });

  document.getElementById("hub-pin-submit").addEventListener("click", handlePinSubmit);
  document.getElementById("hub-pin-field").addEventListener("keydown", e => {
    if (e.key === "Enter") handlePinSubmit();
  });

  function handlePinSubmit() {
    const entered = document.getElementById("hub-pin-field").value.trim();
    if (entered === String(config.ADMIN_PIN)) {
      authenticate();
      closePinModal();
      openAdminPanel();
    } else {
      const err = document.getElementById("hub-pin-error");
      err.textContent = "Incorrect PIN. Try again.";
      document.getElementById("hub-pin-field").value = "";
      document.getElementById("hub-pin-field").focus();
    }
  }

  // ---- Admin panel ----

  function openAdminPanel() {
    adminModal.querySelectorAll(".hub-tab").forEach(t => {
      t.classList.toggle("active", t.dataset.tab === "publish");
    });
    document.getElementById("hub-publish-panel").hidden = false;
    document.getElementById("hub-manage-panel").hidden  = true;
    adminModal.classList.remove("hidden");
    clearPublishForm();
    setTimeout(() => document.getElementById("hub-admin-title-input")?.focus(), 50);
  }

  function closeAdminPanel() {
    adminModal.classList.add("hidden");
  }

  function clearPublishForm() {
    document.getElementById("hub-admin-status").className   = "hub-status";
    document.getElementById("hub-admin-status").textContent = "";
    document.getElementById("hub-admin-title-input").value  = "";
    document.getElementById("hub-admin-content").value      = "";

    // Reset media areas
    document.getElementById("hub-photo-area").hidden = true;
    document.getElementById("hub-video-area").hidden = true;
    document.getElementById("hub-yt-area").hidden    = true;
    document.getElementById("hub-photo-input").value   = "";
    document.getElementById("hub-video-input").value   = "";
    document.getElementById("hub-yt-input").value      = "";
    document.getElementById("hub-photo-previews").innerHTML = "";
    document.getElementById("hub-video-preview").innerHTML  = "";
    document.getElementById("hub-yt-preview").innerHTML     = "";
    adminModal.querySelectorAll(".hub-media-btn").forEach(b => b.classList.remove("active"));
  }

  document.getElementById("hub-admin-close").addEventListener("click",  closeAdminPanel);
  document.getElementById("hub-admin-cancel").addEventListener("click", closeAdminPanel);
  adminModal.addEventListener("click", e => { if (e.target === adminModal) closeAdminPanel(); });

  // ---- Tab switching ----

  adminModal.querySelectorAll(".hub-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      adminModal.querySelectorAll(".hub-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const which = tab.dataset.tab;
      document.getElementById("hub-publish-panel").hidden = (which !== "publish");
      document.getElementById("hub-manage-panel").hidden  = (which !== "manage");
    });
  });

  // ---- Media button toggles ----

  function activateMediaArea(areaId, btnId) {
    const areas  = ["hub-photo-area", "hub-video-area", "hub-yt-area"];
    const btns   = ["hub-media-photo-btn", "hub-media-video-btn", "hub-media-yt-btn"];
    const isOpen = !document.getElementById(areaId).hidden;

    // Hide all, deactivate all buttons
    areas.forEach(id => { document.getElementById(id).hidden = true; });
    btns.forEach(id  => { document.getElementById(id).classList.remove("active"); });

    // If it wasn't already open, open it
    if (!isOpen) {
      document.getElementById(areaId).hidden = false;
      document.getElementById(btnId).classList.add("active");
    }
  }

  document.getElementById("hub-media-photo-btn").addEventListener("click", () =>
    activateMediaArea("hub-photo-area", "hub-media-photo-btn"));
  document.getElementById("hub-media-video-btn").addEventListener("click", () =>
    activateMediaArea("hub-video-area", "hub-media-video-btn"));
  document.getElementById("hub-media-yt-btn").addEventListener("click", () =>
    activateMediaArea("hub-yt-area", "hub-media-yt-btn"));

  // ---- Photo preview ----

  document.getElementById("hub-photo-input").addEventListener("change", function () {
    const preview = document.getElementById("hub-photo-previews");
    const files   = Array.from(this.files).slice(0, 4);
    if (!files.length) { preview.innerHTML = ""; return; }

    const extra = this.files.length > 4
      ? `<p class="hub-admin-hint">Only first 4 images will be used (${this.files.length} selected).</p>`
      : "";

    preview.innerHTML = `
      <div class="hub-photo-grid">
        ${files.map(f => `<img src="${URL.createObjectURL(f)}" alt="" class="hub-photo-thumb">`).join("")}
      </div>${extra}`;
  });

  // ---- Video preview ----

  document.getElementById("hub-video-input").addEventListener("change", function () {
    const preview = document.getElementById("hub-video-preview");
    const file    = this.files[0];
    if (!file) { preview.innerHTML = ""; return; }

    const MAX = 150 * 1024 * 1024;
    if (file.size > MAX) {
      preview.innerHTML = `<p class="hub-admin-hint" style="color:var(--danger,#c53030);">
        File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 150 MB.</p>`;
      this.value = "";
      return;
    }

    const sizeMb = (file.size / 1024 / 1024).toFixed(1);
    preview.innerHTML = `
      <video class="hub-video-thumb" controls preload="metadata"
             src="${URL.createObjectURL(file)}"></video>
      <p class="hub-admin-hint">${escapeHtml(file.name)} — ${sizeMb} MB</p>`;
  });

  // ---- YouTube / Vimeo preview ----

  function updateYtPreview() {
    const val     = document.getElementById("hub-yt-input").value.trim();
    const preview = document.getElementById("hub-yt-preview");
    if (!val) { preview.innerHTML = ""; return; }
    const embed = youtubeEmbedUrl(val);
    if (embed) {
      preview.innerHTML = `
        <div class="hub-yt-preview-wrap">
          <iframe src="${embed}" frameborder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media;
                         gyroscope; picture-in-picture"
                  allowfullscreen></iframe>
        </div>`;
    } else {
      preview.innerHTML = `<p class="hub-admin-hint" style="color:var(--danger,#c53030);">
        Not a recognised YouTube or Vimeo URL.</p>`;
    }
  }

  document.getElementById("hub-yt-input").addEventListener("blur",  updateYtPreview);
  document.getElementById("hub-yt-input").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); updateYtPreview(); }
  });

  // ---- Publish ----

  document.getElementById("hub-admin-submit").addEventListener("click", handlePublish);

  async function handlePublish() {
    const titleVal  = document.getElementById("hub-admin-title-input").value.trim();
    const bodyVal   = document.getElementById("hub-admin-content").value.trim();
    const bookId    = parseInt(document.getElementById("hub-admin-section").value, 10);
    const statusEl  = document.getElementById("hub-admin-status");
    const submitBtn = document.getElementById("hub-admin-submit");

    if (!titleVal) {
      showPublishStatus("Please enter a title.", "error");
      document.getElementById("hub-admin-title-input").focus();
      return;
    }

    setSubmitBusy(true, "Publishing…");
    statusEl.className = "hub-status";

    try {
      let mediaHtml = "";

      const photoArea = document.getElementById("hub-photo-area");
      const videoArea = document.getElementById("hub-video-area");
      const ytArea    = document.getElementById("hub-yt-area");

      if (!photoArea.hidden) {
        const files = Array.from(document.getElementById("hub-photo-input").files).slice(0, 4);
        if (files.length) {
          setSubmitBusy(true, `Uploading ${files.length} image(s)…`);
          const urls = await uploadImages(files);
          mediaHtml = `<div class="hub-media-grid">${urls.map(u => `<img src="${u}" alt="">`).join("")}</div>`;
        }
      } else if (!videoArea.hidden) {
        const file = document.getElementById("hub-video-input").files[0];
        if (file) {
          setSubmitBusy(true, "Uploading video…");
          const url = await uploadVideoFile(file);
          mediaHtml = `<div class="hub-media-video"><video controls preload="metadata" src="${url}"></video></div>`;
        }
      } else if (!ytArea.hidden) {
        const url = document.getElementById("hub-yt-input").value.trim();
        if (url) {
          const embed = youtubeEmbedUrl(url);
          if (embed) {
            mediaHtml = `<div class="hub-media-video"><iframe src="${embed}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
          }
        }
      }

      const bodyHtml = bodyVal ? `<div class="hub-post-body">${textToHtml(bodyVal)}</div>` : "";
      const pageHtml = mediaHtml + bodyHtml || "<p></p>";

      await createPage(bookId, titleVal, pageHtml);

      showPublishStatus("Published! Refreshing announcements…", "success");
      clearPublishForm();
      window.__hub_announcements?.refresh();

    } catch (err) {
      showPublishStatus(`Failed to publish: ${err.message}`, "error");
    } finally {
      setSubmitBusy(false);
    }

    function setSubmitBusy(busy, label = "") {
      submitBtn.disabled  = busy;
      submitBtn.innerHTML = busy
        ? `<span class="spinner"></span> ${label}`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <line x1="22" y1="2" x2="11" y2="13"/>
             <polygon points="22 2 15 22 11 13 2 9 22 2"/>
           </svg> Publish`;
    }

    function showPublishStatus(msg, type) {
      statusEl.textContent = msg;
      statusEl.className   = `hub-status show ${type}`;
    }
  }

  // ---- Manage / Delete ----

  document.getElementById("hub-manage-load").addEventListener("click", loadManagePages);

  async function loadManagePages() {
    const bookId   = parseInt(document.getElementById("hub-manage-section").value, 10);
    const listEl   = document.getElementById("hub-manage-list");
    const statusEl = document.getElementById("hub-manage-status");
    statusEl.className   = "hub-status";
    statusEl.textContent = "";
    listEl.innerHTML     = `<p class="hub-admin-hint">Loading…</p>`;

    try {
      const pages = await fetchPages(bookId, 20);
      if (!pages.length) {
        listEl.innerHTML = `<p class="hub-admin-hint">No pages found in this section.</p>`;
        return;
      }
      listEl.innerHTML = pages.map(p => `
        <div class="hub-page-item" data-page-id="${p.id}">
          <span class="hub-page-item-title">${escapeHtml(p.name || "Untitled")}</span>
          <button class="hub-btn hub-btn-danger"
                  data-page-id="${p.id}"
                  data-page-title="${escapeHtml(p.name || "Untitled")}">
            Delete
          </button>
        </div>`).join("");
    } catch (err) {
      listEl.innerHTML     = "";
      statusEl.textContent = `Failed to load: ${err.message}`;
      statusEl.className   = "hub-status show error";
    }
  }

  // Two-click delete: first click = "Confirm?", second click = execute
  adminModal.addEventListener("click", async e => {
    const btn = e.target.closest(".hub-btn-danger");
    if (!btn || !btn.dataset.pageId) return;

    const pageId    = parseInt(btn.dataset.pageId, 10);
    const pageTitle = btn.dataset.pageTitle;
    const item      = btn.closest(".hub-page-item");
    const statusEl  = document.getElementById("hub-manage-status");

    if (btn.dataset.confirming !== "1") {
      btn.dataset.confirming = "1";
      btn.textContent        = "Confirm?";
      btn.style.background   = "#c53030";
      setTimeout(() => {
        if (btn.dataset.confirming === "1") {
          btn.dataset.confirming = "";
          btn.textContent        = "Delete";
          btn.style.background   = "";
        }
      }, 3000);
      return;
    }

    btn.disabled    = true;
    btn.textContent = "Deleting…";
    try {
      await deletePage(pageId);
      item.remove();
      statusEl.textContent = `"${pageTitle}" deleted.`;
      statusEl.className   = "hub-status show success";
    } catch (err) {
      btn.disabled           = false;
      btn.textContent        = "Delete";
      btn.dataset.confirming = "";
      btn.style.background   = "";
      statusEl.textContent   = `Delete failed: ${err.message}`;
      statusEl.className     = "hub-status show error";
    }
  });

  // Global Escape
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!pinModal.classList.contains("hidden"))   closePinModal();
    if (!adminModal.classList.contains("hidden")) closeAdminPanel();
  });

  window.__hub_admin = { open: openEntryPoint };
}
