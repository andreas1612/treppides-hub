// ============================================================
// components/pages/team-calendar.js — Team Calendar tool
// Teamup-style team calendar: leave, meetings, deadlines.
// People as rows, days as columns. Department picker for directors.
// Mounts into: #section-teamcalendar
// ============================================================

import { getCurrentUser } from "../../js/auth.js";

const SECTION_ID = "section-teamcalendar";
const API_BASE   = "/api/teamcal";

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const DAYS_SHORT = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

// ── Per-person color palette ────────────────────────────────
// 16 hand-picked colors — each person gets a unique one via hash.
const PERSON_PALETTE = [
  { h: "#4f8ef7", bg: "rgba(79,142,247,.13)",  tx: "#2b5ea7" },  // blue
  { h: "#48bb78", bg: "rgba(72,187,120,.13)",   tx: "#276749" },  // green
  { h: "#ed8936", bg: "rgba(237,137,54,.13)",   tx: "#9c4221" },  // orange
  { h: "#9f7aea", bg: "rgba(159,122,234,.13)",  tx: "#553c9a" },  // purple
  { h: "#e53e3e", bg: "rgba(229,62,62,.12)",    tx: "#9b2c2c" },  // red
  { h: "#38b2ac", bg: "rgba(56,178,172,.13)",   tx: "#234e52" },  // teal
  { h: "#d69e2e", bg: "rgba(214,158,46,.14)",   tx: "#744210" },  // gold
  { h: "#667eea", bg: "rgba(102,126,234,.13)",  tx: "#3c366b" },  // indigo
  { h: "#ed64a6", bg: "rgba(237,100,166,.13)",  tx: "#97266d" },  // pink
  { h: "#3182ce", bg: "rgba(49,130,206,.13)",   tx: "#1a365d" },  // sky
  { h: "#68d391", bg: "rgba(104,211,145,.14)",  tx: "#22543d" },  // lime
  { h: "#f6ad55", bg: "rgba(246,173,85,.14)",   tx: "#7b341e" },  // amber
  { h: "#b794f4", bg: "rgba(183,148,244,.13)",  tx: "#44337a" },  // lavender
  { h: "#fc8181", bg: "rgba(252,129,129,.13)",  tx: "#822727" },  // coral
  { h: "#4fd1c5", bg: "rgba(79,209,197,.13)",   tx: "#1d4044" },  // mint
  { h: "#f687b3", bg: "rgba(246,135,179,.13)",  tx: "#702459" },  // rose
];

let _personColorMap = {};
let _personColorIdx = 0;

function personColor(email) {
  if (_personColorMap[email]) return _personColorMap[email];
  // Sequential assignment — guarantees maximum color spread within a team
  const c = PERSON_PALETTE[_personColorIdx % PERSON_PALETTE.length];
  _personColorIdx++;
  _personColorMap[email] = c;
  return c;
}

function resetPersonColors() {
  _personColorMap = {};
  _personColorIdx = 0;
}

// Team/dept color for group headers
let _deptColorMap = {};
function deptColor(dept) {
  if (!_deptColorMap[dept]) {
    let hash = 0;
    for (let i = 0; i < dept.length; i++) hash = ((hash << 5) - hash + dept.charCodeAt(i)) | 0;
    const idx = Math.abs(hash) % PERSON_PALETTE.length;
    _deptColorMap[dept] = PERSON_PALETTE[idx].h;
  }
  return _deptColorMap[dept];
}

// Event type badges
const TYPE_BADGE = { LEAVE: "L", MEETING: "M", DEADLINE: "D" };

// ── State ───────────────────────────────────────────────────
let _viewMode   = "month";   // "month" | "week"
let _year       = new Date().getFullYear();
let _month      = new Date().getMonth(); // 0-based
let _weekStart  = null;      // Date object for week view
let _dept       = null;      // selected department (null = first/all)
let _departments = [];       // departments user can view
let _myView     = null;      // /my-view response
let _staff      = [];        // staff in current dept
let _events     = [];        // events in current range
let _allStaff   = {};        // dept -> staff[] cache for "All" view
let _userEmail  = "";

// ── Helpers ─────────────────────────────────────────────────
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

function isWeekend(d) {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

function isToday(d) {
  return sameDay(d, new Date());
}

/** Monday of the week containing `d`. */
function mondayOf(d) {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

/** Array of dates for the view range. */
function getViewDates() {
  if (_viewMode === "week") {
    // Week view: full 7 days (Mon-Sun)
    const mon = _weekStart || mondayOf(new Date());
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      dates.push(d);
    }
    return dates;
  }
  // Month view: weekdays only (Mon-Fri) for a readable grid
  const first = new Date(_year, _month, 1);
  const last  = new Date(_year, _month + 1, 0);

  const dates = [];
  const cur = new Date(first);
  while (cur <= last) {
    const dow = cur.getDay();
    if (dow >= 1 && dow <= 5) { // Mon=1 .. Fri=5
      dates.push(new Date(cur));
    }
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// ── API calls ───────────────────────────────────────────────
async function apiGet(path) {
  const sep = path.includes("?") ? "&" : "?";
  const resp = await fetch(`${API_BASE}${path}${sep}email=${encodeURIComponent(_userEmail)}`);
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  return resp.json();
}

async function apiPost(path, body) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Email": _userEmail,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `API ${resp.status}`);
  }
  return resp.json();
}

async function apiPut(path, body) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-User-Email": _userEmail,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `API ${resp.status}`);
  }
  return resp.json();
}

async function apiDelete(path) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: { "X-User-Email": _userEmail },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `API ${resp.status}`);
  }
  return resp.json();
}

// ── Data loading ────────────────────────────────────────────
let _fullTeam = [];  // full team from /my-view (never changes within session)

async function loadMyView() {
  _myView = await apiGet("/my-view");
  _departments = _myView.departments || [];
  _fullTeam = _myView.team || [];

  // Assign colors sequentially so each person in the team gets a distinct color
  resetPersonColors();
  for (const s of _fullTeam) personColor(s.email);

  // Default dept: "All" if multi-dept, otherwise the first/only dept
  if (!_dept) {
    _dept = _departments.length > 1 ? "All" : (_departments[0] || null);
  }
}

function loadStaff() {
  // Staff comes from the team array in /my-view (resolved via staff directory grouping).
  // Filter by selected department, or show all.
  if (_dept === "All" || !_dept) {
    _staff = [..._fullTeam];
  } else {
    _staff = _fullTeam.filter(s => s.department === _dept);
  }
  // Sort by teamKey first (preserves team grouping), then by name within each team
  _staff.sort((a, b) => {
    const tA = a.teamKey || a.department;
    const tB = b.teamKey || b.department;
    if (tA !== tB) return tA.localeCompare(tB);
    return a.name.localeCompare(b.name);
  });
}

async function loadEvents() {
  const dates = getViewDates();
  if (!dates.length || !_staff.length) { _events = []; return; }
  const from = dateStr(dates[0]);
  const to   = dateStr(dates[dates.length - 1]);

  // Fetch events for the departments our team members belong to.
  // This ensures we see all events for people in our team view.
  const teamDepts = [...new Set(_staff.map(s => s.department))];

  const allEvents = [];
  for (const d of teamDepts) {
    const evts = await apiGet(`/events?dept=${encodeURIComponent(d)}&from=${from}&to=${to}`);
    allEvents.push(...evts);
  }

  // Filter to only events belonging to people in our current staff view
  const teamEmails = new Set(_staff.map(s => s.email.toLowerCase()));
  _events = allEvents.filter(ev => teamEmails.has(ev.ownerEmail.toLowerCase()));
}

// ── Rendering ───────────────────────────────────────────────
function render() {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  const dates = getViewDates();
  const numCols = dates.length + 1; // +1 for name column
  const showAllView = _dept === "All";

  // Month / Week label
  let periodLabel;
  if (_viewMode === "week" && dates.length) {
    const s = dates[0];
    const e = dates[dates.length - 1];
    periodLabel = `${s.getDate()} ${MONTHS[s.getMonth()].slice(0,3)} – ${e.getDate()} ${MONTHS[e.getMonth()].slice(0,3)} ${e.getFullYear()}`;
  } else {
    periodLabel = `${MONTHS[_month]} ${_year}`;
  }

  // Department chips
  let deptChipsHtml = "";
  if (_myView && (_myView.viewMode === "multi" || _departments.length > 1)) {
    const chips = ["All", ..._departments.filter(d => d !== "All")].map(d => {
      const active = _dept === d ? "active" : "";
      return `<button class="tcal-dept-chip ${active}" data-dept="${esc(d)}">${esc(d)}</button>`;
    }).join("");
    deptChipsHtml = `
      <div class="tcal-dept-bar">
        <span class="tcal-dept-label">Department:</span>
        ${chips}
      </div>`;
  }

  // Grid: header row
  let headerCells = `<div class="tcal-name-header">${_staff.length} staff</div>`;
  for (const d of dates) {
    const isMonday = d.getDay() === 1;
    const cls = [
      "tcal-day-header",
      isWeekend(d) ? "weekend" : "",
      isToday(d) ? "today" : "",
      isMonday && _viewMode === "month" ? "week-start" : "",
    ].filter(Boolean).join(" ");
    const dow = DAYS_SHORT[(d.getDay() + 6) % 7]; // Monday = 0
    const monthTag = (d.getDate() === 1 || d === dates[0]) && _viewMode === "month"
      ? `<span class="day-month">${MONTHS[d.getMonth()].slice(0,3)}</span>` : "";
    headerCells += `<div class="${cls}">${dow}<span class="day-num">${d.getDate()}</span>${monthTag}</div>`;
  }

  // Grid: person rows — grouped by teamKey when multi-team view
  let rowsHtml = "";
  const hasMultipleTeams = new Set(_staff.map(s => s.teamKey || s.department)).size > 1;
  let lastTeamKey = null;

  for (const person of _staff) {
    const teamKey = person.teamKey || person.department;
    const pc = personColor(person.email);

    // Insert team group header when the team changes (multi-team views only)
    if (hasMultipleTeams && teamKey !== lastTeamKey) {
      lastTeamKey = teamKey;
      const teamLabel = person.subDepartment || person.department;
      rowsHtml += `<div class="tcal-team-header" style="grid-column:1/-1;border-left:3px solid ${deptColor(teamKey)}"><span class="tcal-team-dot" style="background:${deptColor(teamKey)}"></span>${esc(teamLabel)}</div>`;
    }

    // Name cell — always show person color dot
    rowsHtml += `<div class="tcal-person-name" title="${esc(person.jobTitle || teamKey)}">
      <span class="person-dot" style="background:${pc.h}"></span>${esc(person.name)}</div>`;

    // Day cells
    for (const d of dates) {
      const ds = dateStr(d);
      const cellEvents = getEventsForPersonDay(person.email, d);
      const wknd = isWeekend(d) ? "weekend" : "";

      let eventsHtml = "";
      for (const ev of cellEvents) {
        const evStart = parseDate(ev.startDate);
        const evEnd   = parseDate(ev.endDate);
        const isMulti = ev.startDate !== ev.endDate;
        const typeCls = ev.eventType.toLowerCase();
        const epc = personColor(ev.ownerEmail.toLowerCase());

        // Span classes for multi-day leave
        let spanCls = `tcal-event ev-${typeCls}`;
        if (typeCls === "leave" && isMulti) {
          if (sameDay(d, evStart))      spanCls += " ev-start";
          else if (sameDay(d, evEnd))   spanCls += " ev-end";
          else                          spanCls += " ev-mid";
        }

        // Label: show title on first day or single-day events
        const showLabel = !isMulti || sameDay(d, evStart);
        const badge = TYPE_BADGE[ev.eventType] || "";
        const label = showLabel ? `<span class="ev-badge">${badge}</span>${esc(ev.title)}` : "";

        eventsHtml += `<div class="${spanCls}" data-event-id="${ev.eventId}" title="${esc(ev.title)}"
          style="background:${epc.bg};border-color:${epc.h};color:${epc.tx}">${label}</div>`;
      }

      const monCls = d.getDay() === 1 && _viewMode === "month" ? " week-start" : "";
      rowsHtml += `<div class="tcal-cell ${wknd}${monCls}" data-date="${ds}" data-email="${esc(person.email)}">${eventsHtml}</div>`;
    }
  }

  // Empty state
  if (!_staff.length) {
    rowsHtml = `<div class="tcal-empty" style="grid-column:1/-1;">No staff found for this department.</div>`;
  }

  section.innerHTML = `
    <div class="hub-section">
      <div class="tcal-header">
        <button class="tcal-back-btn" id="tcal-back" aria-label="Back to Tools">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div>
          <h2 class="tcal-title">Team Calendar</h2>
          <p class="tcal-subtitle">Leave, meetings &amp; deadlines</p>
        </div>
      </div>

      <div class="tcal-controls">
        <div class="tcal-nav-group">
          <button class="tcal-nav-btn" id="tcal-prev" aria-label="Previous">&lsaquo;</button>
          <span class="tcal-month-label">${esc(periodLabel)}</span>
          <button class="tcal-nav-btn" id="tcal-next" aria-label="Next">&rsaquo;</button>
        </div>

        <div class="tcal-view-toggle">
          <button class="tcal-view-btn ${_viewMode === "month" ? "active" : ""}" data-view="month">Month</button>
          <button class="tcal-view-btn ${_viewMode === "week" ? "active" : ""}" data-view="week">Week</button>
        </div>

        <button class="tcal-add-btn" id="tcal-add-event">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Event
        </button>
      </div>

      ${deptChipsHtml}

      <div class="tcal-grid-wrapper ${_viewMode === "week" ? "tcal-week-mode" : "tcal-month-mode"}">
        <div class="tcal-grid" style="grid-template-columns: 180px repeat(${dates.length}, 1fr);">
          ${headerCells}
          ${rowsHtml}
        </div>
      </div>
    </div>

    <!-- Event modal -->
    <div class="tcal-modal-backdrop hidden" id="tcal-modal-backdrop">
      <div class="tcal-modal" id="tcal-modal"></div>
    </div>`;

  bindEvents();
}

function getEventsForPersonDay(email, d) {
  const ds = dateStr(d);
  return _events.filter(ev => {
    if (ev.ownerEmail.toLowerCase() !== email.toLowerCase()) return false;
    return ev.startDate <= ds && ev.endDate >= ds;
  });
}

// ── Event handlers ──────────────────────────────────────────
function bindEvents() {
  // Back button
  document.getElementById("tcal-back")?.addEventListener("click", () => {
    hidePage();
    window.__hub_projects?.show();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // Prev / Next
  document.getElementById("tcal-prev")?.addEventListener("click", () => {
    navigate(-1);
  });
  document.getElementById("tcal-next")?.addEventListener("click", () => {
    navigate(1);
  });

  // View toggle
  document.querySelectorAll(".tcal-view-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      _viewMode = btn.dataset.view;
      if (_viewMode === "week" && !_weekStart) {
        _weekStart = mondayOf(new Date(_year, _month, 1));
      }
      refreshView();
    });
  });

  // Department chips
  document.querySelectorAll(".tcal-dept-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      _dept = chip.dataset.dept;
      _allStaff = {}; // clear cache on dept change
      refreshView();
    });
  });

  // Add event button
  document.getElementById("tcal-add-event")?.addEventListener("click", () => {
    showCreateModal();
  });

  // Cell click → create event
  document.querySelectorAll(".tcal-cell").forEach(cell => {
    cell.addEventListener("click", (e) => {
      // If clicked on an event, open edit modal instead
      const evEl = e.target.closest(".tcal-event");
      if (evEl) {
        const eventId = parseInt(evEl.dataset.eventId, 10);
        const ev = _events.find(x => x.eventId === eventId);
        if (ev) showEditModal(ev);
        return;
      }
      // Otherwise create new event for this person + date
      const date  = cell.dataset.date;
      const email = cell.dataset.email;
      if (date && email) showCreateModal(date, email);
    });
  });

  // Modal backdrop click → close
  document.getElementById("tcal-modal-backdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "tcal-modal-backdrop") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

function navigate(dir) {
  if (_viewMode === "week") {
    if (!_weekStart) _weekStart = mondayOf(new Date());
    _weekStart = new Date(_weekStart);
    _weekStart.setDate(_weekStart.getDate() + dir * 7);
  } else {
    _month += dir;
    if (_month < 0)  { _month = 11; _year--; }
    if (_month > 11) { _month = 0;  _year++; }
  }
  refreshView();
}

async function refreshView() {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  try {
    await Promise.all([loadStaff(), loadEvents()]);
  } catch (err) {
    console.error("Team Calendar load error:", err);
  }
  render();
}

// ── Modals ──────────────────────────────────────────────────
function closeModal() {
  document.getElementById("tcal-modal-backdrop")?.classList.add("hidden");
}

function openModal(html) {
  const modal = document.getElementById("tcal-modal");
  const backdrop = document.getElementById("tcal-modal-backdrop");
  if (!modal || !backdrop) return;
  modal.innerHTML = html;
  backdrop.classList.remove("hidden");
}

function showCreateModal(prefillDate, prefillEmail) {
  const today = prefillDate || dateStr(new Date());
  const staffOptions = _staff.map(s =>
    `<option value="${esc(s.email)}" ${s.email === prefillEmail ? "selected" : ""}>${esc(s.name)}</option>`
  ).join("");

  openModal(`
    <h3>New Event</h3>
    <div class="tcal-form-group">
      <label>Title</label>
      <input type="text" id="tcal-f-title" placeholder="e.g. Annual Leave" maxlength="200" />
    </div>
    <div class="tcal-form-row">
      <div class="tcal-form-group">
        <label>Type</label>
        <select id="tcal-f-type">
          <option value="LEAVE">Leave</option>
          <option value="MEETING">Meeting</option>
          <option value="DEADLINE">Deadline</option>
        </select>
      </div>
      <div class="tcal-form-group">
        <label>Staff Member</label>
        <select id="tcal-f-owner">${staffOptions}</select>
      </div>
    </div>
    <div class="tcal-form-row">
      <div class="tcal-form-group">
        <label>Start Date</label>
        <input type="date" id="tcal-f-start" value="${today}" />
      </div>
      <div class="tcal-form-group">
        <label>End Date</label>
        <input type="date" id="tcal-f-end" value="${today}" />
      </div>
    </div>
    <div class="tcal-form-check">
      <input type="checkbox" id="tcal-f-allday" checked />
      <label for="tcal-f-allday">All day</label>
    </div>
    <div class="tcal-form-group">
      <label>Notes</label>
      <textarea id="tcal-f-notes" placeholder="Optional notes..." maxlength="500"></textarea>
    </div>
    <div class="tcal-modal-actions">
      <button class="btn-primary" id="tcal-save-create">Create Event</button>
      <button class="btn-secondary" id="tcal-cancel">Cancel</button>
    </div>
  `);

  document.getElementById("tcal-cancel")?.addEventListener("click", closeModal);
  document.getElementById("tcal-save-create")?.addEventListener("click", async () => {
    const title     = document.getElementById("tcal-f-title")?.value?.trim();
    const eventType = document.getElementById("tcal-f-type")?.value;
    const ownerEmail = document.getElementById("tcal-f-owner")?.value;
    const startDate = document.getElementById("tcal-f-start")?.value;
    const endDate   = document.getElementById("tcal-f-end")?.value;
    const allDay    = document.getElementById("tcal-f-allday")?.checked ?? true;
    const notes     = document.getElementById("tcal-f-notes")?.value?.trim() || null;

    if (!title) { alert("Title is required."); return; }
    if (!startDate || !endDate) { alert("Dates are required."); return; }
    if (endDate < startDate) { alert("End date must be on or after start date."); return; }

    try {
      await apiPost("/events", { title, eventType, ownerEmail, startDate, endDate, allDay, notes });
      closeModal();
      await refreshView();
    } catch (err) {
      alert("Error creating event: " + err.message);
    }
  });
}

function showEditModal(ev) {
  const canEdit = ev.createdBy.toLowerCase() === _userEmail || ev.ownerEmail.toLowerCase() === _userEmail;

  openModal(`
    <h3>${canEdit ? "Edit Event" : "View Event"}</h3>
    <div class="tcal-form-group">
      <label>Title</label>
      <input type="text" id="tcal-f-title" value="${esc(ev.title)}" maxlength="200" ${canEdit ? "" : "disabled"} />
    </div>
    <div class="tcal-form-row">
      <div class="tcal-form-group">
        <label>Type</label>
        <select id="tcal-f-type" ${canEdit ? "" : "disabled"}>
          <option value="LEAVE"    ${ev.eventType === "LEAVE"    ? "selected" : ""}>Leave</option>
          <option value="MEETING"  ${ev.eventType === "MEETING"  ? "selected" : ""}>Meeting</option>
          <option value="DEADLINE" ${ev.eventType === "DEADLINE" ? "selected" : ""}>Deadline</option>
        </select>
      </div>
      <div class="tcal-form-group">
        <label>Owner</label>
        <input type="text" value="${esc(ev.ownerName)}" disabled />
      </div>
    </div>
    <div class="tcal-form-row">
      <div class="tcal-form-group">
        <label>Start Date</label>
        <input type="date" id="tcal-f-start" value="${ev.startDate}" ${canEdit ? "" : "disabled"} />
      </div>
      <div class="tcal-form-group">
        <label>End Date</label>
        <input type="date" id="tcal-f-end" value="${ev.endDate}" ${canEdit ? "" : "disabled"} />
      </div>
    </div>
    <div class="tcal-form-check">
      <input type="checkbox" id="tcal-f-allday" ${ev.allDay ? "checked" : ""} ${canEdit ? "" : "disabled"} />
      <label for="tcal-f-allday">All day</label>
    </div>
    <div class="tcal-form-group">
      <label>Notes</label>
      <textarea id="tcal-f-notes" maxlength="500" ${canEdit ? "" : "disabled"}>${esc(ev.notes || "")}</textarea>
    </div>
    <div class="tcal-form-group" style="font-size:12px;color:var(--text-secondary);">
      Created by ${esc(ev.createdBy)} &middot; Status: ${esc(ev.status)}
    </div>
    <div class="tcal-modal-actions">
      ${canEdit ? `<button class="btn-primary" id="tcal-save-edit">Save Changes</button>` : ""}
      <button class="btn-secondary" id="tcal-cancel">${canEdit ? "Cancel" : "Close"}</button>
      ${canEdit ? `<button class="btn-danger" id="tcal-delete">Delete</button>` : ""}
    </div>
  `);

  document.getElementById("tcal-cancel")?.addEventListener("click", closeModal);

  document.getElementById("tcal-save-edit")?.addEventListener("click", async () => {
    const title     = document.getElementById("tcal-f-title")?.value?.trim();
    const eventType = document.getElementById("tcal-f-type")?.value;
    const startDate = document.getElementById("tcal-f-start")?.value;
    const endDate   = document.getElementById("tcal-f-end")?.value;
    const allDay    = document.getElementById("tcal-f-allday")?.checked ?? true;
    const notes     = document.getElementById("tcal-f-notes")?.value?.trim() || null;

    if (!title) { alert("Title is required."); return; }
    if (endDate < startDate) { alert("End date must be on or after start date."); return; }

    try {
      await apiPut(`/events/${ev.eventId}`, { title, eventType, startDate, endDate, allDay, notes });
      closeModal();
      await refreshView();
    } catch (err) {
      alert("Error updating event: " + err.message);
    }
  });

  document.getElementById("tcal-delete")?.addEventListener("click", async () => {
    if (!confirm("Delete this event?")) return;
    try {
      await apiDelete(`/events/${ev.eventId}`);
      closeModal();
      await refreshView();
    } catch (err) {
      alert("Error deleting event: " + err.message);
    }
  });
}


// ── Page visibility ─────────────────────────────────────────
function showPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.add("teamcalendar-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "teamcalendar" } }));
  refreshView();
}

function hidePage() {
  document.querySelector(".main")?.classList.remove("teamcalendar-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_teamcalendar = { show: showPage, hide: hidePage };


// ── Init ────────────────────────────────────────────────────
export default async function init(_config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  const user = getCurrentUser();
  _userEmail = user?.email || "";

  // Set initial week start
  _weekStart = mondayOf(new Date());

  // Pre-load the user's view config (don't block — will render on show)
  try {
    await loadMyView();
  } catch (err) {
    console.warn("Team Calendar: could not load my-view:", err);
    // Fallback: show all departments
    try {
      _departments = await apiGet("/departments");
      if (_departments.length) _dept = _departments[0];
    } catch (e2) {
      console.warn("Team Calendar: could not load departments:", e2);
    }
  }

  // Render skeleton (actual data loads on show)
  section.innerHTML = `<div class="tcal-loading">Loading Team Calendar...</div>`;
}
