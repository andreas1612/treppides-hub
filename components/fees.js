// ============================================================
// components/fees.js
// "New Client UBO Fees" — dedicated full-page dashboard (v3).
//
// Architecture:
//   Backend returns full flat dataset with ALL custom fields.
//   All grouping, filtering, aggregation happens here.
//
// View behaviour:
//   The fees dashboard lives in its own full-page view.
//   When activated via sidebar, .page-content is hidden and
//   #section-fees becomes visible.  A "← Back to Hub" button
//   returns to the main hub view.
//
// Mounts into: #section-fees (sibling of .page-content)
// ============================================================

import { escapeHtml, renderError } from "../utils/dom.js";
import { setStatus }               from "./topbar.js";
import CONFIG                      from "../config.js";

// ---- DOM IDs -------------------------------------------------------
const SECTION_ID   = "section-fees";
const KPI_ID       = "fees-kpi";
const TABS_ID      = "fees-tabs";
const TOGGLE_ID    = "fees-view-toggle";
const CHART_ID     = "fees-chart-area";
const TABLE_ID     = "fees-drilldown";
const REFRESH_ID   = "fees-refresh";
const EXPORT_ID    = "fees-export";
const BACK_ID      = "fees-back-btn";

// ---- Palette -------------------------------------------------------
const COLORS = {
  Existing: { bg: "#4A90D9", border: "#3A7BC8" },
  New:      { bg: "#48BB78", border: "#38A169" },
  Unknown:  { bg: "#A0AEC0", border: "#718096" },
};

// ---- State ---------------------------------------------------------
//
// _activeScope holds whichever filter the user has selected:
//   - a month_year string  ("April 2025")
//   - a year sentinel       ("__year__:2025")
//
// Year sentinels are derived client-side from the months in the data, so
// year aggregate tabs appear automatically as new years show up in ClickUp.

const YEAR_PREFIX = "__year__:";
const isYearScope   = s => typeof s === "string" && s.startsWith(YEAR_PREFIX);
const yearOfScope   = s => s.slice(YEAR_PREFIX.length);
const makeYearScope = y => `${YEAR_PREFIX}${y}`;

// AML list metadata — drives page title, subtitle, and CSV filename.
const LIST_META = {
  new:        { title: "New Clients",        subtitle: "AML Dashboard · Monthly fee breakdown", csv: "new-clients" },
  rejected:   { title: "Rejected Clients",   subtitle: "AML Dashboard · Monthly fee breakdown", csv: "rejected-clients" },
  disengaged: { title: "Disengaged Clients", subtitle: "AML Dashboard · Monthly fee breakdown", csv: "disengaged-clients" },
};
const DEFAULT_LIST = "new";

let _rawTasks    = [];
let _months      = [];
let _years       = [];
let _activeScope = "";          // month_year or year sentinel
let _activeList  = DEFAULT_LIST;
let _viewMode    = "ubo";       // "ubo" | "company"
let _activeChart = null;

function activeScopeLabel() {
  return isYearScope(_activeScope) ? yearOfScope(_activeScope) : _activeScope;
}

function tasksForActiveScope() {
  if (isYearScope(_activeScope)) {
    const yr = yearOfScope(_activeScope);
    return _rawTasks.filter(t => extractYear(t.month_year) === yr);
  }
  return _rawTasks.filter(t => t.month_year === _activeScope);
}

// Extract the trailing 4-digit year from a "Month YYYY" string.
function extractYear(monthYear) {
  const m = String(monthYear || "").match(/(\d{4})\s*$/);
  return m ? m[1] : null;
}

function uniqueYears(months) {
  const seen = new Set();
  for (const m of months) {
    const y = extractYear(m);
    if (y) seen.add(y);
  }
  return [...seen].sort();
}

// ---- Chart.js CDN loader -------------------------------------------

let _chartJsLoaded = false;

function loadChartJs() {
  if (_chartJsLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s1 = document.createElement("script");
    s1.src = "/vendor/chart.umd.min.js";
    s1.onload = () => {
      const s2 = document.createElement("script");
      s2.src = "/vendor/chartjs-plugin-datalabels.min.js";
      s2.onload = () => { _chartJsLoaded = true; resolve(); };
      s2.onerror = () => reject(new Error("Failed to load chartjs-plugin-datalabels"));
      document.head.appendChild(s2);
    };
    s1.onerror = () => reject(new Error("Failed to load Chart.js"));
    document.head.appendChild(s1);
  });
}

// ---- Helpers --------------------------------------------------------

function fmtCurrency(val) {
  return "€" + val.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function renderSkeleton() {
  const bars = Array.from({ length: 6 }, () => {
    const w = 40 + Math.random() * 55;
    return `<div class="fees-skel-bar" style="width:${w}%"></div>`;
  }).join("");
  return `<div class="fees-skeleton">${bars}</div>`;
}

/**
 * Returns the grouping key for the current view mode.
 * "ubo"     → row.ubo          (Ultimate Beneficial Owner)
 * "company" → row.task_name     (the company/entity name in ClickUp)
 */
function groupKey(row) {
  return _viewMode === "company" ? row.task_name : row.ubo;
}

function groupLabel() {
  return _viewMode === "company" ? "Company" : "UBO";
}

// ---- Page visibility toggle -----------------------------------------

/**
 * Show the fees dashboard for the given AML list. If no list is passed,
 * keep whichever was previously loaded; if none, default to "new".
 * If the list changed (or no data is loaded yet) we re-fetch.
 */
function showFeesPage(listKey) {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove("aml-active", "staff-active");
  main.classList.add("fees-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "fees" } }));

  const wantedList = listKey || _activeList || DEFAULT_LIST;
  const listChanged = wantedList !== _activeList || _rawTasks.length === 0;
  _activeList = wantedList;
  if (listChanged) load();
}

/**
 * Hide the fees dashboard. Returns to the AML landing if it was the entry
 * point; otherwise to the hub home (the AML hide logic is owned by aml.js,
 * so we only clear our own class here).
 */
function hideFeesPage() {
  document.querySelector(".main")?.classList.remove("fees-active");
}

window.__hub_fees = { show: showFeesPage, hide: hideFeesPage };

// ---- KPI cards ------------------------------------------------------

function renderKPIs(tasks) {
  let totalFees = 0, existingFees = 0, newFees = 0;
  const uboSet = new Set();

  for (const t of tasks) {
    totalFees += t.fees;
    uboSet.add(t.ubo);
    if (t.client_status === "Existing") existingFees += t.fees;
    else if (t.client_status === "New") newFees += t.fees;
  }

  return `
    <div class="fees-kpi-row" id="${KPI_ID}">
      <div class="fees-kpi-card">
        <span class="fees-kpi-label">Total Fees</span>
        <span class="fees-kpi-value accent">${fmtCurrency(totalFees)}</span>
        <span class="fees-kpi-sub">Across ${_months.length} month${_months.length !== 1 ? "s" : ""}</span>
      </div>
      <div class="fees-kpi-card">
        <span class="fees-kpi-label">Existing Clients</span>
        <span class="fees-kpi-value">${fmtCurrency(existingFees)}</span>
        <span class="fees-kpi-sub">Recurring revenue</span>
      </div>
      <div class="fees-kpi-card">
        <span class="fees-kpi-label">New Clients</span>
        <span class="fees-kpi-value">${fmtCurrency(newFees)}</span>
        <span class="fees-kpi-sub">New business</span>
      </div>
      <div class="fees-kpi-card">
        <span class="fees-kpi-label">Unique UBOs</span>
        <span class="fees-kpi-value">${uboSet.size}</span>
        <span class="fees-kpi-sub">Distinct beneficial owners</span>
      </div>
    </div>`;
}

// ---- Month tabs -----------------------------------------------------

function renderTabs() {
  const monthTabs = _months
    .map(m => {
      const cls = m === _activeScope ? "fees-tab active" : "fees-tab";
      return `<button class="${cls}" data-scope="${escapeHtml(m)}">${escapeHtml(m)}</button>`;
    })
    .join("");

  const yearTabs = _years
    .map(y => {
      const scope = makeYearScope(y);
      const active = scope === _activeScope ? " active" : "";
      return `<button class="fees-tab fees-tab-year${active}" data-scope="${escapeHtml(scope)}">${escapeHtml(y)}</button>`;
    })
    .join("");

  return `<div class="fees-tabs" id="${TABS_ID}">${monthTabs}${yearTabs}</div>`;
}

// ---- View toggle ----------------------------------------------------

function renderToggle() {
  const uboActive = _viewMode === "ubo" ? " active" : "";
  const coActive  = _viewMode === "company" ? " active" : "";
  return `
    <div class="fees-toggle" id="${TOGGLE_ID}">
      <span class="fees-toggle-label">Group by:</span>
      <button class="fees-toggle-btn${uboActive}" data-view="ubo">Per UBO</button>
      <button class="fees-toggle-btn${coActive}" data-view="company">Per Company</button>
    </div>`;
}

// ---- Data grouping --------------------------------------------------

function groupForChart() {
  const monthTasks = tasksForActiveScope();
  const map = new Map();
  for (const t of monthTasks) {
    const key = groupKey(t);
    if (!map.has(key)) map.set(key, { Existing: 0, New: 0 });
    const entry = map.get(key);
    const status = (t.client_status === "Existing" || t.client_status === "New")
      ? t.client_status : "Existing";
    entry[status] += t.fees;
  }

  const sorted = Array.from(map.entries())
    .sort((a, b) => (b[1].Existing + b[1].New) - (a[1].Existing + a[1].New));

  return { labels: sorted.map(([n]) => n), entityMap: new Map(sorted) };
}

// ---- Chart rendering ------------------------------------------------

function renderChart() {
  const container = document.getElementById(CHART_ID);
  if (!container) return;

  if (_activeChart) { _activeChart.destroy(); _activeChart = null; }

  const { labels, entityMap } = groupForChart();

  if (!labels.length) {
    container.innerHTML = `
      <div class="fees-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="3" y1="9" x2="21" y2="9"/>
          <line x1="9" y1="21" x2="9" y2="9"/>
        </svg>
        <h3>No data for ${escapeHtml(activeScopeLabel())}</h3>
        <p>No tasks with fee data were found for this ${isYearScope(_activeScope) ? "year" : "month"}.</p>
      </div>`;
    return;
  }

  // Always stack the two client-status datasets. If we let Chart.js group
  // them side-by-side (when no entity has BOTH statuses), every row's slot
  // gets split into two sub-slots — bars render at half thickness and shift
  // off the y-axis tick, leaving labels misaligned. Stacking makes every
  // row a single full-thickness bar (one segment if single status, two
  // segments if both).
  const needsStack = true;

  // Pre-truncate labels for display; keep full names for tooltips.
  // Truncating in chart.data (rather than via ticks.callback) is more
  // reliable — Chart.js otherwise sometimes fails to render axis labels.
  const MAX_LABEL = 24;
  const displayLabels = labels.map(l =>
    l && l.length > MAX_LABEL ? l.slice(0, MAX_LABEL - 1) + "…" : l
  );
  const fullLabels = labels.slice();

  const datasets = ["Existing", "New"].map(status => ({
    label: status,
    data: labels.map(l => entityMap.get(l)?.[status] || 0),
    backgroundColor: COLORS[status].bg,
    borderColor: COLORS[status].border,
    borderWidth: 1,
    borderRadius: 4,
    borderSkipped: false,
    barPercentage: 0.85,
    categoryPercentage: 0.85,
    maxBarThickness: 32,
  })).filter(ds => ds.data.some(v => v > 0));

  const chartHeight = Math.max(260, labels.length * 46 + 100);

  container.innerHTML = `
    <div class="fees-chart-wrapper">
      <div class="fees-chart-title">
        Fees by ${escapeHtml(groupLabel())}
        <span class="month-badge">${escapeHtml(activeScopeLabel())}</span>
      </div>
      <div class="fees-chart-canvas-container" style="height:${chartHeight}px">
        <canvas id="fees-canvas"></canvas>
      </div>
      <div class="fees-legend">
        <span class="fees-legend-item">
          <span class="fees-legend-swatch existing"></span> Existing Client
        </span>
        <span class="fees-legend-item">
          <span class="fees-legend-swatch new"></span> New Client
        </span>
      </div>
      <p class="fees-chart-hint">Click a bar to see detailed entries below</p>
    </div>`;

  const ctx = document.getElementById("fees-canvas").getContext("2d");

  _activeChart = new Chart(ctx, {
    type: "bar",
    data: { labels: displayLabels, datasets },
    plugins: [ChartDataLabels],
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 80 } },
      scales: {
        x: {
          stacked: needsStack,
          beginAtZero: true,
          grid: { color: "rgba(0,0,0,.05)", drawBorder: false },
          ticks: { callback: v => fmtCurrency(v), font: { size: 11, weight: "500" }, color: "#718096" },
          title: { display: true, text: "Total Fees (€)", font: { size: 12, weight: "600" }, color: "#718096", padding: { top: 12 } },
        },
        y: {
          stacked: needsStack,
          grid: { display: false },
          ticks: {
            font: { size: 12, weight: "600" },
            color: "#1a202c",
            autoSkip: false,
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1a1f2e",
          titleFont: { size: 13, weight: "700" },
          bodyFont: { size: 12 },
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            title: items => items.length ? fullLabels[items[0].dataIndex] : "",
            label: ctx => `${ctx.dataset.label}: ${fmtCurrency(ctx.raw)}`,
          },
        },
        datalabels: {
          anchor: "end", align: "right", offset: 6,
          font: { size: 11, weight: "700" }, color: "#4A5568",
          display(ctx) {
            if (!needsStack) return ctx.dataset.data[ctx.dataIndex] > 0;
            const dss = ctx.chart.data.datasets; const idx = ctx.dataIndex;
            let last = -1;
            for (let d = 0; d < dss.length; d++) { if (dss[d].data[idx] > 0) last = d; }
            return ctx.datasetIndex === last;
          },
          formatter(val, ctx) {
            if (!needsStack) return val > 0 ? fmtCurrency(val) : "";
            const dss = ctx.chart.data.datasets; const idx = ctx.dataIndex;
            let last = -1;
            for (let d = 0; d < dss.length; d++) { if (dss[d].data[idx] > 0) last = d; }
            if (ctx.datasetIndex !== last) return "";
            const total = dss.reduce((s, ds) => s + (ds.data[idx] || 0), 0);
            return total > 0 ? fmtCurrency(total) : "";
          },
        },
      },
      onClick(_evt, elements) {
        if (!elements.length) return;
        const idx = elements[0].index;
        showDrillDown(labels[idx]);
      },
      animation: { duration: 600, easing: "easeOutQuart" },
    },
  });
}

// ---- Drill-down table -----------------------------------------------

// Fields to display in the drill-down table and their display labels.
// Order matters — this is the column order.
// Key must match the snake_case field key from the backend.
const DRILL_COLUMNS = [
  { key: "task_name",                 label: "Task Name" },
  { key: "ubo",                       label: "UBO" },
  { key: "group_name",                label: "Group Name" },
  { key: "managing_company",          label: "Managing Company" },
  { key: "engagement_leader",         label: "Assignee" },
  { key: "supervisor___manager",      label: "Supervisor" },
  { key: "client_status",             label: "Client Status" },
  { key: "service",                   label: "Service" },
  { key: "departement",               label: "Department" },
  { key: "categorization",            label: "Categorization" },
  { key: "introducer",                label: "Introducer" },
  { key: "cross_sell_to",             label: "Cross-sell To" },
  { key: "new_clients_details",       label: "New Client Details" },
  { key: "newgroup",                  label: "New Group?" },
  { key: "meeting_with_natural_person", label: "Meeting Date" },
  { key: "fees",                      label: "Fees",           isCurrency: true },
];

/**
 * Format a cell value for display.
 * Handles currency, status badges, null/dash values.
 */
function formatCell(col, value) {
  if (value === null || value === undefined || value === "" || value === "—") {
    return `<span class="fees-cell-null">—</span>`;
  }
  if (col.isCurrency) {
    return fmtCurrency(value);
  }
  if (col.key === "client_status") {
    const cls = value === "New" ? "new" : "existing";
    return `<span class="fees-status-badge ${cls}">${escapeHtml(String(value))}</span>`;
  }
  return escapeHtml(String(value));
}

function showDrillDown(entityName) {
  const container = document.getElementById(TABLE_ID);
  if (!container) return;

  const filtered = tasksForActiveScope().filter(t => groupKey(t) === entityName);

  if (!filtered.length) {
    container.innerHTML = `
      <div class="fees-drilldown-card">
        <p class="fees-drilldown-empty">No detailed entries found for "${escapeHtml(entityName)}".</p>
      </div>`;
    return;
  }

  const totalFees = filtered.reduce((s, t) => s + t.fees, 0);

  // Determine which columns have data (skip entirely empty columns)
  const activeCols = DRILL_COLUMNS.filter(col =>
    filtered.some(t => {
      const v = t[col.key];
      return v !== null && v !== undefined && v !== "" && v !== "—";
    })
  );

  const headHtml = activeCols.map(col =>
    `<th${col.isCurrency ? ' class="num"' : ''}>${escapeHtml(col.label)}</th>`
  ).join("");

  const rowsHtml = filtered.map(t => {
    const cells = activeCols.map(col =>
      `<td${col.isCurrency ? ' class="num"' : ''}>${formatCell(col, t[col.key])}</td>`
    ).join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  // Footer: total in the last column (Fees)
  const feeColIdx = activeCols.findIndex(c => c.key === "fees");
  const footCells = activeCols.map((col, i) => {
    if (i === 0) return `<td><strong>Total</strong></td>`;
    if (i === feeColIdx) return `<td class="num"><strong>${fmtCurrency(totalFees)}</strong></td>`;
    return `<td></td>`;
  }).join("");

  container.innerHTML = `
    <div class="fees-drilldown-card">
      <div class="fees-drilldown-header">
        <div>
          <h3 class="fees-drilldown-title">${escapeHtml(entityName)}</h3>
          <p class="fees-drilldown-sub">${filtered.length} task${filtered.length !== 1 ? "s" : ""} · ${fmtCurrency(totalFees)} total · ${escapeHtml(activeScopeLabel())}</p>
        </div>
        <button class="fees-drilldown-close" id="fees-clear-drill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Clear
        </button>
      </div>
      <div class="fees-drilldown-scroll">
        <table class="fees-drilldown-table">
          <thead><tr>${headHtml}</tr></thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot><tr>${footCells}</tr></tfoot>
        </table>
      </div>
    </div>`;

  document.getElementById("fees-clear-drill")?.addEventListener("click", clearDrillDown);
  container.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearDrillDown() {
  const container = document.getElementById(TABLE_ID);
  if (container) {
    container.innerHTML = `
      <div class="fees-drilldown-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
        </svg>
        Click a bar above to see detailed entries
      </div>`;
  }
}

// ---- Master re-render -----------------------------------------------

function renderAll() {
  const toggleMount = document.getElementById(TOGGLE_ID);
  if (toggleMount) toggleMount.outerHTML = renderToggle();
  wireToggle();
  renderChart();
  clearDrillDown();
}

// ---- Event wiring ---------------------------------------------------

function wireTabs() {
  document.getElementById(TABS_ID)?.addEventListener("click", e => {
    const tab = e.target.closest(".fees-tab");
    if (!tab) return;
    document.querySelectorAll(".fees-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    _activeScope = tab.dataset.scope;
    renderAll();
  });
}

function wireToggle() {
  document.getElementById(TOGGLE_ID)?.addEventListener("click", e => {
    const btn = e.target.closest(".fees-toggle-btn");
    if (!btn) return;
    const view = btn.dataset.view;
    if (view === _viewMode) return;
    _viewMode = view;
    renderAll();
  });
}

// ---- Data fetching --------------------------------------------------

async function fetchFeesData(forceRefresh = false) {
  const baseUrl = CONFIG.CLICKUP_FEES_API || "http://localhost:8001/api/clickup/fees";
  const path    = forceRefresh ? `${baseUrl}/refresh` : baseUrl;
  const sep     = path.includes("?") ? "&" : "?";
  const url     = `${path}${sep}list=${encodeURIComponent(_activeList)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fees API error: HTTP ${resp.status}`);
  return resp.json();
}

// ---- CSV Export -----------------------------------------------------

function csvCell(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  // Wrap in quotes if contains comma, quote, or newline
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function exportCsv() {
  const scopeTasks = tasksForActiveScope();
  if (!scopeTasks.length) return;

  const header = DRILL_COLUMNS.map(c => csvCell(c.label)).join(",");
  const rows   = scopeTasks.map(task =>
    DRILL_COLUMNS.map(col => {
      const v = task[col.key];
      if (v === null || v === undefined || v === "—") return "";
      return csvCell(col.isCurrency ? v : String(v));
    }).join(",")
  );

  const csv  = [header, ...rows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  const listSlug  = LIST_META[_activeList]?.csv || _activeList;
  const scopeSlug = activeScopeLabel().replace(/\s+/g, "-").toLowerCase();
  a.download = `${listSlug}-${scopeSlug}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- Main load ------------------------------------------------------

async function load(forceRefresh = false) {
  const section    = document.getElementById(SECTION_ID);
  const chartArea  = document.getElementById(CHART_ID);
  const refreshBtn = document.getElementById(REFRESH_ID);
  const exportBtn  = document.getElementById(EXPORT_ID);
  if (!chartArea) return;

  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.classList.add("loading"); }
  if (exportBtn)  { exportBtn.disabled = true; }
  chartArea.innerHTML = `<div class="fees-chart-wrapper">${renderSkeleton()}</div>`;
  const kpi = document.getElementById(KPI_ID);
  if (kpi) kpi.innerHTML = "";
  setStatus("Fetching client fees…");

  // Update page header to match the active list
  const meta = LIST_META[_activeList] || LIST_META[DEFAULT_LIST];
  const titleEl    = section?.querySelector(".section-title");
  const subtitleEl = section?.querySelector(".section-subtitle");
  if (titleEl)    titleEl.textContent    = meta.title;
  if (subtitleEl) subtitleEl.textContent = meta.subtitle;

  try {
    await loadChartJs();

    const apiData = await fetchFeesData(forceRefresh);
    _rawTasks = apiData.tasks || [];
    _months   = apiData.months || [];
    _years    = uniqueYears(_months);

    if (!_months.length) {
      chartArea.innerHTML = `
        <div class="fees-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="9" y1="21" x2="9" y2="9"/>
          </svg>
          <h3>No fee data available</h3>
          <p>No tasks with fee data were found in this ClickUp list.</p>
        </div>`;
      setStatus("All systems operational");
      return;
    }

    _activeScope = _months[0];
    _viewMode = "ubo";

    const kpiMount = section.querySelector(`#${KPI_ID}`);
    if (kpiMount) kpiMount.outerHTML = renderKPIs(_rawTasks);

    const tabsMount = section.querySelector(`#${TABS_ID}`);
    if (tabsMount) tabsMount.outerHTML = renderTabs();
    wireTabs();

    const toggleMount = section.querySelector(`#${TOGGLE_ID}`);
    if (toggleMount) toggleMount.outerHTML = renderToggle();
    wireToggle();

    renderChart();
    clearDrillDown();

    if (exportBtn) { exportBtn.disabled = false; }
    setStatus("All systems operational");
  } catch (err) {
    console.error("[Hub] fees fetch error:", err);
    chartArea.innerHTML = renderError();
    setStatus("Fees data unreachable", true);
  } finally {
    if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.classList.remove("loading"); }
  }
}

// ---- Component init -------------------------------------------------

export default async function init(_config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  section.innerHTML = `
    <div class="hub-section fees-page">
      <div class="section-header">
        <div class="fees-header-left">
          <button class="fees-back-btn" id="${BACK_ID}" aria-label="Back to Hub">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <div>
            <h2 class="section-title">AML Dashboard</h2>
            <p class="section-subtitle">Pick a list from the AML Dashboard to load data</p>
          </div>
        </div>
        <div class="fees-header-actions">
          <button class="btn-refresh" id="${EXPORT_ID}" aria-label="Export fees as CSV" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export CSV
          </button>
          <button class="btn-refresh" id="${REFRESH_ID}" aria-label="Refresh fees data">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <div id="${KPI_ID}"></div>
      <div id="${TABS_ID}"></div>
      <div id="${TOGGLE_ID}"></div>
      <div id="${CHART_ID}"></div>

      <div id="${TABLE_ID}">
        <div class="fees-drilldown-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
          </svg>
          Click a bar above to see detailed entries
        </div>
      </div>
    </div>`;

  // Back button — return to AML landing (its own back button returns home)
  document.getElementById(BACK_ID)?.addEventListener("click", () => {
    hideFeesPage();
    if (window.__hub_aml) window.__hub_aml.show();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // Export CSV button
  document.getElementById(EXPORT_ID)?.addEventListener("click", exportCsv);

  // Refresh button
  document.getElementById(REFRESH_ID)?.addEventListener("click", () => load(true));

  // Note: no auto-fetch — load() is triggered by window.__hub_fees.show(listKey)
  // when the user clicks a card on the AML landing page.
}
