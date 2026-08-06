// ============================================================
// components/support.js
// Two support modals:
//   1. Tech Support — hub feature/tool issues → TECHNICAL_TEAM@treppides.com
//   2. IT Support   — hardware/network/access → IT support mailbox
//
// Both submit via the Task Manager backend with the logged-in
// user's email as reply-to.
//
// Exposed: window.__hub_support.open()       (tech support)
//          window.__hub_itsupport.open()      (IT support)
// ============================================================

import CONFIG from "../../config.js";
import { getCurrentUser, TM_BASE } from "../../js/auth.js";

// ---- Tool list for the "Tools" sub-dropdown (alphabetical) ---

const TOOLS_LIST = [
  "AML Dashboard",
  "KYC Management (Work In Progress)",
  "Room Booking",
  "Task Manager",
  "TB Ratio Tool",
  "Team Calendar",
  "Training Portal (Work In Progress)",
  "Valuation Tool",
];

// ---- Shared helpers ------------------------------------------

const SEND_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <line x1="22" y1="2" x2="11" y2="13"/>
  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
</svg>`;

const CLOSE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round">
  <line x1="18" y1="6"  x2="6"  y2="18"/>
  <line x1="6"  y1="6"  x2="18" y2="18"/>
</svg>`;

// ---- IT Support modal ----------------------------------------

function buildItModal() {
  const el = document.createElement("div");
  el.id        = "hub-itsupport-backdrop";
  el.className = "hub-backdrop hidden";
  el.innerHTML = `
    <div class="hub-modal" id="hub-itsupport-modal" role="dialog"
         aria-modal="true" aria-labelledby="hub-itsupport-title">
      <div class="hub-modal-header">
        <div>
          <h2 class="hub-modal-title" id="hub-itsupport-title">IT Support Request</h2>
          <p class="hub-modal-sub">Report an IT issue — we'll get back to you shortly.</p>
        </div>
        <button class="hub-modal-close" id="hub-itsupport-close" aria-label="Close">${CLOSE_ICON}</button>
      </div>

      <div class="hub-field" style="margin-bottom:14px;">
        <label class="hub-label">Submitting as</label>
        <div class="hub-input" id="hub-itsupport-user-info" style="background:var(--bg-secondary,#f5f5f5);cursor:default;"></div>
      </div>

      <div class="hub-field">
        <label class="hub-label" for="hub-itsupport-category">Category</label>
        <select class="hub-select" id="hub-itsupport-category">
          <option value="Account / Access">Account / Access</option>
          <option value="Hardware">Hardware</option>
          <option value="IT Issue">IT Issue</option>
          <option value="Network / Connectivity">Network / Connectivity</option>
          <option value="Software">Software</option>
          <option value="Other">Other</option>
        </select>
      </div>

      <div class="hub-field">
        <label class="hub-label" for="hub-itsupport-message">Description</label>
        <textarea class="hub-textarea" id="hub-itsupport-message" rows="4"
          placeholder="Describe the issue in as much detail as possible…"></textarea>
      </div>

      <div class="hub-status" id="hub-itsupport-status"></div>

      <div class="hub-modal-actions">
        <button class="hub-btn hub-btn-ghost" id="hub-itsupport-cancel">Cancel</button>
        <button class="hub-btn hub-btn-primary" id="hub-itsupport-submit">${SEND_ICON} Submit Request</button>
      </div>
    </div>`;
  return el;
}

// ---- Tech Support modal (with Tools sub-dropdown) ------------

function buildTechModal() {
  const el = document.createElement("div");
  el.id        = "hub-techsupport-backdrop";
  el.className = "hub-backdrop hidden";
  el.innerHTML = `
    <div class="hub-modal" id="hub-techsupport-modal" role="dialog"
         aria-modal="true" aria-labelledby="hub-techsupport-title">
      <div class="hub-modal-header">
        <div>
          <h2 class="hub-modal-title" id="hub-techsupport-title">Tech Support Request</h2>
          <p class="hub-modal-sub">Report an issue with a Hub feature or tool — we'll get back to you shortly.</p>
        </div>
        <button class="hub-modal-close" id="hub-techsupport-close" aria-label="Close">${CLOSE_ICON}</button>
      </div>

      <div class="hub-field" style="margin-bottom:14px;">
        <label class="hub-label">Submitting as</label>
        <div class="hub-input" id="hub-techsupport-user-info" style="background:var(--bg-secondary,#f5f5f5);cursor:default;"></div>
      </div>

      <div class="hub-field">
        <label class="hub-label" for="hub-techsupport-category">Category</label>
        <select class="hub-select" id="hub-techsupport-category">
          <option value="Budget KPI">Budget KPI</option>
          <option value="CRM">CRM</option>
          <option value="Financials">Financials</option>
          <option value="Knowledge Base">Knowledge Base</option>
          <option value="Performance Report">Performance Report</option>
          <option value="Staff Directory">Staff Directory</option>
          <option value="Tools">Tools</option>
          <option value="Other">Other</option>
        </select>
      </div>

      <div class="hub-field" id="hub-techsupport-tool-field" style="display:none;">
        <label class="hub-label" for="hub-techsupport-tool">Tool</label>
        <select class="hub-select" id="hub-techsupport-tool">
          ${TOOLS_LIST.map(t => `<option value="${t}">${t}</option>`).join("\n          ")}
        </select>
      </div>

      <div class="hub-field">
        <label class="hub-label" for="hub-techsupport-message">Description</label>
        <textarea class="hub-textarea" id="hub-techsupport-message" rows="4"
          placeholder="Describe the issue in as much detail as possible…"></textarea>
      </div>

      <div class="hub-status" id="hub-techsupport-status"></div>

      <div class="hub-modal-actions">
        <button class="hub-btn hub-btn-ghost" id="hub-techsupport-cancel">Cancel</button>
        <button class="hub-btn hub-btn-primary" id="hub-techsupport-submit">${SEND_ICON} Submit Request</button>
      </div>
    </div>`;
  return el;
}

// ---- Wire up a modal -----------------------------------------

function wireModal(modal, id, type, getCategory) {
  document.body.appendChild(modal);

  function openModal() {
    modal.classList.remove("hidden");
    const user = getCurrentUser();
    const infoEl = document.getElementById(`${id}-user-info`);
    if (infoEl && user) {
      infoEl.textContent = `${user.name || user.email} (${user.email})`;
    }
    const catEl = document.getElementById(`${id}-category`);
    if (catEl) catEl.selectedIndex = 0;
    // Hide tool sub-dropdown on open (tech support only)
    const toolField = document.getElementById(`${id}-tool-field`);
    if (toolField) toolField.style.display = "none";
    const toolEl = document.getElementById(`${id}-tool`);
    if (toolEl) toolEl.selectedIndex = 0;

    document.getElementById(`${id}-message`).value = "";
    document.getElementById(`${id}-status`).className   = "hub-status";
    document.getElementById(`${id}-status`).textContent = "";
    setSubmitEnabled(true);
    setTimeout(() => document.getElementById(`${id}-category`)?.focus(), 50);
  }

  function closeModal() { modal.classList.add("hidden"); }

  document.getElementById(`${id}-close`).addEventListener("click", closeModal);
  document.getElementById(`${id}-cancel`).addEventListener("click", closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
  });

  function setSubmitEnabled(enabled) {
    const btn = document.getElementById(`${id}-submit`);
    btn.disabled = !enabled;
    btn.innerHTML = enabled
      ? `${SEND_ICON} Submit Request`
      : `<span class="spinner"></span> Sending…`;
  }

  function showStatus(msg, cls) {
    const el = document.getElementById(`${id}-status`);
    el.textContent = msg;
    el.className   = `hub-status show ${cls}`;
  }

  document.getElementById(`${id}-submit`).addEventListener("click", async () => {
    const category = getCategory();
    const message  = document.getElementById(`${id}-message`).value.trim();

    if (!message) {
      showStatus("Please describe the issue.", "error");
      document.getElementById(`${id}-message`).focus();
      return;
    }

    setSubmitEnabled(false);
    document.getElementById(`${id}-status`).className = "hub-status";

    try {
      const res = await fetch(`${TM_BASE}/api/support/ticket`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ category, message, type }),
      });

      if (res.ok) {
        showStatus("Request submitted! We'll get back to you shortly.", "success");
        document.getElementById(`${id}-message`).value = "";
        setSubmitEnabled(true);
      } else {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message || `HTTP ${res.status}`);
      }
    } catch (err) {
      setSubmitEnabled(true);
      showStatus(
        `Could not send your request. Please try again or contact support directly. (${err.message})`,
        "error"
      );
    }
  });

  return { open: openModal };
}

// ---- Main init ------------------------------------------------

export default function init(config) {
  // ---- Tech Support ----
  const techModal = buildTechModal();
  const tech = wireModal(techModal, "hub-techsupport", "tech", () => {
    const cat = document.getElementById("hub-techsupport-category").value;
    if (cat === "Tools") {
      return document.getElementById("hub-techsupport-tool").value;
    }
    return cat;
  });

  // Show/hide the tool sub-dropdown when "Tools" is selected
  document.getElementById("hub-techsupport-category").addEventListener("change", e => {
    const toolField = document.getElementById("hub-techsupport-tool-field");
    toolField.style.display = e.target.value === "Tools" ? "" : "none";
  });

  window.__hub_support = tech;

  // ---- IT Support ----
  const itModal = buildItModal();
  const it = wireModal(itModal, "hub-itsupport", "it", () => {
    return document.getElementById("hub-itsupport-category").value;
  });

  window.__hub_itsupport = it;
}
