// ============================================================
// components/pages/performance.js — Performance Report (SPA component)
//
// Admin-only: employee dropdown → chargeability card + breakdown + team.
// Replaces standalone performance.html + js/performance.js.
// Mounts into: #section-performance
// ============================================================

import { escapeHtml } from "../../utils/dom.js";
import { TM_BASE, getCurrentUser } from "../../js/auth.js";

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
// STANDARD tier: self-view only (own /me card, no employee dropdown). FULL: admin view.
let selfMode = false;
// STANDARD managers: the report currently drilled into (null = viewing own card).
let viewingReportCode = null;
// HR / SUPER only: may edit performance targets. Cached level options for the editor.
let canEdit = false;
let levelOptions = null;

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

  // Who sees the employee dropdown ("view anyone"): FULL, SUPER, and the HR team
  // (backend flag canViewAllReports). Everyone else gets self-view only.
  selfMode = !getCurrentUser()?.canViewAllReports;
  // HR + SUPER admins may edit targets (level / target hours / location) inline.
  canEdit = !!getCurrentUser()?.canEditTargets;
  if (selfMode) {
    document.getElementById("perf-employee-select")?.remove();
  } else {
    await loadEmployees();
  }

  // Init month picker
  initMonthPicker();

  // Employee selector (FULL only; removed in self mode)
  document.getElementById("perf-employee-select")?.addEventListener("change", (e) => {
    selectedCode = e.target.value || null;
    if (selectedCode) loadAndRender();
  });

  // Self mode: load own card immediately.
  if (selfMode) loadSelf();

  // Team drill-down: click (or Enter/Space on) a direct report to open their profile
  const teamSection = document.getElementById("perf-team-section");
  teamSection?.addEventListener("click", (e) => {
    const card = e.target.closest(".perf-mini-card[data-code]");
    if (card) onReportClick(card.getAttribute("data-code"));
  });
  teamSection?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".perf-mini-card[data-code]");
    if (card) { e.preventDefault(); onReportClick(card.getAttribute("data-code")); }
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

  if (selfMode) {
    if (viewingReportCode) openReport(viewingReportCode);
    else loadSelf();
  } else if (selectedCode) {
    loadAndRender();
  }
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

// ---- Self view (STANDARD tier) ------------------------------

async function loadSelf() {
  viewingReportCode = null;   // own card = not drilled into a report
  const me = getCurrentUser();
  // No eSoft identity → definitely not in the chargeability report.
  if (!me?.esoftCode) { showNotApplicable(); return; }

  setSelfLoading();
  clearTeam();

  let qs = `period=${currentPeriod}`;
  if (currentPeriod === "month" && currentYear && currentMonth) {
    qs += `&year=${currentYear}&month=${currentMonth}`;
  }

  let card;
  try {
    card = await apiFetch(`/api/reports/performance/me?${qs}`);
  } catch (err) {
    // Not in the chargeability list / no access → friendly "not applicable".
    if (["NON_CHARGEABLE_ROLE", "NOT_FOUND", "FORBIDDEN"].includes(err.message)) {
      showNotApplicable();
    } else {
      setSelfError(err.message);
    }
    return;
  }

  renderSelfCard(card);
  updatePeriodDateRange(card);

  // Managers also see their own team.
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

function showNotApplicable() {
  const el = document.getElementById("perf-self-section");
  if (el) {
    el.innerHTML = `<div class="perf-exempt">The Performance report isn't applicable to your role.</div>`;
  }
  clearTeam();
}

// ---- Drill into a team member -------------------------------

// Route a team-card click by tier: FULL admins drill via the admin endpoint (any employee);
// STANDARD managers drill via the manager-scoped endpoint (their own reports only).
function onReportClick(code) {
  if (selfMode) openReport(code);
  else openEmployee(code);
}

function openEmployee(code) {
  if (!code) return;
  selectedCode = code;
  const select = document.getElementById("perf-employee-select");
  if (select) select.value = code;        // keep dropdown in sync (reports are in the list)
  loadAndRender();
  document.querySelector(".perf-page")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// STANDARD manager drilling into one of their own reports (same full detail admins see,
// scoped to /report/{code}). A "back to my team" control returns to the manager's own view.
async function openReport(code) {
  if (!code) return;
  viewingReportCode = code;

  setSelfLoading();
  clearTeam();

  let qs = `period=${currentPeriod}`;
  if (currentPeriod === "month" && currentYear && currentMonth) {
    qs += `&year=${currentYear}&month=${currentMonth}`;
  }

  let card;
  try {
    card = await apiFetch(`/api/reports/performance/report/${code}?${qs}`);
  } catch (err) {
    setSelfError(err.message);
    return;
  }

  renderSelfCard(card);
  updatePeriodDateRange(card);
  showBackToTeam();
  document.querySelector(".perf-page")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showBackToTeam() {
  const section = document.getElementById("perf-self-section");
  if (!section) return;
  const bar = document.createElement("div");
  bar.className = "perf-backbar";
  bar.innerHTML = `<button type="button" class="perf-back-team">← Back to my team</button>`;
  bar.querySelector("button").addEventListener("click", () => {
    viewingReportCode = null;
    loadSelf();
    document.querySelector(".perf-page")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  section.prepend(bar);
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

async function apiPut(path, body) {
  const res = await fetch(`${TM_BASE}${path}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify(body)
  });
  if (res.status === 401) {
    sessionStorage.setItem("hub_pre_login_url", window.location.href);
    window.location.href = "/login.html";
    throw new Error("Redirecting to login");
  }
  if (res.status === 403) throw new Error("FORBIDDEN");
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---- Target editor (HR / SUPER only) ------------------------

// Re-fetch whatever card is currently shown (self / drilled report / admin-selected).
function reloadCurrent() {
  if (selfMode) {
    if (viewingReportCode) openReport(viewingReportCode);
    else loadSelf();
  } else if (selectedCode) {
    loadAndRender();
  }
}

async function getLevels() {
  if (levelOptions) return levelOptions;
  try { levelOptions = await apiFetch("/api/reports/performance/levels"); }
  catch { levelOptions = []; }
  return levelOptions;
}

async function openTargetEditor(card) {
  const host = document.getElementById("perf-edit-form");
  if (!host) return;
  if (host.dataset.open === "1") { host.innerHTML = ""; host.dataset.open = "0"; return; }

  const levels = await getLevels();
  const opts = levels.map(l =>
    `<option value="${escapeHtml(l.level)}" data-week="${l.target_hrs_week}" data-month="${l.target_hrs_month}" ${l.level === card.level ? "selected" : ""}>${escapeHtml(l.level)}</option>`
  ).join("");

  host.innerHTML = `
    <div class="perf-edit">
      <div class="perf-edit-grid">
        <label>Level<select id="pe-level">${opts}</select></label>
        <label>Target h/week<input id="pe-week" type="number" step="0.01" min="0" value="${(card.targetHrsWeek ?? 0)}"></label>
        <label>Target h/month<input id="pe-month" type="number" step="0.01" min="0" value="${(card.targetHrsMonth ?? 0)}"></label>
        <label>Location<input id="pe-loc" type="text" value="${escapeHtml(card.location || "")}"></label>
      </div>
      <div class="perf-edit-actions">
        <button type="button" class="perf-edit-save" id="pe-save">Save</button>
        <button type="button" class="perf-edit-cancel" id="pe-cancel">Cancel</button>
        <span class="perf-edit-msg" id="pe-msg"></span>
      </div>
    </div>`;
  host.dataset.open = "1";

  // Selecting a level pre-fills that level's default hours (still overridable).
  document.getElementById("pe-level")?.addEventListener("change", (e) => {
    const o = e.target.selectedOptions[0];
    if (!o) return;
    const w = o.getAttribute("data-week"), m = o.getAttribute("data-month");
    if (w != null && w !== "null") document.getElementById("pe-week").value = Number(w).toFixed(4);
    if (m != null && m !== "null") document.getElementById("pe-month").value = Number(m).toFixed(4);
  });
  document.getElementById("pe-cancel")?.addEventListener("click", () => { host.innerHTML = ""; host.dataset.open = "0"; });
  document.getElementById("pe-save")?.addEventListener("click", () => saveTarget(card.esoftCode));
}

async function saveTarget(code) {
  const msg = document.getElementById("pe-msg");
  const level = document.getElementById("pe-level")?.value;
  const week = document.getElementById("pe-week")?.value;
  const month = document.getElementById("pe-month")?.value;
  const loc = document.getElementById("pe-loc")?.value;
  if (!level) { if (msg) msg.textContent = "Level is required"; return; }
  if (msg) msg.textContent = "Saving…";
  try {
    await apiPut(`/api/reports/performance/target/${encodeURIComponent(code)}`,
      { level, targetHrsWeek: week, targetHrsMonth: month, location: loc });
    reloadCurrent();
  } catch (e) {
    if (msg) msg.textContent = e.message === "FORBIDDEN" ? "Not allowed" : ("Error: " + e.message);
  }
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
        ${canEdit ? `
        <div class="perf-edit-wrap">
          <button type="button" class="perf-edit-btn" id="perf-edit-btn">&#9998; Edit target</button>
          <div id="perf-edit-form"></div>
        </div>` : ""}
      </div>
      <div class="perf-gauge-wrap">
        <div class="perf-pct ${card.badge}">${card.chargeabilityPct.toFixed(1)}%</div>
        <span class="perf-badge ${card.badge}">${card.badge}</span>
      </div>
    </div>`;

  if (canEdit) {
    document.getElementById("perf-edit-btn")
      ?.addEventListener("click", () => openTargetEditor(card));
  }
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

  // Both tiers drill into a report's full detail: FULL admins via /{code}, STANDARD
  // managers via /report/{code} (their own reports only). Routed by onReportClick.
  const drill = true;
  const cardsHtml = reports.map(r => {
    const pctDisplay = r.badge === "EXEMPT"
      ? `<div class="perf-mini-pct EXEMPT">Exempt</div>`
      : `<div class="perf-mini-pct ${r.badge}">${r.chargeabilityPct.toFixed(1)}%</div>
         <span class="perf-badge ${r.badge}" style="font-size:10px;">${r.badge}</span>`;
    const drillAttrs = drill
      ? ` clickable" data-code="${escapeHtml(r.esoftCode)}" role="button" tabindex="0" title="Open ${escapeHtml(r.employeeName)}'s performance" style="cursor:pointer`
      : "";
    return `
      <div class="perf-mini-card${drillAttrs}">
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

  // Bind click-to-open directly on each freshly-rendered card (robust against re-renders)
  section.querySelectorAll(".perf-mini-card[data-code]").forEach(cardEl => {
    const go = () => onReportClick(cardEl.getAttribute("data-code"));
    cardEl.addEventListener("click", go);
    cardEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
    });
  });
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
