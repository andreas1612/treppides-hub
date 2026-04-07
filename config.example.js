// ============================================================
// config.example.js — template for config.js
// Copy this file to config.js and fill in real values.
// config.js is in .gitignore and must NEVER be committed.
// ============================================================

export default {
  // BookStack is proxied by nginx: /docs/ → localhost:6875
  BASE_URL: "http://192.168.0.221/docs",

  // BookStack API token — generate in BookStack: Settings > API Tokens
  // ⚠ Fill in real values — DO NOT commit config.js to git
  API_TOKEN_ID: "--BOOKSTACK-TOKEN-ID--",
  API_TOKEN_SECRET: "--BOOKSTACK-TOKEN-SECRET--",

  // BookStack shelf ID containing all department books
  DEPARTMENTS_SHELF_ID: 57,

  // BookStack book IDs — confirmed against live instance
  ANNOUNCEMENTS_BOOK_ID: 58,  // Book: Announcements
  POLICIES_BOOK_ID:       3,  // Book: Compliance
  TRAINING_BOOK_ID:      59,  // Book: Training & Development

  // Quick-link destinations
  DOCS_URL:     "http://192.168.0.221/docs",
  PROJECTS_URL: "http://192.168.0.221/projects",

  SEARCH_ENABLED: true,

  // Set to true when BookStack and all backend services are live.
  ENV_LIVE: true,
};
