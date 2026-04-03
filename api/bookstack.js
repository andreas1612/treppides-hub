// ============================================================
// api/bookstack.js — all BookStack REST API calls.
// Components must import from here; they never call fetch() directly.
// Nginx must proxy /api/* to BookStack when deployed.
// ============================================================

import CONFIG from "../config.js";
import MOCK from "./mock.js";

const USE_MOCK = false;

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
 * Fetches all books belonging to a shelf.
 *
 * Endpoint: GET {BASE_URL}/api/shelves/{shelfId}
 *
 * @param {number} shelfId - The BookStack shelf ID.
 * @returns {Promise<Array>} Array of book objects with id, name, slug, description.
 */
export async function fetchShelfBooks(shelfId) {
  const url = `${CONFIG.BASE_URL}/api/shelves/${shelfId}`;

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`BookStack API error: HTTP ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  return json.books || [];
}

/**
 * Fetches a single book with its full contents (pages + chapters).
 *
 * Endpoint: GET {BASE_URL}/api/books/{bookId}
 *
 * @param {number} bookId - The BookStack book ID.
 * @returns {Promise<Object>} Full book object including contents array.
 */
export async function fetchBook(bookId) {
  const url = `${CONFIG.BASE_URL}/api/books/${bookId}`;

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`BookStack API error: HTTP ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetches a single chapter with its pages.
 *
 * Endpoint: GET {BASE_URL}/api/chapters/{chapterId}
 *
 * @param {number} chapterId - The BookStack chapter ID.
 * @returns {Promise<Object>} Full chapter object including pages array.
 */
export async function fetchChapter(chapterId) {
  const url = `${CONFIG.BASE_URL}/api/chapters/${chapterId}`;

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`BookStack API error: HTTP ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetches a single page including its rendered HTML content.
 *
 * Endpoint: GET {BASE_URL}/api/pages/{pageId}
 *
 * @param {number} pageId - The BookStack page ID.
 * @returns {Promise<Object>} Full page object with .html field.
 */
export async function fetchPageContent(pageId) {
  const url = `${CONFIG.BASE_URL}/api/pages/${pageId}`;

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`BookStack API error: HTTP ${response.status} ${response.statusText}`);
  }

  return response.json();
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

/**
 * Fetches all file attachments for a given page.
 *
 * Endpoint: GET {BASE_URL}/api/attachments?filter[uploaded_to]={pageId}&count=50
 *
 * @param {number} pageId - The BookStack page ID.
 * @returns {Promise<Array>} Array of attachment objects with id, name, extension.
 */
export async function fetchAttachments(pageId) {
  const url =
    `${CONFIG.BASE_URL}/api/attachments` +
    `?filter[uploaded_to]=${pageId}` +
    `&count=50`;

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`BookStack API error: HTTP ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  return json.data || [];
}

/**
 * Fetches an attachment file as a Blob using API token auth.
 * BookStack serves attachments as application/octet-stream regardless of file type,
 * so we fetch with auth and re-wrap as the correct MIME type for display.
 *
 * @param {number} attachmentId - The BookStack attachment ID.
 * @param {string} mimeType - The correct MIME type (e.g. "application/pdf").
 * @returns {Promise<string>} An object URL (blob:) safe to use as an iframe src.
 */
export async function fetchAttachmentBlob(attachmentId, mimeType) {
  const url = `${CONFIG.BASE_URL}/attachments/${attachmentId}`;

  const response = await fetch(url, {
    headers: { Authorization: authHeader() },
  });

  if (!response.ok) {
    throw new Error(`BookStack attachment error: HTTP ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const blob   = new Blob([buffer], { type: mimeType });
  return URL.createObjectURL(blob);
}
