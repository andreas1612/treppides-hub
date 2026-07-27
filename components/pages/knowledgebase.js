// ============================================================
// components/knowledgebase.js
// Renders the Knowledge Base section — two-level navigation:
//   1. Landing view with folder cards (Manuals & Procedures, Policies)
//   2. Drill-down view showing books from the selected BookStack shelf
// Mounts into: #section-knowledgebase
// ============================================================

import { fetchShelfBooks }  from "../../api/bookstack.js";
import { escapeHtml, renderSkeleton, renderError } from "../../utils/dom.js";
import { setStatus }        from "../shell/topbar.js";
import { getCurrentUser }   from "../../js/auth.js";
import CONFIG               from "../../config.js";

const SECTION_ID  = "section-kb";
const CARDS_ID    = "kb-cards";
const BACK_BTN_ID = "kb-back-btn";

// ---- Folder definitions ------------------------------------

const FOLDERS = [
  {
    key:      "manuals",
    title:    "Department Manuals & Procedures",
    desc:     "Department manuals, standard operating procedures and documentation",
    icon:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                <line x1="9" y1="7" x2="16" y2="7"/>
                <line x1="9" y1="11" x2="14" y2="11"/>
              </svg>`,
    shelfId:  CONFIG.DEPARTMENTS_SHELF_ID,
  },
  {
    key:      "policies",
    title:    "Policies",
    desc:     "Company policies and regulatory documentation",
    icon:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <polyline points="9 12 11 14 15 10"/>
              </svg>`,
    shelfId:  CONFIG.POLICIES_SHELF_ID,
  },
];

// ---- State -------------------------------------------------

let currentFolder = null;  // null = landing view, object = drill-down

// ---- Page visibility ----------------------------------------

function showKbPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove("fees-active", "aml-active", "staff-active", "projects-active");
  main.classList.add("kb-active");
  renderLanding();
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "kb" } }));
}

function hideKbPage() {
  document.querySelector(".main")?.classList.remove("kb-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_kb = { show: showKbPage, hide: hideKbPage };

// ---- Rendering helpers -------------------------------------

/** Renders one folder card for the landing view. */
function folderCardHtml(folder) {
  return `
    <article class="card kb-folder-card" data-folder="${folder.key}"
             role="button" tabindex="0">
      <div class="kb-folder-icon">${folder.icon}</div>
      <h3 class="card-title">${escapeHtml(folder.title)}</h3>
      <p class="card-excerpt">${escapeHtml(folder.desc)}</p>
      <div class="card-footer">
        <span class="card-link">Open &rarr;</span>
      </div>
    </article>`;
}

/** Renders one department book card (same as before). */
function bookCardHtml(book) {
  const name = escapeHtml(book.name || "Untitled");
  const desc = escapeHtml(book.description || "View documentation.");

  const tag  = escapeHtml((book.name || "").split(/[\s–-]/)[0].slice(0, 10));

  const dataId   = escapeHtml(String(book.id || ""));
  const dataName = escapeHtml(book.name || "");
  const dataSlug = escapeHtml(book.slug || "");

  return `
    <article class="card kb-book-card"
             data-book-id="${dataId}"
             data-book-name="${dataName}"
             data-book-slug="${dataSlug}"
             role="button"
             tabindex="0"
             style="cursor:pointer;border:none;text-align:left;width:100%;background:var(--card-bg,#fff);">
      <span class="card-tag">${tag}</span>
      <h3 class="card-title">${name}</h3>
      <p class="card-excerpt">${desc}</p>
      <div class="card-footer">
        <span class="card-link">Open department &rarr;</span>
      </div>
    </article>`;
}

// ---- View rendering ----------------------------------------

/** Renders the landing view with folder cards. */
function renderLanding() {
  currentFolder = null;

  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  section.innerHTML = `
    <div class="hub-section">
      <div class="section-header">
        <div class="kb-header-left">
          <button class="kb-back-btn" id="${BACK_BTN_ID}" aria-label="Back to Hub">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <div>
            <h2 class="section-title">Knowledge Base</h2>
            <p class="section-subtitle">Browse department manuals, procedures and policies</p>
          </div>
        </div>
        <a class="btn-refresh" href="${CONFIG.BASE_URL}" target="_blank" rel="noopener"
           style="text-decoration:none; color:#000;">
          Browse all &rarr;
        </a>
      </div>
      <div id="${CARDS_ID}">
        <div class="cards-grid kb-folder-grid">
          ${FOLDERS.map(folderCardHtml).join("")}
        </div>
      </div>
    </div>`;

  // Back button → return to hub home
  document.getElementById(BACK_BTN_ID)?.addEventListener("click", () => {
    hideKbPage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // Folder card click handlers
  section.querySelectorAll(".kb-folder-card").forEach(card => {
    const key = card.dataset.folder;
    const folder = FOLDERS.find(f => f.key === key);
    const handler = () => { if (folder) renderDrilldown(folder); };
    card.addEventListener("click", handler);
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); }
    });
  });
}

/** Renders the drill-down view: books from a specific shelf. */
async function renderDrilldown(folder) {
  currentFolder = folder;

  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  section.innerHTML = `
    <div class="hub-section">
      <div class="section-header">
        <div class="kb-header-left">
          <button class="kb-back-btn" id="${BACK_BTN_ID}" aria-label="Back to Knowledge Base">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <div>
            <h2 class="section-title">${escapeHtml(folder.title)}</h2>
            <p class="section-subtitle">Knowledge Base</p>
          </div>
        </div>
        <a class="btn-refresh" href="${CONFIG.BASE_URL}" target="_blank" rel="noopener"
           style="text-decoration:none; color:#000;">
          Browse all &rarr;
        </a>
      </div>
      <div id="${CARDS_ID}"></div>
    </div>`;

  // Back button → return to folder landing (not hub home)
  document.getElementById(BACK_BTN_ID)?.addEventListener("click", () => {
    renderLanding();
  });

  // Load books from shelf
  const cardsEl = document.getElementById(CARDS_ID);
  if (!cardsEl) return;

  cardsEl.innerHTML = renderSkeleton();

  try {
    let books = await fetchShelfBooks(folder.shelfId);

    // In the manuals folder, non-SUPER users only see AML
    if (folder.key === "manuals") {
      const tier = getCurrentUser()?.tier;
      if (tier !== "SUPER") {
        books = books.filter(b => b.slug === "aml");
      }
    }

    if (!books.length) {
      cardsEl.innerHTML = `
        <div class="state-box empty" role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.5" stroke-linecap="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
          <h3>No items found.</h3>
          <p>This section is empty. Content will appear here once it's added in BookStack.</p>
        </div>`;
    } else {
      cardsEl.innerHTML = `<div class="cards-grid">${books.map(bookCardHtml).join("")}</div>`;

      // Attach click and keyboard handlers to each card
      cardsEl.querySelectorAll(".kb-book-card").forEach(card => {
        const dispatch = () => {
          document.dispatchEvent(new CustomEvent("hub:openBook", {
            detail: {
              id:   parseInt(card.dataset.bookId, 10),
              name: card.dataset.bookName,
              slug: card.dataset.bookSlug,
            },
          }));
        };
        card.addEventListener("click", dispatch);
        card.addEventListener("keydown", e => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); dispatch(); }
        });
      });
    }

    setStatus("All systems operational");
  } catch (err) {
    console.error("[Hub] knowledge base fetch error:", err);
    cardsEl.innerHTML = renderError();
    setStatus("Knowledge base unreachable", true);
  }
}

/**
 * Initialises the Knowledge Base section.
 * @param {object} _config - Hub config (values read from config.js internally).
 */
export default async function init(_config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  renderLanding();
}
