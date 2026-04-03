// ============================================================
// components/quicklinks.js
// Renders the Quick Access widget row at the bottom of the page.
// Mounts into: #section-quicklinks
// ============================================================

import CONFIG from "../config.js";

// ---- Coming Soon modal ----------------------------------------

const MODAL_STYLES = `
  #coming-soon-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  #coming-soon-backdrop.hidden { display: none; }
  #coming-soon-card {
    background: #ffffff;
    border-radius: 8px;
    padding: 32px;
    max-width: 400px;
    width: calc(100% - 48px);
    box-shadow: var(--shadow-hover);
  }
  #coming-soon-card h2 {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 12px;
  }
  #coming-soon-card p {
    font-size: 14px;
    color: var(--text-secondary);
    margin: 0 0 24px;
    line-height: 1.6;
  }
  #coming-soon-close {
    background: var(--accent);
    color: #000;
    border: none;
    border-radius: var(--radius);
    padding: 9px 20px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--transition);
  }
  #coming-soon-close:hover { background: var(--accent-hover); }
`;

function ensureModal() {
  if (document.getElementById("coming-soon-backdrop")) return;

  if (!document.getElementById("coming-soon-styles")) {
    const style = document.createElement("style");
    style.id = "coming-soon-styles";
    style.textContent = MODAL_STYLES;
    document.head.appendChild(style);
  }

  const backdrop = document.createElement("div");
  backdrop.id = "coming-soon-backdrop";
  backdrop.className = "hidden";
  backdrop.innerHTML = `
    <div id="coming-soon-card">
      <h2 id="coming-soon-title"></h2>
      <p  id="coming-soon-msg"></p>
      <button id="coming-soon-close">Got it</button>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => backdrop.classList.add("hidden");

  document.getElementById("coming-soon-close").addEventListener("click", close);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
}

function showModal(title, message) {
  document.getElementById("coming-soon-title").textContent = title;
  document.getElementById("coming-soon-msg").textContent   = message;
  document.getElementById("coming-soon-backdrop").classList.remove("hidden");
}

// ---- Component ------------------------------------------------

/**
 * Initialises the Quick Links widget row.
 * @param {object} config - Hub config object from config.js.
 */
export default async function init(config) {
  const section = document.getElementById("section-quicklinks");
  if (!section) return;

  const useMock = !CONFIG.ENV_LIVE;
  if (useMock) ensureModal();

  section.innerHTML = `
    <div class="widget-row">

      <a class="widget-card" id="ql-kb" href="#section-knowledgebase">
        <div class="widget-icon blue">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
        </div>
        <div class="widget-info">
          <h4>Knowledge Base</h4>
          <p>Policies, procedures &amp; docs</p>
        </div>
      </a>

      <a class="widget-card" id="ql-proj"
         href="${useMock ? "#" : config.PROJECTS_URL}"
         ${useMock ? "" : 'target="_blank" rel="noopener"'}>
        <div class="widget-icon green">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3"  y="3"  width="7" height="7"/>
            <rect x="14" y="3"  width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/>
            <rect x="3"  y="14" width="7" height="7"/>
          </svg>
        </div>
        <div class="widget-info">
          <h4>Projects</h4>
          <p>Tasks, timelines &amp; boards</p>
        </div>
      </a>

      <!-- TODO: replace before deploy — update href to actual IT support email address -->
      <a class="widget-card" href="mailto:it@treppides.com">
        <div class="widget-icon amber">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8"  x2="12"   y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <div class="widget-info">
          <h4>IT Support</h4>
          <p>Raise a request or query</p>
        </div>
      </a>

    </div>`;

  // KB widget always stays in the hub
  document.getElementById("ql-kb")?.addEventListener("click", e => {
    e.preventDefault();
    if (window.__hub_reader) window.__hub_reader.goHome();
    setTimeout(() => {
      document.getElementById("section-knowledgebase")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  });

  if (useMock) {
    document.getElementById("ql-proj")?.addEventListener("click", e => {
      e.preventDefault();
      showModal(
        "Project Management",
        "The project management tool is currently being configured. It will be available at projects.treppides.com once the server environment is provisioned."
      );
    });
  }
}
