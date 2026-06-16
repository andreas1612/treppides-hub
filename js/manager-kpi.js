// ============================================================
// js/manager-kpi.js — Manager KPI page (budget vs invoiced).
// ============================================================

import { initAuth, signOut } from './auth.js';

const TM_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:8080'
  : '/projects';

let currentYear = new Date().getFullYear();

// ---- Boot --------------------------------------------------

(async function boot() {
  const user = await initAuth();
  if (!user) return;

  document.getElementById('hub-signout')?.addEventListener('click', signOut);

  initYearPicker();
  await loadAndRender();
})();

// ---- Year picker -------------------------------------------

function initYearPicker() {
  const select = document.getElementById('year-select');
  if (!select) return;
  const now = new Date().getFullYear();
  for (let y = now; y >= now - 2; y--) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === currentYear) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    currentYear = parseInt(select.value);
    loadAndRender();
  });
}

// ---- Load & render -----------------------------------------

async function loadAndRender() {
  setSummaryLoading();
  clearTable();

  let data;
  try {
    data = await apiFetch(`/api/reports/budget-kpi/me?year=${currentYear}`);
  } catch (err) {
    setSummaryError(err.message);
    return;
  }

  renderSummary(data);
  renderTable(data);
}

// ---- API helper --------------------------------------------

async function apiFetch(path) {
  const res = await fetch(`${TM_BASE}${path}`, {
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' }
  });

  if (res.status === 401) {
    sessionStorage.setItem('hub_pre_login_url', window.location.href);
    window.location.href = '/login.html';
    throw new Error('Redirecting to login');
  }
  if (res.status === 404) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || 'NOT_FOUND');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---- Render: summary card ----------------------------------

function renderSummary(data) {
  const section = document.getElementById('summary-section');
  if (!section) return;

  const subtitle = document.getElementById('topbar-subtitle');
  if (subtitle) subtitle.textContent = `Budget vs Invoiced — ${data.year}`;

  section.innerHTML = `
    <div class="kpi-summary-card">
      <div class="kpi-summary-body">
        <div class="kpi-summary-name">${esc(data.managerName)}</div>
        <div class="kpi-summary-meta">
          <span>${esc(data.department)}</span>
          <span>EL: ${esc(data.elName)}</span>
          <span>Team: ${esc(data.team)}</span>
        </div>
        <div class="kpi-summary-stats">
          <div class="kpi-stat">
            <span class="kpi-stat-label">YTD Budget</span>
            <span class="kpi-stat-value">&euro;${fmt(data.cumulativeBudget)}</span>
          </div>
          <div class="kpi-stat">
            <span class="kpi-stat-label">YTD Invoiced</span>
            <span class="kpi-stat-value">&euro;${fmt(data.cumulativeInvoiced)}</span>
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
        <div class="kpi-pct ${data.cumulativeBadge}">${data.cumulativeCompletionPct.toFixed(1)}%</div>
        <span class="kpi-badge ${data.cumulativeBadge}">${data.cumulativeBadge}</span>
        <span class="kpi-gauge-label">Cumulative</span>
      </div>
    </div>`;
}

// ---- Render: monthly table ---------------------------------

function renderTable(data) {
  const section = document.getElementById('table-section');
  if (!section) return;

  const months = data.months || [];
  const now = new Date();
  const currentMonth = data.year === now.getFullYear() ? now.getMonth() + 1 : 13;

  const rows = months.map(m => {
    const isFuture = m.month > currentMonth;
    const rowClass = isFuture ? 'kpi-row-future' : '';
    return `
      <tr class="${rowClass}">
        <td class="kpi-cell-month">${esc(m.monthName)}</td>
        <td class="kpi-cell-num">&euro;${fmt(m.budget)}</td>
        <td class="kpi-cell-num">&euro;${fmt(m.invoiced)}</td>
        <td class="kpi-cell-pct">
          <span class="kpi-pct-inline ${m.badge}">${m.completionPct.toFixed(1)}%</span>
        </td>
        <td class="kpi-cell-badge">
          <span class="kpi-badge-sm ${m.badge}">${m.badge}</span>
        </td>
      </tr>`;
  }).join('');

  section.innerHTML = `
    <div class="kpi-section-title">Monthly Breakdown</div>
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

// ---- State helpers -----------------------------------------

function setSummaryLoading() {
  const el = document.getElementById('summary-section');
  if (el) el.innerHTML = `<div class="perf-loading"><div class="spinner"></div>Loading your KPI data...</div>`;
}

function setSummaryError(msg) {
  const el = document.getElementById('summary-section');
  if (!el) return;
  if (msg === 'No budget data for this employee') {
    el.innerHTML = `<div class="perf-exempt">No budget KPI data is available for your account.</div>`;
  } else {
    el.innerHTML = `<div class="perf-error">Could not load KPI data.<br><small>${esc(msg)}</small></div>`;
  }
}

function clearTable() {
  const el = document.getElementById('table-section');
  if (el) el.innerHTML = '';
}

// ---- Utility -----------------------------------------------

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
