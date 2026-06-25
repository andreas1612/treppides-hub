// ============================================================
// js/performance.js — Employee Performance Report page.
// Fetches chargeability data from TM backend and renders cards.
// Dev mode: dev switcher shown on localhost, sends X-Dev-User-Code.
// ============================================================

import { initAuth, signOut } from './auth.js';

const TM_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:8080'
  : '/projects';

const IS_DEV = window.location.hostname === 'localhost';

let devUserCode = null;
let currentPeriod = 'month';
let currentYear = null;
let currentMonth = null;

// ---- Boot --------------------------------------------------

(async function boot() {
  const user = await initAuth();
  if (!user) return; // redirect in flight

  document.getElementById('hub-signout')?.addEventListener('click', signOut);

  // Show dev switcher and populate it
  if (IS_DEV) {
    initDevSwitcher();
  }

  // Build month picker options
  initMonthPicker();

  // Wire period toggle
  document.getElementById('period-select')?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'month') {
      currentYear = null;
      currentMonth = null;
    } else {
      const [y, m] = val.split('-');
      currentYear = parseInt(y);
      currentMonth = parseInt(m);
    }
    setPeriod('month');
  });
  document.getElementById('btn-ytd')?.addEventListener('click', () => {
    currentYear = null;
    currentMonth = null;
    const sel = document.getElementById('period-select');
    if (sel) sel.value = 'month';
    setPeriod('ytd');
  });

  await loadAndRender();
})();

// ---- Period toggle -----------------------------------------

function setPeriod(period) {
  currentPeriod = period;
  const select = document.getElementById('period-select');
  const ytdBtn = document.getElementById('btn-ytd');
  if (select) select.classList.toggle('active', period === 'month');
  if (ytdBtn) ytdBtn.classList.toggle('active', period === 'ytd');
  const subtitle = document.getElementById('topbar-subtitle');
  if (subtitle) {
    if (period === 'ytd') {
      subtitle.textContent = 'Chargeability — year to date';
    } else if (currentYear && currentMonth) {
      const dt = new Date(currentYear, currentMonth - 1);
      subtitle.textContent = `Chargeability — ${dt.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`;
    } else {
      subtitle.textContent = 'Chargeability — current month';
    }
  }
  loadAndRender();
}

function initMonthPicker() {
  const select = document.getElementById('period-select');
  if (!select) return;
  const now = new Date();
  const months = [];
  for (let i = 1; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) });
  }
  select.innerHTML = `<option value="month">Current Month</option>` +
    months.map(m => `<option value="${m.year}-${m.month}">${m.label}</option>`).join('');
  select.classList.add('active');
}

// ---- Main load/render loop ---------------------------------

async function loadAndRender() {
  setSelfLoading();
  clearTeam();

  let qs = `period=${currentPeriod}`;
  if (currentPeriod === 'month' && currentYear && currentMonth) {
    qs += `&year=${currentYear}&month=${currentMonth}`;
  }

  let card;
  try {
    card = await apiFetch(`/api/reports/performance/me?${qs}`);
  } catch (err) {
    setSelfError(err.message);
    return;
  }

  renderSelfCard(card);
  updatePeriodLabel(card);

  if (card.isManager) {
    setTeamLoading();
    try {
      const teamCard = await apiFetch(`/api/reports/performance/team?${qs}`);
      renderTeamSection(teamCard);
    } catch (err) {
      setTeamError(err.message);
    }
  }
}

// ---- API helper --------------------------------------------

async function apiFetch(path) {
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  if (IS_DEV && devUserCode) {
    headers['X-Dev-User-Code'] = devUserCode;
  }

  const res = await fetch(`${TM_BASE}${path}`, { credentials: 'include', headers });

  if (res.status === 401) {
    sessionStorage.setItem('hub_pre_login_url', window.location.href);
    window.location.href = '/login.html';
    throw new Error('Redirecting to login');
  }
  if (res.status === 403) throw new Error('FORBIDDEN');
  if (res.status === 404) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message === 'NON_CHARGEABLE_ROLE'
      ? 'NON_CHARGEABLE_ROLE'
      : 'NOT_FOUND');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---- Render: self card -------------------------------------

function renderSelfCard(card) {
  const section = document.getElementById('self-section');
  if (!section) return;

  if (card.badge === 'EXEMPT') {
    section.innerHTML = `
      <div class="perf-exempt">
        <strong>${esc(card.employeeName)}</strong> is currently on maternity leave.
        No chargeability report for this period.
      </div>`;
    return;
  }

  const breakdownHtml = (card.companyBreakdown && card.companyBreakdown.length > 0)
    ? `<div class="perf-breakdown">
        <div class="perf-breakdown-title">Hours by Client</div>
        <div class="perf-breakdown-list">
          ${card.companyBreakdown.map(c => `
            <div class="perf-breakdown-row">
              <span class="perf-breakdown-company">${esc(c.company)}</span>
              <span class="perf-breakdown-hrs">${c.hours.toFixed(1)} h</span>
            </div>`).join('')}
        </div>
      </div>` : '';

  section.innerHTML = `
    <div class="perf-card" role="region" aria-label="My chargeability">
      <div class="perf-card-body">
        <div class="perf-card-name">${esc(card.employeeName)}</div>
        <div class="perf-card-meta">
          <span>${esc(card.jobTitle)}</span>
          <span>${esc(card.team)}</span>
          <span>${esc(card.location)}</span>
        </div>
        <div class="perf-card-meta" style="margin-top:2px;">
          <span>EL: ${esc(card.engagementLeader)}</span>
          <span>Level: ${esc(card.level)}</span>
          <span>${card.weeksInPeriod} weeks</span>
        </div>
        <div class="perf-hrs-row">
          <div class="perf-hrs-item">
            <span class="perf-hrs-label">Actual</span>
            <span class="perf-hrs-value">${card.actualHrs.toFixed(1)} h</span>
          </div>
          <div class="perf-hrs-item">
            <span class="perf-hrs-label">Available</span>
            <span class="perf-hrs-value">${card.availableHrsPeriod.toFixed(1)} h</span>
          </div>
          <div class="perf-hrs-item">
            <span class="perf-hrs-label">Target</span>
            <span class="perf-hrs-value">${card.targetHrsPeriod.toFixed(1)} h</span>
          </div>
        </div>
        <div class="perf-target-line">
          Target chargeability: <strong>${card.targetPct.toFixed(1)}%</strong>
        </div>
        ${breakdownHtml}
      </div>
      <div class="perf-gauge-wrap">
        <div class="perf-pct ${card.badge}">${card.chargeabilityPct.toFixed(1)}%</div>
        <span class="perf-badge ${card.badge}">${card.badge}</span>
      </div>
    </div>`;
}

// ---- Render: team section ----------------------------------

function renderTeamSection(teamCard) {
  const section = document.getElementById('team-section');
  if (!section) return;
  section.style.display = '';

  const summary = teamCard.teamSummary || {};
  const reports = teamCard.directReports || [];

  const summaryHtml = `
    <div class="perf-summary-bar">
      <span class="perf-summary-chip green">${summary.greenCount ?? 0} Green</span>
      <span class="perf-summary-chip amber">${summary.amberCount ?? 0} Amber</span>
      <span class="perf-summary-chip red">${summary.redCount ?? 0} Red</span>
    </div>`;

  const cardsHtml = reports.map(r => {
    const pctDisplay = r.badge === 'EXEMPT'
      ? `<div class="perf-mini-pct EXEMPT">Exempt</div>`
      : `<div class="perf-mini-pct ${r.badge}">${r.chargeabilityPct.toFixed(1)}%</div>
         <span class="perf-badge ${r.badge}" style="font-size:10px;">${r.badge}</span>`;
    return `
      <div class="perf-mini-card clickable" data-code="${esc(r.esoftCode)}" role="button" tabindex="0" title="Open ${esc(r.employeeName)}'s report" style="cursor:pointer">
        <div class="perf-mini-info">
          <div class="perf-mini-name">${esc(r.employeeName)}</div>
          <div class="perf-mini-title">${esc(r.jobTitle || r.level)}</div>
          <div class="perf-mini-hrs">${r.actualHrs.toFixed(1)} / ${r.availableHrsPeriod.toFixed(1)} h</div>
        </div>
        <div class="perf-mini-gauge">
          ${pctDisplay}
        </div>
      </div>`;
  }).join('');

  section.innerHTML = `
    <div class="perf-section-title">My Team</div>
    <div class="perf-team-header">
      <h3>${reports.length} Direct Report${reports.length !== 1 ? 's' : ''}</h3>
      <div class="perf-team-avg">
        Team avg:
        <strong class="perf-pct ${summary.badge || ''}"
                style="font-size:16px;">${(summary.teamAvgPct || 0).toFixed(1)}%</strong>
        <span class="perf-badge ${summary.badge || ''}" style="font-size:11px;">${summary.badge || ''}</span>
      </div>
    </div>
    ${summaryHtml}
    <div class="perf-team-grid">${cardsHtml}</div>`;

  // Click a direct report to open their report (same view mechanism as the dev switcher)
  section.querySelectorAll('.perf-mini-card[data-code]').forEach(cardEl => {
    const go = () => openTeamMember(cardEl.getAttribute('data-code'));
    cardEl.addEventListener('click', go);
    cardEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });
}

// ---- Drill into a direct report ----------------------------

function openTeamMember(code) {
  if (!code) return;
  devUserCode = code;                            // view that person
  const sw = document.getElementById('dev-employee-select');
  if (sw) sw.value = code;                       // keep dev switcher in sync
  loadAndRender();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- Period label ------------------------------------------

function updatePeriodLabel(card) {
  const label = document.getElementById('perf-period-label');
  if (!label || !card.period) return;
  const [start, end] = card.period.split('/');
  const fmt = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  label.textContent = `${fmt(start)} – ${fmt(end)}`;
}

// ---- State helpers -----------------------------------------

function setSelfLoading() {
  const el = document.getElementById('self-section');
  if (el) el.innerHTML = `<div class="perf-loading"><div class="spinner"></div>Loading your data…</div>`;
}

function setSelfError(msg) {
  const el = document.getElementById('self-section');
  if (!el) return;
  if (msg === 'NON_CHARGEABLE_ROLE') {
    el.innerHTML = `<div class="perf-exempt">Your role is not included in the chargeability report.</div>`;
  } else {
    el.innerHTML = `<div class="perf-error">Could not load performance data. Please try again later.<br><small>${esc(msg)}</small></div>`;
  }
}

function clearTeam() {
  const el = document.getElementById('team-section');
  if (el) { el.innerHTML = ''; el.style.display = 'none'; }
}

function setTeamLoading() {
  const el = document.getElementById('team-section');
  if (el) {
    el.style.display = '';
    el.innerHTML = `<div class="perf-loading"><div class="spinner"></div>Loading team data…</div>`;
  }
}

function setTeamError(msg) {
  const el = document.getElementById('team-section');
  if (el) el.innerHTML = `<div class="perf-error">Could not load team data. (${esc(msg)})</div>`;
}

// ---- Dev switcher ------------------------------------------

async function initDevSwitcher() {
  const panel = document.getElementById('dev-switcher');
  if (!panel) return;
  panel.style.display = '';

  let employees;
  try {
    employees = await fetch(`${TM_BASE}/api/reports/performance/employees`, {
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    }).then(r => r.ok ? r.json() : []);
  } catch {
    employees = [];
  }

  const select = document.getElementById('dev-employee-select');
  if (!select) return;

  select.innerHTML = `<option value="">— Real login —</option>` +
    employees.map(e =>
      `<option value="${esc(e.esoft_code)}">${esc(e.employee_name)} (${esc(e.esoft_code)})</option>`
    ).join('');

  select.addEventListener('change', () => {
    devUserCode = select.value || null;
    loadAndRender();
  });
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
