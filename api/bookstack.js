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
    credentials: "omit",
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
    credentials: "omit",
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
    credentials: "omit",
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
    credentials: "omit",
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
    credentials: "omit",
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
    credentials: "omit",
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
    credentials: "omit",
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
 * Creates a new page in a BookStack book.
 *
 * Endpoint: POST {BASE_URL}/api/pages
 * Body: { book_id, name, html }
 *
 * @param {number} bookId       - The BookStack book ID to publish into.
 * @param {string} title        - The page title.
 * @param {string} htmlContent  - HTML body for the page.
 * @returns {Promise<Object>} The newly created page object from BookStack.
 */
export async function createPage(bookId, title, htmlContent) {
  const url = `${CONFIG.BASE_URL}/api/pages`;

  const response = await fetch(url, {
    method: "POST",
    credentials: "omit",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ book_id: bookId, name: title, html: htmlContent }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`BookStack API error: HTTP ${response.status} — ${text}`);
  }

  return response.json();
}

/**
 * Deletes a page by ID.
 *
 * Endpoint: DELETE {BASE_URL}/api/pages/{pageId}
 *
 * @param {number} pageId - The BookStack page ID to delete.
 * @returns {Promise<void>}
 */
export async function deletePage(pageId) {
  const response = await fetch(`${CONFIG.BASE_URL}/api/pages/${pageId}`, {
    method: "DELETE",
    credentials: "omit",
    headers: { Authorization: authHeader() },
  });
  if (!response.ok) {
    throw new Error(`BookStack API error: HTTP ${response.status} ${response.statusText}`);
  }
}

/**
 * Uploads a file as an attachment linked to a specific page.
 *
 * Endpoint: POST {BASE_URL}/api/attachments (multipart/form-data)
 *
 * @param {number} pageId - The BookStack page ID to attach the file to.
 * @param {string} name   - Display name for the attachment.
 * @param {File}   file   - The File object to upload.
 * @returns {Promise<Object>} The created attachment object.
 */
export async function uploadAttachment(pageId, name, file) {
  const form = new FormData();
  form.append("uploaded_to", pageId);
  form.append("name", name);
  form.append("file", file);

  const response = await fetch(`${CONFIG.BASE_URL}/api/attachments`, {
    method: "POST",
    credentials: "omit",
    headers: { Authorization: authHeader() },
    // Do NOT set Content-Type — browser sets it with the correct boundary for FormData
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Attachment upload error: HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
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
    credentials: "omit",
    headers: { Authorization: authHeader() },
  });

  if (!response.ok) {
    throw new Error(`BookStack attachment error: HTTP ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const blob   = new Blob([buffer], { type: mimeType });
  return URL.createObjectURL(blob);
}
