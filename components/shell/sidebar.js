// ============================================================
// components/sidebar.js
// Renders the fixed left navigation sidebar and mobile top bar.
// Mounts into: #sidebar  (desktop) and #mobile-header (mobile)
// ============================================================

import CONFIG from "../../config.js";
import { getCurrentUser } from "../../js/auth.js";
import { navigate } from "../../js/router.js?v=1";

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

  calculator: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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

  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <circle cx="11" cy="11" r="8"/>
             <line x1="21" y1="21" x2="16.65" y2="16.65"/>
           </svg>`,

  trendUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
              <polyline points="17 6 23 6 23 12"/>
            </svg>`,

  dollar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <line x1="12" y1="1" x2="12" y2="23"/>
             <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
           </svg>`,

  ledger: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
             <polyline points="14 2 14 8 20 8"/>
             <line x1="8" y1="13" x2="16" y2="13"/>
             <line x1="8" y1="17" x2="13" y2="17"/>
           </svg>`,

  receipt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z"/>
             <line x1="8" y1="7" x2="16" y2="7"/>
             <line x1="8" y1="11" x2="16" y2="11"/>
             <line x1="8" y1="15" x2="12" y2="15"/>
           </svg>`,

  crm: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 21h18"/>
          <path d="M6 21V8l6-4 6 4v13"/>
          <line x1="10" y1="12" x2="10" y2="12"/><line x1="14" y1="12" x2="14" y2="12"/>
          <line x1="10" y1="16" x2="10" y2="16"/><line x1="14" y1="16" x2="14" y2="16"/>
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

  // Reports section is gated by the user's feature set from /api/me (RoleService tier):
  // SUPER sees Performance / Budget KPI / Financials for everyone (label "Admin");
  // FULL sees Performance / Budget KPI / Financials for everyone (label "Admin");
  // STANDARD sees Performance / Budget KPI SELF-scoped only (label "My Reports").
  // NONE sees nothing.
  const _feat = new Set(getCurrentUser()?.features || []);
  const _has = (k) => _feat.has(k);
  const _tier = getCurrentUser()?.tier;
  // "Admin" for read-across users (FULL/SUPER + HR via canViewAllReports); else "My Reports".
  const _label = getCurrentUser()?.canViewAllReports ? "Admin" : "My Reports";
  const adminItems = (p) => {
    const btns = [
      // CRM — gated by "crm" feature (SUPERVISOR + SUPER tiers).
      _has("crm")         ? `<button class="nav-item nav-btn" id="${p}-crm">${ICONS.crm} CRM</button>` : "",
      _has("performance") ? `<button class="nav-item nav-btn" id="${p}-performance">${ICONS.trendUp} Performance</button>` : "",
      _has("budgetkpi")   ? `<button class="nav-item nav-btn" id="${p}-budgetkpi">${ICONS.dollar} Budget KPI</button>` : "",
      // Financials — gated by "financials" feature (granted to FULL and SUPER tiers).
      _has("financials")  ? `<button class="nav-item nav-btn" id="${p}-financials">${ICONS.ledger} Financials</button>` : "",
      // Invoices — SUPER-tier only (per-invoice paid/unpaid tracking).
      _has("invoices")    ? `<button class="nav-item nav-btn" id="${p}-invoices">${ICONS.receipt} Invoices</button>` : "",
    ].filter(Boolean).join("\n        ");
    return btns ? `<div class="nav-label" style="margin-top:12px;">${_label}</div>\n        ${btns}` : "";
  };
  const adminDesktop = adminItems("sb");
  const adminMobile = adminItems("mb");

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

        <button class="nav-item nav-btn" id="sb-tools">
          ${ICONS.grid} Tools
        </button>

        ${adminDesktop}

        <div class="nav-label" style="margin-top:12px;">Support</div>

        <button class="nav-item nav-btn" id="sb-support">
          ${ICONS.phone} Tech Support
        </button>

        ${_tier === "SUPER" ? `<button class="nav-item nav-btn" id="sb-itsupport">
          ${ICONS.phone} IT Support (Not Operational)
        </button>` : ""}
      </nav>

      <!-- Sidebar footer -->
      <div class="sidebar-footer">
        <!-- TODO: replace before deploy — update version string on each release -->
        <span class="version">v1.0.0</span> &nbsp;·&nbsp; Internal use only
      </div>`;

    // Desktop nav — all use the router
    document.getElementById("sb-home")?.addEventListener("click", e => { e.preventDefault(); navigate("/"); });
    document.getElementById("sb-kb")?.addEventListener("click",          () => navigate("/kb"));
    document.getElementById("sb-staff")?.addEventListener("click",       () => navigate("/staff"));
    document.getElementById("sb-tools")?.addEventListener("click",       () => navigate("/tools"));
    document.getElementById("sb-crm")?.addEventListener("click",         () => navigate("/crm"));
    document.getElementById("sb-performance")?.addEventListener("click", () => navigate("/performance"));
    document.getElementById("sb-budgetkpi")?.addEventListener("click",   () => navigate("/budget-kpi"));
    document.getElementById("sb-financials")?.addEventListener("click",  () => navigate("/financials"));
    document.getElementById("sb-invoices")?.addEventListener("click",    () => navigate("/invoices"));

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
        <button class="nav-item nav-btn" id="mb-tools">
          ${ICONS.grid} Tools
        </button>
        ${adminMobile}
        <div class="nav-label" style="margin-top:8px;">Support</div>
        <button class="nav-item nav-btn" id="mb-support">
          ${ICONS.phone} Tech Support
        </button>
        ${_tier === "SUPER" ? `<button class="nav-item nav-btn" id="mb-itsupport">
          ${ICONS.phone} IT Support (Not Operational)
        </button>` : ""}
      </div>`;

    document.getElementById("burger-btn")?.addEventListener("click", () => {
      document.getElementById("mobile-nav")?.classList.toggle("open");
    });

    // Mobile nav — close drawer then route
    const closeNav = () => document.getElementById("mobile-nav")?.classList.remove("open");

    document.getElementById("mb-home")?.addEventListener("click", e => { e.preventDefault(); closeNav(); navigate("/"); });
    document.getElementById("mb-kb")?.addEventListener("click",          () => { closeNav(); navigate("/kb"); });
    document.getElementById("mb-staff")?.addEventListener("click",       () => { closeNav(); navigate("/staff"); });
    document.getElementById("mb-tools")?.addEventListener("click",       () => { closeNav(); navigate("/tools"); });
    document.getElementById("mb-crm")?.addEventListener("click",         () => { closeNav(); navigate("/crm"); });
    document.getElementById("mb-performance")?.addEventListener("click", () => { closeNav(); navigate("/performance"); });
    document.getElementById("mb-budgetkpi")?.addEventListener("click",   () => { closeNav(); navigate("/budget-kpi"); });
    document.getElementById("mb-financials")?.addEventListener("click",  () => { closeNav(); navigate("/financials"); });
    document.getElementById("mb-invoices")?.addEventListener("click",    () => { closeNav(); navigate("/invoices"); });

    document.getElementById("mb-support")?.addEventListener("click", () => {
      document.getElementById("mobile-nav")?.classList.remove("open");
      window.__hub_support?.open();
    });

    document.getElementById("mb-itsupport")?.addEventListener("click", () => {
      document.getElementById("mobile-nav")?.classList.remove("open");
      window.__hub_itsupport?.open();
    });
  }

  // Desktop support buttons
  document.getElementById("sb-support")?.addEventListener("click", () => {
    window.__hub_support?.open();
  });
  document.getElementById("sb-itsupport")?.addEventListener("click", () => {
    window.__hub_itsupport?.open();
  });

  // ---- Active nav state ----
  function setActiveNav(section) {
    const map = {
      home:        ["sb-home",        "mb-home"],
      kb:          ["sb-kb",          "mb-kb"],
      staff:       ["sb-staff",       "mb-staff"],
      projects:    ["sb-tools",       "mb-tools"],     // Tools landing page
      aml:         ["sb-crm",         "mb-crm"],       // AML lives under CRM
      fees:        ["sb-crm",         "mb-crm"],
      valuation:   ["sb-tools",       "mb-tools"],
      companies:   ["sb-crm",         "mb-crm"],       // Deals dashboard (under CRM)
      crm:         ["sb-crm",         "mb-crm"],       // CRM landing
      crmlist:     ["sb-crm",         "mb-crm"],       // Leads / Accounts dashboards
      tbratio:     ["sb-tools",       "mb-tools"],
      forms:        ["sb-crm",         "mb-crm"],       // Lead/Deal forms live under CRM
      teamcalendar: ["sb-tools",       "mb-tools"],     // tool sub-page → highlight Tools
      performance:  ["sb-performance", "mb-performance"],
      budgetkpi:   ["sb-budgetkpi",   "mb-budgetkpi"],
      financials:  ["sb-financials",  "mb-financials"],
      invoices:    ["sb-invoices",    "mb-invoices"],
    };
    [
      "sb-home","sb-kb","sb-staff","sb-tools","sb-crm",
      "sb-performance","sb-budgetkpi","sb-financials","sb-invoices",
      "mb-home","mb-kb","mb-staff","mb-tools","mb-crm",
      "mb-performance","mb-budgetkpi","mb-financials","mb-invoices",
    ].forEach(id => {
      document.getElementById(id)?.classList.remove("active");
    });
    (map[section] || map.home).forEach(id => {
      document.getElementById(id)?.classList.add("active");
    });
  }

  setActiveNav("home");
  document.addEventListener("hub:navchange", e => setActiveNav(e.detail?.section));
}
