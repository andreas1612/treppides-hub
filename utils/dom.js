// ============================================================
// utils/dom.js — shared DOM rendering helpers.
// All functions return an HTML string; callers set innerHTML.
// ============================================================

/**
 * Escapes special HTML characters to prevent XSS when inserting
 * untrusted strings into innerHTML.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#39;");
}

/**
 * Returns the HTML string for an animated skeleton loading grid
 * (3 placeholder cards).
 * @returns {string}
 */
export function renderSkeleton() {
  const card = `
    <div class="skeleton-card" aria-hidden="true">
      <div class="skel skel-tag"></div>
      <div class="skel skel-h"></div>
      <div class="skel skel-h2"></div>
      <div class="skel skel-date"></div>
      <div class="skel skel-p"></div>
      <div class="skel skel-p2"></div>
      <div class="skel skel-p"></div>
      <div class="skel skel-link"></div>
    </div>`;

  return `<div class="skeleton-grid">${card}${card}${card}</div>`;
}

/**
 * Returns the HTML string for a network/API error state.
 * @returns {string}
 */
export function renderError() {
  return `
    <div class="state-box error" role="alert">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.5" stroke-linecap="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8"  x2="12"   y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <h3>Could not reach the knowledge base.</h3>
      <p>Please check your connection or contact your administrator.</p>
    </div>`;
}

/**
 * Returns the HTML string for an empty-results state.
 * @param {string} [message] - Optional override message.
 * @returns {string}
 */
export function renderEmpty(message = "No items yet.") {
  return `
    <div class="state-box empty" role="status">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.5" stroke-linecap="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
      <h3>${escapeHtml(message)}</h3>
      <p>Check back soon — new posts will appear here automatically.</p>
    </div>`;
}
