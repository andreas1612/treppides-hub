// ============================================================
// components/projects.js — Tools landing page
// Grid of tool cards: some open in-hub pages, some redirect.
// Mounts into: #section-projects
// ============================================================

const SECTION_ID  = "section-projects";
const BACK_BTN_ID = "tools-back-btn";

// ---- SVG icons for tool cards --------------------------------

const TOOL_ICONS = {
  tasks: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
            <rect x="9" y="3" width="6" height="4" rx="1"/>
            <line x1="9" y1="12" x2="15" y2="12"/>
            <line x1="9" y1="16" x2="13" y2="16"/>
          </svg>`,
  aml: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="20" x2="18" y2="10"/>
          <line x1="12" y1="20" x2="12" y2="4"/>
          <line x1="6"  y1="20" x2="6"  y2="14"/>
        </svg>`,
  valuation: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="4" y="2" width="16" height="20" rx="2"/>
                <line x1="8" y1="6" x2="16" y2="6"/>
                <line x1="8" y1="10" x2="10" y2="10"/>
                <line x1="12" y1="10" x2="14" y2="10"/>
                <line x1="16" y1="10" x2="16" y2="10"/>
                <line x1="8" y1="14" x2="10" y2="14"/>
                <line x1="12" y1="14" x2="14" y2="14"/>
                <line x1="16" y1="14" x2="16" y2="14"/>
                <line x1="8" y1="18" x2="10" y2="18"/>
                <line x1="12" y1="18" x2="16" y2="18"/>
              </svg>`,
  companies: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>`,
  tbratio: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="8" y1="13" x2="16" y2="13"/>
              <line x1="8" y1="17" x2="13" y2="17"/>
            </svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
               <rect x="3" y="4" width="18" height="18" rx="2"/>
               <line x1="16" y1="2" x2="16" y2="6"/>
               <line x1="8"  y1="2" x2="8"  y2="6"/>
               <line x1="3"  y1="10" x2="21" y2="10"/>
               <rect x="7" y="14" width="3" height="3" rx=".5"/>
             </svg>`,
  training: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
               <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
               <path d="M6 12v5c0 1.1 2.7 3 6 3s6-1.9 6-3v-5"/>
             </svg>`,
  roombooking: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>`,
  kyc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
          <polyline points="13 2 13 9 20 9"/>
          <line x1="10" y1="13" x2="10" y2="17"/>
          <line x1="14" y1="13" x2="14" y2="17"/>
          <path d="M10 13a2 2 0 1 1 4 0"/>
        </svg>`,
  external: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <line x1="7" y1="17" x2="17" y2="7"/>
               <polyline points="7 7 17 7 17 17"/>
             </svg>`,
};

// ---- Card registry + section layout -------------------------
// The Tools page is grouped into labelled sections. To add/move a tool, edit
// CARDS (presentation) and SECTIONS (grouping/order) — the click handler in
// init() keys off data-tool, so no wiring change is needed for a re-group.

const CARDS = {
  tasks:        { icon: "tasks",       color: "blue",   title: "Task Manager",    desc: "Assign tasks, track progress and manage workload.", external: true },
  roombooking:  { icon: "roombooking", color: "rose",   title: "Room Booking",    desc: "Reserve meeting rooms and check availability.", external: true },
  teamcalendar: { icon: "calendar",    color: "teal",   title: "Team Calendar",   desc: "Log leave, meetings &amp; deadlines. View your team&#x2019;s schedule." },
  kyc:          { icon: "kyc",         color: "green",  title: "KYC Management",  desc: "Track KYC file custody, requests &amp; approvals.", external: true },
  valuation:    { icon: "valuation",   color: "purple", title: "Valuation Tool",  desc: "Build auditor-facing valuation reports." },
  tbratio:      { icon: "tbratio",     color: "teal",   title: "TB Ratio Tool",   desc: "Upload a trial balance for P&amp;L, Balance Sheet &amp; ratios." },
  aml:          { icon: "aml",         color: "amber",  title: "AML Dashboard",   desc: "New, rejected &amp; disengaged client fee tracking." },
  training:     { icon: "training",    color: "indigo", title: "Training Portal (coming soon)", desc: "Induction courses, SCORM modules &amp; completion tracking.", external: true },
};

const SECTIONS = [
  { label: "Admin",    cards: ["tasks", "roombooking", "teamcalendar", "kyc"] },
  { label: "Work",     cards: ["valuation", "tbratio", "aml"] },
  { label: "Learning", cards: ["training"] },
];

function cardHtml(id) {
  const c = CARDS[id];
  if (!c) return "";
  const badge = c.external ? `<span class="tools-card-badge">External ${TOOL_ICONS.external}</span>` : "";
  return `
        <div class="tools-card" data-tool="${id}">
          <div class="tools-card-icon ${c.color}">${TOOL_ICONS[c.icon]}</div>
          <div class="tools-card-body">
            <h3 class="tools-card-title">${c.title}</h3>
            <p class="tools-card-desc">${c.desc}</p>
          </div>
          ${badge}
        </div>`;
}

function sectionsHtml() {
  return SECTIONS.map(s => `
      <div class="tools-section">
        <h3 class="tools-section-label">${s.label}</h3>
        <div class="tools-grid">${s.cards.map(cardHtml).join("")}</div>
      </div>`).join("");
}

// ---- Page visibility ----------------------------------------

function showToolsPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove("fees-active", "aml-active", "staff-active", "kb-active");
  main.classList.add("projects-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "projects" } }));
}

function hideToolsPage() {
  document.querySelector(".main")?.classList.remove("projects-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_projects = { show: showToolsPage, hide: hideToolsPage };

// ---- Helper: hide all pages before opening a tool -----------

function hideAllPages() {
  if (window.__hub_reader)      window.__hub_reader.goHome();
  if (window.__hub_fees)        window.__hub_fees.hide();
  if (window.__hub_aml)         window.__hub_aml.hide();
  if (window.__hub_staff)       window.__hub_staff.hide();
  if (window.__hub_kb)          window.__hub_kb.hide();
  if (window.__hub_projects)    window.__hub_projects.hide();
  if (window.__hub_valuation)   window.__hub_valuation.hide();
  if (window.__hub_companies)   window.__hub_companies.hide();
  if (window.__hub_crm)         window.__hub_crm.hide();
  if (window.__hub_tbratio)     window.__hub_tbratio.hide();
  if (window.__hub_performance) window.__hub_performance.hide();
  if (window.__hub_budgetkpi)   window.__hub_budgetkpi.hide();
  if (window.__hub_forms)          window.__hub_forms.hide();
  if (window.__hub_teamcalendar)  window.__hub_teamcalendar.hide();
}

// ---- Component init -----------------------------------------

export default async function init(config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  section.innerHTML = `
    <div class="hub-section">
      <div class="section-header">
        <div class="projects-header-left">
          <button class="projects-back-btn" id="${BACK_BTN_ID}" aria-label="Back to Hub">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <div>
            <h2 class="section-title">Tools</h2>
            <p class="section-subtitle">Dashboards, reports &amp; utilities</p>
          </div>
        </div>
      </div>

      ${sectionsHtml()}
    </div>`;

  // ---- Back button ----
  document.getElementById(BACK_BTN_ID)?.addEventListener("click", () => {
    hideToolsPage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ---- Card click handlers ----
  section.addEventListener("click", e => {
    const card = e.target.closest(".tools-card");
    if (!card) return;

    const tool = card.dataset.tool;

    switch (tool) {
      case "tasks":
        window.open(config.PROJECTS_URL, "_blank", "noopener");
        break;
      case "aml":
        hideAllPages();
        window.__hub_aml?.show();
        window.scrollTo({ top: 0, behavior: "smooth" });
        break;
      case "valuation":
        hideAllPages();
        window.__hub_valuation?.show();
        window.scrollTo({ top: 0, behavior: "smooth" });
        break;
      case "tbratio":
        hideAllPages();
        window.__hub_tbratio?.show();
        window.scrollTo({ top: 0, behavior: "smooth" });
        break;
      case "teamcalendar":
        hideAllPages();
        window.__hub_teamcalendar?.show();
        window.scrollTo({ top: 0, behavior: "smooth" });
        break;
      case "training":
        window.open("https://learn.treppides.com", "_blank", "noopener");
        break;
      case "roombooking":
        window.open("/rooms/", "_blank", "noopener");
        break;
      case "kyc":
        window.open("/kyc/", "_blank", "noopener");
        break;
    }
  });
}
