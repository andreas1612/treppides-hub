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

  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <line x1="18" y1="20" x2="18" y2="10"/>
           <line x1="12" y1="20" x2="12" y2="4"/>
           <line x1="6"  y1="20" x2="6"  y2="14"/>
         </svg>`,

  person: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
             <circle cx="12" cy="7" r="4"/>
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
        <img src="/logo.png" class="sidebar-logo-img" alt="K. Treppides &amp; Co Ltd">
        <span class="sidebar-portal-label">Company Hub</span>
      </div>

      <!-- Navigation Links -->
      <nav class="sidebar-nav" aria-label="Main navigation">
        <div class="nav-label">Menu</div>

        <a class="nav-item" id="sb-home" href="#" aria-current="page">
          ${ICONS.home} Home
        </a>

        <button class="nav-item nav-btn" id="sb-kb">
          ${ICONS.book} Knowledge Base
        </button>

        <button class="nav-item nav-btn" id="sb-staff">
          ${ICONS.person} Staff Directory
        </button>

        <a class="nav-item" id="sb-proj" href="${projHref}" ${extAttrs}>
          ${ICONS.grid} Projects
        </a>

        <button class="nav-item nav-btn" id="sb-fees">
          ${ICONS.chart} AML Dashboard
        </button>

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

    // Home link: return to hub, hide all overlay pages
    document.getElementById("sb-home")?.addEventListener("click", e => {
      e.preventDefault();
      if (window.__hub_fees)  window.__hub_fees.hide();
      if (window.__hub_aml)   window.__hub_aml.hide();
      if (window.__hub_staff) window.__hub_staff.hide();
      if (window.__hub_reader) window.__hub_reader.goHome();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // KB link: open dedicated Knowledge Base page view
    document.getElementById("sb-kb")?.addEventListener("click", () => {
      if (window.__hub_reader) window.__hub_reader.goHome();
      if (window.__hub_fees)   window.__hub_fees.hide();
      if (window.__hub_aml)    window.__hub_aml.hide();
      if (window.__hub_staff)  window.__hub_staff.hide();
      if (window.__hub_kb)     window.__hub_kb.show();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // Staff Directory link: open dedicated staff page view
    document.getElementById("sb-staff")?.addEventListener("click", () => {
      if (window.__hub_reader) window.__hub_reader.goHome();
      if (window.__hub_fees)   window.__hub_fees.hide();
      if (window.__hub_aml)    window.__hub_aml.hide();
      if (window.__hub_staff)  window.__hub_staff.show();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // AML Dashboard: open the landing page (three-card chooser).
    // The actual fees view opens from one of those cards.
    document.getElementById("sb-fees")?.addEventListener("click", () => {
      if (window.__hub_reader) window.__hub_reader.goHome();
      if (window.__hub_fees)   window.__hub_fees.hide();
      if (window.__hub_staff)  window.__hub_staff.hide();
      if (window.__hub_aml)    window.__hub_aml.show();
      window.scrollTo({ top: 0, behavior: "smooth" });
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
          <img src="/logo.png" class="mobile-logo-img" alt="K. Treppides &amp; Co Ltd">
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
        <a class="nav-item" id="mb-home" href="#">${ICONS.home} Home</a>
        <button class="nav-item nav-btn" id="mb-kb">
          ${ICONS.book} Knowledge Base
        </button>
        <button class="nav-item nav-btn" id="mb-staff">
          ${ICONS.person} Staff Directory
        </button>
        <a class="nav-item" id="mb-proj" href="${projHref}" ${extAttrs}>
          ${ICONS.grid} Projects
        </a>
        <button class="nav-item nav-btn" id="mb-fees">
          ${ICONS.chart} AML Dashboard
        </button>
        <button class="nav-item nav-btn" id="mb-support">
          ${ICONS.phone} IT Support
        </button>
      </div>`;

    document.getElementById("burger-btn")?.addEventListener("click", () => {
      document.getElementById("mobile-nav")?.classList.toggle("open");
    });

    // Mobile home link
    document.getElementById("mb-home")?.addEventListener("click", e => {
      e.preventDefault();
      document.getElementById("mobile-nav")?.classList.remove("open");
      if (window.__hub_fees)  window.__hub_fees.hide();
      if (window.__hub_aml)   window.__hub_aml.hide();
      if (window.__hub_staff) window.__hub_staff.hide();
      if (window.__hub_reader) window.__hub_reader.goHome();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    document.getElementById("mb-kb")?.addEventListener("click", () => {
      document.getElementById("mobile-nav")?.classList.remove("open");
      if (window.__hub_reader) window.__hub_reader.goHome();
      if (window.__hub_fees)   window.__hub_fees.hide();
      if (window.__hub_aml)    window.__hub_aml.hide();
      if (window.__hub_staff)  window.__hub_staff.hide();
      if (window.__hub_kb)     window.__hub_kb.show();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    document.getElementById("mb-staff")?.addEventListener("click", () => {
      document.getElementById("mobile-nav")?.classList.remove("open");
      if (window.__hub_reader) window.__hub_reader.goHome();
      if (window.__hub_fees)   window.__hub_fees.hide();
      if (window.__hub_aml)    window.__hub_aml.hide();
      if (window.__hub_staff)  window.__hub_staff.show();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // Mobile AML Dashboard link
    document.getElementById("mb-fees")?.addEventListener("click", e => {
      e.preventDefault();
      document.getElementById("mobile-nav")?.classList.remove("open");
      if (window.__hub_reader) window.__hub_reader.goHome();
      if (window.__hub_fees)   window.__hub_fees.hide();
      if (window.__hub_staff)  window.__hub_staff.hide();
      if (window.__hub_aml)    window.__hub_aml.show();
      window.scrollTo({ top: 0, behavior: "smooth" });
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

  // ---- Active nav state ----
  function setActiveNav(section) {
    const map = {
      home:  ["sb-home",  "mb-home"],
      kb:    ["sb-kb",    "mb-kb"],
      staff: ["sb-staff", "mb-staff"],
      aml:   ["sb-fees",  "mb-fees"],   // landing → highlight AML Dashboard
      fees:  ["sb-fees",  "mb-fees"],   // dashboard view → same highlight
    };
    ["sb-home","sb-kb","sb-staff","sb-proj","sb-fees","mb-home","mb-kb","mb-staff","mb-proj","mb-fees"].forEach(id => {
      document.getElementById(id)?.classList.remove("active");
    });
    (map[section] || map.home).forEach(id => {
      document.getElementById(id)?.classList.add("active");
    });
  }

  setActiveNav("home");
  document.addEventListener("hub:navchange", e => setActiveNav(e.detail?.section));
}
