// ============================================================
// components/pages/companies.js — Company Finder.
//
// Search a company NAME (or TID-XXXXX) → see its total Deal Value (fees)
// accrued across deals, plus every task across all ClickUp spaces grouped
// by space → list. Active vs Rejected/Lost deals are shown separately.
//
// Backend: companies-api (port 8003), proxied by nginx at /api/companies/*.
//   GET /api/companies/search?q=   → companies + fee totals
//   GET /api/companies/{tid}       → full per-company detail (lazy, on expand)
//   GET /api/companies/sync        → refresh from ClickUp
//   GET /api/companies/status      → DB freshness / last sync
//
// Mounts into: #section-companies (sibling of .page-content)
// ============================================================

import { escapeHtml, renderError, renderEmpty } from "../../utils/dom.js";
import { setStatus } from "../shell/topbar.js";

// ---- DOM IDs -------------------------------------------------------
const SECTION_ID = "section-companies";
const BACK_ID    = "companies-back-btn";
const INPUT_ID   = "companies-search-input";
const RESULTS_ID = "companies-results";
const REFRESH_ID = "companies-refresh-btn";
const SYNCED_ID  = "companies-synced";

// Nginx proxies /api/companies/* → http://127.0.0.1:8003 on the server.
// Relative path on purpose — never use localhost in frontend code.
const API_BASE = "/api/companies";

const SEARCH_DEBOUNCE_MS = 400;

const EUR = new Intl.NumberFormat("en-IE", {
  style: "currency", currency: "EUR", maximumFractionDigits: 0,
});

let _debounceTimer = null;
let _lastQuery     = "";

// ---- Page visibility ----------------------------------------------

function showPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove("fees-active", "staff-active", "aml-active");
  main.classList.add("companies-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "companies" } }));
  refreshSyncedLabel();
  setTimeout(() => document.getElementById(INPUT_ID)?.focus(), 50);
}

function hidePage() {
  document.querySelector(".main")?.classList.remove("companies-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_companies = { show: showPage, hide: hidePage };

// ---- Rendering -----------------------------------------------------

const PROMPT_HTML = `
  <div class="companies-prompt" role="status">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
    <h3>Search for a company</h3>
    <p>Type a company name to see its total fees and every ClickUp task it appears in, across all project spaces.</p>
  </div>`;

function loadingHtml(message = "Searching…") {
  return `
    <div class="companies-loading" aria-busy="true">
      <span class="companies-spinner" aria-hidden="true"></span>
      <span>${escapeHtml(message)}</span>
    </div>`;
}

function statusPill(task) {
  const label = task.status ? escapeHtml(task.status) : "—";
  const color = task.status_color && /^#[0-9a-f]{6}$/i.test(task.status_color)
    ? task.status_color
    : "#A0AEC0";
  return `<span class="companies-status" style="--pill:${color}">${label}</span>`;
}

function taskRow(task) {
  const due       = task.date_due ? `<span class="companies-meta-item">Due ${escapeHtml(fmtDate(task.date_due))}</span>` : "";
  const assignees = (task.assignees || []).length
    ? `<span class="companies-meta-item">${escapeHtml(task.assignees.join(", "))}</span>`
    : "";
  const deal = (task.is_deal && task.deal_value != null)
    ? `<span class="companies-meta-item companies-dealval">${EUR.format(task.deal_value)}</span>`
    : "";
  const open = task.url
    ? `<a class="companies-open" href="${escapeHtml(task.url)}" target="_blank" rel="noopener noreferrer">Open in ClickUp ↗</a>`
    : "";

  return `
    <li class="companies-task">
      <div class="companies-task-main">
        <span class="companies-task-name">${escapeHtml(task.task_name || "(untitled task)")}</span>
        ${statusPill(task)}
        ${deal}
      </div>
      <div class="companies-task-meta">
        ${assignees}
        ${due}
        ${open}
      </div>
    </li>`;
}

// A group of deal rows within one space (active or lost).
function dealGroup(label, deals, kind) {
  if (!deals.length) return "";
  const rows = deals.map(taskRow).join("");
  return `
    <div class="companies-listgroup ${kind}">
      <div class="companies-list-header">${label}<span class="companies-space-count">${deals.length}</span></div>
      <ul class="companies-task-list">${rows}</ul>
    </div>`;
}

function spaceGroup(space) {
  const active = dealGroup("Active deals", space.active || [], "active");
  const lost   = dealGroup("Rejected / Lost", space.lost || [], "lost");
  return `
    <div class="companies-space">
      <div class="companies-space-header">
        <span class="companies-space-name">${escapeHtml(space.space_name || "Unknown space")}</span>
      </div>
      ${active}${lost}
    </div>`;
}

// Headline fee block. Shows a dash when the company has no deals at all.
function feeHeadline(c) {
  const hasActive = (c.active_deal_count || 0) > 0;
  const noDeals   = (c.deal_count || 0) === 0;

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
  // Collapsed-level deal-value badge so no-deal companies are obvious without
  // expanding the card.
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
      <div class="companies-card-body" data-loaded="0">${loadingHtml("Loading tasks…")}</div>
    </details>`;
}

function renderDetail(detail) {
  if (!detail.has_deals) {
    return `<div class="companies-detail companies-nodeal">— No deal tasks for this company.</div>`;
  }
  const spaces = (detail.spaces || []).map(spaceGroup).join("");
  return `<div class="companies-detail">${spaces}</div>`;
}

function renderResults(data) {
  const results = document.getElementById(RESULTS_ID);
  if (!results) return;

  const companies = data.companies || [];
  if (!companies.length) {
    results.innerHTML = renderEmpty(`No companies found for “${data.query}”.`);
    setStatus(`No matches for “${data.query}”`);
    return;
  }

  const shown = companies.length;
  const total = data.total_companies ?? shown;
  const summaryText = data.truncated
    ? `Showing ${shown} of ${total} companies · refine your search to narrow results`
    : `${shown} compan${shown === 1 ? "y" : "ies"}`;

  const summary = `<p class="companies-result-summary${data.truncated ? " truncated" : ""}">${escapeHtml(summaryText)}</p>`;
  results.innerHTML = summary + companies.map(companyCard).join("");

  // Wire lazy detail loading on expand; auto-load the first (open) card.
  results.querySelectorAll(".companies-card").forEach(card => {
    card.addEventListener("toggle", () => { if (card.open) loadDetail(card); });
    if (card.open) loadDetail(card);
  });

  setStatus(data.truncated ? `Showing ${shown} of ${total} companies` : `${shown} compan${shown === 1 ? "y" : "ies"} found`);
}

// Lazy-fetch a company's full task detail the first time its card expands.
async function loadDetail(card) {
  const body = card.querySelector(".companies-card-body");
  if (!body || body.dataset.loaded === "1") return;
  body.dataset.loaded = "1";
  const tid = card.dataset.tid;
  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(tid)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const detail = await res.json();
    body.innerHTML = renderDetail(detail);
  } catch (err) {
    console.error("Company detail failed:", err);
    body.innerHTML = renderError();
    body.dataset.loaded = "0";  // allow retry on next expand
  }
}

// ---- Search --------------------------------------------------------

async function runSearch(query) {
  const q = query.trim();
  _lastQuery = q;
  const results = document.getElementById(RESULTS_ID);
  if (!results) return;

  if (!q) {
    results.innerHTML = PROMPT_HTML;
    setStatus("");
    return;
  }

  results.innerHTML = loadingHtml("Searching…");
  setStatus("Searching…");

  try {
    const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (q !== _lastQuery) return;  // ignore stale responses
    renderResults(data);
  } catch (err) {
    if (q !== _lastQuery) return;
    console.error("Company search failed:", err);
    results.innerHTML = renderError();
    setStatus("Search failed", true);
  }
}

function onInput(e) {
  clearTimeout(_debounceTimer);
  const value = e.target.value;
  _debounceTimer = setTimeout(() => runSearch(value), SEARCH_DEBOUNCE_MS);
}

// ---- Refresh / sync ------------------------------------------------

async function refreshSyncedLabel() {
  const el = document.getElementById(SYNCED_ID);
  if (!el) return;
  try {
    const res = await fetch(`${API_BASE}/status`);
    if (!res.ok) return;
    const st = await res.json();
    const last = (st.spaces || [])
      .map(s => s.last_run_ms).filter(Boolean).sort().pop();
    el.textContent = last ? `Updated ${relativeTime(last)}` : "";
    el.title = `${st.task_count || 0} tasks · ${st.company_count || 0} companies`;
  } catch { /* ignore */ }
}

async function onRefresh() {
  const btn = document.getElementById(REFRESH_ID);
  btn?.classList.add("spinning");
  setStatus("Syncing from ClickUp…");
  try {
    // wait=true so the label + current search reflect fresh data immediately.
    const res = await fetch(`${API_BASE}/sync?wait=true`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.json();
    await refreshSyncedLabel();
    setStatus("Up to date");
    if (_lastQuery) runSearch(_lastQuery);  // re-run current search against fresh data
  } catch (err) {
    console.error("Sync failed:", err);
    setStatus("Sync failed", true);
  } finally {
    btn?.classList.remove("spinning");
  }
}

// ---- Small helpers -------------------------------------------------

function fmtDate(ms) {
  try { return new Date(Number(ms)).toISOString().slice(0, 10); }
  catch { return ""; }
}

function relativeTime(ms) {
  const diff = Date.now() - Number(ms);
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

// ---- Component init ------------------------------------------------

export default async function init(_config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  section.innerHTML = `
    <div class="hub-section">
      <div class="section-header">
        <div class="companies-header-left">
          <button class="companies-back-btn" id="${BACK_ID}" aria-label="Back to Hub">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <div>
            <h2 class="section-title">Company Finder</h2>
            <p class="section-subtitle">Search a company to see its total fees and tasks across every ClickUp space</p>
          </div>
        </div>
        <div class="companies-header-right">
          <span class="companies-synced" id="${SYNCED_ID}"></span>
          <button class="companies-refresh-btn" id="${REFRESH_ID}" aria-label="Refresh from ClickUp" title="Refresh from ClickUp">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="companies-searchbar">
        <svg class="companies-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input type="search" id="${INPUT_ID}" class="companies-search-input"
               placeholder="Company name or TID-XXXXX…"
               autocomplete="off" spellcheck="false" aria-label="Search company">
      </div>

      <div id="${RESULTS_ID}" class="companies-results">${PROMPT_HTML}</div>
    </div>`;

  document.getElementById(BACK_ID)?.addEventListener("click", () => {
    hidePage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  document.getElementById(REFRESH_ID)?.addEventListener("click", onRefresh);

  const input = document.getElementById(INPUT_ID);
  input?.addEventListener("input", onInput);
  input?.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      clearTimeout(_debounceTimer);
      runSearch(input.value);
    }
  });
}
