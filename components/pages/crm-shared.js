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

// ---- Inline editor (status / assignee / comment → ClickUp) --------
//
// Ported from the Deals dashboard's editor, generalized to the unified
// /api/companies/tasks/{id}/* write routes so it works for ANY editable list.
// Auth-gated server-side (require_user); we send the TM session cookie via
// credentials:"include". On save it applies only what changed and calls
// onSaved(freshTask) so the caller can reflect the reconciled task.

function _loading(msg) {
  return `<div class="companies-loading" aria-busy="true"><span class="companies-spinner" aria-hidden="true"></span><span>${escapeHtml(msg)}</span></div>`;
}

function _putJson(url, body) {
  return fetch(url, { method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function _postJson(url, body) {
  return fetch(url, { method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function _editPanelHtml(taskId, opts) {
  const curStatus = (opts.current_status || "").toLowerCase();
  const statusOpts = (opts.statuses || []).map(s =>
    `<option value="${escapeHtml(s.status)}"${s.status.toLowerCase() === curStatus ? " selected" : ""}>${escapeHtml(s.status)}</option>`
  ).join("");

  const curIds = new Set((opts.current_assignees || []).map(a => String(a.id)));
  const members = (opts.members || []).slice().sort((a, b) => {
    const ac = curIds.has(String(a.id)) ? 0 : 1, bc = curIds.has(String(b.id)) ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return (a.username || a.email || "").localeCompare(b.username || b.email || "");
  });
  const origCsv = [...curIds].sort().join(",");
  const memberRows = members.length
    ? members.map(m => {
        const on = curIds.has(String(m.id));
        return `<label class="companies-assignee-opt${on ? " on" : ""}">
          <input type="checkbox" value="${m.id}"${on ? " checked" : ""}>
          <span>${escapeHtml(m.username || m.email || String(m.id))}</span>
        </label>`;
      }).join("")
    : `<div class="companies-edit-err">No members available.</div>`;

  return `
    <div class="companies-edit-grid" data-task-id="${escapeHtml(taskId)}">
      <label class="companies-edit-field">
        <span>Status</span>
        <select data-edit-status>${statusOpts}</select>
      </label>
      <div class="companies-edit-field companies-edit-assignees">
        <span>Assignees</span>
        <div class="companies-assignee-list" data-edit-assignees data-orig="${origCsv}">${memberRows}</div>
      </div>
      <label class="companies-edit-field companies-edit-comment">
        <span>Add comment to ClickUp</span>
        <textarea data-edit-comment rows="2" placeholder="Write a note — posted to the task's ClickUp comments."></textarea>
      </label>
      <div class="companies-edit-actions">
        <button type="button" class="companies-edit-save" data-edit-save>Save changes</button>
        <span class="companies-edit-msg" data-edit-msg aria-live="polite"></span>
      </div>
    </div>`;
}

async function _saveEdits(grid, taskId, apiBase, onSaved) {
  const msg = grid.querySelector("[data-edit-msg]");
  const statusSel = grid.querySelector("[data-edit-status]");
  const assigneeList = grid.querySelector("[data-edit-assignees]");
  const commentBox = grid.querySelector("[data-edit-comment]");
  const saveBtn = grid.querySelector("[data-edit-save]");
  const setMsg = (t, kind) => { if (msg) { msg.textContent = t; msg.className = `companies-edit-msg ${kind || ""}`; } };

  saveBtn.disabled = true;
  setMsg("Saving…", "pending");

  const base = `${apiBase}/tasks/${encodeURIComponent(taskId)}`;
  const calls = [];
  const chosenStatus = statusSel?.value;
  const origStatus = statusSel?.querySelector("option[selected]")?.value;
  if (chosenStatus && chosenStatus !== origStatus) {
    calls.push(_putJson(`${base}/status`, { status: chosenStatus }).then(r => ({ kind: "status", r })));
  }
  if (assigneeList) {
    const chosenIds = [...assigneeList.querySelectorAll('input[type="checkbox"]:checked')].map(cb => Number(cb.value));
    const chosenCsv = chosenIds.slice().sort((a, b) => a - b).join(",");
    if (chosenCsv !== (assigneeList.dataset.orig || "")) {
      calls.push(_putJson(`${base}/assignee`, { assignee_ids: chosenIds }).then(r => ({ kind: "assignee", r })));
    }
  }
  const comment = (commentBox?.value || "").trim();
  if (comment) {
    calls.push(_postJson(`${base}/comment`, { text: comment }).then(r => ({ kind: "comment", r })));
  }

  if (!calls.length) { setMsg("Nothing changed.", ""); saveBtn.disabled = false; return; }

  try {
    const results = await Promise.all(calls);
    let dryRun = false, freshTask = null;
    for (const { kind, r } of results) {
      if (r.status === 401 || r.status === 403) throw new Error("Please sign in (Task Manager) to edit.");
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.detail || `HTTP ${r.status}`); }
      const b = await r.json();
      if (b.dry_run) dryRun = true;
      if (b.task) freshTask = b.task;
      if (kind === "comment" && commentBox) commentBox.value = "";
    }
    // Reset the editor's own diff baselines so a second save compares correctly.
    if (statusSel) statusSel.querySelectorAll("option").forEach(o => o.toggleAttribute("selected", o.value === statusSel.value));
    if (assigneeList) {
      assigneeList.dataset.orig = [...assigneeList.querySelectorAll('input[type="checkbox"]:checked')]
        .map(cb => Number(cb.value)).sort((a, b) => a - b).join(",");
    }
    setMsg(dryRun ? "Saved (dry run — ClickUp not changed)." : "Saved to ClickUp ✓", "ok");
    if (freshTask && typeof onSaved === "function") onSaved(freshTask);
  } catch (err) {
    console.error("save edits failed:", err);
    setMsg(err.message || "Save failed.", "err");
  } finally {
    saveBtn.disabled = false;
  }
}

/**
 * Fetch edit-options for a task and render the inline editor into `panel`.
 *   apiBase: "/api/companies" (or the local-dev absolute base)
 *   onSaved(freshTask): called after a successful save with the reconciled task.
 */
export async function renderEditor(panel, taskId, { apiBase = "/api/companies", onSaved } = {}) {
  panel.innerHTML = `<div class="companies-edit-loading">${_loading("Loading editor…")}</div>`;
  let res;
  try {
    res = await fetch(`${apiBase}/tasks/${encodeURIComponent(taskId)}/edit-options`, { credentials: "include" });
  } catch {
    panel.innerHTML = `<div class="companies-edit-err">Couldn't reach the server. Try again.</div>`;
    return;
  }
  if (res.status === 401 || res.status === 403) {
    panel.innerHTML = `<div class="companies-edit-err">Please sign in (via the Task Manager) to edit.</div>`;
    return;
  }
  if (!res.ok) {
    panel.innerHTML = `<div class="companies-edit-err">Couldn't load the editor. Try again.</div>`;
    return;
  }
  panel.innerHTML = _editPanelHtml(taskId, await res.json());
  const grid = panel.querySelector(".companies-edit-grid");
  grid.querySelector("[data-edit-save]")?.addEventListener("click", () => _saveEdits(grid, taskId, apiBase, onSaved));
  grid.addEventListener("change", e => {
    const cb = e.target.closest('.companies-assignee-opt input[type="checkbox"]');
    if (cb) cb.closest(".companies-assignee-opt")?.classList.toggle("on", cb.checked);
  });
}
