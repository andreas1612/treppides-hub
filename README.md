# Treppides Employee Hub

**Status: LIVE IN PRODUCTION**
**Server: 192.168.0.221 (tech-srv)**
**Last updated: 2026-05-06 (session 4)**

Internal company portal for daily access to announcements, policies, training materials, knowledge base, and the New Client UBO Fees dashboard. Backed by a self-hosted BookStack instance and a ClickUp API backend. Zero dependencies, no build step.

---

## Session Log — Pick Up From Here

### Session 2026-05-06 (4) — Infrastructure fixes, ClickUp Fees fully operational

**BookStack API token rotated** — old token had expired (403 on all API calls).
New token active until **15/08/2026** — rotate before that date in BookStack admin → My Account → API Tokens.

**ClickUp Fees API — systemd service installed:**
- Python venv created at `api/clickup/venv/` — no system pip on Ubuntu, venv is the correct approach
- Service file written to `clickup-fees.service`, installed at `/etc/systemd/system/`
- Runs as `tech-admin`, auto-starts on boot, restarts on crash
- Start/stop: `sudo systemctl start|stop|restart clickup-fees`

**nginx proxy added for ClickUp API:**
- Added `/api/clickup/` → `localhost:8001` proxy block to nginx config
- Browser now reaches the fees backend through port 80 — port 8001 never needs to be open
- Config at `/etc/nginx/sites-enabled/treppides-hub` (copy of `nginx-treppides-hub.conf` in repo)

**`localhost` bug fixed in fees.js:**
- Was defaulting to `http://localhost:8001` — fails in any browser not on the VM itself
- Fixed: `CLICKUP_FEES_API: "/api/clickup/fees"` in `config.js` (relative, goes through nginx)

**Chart.js bundled locally:**
- Was loading from `cdn.jsdelivr.net` — LAN browsers may have no internet access
- Both files downloaded to `vendor/` and served by nginx:
  - `vendor/chart.umd.min.js`
  - `vendor/chartjs-plugin-datalabels.min.js`

**SETUP.sh written** — run `bash SETUP.sh` on a fresh VM to provision everything in one go.

---

### Session 2026-04-07 (3) — Admin panel + IT Support ticket modal

- `components/admin.js` — PIN-protected in-page content publisher; sidebar Admin button; publishes to BookStack via API
- `components/support.js` — IT Support ticket modal; FormSubmit AJAX → `SUPPORT_EMAIL`; replaces all mailto: links
- `styles/modals.css` — shared modal styles
- `api/bookstack.js` — added `createPage()` and `deletePage()` and `uploadAttachment()`

---

### Session 2026-04-03 (2) — Hardcoded IP removal + credential hygiene

- `config.js` gitignored and untracked (`git rm --cached config.js`)
- `config.example.js` committed as safe template
- All hardcoded IPs removed from `reader.js` — now uses `CONFIG.BASE_URL` + `window.location.origin`

---

### Session 2026-04-03 (1) — Reader + Knowledge Base

- `components/knowledgebase.js` — department books grid from shelf 57
- `components/reader.js` — full in-app reader; breadcrumbs, chapters, pushState routing, PDF blob preview
- `api/bookstack.js` — added fetchShelfBooks, fetchBook, fetchChapter, fetchPageContent, fetchAttachments, fetchAttachmentBlob

---

## Developer Access

3 developers have admin access to the VM via SSH. Development is done by SSHing into the server and editing files in `~/treppides-hub`, or pushing from a local machine via git.

| Developer | Access |
|---|---|
| Andreas Pieri | SSH + GitHub push |
| _(dev 2)_ | SSH + GitHub push |
| _(dev 3)_ | SSH + GitHub push |

**SSH:**
```bash
ssh tech-admin@192.168.0.221
```

**GitHub repo:** `git@github.com:andreas1612/treppides-hub.git`
**SSH key for GitHub:** `~/.ssh/github_key` (configured in `~/.ssh/config`)

### CRITICAL — Never use `localhost` in browser-facing code

The hub runs in staff browsers on the LAN. `localhost` in a browser means the user's own machine, not the server.

| Context | Correct |
|---|---|
| SSH session, nginx config, Python backend | `localhost` / `127.0.0.1` is fine |
| `config.js`, any frontend `fetch()` | Use relative paths (`/api/...`) or full server IP |

All ClickUp API calls now go through nginx as `/api/clickup/fees` — no port, no IP, works from any machine.

---

## URLs

| Service | URL |
|---|---|
| **Employee Hub** | http://192.168.0.221/ |
| **Knowledge Base (BookStack)** | http://192.168.0.221/docs/ |
| **ClickUp Fees API** | http://192.168.0.221/api/clickup/fees |
| **BookStack direct port** | http://192.168.0.221:6875/ |

---

## Server Infrastructure

**Host:** tech-srv · Ubuntu Server · IP `192.168.0.221` · User `tech-admin`

### Services

| Service | How it runs | Managed by |
|---|---|---|
| **Nginx** | Host process | `sudo systemctl start\|stop\|reload nginx` |
| **BookStack** | Docker container `bookstack` | `cd ~/bookstack && sudo docker compose up -d` |
| **MariaDB** | Docker container `bookstack_db` | same docker-compose |
| **ClickUp Fees API** | systemd service `clickup-fees` | `sudo systemctl start\|stop\|restart clickup-fees` |

### Nginx routing (port 80)

```
/               → serves ~/treppides-hub (SPA, try_files → index.html)
/docs/*         → proxied to localhost:6875 (BookStack container)
/api/clickup/*  → proxied to localhost:8001 (ClickUp Fees API)
```

Nginx config: `/etc/nginx/sites-enabled/treppides-hub`
Repo copy: `nginx-treppides-hub.conf` — edit this, then `sudo cp` and `sudo systemctl reload nginx`

### ClickUp Fees API

```bash
sudo systemctl status clickup-fees     # check status
sudo systemctl restart clickup-fees    # restart
journalctl -u clickup-fees -f          # live logs
```

Service file: `/etc/systemd/system/clickup-fees.service`
Venv: `api/clickup/venv/`
Credentials: `api/clickup/.env` (gitignored)

### BookStack Docker stack

```bash
cd ~/bookstack
sudo docker compose up -d        # start
sudo docker compose down         # stop
sudo docker compose logs -f      # live logs
sudo docker compose ps           # status
```

Persistent data:
- `~/bookstack/config/` — app config, `.env`, SSL
- `~/bookstack/mysql_data/` — MariaDB data

**BookStack `.env`** at `~/bookstack/config/www/.env` — this always overrides `docker-compose.yml`.

---

## Hub Configuration (`config.js`)

`config.js` is gitignored. Copy `config.example.js` → `config.js` and fill in values.

| Setting | Current value | Notes |
|---|---|---|
| `BASE_URL` | `http://192.168.0.221/docs` | BookStack base |
| `API_TOKEN_ID` | `th0aMsvxEBeW86m52FuLs20hYfiBZB6e` | Expires 15/08/2026 |
| `API_TOKEN_SECRET` | _(in config.js on server)_ | Rotate in BookStack admin |
| `DEPARTMENTS_SHELF_ID` | `57` | Shelf with all dept books |
| `ANNOUNCEMENTS_BOOK_ID` | `58` | |
| `POLICIES_BOOK_ID` | `3` | |
| `TRAINING_BOOK_ID` | `59` | |
| `DOCS_URL` | `http://192.168.0.221/docs` | KB quick link |
| `PROJECTS_URL` | `http://192.168.0.221/projects` | Not yet deployed |
| `SEARCH_ENABLED` | `true` | |
| `ENV_LIVE` | `true` | Disables Coming Soon modals |
| `ADMIN_PIN` | _(set on server)_ | PIN for admin panel |
| `SUPPORT_EMAIL` | `apieri@treppides.com` | IT ticket destination |
| `CLICKUP_FEES_API` | `/api/clickup/fees` | Relative — proxied by nginx |

**Token rotation:** BookStack admin → top-right avatar → My Account → API Tokens → delete old → create new → update `API_TOKEN_ID` and `API_TOKEN_SECRET` in `config.js`.

---

## File Structure

```
treppides-hub/
├── index.html                    Shell — CSS links, mount divs, loads main.js
├── main.js                       Entry point — boots all components in order
├── config.js                     All config (gitignored — never committed)
├── config.example.js             Safe template — copy to config.js on new VM
├── .gitignore                    Excludes config.js, venv, __pycache__
├── favicon.svg                   Treppides globe favicon
├── SETUP.sh                      Full VM provisioning script — run on fresh install
├── nginx-treppides-hub.conf      Nginx config — sudo cp to /etc/nginx/sites-enabled/
├── clickup-fees.service          systemd service file — sudo cp to /etc/systemd/system/
│
├── components/
│   ├── sidebar.js                Left nav + mobile burger menu
│   ├── topbar.js                 Header bar + live search + setStatus()
│   ├── announcements.js          Announcements feed (BookStack book 58)
│   ├── knowledgebase.js          Department books grid (shelf 57) → opens reader
│   ├── policies.js               Policies feed (BookStack book 3)
│   ├── training.js               Training feed (BookStack book 59)
│   ├── quicklinks.js             Quick access widgets (KB, Projects, IT Support)
│   ├── reader.js                 In-app content reader (overlay, nav, PDF preview)
│   ├── fees.js                   New Client UBO Fees dashboard (ClickUp data)
│   ├── admin.js                  PIN-protected content publisher → BookStack API
│   └── support.js                IT support ticket modal → FormSubmit → email
│
├── api/
│   ├── bookstack.js              All BookStack API calls (9 functions)
│   ├── mock.js                   Mock data (USE_MOCK=false in production)
│   └── clickup/
│       ├── server.py             FastAPI backend — fetches ClickUp fees data
│       ├── requirements.txt      Python deps (fastapi, uvicorn, requests, python-dotenv)
│       ├── .env                  ClickUp API token + List ID (gitignored)
│       ├── .env.example          Safe template
│       ├── Dockerfile            Docker alternative (not used currently)
│       └── venv/                 Python virtualenv (gitignored)
│
├── utils/
│   ├── dom.js                    escapeHtml, renderSkeleton, renderError, renderEmpty
│   └── format.js                 formatDate, excerptFromHtml
│
├── styles/
│   ├── theme.css                 CSS variables only — edit here to retheme
│   ├── base.css                  Reset and defaults
│   ├── layout.css                App shell, sidebar, topbar, mobile responsive
│   ├── cards.css                 Cards, skeletons, state boxes, animations
│   ├── reader.css                Reader overlay, nav, prose, PDF embed, attachments
│   ├── modals.css                Admin panel, support ticket, PIN dialog
│   └── fees.css                  Fees dashboard — KPI cards, tabs, chart, drilldown table
│
└── vendor/
    ├── chart.umd.min.js          Chart.js 4.4.7 — bundled locally (no CDN)
    └── chartjs-plugin-datalabels.min.js
```

---

## Boot Sequence (main.js)

```
1. initSidebar + initTopbar      (parallel — structural, no async data)
2. initReader                    (must be before KB — registers hub:openBook listener)
3. initAdmin + initSupport       (must be before content — quicklinks calls window.__hub_support)
4. Promise.allSettled([
     initAnnouncements,
     initKnowledgeBase,
     initPolicies,
     initTraining,
     initQuicklinks,
     initFees,
   ])
```

---

## Global API (window.__hub_*)

| Global | Set by | Used by |
|---|---|---|
| `window.__hub_reader` | reader.js | sidebar, KB, announcements, policies, training |
| `window.__hub_fees` | fees.js | sidebar (show/hide fees page) |
| `window.__hub_support` | support.js | sidebar, quicklinks |
| `window.__hub_admin` | admin.js | sidebar admin button |

---

## BookStack API Functions

| Function | Endpoint | Used by |
|---|---|---|
| `fetchPages(bookId, count)` | `GET /api/pages?filter[book_id]=N` | announcements, policies, training |
| `fetchShelfBooks(shelfId)` | `GET /api/shelves/{id}` | knowledgebase |
| `fetchBook(bookId)` | `GET /api/books/{id}` | reader |
| `fetchChapter(chapterId)` | `GET /api/chapters/{id}` | reader |
| `fetchPageContent(pageId)` | `GET /api/pages/{id}` | reader |
| `fetchAttachments(pageId)` | `GET /api/attachments?filter[uploaded_to]=N` | reader |
| `fetchAttachmentBlob(id, mime)` | `GET /attachments/{id}` | reader PDF preview |
| `searchPages(query)` | `GET /api/search?query=N` | topbar search |
| `createPage(bookId, title, html)` | `POST /api/pages` | admin panel |
| `deletePage(pageId)` | `DELETE /api/pages/{id}` | admin panel |
| `uploadAttachment(pageId, name, file)` | `POST /api/attachments` | admin panel |

---

## ClickUp Fees API

**Backend:** `api/clickup/server.py` — FastAPI, port 8001 (proxied via nginx)

| Endpoint | Description |
|---|---|
| `GET /api/clickup/fees` | Full cleaned dataset — 5-min cache |
| `GET /api/clickup/fees/refresh` | Force-refresh, bypasses cache |
| `GET /health` | Health check |

Data shape:
```json
{
  "months": ["April 2025", "January 2026", ...],
  "tasks": [ { "task_name", "ubo", "fees", "client_status", "month_year", ... } ]
}
```

ClickUp credentials in `api/clickup/.env` (gitignored, server-only):
- `CLICKUP_API_TOKEN` — personal token starting with `pk_`
- `CLICKUP_LIST_ID` — the New Client Fees list ID (find in the ClickUp URL)

---

## Reader URL Scheme

| URL | What shows |
|---|---|
| `/` | Hub dashboard |
| `/book/13` | Book view — nav + welcome panel |
| `/book/13/page/42` | Page view — nav + content + attachments |

All routes fall back to `index.html` via nginx `try_files`. Refresh works on all URLs.

---

## Fresh VM Setup

```bash
bash ~/treppides-hub/SETUP.sh
```

Handles: nginx config, Python venv, systemd service, smoke tests. Requires `sudo` (will prompt for password).

Manual steps after SETUP.sh:
1. Copy `config.example.js` → `config.js` and fill in all values
2. Copy `api/clickup/.env.example` → `api/clickup/.env` and fill in ClickUp credentials

---

## Troubleshooting

**Hub shows old content after a push:**
nginx serves files directly — just hard-refresh the browser (`Ctrl+Shift+R`). No restart needed.

**All sections show "Could not reach the knowledge base":**
BookStack API token has expired. Rotate it:
1. BookStack admin → avatar → My Account → API Tokens → delete old → create new
2. Update `API_TOKEN_ID` and `API_TOKEN_SECRET` in `config.js` on the server
3. Hard-refresh browser

Test token directly:
```bash
curl http://192.168.0.221/docs/api/books \
  -H "Authorization: Token TOKEN_ID:TOKEN_SECRET"
```

**Fees dashboard shows "Fees data unreachable":**
```bash
sudo systemctl status clickup-fees     # is it running?
sudo systemctl restart clickup-fees    # restart if not
curl http://192.168.0.221/api/clickup/fees   # test through nginx
journalctl -u clickup-fees -f          # check logs
```

**BookStack container down:**
```bash
cd ~/bookstack
sudo docker compose up -d
sudo docker compose logs bookstack --tail=50
```

**PDF attachments downloading instead of previewing:**
Check browser console for blob fetch errors. Verify API token in `config.js` is valid.

**"Failed to load book" in reader:**
Intermittent — slow cold BookStack response. Click "Try again". If persistent, check BookStack container.

---

## Known Issues / Open Items

| # | Severity | Status | Description |
|---|---|---|---|
| 1 | Low | Open | `excerptFromHtml()` calls `document.createElement` — browser-only, breaks in Node/SSR |
| 2 | Low | Open | Nav active state hardcoded on Home — acceptable for single-page portal |
| 3 | Info | Open | `--brand-green` CSS vars defined but not consumed — reserved |
| 4 | Low | Open | Reader nav hidden on mobile — no page navigation within a book on small screens |
| 5 | Medium | Mitigated | BookStack API token plaintext in `config.js` — file is gitignored, token is read-only, LAN-only |

---

## Next Features — Priority Order

1. **Treppides logo** — replace SVG globe in sidebar with real logo asset; update favicon.svg
2. **OpenProject** — deploy at `192.168.0.221/projects` (Docker); update `PROJECTS_URL` in config.js
3. **Mobile reader nav** — reader nav sidebar hidden on mobile; add drawer or bottom sheet
4. **Active nav routing** — sidebar active class should update when navigating sections
5. **User identity in topbar** — show logged-in user name (requires BookStack session or SSO)
6. **LDAP/SSO auth** — Phase 2 post-launch
7. **SSL / HTTPS** — Let's Encrypt once a domain is confirmed
8. **Credential migration** — server-side proxy so API token never reaches the browser

---

*K.Treppides & Co · Built by Andreas Pieri · Vanilla HTML/CSS/JS · Zero dependencies*
