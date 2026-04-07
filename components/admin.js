// ============================================================
// components/admin.js
// PIN-protected in-page admin panel for publishing content to
// BookStack without leaving the hub or writing any code.
//
// Usage:  window.__hub_admin.open()   — triggered by sidebar button
// PIN:    set ADMIN_PIN in config.js (shared single PIN for all admins)
// Auth:   PIN stored in sessionStorage for the duration of the session
// ============================================================

import CONFIG    from "../config.js";
import { createPage } from "../api/bookstack.js";

// ---- Helpers --------------------------------------------------

/** Convert plain-text content to safe BookStack HTML. */
function textToHtml(text) {
  return text
    .trim()
    .split(/\n{2,}/)                          // double-newline → new <p>
    .map(para =>
      `<p>${para.trim().replace(/\n/g, "<br>")}</p>`
    )
    .join("\n");
}

const SESSION_KEY = "hub_admin_auth";

function isAuthenticated() {
  return sessionStorage.getItem(SESSION_KEY) === "1";
}

function authenticate() {
  sessionStorage.setItem(SESSION_KEY, "1");
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
          <h2 class="hub-modal-title" id="hub-admin-title">Add Content</h2>
          <p class="hub-modal-sub">Publish a new page to BookStack — no code required.</p>
        </div>
        <button class="hub-modal-close" id="hub-admin-close" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6"  x2="6"  y2="18"/>
            <line x1="6"  y1="6"  x2="18" y2="18"/>
          </svg>
        </button>
      </div>

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
        <textarea class="hub-textarea" id="hub-admin-content" rows="6"
          placeholder="Type your content here. Press Enter twice to start a new paragraph."></textarea>
        <p class="hub-admin-hint">Plain text only — blank line = new paragraph.</p>
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
    </div>`;
  return el;
}

function buildAdminButton() {
  const btn = document.createElement("button");
  btn.className  = "admin-toggle-btn";
  btn.id         = "hub-admin-btn";
  btn.title      = "Admin — publish content";
  btn.innerHTML  = `
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
  const sections = [
    { label: "Announcements",        bookId: config.ANNOUNCEMENTS_BOOK_ID },
    { label: "Policies & Procedures", bookId: config.POLICIES_BOOK_ID      },
    { label: "Training & Development",bookId: config.TRAINING_BOOK_ID      },
  ];

  // ---- Inject modals into DOM ----
  const pinModal   = buildPinModal();
  const adminModal = buildAdminModal(sections);
  document.body.appendChild(pinModal);
  document.body.appendChild(adminModal);

  // ---- Inject Admin button into sidebar footer ----
  const footer = document.querySelector("#sidebar .sidebar-footer");
  if (footer) {
    const btn = buildAdminButton();
    footer.appendChild(btn);
    btn.addEventListener("click", openEntryPoint);
  }

  // ---- PIN modal logic ----

  function openEntryPoint() {
    if (isAuthenticated()) {
      openAdminPanel();
    } else {
      openPinModal();
    }
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

  // ---- Admin panel logic ----

  function openAdminPanel() {
    adminModal.classList.remove("hidden");
    document.getElementById("hub-admin-status").className = "hub-status";
    document.getElementById("hub-admin-status").textContent = "";
    document.getElementById("hub-admin-title-input").value = "";
    document.getElementById("hub-admin-content").value = "";
    setTimeout(() => document.getElementById("hub-admin-title-input")?.focus(), 50);
  }

  function closeAdminPanel() {
    adminModal.classList.add("hidden");
  }

  document.getElementById("hub-admin-close").addEventListener("click",  closeAdminPanel);
  document.getElementById("hub-admin-cancel").addEventListener("click", closeAdminPanel);
  adminModal.addEventListener("click", e => { if (e.target === adminModal) closeAdminPanel(); });

  document.getElementById("hub-admin-submit").addEventListener("click", handlePublish);

  async function handlePublish() {
    const titleVal   = document.getElementById("hub-admin-title-input").value.trim();
    const contentVal = document.getElementById("hub-admin-content").value.trim();
    const bookId     = parseInt(document.getElementById("hub-admin-section").value, 10);
    const statusEl   = document.getElementById("hub-admin-status");
    const submitBtn  = document.getElementById("hub-admin-submit");

    // Validate
    if (!titleVal) {
      showStatus("Please enter a title.", "error");
      document.getElementById("hub-admin-title-input").focus();
      return;
    }
    if (!contentVal) {
      showStatus("Please enter some content.", "error");
      document.getElementById("hub-admin-content").focus();
      return;
    }

    // Loading state
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="spinner"></span> Publishing…`;
    statusEl.className  = "hub-status";

    try {
      await createPage(bookId, titleVal, textToHtml(contentVal));

      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg> Publish`;

      showStatus("Page published! Hit the Refresh button on the section to see it.", "success");

      // Clear fields
      document.getElementById("hub-admin-title-input").value = "";
      document.getElementById("hub-admin-content").value = "";

    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg> Publish`;
      showStatus(`Failed to publish: ${err.message}`, "error");
    }

    function showStatus(msg, type) {
      statusEl.textContent = msg;
      statusEl.className   = `hub-status show ${type}`;
    }
  }

  // Global Escape closes whichever modal is open
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!pinModal.classList.contains("hidden"))   closePinModal();
    if (!adminModal.classList.contains("hidden")) closeAdminPanel();
  });

  // Expose so external code can trigger the flow if needed
  window.__hub_admin = { open: openEntryPoint };
}
