// ============================================================
// components/pages/budget-kpi.js — Budget KPI Report (SPA component)
//
// Admin-only: manager dropdown → budget vs invoiced card + monthly table.
// Period bar with month buttons per year (2025→current) + YTD, matching
// the Flask tester design at :9092.
// Mounts into: #section-budgetkpi
// ============================================================

import { escapeHtml } from "../../utils/dom.js";
import { TM_BASE } from "../../js/auth.js";

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
    </div>`;

  document.getElementById("kpi-back-btn")?.addEventListener("click", hidePage);

  buildPeriodBar();
  await loadManagers();

  document.getElementById("kpi-manager-select")?.addEventListener("change", (e) => {
    selectedCode = e.target.value || null;
    cachedData = null;
    cachedYear = null;
    if (selectedCode) {
      loadAndRender();
    } else {
      document.getElementById("kpi-summary-section").innerHTML = "";
      document.getElementById("kpi-table-section").innerHTML = "";
    }
  });
}

// ---- Period bar (matches Flask tester) -----------------------

function buildPeriodBar() {
  const bar = document.getElementById("kpi-period-bar");
  if (!bar) return;

  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  let html = '';

  for (let yr = 2025; yr <= thisYear; yr++) {
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

      if (!selectedCode) return;

      if (yearChanged) {
        cachedData = null;
        cachedYear = null;
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
      `<option value="${escapeHtml(m.esoft_code)}">${escapeHtml(m.manager_name)} (${escapeHtml(m.department || "")})</option>`
    ).join("");

  if (prevCode && managers.some(m => m.esoft_code === prevCode)) {
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
  renderFromCache();
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

  const months = (data.months || []).filter(m => m.month <= upTo);
  const now = new Date();
  const cm = data.year === now.getFullYear() ? now.getMonth() + 1 : 13;

  const rows = months.map(m => {
    const isFuture = m.month > cm;
    const rowClass = isFuture ? "kpi-row-future" : "";
    return `
      <tr class="${rowClass}">
        <td class="kpi-cell-month">${escapeHtml(m.monthName)}</td>
        <td class="kpi-cell-num">&euro;${fmt(m.budget)}</td>
        <td class="kpi-cell-num">&euro;${fmt(m.invoiced)}</td>
        <td class="kpi-cell-pct">
          <span class="kpi-pct-inline ${m.badge}">${m.completionPct.toFixed(1)}%</span>
        </td>
        <td class="kpi-cell-badge">
          <span class="kpi-badge-sm ${m.badge}">${m.badge}</span>
        </td>
      </tr>`;
  }).join("");

  section.innerHTML = `
    <div class="kpi-section-title" style="margin-top:28px">Monthly Breakdown</div>
    <div class="kpi-table-wrap">
      <table class="kpi-table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Budget</th>
            <th>Invoiced</th>
            <th>Completion</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
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

// ---- Utility ------------------------------------------------

function fmt(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
