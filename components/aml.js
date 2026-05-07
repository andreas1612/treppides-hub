// ============================================================
// components/aml.js — AML Dashboard landing page.
// Three cards: New Clients / Rejected Clients / Disengaged Clients.
// Each card opens the fees dashboard scoped to that ClickUp list.
// Mounts into: #section-aml
// ============================================================

const SECTION_ID  = "section-aml";
const BACK_BTN_ID = "aml-back-btn";

const CARDS = [
  {
    key:   "new",
    title: "New Clients",
    desc:  "Live new-client engagement fees from ClickUp — monthly and yearly breakdown by UBO or company.",
    iconClass: "new",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
             <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
             <circle cx="9" cy="7" r="4"/>
             <line x1="19" y1="8" x2="19" y2="14"/>
             <line x1="22" y1="11" x2="16" y2="11"/>
           </svg>`,
  },
  {
    key:   "rejected",
    title: "Rejected Clients",
    desc:  "Engagements declined at onboarding — review patterns, fee exposure, and reasons.",
    iconClass: "rejected",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
             <circle cx="12" cy="12" r="10"/>
             <line x1="15" y1="9"  x2="9"  y2="15"/>
             <line x1="9"  y1="9"  x2="15" y2="15"/>
           </svg>`,
  },
  {
    key:   "disengaged",
    title: "Disengaged Clients",
    desc:  "Closed engagements — track lost revenue and disengagement timing.",
    iconClass: "disengaged",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
             <path d="M16 17l5-5-5-5"/>
             <path d="M21 12H9"/>
             <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
           </svg>`,
  },
];

const ARROW_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                     <line x1="5" y1="12" x2="19" y2="12"/>
                     <polyline points="12 5 19 12 12 19"/>
                   </svg>`;

// ---- Page visibility ----------------------------------------

function showAmlPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove("fees-active", "staff-active");
  main.classList.add("aml-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "aml" } }));
}

function hideAmlPage() {
  document.querySelector(".main")?.classList.remove("aml-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_aml = { show: showAmlPage, hide: hideAmlPage };

// ---- Component init -----------------------------------------

export default async function init(_config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  const cardsHtml = CARDS.map(c => `
    <button class="aml-card" data-list="${c.key}" aria-label="Open ${c.title} dashboard">
      <span class="aml-card-icon ${c.iconClass}">${c.icon}</span>
      <h3 class="aml-card-title">${c.title}</h3>
      <p class="aml-card-desc">${c.desc}</p>
      <span class="aml-card-cta">Open dashboard ${ARROW_SVG}</span>
    </button>
  `).join("");

  section.innerHTML = `
    <div class="hub-section">
      <div class="section-header">
        <div class="aml-header-left">
          <button class="aml-back-btn" id="${BACK_BTN_ID}" aria-label="Back to Hub">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <div>
            <h2 class="section-title">AML Dashboard</h2>
            <p class="section-subtitle">Pick a client list to see the fee breakdown</p>
          </div>
        </div>
      </div>

      <div class="aml-cards">${cardsHtml}</div>
    </div>`;

  document.getElementById(BACK_BTN_ID)?.addEventListener("click", () => {
    hideAmlPage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  section.querySelectorAll(".aml-card").forEach(btn => {
    btn.addEventListener("click", () => {
      const listKey = btn.dataset.list;
      window.__hub_fees?.show(listKey);
    });
  });
}
