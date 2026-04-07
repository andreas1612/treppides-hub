// ============================================================
// components/sidebar.js
// Renders the fixed left navigation sidebar and mobile top bar.
// Mounts into: #sidebar  (desktop) and #mobile-header (mobile)
// ============================================================

import CONFIG from "../config.js";

// ---- Coming Soon modal ----------------------------------------
// Guard: quicklinks.js may have already injected the modal.
// Both components share the same modal instance via DOM id checks.

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

// ---- SVG helpers ----------------------------------------------

/**
 * Treppides globe SVG — inline so no external image dependency.
 * TODO: replace before deploy — swap to actual Treppides logo <img> tag
 *       once the final logo asset is available.
 */
function globeSvg(width = 38, height = 38) {
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 40 40"
         fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Treppides logo">
      <circle cx="20" cy="20" r="18" fill="#1a1f2e" stroke="#c8d400" stroke-width="1.6"/>
      <ellipse cx="20" cy="20" rx="8.5" ry="18" stroke="#c8d400" stroke-width="1.2" fill="none"/>
      <line x1="2"   y1="20" x2="38"  y2="20"  stroke="#c8d400" stroke-width="1.2"/>
      <path d="M5.5 12 Q20 9 34.5 12"  stroke="#c8d400" stroke-width="1" fill="none"/>
      <path d="M5.5 28 Q20 31 34.5 28" stroke="#c8d400" stroke-width="1" fill="none"/>
      <circle cx="20" cy="20" r="18" stroke="#c8d400" stroke-width="1.6" fill="none"/>
    </svg>`;
}

const ICONS = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
           <polyline points="9 22 9 12 15 12 15 22"/>
         </svg>`,

  book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
           <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
         </svg>`,

  grid: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <rect x="3"  y="3"  width="7" height="7"/>
           <rect x="14" y="3"  width="7" height="7"/>
           <rect x="14" y="14" width="7" height="7"/>
           <rect x="3"  y="14" width="7" height="7"/>
         </svg>`,

  phone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.14 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.05 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 17z"/>
          </svg>`,
};

// ---- Component ------------------------------------------------

/**
 * Initialises and renders the sidebar navigation.
 * @param {object} config - The hub config object from config.js.
 */
export default async function init(config) {
  const useMock = !CONFIG.ENV_LIVE;
  if (useMock) ensureModal();

  const projHref = useMock ? "#" : config.PROJECTS_URL;
  const extAttrs = useMock ? "" : 'target="_blank" rel="noopener"';

  // ---- Desktop sidebar ----
  const sidebar = document.getElementById("sidebar");
  if (sidebar) {
    sidebar.innerHTML = `
      <!-- Logo / Brand -->
      <div class="sidebar-logo">
        <div class="logo-mark">
          ${globeSvg(38, 38)}
          <div class="logo-text">
            <span class="company">Treppides</span>
            <span class="portal">Company Hub</span>
          </div>
        </div>
      </div>

      <!-- Navigation Links -->
      <nav class="sidebar-nav" aria-label="Main navigation">
        <div class="nav-label">Menu</div>

        <a class="nav-item active" href="#" aria-current="page">
          ${ICONS.home} Home
        </a>

        <a class="nav-item" id="sb-kb" href="#section-knowledgebase">
          ${ICONS.book} Knowledge Base
        </a>

        <a class="nav-item" id="sb-proj" href="${projHref}" ${extAttrs}>
          ${ICONS.grid} Projects
        </a>

        <div class="nav-label" style="margin-top:12px;">Support</div>

        <button class="nav-item nav-btn" id="sb-support">
          ${ICONS.phone} IT Support
        </button>
      </nav>

      <!-- Sidebar footer -->
      <div class="sidebar-footer">
        <!-- TODO: replace before deploy — update version string on each release -->
        <span class="version">v0.1.0</span> &nbsp;·&nbsp; Internal use only
      </div>`;

    // KB link: always stay in the hub — go home then scroll to the KB section
    document.getElementById("sb-kb")?.addEventListener("click", e => {
      e.preventDefault();
      if (window.__hub_reader) window.__hub_reader.goHome();
      setTimeout(() => {
        document.getElementById("section-knowledgebase")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    });

    if (useMock) {
      document.getElementById("sb-proj")?.addEventListener("click", e => {
        e.preventDefault();
        showModal(
          "Project Management",
          "The project management tool is currently being configured. It will be available at projects.treppides.com once the server environment is provisioned."
        );
      });
    }
  }

  // ---- Mobile top bar + nav drawer ----
  const mobileHeader = document.getElementById("mobile-header");
  if (mobileHeader) {
    mobileHeader.innerHTML = `
      <!-- Mobile sticky top bar -->
      <div class="mobile-topbar">
        <div class="mobile-logo">
          ${globeSvg(26, 26)}
          TREPPIDES
        </div>
        <button class="burger" id="burger-btn" aria-label="Toggle navigation">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round">
            <line x1="3"  y1="6"  x2="21" y2="6"/>
            <line x1="3"  y1="12" x2="21" y2="12"/>
            <line x1="3"  y1="18" x2="21" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Mobile nav drawer -->
      <div class="mobile-nav" id="mobile-nav">
        <a class="nav-item active" href="#">${ICONS.home} Home</a>
        <a class="nav-item" id="mb-kb" href="#section-knowledgebase">
          ${ICONS.book} Knowledge Base
        </a>
        <a class="nav-item" id="mb-proj" href="${projHref}" ${extAttrs}>
          ${ICONS.grid} Projects
        </a>
        <button class="nav-item nav-btn" id="mb-support">
          ${ICONS.phone} IT Support
        </button>
      </div>`;

    document.getElementById("burger-btn")?.addEventListener("click", () => {
      document.getElementById("mobile-nav")?.classList.toggle("open");
    });

    document.getElementById("mb-kb")?.addEventListener("click", e => {
      e.preventDefault();
      document.getElementById("mobile-nav")?.classList.remove("open");
      if (window.__hub_reader) window.__hub_reader.goHome();
      setTimeout(() => {
        document.getElementById("section-knowledgebase")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    });

    if (useMock) {
      document.getElementById("mb-proj")?.addEventListener("click", e => {
        e.preventDefault();
        showModal(
          "Project Management",
          "The project management tool is currently being configured. It will be available at projects.treppides.com once the server environment is provisioned."
        );
      });
    }

    document.getElementById("mb-support")?.addEventListener("click", () => {
      document.getElementById("mobile-nav")?.classList.remove("open");
      window.__hub_support?.open();
    });
  }

  // Desktop IT Support button
  document.getElementById("sb-support")?.addEventListener("click", () => {
    window.__hub_support?.open();
  });
}
