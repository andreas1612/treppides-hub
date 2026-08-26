// ============================================================
// components/pages/accounts.js — read-only Accounts directory.
//
// A Tools-page view of the two CRM Account lists (Companies / Individuals)
// available to EVERY hub user. Deliberately separate from the CRM dashboards:
//   • talks ONLY to the read-only public API (/api/companies/public/*), which
//     is allowlisted server-side to these two lists and strips fee data;
//   • renders NO edit affordance and NO Forms button — view / search / filter
//     / KPIs / detail only;
//   • its back button returns to the Tools grid, NEVER to the CRM landing.
//
// The editable CRM (deals, leads, contacts, inline editing, forms) stays in
// crm-list.js / crm.js behind the `crm` feature (SUPERVISOR tier and up). This
// file has no code path to any of that.
//
// Reached via routes /tools/accounts-companies and /tools/accounts-individuals.
// Mounts into: #section-accounts
// ============================================================

import { escapeHtml, renderError, renderEmpty } from "../../utils/dom.js?v=2";
import { prettySpace, statusPill, loadChartJs, mountFilterBar, filterQS } from "./crm-shared.js";

const SECTION_ID = "section-accounts";
const IS_LOCAL   = window.location.hostname === "localhost";
// Read-only public surface only — never the editable /api/companies/list/* base.
const API_BASE   = IS_LOCAL ? "http://localhost:8003/api/companies/public" : "/api/companies/public";
const PAGE_SIZE  = 50;
const SEARCH_DEBOUNCE_MS = 400;

// The only list keys this view will ever request (mirrors the server allowlist).
const ALLOWED_KEYS = new Set(["accounts_companies", "accounts_individuals"]);

const KPI_COLORS = ["#4A90D9", "#48BB78", "#9F7AEA", "#ED8936", "#38B2AC", "#E53E3E"];
const NEW_WITHIN_DAYS = 14;

function fmtDateCell(ms) {
  const n = Number(ms);
  if (!ms || Number.isNaN(n)) return `<span class="crml-null">—</span>`;
  const d = new Date(n);
  const label = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const ageDays = (Date.now() - n) / 86400000;
  const isNew = ageDays >= 0 && ageDays < NEW_WITHIN_DAYS;
  const badge = isNew ? ` <span class="crml-new" title="Created in the last ${NEW_WITHIN_DAYS} days">New</span>` : "";
  return `<span class="crml-date" title="${escapeHtml(d.toISOString().slice(0, 10))}">${escapeHtml(label)}</span>${badge}`;
}

// ---- State --------------------------------------------------------
let _registry = null;
let _key = null;
let _cfg = null;
let _filters = {};
let _q = "";
let _sort = "";
let _dir = "asc";
let _page = 1;
let _charts = [];
let _debounceTimer = null;

// ---- Page visibility ----------------------------------------------

function showPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove("fees-active", "aml-active", "staff-active",
    "companies-active", "forms-active", "kb-active", "crm-active", "crmlist-active");
  main.classList.add("accounts-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "accounts" } }));
}

function hidePage() {
  destroyCharts();
  document.querySelector(".main")?.classList.remove("accounts-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

function destroyCharts() {
  _charts.forEach(c => { try { c.destroy(); } catch { /* noop */ } });
  _charts = [];
}

async function show(key) {
  // Hard guard: this view only ever serves the two allowlisted Account lists.
  if (!ALLOWED_KEYS.has(key)) {
    window.__hub_router?.navigate("/tools");
    return;
  }
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
    section.innerHTML = `<div class="hub-section">${renderEmpty("This directory isn't available.")}</div>`;
    return;
  }
  _key = key;
  _filters = {};
  _cfg.filters.forEach(f => { _filters[f.key] = []; });
  _q = ""; _sort = ""; _dir = "asc"; _page = 1;
  goMain();
}

window.__hub_accounts = { show, hide: hidePage };

// ---- Registry -----------------------------------------------------

async function ensureRegistry() {
  if (_registry) return _registry;
  const res = await fetch(`${API_BASE}/lists`, { credentials: "include" });
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
const CHART_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;

// Shared header (no Forms button — this is a read-only directory).
function headerHtml(title, subtitle, rightButtons, backLabel) {
  return `
    <div class="section-header">
      <div class="companies-header-left">
        <button class="companies-back-btn" id="acc-back" aria-label="${escapeHtml(backLabel || "Back")}">${BACK_SVG}</button>
        <div>
          <h2 class="section-title">${escapeHtml(title)}</h2>
          <p class="section-subtitle">${escapeHtml(subtitle || "")}</p>
        </div>
      </div>
      <div class="companies-header-right">
        ${rightButtons || ""}
        <button class="companies-refresh-btn" id="acc-refresh" aria-label="Refresh" title="Refresh">${REFRESH_SVG}</button>
      </div>
    </div>`;
}

function mountFilters(onApply) {
  mountFilterBar(document.getElementById("acc-filterbar"), {
    filters: _cfg.filters,
    state: _filters,
    primaryKey: "space",
    fetchOptions: async (state) => {
      const qs = filterQS(state);
      const res = await fetch(`${API_BASE}/list/${_key}/filters${qs ? "?" + qs : ""}`, { credentials: "include" });
      return res.ok ? (await res.json()).filters : {};
    },
    onApply,
  });
}

// ---- Main view: table ---------------------------------------------

function goMain() {
  destroyCharts();
  const section = document.getElementById(SECTION_ID);
  const chartBtn = `<button class="companies-chart-btn" id="acc-chart-btn" title="View charts">${CHART_ICON} Chart</button>`;
  section.innerHTML = `
    <div class="hub-section">
      ${headerHtml(_cfg.title, _cfg.subtitle, chartBtn, "Back to Tools")}
      <div class="companies-searchbar">
        <span class="companies-search-icon">${SEARCH_SVG}</span>
        <input type="search" id="acc-search" class="companies-search-input"
               placeholder="${escapeHtml(_cfg.search_placeholder || "Search…")}"
               autocomplete="off" spellcheck="false" aria-label="Search" value="${escapeHtml(_q)}">
      </div>
      <div id="acc-filterbar"></div>
      <div id="acc-detail-host"></div>
      <div id="acc-table" class="companies-table-wrap"></div>
    </div>`;

  document.getElementById("acc-back")?.addEventListener("click", () => {
    window.__hub_router?.navigate("/tools");
  });
  document.getElementById("acc-refresh")?.addEventListener("click", () => loadRows());
  document.getElementById("acc-chart-btn")?.addEventListener("click", () => { goChart(); window.scrollTo({ top: 0, behavior: "smooth" }); });

  const input = document.getElementById("acc-search");
  input?.addEventListener("input", e => {
    _q = e.target.value;
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => { _page = 1; loadRows(); }, SEARCH_DEBOUNCE_MS);
  });

  mountFilters(() => { _page = 1; loadRows(); });
  loadRows();
}

// ---- Chart view ---------------------------------------------------

function goChart() {
  const section = document.getElementById(SECTION_ID);
  section.innerHTML = `
    <div class="hub-section">
      ${headerHtml(`${_cfg.title} — Charts`, "Breakdowns reflecting the active filters", "", "Back to list")}
      <div id="acc-filterbar"></div>
      <div id="acc-charts" class="crml-kpis"></div>
    </div>`;

  document.getElementById("acc-back")?.addEventListener("click", () => { goMain(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  document.getElementById("acc-refresh")?.addEventListener("click", () => loadCharts());

  mountFilters(() => loadCharts());
  loadCharts();
}

function loadingHtml(msg = "Loading…") {
  return `<div class="companies-loading" aria-busy="true"><span class="companies-spinner" aria-hidden="true"></span><span>${escapeHtml(msg)}</span></div>`;
}

async function loadCharts() {
  const wrap = document.getElementById("acc-charts");
  if (!wrap) return;
  wrap.innerHTML = loadingHtml("Building charts…");
  const qs = filterQS(_filters);
  try {
    const res = await fetch(`${API_BASE}/list/${_key}/kpis${qs ? "?" + qs : ""}`, { credentials: "include" });
    if (!res.ok) throw new Error(`kpis ${res.status}`);
    renderCharts(wrap, await res.json());
  } catch (err) {
    console.error("[Accounts] charts failed:", err);
    wrap.innerHTML = renderError();
  }
}

function renderCharts(wrap, data) {
  destroyCharts();
  const total = data.total || 0;
  const groups = data.groups || [];
  const cards = groups.map(g =>
    `<div class="crml-kpi-card">
       <div class="crml-kpi-title">${escapeHtml(g.label)}</div>
       <div class="crml-kpi-canvas"><canvas id="acc-chart-${escapeHtml(g.key)}"></canvas></div>
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
      const canvas = document.getElementById(`acc-chart-${g.key}`);
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
  const wrap = document.getElementById("acc-table");
  if (!wrap) return;
  wrap.innerHTML = loadingHtml("Loading…");
  const qs = filterQS(_filters);
  const params = `sort=${encodeURIComponent(_sort)}&dir=${_dir}&page=${_page}&page_size=${PAGE_SIZE}` +
                 (_q.trim() ? `&q=${encodeURIComponent(_q.trim())}` : "") + (qs ? "&" + qs : "");
  try {
    const res = await fetch(`${API_BASE}/list/${_key}/rows?${params}`, { credentials: "include" });
    if (!res.ok) throw new Error(`rows ${res.status}`);
    const data = await res.json();
    _sort = data.sort; _dir = data.dir;
    renderTable(wrap, data);
  } catch (err) {
    console.error("[Accounts] rows failed:", err);
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
  if (col.type === "links") {
    if (typeof val === "string" && val.trim()) return escapeHtml(val);
    const arr = Array.isArray(val) ? val : [];
    if (!arr.length) return `<span class="crml-null">—</span>`;
    return arr.map(l => l.url
      ? `<a class="crml-link" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer" title="Open in ClickUp">${escapeHtml(l.name)}</a>`
      : `<span class="crml-chip">${escapeHtml(l.name)}</span>`).join(" ");
  }
  if (col.type === "chips") {
    const arr = Array.isArray(val) ? val : [];
    if (!arr.length) return `<span class="crml-null">—</span>`;
    const MAX = 3;
    const shown = arr.slice(0, MAX).map(x => `<span class="crml-chip">${escapeHtml(String(x))}</span>`).join(" ");
    const more = arr.length > MAX ? `<span class="crml-chip-more">+${arr.length - MAX}</span>` : "";
    return shown + more;
  }
  if (col.type === "date") return fmtDateCell(val);
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
      <button id="acc-prev" ${data.page <= 1 ? "disabled" : ""}>‹ Prev</button>
      <span>Page ${data.page} of ${totalPages} · ${data.total} record${data.total === 1 ? "" : "s"}</span>
      <button id="acc-next" ${data.page >= totalPages ? "disabled" : ""}>Next ›</button>
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
    tr.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      openDetail(tr.dataset.id);
    }));
  document.getElementById("acc-prev")?.addEventListener("click", () => { if (_page > 1) { _page--; loadRows(); } });
  document.getElementById("acc-next")?.addEventListener("click", () => { _page++; loadRows(); });
}

function anyFilter() {
  return Object.values(_filters).some(a => a.length) || !!_q.trim();
}

// ---- Detail drawer (read-only) ------------------------------------

async function openDetail(id) {
  const host = document.getElementById("acc-detail-host");
  if (!host) return;
  host.innerHTML = "";
  const holder = document.createElement("div");
  holder.className = "crml-detail-pop companies-detail-pop";
  holder.innerHTML = `<button class="companies-detail-close" aria-label="Close">✕ Close</button>${loadingHtml("Loading record…")}`;
  host.appendChild(holder);
  holder.querySelector(".companies-detail-close").addEventListener("click", () => holder.remove());
  holder.scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const res = await fetch(`${API_BASE}/list/${_key}/${encodeURIComponent(id)}`, { credentials: "include" });
    if (!res.ok) throw new Error(`detail ${res.status}`);
    renderDetail(holder, await res.json());
  } catch (err) {
    console.error("[Accounts] detail failed:", err);
    holder.innerHTML = `<button class="companies-detail-close" aria-label="Close">✕ Close</button>${renderError()}`;
    holder.querySelector(".companies-detail-close").addEventListener("click", () => holder.remove());
  }
}

function renderDetail(holder, det) {
  const t = det.task || {};

  const fieldRows = (det.fields || []).map(f => {
    let valHtml;
    if (f.type === "links") {
      const arr = Array.isArray(f.value) ? f.value : [];
      valHtml = arr.length
        ? arr.map(l => l.url
            ? `<a class="crml-link" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.name)}</a>`
            : escapeHtml(l.name)).join(", ")
        : "—";
    } else {
      valHtml = escapeHtml(String(f.value));
    }
    return `<div class="crml-field"><span class="crml-field-label">${escapeHtml(f.label)}</span><span class="crml-field-value">${valHtml}</span></div>`;
  }).join("");
  const ubos = (t.ubos || []).length
    ? `<div class="crml-field"><span class="crml-field-label">UBO(s)</span><span class="crml-field-value">${(t.ubos).map(u => escapeHtml(String(u))).join(", ")}</span></div>`
    : "";
  const assignees = (t.assignees || []).length
    ? `<div class="crml-field"><span class="crml-field-label">Assignees</span><span class="crml-field-value">${(t.assignees).map(a => escapeHtml(String(a))).join(", ")}</span></div>`
    : "";
  const fieldsBody = (assignees || ubos || fieldRows)
    ? `<div class="crml-fields">${assignees}${ubos}${fieldRows}</div>`
    : `<p class="crml-detail-empty">No additional details recorded.</p>`;

  // Linked deals — presence only. The public API never sends deal_value, and we
  // never render a value here: this view must never expose a deal's fee.
  const deals = (det.linked_deals || []).length ? `
    <div class="crml-deals">
      <h4>Linked deals <span class="companies-space-count">${det.linked_deals.length}</span></h4>
      <ul class="companies-task-list">
        ${det.linked_deals.map(d => `
          <li class="companies-task">
            <div class="companies-task-main">
              <span class="companies-task-name">${escapeHtml(d.task_name || "(untitled)")}</span>
              ${statusPill(d.status, d.status_color)}
            </div>
            <div class="companies-task-meta">
              ${d.service ? `<span class="companies-meta-item">${escapeHtml(d.service)}</span>` : ""}
            </div>
          </li>`).join("")}
      </ul>
    </div>` : "";

  const spaceName = t.space_name ? prettySpace(t.space_name) : _cfg.title;

  // Read-only record card: NO edit toggle, NO edit panel.
  holder.innerHTML = `
    <button class="companies-detail-close" aria-label="Close">✕ Close</button>
    <div class="companies-space crml-record">
      <div class="companies-space-header"><span class="companies-space-name">${escapeHtml(spaceName)}</span></div>
      <ul class="companies-task-list">
        <li class="companies-task">
          <div class="companies-task-main">
            <span class="companies-task-name">${escapeHtml(t.name || "(untitled)")}</span>
            ${statusPill(t.status, t.status_color)}
            ${t.tid ? `<span class="companies-meta-item">${escapeHtml(t.tid)}</span>` : ""}
          </div>
          <div class="companies-task-meta">
            ${t.date_created ? `<span class="companies-meta-item">Created ${fmtDateCell(t.date_created)}</span>` : ""}
          </div>
        </li>
      </ul>
    </div>
    <div class="crml-detail-body">
      ${fieldsBody}
      ${deals}
    </div>`;
  holder.querySelector(".companies-detail-close").addEventListener("click", () => holder.remove());
}

// ---- Component init -----------------------------------------------

export default async function init(_config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;
  // Self-hide when the hub navigates anywhere that isn't us.
  document.addEventListener("hub:navchange", e => {
    if (e.detail?.section !== "accounts") {
      document.querySelector(".main")?.classList.remove("accounts-active");
    }
  });
}
