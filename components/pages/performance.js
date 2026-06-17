// ============================================================
// components/pages/performance.js — Performance Report (SPA component)
//
// Admin-only: employee dropdown → chargeability card + breakdown + team.
// Replaces standalone performance.html + js/performance.js.
// Mounts into: #section-performance
// ============================================================

import { escapeHtml } from "../../utils/dom.js";
import { TM_BASE } from "../../js/auth.js";

const SECTION_ID = "section-performance";

// ---- Page visibility ----------------------------------------

function showPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.add("performance-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "performance" } }));
}

function hidePage() {
  document.querySelector(".main")?.classList.remove("performance-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_performance = { show: showPage, hide: hidePage };

// ---- State --------------------------------------------------

let employees = [];
let selectedCode = null;
let currentPeriod = "month";
let currentYear = null;
let currentMonth = null;

// ---- Init ---------------------------------------------------

export default async function init() {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  section.innerHTML = `
    <div class="perf-page">
      <div class="perf-header">
        <div class="perf-header-left">
          <button class="perf-back-btn" id="perf-back-btn" title="Back to home">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div>
            <h2>Performance Report</h2>
            <p id="perf-period-label">Chargeability — current month</p>
          </div>
        </div>
        <div class="perf-controls">
          <select id="perf-employee-select" class="perf-select">
            <option value="">Select employee...</option>
          </select>
          <div class="period-toggle">
            <select id="perf-period-select" class="period-select active"></select>
            <button id="perf-btn-ytd" class="period-btn">YTD</button>
          </div>
        </div>
      </div>
      <div id="perf-self-section"></div>
      <div id="perf-team-section" style="display:none"></div>
    </div>`;

  // Back button
  document.getElementById("perf-back-btn")?.addEventListener("click", hidePage);

  // Load employees for dropdown
  await loadEmployees();

  // Init month picker
  initMonthPicker();

  // Employee selector
  document.getElementById("perf-employee-select")?.addEventListener("change", (e) => {
    selectedCode = e.target.value || null;
    if (selectedCode) loadAndRender();
  });

  // Period toggle
  document.getElementById("perf-period-select")?.addEventListener("change", (e) => {
    const val = e.target.value;
    if (val === "month") {
      currentYear = null;
      currentMonth = null;
    } else {
      const [y, m] = val.split("-");
      currentYear = parseInt(y);
      currentMonth = parseInt(m);
    }
    setPeriod("month");
  });

  document.getElementById("perf-btn-ytd")?.addEventListener("click", () => {
    currentYear = null;
    currentMonth = null;
    const sel = document.getElementById("perf-period-select");
    if (sel) sel.value = "month";
    setPeriod("ytd");
  });
}

// ---- Load employees -----------------------------------------

async function loadEmployees() {
  try {
    const res = await fetch(`${TM_BASE}/api/reports/performance/employees`, {
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });
    if (res.ok) {
      employees = await res.json();
    } else {
      employees = [];
    }
  } catch {
    employees = [];
  }

  const select = document.getElementById("perf-employee-select");
  if (!select) return;

  select.innerHTML = `<option value="">Select employee...</option>` +
    employees.map(e =>
      `<option value="${escapeHtml(e.esoft_code)}">${escapeHtml(e.employee_name)} (${escapeHtml(e.esoft_code)})</option>`
    ).join("");
}

// ---- Month picker -------------------------------------------

function initMonthPicker() {
  const select = document.getElementById("perf-period-select");
  if (!select) return;
  const now = new Date();
  const months = [];
  for (let i = 0; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i);
    months.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: i === 0 ? "Current Month" : d.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
    });
  }
  select.innerHTML = months.map((m, i) =>
    `<option value="${i === 0 ? "month" : m.year + "-" + m.month}">${m.label}</option>`
  ).join("");
  select.classList.add("active");
}

// ---- Period toggle ------------------------------------------

function setPeriod(period) {
  currentPeriod = period;
  const select = document.getElementById("perf-period-select");
  const ytdBtn = document.getElementById("perf-btn-ytd");
  if (select) select.classList.toggle("active", period === "month");
  if (ytdBtn) ytdBtn.classList.toggle("active", period === "ytd");

  const label = document.getElementById("perf-period-label");
  if (label) {
    if (period === "ytd") {
      label.textContent = "Chargeability — year to date";
    } else if (currentYear && currentMonth) {
      const dt = new Date(currentYear, currentMonth - 1);
      label.textContent = `Chargeability — ${dt.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`;
    } else {
      label.textContent = "Chargeability — current month";
    }
  }

  if (selectedCode) loadAndRender();
}

// ---- Load & render ------------------------------------------

async function loadAndRender() {
  if (!selectedCode) return;

  setSelfLoading();
  clearTeam();

  let qs = `period=${currentPeriod}`;
  if (currentPeriod === "month" && currentYear && currentMonth) {
    qs += `&year=${currentYear}&month=${currentMonth}`;
  }

  let card;
  try {
    card = await apiFetch(`/api/reports/performance/${selectedCode}?${qs}`);
  } catch (err) {
    setSelfError(err.message);
    return;
  }

  renderSelfCard(card);
  updatePeriodDateRange(card);

  // Load team view
  if (card.isManager) {
    setTeamLoading();
    try {
      const teamCard = await apiFetch(`/api/reports/performance/${selectedCode}/team?${qs}`);
      renderTeamSection(teamCard);
    } catch (err) {
      setTeamError(err.message);
    }
  }
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
  if (res.status === 403) throw new Error("FORBIDDEN");
  if (res.status === 404) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message === "NON_CHARGEABLE_ROLE" ? "NON_CHARGEABLE_ROLE" : "NOT_FOUND");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---- Render: self card --------------------------------------

function renderSelfCard(card) {
  const section = document.getElementById("perf-self-section");
  if (!section) return;

  if (card.badge === "EXEMPT") {
    section.innerHTML = `
      <div class="perf-exempt">
        <strong>${escapeHtml(card.employeeName)}</strong> is currently on maternity leave.
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
              <span class="perf-breakdown-company">${escapeHtml(c.company)}</span>
              <span class="perf-breakdown-hrs">${c.hours.toFixed(1)} h</span>
            </div>`).join("")}
        </div>
      </div>` : "";

  section.innerHTML = `
    <div class="perf-card" role="region" aria-label="Employee chargeability">
      <div class="perf-card-body">
        <div class="perf-card-name">${escapeHtml(card.employeeName)}</div>
        <div class="perf-card-meta">
          <span>${escapeHtml(card.jobTitle)}</span>
          <span>${escapeHtml(card.team)}</span>
          <span>${escapeHtml(card.location)}</span>
        </div>
        <div class="perf-card-meta" style="margin-top:2px;">
          <span>EL: ${escapeHtml(card.engagementLeader)}</span>
          <span>Level: ${escapeHtml(card.level)}</span>
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

// ---- Render: team section -----------------------------------

function renderTeamSection(teamCard) {
  const section = document.getElementById("perf-team-section");
  if (!section) return;
  section.style.display = "";

  const summary = teamCard.teamSummary || {};
  const reports = teamCard.directReports || [];

  const summaryHtml = `
    <div class="perf-summary-bar">
      <span class="perf-summary-chip green">${summary.greenCount ?? 0} Green</span>
      <span class="perf-summary-chip amber">${summary.amberCount ?? 0} Amber</span>
      <span class="perf-summary-chip red">${summary.redCount ?? 0} Red</span>
    </div>`;

  const cardsHtml = reports.map(r => {
    const pctDisplay = r.badge === "EXEMPT"
      ? `<div class="perf-mini-pct EXEMPT">Exempt</div>`
      : `<div class="perf-mini-pct ${r.badge}">${r.chargeabilityPct.toFixed(1)}%</div>
         <span class="perf-badge ${r.badge}" style="font-size:10px;">${r.badge}</span>`;
    return `
      <div class="perf-mini-card">
        <div class="perf-mini-info">
          <div class="perf-mini-name">${escapeHtml(r.employeeName)}</div>
          <div class="perf-mini-title">${escapeHtml(r.level || "")}</div>
          <div class="perf-mini-hrs">${r.actualHrs.toFixed(1)} / ${(r.targetHrsPeriod || 0).toFixed(1)} h</div>
        </div>
        <div class="perf-mini-gauge">
          ${pctDisplay}
        </div>
      </div>`;
  }).join("");

  section.innerHTML = `
    <div class="perf-section-title" style="margin-top:32px">Team View</div>
    <div class="perf-team-header">
      <h3>${reports.length} Direct Report${reports.length !== 1 ? "s" : ""}</h3>
      <div class="perf-team-avg">
        Team avg:
        <strong class="perf-pct ${summary.badge || ""}"
                style="font-size:16px;">${(summary.teamAvgPct || 0).toFixed(1)}%</strong>
        <span class="perf-badge ${summary.badge || ""}" style="font-size:11px;">${summary.badge || ""}</span>
      </div>
    </div>
    ${summaryHtml}
    <div class="perf-team-grid">${cardsHtml}</div>`;
}

// ---- Period date range label --------------------------------

function updatePeriodDateRange(card) {
  if (!card.period) return;
  const [start, end] = card.period.split("/");
  const fmt = d => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const label = document.getElementById("perf-period-label");
  if (label) {
    const prefix = currentPeriod === "ytd" ? "YTD" : "Monthly";
    label.textContent = `${prefix}: ${fmt(start)} – ${fmt(end)}`;
  }
}

// ---- State helpers ------------------------------------------

function setSelfLoading() {
  const el = document.getElementById("perf-self-section");
  if (el) el.innerHTML = `<div class="perf-loading"><div class="spinner"></div>Loading data...</div>`;
}

function setSelfError(msg) {
  const el = document.getElementById("perf-self-section");
  if (!el) return;
  if (msg === "NON_CHARGEABLE_ROLE") {
    el.innerHTML = `<div class="perf-exempt">This employee's role is not included in the chargeability report.</div>`;
  } else {
    el.innerHTML = `<div class="perf-error">Could not load performance data.<br><small>${escapeHtml(msg)}</small></div>`;
  }
}

function clearTeam() {
  const el = document.getElementById("perf-team-section");
  if (el) { el.innerHTML = ""; el.style.display = "none"; }
}

function setTeamLoading() {
  const el = document.getElementById("perf-team-section");
  if (el) {
    el.style.display = "";
    el.innerHTML = `<div class="perf-loading"><div class="spinner"></div>Loading team data...</div>`;
  }
}

function setTeamError(msg) {
  const el = document.getElementById("perf-team-section");
  if (el) el.innerHTML = `<div class="perf-error">Could not load team data. (${escapeHtml(msg)})</div>`;
}
