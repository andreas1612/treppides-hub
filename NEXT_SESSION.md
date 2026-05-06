# NEXT SESSION — Start Here

> **This is the entry point for every session.**
> Read this first, then follow the links below for deeper context.

---

## Quick Orient

| What | Where |
|---|---|
| Full project context, tech stack, rules | [PROJECT_BRIEF.md](PROJECT_BRIEF.md) |
| Infrastructure, config, troubleshooting | [README.md](README.md) |
| Current live status of all services | [STATUS.md](STATUS.md) |
| Full VM provisioning (fresh install) | `bash SETUP.sh` |

**Server:** `ssh tech-admin@192.168.0.221`
**Hub live at:** http://192.168.0.221/
**Repo:** `git@github.com:andreas1612/treppides-hub.git`

---

## Last Session — 2026-05-06 (Session 4)

**What was done:**
- BookStack API token rotated — old one had expired (all sections showing error)
- ClickUp Fees API installed as systemd service — now survives reboots, no SSH needed
- nginx proxy added for `/api/clickup/*` → localhost:8001 — browser no longer needs direct port access
- `localhost` bug fixed in fees.js — was failing on all non-VM browsers
- Chart.js bundled locally in `vendor/` — removed CDN dependency
- `SETUP.sh` written for full fresh-VM provisioning
- README.md, PROJECT_BRIEF.md, STATUS.md fully updated

**Everything is working as of end of session 4.**

---

## Pick Up Next Session From Here

### Priority 1 — Staff Directory (component/staff.js)
Searchable staff directory driven by a static JSON file converted from the employee Excel.
- Excel source: `K.TREPPIDESCO LTD.xlsx` — copy to `~/treppides-hub/` via scp from Windows laptop
- Convert Excel → `staff.json` in repo root (fields: name, department, extension, email)
- Build `components/staff.js` — searchable/filterable card grid or table with department dropdown
- Wire into `main.js` and `index.html` as `#section-staff`
- Add sidebar nav item for Staff Directory

### Priority 2 — Fees CSV Export (fees.js)
Export button on the fees dashboard — downloads current filtered view as a CSV spreadsheet.
- Pure frontend — `Blob` + `URL.createObjectURL`, no backend change
- Respects current month tab and UBO/Company toggle
- One button next to Refresh in the fees header

### Priority 3 — Department Landing Pages (reader.js)
Replace the blank "select a page from the left" welcome screen when opening a book.
- Show: department description, chapter list with page counts, 3 most recently updated pages
- Data already available from `fetchBook()` response — no extra API calls
- Files: `components/reader.js`, `styles/reader.css`

### Priority 4 — Treppides Logo
Replace the SVG globe placeholder in the sidebar with the real Treppides logo.
- File to edit: `components/sidebar.js` — `globeSvg()` function (line ~99)
- Also update `favicon.svg` in repo root
- Waiting on: actual logo asset from client

### Priority 2 — OpenProject Deployment
Deploy OpenProject at `192.168.0.221/projects` so the Projects link in the sidebar works.
- `docker-compose.yml` already written at `~/openproject/`
- nginx proxy block already in `nginx-treppides-hub.conf`
- Run: `cd ~/openproject && sudo docker compose up -d` then reload nginx

### ~~Priority 3 — Mobile Reader Nav~~
**Removed — no mobile support planned for this portal.**

### Done — Active Nav Routing (session 4)
Sidebar now correctly highlights Home / Knowledge Base / New Client UBO Fees based on current view.

### Done — Search Opens in Reader (session 4)
Search results now open pages inside the in-app reader instead of a new BookStack tab.

---

## Critical Rules — Don't Forget

1. **Never `localhost` in frontend code** — always relative paths (`/api/...`) or server IP. Nginx proxies everything.
2. **`config.js` is gitignored** — only exists on the server at `~/treppides-hub/config.js`. Never commit it.
3. **BookStack token expires 15/08/2026** — rotate early in BookStack admin → avatar → My Account → API Tokens.
4. **No build step** — edit files, push, done. nginx serves the repo directly.
5. **Chart.js is in `vendor/`** — do not switch to CDN.

---

## Service Health Check

Run this from the VM to confirm everything is up before starting work:

```bash
bash ~/treppides-hub/SETUP.sh
```

Or quick manual check:
```bash
sudo systemctl status nginx clickup-fees --no-pager
cd ~/bookstack && sudo docker compose ps
curl -s http://192.168.0.221/api/clickup/fees | python3 -m json.tool | head -5
```

---

*Update this file at the end of every session with what was done and what's next.*
