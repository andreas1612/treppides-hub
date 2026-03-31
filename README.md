# Treppides Employee Hub

**Status: LIVE IN PRODUCTION**
**Server: 192.168.0.221 (tech-srv)**

Internal company portal for daily access to announcements, policies, training materials, and the knowledge base. Backed by a self-hosted BookStack instance.

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
| **Nginx** (host) | systemd service | `/etc/nginx/sites-enabled/` |
| **BookStack** | Docker container `bookstack` | `~/bookstack/docker-compose.yml` |
| **MariaDB** | Docker container `bookstack_db` | `~/bookstack/docker-compose.yml` |

### Nginx routing (port 80)

```
/          → serves ~/treppides-hub (this repo)
/docs/*    → proxied to localhost:6875 (BookStack container)
```

Config file: `/etc/nginx/sites-enabled/` — single server block.

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
| `API_TOKEN_ID` | `tMGusKQeZI3U7PBEuPxpxmCg7K26bDtw` | BookStack API token (name: importerkey) |
| `ANNOUNCEMENTS_BOOK_ID` | `58` | Book: Announcements |
| `POLICIES_BOOK_ID` | `3` | Book: Compliance |
| `TRAINING_BOOK_ID` | `59` | Book: Training & Development |
| `DOCS_URL` | `http://192.168.0.221/docs` | Knowledge Base quick link |
| `ENV_LIVE` | `true` | Disables "Coming Soon" modals |
| `USE_MOCK` | `false` | Live BookStack API (in api/bookstack.js) |

---

## BookStack Content Structure

**Shelf: Departments Procedures** (imported March 2026)

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

To add content to the Announcements or Training feeds on the hub: log into BookStack, open the relevant book, and create a new page. The hub pulls the 3 most recently updated pages automatically.

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

> No build step. No CI pipeline. Nginx serves the repo directory directly, so a `git pull` or `git push` instantly updates the live site.

---

## Adding New Sections / Documents

### Upload new department documents to BookStack
From a Windows machine (PowerShell):
```powershell
scp -r "C:\path\to\folder" tech-admin@192.168.0.221:/home/tech-admin/
```
Then run or adapt `~/import_bookstack.py` to import into BookStack via API.

### Add a new section to the hub
1. Create a new BookStack book via the web UI or API — note its ID
2. Add the book ID to `config.js`
3. Create a new component in `components/` following the pattern of `policies.js`
4. Register the component in `main.js`
5. Add a mount point `<div id="section-yourname">` in `index.html`
6. Commit and push

---

## File Structure

```
treppides-hub/
├── index.html              Shell — loads CSS and main.js only
├── main.js                 Entry point — boots all components
├── config.js               All config, tokens, book IDs, feature flags
├── favicon.svg             Treppides globe favicon
│
├── components/
│   ├── sidebar.js          Left nav + mobile burger menu
│   ├── topbar.js           Header bar + live search
│   ├── announcements.js    Announcements feed (BookStack book 58)
│   ├── policies.js         Policies feed (BookStack book 3)
│   ├── training.js         Training feed (BookStack book 59)
│   └── quicklinks.js       Quick access widgets
│
├── api/
│   ├── bookstack.js        All API calls — fetchPages, searchPages
│   └── mock.js             Mock data for local dev (USE_MOCK=true)
│
├── utils/
│   ├── dom.js              Shared DOM helpers, XSS escaping
│   └── format.js           Date and text formatting
│
└── styles/
    ├── theme.css           Brand colours — edit here to retheme
    ├── base.css            Reset and defaults
    ├── layout.css          App shell and responsive layout
    └── cards.css           Cards, skeletons, animations
```

---

## Theming

All colours are CSS custom properties in [`styles/theme.css`](styles/theme.css).

Key values: sidebar `#0a0a0a` · accent `#c8d400` · page bg `#f5f5f5`

---

## Troubleshooting

**Hub shows old content after a push:**
```bash
# Not needed — nginx reads files directly. Hard-refresh the browser (Ctrl+Shift+R).
```

**BookStack container down:**
```bash
cd ~/bookstack && sudo docker compose up -d
sudo docker compose logs bookstack --tail=50
```

**BookStack DB connection error in logs:**
Check `~/bookstack/config/www/.env` — this file overrides docker-compose.yml env vars. Ensure DB_HOST, DB_USERNAME, DB_PASSWORD match the MariaDB container settings.

**API calls failing (hub shows error cards):**
- Verify BookStack is running: `sudo docker compose ps`
- Test API directly: `curl http://192.168.0.221/docs/api/books -H "Authorization: Token tMGusKQeZI3U7PBEuPxpxmCg7K26bDtw:LKRcyhG2sPo4kwGSIQFsSohPb9iRBfEy"`

---

*K.Treppides & Co · Built by Andreas Pieri · Vanilla HTML/CSS/JS · Zero dependencies*
