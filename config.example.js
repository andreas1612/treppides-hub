// ============================================================
// config.example.js — template for config.js
// Copy this file to config.js and fill in real values.
// config.js is in .gitignore and must NEVER be committed.
// ============================================================

export default {
  // BookStack is proxied by nginx: /docs/ → localhost:6875
  BASE_URL: "/docs",

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
  PROJECTS_URL: "https://tasks.treppides.com",

  SEARCH_ENABLED: true,

  // Set to true when BookStack and all backend services are live.
  ENV_LIVE: true,

  // Admin panel PIN — shared single PIN for all admins.
  // Used by components/admin.js to gate in-page content publishing.
  // ⚠ Keep this out of git — fill in config.js only, never config.example.js
  ADMIN_PIN: "--ADMIN-PIN--",

  // IT Support ticket email — FormSubmit forwards submissions here.
  // First submission triggers a one-time confirmation email from FormSubmit;
  // click the activation link once, then all tickets will be forwarded.
  // ⚠ Fill in config.js only
  SUPPORT_EMAIL: "--SUPPORT-EMAIL--",

  // ClickUp Fees Aggregator API — Python backend (FastAPI)
  // Set to the host:port where api/clickup/server.py is running
  // ⚠ Fill in config.js only
  CLICKUP_FEES_API: "--CLICKUP-FEES-API-URL--",

  // WiseBOS-Next — external tool, FULL/SUPER tier only. Own port (not a path
  // under this domain) because WiseBOS uses root-absolute paths baked into
  // its HTML; gated by nginx (RoleService.isFull() via /api/me/gate/full),
  // not embedded — the hub just redirects here.
  WISEBOS_URL: "--WISEBOS-URL--",
};
