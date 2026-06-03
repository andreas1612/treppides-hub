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

// Filters that allow picking several values at once (rendered as checkbox lists).
const MULTI_FILTERS = new Set(["service", "department"]);

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
let _view = "landing";              // "landing" | "search" | "all"
let _filters = { year: [], assignee: [], service: [], department: [] };
let _filterOptions = null;          // cached /filters response
let _debounceTimer = null;
let _lastQuery = "";
// All-Companies table state
let _browse = { sort: "deal_value", dir: "desc", page: 1, total: 0 };

// ---- Page visibility ----------------------------------------------

function showPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove("fees-active", "staff-active", "aml-active");
  main.classList.add("companies-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "companies" } }));
  goLanding();
}

function hidePage() {
  document.querySelector(".main")?.classList.remove("companies-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_companies = { show: showPage, hide: hidePage };

// ---- Filter helpers ------------------------------------------------

function filterQS() {
  const parts = [];
  for (const k of ["year", "assignee", "service", "department"]) {
    if (_filters[k].length) parts.push(`${k}=${encodeURIComponent(_filters[k].join(","))}`);
  }
  return parts.join("&");
}

function anyFilters() {
  return Object.values(_filters).some(a => a.length);
}

async function ensureFilterOptions() {
  if (_filterOptions) return _filterOptions;
  try {
    const res = await fetch(`${API_BASE}/filters`);
    if (res.ok) _filterOptions = await res.json();
  } catch { /* ignore — filter bar just renders empty selects */ }
  return _filterOptions || { years: [], assignees: [], services: [], departments: [] };
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
    ? `<span class="companies-meta-item">${escapeHtml(task.year_of_project)}</span>` : "";
  const assignees = (task.assignees || []).length
    ? `<span class="companies-meta-item">${escapeHtml(task.assignees.join(", "))}</span>` : "";
  const deal = (task.is_deal && task.deal_value != null)
    ? `<span class="companies-meta-item companies-dealval">${EUR.format(task.deal_value)}</span>` : "";
  const open = task.url
    ? `<a class="companies-open" href="${escapeHtml(task.url)}" target="_blank" rel="noopener noreferrer">Open in ClickUp ↗</a>` : "";

  return `
    <li class="companies-task">
      <div class="companies-task-main">
        <span class="companies-task-name">${escapeHtml(task.task_name || "(untitled task)")}</span>
        ${statusPill(task)}
        ${deal}
      </div>
      <div class="companies-task-meta">
        ${service}
        ${year}
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

function filterBarHtml() {
  const opts = _filterOptions || { years: [], assignees: [], services: [], departments: [] };

  // Every filter is a multi-select <details> popover of checkboxes. Selections
  // apply immediately (no need to click away).
  const multi = (key, label, values) => {
    const n = _filters[key].length;
    const summaryText = n === 0 ? "All" : (n === 1 ? _filters[key][0] : `${n} selected`);
    return `
      <div class="companies-filter">
        <span>${label}</span>
        <details class="companies-multi" data-filter="${key}">
          <summary>${escapeHtml(summaryText)} <span class="companies-multi-caret">▾</span></summary>
          <div class="companies-multi-menu">
            ${values.map(v => {
              const sv = String(v);
              return `<label class="companies-multi-opt"><input type="checkbox" value="${escapeHtml(sv)}"${_filters[key].includes(sv) ? " checked" : ""}> ${escapeHtml(sv)}</label>`;
            }).join("")}
          </div>
        </details>
      </div>`;
  };

  const active = anyFilters()
    ? `<button class="companies-filter-clear" id="companies-filter-clear">Clear filters ✕</button>` : "";
  return `
    <div class="companies-filterbar">
      ${multi("year", "Project Year", opts.years)}
      ${multi("service", "Service", opts.services)}
      ${multi("assignee", "Assignee", opts.assignees)}
      ${multi("department", "Department", opts.departments)}
      ${active}
    </div>`;
}

// Wire the filter bar. `apply` re-runs the active view's query. You tick as many
// boxes as you want; the query fires only when the popover CLOSES (click away),
// and only if the selection changed. An outside-click closes any open popover.
function bindFilters(apply) {
  const onClear = () => {
    _filters = { year: [], assignee: [], service: [], department: [] };
    const bar = document.querySelector(".companies-filterbar");
    if (bar) { bar.outerHTML = filterBarHtml(); bindFilters(apply); }
    apply();
  };

  document.querySelectorAll(".companies-multi").forEach(d => {
    const key = d.dataset.filter;
    let snapshot = _filters[key].join("|");  // selection when the popover opened

    d.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener("change", () => {
        const set = new Set(_filters[key]);
        if (cb.checked) set.add(cb.value); else set.delete(cb.value);
        _filters[key] = [...set];
        // Update the label live, but DON'T query yet — wait until close.
        const sm = d.querySelector("summary");
        const n = _filters[key].length;
        if (sm) sm.innerHTML = `${escapeHtml(n === 0 ? "All" : (n === 1 ? _filters[key][0] : n + " selected"))} <span class="companies-multi-caret">▾</span>`;
        syncClearButton(onClear);
      });
    });

    d.addEventListener("toggle", () => {
      if (d.open) {
        snapshot = _filters[key].join("|");          // remember state on open
      } else if (_filters[key].join("|") !== snapshot) {
        apply();                                      // applied on close, only if changed
      }
    });
  });

  document.getElementById("companies-filter-clear")?.addEventListener("click", onClear);

  // Click outside an open filter popover → close it (which triggers apply).
  if (!bindFilters._outsideBound) {
    document.addEventListener("click", e => {
      document.querySelectorAll(".companies-multi[open]").forEach(d => {
        if (!d.contains(e.target)) d.open = false;
      });
    });
    bindFilters._outsideBound = true;  // bind the global listener once
  }
}

// ---- Shared header (back to landing + refresh) --------------------

function headerHtml(title, subtitle) {
  return `
    <div class="section-header">
      <div class="companies-header-left">
        <button class="companies-back-btn" id="companies-back-btn" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div><h2 class="section-title">${escapeHtml(title)}</h2><p class="section-subtitle">${escapeHtml(subtitle)}</p></div>
      </div>
      <div class="companies-header-right">
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

function wireHeader(backTo) {
  document.getElementById("companies-back-btn")?.addEventListener("click", () => {
    backTo();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.getElementById("companies-refresh-btn")?.addEventListener("click", onRefresh);
  refreshSyncedLabel();
}

// ---- Landing (AML-style card chooser) -----------------------------

const CARD_ICONS = {
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
};
const ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;

function goLanding() {
  _view = "landing";
  const section = document.getElementById(SECTION_ID);
  section.innerHTML = `
    <div class="hub-section">
      <div class="section-header">
        <div class="companies-header-left">
          <button class="companies-back-btn" id="companies-home-btn" aria-label="Back to Hub">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          </button>
          <div><h2 class="section-title">Group Dashboard</h2><p class="section-subtitle">Search a company, or browse all companies with fees and filters</p></div>
        </div>
      </div>
      <div class="companies-cards">
        <button class="companies-card-tile" data-go="search" aria-label="Open company search">
          <span class="companies-card-icon search">${CARD_ICONS.search}</span>
          <h3 class="companies-card-tile-title">Search Companies</h3>
          <p class="companies-card-tile-desc">Look up one company by name or TID and see its total Deal Value and every deal across all spaces.</p>
          <span class="companies-card-cta">Open search ${ARROW}</span>
        </button>
        <button class="companies-card-tile" data-go="all" aria-label="Open all companies">
          <span class="companies-card-icon all">${CARD_ICONS.list}</span>
          <h3 class="companies-card-tile-title">All Companies</h3>
          <p class="companies-card-tile-desc">Browse every company in a sortable, filterable list — by project year, assignee, service and more.</p>
          <span class="companies-card-cta">Open list ${ARROW}</span>
        </button>
      </div>
    </div>`;
  document.getElementById("companies-home-btn")?.addEventListener("click", () => {
    hidePage(); window.scrollTo({ top: 0, behavior: "smooth" });
  });
  section.querySelectorAll(".companies-card-tile").forEach(btn => {
    btn.addEventListener("click", () => {
      const go = btn.dataset.go;
      if (go === "search") goSearch();
      else goAll();
    });
  });
}

// ---- Search view ---------------------------------------------------

async function goSearch() {
  _view = "search";
  await ensureFilterOptions();
  const section = document.getElementById(SECTION_ID);
  section.innerHTML = `
    <div class="hub-section">
      ${headerHtml("Search Companies", "Find a company by name or TID — totals reflect any active filters")}
      ${filterBarHtml()}
      <div class="companies-searchbar">
        <svg class="companies-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search" id="companies-search-input" class="companies-search-input" placeholder="Company name or TID-XXXXX…" autocomplete="off" spellcheck="false" aria-label="Search company">
      </div>
      <div id="companies-results" class="companies-results"></div>
    </div>`;
  wireHeader(goLanding);
  bindFilters(() => { if (_lastQuery) runSearch(_lastQuery); });

  const input = document.getElementById("companies-search-input");
  input?.addEventListener("input", e => {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => runSearch(e.target.value), SEARCH_DEBOUNCE_MS);
  });
  input?.addEventListener("keydown", e => {
    if (e.key === "Enter") { clearTimeout(_debounceTimer); runSearch(input.value); }
  });

  const results = document.getElementById("companies-results");
  results.innerHTML = `
    <div class="companies-prompt" role="status">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <h3>Search for a company</h3>
      <p>Type a company name to see its total fees and deals across all project spaces.</p>
    </div>`;
  setTimeout(() => input?.focus(), 50);
}

async function runSearch(query) {
  const q = query.trim();
  _lastQuery = q;
  const results = document.getElementById("companies-results");
  if (!results) return;
  if (!q) { goSearch(); return; }

  results.innerHTML = loadingHtml("Searching…");
  setStatus("Searching…");
  const qs = filterQS();
  try {
    const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}${qs ? "&" + qs : ""}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (q !== _lastQuery) return;

    const companies = data.companies || [];
    if (!companies.length) {
      results.innerHTML = renderEmpty(`No companies found for “${data.query}”${anyFilters() ? " with the active filters" : ""}.`);
      setStatus(`No matches for “${data.query}”`);
      return;
    }
    const shown = companies.length, total = data.total_companies ?? shown;
    const summary = data.truncated
      ? `Showing ${shown} of ${total} companies · refine your search`
      : `${shown} compan${shown === 1 ? "y" : "ies"}`;
    results.innerHTML = grandTotalHtml(data, total)
      + `<p class="companies-result-summary${data.truncated ? " truncated" : ""}">${escapeHtml(summary)}</p>`
      + companies.map(companyCard).join("");
    wireCards(results);
    setStatus(summary);
  } catch (err) {
    if (q !== _lastQuery) return;
    console.error("Company search failed:", err);
    results.innerHTML = renderError();
    setStatus("Search failed", true);
  }
}

// ---- All Companies view (sortable, paginated table) ---------------

async function goAll() {
  _view = "all";
  _browse.page = 1;
  await ensureFilterOptions();
  const section = document.getElementById(SECTION_ID);
  section.innerHTML = `
    <div class="hub-section">
      ${headerHtml("All Companies", "Every company, sortable and filterable — totals reflect any active filters")}
      ${filterBarHtml()}
      <label class="companies-nodeal-toggle"><input type="checkbox" id="companies-nodeal-cb"> Include companies with no deals</label>
      <div id="companies-table-wrap" class="companies-table-wrap"></div>
    </div>`;
  wireHeader(goLanding);
  bindFilters(() => { _browse.page = 1; loadBrowse(); });
  document.getElementById("companies-nodeal-cb")?.addEventListener("change", () => { _browse.page = 1; loadBrowse(); });
  loadBrowse();
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
  const url = `${API_BASE}/companies?sort=${_browse.sort}&dir=${_browse.dir}&page=${_browse.page}&page_size=${PAGE_SIZE}${includeNodeal}${qs ? "&" + qs : ""}`;
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
    if (_view === "search" && _lastQuery) runSearch(_lastQuery);
    else if (_view === "all") loadBrowse();
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
