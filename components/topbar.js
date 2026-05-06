// ============================================================
// components/topbar.js
// Renders the sticky desktop header bar.
// Mounts into: #topbar
// ============================================================

import CONFIG from "../config.js";
import { searchPages } from "../api/bookstack.js";

const SEARCH_STYLES = `
  .search-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }
  #search-input {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card-bg);
    color: var(--text-primary);
    font-size: .85rem;
    width: 220px;
    outline: none;
    transition: border-color var(--transition), opacity var(--transition);
  }
  #search-input:focus {
    border-color: var(--accent);
  }
  #search-input.searching {
    opacity: .5;
    animation: search-pulse .8s ease-in-out infinite alternate;
  }
  @keyframes search-pulse {
    from { opacity: .5; }
    to   { opacity: .9; }
  }
  #search-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    width: 340px;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-hover);
    z-index: 200;
    overflow: hidden;
  }
  #search-dropdown .sd-item {
    display: block;
    padding: 10px 14px;
    text-decoration: none;
    color: var(--text-primary);
    border-bottom: 1px solid var(--border);
    transition: background var(--transition);
    cursor: pointer;
  }
  #search-dropdown .sd-item:last-child {
    border-bottom: none;
  }
  #search-dropdown .sd-item:hover {
    background: var(--page-bg);
  }
  #search-dropdown .sd-title {
    font-size: .88rem;
    font-weight: 600;
    display: block;
  }
  #search-dropdown .sd-book {
    font-size: .78rem;
    color: var(--text-secondary);
    display: block;
    margin-top: 2px;
  }
  #search-dropdown .sd-msg {
    padding: 12px 14px;
    font-size: .85rem;
    color: var(--text-secondary);
  }
`;

function injectStyles() {
  if (document.getElementById("topbar-search-styles")) return;
  const style = document.createElement("style");
  style.id = "topbar-search-styles";
  style.textContent = SEARCH_STYLES;
  document.head.appendChild(style);
}

function openDropdown(html) {
  const dd = document.getElementById("search-dropdown");
  if (dd) { dd.innerHTML = html; dd.hidden = false; }
}

function closeDropdown() {
  const dd = document.getElementById("search-dropdown");
  if (dd) dd.hidden = true;
}

function renderResults(results) {
  if (!results.length) {
    return `<div class="sd-msg">No results found</div>`;
  }
  return results.slice(0, 5).map((r, i) => `
    <div class="sd-item" role="button" tabindex="0" data-idx="${i}">
      <span class="sd-title">${r.name || r.title || "Untitled"}</span>
      <span class="sd-book">${r.book_title || r.book?.name || ""}</span>
    </div>`).join("");
}

function attachResultHandlers(results) {
  const dd = document.getElementById("search-dropdown");
  if (!dd) return;
  dd.querySelectorAll(".sd-item").forEach(el => {
    const r = results[parseInt(el.dataset.idx, 10)];
    const open = () => {
      closeDropdown();
      document.getElementById("search-input").value = "";
      if (window.__hub_reader && r.id && r.book?.id) {
        window.__hub_fees?.hide();
        window.__hub_reader.openPage(r.id, r.name || "Untitled", r.book.id, r.book.name || "");
      }
    };
    el.addEventListener("click", open);
    el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") open(); });
  });
}

function setupSearch() {
  const input = document.getElementById("search-input");
  if (!input) return;

  let timer;

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { closeDropdown(); return; }

    timer = setTimeout(async () => {
      input.classList.add("searching");
      try {
        const results = await searchPages(q);
        openDropdown(renderResults(results));
        attachResultHandlers(results);
      } catch {
        openDropdown(`<div class="sd-msg">Search unavailable</div>`);
      } finally {
        input.classList.remove("searching");
      }
    }, 400);
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeDropdown(); input.blur(); }
  });

  document.addEventListener("click", e => {
    const wrap = document.querySelector(".search-wrap");
    if (wrap && !wrap.contains(e.target)) closeDropdown();
  });
}

/**
 * Initialises and renders the desktop top header bar.
 * The status label text is updated externally via the exported
 * setStatus() helper (called by other components on fetch events).
 *
 * @param {object} _config - Hub config (reserved for future use).
 */
export default async function init(_config) {
  const el = document.getElementById("topbar");
  if (!el) return;

  if (CONFIG.SEARCH_ENABLED) injectStyles();

  const searchHtml = CONFIG.SEARCH_ENABLED ? `
    <div class="search-wrap">
      <input type="search" id="search-input" placeholder="Search knowledge base..." autocomplete="off" />
      <div id="search-dropdown" hidden></div>
    </div>` : "";

  el.innerHTML = `
    <div class="topbar-left">
      <h1>Company Hub</h1>
      <p>Internal Portal &nbsp;·&nbsp; Welcome back</p>
    </div>
    <div class="topbar-right">
      ${searchHtml}
      <div class="badge-status">
        <span class="dot" id="status-dot"></span>
        <span id="status-label">All systems operational</span>
      </div>
    </div>`;

  if (CONFIG.SEARCH_ENABLED) setupSearch();
}

/**
 * Updates the status badge text in the top bar.
 * Pass isError=true to switch the dot to red.
 * @param {string} text
 * @param {boolean} [isError=false]
 */
export function setStatus(text, isError = false) {
  const label = document.getElementById("status-label");
  const dot   = document.getElementById("status-dot");
  if (label) label.textContent = text;
  if (dot)   dot.style.background = isError ? "#e53e3e" : "#48bb78";
}
