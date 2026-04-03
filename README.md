# Treppides Employee Hub

**Status: LIVE IN PRODUCTION**
**Server: 192.168.0.221 (tech-srv)**
**Last updated: 2026-04-03**

Internal company portal for daily access to announcements, policies, training materials, and the knowledge base. Backed by a self-hosted BookStack instance. Includes a full in-app content reader — staff can browse and read all department books without leaving the Hub.

---

## Session Log — Pick Up From Here

### Session 2026-04-03 — What was done

**New components built (untracked — not yet committed to git):**

| File | What it does |
|---|---|
| `components/knowledgebase.js` | Knowledge Base section — fetches all department books from BookStack shelf ID 57, renders as clickable cards. Clicking a card fires `hub:openBook` and opens the in-app reader. |
| `components/reader.js` | Full in-app content reader — book/page navigation, breadcrumbs, expandable chapters, HTML sanitization, PDF preview (blob URL), non-PDF download list, browser history (`pushState`) |
| `styles/reader.css` | All reader styles — overlay, breadcrumb bar, nav sidebar, prose typography, PDF embed, attachments section, mobile responsive |

**Changes made this session:**

1. **PDF preview fix** — BookStack serves all attachments as `Content-Type: application/octet-stream`, which forces the browser to download instead of display. Fixed by fetching the attachment via API with auth token, wrapping as a `Blob` with `application/pdf`, and setting a blob object URL as the iframe `src`. New function: `fetchAttachmentBlob()` in `api/bookstack.js`.

2. **Non-PDF auto-download fix** — attachment item cards for docx/xlsx/etc were wrapped in `<a download>` which triggered download on any click. Changed to `<div>` — card is now display-only. Only the explicit "Download" button (kept inside) triggers a save.

3. **BookStack guest access** — enabled in BookStack admin (Settings → App Settings → Allow public access). Guest user granted read access so unauthenticated iframe requests don't redirect to login.

4. **"Failed to load book" UX** — intermittent API timeout on cold page load showed a dead red error. Now shows a "Try again" button that re-calls `openBook()`.

**Still to verify after this session:**
- [ ] Hard-refresh (`Ctrl+Shift+R`) the hub and confirm PDFs render inline (not downloading)
- [ ] Confirm non-PDF cards (docx, xlsx) no longer auto-download on click — only "Download" button works
- [ ] Open a page with a PDF attachment and confirm the spinner shows, then PDF renders in the iframe
- [ ] Navigate to `/book/13/page/14` directly and confirm the reader loads (not blank)
- [ ] Navigate to `/book/13` directly and confirm the book view loads
- [ ] Commit the three untracked files once verified working

**To commit the new files:**
```bash
cd ~/treppides-hub
git add components/knowledgebase.js components/reader.js styles/reader.css
git add api/bookstack.js components/announcements.js components/policies.js
git add components/quicklinks.js components/sidebar.js components/topbar.js
git add components/training.js config.js api/mock.js
git add index.html main.js styles/base.css styles/cards.css styles/layout.css styles/theme.css
git add utils/dom.js utils/format.js favicon.svg
git commit -m "Add in-app reader, knowledge base section, and PDF blob preview"
git push origin main
```

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
├── config.js                   All config, tokens, book IDs, feature flags
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
│   └── reader.js               In-app content reader (overlay, nav, PDF preview)
│
├── api/
│   ├── bookstack.js            All API calls — see table above
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
    └── reader.css              Reader overlay, nav sidebar, prose, PDF embed, attachments
```

---

## Boot Sequence (main.js)

```
1. initSidebar + initTopbar   (parallel — no async data)
2. initReader                 (must run before KB section so hub:openBook listener is registered)
3. Promise.allSettled([
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
| 4 | Low | Open | Hardcoded IP `192.168.0.221` in `reader.js` `sanitizeHtml()` (line ~47) for image src rewriting — will break if server IP changes |
| 5 | Medium | Open | API credentials (`API_TOKEN_ID`, `API_TOKEN_SECRET`) are plaintext in `config.js` which is in version control. Low risk for LAN-only internal tool but worth noting before any public repo exposure |
| 6 | Low | Open | Reader nav sidebar hidden on mobile (`display:none`) — no mobile alternative for page navigation within a book |

---

## Next Features — Priority Order

1. **Commit current working state** — knowledgebase.js, reader.js, reader.css + all modified files
2. **Treppides logo** — replace SVG globe placeholder in sidebar with actual logo asset
3. **OpenProject deployment** — provision and deploy at `192.168.0.221/projects` (Docker)
4. **User identity in topbar** — show logged-in user name (requires BookStack session or SSO)
5. **Mobile reader nav** — drawer or bottom sheet for page navigation on mobile
6. **Active nav routing** — update sidebar active class when navigating between sections
7. **LDAP/SSO auth** — integrate with company directory; Phase 2 post-launch
8. **SSL / HTTPS** — Let's Encrypt via Nginx once a domain is confirmed

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
