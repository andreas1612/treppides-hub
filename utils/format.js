// ============================================================
// utils/format.js — pure formatting helpers, no DOM access.
// ============================================================

/**
 * Formats an ISO 8601 date string as "DD MMM YYYY".
 * @param {string} iso
 * @returns {string}
 */
export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day:   "2-digit",
    month: "short",
    year:  "numeric",
  });
}

/**
 * Strips all HTML tags from a string and truncates to maxLen characters,
 * appending an ellipsis if the text was truncated.
 * @param {string} html
 * @param {number} maxLen
 * @returns {string}
 */
export function excerptFromHtml(html, maxLen = 150) {
  if (!html) return "";
  const tmp  = document.createElement("div");
  tmp.innerHTML = html;
  const text = (tmp.textContent || tmp.innerText || "").replace(/\s+/g, " ").trim();
  return text.length > maxLen ? text.slice(0, maxLen).trimEnd() + "…" : text;
}
