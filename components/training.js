// ============================================================
// components/training.js
// Renders the Training & Development section with live BookStack data.
// Mounts into: #section-training
// ============================================================

import { fetchPages }      from "../api/bookstack.js";
import { formatDate, excerptFromHtml } from "../utils/format.js";
import { escapeHtml, renderSkeleton, renderError, renderEmpty } from "../utils/dom.js";
import { setStatus }       from "./topbar.js";
import CONFIG              from "../config.js";

const SECTION_ID = "section-training";
const CARDS_ID   = "training-cards";
const REFRESH_ID = "training-refresh";
const TAG_LABEL  = "Training";

/** Renders one training card. */
function cardHtml(page) {
  const title   = page.name || "Untitled";
  const date    = formatDate(page.updated_at);
  const excerpt = excerptFromHtml(page.preview_html?.content || "", 150);

  return `
    <article class="card">
      <span class="card-tag">${TAG_LABEL}</span>
      <h3 class="card-title">
        <a class="reader-link" href="#"
           data-page-id="${page.id}"
           data-page-name="${escapeHtml(title)}"
           data-book-id="${CONFIG.TRAINING_BOOK_ID}"
           data-book-name="Training &amp; Development">
          ${escapeHtml(title)}
        </a>
      </h3>
      <div class="card-date">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2"  x2="16" y2="6"/>
          <line x1="8"  y1="2"  x2="8"  y2="6"/>
          <line x1="3"  y1="10" x2="21" y2="10"/>
        </svg>
        ${escapeHtml(date)}
      </div>
      ${excerpt ? `<p class="card-excerpt">${escapeHtml(excerpt)}</p>` : ""}
      <div class="card-footer">
        <a class="card-link reader-link" href="#"
           data-page-id="${page.id}"
           data-page-name="${escapeHtml(title)}"
           data-book-id="${CONFIG.TRAINING_BOOK_ID}"
           data-book-name="Training &amp; Development">
          Read more &rarr;
        </a>
      </div>
    </article>`;
}

/** Fetches training materials and re-renders the cards container. */
async function load() {
  const cardsEl    = document.getElementById(CARDS_ID);
  const refreshBtn = document.getElementById(REFRESH_ID);
  if (!cardsEl) return;

  // Loading state
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add("loading");
  }
  cardsEl.innerHTML = renderSkeleton();

  try {
    // Nginx must proxy /api/* to BookStack when deployed
    // TODO: replace before deploy — confirm CONFIG.TRAINING_BOOK_ID is correct
    const pages = await fetchPages(CONFIG.TRAINING_BOOK_ID, 3);

    if (!pages.length) {
      cardsEl.innerHTML = renderEmpty("No training materials published yet.");
    } else {
      cardsEl.innerHTML = `<div class="cards-grid">${pages.map(cardHtml).join("")}</div>`;
    }
  } catch (err) {
    console.error("[Hub] training fetch error:", err);
    cardsEl.innerHTML = renderError();
    setStatus("Knowledge base unreachable", true);
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove("loading");
    }
  }
}

/**
 * Initialises the Training & Development section.
 * @param {object} _config - Hub config (values read from config.js internally).
 */
export default async function init(_config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  section.innerHTML = `
    <div class="hub-section">
      <div class="section-header">
        <div>
          <h2 class="section-title">Training &amp; Development</h2>
          <p class="section-subtitle">
            Onboarding materials, guides and learning resources
          </p>
        </div>
        <button class="btn-refresh" id="${REFRESH_ID}" aria-label="Refresh training materials">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Refresh
        </button>
      </div>
      <!-- Nginx must proxy /api/* to BookStack when deployed -->
      <div id="${CARDS_ID}"></div>
    </div>`;

  document.getElementById(REFRESH_ID)?.addEventListener("click", load);

  section.addEventListener("click", e => {
    const link = e.target.closest(".reader-link");
    if (!link) return;
    e.preventDefault();
    window.__hub_reader?.openPage(
      parseInt(link.dataset.pageId, 10),
      link.dataset.pageName,
      parseInt(link.dataset.bookId, 10),
      link.dataset.bookName
    );
  });

  // Auto-fetch on init
  await load();
}
