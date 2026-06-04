// ============================================================
// components/pages/companies.js — Group Dashboard.
//
// AML-style card landing → two views:
//   • Search       — find a company by name / TID-XXXXX
//   • All Companies — sortable, paginated table of every company
// A shared filter bar (project year, assignee, service, department) drives
// both views; Deal Value totals recompute to the active filter.
//
// Backend: companies-api (port 8003), proxied by nginx at /api/companies/*.
//   GET /filters                  → dropdown option lists
//   GET /search?q=&<filters>      → companies + (filtered) fee totals
//   GET /companies?sort=&page=…   → consolidated list
//   GET /{tid}?<filters>          → per-company detail (deal tasks only)
//   GET /sync · /status           → refresh / freshness
//
// Mounts into: #section-companies (sibling of .page-content)
// ============================================================

import { escapeHtml, renderError, renderEmpty } from "../../utils/dom.js";
import { setStatus } from "../shell/topbar.js";

const SECTION_ID = "section-companies";
const API_BASE   = "/api/companies";   // relative — nginx proxies; never localhost
const SEARCH_DEBOUNCE_MS = 400;
const PAGE_SIZE = 50;

const EUR = new Intl.NumberFormat("en-IE", {
  style: "currency", currency: "EUR", maximumFractionDigits: 0,
});

// Prettify raw ClickUp space names for display: drop the "_CRM" suffix and
// render the "KT" token as "K. Treppides". Display-only — the DB keeps raw names.
function prettySpace(name) {
  if (!name) return "Unknown space";
  let s = String(name).replace(/_CRM$/i, "");
  if (/^KT(\b|_)/.test(s)) s = s.replace(/^KT/, "K. Treppides");
  return s.trim();
}

// Stable color per Service value (consistent across the whole dashboard). Known
// services get fixed hues; anything else is hashed onto a palette.
const SERVICE_COLORS = {
  "Audit":               "#4A90D9",
  "External Audit":      "#3A7BC8",
  "Internal Audit":      "#5A67D8",
  "Bookkeeping":         "#48BB78",
  "VAT":                 "#ED8936",
  "Payroll":             "#9F7AEA",
  "Compliance":          "#38B2AC",
  "Compliance Consulting":"#319795",
  "Licensing":           "#D69E2E",
  "Valuation":           "#E53E3E",
  "Risk":                "#DD6B20",
  "Risk Management":     "#C05621",
  "Tax":                 "#667EEA",
};
const SERVICE_PALETTE = ["#4A90D9","#48BB78","#ED8936","#9F7AEA","#38B2AC","#E53E3E","#D69E2E","#667EEA","#DD6B20","#319795","#805AD5"];
function serviceColor(service) {
  if (!service) return "#A0AEC0";
  if (SERVICE_COLORS[service]) return SERVICE_COLORS[service];
  let h = 0;
  for (let i = 0; i < service.length; i++) h = (h * 31 + service.charCodeAt(i)) >>> 0;
  return SERVICE_PALETTE[h % SERVICE_PALETTE.length];
}

// ---- View + filter state ------------------------------------------
// Filter keys, in display order. Space first (it scopes the rest); years next.
const FILTER_KEYS = ["space", "year", "business_year", "service", "assignee", "department"];
const FILTER_LABELS = {
  space: "Space", year: "Project Year", business_year: "Business Year",
  service: "Service", assignee: "Assignee", department: "Department",
};
const emptyFilters = () => ({ space: [], year: [], business_year: [], service: [], assignee: [], department: [] });

let _view = "landing";              // "landing" | "search" | "all"
let _filters = emptyFilters();
let _filterOptions = null;          // latest /filters response (cascaded to selection)
let _debounceTimer = null;
let _lastQuery = "";
// All-Companies table state
let _browse = { sort: "deal_value", dir: "desc", page: 1, total: 0 };
// Chart-view state: compare by company|ubo; explicit picks (empty = top 15).
let _chart = { by: "company", picks: [], instance: null };
// Custom Total view state: session-only Map of selected deal id → {name, company, value, url, is_lost}.
let _calc = { selected: new Map(), page: 1, total: 0 };

// ---- Page visibility ----------------------------------------------

function showPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove("fees-active", "staff-active", "aml-active");
  main.classList.add("companies-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "companies" } }));
  goMain();
}

function hidePage() {
  document.querySelector(".main")?.classList.remove("companies-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_companies = { show: showPage, hide: hidePage };

// ---- Filter helpers ------------------------------------------------

function filterQS() {
  const parts = [];
  for (const k of FILTER_KEYS) {
    if (_filters[k].length) parts.push(`${k}=${encodeURIComponent(_filters[k].join(","))}`);
  }
  return parts.join("&");
}

function anyFilters() {
  return FILTER_KEYS.some(k => _filters[k].length);
}

const EMPTY_OPTS = { spaces: [], years: [], business_years: [], assignees: [], services: [], departments: [] };

// Lazy-load the vendored Chart.js (same lib the fees dashboard uses). Idempotent;
// resolves immediately if it's already on the page.
function loadChartJs() {
  if (window.Chart) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/chart.umd.min.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Chart.js"));
    document.head.appendChild(s);
  });
}

// Fetch the option lists CASCADED to the current selection (the backend scopes
// each field to the other active filters). Called on first open and after every
// filter change so dropdowns stay consistent with what's selected.
async function loadFilterOptions() {
  const qs = filterQS();
  try {
    const res = await fetch(`${API_BASE}/filters${qs ? "?" + qs : ""}`);
    if (res.ok) _filterOptions = await res.json();
  } catch { /* keep last options on transient failure */ }
  return _filterOptions || EMPTY_OPTS;
}

// ---- Shared rendering: tasks / deals / company cards --------------

function fmtDate(ms) {
  try { return new Date(Number(ms)).toISOString().slice(0, 10); } catch { return ""; }
}

function relativeTime(ms) {
  const m = Math.round((Date.now() - Number(ms)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function loadingHtml(message = "Loading…") {
  return `<div class="companies-loading" aria-busy="true"><span class="companies-spinner" aria-hidden="true"></span><span>${escapeHtml(message)}</span></div>`;
}

function statusPill(task) {
  const label = task.status ? escapeHtml(task.status) : "—";
  const color = task.status_color && /^#[0-9a-f]{6}$/i.test(task.status_color) ? task.status_color : "#A0AEC0";
  return `<span class="companies-status" style="--pill:${color}">${label}</span>`;
}

function taskRow(task) {
  const service = task.service
    ? `<span class="companies-meta-item companies-service" style="--svc:${serviceColor(task.service)}">${escapeHtml(task.service)}</span>` : "";
  const year = task.year_of_project
    ? `<span class="companies-meta-item">Project ${escapeHtml(task.year_of_project)}</span>` : "";
  const byear = task.business_year
    ? `<span class="companies-meta-item">FY ${escapeHtml(task.business_year)}</span>` : "";
  const assignees = (task.assignees || []).length
    ? `<span class="companies-meta-item">${escapeHtml(task.assignees.join(", "))}</span>` : "";
  const deal = (task.is_deal && task.deal_value != null)
    ? `<span class="companies-meta-item companies-dealval">${EUR.format(task.deal_value)}</span>` : "";
  const open = task.url
    ? `<a class="companies-open" href="${escapeHtml(task.url)}" target="_blank" rel="noopener noreferrer">Open in ClickUp ↗</a>` : "";
  const sub = task.parent_name
    ? `<span class="companies-subtask" title="Subtask of ${escapeHtml(task.parent_name)}">↳ subtask of ${escapeHtml(task.parent_name)}</span>` : "";

  return `
    <li class="companies-task">
      <div class="companies-task-main">
        <span class="companies-task-name">${escapeHtml(task.task_name || "(untitled task)")}</span>
        ${statusPill(task)}
        ${deal}
      </div>
      <div class="companies-task-meta">
        ${sub}
        ${service}
        ${year}
        ${byear}
        ${assignees}
        ${open}
      </div>
    </li>`;
}

function dealGroup(label, deals, kind) {
  if (!deals.length) return "";
  return `
    <div class="companies-listgroup ${kind}">
      <div class="companies-list-header">${label}<span class="companies-space-count">${deals.length}</span></div>
      <ul class="companies-task-list">${deals.map(taskRow).join("")}</ul>
    </div>`;
}

function spaceGroup(space) {
  return `
    <div class="companies-space">
      <div class="companies-space-header"><span class="companies-space-name">${escapeHtml(prettySpace(space.space_name))}</span></div>
      ${dealGroup("Active deals", space.active || [], "active")}
      ${dealGroup("Rejected / Lost", space.lost || [], "lost")}
    </div>`;
}

function feeHeadline(c) {
  const noDeals = (c.deal_count || 0) === 0;
  const active = `
    <div class="companies-fee active${noDeals ? " empty" : ""}">
      <span class="companies-fee-label">Total Deal Value</span>
      <span class="companies-fee-value">${noDeals ? "—" : EUR.format(c.active_deal_value || 0)}</span>
      <span class="companies-fee-sub">${noDeals ? "no deals" : `${c.active_deal_count || 0} active deal${c.active_deal_count === 1 ? "" : "s"}`}</span>
    </div>`;
  const lost = (c.lost_deal_count > 0) ? `
    <div class="companies-fee lost">
      <span class="companies-fee-label">Rejected / Lost</span>
      <span class="companies-fee-value">${EUR.format(c.lost_deal_value || 0)}</span>
      <span class="companies-fee-sub">${c.lost_deal_count} deal${c.lost_deal_count === 1 ? "" : "s"}</span>
    </div>` : "";
  return `<div class="companies-fees">${active}${lost}</div>`;
}

function companyCard(company, idx) {
  const noDeals = (company.deal_count || 0) === 0;
  const valueBadge = noDeals
    ? `<span class="companies-card-value none" title="No deal value">— no deals</span>`
    : `<span class="companies-card-value">${EUR.format(company.active_deal_value || 0)}</span>`;
  return `
    <details class="companies-card${noDeals ? " no-deals" : ""}" data-tid="${escapeHtml(company.tid)}"${idx === 0 ? " open" : ""}>
      <summary class="companies-card-summary">
        <span class="companies-card-name">${escapeHtml(company.display_name || company.tid)}</span>
        <span class="companies-card-tid">${escapeHtml(company.tid)}</span>
        ${valueBadge}
        <span class="companies-card-count">${company.task_count} task${company.task_count === 1 ? "" : "s"}</span>
        <svg class="companies-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </summary>
      ${feeHeadline(company)}
      <div class="companies-card-body" data-loaded="0">${loadingHtml("Loading deals…")}</div>
    </details>`;
}

// Grand-total banner — sum of active Deal Value across the full result set.
function grandTotalHtml(data, companyCount) {
  const active = data.grand_active_deal_value || 0;
  const lost = data.grand_lost_deal_value || 0;
  const filtered = anyFilters();
  return `
    <div class="companies-grandtotal${filtered ? " filtered" : ""}">
      <div class="companies-grandtotal-main">
        <span class="companies-grandtotal-label">${filtered ? "Filtered total Deal Value" : "Total Deal Value"}</span>
        <span class="companies-grandtotal-value">${EUR.format(active)}</span>
      </div>
      <span class="companies-grandtotal-sub">${companyCount} compan${companyCount === 1 ? "y" : "ies"}${lost ? ` · ${EUR.format(lost)} rejected/lost` : ""}</span>
    </div>`;
}

function renderDetail(detail) {
  if (!detail.has_deals) {
    return `<div class="companies-detail companies-nodeal">— No deal tasks${anyFilters() ? " match the active filters" : ""} for this company.</div>`;
  }
  return `<div class="companies-detail">${(detail.spaces || []).map(spaceGroup).join("")}</div>`;
}

// Lazy-fetch a company's deal detail when its card expands (honours filters).
async function loadDetail(card) {
  const body = card.querySelector(".companies-card-body");
  if (!body || body.dataset.loaded === "1") return;
  body.dataset.loaded = "1";
  const tid = card.dataset.tid;
  const qs = filterQS();
  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(tid)}${qs ? "?" + qs : ""}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body.innerHTML = renderDetail(await res.json());
  } catch (err) {
    console.error("Company detail failed:", err);
    body.innerHTML = renderError();
    body.dataset.loaded = "0";
  }
}

function wireCards(container) {
  container.querySelectorAll(".companies-card").forEach(card => {
    card.addEventListener("toggle", () => { if (card.open) loadDetail(card); });
    if (card.open) loadDetail(card);
  });
}

// ---- Filter bar UI -------------------------------------------------

// Map each filter key → its option list in the /filters response.
const OPTS_KEY = {
  space: "spaces", year: "years", business_year: "business_years",
  service: "services", assignee: "assignees", department: "departments",
};
// Space options carry raw names (used as filter values) but display prettified.
function optLabel(key, value) {
  return key === "space" ? prettySpace(value) : String(value);
}
function summaryLabel(key) {
  const sel = _filters[key];
  if (sel.length === 0) return "All";
  if (sel.length === 1) return optLabel(key, sel[0]);
  return `${sel.length} selected`;
}

function filterBarHtml() {
  const opts = _filterOptions || EMPTY_OPTS;

  // Every filter is a multi-select <details> popover of checkboxes. Options are
  // cascaded by the backend to the current selection (e.g. pick a Space → the
  // Service/Department/Year options narrow to that space).
  const multi = (key) => {
    const values = opts[OPTS_KEY[key]] || [];
    return `
      <div class="companies-filter">
        <span>${escapeHtml(FILTER_LABELS[key])}</span>
        <details class="companies-multi" data-filter="${key}">
          <summary>${escapeHtml(summaryLabel(key))} <span class="companies-multi-caret">▾</span></summary>
          <div class="companies-multi-menu">
            ${values.map(v => {
              const sv = String(v);
              return `<label class="companies-multi-opt"><input type="checkbox" value="${escapeHtml(sv)}"${_filters[key].includes(sv) ? " checked" : ""}> ${escapeHtml(optLabel(key, sv))}</label>`;
            }).join("")}
          </div>
        </details>
      </div>`;
  };

  const active = anyFilters()
    ? `<button class="companies-filter-clear" id="companies-filter-clear">Clear filters ✕</button>` : "";
  return `<div class="companies-filterbar">${FILTER_KEYS.map(multi).join("")}${active}</div>`;
}

// Rebuild the filter bar in place (re-rendered with current options + selections)
// and re-wire it. Used after the cascaded options change.
function rebuildFilterBar(apply) {
  const bar = document.querySelector(".companies-filterbar");
  if (bar) { bar.outerHTML = filterBarHtml(); bindFilters(apply); }
}

// Wire the filter bar. `apply` re-runs the active view's query. You tick as many
// boxes as you want; on click-away (popover close) — if the selection changed —
// the option lists are re-fetched CASCADED to the new selection, the bar is
// rebuilt so sibling dropdowns narrow, then the view re-queries.
function bindFilters(apply) {
  const onClear = () => {
    _filters = emptyFilters();
    loadFilterOptions().then(() => { rebuildFilterBar(apply); apply(); });
  };

  // Only the filter-bar popovers — NOT other .companies-multi like the chart
  // picker (which has no data-filter; treating it as a filter threw and aborted
  // the chart render).
  document.querySelectorAll(".companies-filterbar .companies-multi").forEach(d => {
    const key = d.dataset.filter;
    if (!key) return;                        // safety: skip any non-filter popover
    let snapshot = _filters[key].join("|");  // selection when the popover opened

    d.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener("change", () => {
        const set = new Set(_filters[key]);
        if (cb.checked) set.add(cb.value); else set.delete(cb.value);
        _filters[key] = [...set];
        // Update this popover's summary live; defer querying/cascade to close.
        const sm = d.querySelector("summary");
        if (sm) sm.innerHTML = `${escapeHtml(summaryLabel(key))} <span class="companies-multi-caret">▾</span>`;
        syncClearButton(onClear);
      });
    });

    d.addEventListener("toggle", async () => {
      if (d.open) {
        snapshot = _filters[key].join("|");                 // remember state on open
      } else if (_filters[key].join("|") !== snapshot) {
        await loadFilterOptions();                          // cascade: narrow sibling options
        rebuildFilterBar(apply);                            // re-render bar with new options
        apply();                                            // re-run the view query
      }
    });
  });

  document.getElementById("companies-filter-clear")?.addEventListener("click", onClear);

  // Click outside an open filter popover → close it (which triggers the toggle).
  if (!bindFilters._outsideBound) {
    document.addEventListener("click", e => {
      document.querySelectorAll(".companies-multi[open]").forEach(d => {
        if (!d.contains(e.target)) d.open = false;
      });
    });
    bindFilters._outsideBound = true;  // bind the global listener once
  }
}

// ---- Shared header (back to hub + refresh) ------------------------

function wireHeader() {
  // Back arrow returns to the hub; refresh re-syncs.
  document.getElementById("companies-home-btn")?.addEventListener("click", () => {
    hidePage(); window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.getElementById("companies-refresh-btn")?.addEventListener("click", onRefresh);
  refreshSyncedLabel();
}

const CHART_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
const SEARCH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
const CALC_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8" y2="10"/><line x1="12" y1="10" x2="12" y2="10"/><line x1="16" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="8" y2="14"/><line x1="12" y1="14" x2="12" y2="14"/><line x1="16" y1="14" x2="16" y2="18"/><line x1="8" y1="18" x2="12" y2="18"/></svg>`;

// Shared header: back-to-hub + title + (Chart button) + synced + refresh.
function mainHeaderHtml(title, subtitle, chartBtn) {
  return `
    <div class="section-header">
      <div class="companies-header-left">
        <button class="companies-back-btn" id="companies-home-btn" aria-label="Back to Hub">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        </button>
        <div><h2 class="section-title">${escapeHtml(title)}</h2><p class="section-subtitle">${escapeHtml(subtitle)}</p></div>
      </div>
      <div class="companies-header-right">
        ${chartBtn || ""}
        <span class="companies-synced" id="companies-synced"></span>
        <button class="companies-refresh-btn" id="companies-refresh-btn" aria-label="Refresh from ClickUp" title="Refresh from ClickUp">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
      </div>
    </div>`;
}

// ---- Main view: unified searchable + filterable company list ------

async function goMain() {
  _view = "main";
  _browse.page = 1;
  await loadFilterOptions();
  const section = document.getElementById(SECTION_ID);
  const headerBtns = `
    <button class="companies-chart-btn" id="companies-calc-btn" title="Build a custom total">${CALC_ICON} Custom Total</button>
    <button class="companies-chart-btn" id="companies-chart-btn" title="Compare by chart">${CHART_ICON} Chart</button>`;
  section.innerHTML = `
    <div class="hub-section">
      ${mainHeaderHtml("Group Dashboard", "Search and filter companies — totals reflect any active filters", headerBtns)}
      <div class="companies-searchbar">
        <span class="companies-search-icon">${SEARCH_SVG}</span>
        <input type="search" id="companies-search-input" class="companies-search-input" placeholder="Search company name or TID-XXXXX…" autocomplete="off" spellcheck="false" aria-label="Search company" value="${escapeHtml(_lastQuery)}">
      </div>
      ${filterBarHtml()}
      <label class="companies-nodeal-toggle"><input type="checkbox" id="companies-nodeal-cb"> Include companies with no deals</label>
      <div id="companies-table-wrap" class="companies-table-wrap"></div>
    </div>`;
  wireHeader();
  document.getElementById("companies-chart-btn")?.addEventListener("click", goChart);
  document.getElementById("companies-calc-btn")?.addEventListener("click", goCalc);
  bindFilters(() => { _browse.page = 1; loadBrowse(); });
  document.getElementById("companies-nodeal-cb")?.addEventListener("change", () => { _browse.page = 1; loadBrowse(); });

  const input = document.getElementById("companies-search-input");
  input?.addEventListener("input", e => {
    _lastQuery = e.target.value;
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => { _browse.page = 1; loadBrowse(); }, SEARCH_DEBOUNCE_MS);
  });

  loadBrowse();
}

// ---- Chart view: compare companies or UBOs by Deal Value ----------

async function goChart() {
  _view = "chart";
  await loadFilterOptions();
  const section = document.getElementById(SECTION_ID);
  section.innerHTML = `
    <div class="hub-section">
      ${mainHeaderHtml("Group Dashboard — Chart", "Compare Deal Value by company or UBO — defaults to the top 15", "")}
      ${filterBarHtml()}
      <div class="companies-chart-controls">
        <div class="companies-chart-toggle" role="tablist">
          <button class="companies-chart-tab" data-by="company" role="tab">By Company</button>
          <button class="companies-chart-tab" data-by="ubo" role="tab">By UBO</button>
        </div>
        <div class="companies-chart-picker">
          <details class="companies-multi" id="companies-chart-pick">
            <summary><span id="companies-pick-label">Top 15 (default)</span> <span class="companies-multi-caret">▾</span></summary>
            <div class="companies-multi-menu">
              <input type="search" id="companies-pick-search" class="companies-pick-search" placeholder="Add to compare…" autocomplete="off">
              <div id="companies-pick-list"></div>
            </div>
          </details>
          <button class="companies-pick-clear" id="companies-pick-clear" hidden>Reset to top 15 ✕</button>
        </div>
      </div>
      <div id="companies-chart-wrap" class="companies-chart-wrap"></div>
    </div>`;
  wireHeader();
  // On the chart view the back arrow returns to the list (not the hub).
  const back = document.getElementById("companies-home-btn");
  if (back) {
    const fresh = back.cloneNode(true);     // drop the hub-back listener from wireHeader
    back.replaceWith(fresh);
    fresh.addEventListener("click", () => { goMain(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  }
  bindFilters(() => loadChart());

  section.querySelectorAll(".companies-chart-tab").forEach(b => {
    b.classList.toggle("active", b.dataset.by === _chart.by);
    b.addEventListener("click", () => {
      if (_chart.by === b.dataset.by) return;
      _chart.by = b.dataset.by; _chart.picks = [];      // reset picks when switching dimension
      goChart();                                         // re-render (repopulates picker)
    });
  });

  document.getElementById("companies-chart-btn"); // (no-op; chart btn only on main)
  wireChartPicker();
  loadChart();
}

// Populate + wire the compare-picker (companies via /companies search, UBOs via /ubos).
async function wireChartPicker() {
  const search = document.getElementById("companies-pick-search");
  const list = document.getElementById("companies-pick-list");
  const clear = document.getElementById("companies-pick-clear");
  if (!list) return;

  const renderList = (items) => {
    // items: [{key,label}]; checked if in picks
    list.innerHTML = items.map(it =>
      `<label class="companies-multi-opt"><input type="checkbox" value="${escapeHtml(it.key)}" data-label="${escapeHtml(it.label)}"${_chart.picks.some(p => p.key === it.key) ? " checked" : ""}> ${escapeHtml(it.label)}</label>`
    ).join("") || `<div class="companies-pick-empty">No matches</div>`;
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener("change", () => {
        if (cb.checked) _chart.picks.push({ key: cb.value, label: cb.dataset.label });
        else _chart.picks = _chart.picks.filter(p => p.key !== cb.value);
        updatePickLabel();
        loadChart();
      });
    });
  };

  const fetchOptions = async (q) => {
    try {
      if (_chart.by === "ubo") {
        const res = await fetch(`${API_BASE}/ubos?q=${encodeURIComponent(q)}&limit=100`);
        const d = res.ok ? await res.json() : { ubos: [] };
        return (d.ubos || []).map(u => ({ key: u, label: u }));
      } else {
        // company picker: reuse the browse search (returns display names + TIDs)
        const res = await fetch(`${API_BASE}/companies?q=${encodeURIComponent(q || "")}&page_size=100&sort=deal_value`);
        const d = res.ok ? await res.json() : { companies: [] };
        return (d.companies || []).map(c => ({ key: c.tid, label: c.display_name || c.tid }));
      }
    } catch { return []; }
  };

  let t = null;
  search?.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => renderList(await fetchOptions(search.value.trim())), 300);
  });
  clear?.addEventListener("click", () => { _chart.picks = []; updatePickLabel(); goChart(); });

  renderList(await fetchOptions(""));
  updatePickLabel();
}

function updatePickLabel() {
  const lbl = document.getElementById("companies-pick-label");
  const clear = document.getElementById("companies-pick-clear");
  const n = _chart.picks.length;
  if (lbl) lbl.textContent = n === 0 ? "Top 15 (default)" : `${n} selected`;
  if (clear) clear.hidden = n === 0;
}

async function loadChart() {
  const wrap = document.getElementById("companies-chart-wrap");
  if (!wrap) return;
  wrap.innerHTML = loadingHtml("Building chart…");
  const params = new URLSearchParams();
  params.set("by", _chart.by);
  if (_chart.picks.length) params.set("select", _chart.picks.map(p => p.key).join(","));
  const qs = filterQS();
  try {
    await loadChartJs();
    const res = await fetch(`${API_BASE}/chart?${params.toString()}${qs ? "&" + qs : ""}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderChart(wrap, await res.json());
  } catch (err) {
    console.error("Chart failed:", err);
    wrap.innerHTML = renderError();
  }
}

function renderChart(wrap, data) {
  const items = data.items || [];
  if (!items.length) {
    wrap.innerHTML = renderEmpty(`No ${data.by === "ubo" ? "UBOs" : "companies"} to chart${anyFilters() ? " with the active filters" : ""}.`);
    return;
  }
  const title = data.selected
    ? `Comparing ${items.length} selected ${data.by === "ubo" ? "UBOs" : "companies"}`
    : `Top ${items.length} ${data.by === "ubo" ? "UBOs" : "companies"} by Deal Value`;
  wrap.innerHTML = `<p class="companies-chart-title">${escapeHtml(title)}${data.filtered ? " · filtered" : ""}</p><div class="companies-chart-canvas"><canvas id="companies-canvas"></canvas></div>`;

  const ctx = document.getElementById("companies-canvas");
  if (_chart.instance) { _chart.instance.destroy(); _chart.instance = null; }
  if (typeof window.Chart === "undefined") {
    wrap.innerHTML = renderError();
    console.error("Chart.js (vendor) not loaded");
    return;
  }
  const labels = items.map(i => i.label.length > 32 ? i.label.slice(0, 30) + "…" : i.label);
  const values = items.map(i => i.value);
  const barColor = data.by === "ubo" ? "#805AD5" : "#2F855A";
  _chart.instance = new window.Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Active Deal Value (EUR)", data: values,
      backgroundColor: barColor + "cc", borderColor: barColor, borderWidth: 1 }] },
    options: {
      indexAxis: "y",                       // horizontal bars — labels are long names
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => EUR.format(c.parsed.x) } },
      },
      scales: { x: { ticks: { callback: v => EUR.format(v) } } },
    },
  });
}

// ---- Custom Total view: hand-pick deals, sum their Deal Value -----

const CALC_PAGE_SIZE = 200;

async function goCalc() {
  _view = "calc";
  _calc.page = 1;
  await loadFilterOptions();
  const section = document.getElementById(SECTION_ID);
  section.innerHTML = `
    <div class="hub-section">
      ${mainHeaderHtml("Group Dashboard — Custom Total", "Tick deals to build your own total — selection persists as you filter/search", "")}
      <div class="companies-searchbar">
        <span class="companies-search-icon">${SEARCH_SVG}</span>
        <input type="search" id="companies-calc-search" class="companies-search-input" placeholder="Search deals by name or TID…" autocomplete="off" spellcheck="false" aria-label="Search deals">
      </div>
      ${filterBarHtml()}
      <div id="companies-calc-deals" class="companies-calc-deals"></div>
      <div id="companies-calc-selected" class="companies-calc-selected"></div>
      <div id="companies-calc-total" class="companies-calc-total"></div>
    </div>`;
  wireHeader();
  // Back arrow → List view (not hub), same clone-swap as the chart view.
  const back = document.getElementById("companies-home-btn");
  if (back) {
    const fresh = back.cloneNode(true);
    back.replaceWith(fresh);
    fresh.addEventListener("click", () => { goMain(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  }
  bindFilters(() => { _calc.page = 1; loadDeals(); });

  let calcQuery = "";
  const input = document.getElementById("companies-calc-search");
  input?.addEventListener("input", e => {
    calcQuery = e.target.value;
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => { _calc.page = 1; loadDeals(calcQuery); }, SEARCH_DEBOUNCE_MS);
  });

  renderSelectedAndTotal();
  loadDeals();
}

async function loadDeals(q = "") {
  const wrap = document.getElementById("companies-calc-deals");
  if (!wrap) return;
  wrap.innerHTML = loadingHtml("Loading deals…");
  const params = new URLSearchParams();
  params.set("page", _calc.page); params.set("page_size", CALC_PAGE_SIZE);
  if (q.trim()) params.set("q", q.trim());
  const qs = filterQS();
  try {
    const res = await fetch(`${API_BASE}/deals?${params.toString()}${qs ? "&" + qs : ""}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderDeals(wrap, await res.json());
  } catch (err) {
    console.error("Deals load failed:", err);
    wrap.innerHTML = renderError();
  }
}

function dealCheckRow(d) {
  const checked = _calc.selected.has(d.id) ? " checked" : "";
  const val = d.deal_value != null ? EUR.format(d.deal_value) : "—";
  const svc = d.service
    ? `<span class="companies-meta-item companies-service" style="--svc:${serviceColor(d.service)}">${escapeHtml(d.service)}</span>` : "";
  const lost = d.is_lost ? `<span class="companies-calc-lost">lost</span>` : "";
  const sub = d.parent_name
    ? `<span class="companies-subtask" title="Subtask of ${escapeHtml(d.parent_name)}">↳ subtask of ${escapeHtml(d.parent_name)}</span>` : "";
  return `
    <label class="companies-calc-row${d.is_lost ? " lost" : ""}">
      <input type="checkbox" data-id="${escapeHtml(d.id)}"${checked}>
      <span class="companies-calc-name">${escapeHtml(d.task_name || "(untitled)")}${sub}</span>
      <span class="companies-calc-co">${escapeHtml(d.company_name || "")}</span>
      <span class="companies-calc-space">${escapeHtml(prettySpace(d.space_name))}</span>
      ${svc}${lost}
      <span class="companies-calc-val">${val}</span>
    </label>`;
}

function renderDeals(wrap, data) {
  const deals = data.deals || [];
  _calc.total = data.total;
  if (!deals.length) {
    wrap.innerHTML = renderEmpty(`No deals${anyFilters() ? " match the active filters" : ""}.`);
    return;
  }
  const totalPages = Math.max(1, Math.ceil(data.total / data.page_size));
  const pager = totalPages > 1 ? `
    <div class="companies-pager">
      <button id="companies-calc-prev" ${data.page <= 1 ? "disabled" : ""}>‹ Prev</button>
      <span>Page ${data.page} of ${totalPages} · ${data.total} deals</span>
      <button id="companies-calc-next" ${data.page >= totalPages ? "disabled" : ""}>Next ›</button>
    </div>` : `<p class="companies-result-summary">${data.total} deal${data.total === 1 ? "" : "s"}</p>`;

  wrap.innerHTML = `<div class="companies-calc-list">${deals.map(dealCheckRow).join("")}</div>${pager}`;

  // Build a quick id→deal map for this page so toggles can store full info.
  const byId = {}; deals.forEach(d => { byId[d.id] = d; });
  wrap.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.id, d = byId[id];
      if (cb.checked && d) {
        _calc.selected.set(id, { name: d.task_name, company: d.company_name,
          value: d.deal_value || 0, url: d.url, is_lost: d.is_lost });
      } else {
        _calc.selected.delete(id);
      }
      renderSelectedAndTotal();
    });
  });

  document.getElementById("companies-calc-prev")?.addEventListener("click", () => { if (_calc.page > 1) { _calc.page--; loadDeals(); } });
  document.getElementById("companies-calc-next")?.addEventListener("click", () => { _calc.page++; loadDeals(); });
}

// Sticky total bar + the auditable "Selected deals" panel (always full selection).
function renderSelectedAndTotal() {
  const totalEl = document.getElementById("companies-calc-total");
  const selEl = document.getElementById("companies-calc-selected");
  if (!totalEl || !selEl) return;

  const items = [..._calc.selected.entries()];
  const sum = items.reduce((s, [, v]) => s + (v.value || 0), 0);
  const n = items.length;

  totalEl.innerHTML = `
    <div class="companies-calc-totalbar${n ? "" : " empty"}">
      <span class="companies-calc-total-label">${n} deal${n === 1 ? "" : "s"} selected</span>
      <span class="companies-calc-total-value">${EUR.format(sum)}</span>
      ${n ? `<button class="companies-calc-clear" id="companies-calc-clear">Clear ✕</button>` : ""}
    </div>`;
  document.getElementById("companies-calc-clear")?.addEventListener("click", () => {
    _calc.selected.clear();
    // uncheck any visible boxes
    document.querySelectorAll('#companies-calc-deals input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    renderSelectedAndTotal();
  });

  if (!n) { selEl.innerHTML = ""; return; }
  const rows = items.map(([id, v]) => `
    <li class="companies-calc-selrow${v.is_lost ? " lost" : ""}">
      <button class="companies-calc-remove" data-id="${escapeHtml(id)}" title="Remove">✕</button>
      <span class="companies-calc-name">${escapeHtml(v.name || "(untitled)")}</span>
      <span class="companies-calc-co">${escapeHtml(v.company || "")}</span>
      ${v.is_lost ? `<span class="companies-calc-lost">lost</span>` : ""}
      ${v.url ? `<a class="companies-open" href="${escapeHtml(v.url)}" target="_blank" rel="noopener noreferrer">↗</a>` : ""}
      <span class="companies-calc-val">${EUR.format(v.value || 0)}</span>
    </li>`).join("");
  selEl.innerHTML = `<div class="companies-calc-selhead">Selected deals</div><ul class="companies-calc-sellist">${rows}</ul>`;
  selEl.querySelectorAll(".companies-calc-remove").forEach(b => {
    b.addEventListener("click", () => {
      const id = b.dataset.id;
      _calc.selected.delete(id);
      const cb = document.querySelector(`#companies-calc-deals input[data-id="${CSS.escape(id)}"]`);
      if (cb) cb.checked = false;
      renderSelectedAndTotal();
    });
  });
}

const COLS = [
  { key: "name",          label: "Company" },
  { key: "tid",           label: "TID", sortable: false },
  { key: "deal_value",    label: "Total Deal Value", num: true },
  { key: "deal_count",    label: "Deals", num: true },
  { key: "spaces",        label: "Spaces", sortable: false },
  { key: "last_activity", label: "Last Activity" },
];

async function loadBrowse() {
  const wrap = document.getElementById("companies-table-wrap");
  if (!wrap) return;
  wrap.innerHTML = loadingHtml("Loading companies…");
  setStatus("Loading…");
  const includeNodeal = document.getElementById("companies-nodeal-cb")?.checked ? "&include_nodeal=true" : "";
  const qs = filterQS();
  const search = _lastQuery.trim() ? `&q=${encodeURIComponent(_lastQuery.trim())}` : "";
  const url = `${API_BASE}/companies?sort=${_browse.sort}&dir=${_browse.dir}&page=${_browse.page}&page_size=${PAGE_SIZE}${includeNodeal}${search}${qs ? "&" + qs : ""}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _browse.total = data.total; _browse.sort = data.sort; _browse.dir = data.dir;
    renderTable(wrap, data);
  } catch (err) {
    console.error("Browse failed:", err);
    wrap.innerHTML = renderError();
    setStatus("Load failed", true);
  }
}

function sortIndicator(key) {
  if (_browse.sort !== key) return "";
  return _browse.dir === "asc" ? " ▲" : " ▼";
}

function renderTable(wrap, data) {
  const rows = data.companies || [];
  if (!rows.length) {
    wrap.innerHTML = renderEmpty(`No companies${anyFilters() ? " match the active filters" : ""}.`);
    setStatus("0 companies");
    return;
  }
  const head = COLS.map(c =>
    `<th class="${c.num ? "num" : ""}${c.sortable === false ? "" : " sortable"}" data-sort="${c.sortable === false ? "" : c.key}">${escapeHtml(c.label)}${c.sortable === false ? "" : sortIndicator(c.key)}</th>`
  ).join("");
  const body = rows.map(c => {
    const noDeals = (c.deal_count || 0) === 0;
    return `
      <tr data-tid="${escapeHtml(c.tid)}">
        <td class="companies-td-name">${escapeHtml(c.display_name || c.tid)}</td>
        <td class="companies-td-tid">${escapeHtml(c.tid)}</td>
        <td class="num ${noDeals ? "muted" : "val"}">${noDeals ? "—" : EUR.format(c.active_deal_value || 0)}</td>
        <td class="num">${c.deal_count || 0}</td>
        <td class="companies-td-spaces">${escapeHtml((c.space_names || []).map(prettySpace).join(", "))}</td>
        <td>${c.last_activity ? escapeHtml(relativeTime(c.last_activity)) : "—"}</td>
      </tr>`;
  }).join("");

  const totalPages = Math.max(1, Math.ceil(data.total / data.page_size));
  const pager = `
    <div class="companies-pager">
      <button id="companies-prev" ${data.page <= 1 ? "disabled" : ""}>‹ Prev</button>
      <span>Page ${data.page} of ${totalPages} · ${data.total} companies</span>
      <button id="companies-next" ${data.page >= totalPages ? "disabled" : ""}>Next ›</button>
    </div>`;

  wrap.innerHTML = grandTotalHtml(data, data.total) + `
    <table class="companies-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>${pager}`;

  // Sort on header click.
  wrap.querySelectorAll("th.sortable").forEach(th => th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (_browse.sort === key) _browse.dir = _browse.dir === "asc" ? "desc" : "asc";
    else { _browse.sort = key; _browse.dir = key === "name" ? "asc" : "desc"; }
    _browse.page = 1; loadBrowse();
  }));
  // Row → open detail (jump to a focused single-company view).
  wrap.querySelectorAll("tbody tr").forEach(tr => tr.addEventListener("click", () => openCompanyFromTable(tr.dataset.tid)));
  // Pager.
  document.getElementById("companies-prev")?.addEventListener("click", () => { if (_browse.page > 1) { _browse.page--; loadBrowse(); } });
  document.getElementById("companies-next")?.addEventListener("click", () => { _browse.page++; loadBrowse(); });

  setStatus(`${data.total} companies`);
}

// From the table, open a single company's detail as an expanded card above the table.
async function openCompanyFromTable(tid) {
  const wrap = document.getElementById("companies-table-wrap");
  if (!wrap) return;
  // Fetch the company summary via search-by-TID (cheap) then render one open card.
  try {
    const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(tid)}${anyFilters() ? "&" + filterQS() : ""}`);
    const data = res.ok ? await res.json() : { companies: [] };
    const c = (data.companies || [])[0];
    if (!c) return;
    const holder = document.createElement("div");
    holder.className = "companies-detail-pop";
    holder.innerHTML = `<button class="companies-detail-close" aria-label="Close">✕ Close</button>${companyCard(c, 0)}`;
    wrap.prepend(holder);
    wireCards(holder);
    holder.querySelector(".companies-detail-close").addEventListener("click", () => holder.remove());
    holder.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error("Open company failed:", err);
  }
}

// ---- Refresh / sync / status --------------------------------------

async function refreshSyncedLabel() {
  const el = document.getElementById("companies-synced");
  if (!el) return;
  try {
    const res = await fetch(`${API_BASE}/status`);
    if (!res.ok) return;
    const st = await res.json();
    const last = (st.spaces || []).map(s => s.last_run_ms).filter(Boolean).sort().pop();
    el.textContent = last ? `Updated ${relativeTime(last)}` : "";
    el.title = `${st.task_count || 0} tasks · ${st.company_count || 0} companies`;
  } catch { /* ignore */ }
}

async function onRefresh() {
  const btn = document.getElementById("companies-refresh-btn");
  btn?.classList.add("spinning");
  setStatus("Syncing from ClickUp…");
  try {
    const res = await fetch(`${API_BASE}/sync?wait=true`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.json();
    await refreshSyncedLabel();
    setStatus("Up to date");
    if (_view === "chart") loadChart();
    else if (_view === "calc") loadDeals();
    else loadBrowse();
  } catch (err) {
    console.error("Sync failed:", err);
    setStatus("Sync failed", true);
  } finally {
    btn?.classList.remove("spinning");
  }
}

// Add/remove the "Clear filters" button in place — WITHOUT rebuilding the bar,
// so an open multi-select popover stays open while picking several values.
function syncClearButton(onClear) {
  const bar = document.querySelector(".companies-filterbar");
  if (!bar) return;
  const existing = document.getElementById("companies-filter-clear");
  if (anyFilters() && !existing) {
    const btn = document.createElement("button");
    btn.className = "companies-filter-clear";
    btn.id = "companies-filter-clear";
    btn.textContent = "Clear filters ✕";
    btn.addEventListener("click", onClear);
    bar.appendChild(btn);
  } else if (!anyFilters() && existing) {
    existing.remove();
  }
}

// ---- Component init ------------------------------------------------

export default async function init(_config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;
  // Landing is rendered on show(); init just ensures the mount exists.
}
