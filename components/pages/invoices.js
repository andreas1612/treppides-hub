// ============================================================
// components/pages/invoices.js — Invoices
//
// Per-invoice paid/unpaid status, flagging anything still unpaid past a
// configurable age threshold. Paid/unpaid is reconstructed server-side from
// the eSoft debtor ledger — eSoft itself has no direct "paid" flag (audited
// 2026-08-24; see InvoiceRepository).
//
// Two view modes, mirroring Budget KPI:
//   'admin' (canViewAllInvoices — SUPER tier or the invoice-viewer allowlist)
//           — manager picker, can view anyone's invoices.
//   'self'  (everyone else with budget data) — own invoices only, no picker.
// Mounts into: #section-invoices
// ============================================================

import { escapeHtml } from "../../utils/dom.js?v=2";
import { TM_BASE, getCurrentUser } from "../../js/auth.js";

const SECTION_ID = "section-invoices";
const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

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
let viewMode = 'self'; // 'admin' (canViewAllInvoices) or 'self' (everyone else with budget data)

// ---- Init ---------------------------------------------------

export default async function init() {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  viewMode = getCurrentUser()?.canViewAllInvoices ? 'admin' : 'self';

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
        <button class="inv-csv-btn" id="inv-csv-btn" title="Download the current list as CSV">
          ${ICON_DOWNLOAD} Download CSV
        </button>
      </div>
      <div id="inv-summary-section"></div>
      <div id="inv-table-section"></div>
    </div>`;

  document.getElementById("inv-back-btn")?.addEventListener("click", hidePage);
  document.getElementById("inv-csv-btn")?.addEventListener("click", downloadCsv);

  document.getElementById("inv-year")?.addEventListener("change", (e) => {
    const yr = parseInt(e.target.value);
    if (!isNaN(yr)) { currentYear = yr; if (viewMode === 'self' || selectedCode) loadAndRender(); }
  });
  document.getElementById("inv-flag-days")?.addEventListener("input", (e) => {
    const d = parseInt(e.target.value);
    flagAfterDays = isNaN(d) ? 0 : Math.max(0, d);
    if (invoices.length) renderAll();
  });
  document.getElementById("inv-unpaid-only")?.addEventListener("change", (e) => {
    unpaidOnly = e.target.checked;
    if (viewMode === 'self' || selectedCode) loadAndRender();
  });

  if (viewMode === 'self') {
    // No picker for self view — one manager only (the caller).
    document.getElementById("inv-manager-select")?.remove();
    loadAndRender();
    return;
  }

  // Admin (SUPER): manager picker, same list Budget KPI uses.
  await loadManagers();
  document.getElementById("inv-manager-select")?.addEventListener("change", (e) => {
    selectedCode = e.target.value || null;
    if (selectedCode) {
      loadAndRender();
    } else {
      clearAll();
    }
  });
}

// ---- Load managers (admin only — reuses the Budget KPI picker) -

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
  if (viewMode === 'admin' && !selectedCode) return;
  setLoading();

  const params = new URLSearchParams({
    year: currentYear,
    flagAfterDays: flagAfterDays,
    unpaidOnly: unpaidOnly
  });

  const url = viewMode === 'self'
    ? `${TM_BASE}/api/reports/invoices/me?${params}`
    : `${TM_BASE}/api/reports/invoices/${encodeURIComponent(selectedCode)}?${params}`;

  try {
    const res = await fetch(url, {
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });
    if (res.status === 401) {
      sessionStorage.setItem("hub_pre_login_url", window.location.href);
      window.location.href = "/login.html";
      return;
    }
    if (res.status === 404) {
      // Self view, not a budget holder — same "not applicable" pattern as Budget KPI.
      showNotApplicable();
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

function showNotApplicable() {
  const summary = document.getElementById("inv-summary-section");
  if (summary) summary.innerHTML = `<div class="perf-exempt">The Invoices report isn't applicable to your role.</div>`;
  const table = document.getElementById("inv-table-section");
  if (table) table.innerHTML = "";
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
    section.innerHTML = `<p style="color:var(--text-secondary);font-size:12px;margin-top:16px">No invoices for ${viewMode === 'self' ? 'you' : 'this manager'} / this year${unpaidOnly ? " (unpaid only)" : ""}.</p>`;
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

// ---- CSV export -------------------------------------------------

function downloadCsv() {
  if (!invoices.length) return;

  const header = ["Invoice #", "Date", "Due", "Client", "Amount", "Age (days)", "Status", "Paid date", "Paid amount"];
  const rows = invoices.map(i => [
    i.docno,
    fmtDate(i.docDate),
    fmtDate(i.dueDate),
    i.accountName || "",
    i.amount.toFixed(2),
    i.ageDays,
    i.paid ? "PAID" : (i.flagged ? "UNPAID - FLAGGED" : "UNPAID"),
    i.paid ? fmtDate(i.paidDate) : "",
    i.paid && i.paidAmount != null ? i.paidAmount.toFixed(2) : "",
  ]);

  const csv = [header, ...rows]
    .map(row => row.map(csvEscape).join(","))
    .join("\r\n");

  const who = viewMode === "self" ? "me" : (selectedCode || "manager");
  const filename = `invoices_${who}_${currentYear}.csv`;

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---- Utility --------------------------------------------------

function fmt(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-GB");
}
