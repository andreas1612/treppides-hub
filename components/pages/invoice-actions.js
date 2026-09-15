// ============================================================
// components/pages/invoice-actions.js — Invoice Reason / Action
//
// A manager's own invoices unpaid 80+ days that need a Reason and an Action
// recorded. Any manager can open this (the backend scopes the list to the
// caller — their own EL book plus any departed leader's book they inherited).
// The 80-day reminder email deep-links here. Editing saves per invoice to the
// Task Manager (invoice_reason_action table).
// Mounts into: #section-invoiceactions
// ============================================================

import { escapeHtml } from "../../utils/dom.js?v=2";
import { TM_BASE } from "../../js/auth.js";

const SECTION_ID = "section-invoiceactions";

// ---- Page visibility ----------------------------------------

function showPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.add("invoiceactions-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "invoiceactions" } }));
  load(); // refresh each time the page is opened
}

function hidePage() {
  document.querySelector(".main")?.classList.remove("invoiceactions-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_invoiceactions = { show: showPage, hide: hidePage };

// ---- State --------------------------------------------------

let items = [];

// ---- Init ---------------------------------------------------

export default async function init() {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  section.innerHTML = `
    <div class="kpi-page">
      <div class="perf-header">
        <div class="perf-header-left">
          <button class="kpi-back-btn" id="ia-back-btn" title="Back to home">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div>
            <h2>Invoice Reason / Action</h2>
            <p id="ia-subtitle">Your invoices unpaid 80+ days — record a reason and an action for each</p>
          </div>
        </div>
      </div>
      <div id="ia-body"><p class="ia-empty">Loading…</p></div>
    </div>`;

  document.getElementById("ia-back-btn")?.addEventListener("click", () => {
    window.history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

// ---- Data ---------------------------------------------------

async function load() {
  const body = document.getElementById("ia-body");
  if (!body) return;
  body.innerHTML = `<p class="ia-empty">Loading…</p>`;
  try {
    const res = await fetch(`${TM_BASE}/api/reports/invoices/action-needed`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    items = await res.json();
  } catch (e) {
    body.innerHTML = `<p class="ia-empty">Could not load your invoices (${escapeHtml(String(e.message || e))}).</p>`;
    return;
  }
  render();
}

// ---- Render -------------------------------------------------

function isComplete(i) {
  return (i.reason && i.reason.trim()) && (i.action && i.action.trim());
}

function render() {
  const body = document.getElementById("ia-body");
  if (!body) return;

  if (!items.length) {
    body.innerHTML = `<p class="ia-empty">You have no invoices unpaid 80+ days that need a reason or action right now. Nothing to do here — thank you.</p>`;
    return;
  }

  const outstanding = items.filter(i => !isComplete(i)).length;
  const cards = items.map(cardHtml).join("");
  body.innerHTML = `
    <p class="ia-count">${items.length} invoice${items.length !== 1 ? "s" : ""} 80+ days unpaid${outstanding ? ` &middot; <strong>${outstanding} still need${outstanding === 1 ? "s" : ""} a reason &amp; action</strong>` : " &middot; all completed"}</p>
    ${cards}`;

  items.forEach(i => {
    document.getElementById(`ia-save-${cssId(i.docno)}`)
      ?.addEventListener("click", () => save(i.docno));
  });
}

function cardHtml(i) {
  const id = cssId(i.docno);
  const done = isComplete(i);
  const orig = i.nextResponsibleName
    ? `<span class="ia-orig">Originally assigned to ${escapeHtml(i.managerName || "—")}</span>` : "";
  return `
    <div class="ia-card ${done ? "ia-done" : "ia-todo"}" id="ia-card-${id}">
      <div class="ia-card-head">
        <div>
          <span class="ia-docno">${escapeHtml(i.docno)}</span>
          <span class="ia-client">${escapeHtml(i.accountName || "(no client)")}</span>
          ${orig}
        </div>
        <div class="ia-meta">
          <span class="ia-amount">&euro;${fmt(i.amount)}</span>
          <span class="ia-age">${i.ageDays} days unpaid</span>
          <span class="ia-badge ${done ? "ia-badge-done" : "ia-badge-todo"}">${done ? "Completed" : "Needs action"}</span>
        </div>
      </div>
      <div class="ia-fields">
        <label>Reason it is still unpaid
          <textarea id="ia-reason-${id}" rows="2" maxlength="2000" placeholder="e.g. Client disputes scope; awaiting sign-off">${escapeHtml(i.reason || "")}</textarea>
        </label>
        <label>Action being taken
          <textarea id="ia-action-${id}" rows="2" maxlength="2000" placeholder="e.g. Follow-up call scheduled 20/09; revised invoice to be issued">${escapeHtml(i.action || "")}</textarea>
        </label>
      </div>
      <div class="ia-card-foot">
        <span class="ia-status" id="ia-status-${id}"></span>
        <button class="kpi-btn ia-save-btn" id="ia-save-${id}">Save</button>
      </div>
    </div>`;
}

async function save(docno) {
  const id = cssId(docno);
  const reason = document.getElementById(`ia-reason-${id}`)?.value ?? "";
  const action = document.getElementById(`ia-action-${id}`)?.value ?? "";
  const statusEl = document.getElementById(`ia-status-${id}`);
  const btn = document.getElementById(`ia-save-${id}`);
  if (btn) btn.disabled = true;
  if (statusEl) { statusEl.textContent = "Saving…"; statusEl.className = "ia-status"; }
  try {
    const res = await fetch(`${TM_BASE}/api/reports/invoices/action-needed/${encodeURIComponent(docno)}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, action }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Update local state + card chrome.
    const it = items.find(x => x.docno === docno);
    if (it) { it.reason = reason; it.action = action; }
    const done = (reason.trim() && action.trim());
    const card = document.getElementById(`ia-card-${id}`);
    if (card) { card.classList.toggle("ia-done", !!done); card.classList.toggle("ia-todo", !done); }
    const badge = card?.querySelector(".ia-badge");
    if (badge) {
      badge.textContent = done ? "Completed" : "Needs action";
      badge.className = `ia-badge ${done ? "ia-badge-done" : "ia-badge-todo"}`;
    }
    if (statusEl) { statusEl.textContent = done ? "Saved ✓" : "Saved — fill both fields to complete"; statusEl.className = "ia-status ia-status-ok"; }
    // Refresh the header count.
    const cnt = document.querySelector(".ia-count");
    const outstanding = items.filter(x => !isComplete(x)).length;
    if (cnt) cnt.innerHTML = `${items.length} invoice${items.length !== 1 ? "s" : ""} 80+ days unpaid${outstanding ? ` &middot; <strong>${outstanding} still need${outstanding === 1 ? "s" : ""} a reason &amp; action</strong>` : " &middot; all completed"}`;
  } catch (e) {
    if (statusEl) { statusEl.textContent = `Could not save (${String(e.message || e)})`; statusEl.className = "ia-status ia-status-err"; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---- helpers ------------------------------------------------

function cssId(docno) { return String(docno).replace(/[^A-Za-z0-9]/g, "_"); }
function fmt(n) { return (n ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
