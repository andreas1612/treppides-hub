// ============================================================
// components/pages/staff.js — Staff Directory (LIVE)
// Data source: live FastAPI service, reverse-proxied at /api/staffdir/
//   → /api/staffdir/api/staff          (list, Azure-synced, 5-min cache)
//   → /api/staffdir/api/staff/{id}/photo
//   → /api/staffdir/api/staff.xlsx     (Excel export of the live data)
// Grouped by canonical department → sub-department → office.
// Mounts into: #section-staff
// ============================================================

import { escapeHtml } from "../../utils/dom.js";

const SECTION_ID  = "section-staff";
const BACK_BTN_ID = "staff-back-btn";
const STAFF_API   = "/api/staffdir";   // nginx → http://127.0.0.1:8010/

// ---- Page visibility ----------------------------------------

function showStaffPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove("fees-active");
  main.classList.add("staff-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "staff" } }));
}

function hideStaffPage() {
  document.querySelector(".main")?.classList.remove("staff-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_staff = { show: showStaffPage, hide: hideStaffPage };

// ---- State --------------------------------------------------
let _allStaff   = [];
let _depts      = [];
let _expanded   = new Set();
let _filterDept = "all";
let _filterLoc  = "all";   // "all" | "Nicosia" | "Limassol"
let _query      = "";

// ---- Helpers ------------------------------------------------

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (parts[0] ? parts[0][0].toUpperCase() : "?");
}

function deptHue(dept) {
  let h = 0;
  for (let i = 0; i < dept.length; i++) h = (h * 31 + dept.charCodeAt(i)) & 0xffff;
  return h % 360;
}

function emailsOf(s) {
  return (s.emails && s.emails.length) ? s.emails : (s.email ? [s.email] : []);
}

// ---- Filtering ----------------------------------------------

function matchesFilters(s) {
  if (_filterDept !== "all" && s.department !== _filterDept) return false;
  if (_filterLoc  !== "all" && s.location   !== _filterLoc)  return false;
  if (_query && !s.name.toLowerCase().includes(_query))      return false;
  return true;
}

function visibleDepts() {
  return _depts.filter(d => _allStaff.some(s => s.department === d && matchesFilters(s)));
}

function staffInDept(dept) {
  return _allStaff.filter(s => s.department === dept && matchesFilters(s));
}

// ---- Icons --------------------------------------------------

const LOC_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
const PHONE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.14 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.05 2h3a2 2 0 0 1 2 1.72 12.08 12.08 0 0 1 .7 2.81 2 2 0 0 1-.45 2.11L7.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.08 12.08 0 0 1 2.81.7A2 2 0 0 1 21 17z"/></svg>`;
const MOBILE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`;
const EMAIL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/></svg>`;
const XLS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="17"/><line x1="15" y1="13" x2="9" y2="17"/></svg>`;

// ---- Card ---------------------------------------------------

function cardHtml(s) {
  const hue      = deptHue(s.department);
  const locClass = s.location === "Limassol" ? "loc-limassol" : "loc-nicosia";
  const photoUrl = `${STAFF_API}/api/staff/${encodeURIComponent(s.azureId)}/photo`;
  const emails   = emailsOf(s);

  return `
    <div class="card staff-card">
      <div class="staff-avatar-wrap">
        <img class="staff-photo" src="${escapeHtml(photoUrl)}" alt=""
             loading="lazy" />
        <div class="staff-avatar" style="background:hsl(${hue},50%,88%);color:hsl(${hue},50%,28%);display:none">
          ${escapeHtml(initials(s.name))}
        </div>
      </div>

      <div class="card-title">${escapeHtml(s.name)}</div>
      ${s.jobTitle ? `<div class="staff-job-title">${escapeHtml(s.jobTitle)}</div>` : ""}

      ${s.location ? `
      <div class="staff-loc-badge ${locClass}">${LOC_ICON}${escapeHtml(s.location)}</div>` : ""}

      ${s.extension ? `
      <div class="staff-meta">${PHONE_ICON}Ext.&nbsp;${escapeHtml(s.extension)}</div>` : ""}

      ${s.mobile ? `
      <div class="staff-meta">${MOBILE_ICON}${escapeHtml(s.mobile)}</div>` : ""}

      ${emails.length ? `
      <div class="staff-meta staff-meta-emails">
        ${EMAIL_ICON}
        <div class="staff-email-list">
          ${emails.map(e => `<a href="mailto:${escapeHtml(e)}" class="staff-email">${escapeHtml(e)}</a>`).join("")}
        </div>
      </div>` : ""}
    </div>`;
}

// ---- Office grouping (keeps Nicosia/Limassol visible) --------

function officeGroupsHtml(members) {
  const nicosia  = members.filter(s => s.location === "Nicosia");
  const limassol = members.filter(s => s.location === "Limassol");
  if (nicosia.length >= 2 && limassol.length >= 2) {
    return `
      <div class="staff-office-group">
        <div class="staff-office-label loc-nicosia-label">${LOC_ICON} Nicosia
          <span class="staff-dept-badge">${nicosia.length}</span></div>
        <div class="cards-grid staff-grid">${nicosia.map(cardHtml).join("")}</div>
      </div>
      <div class="staff-office-group">
        <div class="staff-office-label loc-limassol-label">${LOC_ICON} Limassol
          <span class="staff-dept-badge">${limassol.length}</span></div>
        <div class="cards-grid staff-grid">${limassol.map(cardHtml).join("")}</div>
      </div>`;
  }
  return `<div class="cards-grid staff-grid">${members.map(cardHtml).join("")}</div>`;
}

// ---- Department accordion (dept → sub-dept → office) --------

function deptSectionHtml(dept) {
  const members = staffInDept(dept);
  const hue     = deptHue(dept);
  const isOpen  = _expanded.has(dept) || !!_query;

  const nicCount = members.filter(s => s.location === "Nicosia").length;
  const limCount = members.filter(s => s.location === "Limassol").length;
  const hasBoth  = nicCount > 0 && limCount > 0;

  const subs = [...new Set(members.map(s => s.subDepartment).filter(Boolean))].sort();

  let bodyHtml;
  if (subs.length) {
    const ungrouped = members.filter(s => !s.subDepartment);
    bodyHtml = `
      ${subs.map(sub => {
        const g = members.filter(s => s.subDepartment === sub);
        return `
        <div class="staff-sub-group">
          <div class="staff-sub-label">${escapeHtml(sub)}
            <span class="staff-dept-badge">${g.length}</span></div>
          ${officeGroupsHtml(g)}
        </div>`;
      }).join("")}
      ${ungrouped.length ? `
        <div class="staff-sub-group">
          <div class="staff-sub-label">General
            <span class="staff-dept-badge">${ungrouped.length}</span></div>
          ${officeGroupsHtml(ungrouped)}
        </div>` : ""}`;
  } else {
    bodyHtml = officeGroupsHtml(members);
  }

  return `
    <div class="staff-dept-section" data-dept="${escapeHtml(dept)}">
      <button class="staff-dept-header" aria-expanded="${isOpen}">
        <div class="staff-dept-left">
          <span class="staff-dept-dot" style="background:hsl(${hue},50%,55%)"></span>
          <span class="staff-dept-name">${escapeHtml(dept)}</span>
          <span class="staff-dept-badge">${members.length}</span>
          ${hasBoth ? `<span class="staff-dept-offices">
            <span class="staff-office-pip loc-nicosia">${nicCount} Nic</span>
            <span class="staff-office-pip loc-limassol">${limCount} Lim</span>
          </span>` : ""}
        </div>
        <svg class="staff-chevron${isOpen ? " open" : ""}" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div class="staff-dept-body${isOpen ? " open" : ""}">${bodyHtml}</div>
    </div>`;
}

// ---- Full render --------------------------------------------

function renderGrid() {
  const mount = document.getElementById("staff-cards");
  if (!mount) return;

  const depts = visibleDepts();
  const total = depts.reduce((n, d) => n + staffInDept(d).length, 0);

  const count = document.getElementById("staff-count");
  if (count) {
    count.textContent = _query || _filterDept !== "all" || _filterLoc !== "all"
      ? `${total} of ${_allStaff.length} staff`
      : `${_allStaff.length} staff`;
  }

  if (!depts.length) {
    mount.innerHTML = `
      <div class="state-box empty" role="status">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
        </svg>
        <h3>No staff found</h3><p>Try a different search or filter.</p>
      </div>`;
    return;
  }

  mount.innerHTML = depts.map(deptSectionHtml).join("");

  // Photo error fallback — CSP blocks inline onerror, so use delegated listener.
  mount.querySelectorAll("img.staff-photo").forEach(img => {
    img.addEventListener("error", () => {
      img.style.display = "none";
      if (img.nextElementSibling) img.nextElementSibling.style.display = "flex";
    });
  });

  mount.querySelectorAll(".staff-dept-header").forEach(btn => {
    btn.addEventListener("click", () => {
      const sec     = btn.closest(".staff-dept-section");
      const dept    = sec.dataset.dept;
      const body    = sec.querySelector(".staff-dept-body");
      const chevron = sec.querySelector(".staff-chevron");
      const opening = !body.classList.contains("open");
      body.classList.toggle("open", opening);
      chevron.classList.toggle("open", opening);
      btn.setAttribute("aria-expanded", opening);
      if (opening) _expanded.add(dept); else _expanded.delete(dept);
    });
  });
}

// ---- Expand/Collapse All ------------------------------------

function toggleAll() {
  const btn     = document.getElementById("staff-expand-all");
  const depts   = visibleDepts();
  const allOpen = depts.every(d => _expanded.has(d) || !!_query);
  if (allOpen) {
    _expanded.clear();
    if (btn) btn.textContent = "Expand All";
  } else {
    depts.forEach(d => _expanded.add(d));
    if (btn) btn.textContent = "Collapse All";
  }
  renderGrid();
  document.getElementById("staff-expand-all")?.addEventListener("click", toggleAll, { once: true });
}

// ---- Component init -----------------------------------------

export default async function init(_config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  section.innerHTML = `
    <div class="hub-section">
      <div class="section-header">
        <div><h2 class="section-title">Staff Directory</h2>
          <p class="section-subtitle">K. Treppides &amp; Co Ltd</p></div>
      </div>
      <div class="skeleton-grid" style="margin-top:8px">
        ${Array.from({length: 3}, () => `
          <div class="skeleton-card" aria-hidden="true">
            <div class="skel" style="width:44px;height:44px;border-radius:50%;margin-bottom:10px"></div>
            <div class="skel skel-h"></div>
            <div class="skel skel-date" style="width:70px;margin-top:6px"></div>
            <div class="skel skel-date" style="margin-top:4px"></div>
          </div>`).join("")}
      </div>
    </div>`;

  try {
    const resp = await fetch(`${STAFF_API}/api/staff`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    _allStaff = await resp.json();
    _depts    = [...new Set(_allStaff.map(s => s.department))].sort();
  } catch (err) {
    console.error("[Hub] staff fetch error:", err);
    section.innerHTML = `
      <div class="hub-section">
        <div class="section-header"><div class="staff-header-left">
          <div><h2 class="section-title">Staff Directory</h2></div></div></div>
        <div class="state-box error" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <h3>Could not load staff directory.</h3><p>Please contact your administrator.</p>
        </div>
      </div>`;
    return;
  }

  if (_depts.length) _expanded.add(_depts[0]);

  section.innerHTML = `
    <div class="hub-section">
      <div class="section-header">
        <div class="staff-header-left">
          <button class="staff-back-btn" id="${BACK_BTN_ID}" aria-label="Back to Hub">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <div>
            <h2 class="section-title">Staff Directory</h2>
            <p class="section-subtitle">K. Treppides &amp; Co Ltd &mdash; <span id="staff-count"></span></p>
          </div>
        </div>
        <a class="staff-export-btn" id="staff-export-btn" href="${STAFF_API}/api/staff.xlsx"
           download title="Download the current directory as an Excel file">
          ${XLS_ICON}<span>Export to Excel</span>
        </a>
      </div>

      <div class="staff-controls">
        <div class="staff-search-wrap">
          <svg class="staff-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input id="staff-search" class="staff-search" type="search" placeholder="Search by name…" autocomplete="off" />
        </div>

        <select id="staff-dept-filter" class="staff-dept-select">
          <option value="all">All Departments</option>
          ${_depts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("")}
        </select>

        <div class="staff-loc-toggle" role="group" aria-label="Filter by office">
          <button class="staff-loc-btn active" data-loc="all">All</button>
          <button class="staff-loc-btn" data-loc="Nicosia">Nicosia</button>
          <button class="staff-loc-btn" data-loc="Limassol">Limassol</button>
        </div>

        <button class="staff-expand-all" id="staff-expand-all">Expand All</button>
      </div>

      <div id="staff-cards"></div>
    </div>`;

  renderGrid();

  document.getElementById(BACK_BTN_ID)?.addEventListener("click", () => {
    hideStaffPage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  document.getElementById("staff-expand-all")?.addEventListener("click", toggleAll, { once: true });

  let debounce;
  document.getElementById("staff-search")?.addEventListener("input", e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { _query = e.target.value.toLowerCase().trim(); renderGrid(); }, 200);
  });

  document.getElementById("staff-dept-filter")?.addEventListener("change", e => {
    _filterDept = e.target.value;
    if (_filterDept !== "all") _expanded.add(_filterDept);
    renderGrid();
  });

  section.querySelectorAll(".staff-loc-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      section.querySelectorAll(".staff-loc-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      _filterLoc = btn.dataset.loc;
      renderGrid();
    });
  });
}
