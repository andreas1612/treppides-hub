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
  external: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <line x1="7" y1="17" x2="17" y2="7"/>
               <polyline points="7 7 17 7 17 17"/>
             </svg>`,
};

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
  if (window.__hub_tbratio)     window.__hub_tbratio.hide();
  if (window.__hub_performance) window.__hub_performance.hide();
  if (window.__hub_budgetkpi)   window.__hub_budgetkpi.hide();
  if (window.__hub_forms)       window.__hub_forms.hide();
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

      <div class="tools-grid">

        <div class="tools-card" data-tool="tasks">
          <div class="tools-card-icon blue">${TOOL_ICONS.tasks}</div>
          <div class="tools-card-body">
            <h3 class="tools-card-title">Task Manager</h3>
            <p class="tools-card-desc">Assign tasks, track progress and manage workload.</p>
          </div>
          <span class="tools-card-badge">External ${TOOL_ICONS.external}</span>
        </div>

        <div class="tools-card" data-tool="aml">
          <div class="tools-card-icon amber">${TOOL_ICONS.aml}</div>
          <div class="tools-card-body">
            <h3 class="tools-card-title">AML Dashboard</h3>
            <p class="tools-card-desc">New, rejected &amp; disengaged client fee tracking.</p>
          </div>
        </div>

        <div class="tools-card" data-tool="valuation">
          <div class="tools-card-icon purple">${TOOL_ICONS.valuation}</div>
          <div class="tools-card-body">
            <h3 class="tools-card-title">Valuation Tool</h3>
            <p class="tools-card-desc">Build auditor-facing valuation reports.</p>
          </div>
        </div>

        <div class="tools-card" data-tool="companies">
          <div class="tools-card-icon green">${TOOL_ICONS.companies}</div>
          <div class="tools-card-body">
            <h3 class="tools-card-title">Group Dashboard</h3>
            <p class="tools-card-desc">Search a company and find all its tasks across spaces.</p>
          </div>
        </div>

        <div class="tools-card" data-tool="tbratio">
          <div class="tools-card-icon teal">${TOOL_ICONS.tbratio}</div>
          <div class="tools-card-body">
            <h3 class="tools-card-title">TB Ratio Tool</h3>
            <p class="tools-card-desc">Upload a trial balance for P&amp;L, Balance Sheet &amp; ratios.</p>
          </div>
        </div>

      </div>
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
      case "companies":
        hideAllPages();
        window.__hub_companies?.show();
        window.scrollTo({ top: 0, behavior: "smooth" });
        break;
      case "tbratio":
        hideAllPages();
        window.__hub_tbratio?.show();
        window.scrollTo({ top: 0, behavior: "smooth" });
        break;
    }
  });
}
