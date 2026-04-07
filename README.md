# Treppides Employee Hub

**Status: LIVE IN PRODUCTION**
**Server: 192.168.0.221 (tech-srv)**
**Last updated: 2026-04-07 (session 3)**

Internal company portal for daily access to announcements, policies, training materials, and the knowledge base. Backed by a self-hosted BookStack instance. Includes a full in-app content reader — staff can browse and read all department books without leaving the Hub.

---

## Session Log — Pick Up From Here

### Session 2026-04-07 (3) — Admin panel + IT Support ticket modal

**New files:** `components/admin.js`, `components/support.js`, `styles/modals.css`

**Admin panel (`components/admin.js`):**
- Subtle **Admin** button in the sidebar footer (person+ icon)
- PIN dialog on first click — correct PIN cached in `sessionStorage` for the session
- **Add Content** modal: Section dropdown, Title, plain-text Content → publishes a new BookStack page via `POST /api/pages`
- No code or BookStack login needed for content authors

**IT Support ticket modal (`components/support.js`):**
- Replaces all `mailto:` IT Support links across sidebar (desktop + mobile) and quicklinks widget
- Fields: Name, Email, Issue Category, Description
- Submits via **FormSubmit** AJAX → email forwarded to `SUPPORT_EMAIL` in `config.js`
- Inline spinner, success confirmation, and error fallback

**Other changes:**
- `api/bookstack.js` — added `createPage(bookId, title, htmlContent)` (9th function)
- `styles/modals.css` — shared modal styles (backdrop, card, form fields, PIN input, spinner, status boxes, mobile slide-up sheet)
- `styles/layout.css` — added `.nav-btn` (button styled identically to nav `<a>` links)
- `index.html` — added `<link>` for `styles/modals.css`
- `main.js` — imports and inits `admin` and `support` between reader and content sections
- `config.example.js` — added `ADMIN_PIN` and `SUPPORT_EMAIL` placeholder keys

**VM — add to `config.js` before using:**
```js
ADMIN_PIN:     "your-pin-here",
SUPPORT_EMAIL: "techsupport@treppides.com",
```
FormSubmit first-use: first ticket triggers a one-time activation email to `SUPPORT_EMAIL` — click the link, then all future submissions are forwarded.

---

### Session 2026-04-03 (2) — Hardcoded IP removal + credential hygiene

**Committed:** `a87ede1` — everything below is live on `main`.

**Changes:**
1. **`components/reader.js`** — imported `CONFIG` (was missing). Replaced all 3 hardcoded `192.168.0.221` occurrences in `sanitizeHtml()`:
   - Image src rewriting now uses `CONFIG.BASE_URL` to match and `new URL(src).pathname` to rewrite to a relative path
   - Internal link fallbacks now use `window.location.origin` instead of a hardcoded IP
   - No hardcoded IPs remain anywhere in `components/` or `api/`

2. **`config.js`** — added a detailed credential security comment block explaining:
   - Why plaintext is unavoidable with no build step
   - Mitigations in place: read-only token, LAN-only, now gitignored
   - Future migration plan: server-side proxy or SSO session cookies

3. **`config.example.js`** — safe-to-commit template committed to the repo so developers know what values to fill in

4. **`.gitignore`** — created; `config.js` excluded so real credentials are never committed again

5. **`git rm --cached config.js`** — untracked from git; file stays on disk and the live site is unaffected

> **Token rotation note:** The old API token was in git history before this session (commits before `a87ede1`). If this repo is ever shared outside the team or made public, regenerate the BookStack API token: BookStack admin → Settings → API Tokens → delete and recreate.

**Nothing pending — repo is clean, all changes committed and pushed.**

---

### Session 2026-04-03 (1) — Reader + Knowledge Base

**Committed:** `365d485`

**Built:**
- `components/knowledgebase.js` — department books grid from shelf 57; cards fire `hub:openBook`
- `components/reader.js` — full in-app reader: breadcrumbs, two-column layout, collapsible chapters, pushState routing, PDF blob preview, non-PDF download list
- `styles/reader.css` — all reader styles
- `api/bookstack.js` — added `fetchShelfBooks`, `fetchBook`, `fetchChapter`, `fetchPageContent`, `fetchAttachments`, `fetchAttachmentBlob`
- `main.js` + `index.html` — wired in reader and KB section

**Fixed:**
- PDF attachments were force-downloading (`Content-Type: application/octet-stream`) — fixed with `fetchAttachmentBlob()` blob URL approach
- Non-PDF cards auto-downloaded on any click — changed wrapper to `<div>`; Download button is the only trigger
- BookStack guest access enabled in admin
- "Failed to load book" dead-end → "Try again" button

---

## URLs

| Service | URL |
|---|---|
| **Employee Hub** | http://192.168.0.221/ |
| **Knowledge Base (BookStack)** | http://192.168.0.221/docs/ |
| **BookStack direct port** | http://192.168.0.221:6875/ |

---

## Server Infrastructure

**Host:** tech-srv · Ubuntu Server · IP `192.168.0.221`
**User:** `tech-admin`

### Services

| Service | How it runs | Config location |
|---|---|---|
| **Nginx** (host) | systemd service | `/etc/nginx/sites-enabled/treppides-hub` |
| **BookStack** | Docker container `bookstack` | `~/bookstack/docker-compose.yml` |
| **MariaDB** | Docker container `bookstack_db` | `~/bookstack/docker-compose.yml` |

### Nginx routing (port 80)

```
/          → serves ~/treppides-hub (this repo) with try_files → index.html for SPA routes
/docs/*    → proxied to localhost:6875 (BookStack container)
```

Config file: `/etc/nginx/sites-enabled/treppides-hub`

**Important:** `try_files $uri $uri/ /index.html` is already in the config. This means all `/book/:id` and `/book/:id/page/:id` URLs correctly serve `index.html` and the reader handles routing client-side.

### BookStack Docker stack

```bash
cd ~/bookstack
sudo docker compose up -d       # start
sudo docker compose down        # stop
sudo docker compose logs -f     # live logs
```

Persistent data:
- `~/bookstack/config/` — app config, nginx, PHP, SSL keys, `.env`
- `~/bookstack/mysql_data/` — MariaDB data files

**BookStack `.env`** is at `~/bookstack/config/www/.env` — this is the authoritative config file. Environment variables in `docker-compose.yml` are secondary; `.env` always wins.

---

## Hub Configuration

All settings live in one file: [`config.js`](config.js)

| Setting | Value | Notes |
|---|---|---|
| `BASE_URL` | `http://192.168.0.221/docs` | BookStack base; nginx proxies /docs/* |
| `API_TOKEN_ID` | `BKS134yZFbh0dSXZP324ZABmz9SIFH8U` | BookStack API token (live) |
| `API_TOKEN_SECRET` | `N3CUTHrV43nfOr22eFozfkkwPewqkonS` | BookStack API secret (live) |
| `DEPARTMENTS_SHELF_ID` | `57` | Shelf containing all department books |
| `ANNOUNCEMENTS_BOOK_ID` | `58` | Book: Announcements |
| `POLICIES_BOOK_ID` | `3` | Book: Compliance |
| `TRAINING_BOOK_ID` | `59` | Book: Training & Development |
| `DOCS_URL` | `http://192.168.0.221/docs` | Knowledge Base quick link |
| `PROJECTS_URL` | `http://192.168.0.221/projects` | Projects quick link (not yet deployed) |
| `ENV_LIVE` | `true` | Disables "Coming Soon" modals |
| `USE_MOCK` | `false` | In `api/bookstack.js` — live BookStack API |
| `SEARCH_ENABLED` | `true` | Search bar in topbar |
| `ADMIN_PIN` | your PIN | Gates the in-page admin content publisher |
| `SUPPORT_EMAIL` | techsupport@treppides.com | FormSubmit forwards IT tickets here |

---

## BookStack Content Structure

**Shelf: Departments (ID: 57)**

| Book | ID | Contents |
|---|---|---|
| Audit | 1 | Audit Manual |
| Compliance | 3 | Compliance Manual (also used as Policies feed) |
| FRA - Financial Regulatory Affairs | 5 | E-SOFT Manual, Financial Services Procedures |
| Funds | 8 | IOM TFS documents, Business Continuity |
| HR - Human Resources | 13 | HR Manual |
| Internal Audit (IA) | 15 | IA Manual, Methodology, Programs, Archive, CAR Guidance |
| Licensing Procedures | 48 | Licensing procedures |
| Payroll | 50 | Payroll Department Manual |
| Risk Management (RM) | 52 | Risk Management Manual |
| Tax | 54 | Procedures, Tax Department Manual |
| **Announcements** | **58** | Company announcements (add pages here) |
| **Training & Development** | **59** | Training materials (add pages here) |

To add content to the Announcements or Training feeds: log into BookStack, open the relevant book, and create a new page. The hub pulls the 3 most recently updated pages automatically.

---

## BookStack API Functions (api/bookstack.js)

| Function | Endpoint | Used by |
|---|---|---|
| `fetchPages(bookId, count)` | `GET /api/pages?filter[book_id]=N` | announcements, policies, training |
| `fetchShelfBooks(shelfId)` | `GET /api/shelves/{id}` | knowledgebase |
| `fetchBook(bookId)` | `GET /api/books/{id}` | reader |
| `fetchChapter(chapterId)` | `GET /api/chapters/{id}` | reader (lazy chapter expand) |
| `fetchPageContent(pageId)` | `GET /api/pages/{id}` | reader |
| `fetchAttachments(pageId)` | `GET /api/attachments?filter[uploaded_to]=N` | reader |
| `fetchAttachmentBlob(id, mime)` | `GET /attachments/{id}` (file bytes) | reader PDF preview |
| `searchPages(query)` | `GET /api/search?query=N` | topbar search |
| `createPage(bookId, title, html)` | `POST /api/pages` | admin panel content publisher |

**Note on `fetchAttachmentBlob`:** BookStack serves attachments as `application/octet-stream` regardless of file type. This function fetches the raw bytes with auth headers and re-wraps them as the correct MIME type (e.g. `application/pdf`) so the browser can display inline rather than force-download.

---

## Reader URL Scheme

The in-app reader uses `pushState` to update the browser URL. All these routes fall back to `index.html` via nginx `try_files` and are handled client-side:

| URL | What shows |
|---|---|
| `/` | Hub dashboard (all sections) |
| `/book/13` | Book view — nav sidebar + welcome panel |
| `/book/13/page/42` | Page view — nav sidebar + page content + attachments |

Refresh on any of these URLs works correctly.

---

## File Structure

```
treppides-hub/
├── index.html                  Shell — loads CSS, reader overlay div, and main.js
├── main.js                     Entry point — boots sidebar, topbar, reader, then all sections
├── config.js                   All config, tokens, book IDs, feature flags  ← gitignored, not in repo
├── config.example.js           Safe-to-commit template — copy to config.js and fill in values
├── .gitignore                  Excludes config.js from version control
├── favicon.svg                 Treppides globe favicon
│
├── components/
│   ├── sidebar.js              Left nav + mobile burger menu
│   ├── topbar.js               Header bar + live search
│   ├── announcements.js        Announcements feed (BookStack book 58)
│   ├── knowledgebase.js        Department books grid (BookStack shelf 57) — opens reader
│   ├── policies.js             Policies feed (BookStack book 3)
│   ├── training.js             Training feed (BookStack book 59)
│   ├── quicklinks.js           Quick access widgets (KB, Projects, IT Support)
│   ├── reader.js               In-app content reader (overlay, nav, PDF preview)
│   ├── admin.js                PIN-protected in-page content publisher → BookStack API
│   └── support.js              IT support ticket modal → FormSubmit → email
│
├── api/
│   ├── bookstack.js            All API calls (9 functions) — see table above
│   └── mock.js                 Mock data for local dev (USE_MOCK=true in bookstack.js)
│
├── utils/
│   ├── dom.js                  Shared DOM helpers, XSS escaping
│   └── format.js               Date and text formatting
│
└── styles/
    ├── theme.css               Brand colours — edit here to retheme
    ├── base.css                Reset and defaults
    ├── layout.css              App shell and responsive layout
    ├── cards.css               Cards, skeletons, animations
    ├── reader.css              Reader overlay, nav sidebar, prose, PDF embed, attachments
    └── modals.css              Admin panel, support ticket, PIN dialog — shared modal styles
```

---

## Boot Sequence (main.js)

```
1. initSidebar + initTopbar   (parallel — no async data)
2. initReader                 (must run before KB section so hub:openBook listener is registered)
3. initAdmin + initSupport    (must be ready before content sections — quicklinks calls window.__hub_support)
4. Promise.allSettled([
     initAnnouncements,
     initKnowledgeBase,
     initPolicies,
     initTraining,
     initQuicklinks,
   ])
```

---

## SSH & GitHub Access

**SSH to server:**
```bash
ssh tech-admin@192.168.0.221
```

**GitHub repo:** `git@github.com:andreas1612/treppides-hub.git`
**SSH key for GitHub:** `~/.ssh/github_key` (configured in `~/.ssh/config`)

**Deploy workflow** (after any change):
```bash
cd ~/treppides-hub
git add <files>
git commit -m "description"
git push origin main
# Changes are live immediately — nginx serves directly from this directory
```

> No build step. No CI pipeline. Nginx serves the repo directory directly — a `git push` instantly updates the live site.

---

## Known Issues / Open Items

| # | Severity | Status | Description |
|---|---|---|---|
| 1 | Low | Open | `excerptFromHtml()` in `utils/format.js` calls `document.createElement` — browser-only, breaks in Node/SSR |
| 2 | Low | Open | Nav active state hardcoded on Home link — no routing, single-page portal so acceptable |
| 3 | Info | Open | `--brand-green` and `--brand-green-dk` CSS vars defined but not consumed (reserved) |
| 4 | Low | **Fixed** | Hardcoded IP in `reader.js` `sanitizeHtml()` — replaced with `CONFIG.BASE_URL` and `window.location.origin` |
| 5 | Medium | **Mitigated** | API credentials in `config.js`: file is now gitignored and untracked. Token still plaintext on disk (no build step = no env vars). Future plan: server-side proxy. If repo goes public, rotate the token. |
| 6 | Low | Open | Reader nav sidebar hidden on mobile (`display:none`) — no mobile alternative for page navigation within a book |

---

## Next Features — Priority Order

1. **Treppides logo** — replace SVG globe placeholder in sidebar with actual logo asset; update `favicon.svg`
2. **OpenProject deployment** — provision and deploy at `192.168.0.221/projects` (Docker); update `PROJECTS_URL` in `config.js`
3. **User identity in topbar** — show logged-in user name (requires BookStack session or SSO)
4. **Mobile reader nav** — sidebar hidden on mobile; add drawer or bottom sheet for page navigation
5. **Active nav routing** — update sidebar active class when navigating between sections
6. **LDAP/SSO auth** — integrate with company directory; Phase 2 post-launch
7. **SSL / HTTPS** — Let's Encrypt via Nginx once a domain is confirmed
8. **Credential migration** — move API token to a server-side proxy so it never reaches the browser

**Done this session:** Admin panel (in-page BookStack publishing) ✓  IT Support ticket modal via FormSubmit ✓

---

## Troubleshooting

**Hub shows old content after a push:**
```bash
# Not needed — nginx reads files directly. Hard-refresh the browser (Ctrl+Shift+R).
```

**PDF attachments downloading instead of previewing:**
- The hub fetches PDFs via the API with auth token and creates a blob URL — guest access is not required for PDF preview.
- If PDFs still download: check browser console for blob fetch errors, verify API token in `config.js` is valid.

**BookStack container down:**
```bash
cd ~/bookstack && sudo docker compose up -d
sudo docker compose logs bookstack --tail=50
```

**BookStack DB connection error in logs:**
Check `~/bookstack/config/www/.env` — this file overrides docker-compose.yml env vars. Ensure DB_HOST, DB_USERNAME, DB_PASSWORD match the MariaDB container settings.

**API calls failing (hub shows error cards):**
```bash
# Test API directly:
curl http://192.168.0.221/docs/api/books \
  -H "Authorization: Token BKS134yZFbh0dSXZP324ZABmz9SIFH8U:N3CUTHrV43nfOr22eFozfkkwPewqkonS"
```

**"Failed to load book" error in reader:**
Intermittent — usually a slow cold API response. Click "Try again" button. If persistent, check BookStack container status.

---

*K.Treppides & Co · Built by Andreas Pieri · Vanilla HTML/CSS/JS · Zero dependencies*
