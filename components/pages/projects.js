// ============================================================
// components/projects.js — Projects page
// Launcher card that opens the Task Manager in a new tab.
// Mounts into: #section-projects
// ============================================================

const SECTION_ID    = "section-projects";
const BACK_BTN_ID   = "projects-back-btn";
const LAUNCH_BTN_ID = "projects-launch-btn";

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
            <h2 class="section-title">Task Manager</h2>
            <p class="section-subtitle">Tasks, timelines &amp; boards</p>
          </div>
        </div>
      </div>

      <div class="projects-launcher">
        <div class="projects-launcher-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
            <rect x="9" y="3" width="6" height="4" rx="1"/>
            <line x1="9" y1="12" x2="15" y2="12"/>
            <line x1="9" y1="16" x2="13" y2="16"/>
          </svg>
        </div>
        <h3 class="projects-launcher-title">Task Manager</h3>
        <p class="projects-launcher-desc">
          Assign tasks, track progress, and manage your team's workload.
        </p>
        <button class="projects-launch-btn" id="${LAUNCH_BTN_ID}">
          Open Task Manager
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="7" y1="17" x2="17" y2="7"/>
            <polyline points="7 7 17 7 17 17"/>
          </svg>
        </button>
      </div>
    </div>`;

  document.getElementById(BACK_BTN_ID)?.addEventListener("click", () => {
    hideProjectsPage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  document.getElementById(LAUNCH_BTN_ID)?.addEventListener("click", () => {
    window.open(config.PROJECTS_URL, "_blank", "noopener");
  });
}
