// ============================================================
// config.js — single source of truth for all hub configuration.
// Edit ONLY this file before deploying to production.
// Every constant marked TODO must be replaced before go-live.
// ============================================================

export default {
  // BookStack is proxied by nginx: /docs/ → localhost:6875
  BASE_URL: "http://192.168.0.221/docs",

  // BookStack API token — generated in Settings > API Tokens
  API_TOKEN_ID: "tMGusKQeZI3U7PBEuPxpxmCg7K26bDtw",
  API_TOKEN_SECRET: "LKRcyhG2sPo4kwGSIQFsSohPb9iRBfEy",

  // BookStack book IDs — confirmed against live instance
  ANNOUNCEMENTS_BOOK_ID: 58,  // Book: Announcements
  POLICIES_BOOK_ID:       3,  // Book: Compliance
  TRAINING_BOOK_ID:      59,  // Book: Training & Development

  // Quick-link destinations
  DOCS_URL:     "http://192.168.0.221/docs",
  PROJECTS_URL: "http://192.168.0.221/projects",

  SEARCH_ENABLED: true,

  // Production — disables "Coming Soon" modals and mock data
  ENV_LIVE: true,
};
