// ============================================================
// components/pages/tbratio-tour.js
// On-site guided tour ("coachmark") for the TB Ratio Tool.
//
// A self-contained, zero-dependency overlay tour: a dimming
// backdrop spotlights one real field at a time while a tooltip
// explains it, with Back / Next / Skip. Steps can switch the
// BS / P&L tab so the anchored element is actually on screen.
//
// Ported from valuation-tour.js, with two differences for this tool:
//   - The tool's tabs are the BS / P&L map tabs (.tbr-map-tab),
//     not valuation's .tab-btn — and there are no <details> accordions.
//   - The page is EMPTY until a trial balance is uploaded: the Clear button,
//     mapping panel, statements, ratios and export controls only render inside
//     #tbr-output (and the header) after a file is parsed. So steps that need
//     that UI are flagged `requiresData`; the tour shows a gentle "upload first"
//     card when the user reaches them with no TB loaded, and spotlights the real
//     elements once a TB is in.
//
// Step count is derived from STEPS.length (shown as "Step N of M"), so adding or
// removing steps updates the progress automatically — no hardcoded totals.
//
// No build step, no CDN, no framework — drop-in ES module.
// ============================================================

const SEEN_KEY = "treppides:tbratio:tourSeen:v1";

// ---- The script ----------------------------------------------
// Each step points at a real element by selector. `tab` switches the
// BS / P&L map tab first. `placement` is a hint; the positioner falls
// back automatically if there's no room. `requiresData: true` marks a
// step whose anchor only exists after a TB is uploaded.
//
// Anchors verified against tbratio.js SHELL_HTML + the post-upload render.

const STEPS = [
  {
    title: "Welcome to the TB Ratio Tool",
    body: "This quick tour shows how the tool turns a trial-balance export into a Profit & Loss, a Balance Sheet and financial ratios. Use Next to move on, or Skip any time.",
    center: true,
  },
  {
    title: "What this tool does",
    body: "Upload a trial balance sheet and the tool builds the two statements and the firm's ratios for you. Everything runs in your browser — the file is never uploaded anywhere.",
    anchor: ".tbr-subtitle",
    placement: "bottom",
  },
  {
    title: "Start by uploading",
    body: "Drop a trial-balance export here, or click to choose a file (.xlsx, .xls or .csv). It reads several layouts automatically — E-Soft, ESOFT and legacy Cycom exports — so you can usually just upload and go. The figures never leave this page.",
    anchor: "#tbr-drop",
    placement: "bottom",
  },
  // ---- Everything below needs a parsed TB in #tbr-output ----
  {
    title: "Clear or start over",
    body: "Once a trial balance is loaded, this button clears it and returns you to the upload screen so you can drop a new file. Your manual mapping tweaks for a client are remembered and re-applied next time you upload that same trial balance.",
    anchor: "#tbr-clear-tb",
    requiresData: true,
    placement: "bottom",
  },
  {
    title: "Review the mapping",
    body: "Each account is sorted onto a statement line automatically. This panel shows that mapping so you can check it — and fix anything the tool guessed wrong.",
    anchor: ".tbr-map-tools",
    tab: "bs",
    requiresData: true,
    placement: "bottom",
  },
  {
    title: "Find an account fast",
    body: "Search by code or name to highlight matching accounts. Jump to match scrolls to the first hit and flashes it, opening its line if it was collapsed.",
    anchor: ".tbr-search",
    tab: "bs",
    requiresData: true,
    placement: "bottom",
  },
  {
    title: "Drag to re-map",
    body: "Every account is a chip you can drag onto a different line — even across to the other statement. The statements and ratios recalculate instantly when you drop.",
    anchor: ".tbr-bucket",
    tab: "bs",
    requiresData: true,
    placement: "right",
  },
  {
    title: "Move several at once",
    body: "Click accounts to select them (Ctrl or Cmd-click to add more, Shift-click for a range), then drag any one of them to move the whole selection to a line together. Click empty space to clear the selection.",
    anchor: ".tbr-bucket",
    tab: "bs",
    requiresData: true,
    placement: "right",
  },
  {
    title: "Truly unmapped accounts",
    body: "Accounts the tool couldn't place on either statement sit here in Unmapped. Drag one onto the right line to include it — a non-zero balance left here stays out of the statements, and you'll be warned.",
    anchor: ".tbr-bucket-unmapped",
    tab: "bs",
    requiresData: true,
    placement: "top",
  },
  {
    title: "Available from the other statement",
    body: "This list holds accounts already mapped on the OTHER tab — so on the Balance Sheet you'll see the P&L's accounts here, and vice versa. Drag one onto a line to pull it across to the statement you're viewing.",
    anchor: ".tbr-bucket-othersheet",
    tab: "bs",
    requiresData: true,
    placement: "top",
  },
  {
    title: "Switch between statements",
    body: "These tabs swap the whole view between the Balance Sheet and the Profit & Loss — each tab shows that statement's mapping, the statement itself and its ratios.",
    anchor: ".tbr-tabs",
    tab: "bs",
    requiresData: true,
    placement: "bottom",
  },
  {
    title: "The Balance Sheet",
    body: "Here's the assembled Balance Sheet. A retained-earnings bridge keeps it tied out, so total assets always equal liabilities plus equity.",
    anchor: '.tbr-tabpane[data-pane="bs"] .tbr-group-title',
    tab: "bs",
    requiresData: true,
    placement: "top",
  },
  {
    title: "Balance Sheet ratios",
    body: "The firm's five ratios — debt, current, working capital, assets-to-equity and debt-to-equity — each with a Good / Caution / Bad status and a short comment for both years.",
    anchor: '.tbr-tabpane[data-pane="bs"] .tbr-comments',
    tab: "bs",
    requiresData: true,
    placement: "top",
  },
  {
    title: "The Profit & Loss",
    body: "Switching to the P&L tab shows the income statement built from the same accounts, from revenue down to net profit.",
    anchor: '.tbr-tabpane[data-pane="pnl"] .tbr-group-title',
    tab: "pnl",
    requiresData: true,
    placement: "top",
  },
  {
    title: "Profitability ratios",
    body: "Six margin ratios with their statuses and a bar chart — gross, operating and net margin, EBITDA margin, and return on assets and equity.",
    anchor: "#tbr-pnl-chart",
    tab: "pnl",
    requiresData: true,
    placement: "top",
  },
  {
    title: "Export to Excel",
    body: "Export the full workbook — both statements plus all the ratios and comments — as an .xlsx file.",
    anchor: "#tbr-export",
    tab: "pnl",
    requiresData: true,
    placement: "top",
  },
  {
    title: "Export to PDF",
    body: "Open this menu to download a PDF: both statements together, the Balance Sheet only, or the Profit & Loss only. The single-statement options export just that statement's table — handy for sharing one page.",
    anchor: "#tbr-pdf-menu",
    tab: "pnl",
    requiresData: true,
    placement: "top",
  },
  {
    title: "Add a comparative year",
    body: "Load a second trial balance to fill the prior-year column and compare the two periods side by side. Once loaded, its file name shows here with a link to remove it.",
    anchor: '#tbr-output label.tbr-btn-ghost',
    tab: "pnl",
    requiresData: true,
    placement: "top",
  },
  {
    title: "You're ready",
    body: "That's the workflow: upload a trial balance, check the mapping, then read off the statements and ratios and export them. You can replay this tour any time from the Tutorial button.",
    center: true,
  },
];

// ---- DOM helpers ---------------------------------------------

function el(tag, props = {}, html = "") {
  const node = document.createElement(tag);
  Object.assign(node, props);
  if (html) node.innerHTML = html;
  return node;
}

// True once a trial balance has been parsed and #tbr-output is populated.
// requiresData steps spotlight real elements only when this is true.
function hasModel() {
  const out = document.getElementById("tbr-output");
  return !!(out && out.querySelector(".tbr-tabs"));
}

// Switch the tool to the BS or P&L tab by clicking its map-tab button —
// reuses the tool's own handler so the pane toggle + chart resize still fire.
function activateTab(which) {
  const btn = document.querySelector(`.tbr-map-tab[data-maptab="${which}"]`);
  if (btn && !btn.classList.contains("active")) btn.click();
}

// ---- Tour controller -----------------------------------------

let _state = { active: false, index: 0, onKey: null, onResize: null };
let _overlay = null; // { backdrop, hole, tip } once built

function buildOverlay() {
  if (_overlay) return _overlay;

  const backdrop = el("div", { id: "tbrTourBackdrop", className: "tbr-tour-backdrop" });
  const hole = el("div", { className: "tbr-tour-hole" });
  const tip = el("div", { className: "tbr-tour-tip", role: "dialog" });
  tip.setAttribute("aria-modal", "true");
  tip.setAttribute("aria-live", "polite");

  backdrop.appendChild(hole);
  backdrop.appendChild(tip);
  document.body.appendChild(backdrop);

  // Clicking the dimmed area (not the tooltip) does nothing — prevents
  // accidental dismissal mid-tour. Skip is the explicit exit.
  backdrop.addEventListener("click", e => { if (e.target === backdrop) e.stopPropagation(); });

  _overlay = { backdrop, hole, tip };
  return _overlay;
}

const PAD = 6;       // spotlight padding around the element
const MARGIN = 8;    // gap between hole edge and tooltip

// Resolve a step's anchor to the best *visible* element to spotlight.
// Some anchors (e.g. JS-populated tables) can be 0-size; when the anchor
// has no real box we climb to the nearest ancestor that does. Returns null
// if nothing resolvable is on screen.
function resolveAnchor(selector) {
  const start = document.querySelector(selector);
  if (!start) return null;
  let node = start;
  while (node) {
    const r = node.getBoundingClientRect();
    if (r.width > 1 && r.height > 1) return node;
    node = node.parentElement;
  }
  return null;
}

function centerTip() {
  const { hole, tip, backdrop } = _overlay;
  hole.style.display = "none";
  backdrop.classList.add("tbr-tour-dim");   // dim full screen
  tip.style.left = "50%";
  tip.style.top = "50%";
  tip.style.transform = "translate(-50%, -50%)";
}

// Measure the anchor and place the spotlight + tooltip. Does NOT scroll —
// callers that need the target in view scroll first (see positionFor).
function placeAt(step, target) {
  if (!_state.active) return;                // tour ended between frames
  const { hole, tip, backdrop } = _overlay;
  backdrop.classList.remove("tbr-tour-dim"); // spotlight handles dimming

  const r = target.getBoundingClientRect();
  hole.style.display = "block";
  hole.style.left = (r.left - PAD) + "px";
  hole.style.top = (r.top - PAD) + "px";
  hole.style.width = (r.width + PAD * 2) + "px";
  hole.style.height = (r.height + PAD * 2) + "px";

  tip.style.transform = "none";
  const tipR = tip.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;

  // Decide vertical placement: respect hint, else pick the side with room.
  let placeBelow = step.placement !== "top";
  if (placeBelow && r.bottom + MARGIN + tipR.height > vh) placeBelow = false;
  if (!placeBelow && r.top - MARGIN - tipR.height < 0) placeBelow = true;

  let top = placeBelow ? r.bottom + MARGIN : r.top - MARGIN - tipR.height;
  // Horizontally center on the target, clamped to the viewport.
  let left = r.left + r.width / 2 - tipR.width / 2;
  left = Math.max(MARGIN, Math.min(left, vw - tipR.width - MARGIN));
  top = Math.max(MARGIN, Math.min(top, vh - tipR.height - MARGIN));

  tip.style.left = left + "px";
  tip.style.top = top + "px";
}

// Full positioning for a step change: scroll the target into view, then
// place on the next frame once layout settles.
function positionFor(step) {
  if (step.center || !step.anchor) { centerTip(); return; }
  const target = resolveAnchor(step.anchor);
  if (!target) { centerTip(); return; }      // anchor absent/0-size — fall back

  target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  requestAnimationFrame(() => placeAt(step, target));
}

// Lightweight reposition for scroll/resize: re-measure only, never scroll
// (scrolling here would fight the user and loop the scroll listener).
function reposition() {
  if (!_state.active) return;
  const step = STEPS[_state.index];
  if (step.center || !step.anchor) { centerTip(); return; }
  const target = resolveAnchor(step.anchor);
  if (!target) { centerTip(); return; }
  placeAt(step, target);
}

function render() {
  const step = STEPS[_state.index];
  const { tip } = _overlay;
  const isFirst = _state.index === 0;
  const isLast = _state.index === STEPS.length - 1;

  // A step that needs a parsed TB but has none yet: show a gentle prompt
  // in place of the spotlight rather than a broken/centered empty step.
  const needsUpload = step.requiresData && !hasModel();

  // Prepare the page: switch tab before positioning (only if data is in).
  if (step.tab && hasModel()) activateTab(step.tab);

  const title = needsUpload ? "Upload a trial balance first" : step.title;
  const body = needsUpload
    ? "The rest of the tour walks through the mapping panel, the statements and the ratios — but those only appear once a trial balance is loaded."
    : step.body;

  if (needsUpload) {
    // Special layout for the upload-first step: the normal Back/Next aren't
    // useful here (the next steps also need data). Give ONE clear close action
    // and a prominent hint about how to resume, so the user isn't forced to
    // hunt for "Skip" to dismiss the box that's blocking the upload area.
    tip.innerHTML = `
      <div class="tbr-tour-progress">Step ${_state.index + 1} of ${STEPS.length}</div>
      <h3 class="tbr-tour-title"></h3>
      <p class="tbr-tour-body"></p>
      <p class="tbr-tour-hint">
        Close this tour, drop a file on the upload area, then press the
        <strong>Tutorial</strong> button again to pick the tour back up.
      </p>
      <div class="tbr-tour-actions tbr-tour-actions-end">
        <button type="button" class="tbr-tour-secondary" data-tour="back" ${isFirst ? "disabled" : ""}>Back</button>
        <button type="button" class="tbr-tour-primary" data-tour="close">Close tour to upload</button>
      </div>`;
    tip.querySelector(".tbr-tour-title").textContent = title;
    tip.querySelector(".tbr-tour-body").textContent = body;
    tip.querySelector('[data-tour="back"]').addEventListener("click", () => go(-1));
    tip.querySelector('[data-tour="close"]').addEventListener("click", end);
    centerTip();
    return;
  }

  tip.innerHTML = `
    <div class="tbr-tour-progress">Step ${_state.index + 1} of ${STEPS.length}</div>
    <h3 class="tbr-tour-title"></h3>
    <p class="tbr-tour-body"></p>
    <div class="tbr-tour-actions">
      <button type="button" class="tbr-tour-x" data-tour="skip">Skip tour</button>
      <div class="tbr-tour-nav">
        <button type="button" class="tbr-tour-secondary" data-tour="back" ${isFirst ? "disabled" : ""}>Back</button>
        <button type="button" class="tbr-tour-primary" data-tour="next">${isLast ? "Done" : "Next"}</button>
      </div>
    </div>`;
  // textContent (not innerHTML) for the script copy — keeps it text-only,
  // matching the hub's escape-everything rule.
  tip.querySelector(".tbr-tour-title").textContent = title;
  tip.querySelector(".tbr-tour-body").textContent = body;

  tip.querySelector('[data-tour="skip"]').addEventListener("click", end);
  tip.querySelector('[data-tour="back"]').addEventListener("click", () => go(-1));
  tip.querySelector('[data-tour="next"]').addEventListener("click", () => {
    if (isLast) end(); else go(1);
  });

  // Let the tab switch settle, then position. (The needsUpload step returned
  // early above with its own centered layout.)
  setTimeout(() => positionFor(step), step.tab && hasModel() ? 120 : 0);
}

function go(delta) {
  const next = _state.index + delta;
  if (next < 0 || next >= STEPS.length) return;
  _state.index = next;
  render();
}

function start(fromStep = 0) {
  if (_state.active) return;
  _state.active = true;
  _state.index = fromStep;
  buildOverlay();
  _overlay.backdrop.classList.add("open");
  _overlay.backdrop.classList.remove("tbr-tour-dim");

  _state.onKey = e => {
    if (e.key === "Escape") end();
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
  };
  _state.onResize = () => reposition();
  document.addEventListener("keydown", _state.onKey);
  window.addEventListener("resize", _state.onResize);
  window.addEventListener("scroll", _state.onResize, true);

  render();
}

function end() {
  if (!_state.active) return;
  _state.active = false;
  _overlay?.backdrop.classList.remove("open");
  document.removeEventListener("keydown", _state.onKey);
  window.removeEventListener("resize", _state.onResize);
  window.removeEventListener("scroll", _state.onResize, true);
  try { localStorage.setItem(SEEN_KEY, "1"); } catch (_) {}
  _dismissPrompt();
}

// ---- First-visit prompt --------------------------------------

let _prompt = null;

function _dismissPrompt() {
  _prompt?.remove();
  _prompt = null;
}

function maybePrompt() {
  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === "1"; } catch (_) {}
  if (seen || _prompt) return;

  _prompt = el("div", { className: "tbr-tour-prompt" });
  _prompt.innerHTML = `
    <span class="tbr-tour-prompt-text">New to the TB Ratio Tool? Take a quick guided tour.</span>
    <button type="button" class="tbr-tour-primary" data-tour="prompt-start">Start tour</button>
    <button type="button" class="tbr-tour-secondary" data-tour="prompt-dismiss" aria-label="Dismiss">No thanks</button>`;
  document.body.appendChild(_prompt);
  _prompt.querySelector('[data-tour="prompt-start"]').addEventListener("click", () => { _dismissPrompt(); start(0); });
  _prompt.querySelector('[data-tour="prompt-dismiss"]').addEventListener("click", () => {
    try { localStorage.setItem(SEEN_KEY, "1"); } catch (_) {}
    _dismissPrompt();
  });
}

// ---- Header button -------------------------------------------

function injectHelpButton() {
  if (document.getElementById("tbrTourBtn")) return;
  const header = document.querySelector(".tbr-header-left");
  if (!header) return;
  const btn = el("button", {
    type: "button",
    id: "tbrTourBtn",
    className: "tbr-tour-btn",
    title: "Replay the guided tutorial",
  }, `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
      <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>
    <span>Tutorial</span>`);
  btn.addEventListener("click", () => start(0));
  header.appendChild(btn);
}

// ---- Public init (called once from the tool's init) ----------

export function initTbratioTour() {
  injectHelpButton();
  // NOTE: the first-visit prompt is intentionally NOT shown here. init() runs
  // once at hub boot (while the landing page is showing), so prompting here put
  // the toast on the landing page. The prompt is now fired from the tool's
  // showPage() via maybeTbratioPrompt() — i.e. only when the TB Ratio page is open.
  window.__hub_tbratio_tour = { start, end, maybePrompt };
}

// Called by tbratio.js showPage() so the first-visit prompt only appears
// when the user is actually on the TB Ratio page.
export function maybeTbratioPrompt() {
  maybePrompt();
}
