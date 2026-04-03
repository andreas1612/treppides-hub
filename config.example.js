// ============================================================
// config.example.js — template for config.js
// Copy this file to config.js and fill in real values.
// config.js is in .gitignore and must NEVER be committed.
// ============================================================

export default {
  // Full URL to your BookStack instance as proxied by nginx.
  // nginx must proxy /docs/* → BookStack.  All other URLs are derived from this.
  BASE_URL: "http://YOUR_SERVER_IP/docs",

  // BookStack API token — generate in BookStack: Settings > API Tokens
  // Use a READ-ONLY token where possible.
  API_TOKEN_ID: "YOUR_TOKEN_ID",
  API_TOKEN_SECRET: "YOUR_TOKEN_SECRET",

  // BookStack shelf ID containing all department books (Knowledge Base)
  DEPARTMENTS_SHELF_ID: 0,

  // BookStack book IDs for the three dashboard feeds
  ANNOUNCEMENTS_BOOK_ID: 0,
  POLICIES_BOOK_ID: 0,
  TRAINING_BOOK_ID: 0,

  // Quick-link destinations shown in the sidebar and quicklinks widget
  DOCS_URL:     "http://YOUR_SERVER_IP/docs",
  PROJECTS_URL: "http://YOUR_SERVER_IP/projects",

  SEARCH_ENABLED: true,

  // Set to true when BookStack and all backend services are live.
  // false = "Coming Soon" modals on undeployed links.
  ENV_LIVE: false,
};
