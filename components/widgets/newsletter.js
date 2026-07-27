// ============================================================
// components/widgets/newsletter.js
// Regulatory & Industry Intelligence feed on the hub home page.
//
// Shows most recent items (4 initially). "Show more" expands.
// Filters: search, source, jurisdiction, priority.
// View toggle: My Department ↔ All Departments.
// ============================================================

import { getCurrentUser } from "../../js/auth.js";
import { escapeHtml } from "../../utils/dom.js";

const SECTION_ID = "section-newsletter";
const NL_API = "/api/newsletter";
const STAFF_API = "/api/staffdir";
const PREVIEW_COUNT = 4;

// ── State ──────────────────────────────────────────────────
let _department = "";
let _subDept = "";
let _deptDisplay = "";
let _activeTab = "authority";
let _viewMode = "dept";
let _expanded = false;
let _data = null;
let _allData = null;

// Filters
let _filters = { q: "", source: "", jurisdiction: "", level: "", department: "" };

// ── Helpers ────────────────────────────────────────────────

function levelClass(level) {
  const l = (level || "").toLowerCase();
  if (l === "urgent") return "nl-lvl-urgent";
  if (l === "high")   return "nl-lvl-high";
  if (l === "low")    return "nl-lvl-low";
  return "nl-lvl-standard";
}

function prettySource(s) {
  return (s || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function prettyTag(t) {
  return (t || "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function prettyDocType(t) {
  return (t || "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return ""; }
}

function relativeDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = Math.floor((now - d) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 7) return `${diff}d ago`;
    if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
    return formatDate(iso);
  } catch { return ""; }
}

// ── Card HTML ──────────────────────────────────────────────

function cardHtml(item) {
  const tags = Array.isArray(item.theme_tags) ? item.theme_tags : [];
  const summary = item.ai_summary || "";
  const title = item.title || "(No title)";
  const date = relativeDate(item.published_at);
  const fullDate = formatDate(item.published_at);
  const jur = (item.jurisdiction || "").toUpperCase();
  const docType = prettyDocType(item.doc_type);

  return `
    <article class="nl-card">
      <div class="nl-card-left">
        <span class="nl-level ${levelClass(item.level)}">${escapeHtml(item.level || "Standard")}</span>
      </div>
      <div class="nl-card-body">
        <div class="nl-card-header">
          <span class="nl-source">${escapeHtml(prettySource(item.source))}</span>
          ${jur ? `<span class="nl-jur nl-jur-${(item.jurisdiction || "").toLowerCase()}">${escapeHtml(jur)}</span>` : ""}
          ${docType ? `<span class="nl-doctype">${escapeHtml(docType)}</span>` : ""}
          <span class="nl-date">${escapeHtml(fullDate)}${date && date !== fullDate ? ` \u00b7 ${escapeHtml(date)}` : ""}</span>
        </div>
        <h4 class="nl-title"><a href="${escapeHtml(item.url || "#")}" target="_blank" rel="noopener">${escapeHtml(title)}</a></h4>
        ${summary ? `<p class="nl-summary">${escapeHtml(summary)}</p>` : ""}
        ${tags.length ? `<div class="nl-tags">${tags.slice(0, 4).map(t => `<span class="nl-tag">${escapeHtml(prettyTag(t))}</span>`).join("")}</div>` : ""}
      </div>
    </article>`;
}

// ── Resolve user department ────────────────────────────────

async function resolveUserDept() {
  const user = getCurrentUser();
  if (!user || !user.email) return;
  try {
    const res = await fetch(`${STAFF_API}/api/staff`);
    if (!res.ok) return;
    const staff = await res.json();
    const me = staff.find(s => (s.email || "").toLowerCase() === user.email.toLowerCase());
    if (me) {
      _department = me.department || "";
      _subDept = me.subDepartment || "";
      _deptDisplay = me.rawDepartment || me.department || "";
    }
  } catch (e) {
    console.warn("[newsletter] Could not resolve department:", e);
  }
}

// ── Fetch ──────────────────────────────────────────────────

async function fetchNewsletter() {
  if (!_department) return { authority: [], journal: [] };
  const params = new URLSearchParams({ department: _department });
  if (_subDept) params.set("sub", _subDept);
  try {
    const res = await fetch(`${NL_API}/newsletter?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn("[newsletter] Fetch error:", e);
    return { authority: [], journal: [] };
  }
}

async function fetchAllItems() {
  if (_allData) return _allData;
  try {
    const res = await fetch(`${NL_API}/items`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    const items = d.items || [];
    _allData = {
      authority: items.filter(i => i.source_category === "authority"),
      journal: items.filter(i => i.source_category === "journal"),
    };
    return _allData;
  } catch (e) {
    console.warn("[newsletter] Fetch all error:", e);
    return { authority: [], journal: [] };
  }
}

// ── Feed + filter logic ────────────────────────────────────

function currentFeed() {
  if (_viewMode === "all" && _allData) return _allData;
  return _data || { authority: [], journal: [] };
}

function getFilterOptions() {
  const feed = currentFeed();
  const all = [...(feed.authority || []), ...(feed.journal || [])];
  const depts = new Set();
  all.forEach(i => { (i.departments || []).forEach(d => { if (d) depts.add(d); }); });
  return {
    sources: [...new Set(all.map(i => i.source).filter(Boolean))].sort(),
    jurisdictions: [...new Set(all.map(i => i.jurisdiction).filter(Boolean))].sort(),
    levels: [...new Set(all.map(i => i.level).filter(Boolean))].sort((a, b) => {
      const o = { Urgent: 0, High: 1, Standard: 2, Low: 3 };
      return (o[a] ?? 9) - (o[b] ?? 9);
    }),
    departments: [...depts].sort(),
  };
}

function applyFilters(items) {
  let list = [...items];
  const { q, source, jurisdiction, level } = _filters;

  if (q) {
    const ql = q.toLowerCase();
    list = list.filter(it => {
      const hay = [
        it.title, it.ai_summary, it.source, it.jurisdiction, it.doc_type,
        ...(Array.isArray(it.theme_tags) ? it.theme_tags : [])
      ].join(" ").toLowerCase();
      return hay.includes(ql);
    });
  }
  if (source) list = list.filter(i => i.source === source);
  if (jurisdiction) list = list.filter(i => i.jurisdiction === jurisdiction);
  if (level) list = list.filter(i => i.level === level);
  if (_filters.department) list = list.filter(i => (i.departments || []).includes(_filters.department));

  list.sort((a, b) => (b.published_at || "").localeCompare(a.published_at || ""));
  return list;
}

// ── Build filter dropdowns ─────────────────────────────────

function buildFilterHtml() {
  const opts = getFilterOptions();

  function selectHtml(id, label, values, current, formatter) {
    if (!values.length) return "";
    const options = values.map(v =>
      `<option value="${escapeHtml(v)}" ${v === current ? "selected" : ""}>${escapeHtml(formatter ? formatter(v) : v)}</option>`
    ).join("");
    return `
      <select class="nl-filter-select" id="${id}">
        <option value="">${escapeHtml(label)}</option>
        ${options}
      </select>`;
  }

  return `
    <div class="nl-filters">
      <div class="nl-search-wrap">
        <svg class="nl-search-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="nl-search" type="text" placeholder="Search..." id="nl-search" value="${escapeHtml(_filters.q)}" />
      </div>
      ${selectHtml("nl-f-dept", "All Departments", opts.departments, _filters.department)}
      ${selectHtml("nl-f-source", "All Sources", opts.sources, _filters.source, prettySource)}
      ${selectHtml("nl-f-jurisdiction", "All Jurisdictions", opts.jurisdictions, _filters.jurisdiction, j => j.toUpperCase())}
      ${selectHtml("nl-f-level", "All Priorities", opts.levels, _filters.level)}
    </div>`;
}

// ── Render ──────────────────────────────────────────────────

function renderItems() {
  const container = document.getElementById("nl-items");
  const moreBtn = document.getElementById("nl-more-btn");
  if (!container) return;

  const feed = currentFeed();
  const all = applyFilters(feed[_activeTab] || []);

  if (!all.length) {
    const label = _activeTab === "authority" ? "regulatory" : "industry news";
    const hasFilters = _filters.q || _filters.source || _filters.jurisdiction || _filters.level || _filters.department;
    container.innerHTML = `<div class="nl-empty">${hasFilters ? "No items match your filters." : `No ${label} items right now.`}</div>`;
    if (moreBtn) moreBtn.style.display = "none";
    return;
  }

  const show = _expanded ? all : all.slice(0, PREVIEW_COUNT);
  const remaining = all.length - PREVIEW_COUNT;

  container.innerHTML = show.map(cardHtml).join("");

  if (moreBtn) {
    if (!_expanded && remaining > 0) {
      moreBtn.style.display = "";
      moreBtn.innerHTML = `Show ${remaining} more item${remaining !== 1 ? "s" : ""} <span class="nl-more-arrow">&darr;</span>`;
    } else if (_expanded && all.length > PREVIEW_COUNT) {
      moreBtn.style.display = "";
      moreBtn.innerHTML = `Show less <span class="nl-more-arrow">&uarr;</span>`;
    } else {
      moreBtn.style.display = "none";
    }
  }
}

function updateCounts() {
  const feed = currentFeed();
  const ac = applyFilters(feed.authority || []).length;
  const jc = applyFilters(feed.journal || []).length;
  const ael = document.getElementById("nl-cnt-auth");
  const jel = document.getElementById("nl-cnt-jour");
  if (ael) ael.textContent = ac;
  if (jel) jel.textContent = jc;
}

function onFilterChange() {
  _expanded = false;
  updateCounts();
  renderItems();
}

// ── Main render ────────────────────────────────────────────

function render() {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  const feed = currentFeed();
  const authCount = applyFilters(feed.authority || []).length;
  const jourCount = applyFilters(feed.journal || []).length;

  const subtitle = _viewMode === "all"
    ? "All departments"
    : (_department ? escapeHtml(_deptDisplay) : "All updates");

  section.innerHTML = `
    <div class="hub-section nl-section">

      <div class="nl-header">
        <div class="nl-header-left">
          <h2 class="nl-heading">Regulatory &amp; Industry Intelligence</h2>
          <span class="nl-scope" id="nl-scope">${subtitle}</span>
        </div>
        <div class="nl-view-toggle">
          ${_department ? `<button class="nl-view-btn ${_viewMode === "dept" ? "active" : ""}" data-view="dept">${escapeHtml(_deptDisplay || "My Dept")}</button>` : ""}
          <button class="nl-view-btn ${_viewMode === "all" ? "active" : ""}" data-view="all">All Depts</button>
        </div>
      </div>

      ${buildFilterHtml()}

      <div class="nl-tabs">
        <button class="nl-tab ${_activeTab === "authority" ? "active" : ""}" data-tab="authority">
          Regulatory <span class="nl-tab-count" id="nl-cnt-auth">${authCount}</span>
        </button>
        <button class="nl-tab ${_activeTab === "journal" ? "active" : ""}" data-tab="journal">
          Industry News <span class="nl-tab-count" id="nl-cnt-jour">${jourCount}</span>
        </button>
      </div>

      <div id="nl-items" class="nl-items"></div>

      <button class="nl-more-btn" id="nl-more-btn" style="display:none">Show more</button>

    </div>`;

  // ── Wire events ──

  // View toggle
  section.querySelectorAll(".nl-view-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      _viewMode = btn.dataset.view;
      _expanded = false;
      section.querySelectorAll(".nl-view-btn").forEach(b => b.classList.toggle("active", b === btn));
      if (_viewMode === "all" && !_allData) {
        document.getElementById("nl-items").innerHTML = `<div class="nl-loading"><div class="spinner"></div></div>`;
        await fetchAllItems();
      }
      const scope = document.getElementById("nl-scope");
      if (scope) scope.textContent = _viewMode === "all" ? "All departments" : (_deptDisplay || "All updates");
      // Rebuild filters (options may change)
      const filtersWrap = section.querySelector(".nl-filters");
      if (filtersWrap) { filtersWrap.outerHTML = buildFilterHtml(); wireFilters(); }
      updateCounts();
      renderItems();
    });
  });

  // Tabs
  section.querySelectorAll(".nl-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      _activeTab = btn.dataset.tab;
      _expanded = false;
      section.querySelectorAll(".nl-tab").forEach(b => b.classList.toggle("active", b === btn));
      renderItems();
    });
  });

  // Show more / less
  document.getElementById("nl-more-btn")?.addEventListener("click", () => {
    _expanded = !_expanded;
    renderItems();
  });

  wireFilters();
  renderItems();
}

function wireFilters() {
  // Search
  let t;
  document.getElementById("nl-search")?.addEventListener("input", e => {
    clearTimeout(t);
    t = setTimeout(() => { _filters.q = e.target.value.trim(); onFilterChange(); }, 200);
  });
  // Dropdowns
  document.getElementById("nl-f-dept")?.addEventListener("change", e => { _filters.department = e.target.value; onFilterChange(); });
  document.getElementById("nl-f-source")?.addEventListener("change", e => { _filters.source = e.target.value; onFilterChange(); });
  document.getElementById("nl-f-jurisdiction")?.addEventListener("change", e => { _filters.jurisdiction = e.target.value; onFilterChange(); });
  document.getElementById("nl-f-level")?.addEventListener("change", e => { _filters.level = e.target.value; onFilterChange(); });
}

// ── Init ───────────────────────────────────────────────────

export default async function init(_config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  section.innerHTML = `
    <div class="hub-section nl-section">
      <div class="nl-header"><div class="nl-header-left">
        <h2 class="nl-heading">Regulatory &amp; Industry Intelligence</h2>
        <span class="nl-scope">Loading...</span>
      </div></div>
      <div class="nl-loading"><div class="spinner"></div></div>
    </div>`;

  await resolveUserDept();
  _data = await fetchNewsletter();

  const hasItems = (_data.authority || []).length + (_data.journal || []).length;
  if (!hasItems) {
    _viewMode = "all";
    await fetchAllItems();
  }

  render();
}
