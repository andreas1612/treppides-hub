# PROJECT_BRIEF — Treppides Hub
> Paste this file at the start of a new chat and say "continue the Treppides Hub project"

**Status: FRONTEND COMPLETE — DEMO READY**
**Blocked on: VPS provisioning by IT**

---

## Project

**Name:** Treppides Company Hub
**Owner:** Andreas Pieri
**Purpose:** Self-hosted internal company portal that replaces SharePoint. Staff land here daily. Pulls live announcements, policies, and training materials from a BookStack wiki via REST API. Links out to a project management tool (OpenProject/Taiga). Runs on a dedicated VPS behind Nginx; currently in local development (localhost). Proposal doc: `Hub_Proposal_v3.docx` in project root.

---

## Tech Stack & Constraints

- **Zero dependencies** — no npm, no frameworks, no build step
- **ES modules** throughout — all `.js` files use `import`/`export`
- **Vanilla HTML + CSS + JS only**
- **Single HTML shell** — `index.html` has no logic; it only loads CSS and `main.js`
- **Python `http.server`** used for local dev (`python -m http.server 8080`)
- **Backend:** BookStack (PHP/Laravel/MySQL) — not yet running locally
- **Reverse proxy:** Nginx (not yet configured) — must proxy `/api/*` → BookStack when deployed
- **Target OS:** Ubuntu Server LTS on VPS (not yet provisioned)
- **Containerisation:** Docker (not yet configured)
- **SSL:** Let's Encrypt via Nginx (not yet configured)
- **Project management tool:** OpenProject (preferred) or Taiga — not yet deployed

---

## File Structure

```
hub/
├── index.html                  Shell only — 4 <link> tags + mount divs + <script type="module">
├── main.js                     Entry point — imports + boots all components via Promise.allSettled
├── config.js                   Single config export — all constants, all TODOs live here
├── PROJECT_BRIEF.md            This file
├── Hub_Proposal_v3.docx        Original technical proposal (reference only)
│
├── components/
│   ├── sidebar.js              Fixed left nav + mobile top bar/burger — mounts into #sidebar, #mobile-header
│   ├── topbar.js               Sticky desktop header + setStatus() export — mounts into #topbar
│   ├── announcements.js        Latest Announcements feed — mounts into #section-announcements
│   ├── policies.js             Policies & Procedures feed — mounts into #section-policies
│   ├── training.js             Training & Development feed — mounts into #section-training
│   └── quicklinks.js           Quick-access widget row (KB, Projects, IT Support) — mounts into #section-quicklinks
│
├── api/
│   └── bookstack.js            All BookStack API calls: fetchPages(), searchPages() stub
│
├── utils/
│   ├── dom.js                  escapeHtml(), renderSkeleton(), renderError(), renderEmpty()
│   └── format.js               formatDate(), excerptFromHtml()
│
└── styles/
    ├── theme.css               CSS custom properties ONLY — rebranding file, touch this to retheme
    ├── base.css                Reset, html/body, a defaults
    ├── layout.css              App shell, sidebar, topbar, main area, mobile responsive
    └── cards.css               Cards, skeleton, state boxes, widget row, refresh button, animations
```

---

## Component Status

| File | Status | Notes |
|---|---|---|
| `index.html` | **Working** | Complete shell, no issues |
| `main.js` | **Working** | Boot sequence correct, isolation via allSettled |
| `config.js` | **Working** | All placeholders present, all marked TODO |
| `styles/theme.css` | **Working** | Variables only; `--brand-green` / `--brand-green-dk` defined but unused |
| `styles/base.css` | **Working** | Complete |
| `styles/layout.css` | **Working** | Complete; `.logo-globe` CSS class is dead (SVG uses inline attrs) |
| `styles/cards.css` | **Working** | Complete |
| `components/sidebar.js` | **Working** | SVG globe logo placeholder; Coming Soon modal active while `ENV_LIVE` is false |
| `components/topbar.js` | **Working** | Renders; exports `setStatus(text, isError)` |
| `components/announcements.js` | **Working** | Full fetch/skeleton/error/empty/refresh cycle; calls setStatus() |
| `components/policies.js` | **Working** | Same pattern as announcements; calls setStatus() |
| `components/training.js` | **Working** | Same pattern as announcements; calls setStatus() |
| `components/quicklinks.js` | **Working** | Coming Soon modal active while `ENV_LIVE` is false |
| `api/bookstack.js` | **Working** | fetchPages() and searchPages() both complete |
| `utils/dom.js` | **Working** | All four helpers complete |
| `utils/format.js` | **Working** | excerptFromHtml calls document.createElement — browser-only |

---

## Mock Data Layer

| Item | Detail |
|---|---|
| File | `api/mock.js` — realistic Treppides-flavoured content for all three sections |
| Shape | Matches BookStack API response exactly: `{ data: [...], total: N }` with `id`, `name`, `updated_at`, `url`, `preview_html.content` |
| Control | `USE_MOCK` constant at top of `api/bookstack.js` — `true` for local dev, `false` for production |
| Delay | 600ms simulated delay in mock path so skeleton loading states are visible and testable |
| Search | Mock `searchPages()` filters all items by name substring match |
| Switch-off | Set `USE_MOCK = false` in `api/bookstack.js` when BookStack environment is ready |

---

## Flag Reference

Three feature flags control environment behaviour. All live in `config.js`. All default to development state.

| Flag | Dev value | Live value | Controls |
|---|---|---|---|
| `USE_MOCK` | `true` | `false` | Mock data vs real BookStack API |
| `ENV_LIVE` | `false` | `true` | Coming Soon modal vs real links |
| `SEARCH_ENABLED` | `true` | `true` | Search UI visibility |

To go live: set `USE_MOCK=false`, `ENV_LIVE=true` in `config.js`.
`SEARCH_ENABLED` stays `true` in both environments.

---

## Handoff Triggers

Steps required before handing off to IT / going live:

1. Provision Ubuntu Server LTS VPS and configure firewall + SSH key access
2. Deploy BookStack + MariaDB via Docker Compose; confirm admin login
3. Configure Nginx reverse proxy with SSL (Let's Encrypt); test `/api/*` → BookStack routing
4. Insert real `API_TOKEN_ID`, `API_TOKEN_SECRET`, book IDs, `DOCS_URL`, `PROJECTS_URL` in `config.js`
5. Confirm BookStack book slugs for policies and training (TODOs #14, #15)
6. Flip `USE_MOCK=false` and `ENV_LIVE=true` in `config.js` to activate live mode — no other changes needed

---

## BookStack API Reference

```
GET {BASE_URL}/api/pages
    ?filter[book_id]={id}&sort=-updated_at&count=3
Headers: Authorization: Token {TOKEN_ID}:{TOKEN_SECRET}

Response: { data: [ { id, name, updated_at, url, preview_html: { content } } ], total }

GET {BASE_URL}/api/search?query={q}&count=10
```

---

## TODOs — Must Replace Before Deploy

All sourced from `config.js` unless noted.

| # | File | Placeholder | Action |
|---|---|---|---|
| 1 | `config.js` | `BASE_URL = "http://localhost"` | Swap to `https://hub.company.com` (domain TBC) |
| 2 | `config.js` | `API_TOKEN_ID = "YOUR_TOKEN_ID"` | Insert real BookStack API token ID |
| 3 | `config.js` | `API_TOKEN_SECRET = "YOUR_TOKEN_SECRET"` | Insert real BookStack API token secret |
| 4 | `config.js` | `ANNOUNCEMENTS_BOOK_ID = 1` | Confirm correct book ID in BookStack |
| 5 | `config.js` | `POLICIES_BOOK_ID = 2` | Confirm correct book ID in BookStack |
| 6 | `config.js` | `TRAINING_BOOK_ID = 3` | Confirm correct book ID in BookStack |
| 7 | `config.js` | `DOCS_URL = "http://localhost/docs"` | Swap to `https://docs.company.com` |
| 8 | `config.js` | `PROJECTS_URL = "http://localhost/projects"` | Swap to `https://projects.company.com` |
| 9 | `config.js` | `SEARCH_ENABLED = false` | ~~Enable when BookStack search confirmed working~~ **Done** — set to true 2026-03-24; controls search UI only |
| 18 | `config.js` | `ENV_LIVE = false` | Set to true when VPS and BookStack are live — activates real navigation links and disables Coming Soon modals |
| 10 | `components/sidebar.js` | SVG globe logo | Replace with `<img>` of actual Treppides logo asset |
| 11 | `components/sidebar.js` | `mailto:it@treppides.com` | Confirm real IT support address |
| 12 | `components/sidebar.js` | `v0.1.0` | Update version string on each release |
| 13 | `components/quicklinks.js` | `mailto:it@treppides.com` | Same as #11 |
| 14 | `components/policies.js` | Fallback URL slug `books/policies/page/` | Confirm BookStack book slug |
| 15 | `components/training.js` | Fallback URL slug `books/training/page/` | Confirm BookStack book slug |
| 16 | `styles/theme.css` | Colour palette | ~~Confirm final approved Treppides brand colours~~ **Done** — live values applied 2026-03-24 |
| 17 | `api/bookstack.js` | `searchPages()` stub | ~~Implement real search API call~~ **Done** — real implementation + search UI in topbar, 2026-03-24 |

---

## Bugs

| # | Severity | Status | Description |
|---|---|---|---|
| 1 | Medium | **Fixed** | Refresh spinner: `.loading` class was added to `<svg>` instead of `<button>`; CSS selector requires it on the button. Fixed in all 3 content components. |
| 2 | Low | **Fixed** | `policies.js` and `training.js` did not call `setStatus()` on API error. Now import and call `setStatus("Knowledge base unreachable", true)` in catch block. |
| 3 | Low | **Fixed** | Phone SVG `d` attribute split across lines in template literal — collapsed to single line in `sidebar.js`. |
| 4 | Low | **Fixed** | No favicon — added `favicon.svg` to `hub/` root and `<link rel="icon">` to `index.html`. |
| 5 | Low | **Open** | `excerptFromHtml()` in `utils/format.js` calls `document.createElement` — works in browser only; would break in Node/SSR context. |
| 6 | Info | **Open** | Nav active state hardcoded on Home link. No routing — active class never updates. Acceptable for single-page portal. |
| 7 | Info | **Open** | `--brand-green` and `--brand-green-dk` CSS vars defined in `theme.css` but not consumed by any rule. Reserved for future use. |

---

## Decisions Made

| Decision | Chosen | Rejected / Deferred | Reason |
|---|---|---|---|
| Wiki / KB platform | **BookStack** | Wiki.js | Better WYSIWYG, LDAP/SAML out of box, Draw.io built in, stable API |
| Project management | **OpenProject** (preferred) | Taiga, Jira | 14k+ GitHub stars, full Gantt/Agile/time-tracking, self-hosted |
| Reverse proxy | **Nginx** | Apache, Caddy | Standard, well-documented, subdomain routing straightforward |
| SSL | **Let's Encrypt** | Self-signed, paid cert | Auto-renewing, zero cost |
| Containerisation | **Docker** | Bare metal | Isolation, easy backup/restore, portable |
| VPN | **Deferred** | WireGuard | Not yet required; firewall + SSH key-pair sufficient for now |
| OS | **Ubuntu Server LTS** | Other Linux, Windows Server | Implied by proposal; not yet provisioned |
| Frontend build | **None** | Vite, Webpack, etc. | Constraint: zero dependencies, no build step |
| Domain | **TBC** | `hub.treppides.com` (likely) | Pending budget approval; `company.com` is placeholder in proposal |
| Deployment | **localhost only** | Production VPS | VPS not yet provisioned or budgeted |
| Auth | **BookStack native → LDAP/SSO later** | — | Phase 2; LDAP/SAML/MFA planned post-launch |
| Localhost dead links | **Coming Soon modal** | Dead link / disabled state | Knowledge Base and Projects links intercept click and show modal when `ENV_LIVE = false`. Set `ENV_LIVE = true` in `config.js` when backend is live to restore normal navigation. |

---

## Done — Completed Features

1. ~~**Retheme**~~ — `theme.css` updated to confirmed Treppides brand colours (2026-03-24)
2. ~~**Favicon**~~ — `favicon.svg` added; `<link rel="icon">` in `index.html` (2026-03-24)
3. ~~**Search**~~ — `searchPages()` implemented; search input + dropdown in topbar; `SEARCH_ENABLED = true` (2026-03-24)

## Next Features — Priority Order

1. **User identity in topbar** — show logged-in user name (requires BookStack auth session or SSO token)
2. **Active nav routing** — update active class when linking between sections (or scroll-spy)
3. **Nginx config** — write `nginx.conf` for subdomain routing + `/api/*` proxy to BookStack
4. **Docker Compose** — define services: BookStack, MariaDB, Nginx, hub static files
5. **Favicon + brand assets** — final Treppides logo PNG/SVG; replace SVG globe placeholder
6. **LDAP/SSO auth** — integrate with company directory; configure BookStack LDAP settings
10. **Test environment** — mirror production at `test-docs.company.com` / `test-projects.company.com`
11. **`searchPages()` full implementation** — after BookStack confirmed working in environment

---

## Branding Reference

> **Status: confirmed live** — values below match `styles/theme.css` as of 2026-03-24 (TODO #16 Done).

| CSS Variable | Value | Usage |
|---|---|---|
| `--sidebar-bg` | `#0a0a0a` | Sidebar bg, mobile bar |
| `--sidebar-text` | `#a0aec0` | Sidebar nav text |
| `--sidebar-active` | `#ffffff` | Active nav item text |
| `--sidebar-width` | `220px` | Sidebar width |
| `--accent` | `#c8d400` | Accent, active states, buttons |
| `--accent-hover` | `#a8b300` | Accent hover state |
| `--brand-green` | `#c8d400` | Brand lime (alias of accent) |
| `--brand-green-dk` | `#a8b300` | Brand lime dark (alias of accent-hover) |
| `--card-bg` | `#ffffff` | Card background, text on dark |
| `--page-bg` | `#f5f5f5` | Main content background |
| `--border` | `#e2e8f0` | Card borders |
| `--text-primary` | `#1a202c` | Body text |
| `--text-secondary` | `#718096` | Subtitles, meta text |
| `--radius` | `8px` | Border radius |
| `--shadow` | `0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.06)` | Card shadow |
| `--shadow-hover` | `0 4px 16px rgba(0,0,0,.13), 0 8px 24px rgba(0,0,0,.08)` | Card hover shadow |
| `--transition` | `.2s ease` | Default transition |

Font: `system-ui, -apple-system, 'Segoe UI', Arial, sans-serif` (no web font loaded)
