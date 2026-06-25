// ============================================================
// components/pages/forms.js — Forms tool.
// A card-grid landing (AML-style): pick a form (Lead / Deal / future)
// → that form renders. On submit, the backend creates a real ClickUp
// task in the matching list.
//
// Schema-driven: the field layout comes from the backend
// (/api/clickup/forms/{key}/schema) so field IDs/options never live
// in the frontend. This page just renders the schema and posts values.
//
// Mounts into: #section-forms
// ============================================================

import { escapeHtml } from "../../utils/dom.js";

const SECTION_ID  = "section-forms";
const BACK_BTN_ID = "forms-back-btn";

const API_BASE = "/api/clickup/forms";

// Cache schemas/members/statuses per form key.
const _cache = {};   // { key: { schema, members, statuses } }

// Card presentation per form key (icon + blurb for the landing grid).
// Any form key returned by the backend that isn't listed here falls back
// to a generic card, so adding a new form server-side needs no change here.
const FORM_CARDS = {
  lead: {
    iconClass: "lead",
    desc: "Add a new lead into the CRM — company, contact, source and status.",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
             <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
             <circle cx="9" cy="7" r="4"/>
             <line x1="19" y1="8" x2="19" y2="14"/>
             <line x1="22" y1="11" x2="16" y2="11"/>
           </svg>`,
  },
  deal: {
    iconClass: "deal",
    desc: "Add a deal straight into the deal cycle — value, service, dates and status.",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
             <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
             <polyline points="14 2 14 8 20 8"/>
             <line x1="8" y1="13" x2="16" y2="13"/>
             <line x1="8" y1="17" x2="13" y2="17"/>
           </svg>`,
  },
};

const FALLBACK_CARD = {
  iconClass: "lead",
  desc: "Open this form.",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
           <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
           <polyline points="14 2 14 8 20 8"/>
         </svg>`,
};

const ARROW_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                     <line x1="5" y1="12" x2="19" y2="12"/>
                     <polyline points="12 5 19 12 12 19"/>
                   </svg>`;

// ---- Page visibility ----------------------------------------

function showFormsPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove("fees-active", "aml-active", "staff-active", "kb-active");
  main.classList.add("forms-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "forms" } }));
}

function hideFormsPage() {
  document.querySelector(".main")?.classList.remove("forms-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_forms = { show: showFormsPage, hide: hideFormsPage };

// ---- Data loading --------------------------------------------

async function loadForm(key) {
  if (_cache[key]) return _cache[key];

  const [schemaRes, membersRes, statusesRes] = await Promise.all([
    fetch(`${API_BASE}/${key}/schema`),
    fetch(`${API_BASE}/${key}/members`),
    fetch(`${API_BASE}/${key}/statuses`),
  ]);
  if (!schemaRes.ok) throw new Error(`schema ${schemaRes.status}`);

  const schema   = await schemaRes.json();
  const members  = membersRes.ok  ? (await membersRes.json()).members   : [];
  const statuses = statusesRes.ok ? (await statusesRes.json()).statuses : [];

  _cache[key] = { schema, members, statuses };
  return _cache[key];
}

// ---- Field rendering -----------------------------------------

function fieldId(key) { return `forms-f-${key}`; }

function renderField(field, ctx) {
  const id  = fieldId(field.key);
  const req = field.required ? `<span class="forms-req">*</span>` : "";
  const ph  = field.placeholder ? escapeHtml(field.placeholder) : "";
  let control = "";

  switch (field.type) {
    case "text":
    case "email":
    case "phone": {
      const inputType = field.type === "email" ? "email"
                      : field.type === "phone" ? "tel" : "text";
      control = `<input class="forms-input" id="${id}" type="${inputType}"
                        data-key="${field.key}" placeholder="${ph}" />`;
      break;
    }
    case "textarea":
      control = `<textarea class="forms-input forms-textarea" id="${id}"
                          data-key="${field.key}" placeholder="${ph}" rows="3"></textarea>`;
      break;
    case "currency":
      control = `<div class="forms-currency">
                   <span class="forms-currency-sym">€</span>
                   <input class="forms-input" id="${id}" type="number" step="0.01" min="0"
                          data-key="${field.key}" placeholder="${ph || "0.00"}" />
                 </div>`;
      break;
    case "date":
      control = `<input class="forms-input" id="${id}" type="date" data-key="${field.key}" />`;
      break;
    case "drop_down": {
      const opts = (field.options || []).map(o =>
        `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}</option>`).join("");
      control = `<select class="forms-input forms-select" id="${id}" data-key="${field.key}">
                   <option value="">Select option…</option>${opts}
                 </select>`;
      break;
    }
    case "status": {
      const opts = (ctx.statuses || []).map(s =>
        `<option value="${escapeHtml(s.status)}">${escapeHtml(s.status)}</option>`).join("");
      control = `<select class="forms-input forms-select" id="${id}" data-key="${field.key}">
                   <option value="">Select option…</option>${opts}
                 </select>`;
      break;
    }
    case "assignee": {
      const opts = (ctx.members || []).map(m =>
        `<option value="${escapeHtml(m.id)}">${escapeHtml(m.username || m.email || m.id)}</option>`).join("");
      control = `<select class="forms-input forms-select" id="${id}" data-key="${field.key}">
                   <option value="">Select assignee…</option>${opts}
                 </select>`;
      break;
    }
    case "labels": {
      // Multi-select chip list: a hidden value store + clickable chips.
      const chips = (field.options || []).map(o =>
        `<button type="button" class="forms-chip" data-opt="${escapeHtml(o.id)}">
           ${escapeHtml(o.name)}</button>`).join("");
      control = `<div class="forms-chips" id="${id}" data-key="${field.key}"
                      data-type="labels" role="group">${chips}</div>`;
      break;
    }
    case "attachment":
      control = `<label class="forms-drop" for="${id}">
                   <input class="forms-file" id="${id}" type="file" data-key="${field.key}" />
                   <span class="forms-drop-text">Drop your file here or click to upload</span>
                   <span class="forms-drop-name" data-name></span>
                 </label>`;
      break;
    default:
      control = `<input class="forms-input" id="${id}" type="text" data-key="${field.key}" />`;
  }

  return `
    <div class="forms-field" data-field="${field.key}">
      <label class="forms-label" for="${id}">${escapeHtml(field.label)}${req}</label>
      ${control}
      <span class="forms-error" data-error></span>
    </div>`;
}

function renderStatusInfo(items) {
  if (!items || !items.length) return "";
  const cards = items.map(it => `
    <div class="forms-status-card forms-status-${it.color}">
      <span class="forms-status-badge forms-status-badge-${it.color}">${escapeHtml(it.label)}</span>
      <p class="forms-status-text">${escapeHtml(it.text)}</p>
    </div>`).join("");
  return `<div class="forms-status-info">${cards}</div>`;
}

function renderSection(section, ctx) {
  const fieldsHtml = (section.fields || []).map(f => renderField(f, ctx)).join("");
  const header = section.heading
    ? `<div class="forms-section-head forms-section-${section.color || "neutral"}">
         ${escapeHtml(section.heading)}</div>`
    : "";
  const info = section.info ? renderStatusInfo(ctx.schema.status_info) : "";
  // Info-only sections render just the header + the status cards.
  const body = section.info ? info
    : (fieldsHtml ? `<div class="forms-grid">${fieldsHtml}</div>` : "");
  return `<section class="forms-section">${header}${body}</section>`;
}

function renderForm(ctx) {
  const { schema } = ctx;
  const sub = schema.subtitle
    ? `<p class="forms-intro">${escapeHtml(schema.subtitle)}</p>` : "";
  const sections = schema.sections.map(s => renderSection(s, ctx)).join("");
  return `
    ${sub}
    <form class="forms-form" id="forms-form" novalidate>
      ${sections}
      <div class="forms-actions">
        <button type="submit" class="forms-submit">Submit</button>
      </div>
      <div class="forms-result" id="forms-result" hidden></div>
    </form>`;
}

// ---- Value collection + validation ---------------------------

function collectValues(formEl) {
  const values = {};
  let file = null;

  formEl.querySelectorAll("[data-key]").forEach(el => {
    const key = el.dataset.key;
    if (el.dataset.type === "labels") {
      const picked = [...el.querySelectorAll(".forms-chip.selected")]
        .map(c => c.dataset.opt);
      values[key] = picked;
    } else if (el.type === "file") {
      if (el.files && el.files[0]) file = { key, file: el.files[0] };
    } else {
      values[key] = el.value;
    }
  });
  return { values, file };
}

function clearErrors(formEl) {
  formEl.querySelectorAll(".forms-field.invalid").forEach(f => f.classList.remove("invalid"));
  formEl.querySelectorAll("[data-error]").forEach(e => { e.textContent = ""; });
}

function markError(formEl, key, msg) {
  const field = formEl.querySelector(`.forms-field[data-field="${key}"]`);
  if (!field) return;
  field.classList.add("invalid");
  const err = field.querySelector("[data-error]");
  if (err) err.textContent = msg;
}

/** Client-side required/format check. Returns the first-invalid key, or null. */
function validate(formEl, ctx, values, file) {
  clearErrors(formEl);
  let firstBad = null;

  for (const field of allFields(ctx.schema)) {
    const v = field.type === "attachment" ? (file ? file.file : null) : values[field.key];
    const empty = v === null || v === undefined || v === "" ||
                  (Array.isArray(v) && v.length === 0);

    if (field.required && empty) {
      markError(formEl, field.key, `${field.label} is required.`);
      firstBad = firstBad || field.key;
      continue;
    }
    if (!empty && field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) {
      markError(formEl, field.key, "Enter a valid email address.");
      firstBad = firstBad || field.key;
    }
    if (!empty && field.type === "phone") {
      // ClickUp requires international (E.164) format. Normalize then check shape.
      const cleaned = String(v).replace(/[\s().\-]/g, "");
      if (!/^\+[1-9]\d{6,14}$/.test(cleaned)) {
        markError(formEl, field.key,
          "Use international format, e.g. +35799123456 (with country code).");
        firstBad = firstBad || field.key;
      }
    }
  }
  return firstBad;
}

function allFields(schema) {
  return schema.sections.flatMap(s => s.fields || []);
}

// ---- Submit --------------------------------------------------

async function onSubmit(formEl, ctx, resultEl) {
  const { values, file } = collectValues(formEl);
  const bad = validate(formEl, ctx, values, file);
  if (bad) {
    const el = formEl.querySelector(`.forms-field[data-field="${bad}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const btn = formEl.querySelector(".forms-submit");
  btn.disabled = true;
  btn.textContent = "Submitting…";
  resultEl.hidden = true;

  try {
    const fd = new FormData();
    fd.append("payload", JSON.stringify(values));
    if (file) fd.append("file", file.file, file.file.name);

    const res = await fetch(`${API_BASE}/${ctx.schema.key}/submit`, {
      method: "POST",
      body: fd,
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.detail || "Submission failed. Please try again.");
    }

    let msg = `${ctx.schema.title} submitted successfully.`;
    if (data.warning) msg += ` ${data.warning}`;
    showResult(resultEl, data.warning ? "warn" : "ok", msg, data.url);
    formEl.reset();
    formEl.querySelectorAll(".forms-chip.selected").forEach(c => c.classList.remove("selected"));
    formEl.querySelectorAll("[data-name]").forEach(n => { n.textContent = ""; });
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    showResult(resultEl, "error", err.message || "Submission failed. Please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit";
  }
}

function showResult(el, kind, msg, url) {
  const link = url
    ? ` <a href="${escapeHtml(url)}" target="_blank" rel="noopener">View in ClickUp →</a>` : "";
  el.className = `forms-result forms-result-${kind}`;
  el.innerHTML = `${escapeHtml(msg)}${link}`;
  el.hidden = false;
}

// ---- Wiring (per-render) -------------------------------------

function wireForm(formEl, ctx) {
  const resultEl = formEl.querySelector("#forms-result");

  // Label chips toggle
  formEl.querySelectorAll(".forms-chip").forEach(chip => {
    chip.addEventListener("click", () => chip.classList.toggle("selected"));
  });

  // File name echo
  formEl.querySelectorAll(".forms-file").forEach(input => {
    input.addEventListener("change", () => {
      const nameEl = input.closest(".forms-drop")?.querySelector("[data-name]");
      if (nameEl) nameEl.textContent = input.files?.[0]?.name || "";
    });
  });

  formEl.addEventListener("submit", e => {
    e.preventDefault();
    onSubmit(formEl, ctx, resultEl);
  });
}

// ---- View: landing card grid ---------------------------------

const BACK_TO_HUB_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="19" y1="12" x2="5" y2="12"/>
    <polyline points="12 19 5 12 12 5"/>
  </svg>`;

function renderLanding(forms) {
  const cards = forms.map(f => {
    const meta = FORM_CARDS[f.key] || FALLBACK_CARD;
    return `
      <button class="forms-card" data-form="${escapeHtml(f.key)}" aria-label="Open ${escapeHtml(f.title)} form">
        <span class="forms-card-icon ${meta.iconClass}">${meta.icon}</span>
        <h3 class="forms-card-title">${escapeHtml(f.title)} Form</h3>
        <p class="forms-card-desc">${escapeHtml(meta.desc)}</p>
        <span class="forms-card-cta">Open form ${ARROW_SVG}</span>
      </button>`;
  }).join("");

  return `
    <div class="hub-section">
      <div class="section-header">
        <div class="forms-header-left">
          <button class="forms-back-btn" id="${BACK_BTN_ID}" aria-label="Back to Tools">
            ${BACK_TO_HUB_SVG}
          </button>
          <div>
            <h2 class="section-title">Forms</h2>
            <p class="section-subtitle">Pick a form to submit straight into ClickUp</p>
          </div>
        </div>
      </div>
      <div class="forms-cards">${cards}</div>
    </div>`;
}

function showLanding(section) {
  section.innerHTML = renderLanding(_availableForms);

  section.querySelector(`#${BACK_BTN_ID}`)?.addEventListener("click", () => {
    hideFormsPage();
    window.__hub_projects?.show();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  section.querySelectorAll(".forms-card").forEach(card => {
    card.addEventListener("click", () => showFormView(section, card.dataset.form));
  });
}

// ---- View: a single form -------------------------------------

async function showFormView(section, key) {
  section.innerHTML = `
    <div class="hub-section">
      <div class="section-header">
        <div class="forms-header-left">
          <button class="forms-back-btn" id="${BACK_BTN_ID}" aria-label="Back to Forms">
            ${BACK_TO_HUB_SVG}
          </button>
          <div>
            <h2 class="section-title" id="forms-view-title">Form</h2>
            <p class="section-subtitle">Fields submit directly to ClickUp</p>
          </div>
        </div>
      </div>
      <div class="forms-body" id="forms-body">
        <div class="forms-loading">Loading form…</div>
      </div>
    </div>`;

  // Back returns to the card grid (not the hub).
  section.querySelector(`#${BACK_BTN_ID}`)?.addEventListener("click", () => {
    showLanding(section);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  const body = document.getElementById("forms-body");
  try {
    const ctx = await loadForm(key);
    document.getElementById("forms-view-title").textContent = `${ctx.schema.title} Form`;
    body.innerHTML = renderForm(ctx);
    wireForm(document.getElementById("forms-form"), ctx);
  } catch (err) {
    body.innerHTML = `<div class="forms-result forms-result-error">
        Could not load this form. It may not be configured on the server yet.
      </div>`;
  }
}

// ---- Component init ------------------------------------------

let _availableForms = [];

export default async function init(_config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  // Discover which forms the backend exposes (skips unconfigured ones).
  try {
    const res = await fetch(API_BASE);
    _availableForms = res.ok ? (await res.json()).forms : [];
  } catch {
    _availableForms = [];
  }
  // Fallback so the grid still renders if discovery fails.
  if (!_availableForms.length) {
    _availableForms = [{ key: "lead", title: "Lead" }, { key: "deal", title: "Deal" }];
  }

  showLanding(section);
}
