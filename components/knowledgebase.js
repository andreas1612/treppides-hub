// ============================================================
// components/knowledgebase.js
// Renders the Knowledge Base section — fetches department books
// live from the BookStack API and displays them as cards.
// Mounts into: #section-knowledgebase
// ============================================================

import { fetchShelfBooks }  from "../api/bookstack.js";
import { escapeHtml, renderSkeleton, renderError } from "../utils/dom.js";
import { setStatus }        from "./topbar.js";
import CONFIG               from "../config.js";

const SECTION_ID  = "section-kb";
const CARDS_ID    = "kb-cards";
const BACK_BTN_ID = "kb-back-btn";

// ---- Page visibility ----------------------------------------

function showKbPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove("fees-active", "aml-active", "staff-active");
  main.classList.add("kb-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "kb" } }));
}

function hideKbPage() {
  document.querySelector(".main")?.classList.remove("kb-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_kb = { show: showKbPage, hide: hideKbPage };

/** Renders one department book card.
 *  Clicking dispatches hub:openBook so the in-app reader handles it.
 */
function bookCardHtml(book) {
  const name = escapeHtml(book.name || "Untitled");
  const desc = escapeHtml(book.description || "View department documentation and procedures.");

  // Derive a short tag from the book name (first word, max 10 chars)
  const tag  = escapeHtml((book.name || "").split(/[\s–-]/)[0].slice(0, 10));

  // Encode detail payload into data-attributes; the click handler dispatches the event
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

/** Fetches shelf books and re-renders the cards container. */
async function load() {
  const cardsEl = document.getElementById(CARDS_ID);
  if (!cardsEl) return;

  cardsEl.innerHTML = renderSkeleton();

  try {
    const books = await fetchShelfBooks(CONFIG.DEPARTMENTS_SHELF_ID);

    if (!books.length) {
      cardsEl.innerHTML = `
        <div class="state-box empty" role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.5" stroke-linecap="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
          <h3>No departments found.</h3>
          <p>Make sure books are assigned to the Departments shelf in BookStack.</p>
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
            <p class="section-subtitle">Department manuals, procedures and documentation</p>
          </div>
        </div>
        <a class="btn-refresh" href="${CONFIG.BASE_URL}" target="_blank" rel="noopener"
           style="text-decoration:none; color:#000;">
          Browse all &rarr;
        </a>
      </div>
      <div id="${CARDS_ID}"></div>
    </div>`;

  document.getElementById(BACK_BTN_ID)?.addEventListener("click", () => {
    hideKbPage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  await load();
}
