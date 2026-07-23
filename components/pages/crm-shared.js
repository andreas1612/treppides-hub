// ============================================================
// components/pages/crm-shared.js — helpers shared by the CRM list dashboards.
//
// Reused by crm-list.js (and available to companies.js later). Keeps the
// cascading multi-select filter bar, the vendored Chart.js loader, and small
// presentation helpers in one place so the generic list view and the Deals
// view stay visually consistent.
//
// The filter bar deliberately emits the existing .companies-* class names so it
// inherits companies.css styling — no duplicate CSS.
// ============================================================

import { escapeHtml } from "../../utils/dom.js";

// Prettify raw ClickUp space names (drop "_CRM", expand "KT"). Display-only.
export function prettySpace(name) {
  if (!name) return "Unknown space";
  let s = String(name).replace(/_CRM$/i, "");
  if (/^KT(\b|_)/.test(s)) s = s.replace(/^KT/, "K. Treppides");
  return s.trim();
}

// A status pill coloured by the task's ClickUp status colour (validated hex).
export function statusPill(status, color) {
  const label = status ? escapeHtml(status) : "—";
  const c = color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#A0AEC0";
  return `<span class="companies-status" style="--pill:${c}">${label}</span>`;
}

// Lazy-load the vendored Chart.js (same lib the fees/Deals dashboards use).
export function loadChartJs() {
  if (window.Chart) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/chart.umd.min.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Chart.js"));
    document.head.appendChild(s);
  });
}

// ---- Cascading multi-select filter bar ----------------------------
//
// A generic version of the Deals dashboard's filter bar. Each filter is a
// <details> popover of checkboxes; on close (if the selection changed) the
// option lists are re-fetched CASCADED to the new selection, the bar rebuilds
// so sibling dropdowns narrow, then the caller's onApply() re-queries.

function summaryLabel(sel) {
  if (!sel || sel.length === 0) return "All";
  if (sel.length === 1) return sel[0];
  return `${sel.length} selected`;
}

function filterBarHtml(filters, state, options) {
  const multi = (f) => {
    const vals = options[f.key] || [];
    const sel = state[f.key] || [];
    return `
      <div class="companies-filter">
        <span>${escapeHtml(f.label)}</span>
        <details class="companies-multi" data-filter="${escapeHtml(f.key)}">
          <summary>${escapeHtml(summaryLabel(sel))} <span class="companies-multi-caret">▾</span></summary>
          <div class="companies-multi-menu">
            ${vals.map(v => `<label class="companies-multi-opt"><input type="checkbox" value="${escapeHtml(v)}"${sel.includes(v) ? " checked" : ""}> ${escapeHtml(v)}</label>`).join("")}
          </div>
        </details>
      </div>`;
  };
  const has = filters.some(f => (state[f.key] || []).length);
  const clear = has ? `<button class="companies-filter-clear" data-filter-clear>Clear filters ✕</button>` : "";
  return `<div class="companies-filterbar">${filters.map(multi).join("")}${clear}</div>`;
}

/**
 * Render + wire a cascading filter bar into `host`.
 *   filters:      [{key, label}]
 *   state:        {key: [values]} — mutated in place as the user picks
 *   fetchOptions: async (state) => ({key: [option, ...]})  (cascaded server-side)
 *   onApply:      () => void — re-run the view's query after a change
 * Returns a Promise that resolves once the initial options are loaded/rendered.
 */
export function mountFilterBar(host, { filters, state, fetchOptions, onApply }) {
  let options = {};

  async function refreshOptions() {
    try { options = (await fetchOptions(state)) || {}; }
    catch { /* keep last options on transient failure */ }
  }

  function syncClear() {
    const has = filters.some(f => (state[f.key] || []).length);
    const bar = host.querySelector(".companies-filterbar");
    if (!bar) return;
    let btn = bar.querySelector("[data-filter-clear]");
    if (has && !btn) {
      btn = document.createElement("button");
      btn.className = "companies-filter-clear";
      btn.setAttribute("data-filter-clear", "");
      btn.textContent = "Clear filters ✕";
      btn.addEventListener("click", onClear);
      bar.appendChild(btn);
    } else if (!has && btn) {
      btn.remove();
    }
  }

  async function onClear() {
    for (const f of filters) state[f.key] = [];
    await refreshOptions();
    render();
    onApply();
  }

  function wire() {
    host.querySelectorAll(".companies-multi[data-filter]").forEach(d => {
      const key = d.dataset.filter;
      let snapshot = (state[key] || []).join("|");

      d.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener("change", () => {
          const set = new Set(state[key] || []);
          if (cb.checked) set.add(cb.value); else set.delete(cb.value);
          state[key] = [...set];
          const sm = d.querySelector("summary");
          if (sm) sm.innerHTML = `${escapeHtml(summaryLabel(state[key]))} <span class="companies-multi-caret">▾</span>`;
          syncClear();
        });
      });

      d.addEventListener("toggle", async () => {
        if (d.open) {
          snapshot = (state[key] || []).join("|");
        } else if ((state[key] || []).join("|") !== snapshot) {
          await refreshOptions();
          render();
          onApply();
        }
      });
    });
    host.querySelector("[data-filter-clear]")?.addEventListener("click", onClear);
  }

  function render() {
    host.innerHTML = filterBarHtml(filters, state, options);
    wire();
  }

  // Close any open popover when clicking outside it (bind the global once).
  if (!mountFilterBar._outsideBound) {
    document.addEventListener("click", e => {
      document.querySelectorAll(".companies-multi[open]").forEach(d => {
        if (!d.contains(e.target)) d.open = false;
      });
    });
    mountFilterBar._outsideBound = true;
  }

  return refreshOptions().then(render);
}

// Serialize a filter state object → query string (comma-joined multi-values).
export function filterQS(state) {
  const parts = [];
  for (const k of Object.keys(state)) {
    if ((state[k] || []).length) parts.push(`${k}=${encodeURIComponent(state[k].join(","))}`);
  }
  return parts.join("&");
}
