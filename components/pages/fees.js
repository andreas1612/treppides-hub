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

import { escapeHtml, renderError } from "../../utils/dom.js?v=2";
import { setStatus }               from "../shell/topbar.js";
import CONFIG                      from "../../config.js?v=1";

// ---- DOM IDs -------------------------------------------------------
const SECTION_ID   = "section-fees";
const KPI_ID       = "fees-kpi";
const TABS_ID      = "fees-tabs";
const TOGGLE_ID    = "fees-view-toggle";
const CHART_ID     = "fees-chart-area";
const TABLE_ID     = "fees-drilldown";
const REFRESH_ID   = "fees-refresh";
const EXPORT_ID    = "fees-export";
const ADD_ID       = "fees-add";
const ADD_LABEL_ID = "fees-add-label";
const BACK_ID      = "fees-back-btn";

// AML list key → the backend form key that creates a task in that list.
const LIST_FORM_KEY = {
  new:        "new_client",
  rejected:   "rejected_client",
  disengaged: "disengaged_client",
};

// Per-list button label — matches the client type the form adds.
const ADD_LABEL = {
  new:        "Add New Client",
  rejected:   "Add Rejected Client",
  disengaged: "Add Disengaged Client",
};

// ---- Palette -------------------------------------------------------
// Fixed colors for known client-status values (used on the "new" list).
const FIXED_COLORS = {
  Existing: { bg: "#4A90D9", border: "#3A7BC8" },
  New:      { bg: "#48BB78", border: "#38A169" },
};
const UNKNOWN_COLOR = { bg: "#A0AEC0", border: "#718096" };

// Palette for dynamic breakdown values (rejection reasons, disengagement
// reasons — anything that varies per list and isn't a fixed status).
// Order picked so the first few values are visually distinct from the
// "Existing/New" blue/green pair on the new-client view.
const PALETTE = [
  { bg: "#9F7AEA", border: "#805AD5" },  // purple
  { bg: "#ED8936", border: "#DD6B20" },  // orange
  { bg: "#38B2AC", border: "#319795" },  // teal
  { bg: "#F56565", border: "#E53E3E" },  // red
  { bg: "#667EEA", border: "#5A67D8" },  // indigo
  { bg: "#ECC94B", border: "#D69E2E" },  // yellow
  { bg: "#48BB78", border: "#38A169" },  // green
  { bg: "#4A90D9", border: "#3A7BC8" },  // blue
  { bg: "#FC8181", border: "#F56565" },  // coral
];

// Stable value → color mapping for the active list. Computed once per load
// (see rebuildBreakdownColors) so colors don't shuffle as the user clicks
// between month/year tabs.
let _breakdownColors = new Map();

function colorFor(value) {
  return _breakdownColors.get(value) || UNKNOWN_COLOR;
}

function rebuildBreakdownColors(values) {
  _breakdownColors = new Map();
  let paletteIdx = 0;
  for (const v of values) {
    if (v === "Unknown") {
      _breakdownColors.set(v, UNKNOWN_COLOR);
    } else if (FIXED_COLORS[v]) {
      _breakdownColors.set(v, FIXED_COLORS[v]);
    } else {
      _breakdownColors.set(v, PALETTE[paletteIdx % PALETTE.length]);
      paletteIdx++;
    }
  }
}

// Hex → rgba string. Used to derive the tinted badge background from a
// palette colour so badges share visual language with chart bars.
function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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

// AML list metadata — drives page title, subtitle, CSV filename, and the
// custom field each list breaks fees down by (stacked-bar segments + KPIs).
//
//   breakdownField — snake_cased ClickUp custom field key on the task row.
//   breakdownLabel — human label used in headings, legends, KPI labels.
const LIST_META = {
  new: {
    title: "New Clients",
    subtitle: "AML Dashboard · Fees by client status",
    csv: "new-clients",
    breakdownField: "client_status",
    breakdownLabel: "Client Status",
  },
  rejected: {
    title: "Rejected Clients",
    subtitle: "AML Dashboard · Fees by rejection reason",
    csv: "rejected-clients",
    breakdownField: "rejection_reason",
    breakdownLabel: "Rejection Reason",
  },
  disengaged: {
    title: "Disengaged Clients",
    subtitle: "AML Dashboard · Fees by disengagement reason",
    csv: "disengaged-clients",
    breakdownField: "disengaged_reason",
    breakdownLabel: "Disengaged Reason",
  },
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

// ---- Breakdown helpers ----------------------------------------------
//
// The chart and KPIs are broken down by a per-list custom field
// (client_status / rejection_reason / disengaged_reason).
//
// `breakdownKey(row)` returns the normalised value for a row, mapping
// missing/blank entries to "Unknown" so they form their own series.

function activeMeta() {
  return LIST_META[_activeList] || LIST_META[DEFAULT_LIST];
}

function activeBreakdownField() {
  return activeMeta().breakdownField;
}

function activeBreakdownLabel() {
  return activeMeta().breakdownLabel;
}

function breakdownKey(row) {
  const v = row[activeBreakdownField()];
  if (v === null || v === undefined || v === "" || v === "—") return "Unknown";
  return String(v);
}

// All distinct breakdown values across the tasks, sorted alphabetically,
// with "Unknown" pushed to the end so it never dominates the legend.
function distinctBreakdownValues(tasks) {
  const set = new Set(tasks.map(breakdownKey));
  const hasUnknown = set.delete("Unknown");
  const sorted = [...set].sort((a, b) => a.localeCompare(b));
  if (hasUnknown) sorted.push("Unknown");
  return sorted;
}

// Truncate a long label for compact display. Full text should go on a
// `title` attribute so hovering still reveals the original.
function truncate(s, max) {
  if (!s) return s;
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
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
  let totalFees = 0;
  const uboSet = new Set();
  const byBreakdown = new Map();   // breakdown value → summed fees

  for (const t of tasks) {
    totalFees += t.fees;
    uboSet.add(t.ubo);
    const key = breakdownKey(t);
    byBreakdown.set(key, (byBreakdown.get(key) || 0) + t.fees);
  }

  const meta  = activeMeta();
  const label = meta.breakdownLabel;

  // List-specific middle cards.
  //   "new"  → Existing Clients / New Clients (preserve original UX)
  //   else   → Top {Reason} (€ value) / # of distinct reasons
  let middleCards;
  if (_activeList === "new") {
    const existingFees = byBreakdown.get("Existing") || 0;
    const newFees      = byBreakdown.get("New")      || 0;
    middleCards = `
      <div class="fees-kpi-card">
        <span class="fees-kpi-label">Existing Clients</span>
        <span class="fees-kpi-value">${fmtCurrency(existingFees)}</span>
        <span class="fees-kpi-sub">Recurring revenue</span>
      </div>
      <div class="fees-kpi-card">
        <span class="fees-kpi-label">New Clients</span>
        <span class="fees-kpi-value">${fmtCurrency(newFees)}</span>
        <span class="fees-kpi-sub">New business</span>
      </div>`;
  } else {
    // Skip "Unknown" when picking the top reason — it's noise, not insight.
    const ranked = [...byBreakdown.entries()]
      .filter(([k]) => k !== "Unknown")
      .sort((a, b) => b[1] - a[1]);
    const topName = ranked[0]?.[0] ?? "—";
    const topFees = ranked[0]?.[1] ?? 0;
    const distinct = ranked.length;
    const topNameDisplay = truncate(topName, 28);

    middleCards = `
      <div class="fees-kpi-card">
        <span class="fees-kpi-label">Top ${escapeHtml(label)}</span>
        <span class="fees-kpi-value">${fmtCurrency(topFees)}</span>
        <span class="fees-kpi-sub" title="${escapeHtml(topName)}">${escapeHtml(topNameDisplay)}</span>
      </div>
      <div class="fees-kpi-card">
        <span class="fees-kpi-label">${escapeHtml(label)}s</span>
        <span class="fees-kpi-value">${distinct}</span>
        <span class="fees-kpi-sub">Distinct values</span>
      </div>`;
  }

  return `
    <div class="fees-kpi-row" id="${KPI_ID}">
      <div class="fees-kpi-card">
        <span class="fees-kpi-label">Total Fees</span>
        <span class="fees-kpi-value accent">${fmtCurrency(totalFees)}</span>
        <span class="fees-kpi-sub">Across ${_months.length} month${_months.length !== 1 ? "s" : ""}</span>
      </div>
      ${middleCards}
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
  const scopeTasks = tasksForActiveScope();
  const series = distinctBreakdownValues(scopeTasks);

  // entity → { breakdownValue: feeSum, ... }
  const map = new Map();
  for (const t of scopeTasks) {
    const key = groupKey(t);
    if (!map.has(key)) {
      const empty = {};
      for (const s of series) empty[s] = 0;
      map.set(key, empty);
    }
    map.get(key)[breakdownKey(t)] += t.fees;
  }

  const totalFor = obj => series.reduce((s, k) => s + (obj[k] || 0), 0);
  const sorted = Array.from(map.entries())
    .sort((a, b) => totalFor(b[1]) - totalFor(a[1]));

  return {
    labels: sorted.map(([n]) => n),
    entityMap: new Map(sorted),
    series,
  };
}

// ---- Chart rendering ------------------------------------------------

function renderChart() {
  const container = document.getElementById(CHART_ID);
  if (!container) return;

  if (_activeChart) { _activeChart.destroy(); _activeChart = null; }

  const { labels, entityMap, series } = groupForChart();

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

  // Always stack the breakdown datasets. If we let Chart.js group them
  // side-by-side (when no entity has more than one breakdown value), each
  // row's slot gets split into sub-slots — bars render at half thickness
  // and shift off the y-axis tick. Stacking makes every row a single
  // full-thickness bar with one segment per breakdown value present.
  const needsStack = true;

  // Pre-truncate labels for display; keep full names for tooltips.
  // Truncating in chart.data (rather than via ticks.callback) is more
  // reliable — Chart.js otherwise sometimes fails to render axis labels.
  const MAX_LABEL = 24;
  const displayLabels = labels.map(l =>
    l && l.length > MAX_LABEL ? l.slice(0, MAX_LABEL - 1) + "…" : l
  );
  const fullLabels = labels.slice();

  // One stacked dataset per breakdown value present in the data.
  // Empty series are filtered out so the legend doesn't list zero-value bars.
  const datasets = series.map(val => {
    const c = colorFor(val);
    return {
      label: val,
      data: labels.map(l => entityMap.get(l)?.[val] || 0),
      backgroundColor: c.bg,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 4,
      borderSkipped: false,
      barPercentage: 0.85,
      categoryPercentage: 0.85,
      maxBarThickness: 32,
    };
  }).filter(ds => ds.data.some(v => v > 0));

  const chartHeight = Math.max(260, labels.length * 46 + 100);

  // Legend swatches use inline colors so any breakdown value renders correctly
  // (rejection reasons, disengagement reasons — not just Existing/New).
  const MAX_LEGEND_LABEL = 28;
  const legendHtml = series.map(val => {
    const c = colorFor(val);
    const display = truncate(val, MAX_LEGEND_LABEL);
    return `<span class="fees-legend-item" title="${escapeHtml(val)}">
        <span class="fees-legend-swatch" style="background:${c.bg}"></span>${escapeHtml(display)}
      </span>`;
  }).join("");

  container.innerHTML = `
    <div class="fees-chart-wrapper">
      <div class="fees-chart-title">
        Fees by ${escapeHtml(groupLabel())} · ${escapeHtml(activeBreakdownLabel())}
        <span class="month-badge">${escapeHtml(activeScopeLabel())}</span>
      </div>
      <div class="fees-chart-canvas-container" style="height:${chartHeight}px">
        <canvas id="fees-canvas"></canvas>
      </div>
      <div class="fees-legend">${legendHtml}</div>
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

// Curated column order and labels for fields we know about across lists.
// Any custom field present in the data but missing here (e.g. fields that
// only exist on the Rejected or Disengaged ClickUp lists) is appended
// automatically with a humanised label, so every list shows the full task.
const KNOWN_COLUMNS = [
  { key: "task_name",                   label: "Task Name" },
  { key: "ubo",                         label: "UBO" },
  { key: "group_name",                  label: "Group Name" },
  { key: "managing_company",            label: "Managing Company" },
  { key: "engagement_leader",           label: "Assignee" },
  { key: "supervisor___manager",        label: "Supervisor" },
  { key: "client_status",               label: "Client Status" },
  { key: "service",                     label: "Service" },
  { key: "departement",                 label: "Department" },
  { key: "categorization",              label: "Categorization" },
  { key: "introducer",                  label: "Introducer" },
  { key: "cross_sell_to",               label: "Cross-sell To" },
  { key: "new_clients_details",         label: "New Client Details" },
  { key: "newgroup",                    label: "New Group?" },
  { key: "meeting_with_natural_person", label: "Meeting Date" },
];

// Always render Fees last — it's the currency column the rest of the UI keys off.
const FEES_COLUMN = { key: "fees", label: "Fees", isCurrency: true };

// Internal fields that are derived/used for grouping; never show as columns.
const HIDDEN_KEYS = new Set(["month", "year", "month_year"]);

// Computed at load time from the active list's data.
let _drillColumns = [...KNOWN_COLUMNS, FEES_COLUMN];

function humanizeKey(key) {
  return String(key)
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function looksLikeCurrencyKey(key, tasks) {
  if (!/(fee|amount|price|cost|revenue|charge)/i.test(key)) return false;
  return tasks.some(t => typeof t[key] === "number");
}

/**
 * Build the drill-down column list from the loaded tasks.
 *   - Known fields keep their curated order and label.
 *   - Any additional custom fields surfaced by ClickUp are appended with a
 *     humanised label so list-specific data (rejection reason,
 *     disengagement date, etc.) is shown without code changes.
 *   - "fees" is always pinned last.
 */
function buildDrillColumns(tasks) {
  const known = new Set(KNOWN_COLUMNS.map(c => c.key));
  const reserved = new Set([...known, FEES_COLUMN.key, ...HIDDEN_KEYS]);

  const extras = new Set();
  for (const t of tasks) {
    for (const k of Object.keys(t)) {
      if (!reserved.has(k)) extras.add(k);
    }
  }

  const extraCols = [...extras].sort().map(k => ({
    key: k,
    label: humanizeKey(k),
    isCurrency: looksLikeCurrencyKey(k, tasks),
  }));

  return [...KNOWN_COLUMNS, ...extraCols, FEES_COLUMN];
}

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
  // Colour-coded badge for the active breakdown field — same palette as the
  // chart, so client_status / rejection_reason / disengaged_reason cells all
  // render consistently with the stacked bars above.
  if (col.key === activeBreakdownField()) {
    const v = String(value);
    const c = _breakdownColors.get(v) || UNKNOWN_COLOR;
    const bg = hexToRgba(c.bg, 0.14);
    return `<span class="fees-status-badge" style="background:${bg};color:${c.border}" title="${escapeHtml(v)}">${escapeHtml(v)}</span>`;
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
  const activeCols = _drillColumns.filter(col =>
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

  const header = _drillColumns.map(c => csvCell(c.label)).join(",");
  const rows   = scopeTasks.map(task =>
    _drillColumns.map(col => {
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

  // Keep the "Add …" button label in sync with the active list.
  const addLabelEl = document.getElementById(ADD_LABEL_ID);
  if (addLabelEl) addLabelEl.textContent = ADD_LABEL[_activeList] || "Add Client";

  try {
    await loadChartJs();

    const apiData = await fetchFeesData(forceRefresh);
    _rawTasks = apiData.tasks || [];
    _months   = apiData.months || [];
    _years    = uniqueYears(_months);
    _drillColumns = buildDrillColumns(_rawTasks);
    rebuildBreakdownColors(distinctBreakdownValues(_rawTasks));

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
          <button class="btn-refresh fees-add-btn" id="${ADD_ID}" aria-label="Add a new client via form">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span id="${ADD_LABEL_ID}">Add Client</span>
          </button>
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
    window.__hub_router?.navigate("/crm/aml");
  });

  // Export CSV button
  document.getElementById(EXPORT_ID)?.addEventListener("click", exportCsv);

  // Add Client button — opens the matching AML form (creates a ClickUp task
  // in this same list). Back from the form returns to this dashboard.
  document.getElementById(ADD_ID)?.addEventListener("click", () => {
    const formKey = LIST_FORM_KEY[_activeList];
    if (!formKey) return;
    hideFeesPage();
    window.__hub_forms?.openForm(formKey, "aml");
  });

  // Refresh button
  document.getElementById(REFRESH_ID)?.addEventListener("click", () => load(true));

  // Note: no auto-fetch — load() is triggered by window.__hub_fees.show(listKey)
  // when the user clicks a card on the AML landing page.
}
