// ============================================================
// api/bookstack.js — all BookStack REST API calls.
// Components must import from here; they never call fetch() directly.
// Nginx must proxy /api/* to BookStack when deployed.
// ============================================================

import CONFIG from "../config.js";
import MOCK from "./mock.js";

// TODO: set to false when BookStack is live
const USE_MOCK = true;

/** Simulated network delay so skeleton loading states are visible during local dev. */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Shared auth header value, built from config constants. */
function authHeader() {
  // TODO: replace before deploy — token credentials come from config.js
  return `Token ${CONFIG.API_TOKEN_ID}:${CONFIG.API_TOKEN_SECRET}`;
}

/**
 * Fetches the most-recently-updated pages from a specific BookStack book.
 *
 * Endpoint: GET {BASE_URL}/api/pages
 *           ?filter[book_id]={bookId}&sort=-updated_at&count={count}
 *
 * Nginx must proxy /api/* to BookStack when deployed.
 *
 * @param {number} bookId - The BookStack book ID to filter by.
 * @param {number} [count=3] - Maximum number of pages to return.
 * @returns {Promise<Array>} Array of page objects from BookStack.
 */
export async function fetchPages(bookId, count = 3) {
  if (USE_MOCK) {
    await delay(600);
    const map = {
      [CONFIG.ANNOUNCEMENTS_BOOK_ID]: MOCK.announcements.data,
      [CONFIG.POLICIES_BOOK_ID]:      MOCK.policies.data,
      [CONFIG.TRAINING_BOOK_ID]:      MOCK.training.data,
    };
    return (map[bookId] || []).slice(0, count);
  }

  const url =
    `${CONFIG.BASE_URL}/api/pages` +
    `?filter[book_id]=${bookId}` +
    `&sort=-updated_at` +
    `&count=${count}`;

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`BookStack API error: HTTP ${response.status} ${response.statusText}`);
  }

  // BookStack returns { data: [...pages], total: N }
  const json = await response.json();
  return json.data || [];
}

/**
 * Full-text search across BookStack content.
 *
 * Endpoint: GET {BASE_URL}/api/search?query={query}&count=10
 *
 * Nginx must proxy /api/* to BookStack when deployed.
 *
 * @param {string} query - Search term.
 * @returns {Promise<Array>} Array of search result objects from BookStack.
 */
export async function searchPages(query) {
  if (USE_MOCK) {
    await delay(600);
    const all = [
      ...MOCK.announcements.data,
      ...MOCK.policies.data,
      ...MOCK.training.data,
    ];
    const q = query.toLowerCase();
    return all.filter(p => p.name.toLowerCase().includes(q));
  }

  const url =
    `${CONFIG.BASE_URL}/api/search` +
    `?query=${encodeURIComponent(query)}` +
    `&count=10`;

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`BookStack search error: HTTP ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  return json.data || [];
}
