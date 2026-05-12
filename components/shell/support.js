// ============================================================
// components/support.js
// IT Support ticket modal — submits to the configured email
// via FormSubmit (https://formsubmit.co) with no backend needed.
//
// First-use note: FormSubmit will send a one-time confirmation
// email to SUPPORT_EMAIL. Click the link in that email once to
// activate the endpoint, then all submissions will be forwarded.
//
// Exposed: window.__hub_support.open()
// ============================================================

import CONFIG from "../../config.js";

// ---- Build modal DOM ------------------------------------------

function buildModal() {
  const el = document.createElement("div");
  el.id        = "hub-support-backdrop";
  el.className = "hub-backdrop hidden";
  el.innerHTML = `
    <div class="hub-modal" id="hub-support-modal" role="dialog"
         aria-modal="true" aria-labelledby="hub-support-title">

      <div class="hub-modal-header">
        <div>
          <h2 class="hub-modal-title" id="hub-support-title">IT Support Request</h2>
          <p class="hub-modal-sub">Fill in the form below — we'll get back to you shortly.</p>
        </div>
        <button class="hub-modal-close" id="hub-support-close" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6"  x2="6"  y2="18"/>
            <line x1="6"  y1="6"  x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Row: Name + Email -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="hub-field" style="margin-bottom:0">
          <label class="hub-label" for="hs-name">Your Name</label>
          <input class="hub-input" id="hs-name" type="text"
                 placeholder="e.g. Maria Loizou" autocomplete="name" />
        </div>
        <div class="hub-field" style="margin-bottom:0">
          <label class="hub-label" for="hs-email">Your Email</label>
          <input class="hub-input" id="hs-email" type="email"
                 placeholder="you@treppides.com" autocomplete="email" />
        </div>
      </div>

      <div class="hub-field" style="margin-top:14px;">
        <label class="hub-label" for="hs-category">Issue Category</label>
        <select class="hub-select" id="hs-category">
          <option value="IT Issue">IT Issue</option>
          <option value="Account / Access">Account / Access</option>
          <option value="Hardware">Hardware</option>
          <option value="Software">Software</option>
          <option value="Network / Connectivity">Network / Connectivity</option>
          <option value="Other">Other</option>
        </select>
      </div>

      <div class="hub-field">
        <label class="hub-label" for="hs-message">Description</label>
        <textarea class="hub-textarea" id="hs-message" rows="4"
          placeholder="Describe the issue in as much detail as possible…"></textarea>
      </div>

      <div class="hub-status" id="hub-support-status"></div>

      <div class="hub-modal-actions">
        <button class="hub-btn hub-btn-ghost" id="hub-support-cancel">Cancel</button>
        <button class="hub-btn hub-btn-primary" id="hub-support-submit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
          Submit Request
        </button>
      </div>

    </div>`;
  return el;
}

// ---- Main init ------------------------------------------------

export default function init(config) {
  const modal = buildModal();
  document.body.appendChild(modal);

  // ---- Open / close ----

  function openModal() {
    modal.classList.remove("hidden");
    // Reset to clean state
    document.getElementById("hs-name").value       = "";
    document.getElementById("hs-email").value      = "";
    document.getElementById("hs-category").value   = "IT Issue";
    document.getElementById("hs-message").value    = "";
    document.getElementById("hub-support-status").className   = "hub-status";
    document.getElementById("hub-support-status").textContent = "";
    setSubmitEnabled(true);
    setTimeout(() => document.getElementById("hs-name")?.focus(), 50);
  }

  function closeModal() {
    modal.classList.add("hidden");
  }

  document.getElementById("hub-support-close").addEventListener("click",  closeModal);
  document.getElementById("hub-support-cancel").addEventListener("click", closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
  });

  // ---- Submit ----

  document.getElementById("hub-support-submit").addEventListener("click", handleSubmit);

  function setSubmitEnabled(enabled) {
    const btn = document.getElementById("hub-support-submit");
    btn.disabled = !enabled;
    btn.innerHTML = enabled
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <line x1="22" y1="2" x2="11" y2="13"/>
           <polygon points="22 2 15 22 11 13 2 9 22 2"/>
         </svg> Submit Request`
      : `<span class="spinner"></span> Sending…`;
  }

  function showStatus(msg, type) {
    const el = document.getElementById("hub-support-status");
    el.textContent = msg;
    el.className   = `hub-status show ${type}`;
  }

  async function handleSubmit() {
    const name     = document.getElementById("hs-name").value.trim();
    const email    = document.getElementById("hs-email").value.trim();
    const category = document.getElementById("hs-category").value;
    const message  = document.getElementById("hs-message").value.trim();

    // Basic validation
    if (!name) {
      showStatus("Please enter your name.", "error");
      document.getElementById("hs-name").focus();
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showStatus("Please enter a valid email address.", "error");
      document.getElementById("hs-email").focus();
      return;
    }
    if (!message) {
      showStatus("Please describe the issue.", "error");
      document.getElementById("hs-message").focus();
      return;
    }

    setSubmitEnabled(false);
    document.getElementById("hub-support-status").className = "hub-status";

    try {
      // FormSubmit AJAX endpoint — posts JSON, returns { success: "true" }
      // First submission triggers a confirmation email to SUPPORT_EMAIL —
      // click the link once to activate, then all future submissions are forwarded.
      const res = await fetch(
        `https://formsubmit.co/ajax/${encodeURIComponent(config.SUPPORT_EMAIL)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept":        "application/json",
          },
          body: JSON.stringify({
            name,
            email,
            subject:  `[Hub IT Support] ${category} — ${name}`,
            message:  `Category: ${category}\n\n${message}`,
            // FormSubmit control fields (no-reply, no-captcha for internal use)
            _replyto:  email,
            _subject:  `[Hub IT Support] ${category} — ${name}`,
            _captcha:  "false",
          }),
        }
      );

      const json = await res.json().catch(() => ({}));

      if (res.ok && json.success === "true") {
        showStatus("Request submitted! IT Support will be in touch shortly.", "success");
        // Clear form fields, keep modal open to show the success message
        document.getElementById("hs-name").value    = "";
        document.getElementById("hs-email").value   = "";
        document.getElementById("hs-message").value = "";
        setSubmitEnabled(true);
      } else {
        throw new Error(json.message || `HTTP ${res.status}`);
      }

    } catch (err) {
      setSubmitEnabled(true);
      showStatus(
        `Could not send your request — please email techsupport@treppides.com directly. (${err.message})`,
        "error"
      );
    }
  }

  // Expose globally so sidebar + quicklinks can call open()
  window.__hub_support = { open: openModal };
}
