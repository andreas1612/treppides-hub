// ============================================================
// components/pages/budget-kpi.js — Budget KPI Report (SPA component)
//
// Admin-only: manager dropdown → budget vs invoiced card + monthly table.
// Period bar with month buttons per year (2026→current) + YTD, matching
// the Flask tester design at :9092.
// Mounts into: #section-budgetkpi
// ============================================================

import { escapeHtml } from "../../utils/dom.js?v=2";
import { TM_BASE, getCurrentUser } from "../../js/auth.js";

const SECTION_ID = "section-budgetkpi";
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ---- Page visibility ----------------------------------------

function showPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.add("budgetkpi-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "budgetkpi" } }));
}

function hidePage() {
  document.querySelector(".main")?.classList.remove("budgetkpi-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_budgetkpi = { show: showPage, hide: hidePage };

// ---- State --------------------------------------------------

let managers = [];
let selectedCode = null;
let currentPeriod = 'ytd';   // 'month' or 'ytd'
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;
let cachedData = null;
let cachedYear = null;
let selectedInvoiceCode = null;
let selectedManagerName = null;
let expandedMonth = null;       // month number whose detail row is open
let invoiceDetailCache = {};    // { year: [ ...rows ] }
// View modes: 'admin' (FULL/SUPER), 'supervisor' (SUPERVISOR), 'self' (STANDARD).
let viewMode = 'self';
let feeManagers = [];       // manager list for supervisor fee panel (from /fee-managers)
let feeViewCode = null;     // which manager's fees the supervisor is currently viewing

// ---- Init ---------------------------------------------------

export default async function init() {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  section.innerHTML = `
    <div class="kpi-page">
      <div class="perf-header">
        <div class="perf-header-left">
          <button class="kpi-back-btn" id="kpi-back-btn" title="Back to home">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div>
            <h2>Budget KPI</h2>
            <p id="kpi-subtitle">Budget vs Invoiced — ${currentYear} YTD</p>
          </div>
        </div>
        <div class="kpi-controls">
          <select id="kpi-manager-select" class="kpi-select">
            <option value="">Select manager...</option>
          </select>
        </div>
      </div>
      <div id="kpi-period-bar" class="kpi-period-bar"></div>
      <div id="kpi-summary-section"></div>
      <div id="kpi-table-section"></div>
      <div id="kpi-fee-section"></div>
    </div>`;

  document.getElementById("kpi-back-btn")?.addEventListener("click", hidePage);

  buildPeriodBar();

  // Resolve view mode. Anyone with read-across (FULL/SUPER, plus the HR team via
  // the backend canViewAllReports flag) gets the admin "view anyone" view.
  const tier = getCurrentUser()?.tier;
  if (getCurrentUser()?.canViewAllReports) {
    viewMode = 'admin';
  } else if (tier === 'SUPERVISOR') {
    viewMode = 'supervisor';
  } else {
    viewMode = 'self';
  }

  if (viewMode === 'self') {
    document.getElementById("kpi-manager-select")?.remove();
    loadSelf();
    return;
  }

  if (viewMode === 'supervisor') {
    document.getElementById("kpi-manager-select")?.remove();
    await loadSelfWithDrill();
    return;
  }

  await loadManagers();

  document.getElementById("kpi-manager-select")?.addEventListener("change", (e) => {
    selectedCode = e.target.value || null;
    cachedData = null;
    cachedYear = null;
    expandedMonth = null;
    invoiceDetailCache = {};
    if (selectedCode) {
      loadAndRender();
    } else {
      document.getElementById("kpi-summary-section").innerHTML = "";
      document.getElementById("kpi-table-section").innerHTML = "";
    }
  });
}

// ---- Self view (STANDARD tier) ------------------------------

async function loadSelf() {
  const me = getCurrentUser();
  // No budget data flagged on /api/me → not a budget-holder.
  if (me && me.hasBudgetData === false) { showNotApplicable(); return; }

  setSummaryLoading();
  clearTable();

  let data;
  try {
    data = await apiFetch(`/api/reports/budget-kpi/me?year=${currentYear}`);
  } catch (err) {
    const msg = err.message || "";
    if (msg.includes("No budget") || msg === "NOT_FOUND" || msg === "FORBIDDEN") {
      showNotApplicable();
    } else {
      setSummaryError(msg);
    }
    return;
  }

  cachedData = data;
  cachedYear = currentYear;
  selectedInvoiceCode = data.invoiceCode;
  selectedManagerName = data.managerName;
  renderFromCache();
  // Self view is read-only: no invoice drill-down, no fee-adjustment tools.
}

// ---- Supervisor view (self budget + drill + fee panel) ------

async function loadSelfWithDrill() {
  const me = getCurrentUser();
  if (me && me.hasBudgetData === false) {
    showNotApplicable();
    await loadSupervisorFees();
    return;
  }

  setSummaryLoading();
  clearTable();

  let data;
  try {
    data = await apiFetch(`/api/reports/budget-kpi/me?year=${currentYear}`);
  } catch (err) {
    const msg = err.message || "";
    if (msg.includes("No budget") || msg === "NOT_FOUND" || msg === "FORBIDDEN") {
      showNotApplicable();
    } else {
      setSummaryError(msg);
    }
    await loadSupervisorFees();
    return;
  }

  cachedData = data;
  cachedYear = currentYear;
  selectedInvoiceCode = data.invoiceCode;
  selectedManagerName = data.managerName;
  renderFromCache();
  await loadSupervisorFees();
}

async function loadSupervisorFees() {
  try {
    feeManagers = await apiFetch(`/api/reports/budget-kpi/fee-managers?year=${currentYear}`);
  } catch { feeManagers = []; }

  feeViewCode = selectedInvoiceCode || (feeManagers.length > 0 ? feeManagers[0].invoice_code : null);
  if (!feeViewCode) return;

  let entries = [];
  try {
    entries = await apiFetch(`/api/reports/budget-kpi/fee-adjustments/${feeViewCode}?year=${currentYear}`);
  } catch { /* InvoiceAllocation DB may be unavailable */ }

  renderFeePanel(entries, feeManagers, feeViewCode);
}

function showNotApplicable() {
  const summary = document.getElementById("kpi-summary-section");
  if (summary) summary.innerHTML = `<div class="perf-exempt">The Budget KPI report isn't applicable to your role.</div>`;
  clearTable();
  const fee = document.getElementById("kpi-fee-section");
  if (fee) fee.innerHTML = "";
}

// ---- Period bar (matches Flask tester) -----------------------

function buildPeriodBar() {
  const bar = document.getElementById("kpi-period-bar");
  if (!bar) return;

  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  let html = '';

  for (let yr = 2026; yr <= thisYear; yr++) {   // 2025 intentionally excluded — data starts Jan 2026 (matches live)
    const maxMo = yr === thisYear ? thisMonth : 12;
    html += `<span class="year-label">${yr}</span>`;
    for (let mo = 1; mo <= maxMo; mo++) {
      const isActive = currentPeriod === 'month' && currentYear === yr && currentMonth === mo;
      html += `<button class="${isActive ? 'active' : ''}" data-yr="${yr}" data-mo="${mo}">${MONTH_NAMES[mo - 1]}</button>`;
    }
    const ytdActive = currentPeriod === 'ytd' && currentYear === yr;
    html += `<button class="ytd-btn ${ytdActive ? 'active' : ''}" data-yr="${yr}" data-mo="ytd">YTD</button>`;
    if (yr < thisYear) html += `<span class="spacer"></span>`;
  }
  bar.innerHTML = html;

  bar.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const yr = parseInt(btn.dataset.yr);
      const yearChanged = yr !== currentYear;

      if (btn.dataset.mo === 'ytd') {
        currentPeriod = 'ytd';
        currentYear = yr;
      } else {
        currentPeriod = 'month';
        currentYear = yr;
        currentMonth = parseInt(btn.dataset.mo);
      }

      buildPeriodBar();
      updateSubtitle();

      if (viewMode === 'self') {
        if (yearChanged) {
          cachedData = null; cachedYear = null; expandedMonth = null; invoiceDetailCache = {};
          loadSelf();
        } else if (cachedData) { renderFromCache(); }
        return;
      }

      if (viewMode === 'supervisor') {
        if (yearChanged) {
          cachedData = null; cachedYear = null; expandedMonth = null; invoiceDetailCache = {};
          loadSelfWithDrill();
        } else if (cachedData) { renderFromCache(); }
        return;
      }

      if (!selectedCode) return;

      if (yearChanged) {
        cachedData = null;
        cachedYear = null;
        expandedMonth = null;
        invoiceDetailCache = {};
        loadManagers().then(() => { if (selectedCode) loadAndRender(); });
      } else if (cachedData) {
        renderFromCache();
      }
    });
  });
}

function updateSubtitle() {
  const el = document.getElementById("kpi-subtitle");
  if (!el) return;
  el.textContent = currentPeriod === 'ytd'
    ? `Budget vs Invoiced — ${currentYear} YTD`
    : `Budget vs Invoiced — ${MONTH_NAMES[currentMonth - 1]} ${currentYear}`;
}

// ---- Load managers ------------------------------------------

async function loadManagers() {
  try {
    const res = await fetch(`${TM_BASE}/api/reports/budget-kpi/managers?year=${currentYear}`, {
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });
    if (res.ok) {
      managers = await res.json();
    } else {
      managers = [];
    }
  } catch {
    managers = [];
  }

  const select = document.getElementById("kpi-manager-select");
  if (!select) return;

  const prevCode = selectedCode;
  select.innerHTML = `<option value="">Select manager...</option>` +
    managers.map(m =>
      `<option value="${escapeHtml(m.invoice_code)}">${escapeHtml(m.manager_name)} (${escapeHtml(m.department || "")})</option>`
    ).join("");

  if (prevCode && managers.some(m => m.invoice_code === prevCode)) {
    select.value = prevCode;
    selectedCode = prevCode;
  } else if (prevCode) {
    selectedCode = null;
  }
}

// ---- Load & render ------------------------------------------

async function loadAndRender() {
  if (!selectedCode) return;

  if (cachedData && cachedYear === currentYear) {
    renderFromCache();
    return;
  }

  setSummaryLoading();
  clearTable();

  let data;
  try {
    data = await apiFetch(`/api/reports/budget-kpi/${selectedCode}?year=${currentYear}`);
  } catch (err) {
    setSummaryError(err.message);
    return;
  }

  cachedData = data;
  cachedYear = currentYear;
  selectedInvoiceCode = data.invoiceCode;
  selectedManagerName = data.managerName;
  renderFromCache();
  // Fee-adjustment CRUD is limited to fee managers (SUPERVISOR/FULL/SUPER). HR
  // read-across users (STANDARD tier via canViewAllReports) get the budget view
  // without the fee editor — matches the backend requireFeeAccess gate.
  if (['SUPERVISOR', 'FULL', 'SUPER'].includes(getCurrentUser()?.tier)) {
    loadFeeEntries();
  }
}

function renderFromCache() {
  if (!cachedData) return;

  const upTo = currentPeriod === 'ytd' ? 12 : currentMonth;
  const filtered = (cachedData.months || []).filter(m => m.month <= upTo);

  const cumBudget = filtered.reduce((s, m) => s + m.budget, 0);
  const cumInvoiced = filtered.reduce((s, m) => s + m.invoiced, 0);
  const cumPct = cumBudget > 0 ? Math.round((cumInvoiced / cumBudget) * 10000) / 100 : 0;
  const cumBadge = budgetBadge(cumPct);

  const computed = {
    budget: cumBudget,
    invoiced: cumInvoiced,
    pct: cumPct,
    badge: cumBadge
  };

  renderSummary(cachedData, computed);
  renderTable(cachedData, upTo);
  updateSubtitle();
}

function budgetBadge(pct) {
  if (pct >= 100) return 'GREEN';
  if (pct >= 80) return 'AMBER';
  return 'RED';
}

// ---- API helper ---------------------------------------------

async function apiFetch(path) {
  const res = await fetch(`${TM_BASE}${path}`, {
    credentials: "include",
    headers: { "X-Requested-With": "XMLHttpRequest" }
  });

  if (res.status === 401) {
    sessionStorage.setItem("hub_pre_login_url", window.location.href);
    window.location.href = "/login.html";
    throw new Error("Redirecting to login");
  }
  if (res.status === 404) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "NOT_FOUND");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---- Render: summary card -----------------------------------

function renderSummary(data, computed) {
  const section = document.getElementById("kpi-summary-section");
  if (!section) return;

  const periodLabel = currentPeriod === 'ytd'
    ? 'YTD' : MONTH_NAMES[currentMonth - 1];

  section.innerHTML = `
    <div class="kpi-summary-card">
      <div class="kpi-summary-body">
        <div class="kpi-summary-name">${escapeHtml(data.managerName)}</div>
        <div class="kpi-summary-meta">
          <span>${escapeHtml(data.department)}</span>
          <span>EL: ${escapeHtml(data.elName)}</span>
          <span>Team: ${escapeHtml(data.team)}</span>
        </div>
        <div class="kpi-summary-stats">
          <div class="kpi-stat">
            <span class="kpi-stat-label">${periodLabel} Budget</span>
            <span class="kpi-stat-value">&euro;${fmt(computed.budget)}</span>
          </div>
          <div class="kpi-stat">
            <span class="kpi-stat-label">${periodLabel} Invoiced</span>
            <span class="kpi-stat-value">&euro;${fmt(computed.invoiced)}</span>
          </div>
          <div class="kpi-stat">
            <span class="kpi-stat-label">EL Avg</span>
            <span class="kpi-stat-value">${data.elAvgCompletionPct.toFixed(1)}%</span>
          </div>
          <div class="kpi-stat">
            <span class="kpi-stat-label">Dept Avg</span>
            <span class="kpi-stat-value">${data.deptAvgCompletionPct.toFixed(1)}%</span>
          </div>
        </div>
      </div>
      <div class="kpi-summary-gauge">
        <div class="kpi-pct ${computed.badge}">${computed.pct.toFixed(1)}%</div>
        <span class="kpi-badge ${computed.badge}">${computed.badge}</span>
        <span class="kpi-gauge-label">Cumulative</span>
      </div>
    </div>`;
}

// ---- Render: monthly table ----------------------------------

function renderTable(data, upTo) {
  const section = document.getElementById("kpi-table-section");
  if (!section) return;

  // FULL/SUPER/SUPERVISOR can drill into a month's invoices; STANDARD gets a read-only table.
  const drill = viewMode !== 'self';

  const months = (data.months || []).filter(m => m.month <= upTo);
  const now = new Date();
  const cm = data.year === now.getFullYear() ? now.getMonth() + 1 : 13;

  const rows = months.map(m => {
    const isFuture = m.month > cm;
    const rowClass = isFuture ? "kpi-row-future" : "";
    const isExpanded = drill && expandedMonth === m.month;
    const hasFees = (m.auditFees || 0) !== 0 || (m.taxFees || 0) !== 0;
    const feeDetail = hasFees
      ? `<div class="kpi-fee-detail">eSoft: &euro;${fmt(m.esoftInvoiced || 0)}${m.auditFees ? ` + Audit: &euro;${fmt(m.auditFees)}` : ''}${m.taxFees ? ` + Other Fees: &euro;${fmt(m.taxFees)}` : ''}</div>`
      : '';
    let html = `
      <tr class="${rowClass} ${drill ? "kpi-row-clickable" : ""} ${isExpanded ? 'kpi-row-expanded' : ''}" data-month="${m.month}">
        <td class="kpi-cell-month">
          ${drill ? `<span class="kpi-expand-icon">${isExpanded ? '&#9660;' : '&#9654;'}</span>` : ''}
          ${escapeHtml(m.monthName)}
        </td>
        <td class="kpi-cell-num">&euro;${fmt(m.budget)}</td>
        <td class="kpi-cell-num">&euro;${fmt(m.invoiced)}${feeDetail}</td>
        <td class="kpi-cell-pct">
          <span class="kpi-pct-inline ${m.badge}">${m.completionPct.toFixed(1)}%</span>
        </td>
        <td class="kpi-cell-badge">
          <span class="kpi-badge-sm ${m.badge}">${m.badge}</span>
        </td>
      </tr>`;
    if (isExpanded) {
      html += renderInvoiceDetailRow(m.month, data.year);
    }
    return html;
  }).join("");

  section.innerHTML = `
    <div class="kpi-section-title" style="margin-top:28px">Monthly Breakdown ${drill ? `<span style="font-size:11px;color:var(--text-secondary);font-weight:400">(click month to see invoices)</span>` : ''}</div>
    <div class="kpi-table-wrap">
      <table class="kpi-table">
        <thead>
          <tr>
            <th>Month</th>
            <th class="kpi-th-num">Budget</th>
            <th class="kpi-th-num">Invoiced</th>
            <th class="kpi-th-num">Completion</th>
            <th class="kpi-th-center">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  // Attach click handlers (admin + supervisor — self view is read-only)
  if (drill) {
    section.querySelectorAll('.kpi-row-clickable').forEach(tr => {
      tr.addEventListener('click', () => {
        const mo = parseInt(tr.dataset.month);
        if (expandedMonth === mo) {
          expandedMonth = null;
        } else {
          expandedMonth = mo;
          ensureInvoiceDetails(data.year);
        }
        renderTable(data, upTo);
      });
    });
  }
}

function renderInvoiceDetailRow(month, year) {
  const cacheKey = `${year}`;
  const allRows = invoiceDetailCache[cacheKey];

  if (!allRows) {
    return `<tr class="kpi-detail-row"><td colspan="5"><div class="kpi-detail-loading"><div class="spinner"></div> Loading invoices...</div></td></tr>`;
  }

  const rows = allRows.filter(r => toNum(r.month_num) === month);
  if (rows.length === 0) {
    return `<tr class="kpi-detail-row"><td colspan="5"><div class="kpi-detail-empty">No invoices for this month.</div></td></tr>`;
  }

  let totalNet = 0;
  let totalPbiValue = 0;
  const lines = rows.map(r => {
    const net = toNum(r.net);
    const pbiVal = toNum(r.pbi_value);
    totalNet += net;
    totalPbiValue += pbiVal;
    const docDate = r.doc_date ? new Date(r.doc_date).toLocaleDateString('en-GB') : '';
    const sign = toNum(r.sign);
    return `
      <tr>
        <td>${escapeHtml(r.invoice_no || '')}</td>
        <td>${docDate}</td>
        <td>${escapeHtml(r.client || '')}</td>
        <td class="kpi-cell-num">&euro;${fmtDec(toNum(r.gross))}</td>
        <td class="kpi-cell-num">&euro;${fmtDec(toNum(r.vat))}</td>
        <td class="kpi-cell-num">&euro;${fmtDec(net)}</td>
        <td class="kpi-cell-num">&euro;${fmtDec(pbiVal)}</td>
        <td>${escapeHtml(r.doc_type || '')}</td>
        <td>${sign}</td>
        <td class="inv-desc">${escapeHtml((r.description || '').substring(0, 60))}</td>
      </tr>`;
  }).join('');

  return `
    <tr class="kpi-detail-row">
      <td colspan="5">
        <div class="kpi-detail-wrap">
          <table class="kpi-detail-table">
            <thead>
              <tr><th>Invoice #</th><th>Date</th><th>Client</th><th>Gross</th><th>VAT</th><th>Net</th><th>Value (PBI)</th><th>Type</th><th>Sign</th><th>Description</th></tr>
            </thead>
            <tbody>
              ${lines}
              <tr class="kpi-detail-sum">
                <td colspan="5" style="text-align:right;font-weight:600">Sum:</td>
                <td class="kpi-cell-num" style="font-weight:600">&euro;${fmtDec(totalNet)}</td>
                <td class="kpi-cell-num" style="font-weight:600">&euro;${fmtDec(totalPbiValue)}</td>
                <td colspan="3"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </td>
    </tr>`;
}

async function ensureInvoiceDetails(year) {
  const cacheKey = `${year}`;
  if (invoiceDetailCache[cacheKey]) return;
  if (!selectedInvoiceCode) return;

  // Supervisor uses the self-scoped endpoint (server resolves own invoice code).
  const url = viewMode === 'supervisor'
    ? `/api/reports/budget-kpi/me/invoice-details?year=${year}`
    : `/api/reports/budget-kpi/invoice-details/${selectedInvoiceCode}?year=${year}`;

  try {
    const data = await apiFetch(url);
    invoiceDetailCache[cacheKey] = data;
    if (cachedData) renderFromCache();
  } catch (err) {
    invoiceDetailCache[cacheKey] = [];
    if (cachedData) renderFromCache();
  }
}

function toNum(v) {
  if (v == null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function fmtDec(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---- State helpers ------------------------------------------

function setSummaryLoading() {
  const el = document.getElementById("kpi-summary-section");
  if (el) el.innerHTML = `<div class="perf-loading"><div class="spinner"></div>Loading KPI data...</div>`;
}

function setSummaryError(msg) {
  const el = document.getElementById("kpi-summary-section");
  if (!el) return;
  if (msg.includes("No budget data")) {
    el.innerHTML = `<div class="perf-exempt">No budget KPI data is available for this manager.</div>`;
  } else {
    el.innerHTML = `<div class="perf-error">Could not load KPI data.<br><small>${escapeHtml(msg)}</small></div>`;
  }
}

function clearTable() {
  const el = document.getElementById("kpi-table-section");
  if (el) el.innerHTML = "";
}

// ---- Fee Adjustments ----------------------------------------

async function loadFeeEntries() {
  const section = document.getElementById("kpi-fee-section");
  if (!section || !selectedInvoiceCode) { if (section) section.innerHTML = ""; return; }

  let entries = [];
  try {
    entries = await apiFetch(`/api/reports/budget-kpi/fee-adjustments/${selectedInvoiceCode}?year=${currentYear}`);
  } catch { /* InvoiceAllocation DB may be unavailable */ }

  renderFeePanel(entries);
}

function renderFeePanel(entries, mgrList, defaultCode) {
  const section = document.getElementById("kpi-fee-section");
  if (!section) return;

  if (!mgrList) mgrList = managers;
  if (!defaultCode) defaultCode = selectedInvoiceCode;

  const entryRows = entries.map(e => {
    const amtClass = e.amount >= 0 ? 'fee-pos' : 'fee-neg';
    const dateStr = e.entered_at ? new Date(e.entered_at).toLocaleDateString('en-GB') : '';
    return `
      <tr>
        <td>${escapeHtml(e.fee_type)}</td>
        <td>${MONTH_NAMES[(e.month_num || 1) - 1]}</td>
        <td class="${amtClass}">&euro;${Number(e.amount).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
        <td>${escapeHtml(e.entity_name || '')}</td>
        <td>${escapeHtml(e.country || '')}</td>
        <td>${escapeHtml(e.entered_by || '')}</td>
        <td>${dateStr}</td>
        <td><button class="fee-delete-btn" data-id="${e.id}" title="Delete">&times;</button></td>
      </tr>`;
  }).join('');

  section.innerHTML = `
    <div class="kpi-section-title" style="margin-top:28px">Fee Adjustments</div>
    <div class="fee-form-card">
      <div class="fee-form-grid">
        <div class="fee-field fee-field-manager">
          <label>${viewMode === 'supervisor' ? 'Manager' : 'Target Manager'}</label>
          <select id="fee-manager">
            ${mgrList.map(m => {
              const sel = m.invoice_code === defaultCode ? 'selected' : '';
              return `<option value="${escapeHtml(m.invoice_code)}" data-name="${escapeHtml(m.manager_name)}" ${sel}>${escapeHtml(m.manager_name)}</option>`;
            }).join('')}
          </select>
        </div>
        <div class="fee-field">
          <label>Type</label>
          <select id="fee-type">
            <option value="AUDIT">Audit</option>
            <option value="FCR">FCR</option>
            <option value="FRA">FRA</option>
            <option value="ICAS">ICAS</option>
            <option value="TAX">Tax</option>
            <option value="VAT">VAT</option>
          </select>
        </div>
        <div class="fee-field">
          <label>Month</label>
          <select id="fee-month">
            ${MONTH_NAMES.map((n, i) => `<option value="${i + 1}">${n}</option>`).join('')}
          </select>
        </div>
        <div class="fee-field">
          <label>Year</label>
          <input type="number" id="fee-year" value="${currentYear}" min="2026" max="2030" />
        </div>
        <div class="fee-field">
          <label>Amount (EUR)</label>
          <input type="number" id="fee-amount" step="0.01" placeholder="0.00" />
        </div>
        <div class="fee-field">
          <label>Description</label>
          <input type="text" id="fee-entity" placeholder="Entity / invoice #" />
        </div>
        <div class="fee-field">
          <label>Country</label>
          <select id="fee-country">
            <option value="Cyprus">Cyprus</option>
            <option value="Malta">Malta</option>
            <option value="UK">UK</option>
          </select>
        </div>
        <div class="fee-field">
          <label>&nbsp;</label>
          <button class="fee-add-button" id="fee-add-btn">Add</button>
        </div>
      </div>
    </div>
    ${entries.length > 0 ? `
    <div class="kpi-table-wrap" style="margin-top:12px">
      <table class="kpi-table fee-entries-table">
        <thead>
          <tr><th>Type</th><th>Month</th><th>Amount</th><th>Description</th><th>Country</th><th>By</th><th>Date</th><th></th></tr>
        </thead>
        <tbody>${entryRows}</tbody>
      </table>
    </div>` : '<p style="color:var(--text-secondary);font-size:12px;margin-top:8px">No fee adjustments for this manager / year.</p>'}`;

  document.getElementById("fee-add-btn")?.addEventListener("click", addFeeEntry);
  section.querySelectorAll(".fee-delete-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteFeeEntry(parseInt(btn.dataset.id)));
  });

  // Supervisor: changing the manager reloads fee entries for that manager.
  if (viewMode === 'supervisor') {
    document.getElementById("fee-manager")?.addEventListener("change", async (e) => {
      feeViewCode = e.target.value;
      if (!feeViewCode) return;
      let newEntries = [];
      try {
        newEntries = await apiFetch(`/api/reports/budget-kpi/fee-adjustments/${feeViewCode}?year=${currentYear}`);
      } catch { /* InvoiceAllocation DB may be unavailable */ }
      renderFeePanel(newEntries, feeManagers, feeViewCode);
    });
  }
}

async function addFeeEntry() {
  const managerSelect = document.getElementById("fee-manager");
  const invoiceCode = managerSelect?.value;
  const managerName = managerSelect?.selectedOptions[0]?.dataset.name || '';
  const feeType = document.getElementById("fee-type")?.value;
  const monthNum = parseInt(document.getElementById("fee-month")?.value);
  const year = parseInt(document.getElementById("fee-year")?.value);
  const amount = parseFloat(document.getElementById("fee-amount")?.value);
  const entityName = document.getElementById("fee-entity")?.value || '';
  const country = document.getElementById("fee-country")?.value || '';

  if (!amount || isNaN(amount) || !invoiceCode) return;

  try {
    await fetch(`${TM_BASE}/api/reports/budget-kpi/fee-adjustments`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      body: JSON.stringify({
        feeType, invoiceCode, managerName,
        monthNum, year, amount, entityName, country
      })
    });

    if (viewMode === 'supervisor') {
      // Refresh fee entries for the currently viewed manager.
      let entries = [];
      try { entries = await apiFetch(`/api/reports/budget-kpi/fee-adjustments/${feeViewCode}?year=${currentYear}`); } catch {}
      renderFeePanel(entries, feeManagers, feeViewCode);
      // If the fee touched the supervisor's own code, refresh the budget card.
      if (invoiceCode === selectedInvoiceCode) {
        cachedData = null; cachedYear = null;
        try {
          const data = await apiFetch(`/api/reports/budget-kpi/me?year=${currentYear}`);
          cachedData = data; cachedYear = currentYear;
          renderFromCache();
        } catch {}
      }
    } else {
      cachedData = null; cachedYear = null;
      await loadAndRender();
    }
  } catch (err) {
    console.error("Failed to add fee adjustment:", err);
  }
}

async function deleteFeeEntry(id) {
  try {
    await fetch(`${TM_BASE}/api/reports/budget-kpi/fee-adjustments/${id}`, {
      method: "DELETE",
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });

    if (viewMode === 'supervisor') {
      let entries = [];
      try { entries = await apiFetch(`/api/reports/budget-kpi/fee-adjustments/${feeViewCode}?year=${currentYear}`); } catch {}
      renderFeePanel(entries, feeManagers, feeViewCode);
      if (feeViewCode === selectedInvoiceCode) {
        cachedData = null; cachedYear = null;
        try {
          const data = await apiFetch(`/api/reports/budget-kpi/me?year=${currentYear}`);
          cachedData = data; cachedYear = currentYear;
          renderFromCache();
        } catch {}
      }
    } else {
      cachedData = null; cachedYear = null;
      await loadAndRender();
    }
  } catch (err) {
    console.error("Failed to delete fee adjustment:", err);
  }
}

// ---- Utility ------------------------------------------------

function fmt(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
