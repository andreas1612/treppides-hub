// ============================================================
// components/pages/crm-list.js — generic CRM list dashboard.
//
// One config-driven view that renders ANY simple list dashboard (Leads /
// Accounts Companies / Accounts Individuals) from the backend registry:
//   GET /api/companies/lists                 → column/filter/kpi config
//   GET /api/companies/list/{key}/rows       → table rows (filter/search/sort/page)
//   GET /api/companies/list/{key}/filters    → cascading filter options
//   GET /api/companies/list/{key}/kpis       → summary tiles + charts
//   GET /api/companies/list/{key}/{task_id}  → record detail (+ linked deals)
//
// Nav: reached from the CRM landing; its back button returns there.
// Mounts into: #section-crmlist
//
// Read-only in this phase (view/search/filter/KPIs/detail). Inline editing
// (status/assignee/comment → ClickUp) is layered on next via crm-shared.
// ============================================================

import { escapeHtml, renderError, renderEmpty } from "../../utils/dom.js";
import { prettySpace, statusPill, loadChartJs, mountFilterBar, filterQS, renderEditor } from "./crm-shared.js";

const SECTION_ID = "section-crmlist";
const IS_LOCAL   = window.location.hostname === "localhost";
const API_BASE   = IS_LOCAL ? "http://localhost:8003/api/companies" : "/api/companies";
const PAGE_SIZE  = 50;
const SEARCH_DEBOUNCE_MS = 400;

const EUR = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

// KPI chart palette (one hue per bar-chart card, cycled).
const KPI_COLORS = ["#4A90D9", "#48BB78", "#9F7AEA", "#ED8936", "#38B2AC", "#E53E3E"];

// ---- State --------------------------------------------------------
let _registry = null;                 // {key: cfg} from /lists
let _key = null;
let _cfg = null;
let _filters = {};                    // {filterKey: [values]}
let _q = "";
let _sort = "";
let _dir = "asc";
let _page = 1;
let _total = 0;
let _charts = [];
let _debounceTimer = null;

// ---- Page visibility ----------------------------------------------

function showPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove("fees-active", "aml-active", "staff-active",
    "companies-active", "forms-active", "kb-active", "crm-active");
  main.classList.add("crmlist-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "crmlist" } }));
}

function hidePage() {
  destroyCharts();
  document.querySelector(".main")?.classList.remove("crmlist-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

function destroyCharts() {
  _charts.forEach(c => { try { c.destroy(); } catch { /* noop */ } });
  _charts = [];
}

async function show(key) {
  showPage();
  const section = document.getElementById(SECTION_ID);
  if (!section) return;
  try {
    await ensureRegistry();
  } catch {
    section.innerHTML = `<div class="hub-section">${renderError()}</div>`;
    return;
  }
  _cfg = _registry[key];
  if (!_cfg) {
    section.innerHTML = `<div class="hub-section">${renderEmpty("This dashboard isn't configured on the server.")}</div>`;
    return;
  }
  _key = key;
  _filters = {};
  _cfg.filters.forEach(f => { _filters[f.key] = []; });
  _q = ""; _sort = ""; _dir = "asc"; _page = 1;
  renderShell();
}

window.__hub_crmlist = { show, hide: hidePage };

// ---- Registry -----------------------------------------------------

async function ensureRegistry() {
  if (_registry) return _registry;
  const res = await fetch(`${API_BASE}/lists`);
  if (!res.ok) throw new Error(`lists ${res.status}`);
  const data = await res.json();
  _registry = {};
  for (const l of data.lists) _registry[l.key] = l;
  return _registry;
}

// ---- Shell --------------------------------------------------------

const BACK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;
const SEARCH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
const REFRESH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;

function renderShell() {
  const section = document.getElementById(SECTION_ID);
  section.innerHTML = `
    <div class="hub-section">
      <div class="section-header">
        <div class="companies-header-left">
          <button class="companies-back-btn" id="crml-back" aria-label="Back to CRM">${BACK_SVG}</button>
          <div>
            <h2 class="section-title">${escapeHtml(_cfg.title)}</h2>
            <p class="section-subtitle">${escapeHtml(_cfg.subtitle || "")}</p>
          </div>
        </div>
        <div class="companies-header-right">
          <button class="companies-refresh-btn" id="crml-refresh" aria-label="Refresh" title="Refresh">${REFRESH_SVG}</button>
        </div>
      </div>

      <div id="crml-kpis" class="crml-kpis"></div>

      <div class="companies-searchbar">
        <span class="companies-search-icon">${SEARCH_SVG}</span>
        <input type="search" id="crml-search" class="companies-search-input"
               placeholder="${escapeHtml(_cfg.search_placeholder || "Search…")}"
               autocomplete="off" spellcheck="false" aria-label="Search">
      </div>

      <div id="crml-filterbar"></div>
      <div id="crml-detail-host"></div>
      <div id="crml-table" class="companies-table-wrap"></div>
    </div>`;

  document.getElementById("crml-back")?.addEventListener("click", () => {
    hidePage();
    window.__hub_crm?.show();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.getElementById("crml-refresh")?.addEventListener("click", () => {
    loadKpis(); loadRows();
  });

  const input = document.getElementById("crml-search");
  input?.addEventListener("input", e => {
    _q = e.target.value;
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => { _page = 1; loadRows(); }, SEARCH_DEBOUNCE_MS);
  });

  // Cascading filter bar (options scoped to the active list + other filters).
  mountFilterBar(document.getElementById("crml-filterbar"), {
    filters: _cfg.filters,
    state: _filters,
    fetchOptions: async (state) => {
      const qs = filterQS(state);
      const res = await fetch(`${API_BASE}/list/${_key}/filters${qs ? "?" + qs : ""}`);
      return res.ok ? (await res.json()).filters : {};
    },
    onApply: () => { _page = 1; loadRows(); loadKpis(); },
  });

  loadKpis();
  loadRows();
}

function loadingHtml(msg = "Loading…") {
  return `<div class="companies-loading" aria-busy="true"><span class="companies-spinner" aria-hidden="true"></span><span>${escapeHtml(msg)}</span></div>`;
}

// ---- KPIs ---------------------------------------------------------

async function loadKpis() {
  const wrap = document.getElementById("crml-kpis");
  if (!wrap) return;
  const qs = filterQS(_filters);
  try {
    const res = await fetch(`${API_BASE}/list/${_key}/kpis${qs ? "?" + qs : ""}`);
    if (!res.ok) throw new Error(`kpis ${res.status}`);
    renderKpis(wrap, await res.json());
  } catch (err) {
    console.error("[CRM] kpis failed:", err);
    wrap.innerHTML = "";
  }
}

function renderKpis(wrap, data) {
  destroyCharts();
  const total = data.total || 0;
  const groups = data.groups || [];
  const cards = groups.map(g =>
    `<div class="crml-kpi-card">
       <div class="crml-kpi-title">${escapeHtml(g.label)}</div>
       <div class="crml-kpi-canvas"><canvas id="crml-chart-${escapeHtml(g.key)}"></canvas></div>
     </div>`).join("");
  wrap.innerHTML = `
    <div class="crml-kpi-total">
      <span class="crml-kpi-total-num">${total.toLocaleString("en-IE")}</span>
      <span class="crml-kpi-total-label">${escapeHtml(_cfg.title)}</span>
    </div>
    ${cards}`;

  loadChartJs().then(() => {
    if (!window.Chart) return;
    groups.forEach((g, i) => {
      const canvas = document.getElementById(`crml-chart-${g.key}`);
      if (!canvas || !g.items.length) return;
      const color = KPI_COLORS[i % KPI_COLORS.length];
      const chart = new window.Chart(canvas.getContext("2d"), {
        type: "bar",
        data: {
          labels: g.items.map(it => it.label.length > 22 ? it.label.slice(0, 20) + "…" : it.label),
          datasets: [{ data: g.items.map(it => it.count), backgroundColor: color + "cc", borderColor: color, borderWidth: 1 }],
        },
        options: {
          indexAxis: "y",
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { title: items => g.items[items[0].dataIndex].label } } },
          scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
        },
      });
      _charts.push(chart);
    });
  }).catch(() => { /* charts optional */ });
}

// ---- Table --------------------------------------------------------

async function loadRows() {
  const wrap = document.getElementById("crml-table");
  if (!wrap) return;
  wrap.innerHTML = loadingHtml("Loading…");
  const qs = filterQS(_filters);
  const params = `sort=${encodeURIComponent(_sort)}&dir=${_dir}&page=${_page}&page_size=${PAGE_SIZE}` +
                 (_q.trim() ? `&q=${encodeURIComponent(_q.trim())}` : "") + (qs ? "&" + qs : "");
  try {
    const res = await fetch(`${API_BASE}/list/${_key}/rows?${params}`);
    if (!res.ok) throw new Error(`rows ${res.status}`);
    const data = await res.json();
    _total = data.total; _sort = data.sort; _dir = data.dir;
    renderTable(wrap, data);
  } catch (err) {
    console.error("[CRM] rows failed:", err);
    wrap.innerHTML = renderError();
  }
}

function sortIndicator(key) {
  if (_sort !== key) return "";
  return _dir === "asc" ? " ▲" : " ▼";
}

function renderCell(col, row) {
  if (col.type === "status") return statusPill(row.status, row.status_color);
  const val = row[col.key];
  if (col.type === "chips") {
    const arr = Array.isArray(val) ? val : [];
    if (!arr.length) return `<span class="crml-null">—</span>`;
    return arr.map(x => `<span class="crml-chip">${escapeHtml(String(x))}</span>`).join(" ");
  }
  if (val === null || val === undefined || val === "") return `<span class="crml-null">—</span>`;
  return escapeHtml(String(val));
}

function renderTable(wrap, data) {
  const rows = data.rows || [];
  if (!rows.length) {
    wrap.innerHTML = renderEmpty(`No records${anyFilter() ? " match the active filters" : ""}.`);
    return;
  }
  const cols = _cfg.columns;
  const head = cols.map(c => {
    const sortable = c.type !== "chips";
    return `<th class="${sortable ? "sortable" : ""}" ${sortable ? `data-sort="${escapeHtml(c.key)}"` : ""}>${escapeHtml(c.label)}${sortable ? sortIndicator(c.key) : ""}</th>`;
  }).join("");
  const body = rows.map(r => {
    const tds = cols.map(c => `<td>${renderCell(c, r)}</td>`).join("");
    return `<tr data-id="${escapeHtml(r.id)}">${tds}</tr>`;
  }).join("");

  const totalPages = Math.max(1, Math.ceil(data.total / data.page_size));
  const pager = `
    <div class="companies-pager">
      <button id="crml-prev" ${data.page <= 1 ? "disabled" : ""}>‹ Prev</button>
      <span>Page ${data.page} of ${totalPages} · ${data.total} record${data.total === 1 ? "" : "s"}</span>
      <button id="crml-next" ${data.page >= totalPages ? "disabled" : ""}>Next ›</button>
    </div>`;

  wrap.innerHTML = `
    <table class="companies-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>${pager}`;

  wrap.querySelectorAll("th.sortable").forEach(th => th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (_sort === key) _dir = _dir === "asc" ? "desc" : "asc";
    else { _sort = key; _dir = "asc"; }
    _page = 1; loadRows();
  }));
  wrap.querySelectorAll("tbody tr").forEach(tr =>
    tr.addEventListener("click", () => openDetail(tr.dataset.id)));
  document.getElementById("crml-prev")?.addEventListener("click", () => { if (_page > 1) { _page--; loadRows(); } });
  document.getElementById("crml-next")?.addEventListener("click", () => { _page++; loadRows(); });
}

function anyFilter() {
  return Object.values(_filters).some(a => a.length) || !!_q.trim();
}

// ---- Detail drawer ------------------------------------------------

async function openDetail(id) {
  // Render into a dedicated host ABOVE the table (not inside #crml-table) so a
  // background loadRows() after an edit can't wipe the open drawer.
  const host = document.getElementById("crml-detail-host");
  if (!host) return;
  host.innerHTML = "";
  const holder = document.createElement("div");
  holder.className = "crml-detail-pop companies-detail-pop";
  holder.innerHTML = `<button class="companies-detail-close" aria-label="Close">✕ Close</button>${loadingHtml("Loading record…")}`;
  host.appendChild(holder);
  holder.querySelector(".companies-detail-close").addEventListener("click", () => holder.remove());
  holder.scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const res = await fetch(`${API_BASE}/list/${_key}/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`detail ${res.status}`);
    renderDetail(holder, await res.json());
  } catch (err) {
    console.error("[CRM] detail failed:", err);
    holder.innerHTML = `<button class="companies-detail-close" aria-label="Close">✕ Close</button>${renderError()}`;
    holder.querySelector(".companies-detail-close").addEventListener("click", () => holder.remove());
  }
}

function renderDetail(holder, det) {
  const t = det.task || {};
  const fieldRows = (det.fields || []).map(f =>
    `<div class="crml-field"><span class="crml-field-label">${escapeHtml(f.label)}</span><span class="crml-field-value">${escapeHtml(String(f.value))}</span></div>`
  ).join("");

  const ubos = (t.ubos || []).length
    ? `<div class="crml-field"><span class="crml-field-label">UBO(s)</span><span class="crml-field-value">${(t.ubos).map(u => escapeHtml(String(u))).join(", ")}</span></div>`
    : "";
  const assignees = (t.assignees || []).length
    ? `<div class="crml-field"><span class="crml-field-label">Assignees</span><span class="crml-field-value">${(t.assignees).map(a => escapeHtml(String(a))).join(", ")}</span></div>`
    : "";

  const deals = (det.linked_deals || []).length ? `
    <div class="crml-deals">
      <h4>Linked deals <span class="companies-space-count">${det.linked_deals.length}</span></h4>
      <ul class="companies-task-list">
        ${det.linked_deals.map(d => `
          <li class="companies-task${d.is_lost ? " lost" : ""}">
            <div class="companies-task-main">
              <span class="companies-task-name">${escapeHtml(d.task_name || "(untitled)")}</span>
              ${statusPill(d.status, d.status_color)}
              ${d.deal_value != null ? `<span class="companies-meta-item companies-dealval">${EUR.format(d.deal_value)}</span>` : ""}
            </div>
            <div class="companies-task-meta">
              ${d.service ? `<span class="companies-meta-item">${escapeHtml(d.service)}</span>` : ""}
              ${d.url ? `<a class="companies-open" href="${escapeHtml(d.url)}" target="_blank" rel="noopener noreferrer">Open in ClickUp ↗</a>` : ""}
            </div>
          </li>`).join("")}
      </ul>
    </div>` : "";

  const openLink = t.url
    ? `<a class="companies-open" href="${escapeHtml(t.url)}" target="_blank" rel="noopener noreferrer">Open in ClickUp ↗</a>` : "";
  const space = t.space_name ? `<span class="crml-detail-space">${escapeHtml(prettySpace(t.space_name))}</span>` : "";

  holder.innerHTML = `
    <button class="companies-detail-close" aria-label="Close">✕ Close</button>
    <div class="crml-detail">
      <div class="crml-detail-head">
        <div>
          <h3 class="crml-detail-title">${escapeHtml(t.name || "(untitled)")}</h3>
          <p class="crml-detail-sub">${escapeHtml(t.tid || "")} ${space} ${statusPill(t.status, t.status_color)}</p>
        </div>
        ${openLink}
      </div>
      <div class="crml-fields">${assignees}${ubos}${fieldRows || (fieldRows === "" && !assignees && !ubos ? `<p class="crml-detail-empty">No additional details recorded.</p>` : "")}</div>
      ${deals}
      ${det.editable ? `<div class="crml-edit"><h4>Edit</h4><div class="companies-edit-panel" id="crml-editor"></div></div>` : ""}
    </div>`;
  holder.querySelector(".companies-detail-close").addEventListener("click", () => holder.remove());

  // Inline editor (status / assignee / comment → ClickUp) for editable lists.
  // On save, patch the drawer's status pill + assignees line and refresh the
  // table row (the write reconciles the mirror via sync_one server-side).
  if (det.editable) {
    const panel = holder.querySelector("#crml-editor");
    const onSaved = (freshTask) => {
      const pill = holder.querySelector(".crml-detail-sub .companies-status");
      if (pill && freshTask.status) pill.outerHTML = statusPill(freshTask.status, freshTask.status_color);
      const names = (freshTask.assignees || []).join(", ");
      holder.querySelectorAll(".crml-field").forEach(fl => {
        if (fl.querySelector(".crml-field-label")?.textContent === "Assignees") {
          const v = fl.querySelector(".crml-field-value");
          if (v) v.textContent = names || "—";
        }
      });
      loadRows();
    };
    renderEditor(panel, t.id, { apiBase: API_BASE, onSaved });
  }
}

// ---- Component init -----------------------------------------------

export default async function init(_config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;
  // Self-hide when the hub navigates anywhere that isn't us (same low-touch
  // pattern as crm.js) — removes the class directly, no re-dispatch.
  document.addEventListener("hub:navchange", e => {
    if (e.detail?.section !== "crmlist") {
      document.querySelector(".main")?.classList.remove("crmlist-active");
    }
  });
}
