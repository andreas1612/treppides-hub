// ============================================================
// config.js — single source of truth for all hub configuration.
// Edit ONLY this file before deploying to production.
// Every constant marked TODO must be replaced before go-live.
// ============================================================

export default {
  // TODO: replace before deploy — swap to production BookStack base URL
  BASE_URL: "http://localhost",

  // TODO: replace before deploy — insert real BookStack API Token ID
  API_TOKEN_ID: "YOUR_TOKEN_ID",

  // TODO: replace before deploy — insert real BookStack API Token Secret
  API_TOKEN_SECRET: "YOUR_TOKEN_SECRET",

  // TODO: replace before deploy — confirm the correct Announcements book ID in BookStack
  ANNOUNCEMENTS_BOOK_ID: 1,

  // TODO: replace before deploy — confirm the correct Policies book ID in BookStack
  POLICIES_BOOK_ID: 2,

  // TODO: replace before deploy — confirm the correct Training book ID in BookStack
  TRAINING_BOOK_ID: 3,

  // TODO: replace before deploy — swap to real subdomain URLs
  DOCS_URL:     "http://localhost/docs",
  PROJECTS_URL: "http://localhost/projects",

  SEARCH_ENABLED: true,

  // TODO: set to true when VPS and BookStack are live
  ENV_LIVE: false,
};
