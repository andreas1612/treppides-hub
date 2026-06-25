// ============================================================
// components/pages/valuation-tour.js
// On-site guided tour ("coachmark") for the Valuation Tool.
//
// A self-contained, zero-dependency overlay tour: a dimming
// backdrop spotlights one real field at a time while a tooltip
// explains it, with Back / Next / Skip. Steps can switch tabs and
// open accordions so the anchored element is actually on screen.
//
// Mirrors the existing draft-restore pattern in valuation.js:
//   - wired during bootValuation()
//   - exposes window.__hub_valuation_tour for the header button
//   - "seen" flag in localStorage (versioned) so first-time users
//     get a gentle prompt, returning users just see the button.
//
// No build step, no CDN, no framework — drop-in ES module.
// ============================================================

const SEEN_KEY = "treppides:valuation:tourSeen:v1";

// ---- The script ----------------------------------------------
// Each step points at a real element by selector. `tab` switches
// the tool to that tab first; `openAccordion` expands the <details>
// that contains the anchor. `placement` is a hint; the positioner
// falls back automatically if there's no room.
//
// Anchors verified against valuation.js SHELL_HTML IDs.

const STEPS = [
  {
    title: "Welcome to the Valuation Tool",
    body: "This quick tour walks you through building a DCF valuation — from company setup to the final equity-value report. Use Next to move on, or Skip any time.",
    center: true,
  },
  {
    title: "Five steps, left to right",
    body: "The tool is organised as tabs: the first two are where you type inputs, and the rest show the results it calculates for you. Work through them in order.",
    anchor: ".tab-navigation",
    placement: "bottom",
  },
  {
    title: "Pick your reference year",
    body: "Choose the Damodaran data edition that matches your valuation date. This sets the betas, risk premiums and tax rates used throughout — so set it first.",
    anchor: "#damodaranEdition",
    tab: "tab-1",
    openAccordion: true,
    placement: "bottom",
  },
  {
    title: "Company details",
    body: "Enter the company name and a short description, and upload a cover image if you have one. These appear on the front page of the PDF report.",
    anchor: "#companyName",
    tab: "tab-1",
    openAccordion: true,
    placement: "bottom",
  },
  {
    title: "Set your dates",
    body: "Enter the valuation date. The base year fills in automatically and drives the five-year forecast — you can adjust it if needed.",
    anchor: "#valuationDate",
    tab: "tab-1",
    openAccordion: true,
    placement: "bottom",
  },
  {
    title: "Where the company operates",
    body: "Select the continent and country. The tool auto-fills the equity risk premium, country risk premium and statutory tax rate from the reference data.",
    anchor: "#continent",
    tab: "tab-1",
    openAccordion: true,
    placement: "bottom",
  },
  {
    title: "Pick the industry",
    body: "Choosing the industry pulls in the sector beta and expected growth rates — the core drivers of the discount rate and your forecast.",
    anchor: "#industry",
    tab: "tab-1",
    openAccordion: true,
    placement: "bottom",
  },
  {
    title: "Reporting currency",
    body: "Select the reporting currency. The tool fetches the matching risk-free rate and the historical FX rate for your valuation date — both stay editable if you have a better figure.",
    anchor: "#currency",
    tab: "tab-1",
    openAccordion: true,
    placement: "bottom",
  },
  {
    title: "Enter the financials",
    body: "On the Income Statement tab, type in the most recent year's figures — revenue, cost of sales, expenses and tax. The subtotals calculate as you go.",
    anchor: "#revenue",
    tab: "tab-2",
    openAccordion: true,
    placement: "bottom",
  },
  {
    title: "Your forecast",
    body: "The tool projects five years forward and derives the free cash flow used in the valuation. Click Show Calculations any time to see the formulas behind each line.",
    anchor: "#plProjectionsBody",
    tab: "tab-2",
    openAccordion: true,
    placement: "top",
  },
  {
    title: "Cash flow check",
    body: "This tab shows the free cash flow pulled from your forecast. It's a result, not an input — review it, then move on.",
    anchor: "#cfProjectionsBody",
    tab: "tab-3",
    openAccordion: true,
    placement: "top",
  },
  {
    title: "Discount rate assumptions",
    body: "Here the tool builds your discount rate (WACC) from the cost of equity and debt. Review the perpetual growth rate and DLOM — adjust if your judgement differs.",
    anchor: "#perpetualGrowthRate",
    tab: "tab-4",
    placement: "bottom",
  },
  {
    title: "The valuation",
    body: "This table discounts each year's cash flow plus a terminal value to today, giving the enterprise value. Use Show Calculations to see each step.",
    anchor: "#dcfModelBody",
    tab: "tab-4",
    placement: "top",
  },
  {
    title: "Test the assumptions",
    body: "These grids show how the valuation moves as growth and discount rates change. The centre cell is your base case.",
    anchor: "#sensGrowthBody",
    tab: "tab-4",
    placement: "top",
  },
  {
    title: "Your result",
    body: "This is the headline: the equity-value range with your central estimate. The cards below break out the equity and enterprise values for each scenario.",
    anchor: "#rangeGraphicContainer",
    tab: "tab-5",
    placement: "top",
  },
  {
    title: "Save and share",
    body: "Export a branded PDF report to share, or a JSON snapshot to reopen the valuation later exactly as it is now. Your work also auto-saves as a draft as you go.",
    anchor: "#exportPdfBtn",
    tab: "tab-5",
    placement: "top",
  },
  {
    title: "You're ready",
    body: "That's the full workflow. Start at Project Setup and work left to right — the tool handles the maths. You can replay this tour any time from the Tutorial button.",
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

// Switch the tool to a given tab by clicking its tab button — reuses
// the tool's own handler so any side effects (recalc, etc.) still fire.
function activateTab(tabId) {
  const btn = document.querySelector(`.tab-btn[data-target="${tabId}"]`);
  if (btn && !btn.classList.contains("active")) btn.click();
}

// Expand the <details> accordion that contains a node, so it's visible.
function openContainingAccordion(node) {
  let p = node.closest("details.accordion-item");
  while (p) {
    if (!p.open) p.open = true;
    p = p.parentElement?.closest("details.accordion-item");
  }
}

// ---- Tour controller -----------------------------------------

let _state = { active: false, index: 0, onKey: null, onResize: null };
let _overlay = null; // { backdrop, hole, tip } once built

function buildOverlay() {
  if (_overlay) return _overlay;

  const backdrop = el("div", { id: "valTourBackdrop", className: "val-tour-backdrop" });
  const hole = el("div", { className: "val-tour-hole" });
  const tip = el("div", { className: "val-tour-tip", role: "dialog" });
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
// Several result-tab anchors are JS-populated <tbody>s that are empty
// (0×0) until the user enters financials and the tool recalculates.
// Spotlighting a 0-height box looks like nothing happened, so when the
// anchor has no real box we climb to the nearest ancestor that does
// (its table/container, then the tab panel). Returns null if nothing
// resolvable is on screen.
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
  backdrop.classList.add("val-tour-dim");   // dim full screen
  tip.style.left = "50%";
  tip.style.top = "50%";
  tip.style.transform = "translate(-50%, -50%)";
}

// Measure the anchor and place the spotlight + tooltip. Does NOT scroll —
// callers that need the target in view scroll first (see positionFor).
function placeAt(step, target) {
  if (!_state.active) return;                // tour ended between frames
  const { hole, tip, backdrop } = _overlay;
  backdrop.classList.remove("val-tour-dim"); // spotlight handles dimming

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

  // Prepare the page: switch tab + open accordion before positioning.
  if (step.tab) activateTab(step.tab);
  if (step.anchor && step.openAccordion) {
    const t = document.querySelector(step.anchor);
    if (t) openContainingAccordion(t);
  }

  tip.innerHTML = `
    <div class="val-tour-progress">Step ${_state.index + 1} of ${STEPS.length}</div>
    <h3 class="val-tour-title"></h3>
    <p class="val-tour-body"></p>
    <div class="val-tour-actions">
      <button type="button" class="val-tour-x" data-tour="skip">Skip tour</button>
      <div class="val-tour-nav">
        <button type="button" class="val-tour-secondary" data-tour="back" ${isFirst ? "disabled" : ""}>Back</button>
        <button type="button" class="val-tour-primary" data-tour="next">${isLast ? "Done" : "Next"}</button>
      </div>
    </div>`;
  // textContent (not innerHTML) for the script copy — it's static here,
  // but keeping it text-only matches the hub's escape-everything rule.
  tip.querySelector(".val-tour-title").textContent = step.title;
  tip.querySelector(".val-tour-body").textContent = step.body;

  tip.querySelector('[data-tour="skip"]').addEventListener("click", end);
  tip.querySelector('[data-tour="back"]').addEventListener("click", () => go(-1));
  tip.querySelector('[data-tour="next"]').addEventListener("click", () => {
    if (isLast) end(); else go(1);
  });

  // Let the tab switch settle, then position.
  setTimeout(() => positionFor(step), step.tab ? 120 : 0);
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
  _overlay.backdrop.classList.remove("val-tour-dim");

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

  _prompt = el("div", { className: "val-tour-prompt" });
  _prompt.innerHTML = `
    <span class="val-tour-prompt-text">New to the Valuation Tool? Take a quick guided tour.</span>
    <button type="button" class="val-tour-primary" data-tour="prompt-start">Start tour</button>
    <button type="button" class="val-tour-secondary" data-tour="prompt-dismiss" aria-label="Dismiss">No thanks</button>`;
  document.body.appendChild(_prompt);
  _prompt.querySelector('[data-tour="prompt-start"]').addEventListener("click", () => { _dismissPrompt(); start(0); });
  _prompt.querySelector('[data-tour="prompt-dismiss"]').addEventListener("click", () => {
    try { localStorage.setItem(SEEN_KEY, "1"); } catch (_) {}
    _dismissPrompt();
  });
}

// ---- Header button -------------------------------------------

function injectHelpButton() {
  if (document.getElementById("valTourBtn")) return;
  const header = document.querySelector(".valuation-header-left");
  if (!header) return;
  const btn = el("button", {
    type: "button",
    id: "valTourBtn",
    className: "val-tour-btn",
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

// ---- Public init (called once from bootValuation) ------------

export function initValuationTour() {
  injectHelpButton();
  window.__hub_valuation_tour = { start, end };
  maybePrompt();
}
