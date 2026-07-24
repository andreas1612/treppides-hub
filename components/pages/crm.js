// ============================================================
// components/pages/crm.js — CRM landing page.
// Card grid to pick a per-list dashboard:
//   • Deals Dashboard        → the existing companies.js view (__hub_companies)
//   • Leads Dashboard        → __hub_crmlist.show("leads")        (Phase 3)
//   • Accounts — Companies   → __hub_crmlist.show("accounts_companies")
//   • Accounts — Individuals → __hub_crmlist.show("accounts_individuals")
//
// Nav model: Tools → CRM → {dashboard}. This landing's back button returns
// to the Tools grid; each dashboard's back returns here.
//
// Mounts into: #section-crm
// ============================================================

const SECTION_ID  = "section-crm";
const BACK_BTN_ID = "crm-back-btn";

// Card registry. `ready:false` cards render disabled with a "Soon" badge until
// their dashboard is wired (Phase 3). Deals is live from day one.
const CARDS = [
  {
    key: "deals",
    title: "Deals Dashboard",
    desc: "Search companies and track Deal Value, deals and pipeline across every ClickUp space.",
    iconClass: "deals",
    ready: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
             <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
             <polyline points="14 2 14 8 20 8"/>
             <line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>
           </svg>`,
  },
  {
    key: "leads",
    title: "Leads Dashboard",
    desc: "Track the sales pipeline — lead source, industry, jurisdiction and status.",
    iconClass: "leads",
    ready: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
             <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
             <circle cx="9" cy="7" r="4"/>
             <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
           </svg>`,
  },
  {
    key: "accounts_companies",
    title: "Accounts — Companies",
    desc: "Company master records — UBO, client code, industry, country, auditors and risk.",
    iconClass: "accounts-co",
    ready: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
             <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>
             <line x1="9" y1="9" x2="9" y2="9"/><line x1="9" y1="13" x2="9" y2="13"/><line x1="9" y1="17" x2="9" y2="17"/>
           </svg>`,
  },
  {
    key: "accounts_individuals",
    title: "Accounts — Individuals",
    desc: "Individual client records — client code, country, status and details.",
    iconClass: "accounts-ind",
    ready: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
             <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
             <circle cx="12" cy="7" r="4"/>
           </svg>`,
  },
  {
    key: "contacts",
    title: "Contacts",
    desc: "People across the CRM with their linked company — job title, email and phone.",
    iconClass: "contacts",
    ready: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
             <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
             <circle cx="9" cy="7" r="4"/>
             <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
             <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
           </svg>`,
  },
];

const ARROW_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                     <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                   </svg>`;

// ---- Page visibility ----------------------------------------

function showCrmPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove("fees-active", "aml-active", "staff-active",
    "companies-active", "forms-active", "kb-active", "crmlist-active");
  main.classList.add("crm-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "crm" } }));
}

function hideCrmPage() {
  document.querySelector(".main")?.classList.remove("crm-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_crm = { show: showCrmPage, hide: hideCrmPage };

// ---- Component init -----------------------------------------

export default async function init(_config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  const cardsHtml = CARDS.map(c => {
    const soon = c.ready ? "" : `<span class="crm-card-soon">Soon</span>`;
    const cta  = c.ready
      ? `<span class="crm-card-cta">Open dashboard ${ARROW_SVG}</span>`
      : `<span class="crm-card-cta muted">Coming soon</span>`;
    return `
      <button class="crm-card${c.ready ? "" : " disabled"}" data-crm="${c.key}"
              ${c.ready ? "" : "aria-disabled=\"true\""} aria-label="Open ${c.title}">
        <span class="crm-card-icon ${c.iconClass}">${c.icon}</span>
        ${soon}
        <h3 class="crm-card-title">${c.title}</h3>
        <p class="crm-card-desc">${c.desc}</p>
        ${cta}
      </button>`;
  }).join("");

  section.innerHTML = `
    <div class="hub-section">
      <div class="section-header">
        <div class="crm-header-left">
          <button class="crm-back-btn" id="${BACK_BTN_ID}" aria-label="Back to Home">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <div>
            <h2 class="section-title">CRM</h2>
            <p class="section-subtitle">Pick a ClickUp list to explore</p>
          </div>
        </div>
      </div>
      <div class="crm-cards">${cardsHtml}</div>
    </div>`;

  // CRM is a top-level sidebar item (SUPER-only), no longer under Tools — its
  // back button returns to the hub home, not the Tools grid.
  document.getElementById(BACK_BTN_ID)?.addEventListener("click", () => {
    hideCrmPage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  section.querySelectorAll(".crm-card").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.crm;
      if (key === "deals") {
        window.__hub_crm?.hide();
        window.__hub_companies?.show();
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      // Other lists — wired in Phase 3 once __hub_crmlist exists.
      if (window.__hub_crmlist) {
        window.__hub_crm?.hide();
        window.__hub_crmlist.show(key);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  });

  // Self-hide: #section-crm is one of several full-page views toggled by a
  // body class. Rather than add __hub_crm.hide() to every sidebar/tool handler,
  // drop our active class whenever the hub navigates anywhere that isn't us.
  // (Every show()/hide() in the app dispatches this event.) We remove the class
  // directly — no re-dispatch — so this can't loop.
  document.addEventListener("hub:navchange", e => {
    if (e.detail?.section !== "crm") {
      document.querySelector(".main")?.classList.remove("crm-active");
    }
  });
}
