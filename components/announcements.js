// ============================================================
// components/announcements.js
// Renders the Latest Announcements section with live BookStack data.
// Mounts into: #section-announcements
// ============================================================

import { fetchPages }      from "../api/bookstack.js";
import { formatDate, excerptFromHtml } from "../utils/format.js";
import { escapeHtml, renderSkeleton, renderError, renderEmpty } from "../utils/dom.js";
import { setStatus }       from "./topbar.js";
import CONFIG              from "../config.js";

const SECTION_ID  = "section-announcements";
const CARDS_ID    = "announcements-cards";
const REFRESH_ID  = "announcements-refresh";
const TAG_LABEL   = "Announcement";

/** Renders one announcement card. */
function cardHtml(page) {
  const url     = page.url  || `${CONFIG.BASE_URL}/books/announcements/page/${page.id}`;
  const title   = page.name || "Untitled";
  const date    = formatDate(page.updated_at);
  const excerpt = excerptFromHtml(page.preview_html?.content || "", 150);

  return `
    <article class="card">
      <span class="card-tag">${TAG_LABEL}</span>
      <h3 class="card-title">
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener">
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
        <a class="card-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">
          Read more &rarr;
        </a>
      </div>
    </article>`;
}

/** Fetches announcements and re-renders the cards container. */
async function load() {
  const cardsEl  = document.getElementById(CARDS_ID);
  const refreshBtn = document.getElementById(REFRESH_ID);
  if (!cardsEl) return;

  // Loading state
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add("loading");
  }
  cardsEl.innerHTML = renderSkeleton();
  setStatus("Refreshing…");

  try {
    // Nginx must proxy /api/* to BookStack when deployed
    const pages = await fetchPages(CONFIG.ANNOUNCEMENTS_BOOK_ID, 3);

    if (!pages.length) {
      cardsEl.innerHTML = renderEmpty("No announcements yet.");
    } else {
      cardsEl.innerHTML = `<div class="cards-grid">${pages.map(cardHtml).join("")}</div>`;
    }

    setStatus("All systems operational");
  } catch (err) {
    console.error("[Hub] announcements fetch error:", err);
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
 * Initialises the Announcements section.
 * @param {object} _config - Hub config (values read from config.js internally).
 */
export default async function init(_config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  section.innerHTML = `
    <div class="hub-section">
      <div class="section-header">
        <div>
          <h2 class="section-title">Latest Announcements</h2>
          <p class="section-subtitle">Pulled live from the knowledge base</p>
        </div>
        <button class="btn-refresh" id="${REFRESH_ID}" aria-label="Refresh announcements">
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

  // Auto-fetch on init
  await load();
}
