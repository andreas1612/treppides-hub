// ============================================================
// components/pages/invoices.js — Invoices (SUPER-only)
//
// Per-manager list of issued invoices with paid/unpaid status, flagging
// anything still unpaid past a configurable age threshold. Paid/unpaid is
// reconstructed server-side from the eSoft debtor ledger — eSoft itself has
// no direct "paid" flag (audited 2026-08-24; see InvoiceRepository).
// Mounts into: #section-invoices
// ============================================================

import { escapeHtml } from "../../utils/dom.js";
import { TM_BASE, getCurrentUser } from "../../js/auth.js";

const SECTION_ID = "section-invoices";

// ---- Page visibility ----------------------------------------

function showPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.add("invoices-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "invoices" } }));
}

function hidePage() {
  document.querySelector(".main")?.classList.remove("invoices-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_invoices = { show: showPage, hide: hidePage };

// ---- State --------------------------------------------------

let managers = [];
let selectedCode = null;
let currentYear = new Date().getFullYear();
let flagAfterDays = 30;
let unpaidOnly = false;
let invoices = [];

// ---- Init ---------------------------------------------------

export default async function init() {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  // SUPER-only feature — mirrors the backend gate. Section simply never
  // shows for anyone else (sidebar button is also hidden via the "invoices"
  // feature flag), but guard here too in case of direct navigation.
  if (getCurrentUser()?.tier !== "SUPER") return;

  section.innerHTML = `
    <div class="kpi-page">
      <div class="perf-header">
        <div class="perf-header-left">
          <button class="kpi-back-btn" id="inv-back-btn" title="Back to home">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div>
            <h2>Invoices</h2>
            <p id="inv-subtitle">Issued invoices — paid / unpaid status</p>
          </div>
        </div>
        <div class="kpi-controls">
          <select id="inv-manager-select" class="kpi-select">
            <option value="">Select manager...</option>
          </select>
        </div>
      </div>
      <div class="inv-filter-bar">
        <label>Year
          <input type="number" id="inv-year" value="${currentYear}" min="2020" max="2030" />
        </label>
        <label>Flag unpaid after (days)
          <input type="number" id="inv-flag-days" value="${flagAfterDays}" min="0" />
        </label>
        <label class="inv-checkbox-label">
          <input type="checkbox" id="inv-unpaid-only" />
          Unpaid only
        </label>
      </div>
      <div id="inv-summary-section"></div>
      <div id="inv-table-section"></div>
    </div>`;

  document.getElementById("inv-back-btn")?.addEventListener("click", hidePage);

  await loadManagers();

  document.getElementById("inv-manager-select")?.addEventListener("change", (e) => {
    selectedCode = e.target.value || null;
    if (selectedCode) {
      loadAndRender();
    } else {
      clearAll();
    }
  });

  document.getElementById("inv-year")?.addEventListener("change", (e) => {
    const yr = parseInt(e.target.value);
    if (!isNaN(yr)) { currentYear = yr; if (selectedCode) loadAndRender(); }
  });
  document.getElementById("inv-flag-days")?.addEventListener("input", (e) => {
    const d = parseInt(e.target.value);
    flagAfterDays = isNaN(d) ? 0 : Math.max(0, d);
    if (invoices.length) renderAll();
  });
  document.getElementById("inv-unpaid-only")?.addEventListener("change", (e) => {
    unpaidOnly = e.target.checked;
    if (selectedCode) loadAndRender();
  });
}

// ---- Load managers (reuses the same picker Budget KPI uses) -

async function loadManagers() {
  try {
    const res = await fetch(`${TM_BASE}/api/reports/invoices/managers?year=${currentYear}`, {
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });
    managers = res.ok ? await res.json() : [];
  } catch {
    managers = [];
  }

  const select = document.getElementById("inv-manager-select");
  if (!select) return;
  select.innerHTML = `<option value="">Select manager...</option>` +
    managers.map(m =>
      `<option value="${escapeHtml(m.invoice_code)}">${escapeHtml(m.manager_name)} (${escapeHtml(m.department || "")})</option>`
    ).join("");
}

// ---- Load & render --------------------------------------------

async function loadAndRender() {
  if (!selectedCode) return;
  setLoading();

  const params = new URLSearchParams({
    year: currentYear,
    flagAfterDays: flagAfterDays,
    unpaidOnly: unpaidOnly
  });

  try {
    const res = await fetch(`${TM_BASE}/api/reports/invoices/${encodeURIComponent(selectedCode)}?${params}`, {
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });
    if (res.status === 401) {
      sessionStorage.setItem("hub_pre_login_url", window.location.href);
      window.location.href = "/login.html";
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    invoices = await res.json();
  } catch (err) {
    setError(err.message);
    return;
  }

  renderAll();
}

function renderAll() {
  renderSummary();
  renderTable();
}

function clearAll() {
  invoices = [];
  document.getElementById("inv-summary-section").innerHTML = "";
  document.getElementById("inv-table-section").innerHTML = "";
}

// ---- Render: summary ------------------------------------------

function renderSummary() {
  const section = document.getElementById("inv-summary-section");
  if (!section) return;

  const total = invoices.length;
  const unpaidCount = invoices.filter(i => !i.paid).length;
  const flaggedCount = invoices.filter(i => i.flagged).length;
  const unpaidTotal = invoices.filter(i => !i.paid).reduce((s, i) => s + i.amount, 0);

  section.innerHTML = `
    <div class="kpi-summary-stats" style="margin-top:16px">
      <div class="kpi-stat">
        <span class="kpi-stat-label">Total invoices</span>
        <span class="kpi-stat-value">${total}</span>
      </div>
      <div class="kpi-stat">
        <span class="kpi-stat-label">Unpaid</span>
        <span class="kpi-stat-value">${unpaidCount}</span>
      </div>
      <div class="kpi-stat">
        <span class="kpi-stat-label">Flagged (&gt;${flagAfterDays}d)</span>
        <span class="kpi-stat-value" style="${flaggedCount > 0 ? 'color:#c62828' : ''}">${flaggedCount}</span>
      </div>
      <div class="kpi-stat">
        <span class="kpi-stat-label">Unpaid total</span>
        <span class="kpi-stat-value">&euro;${fmt(unpaidTotal)}</span>
      </div>
    </div>`;
}

// ---- Render: table ----------------------------------------------

function renderTable() {
  const section = document.getElementById("inv-table-section");
  if (!section) return;

  if (invoices.length === 0) {
    section.innerHTML = `<p style="color:var(--text-secondary);font-size:12px;margin-top:16px">No invoices for this manager / year${unpaidOnly ? " (unpaid only)" : ""}.</p>`;
    return;
  }

  const rows = invoices.map(i => {
    const badge = i.paid ? "GREEN" : (i.flagged ? "FLAGGED" : "RED");
    const badgeLabel = i.paid ? "PAID" : (i.flagged ? "UNPAID — FLAGGED" : "UNPAID");
    const rowClass = i.flagged ? "inv-row-flagged" : "";
    return `
      <tr class="${rowClass}">
        <td>${escapeHtml(i.docno)}</td>
        <td>${fmtDate(i.docDate)}</td>
        <td>${fmtDate(i.dueDate)}</td>
        <td>${escapeHtml(i.accountName || "")}</td>
        <td class="kpi-cell-num">&euro;${fmt(i.amount)}</td>
        <td class="kpi-cell-num">${i.paid ? i.ageDays + "d to settle" : i.ageDays + "d"}</td>
        <td class="kpi-cell-center"><span class="kpi-badge-sm ${badge}">${badgeLabel}</span></td>
      </tr>`;
  }).join("");

  section.innerHTML = `
    <div class="kpi-section-title" style="margin-top:16px">Invoices</div>
    <div class="kpi-table-wrap">
      <table class="kpi-table">
        <thead>
          <tr>
            <th>Invoice #</th><th>Date</th><th>Due</th><th>Client</th>
            <th class="kpi-th-num">Amount</th><th class="kpi-th-num">Age</th><th class="kpi-th-center">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ---- State helpers ------------------------------------------

function setLoading() {
  const el = document.getElementById("inv-summary-section");
  if (el) el.innerHTML = `<div class="perf-loading"><div class="spinner"></div>Loading invoices...</div>`;
  const t = document.getElementById("inv-table-section");
  if (t) t.innerHTML = "";
}

function setError(msg) {
  const el = document.getElementById("inv-summary-section");
  if (el) el.innerHTML = `<div class="perf-error">Could not load invoices.<br><small>${escapeHtml(msg)}</small></div>`;
}

// ---- Utility --------------------------------------------------

function fmt(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-GB");
}
