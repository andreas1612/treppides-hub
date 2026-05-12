// ============================================================
// components/projects.js — Projects page (under development)
// Dedicated full-page view following the staff/aml/kb pattern.
// Mounts into: #section-projects
// ============================================================

const SECTION_ID  = "section-projects";
const BACK_BTN_ID = "projects-back-btn";

// ---- Page visibility ----------------------------------------

function showProjectsPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove("fees-active", "aml-active", "staff-active", "kb-active");
  main.classList.add("projects-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "projects" } }));
}

function hideProjectsPage() {
  document.querySelector(".main")?.classList.remove("projects-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_projects = { show: showProjectsPage, hide: hideProjectsPage };

// ---- Component init -----------------------------------------

export default async function init(_config) {
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
            <h2 class="section-title">Projects</h2>
            <p class="section-subtitle">Tasks, timelines &amp; boards</p>
          </div>
        </div>
      </div>

      <div class="projects-under-dev">
        <div class="projects-dev-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
            <line x1="9" y1="9" x2="9.01" y2="9"/>
            <polyline points="12 7 14 9 12 11"/>
          </svg>
        </div>
        <h3 class="projects-dev-title">Under Development</h3>
        <p class="projects-dev-msg">
          The project management module is currently being built.<br>
          It will be available here once provisioning is complete.
        </p>
        <span class="projects-dev-badge">Coming Soon</span>
      </div>
    </div>`;

  document.getElementById(BACK_BTN_ID)?.addEventListener("click", () => {
    hideProjectsPage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}
