# Session 11 — Valuation Tool Port (Valtrix → Hub)

**Date:** 2026-05-14 / 2026-05-15
**Status:** Frontend + backend integrated. CDN vendored, API namespaced
under `/api/valuation`, systemd unit + nginx proxy block ready. Repo is
self-contained and ready to deploy with `git pull` + 6 server commands.

---

## What changed in this session

A new full-page section, "Valuation Tool", was ported from the standalone
Valtrix app into the hub. It is wired into both desktop sidebar and
mobile nav, hidden/shown using the same pattern as KB / Staff / AML /
Projects pages.

### Files touched (modified)

| File | Change |
|---|---|
| [index.html](index.html) | Added `<link>` for `styles/pages/valuation.css` (line 19); added `<div id="section-valuation">` page slot (line 97). |
| [main.js](main.js) | Imports `initValuation` from `components/pages/valuation.js` and awaits it before announcements/widgets boot, so `window.__hub_valuation.show()` is defined when the sidebar mounts. |
| [components/shell/sidebar.js](components/shell/sidebar.js) | New `calculator` SVG icon. New `sb-valuation` button (desktop) + `mb-valuation` (mobile). New click handlers that hide every other page and call `__hub_valuation.show()`. Every other page's click handler updated to also hide valuation. `setActiveNav` map and reset list extended. |
| [styles/layout.css](styles/layout.css) | Added `#section-valuation` display rules, `.main.valuation-active` toggles, and `.valuation-back-btn` styling — same shape as the existing `projects-back-btn` block. |

### Files added (untracked)

| File | What it is |
|---|---|
| [components/pages/valuation.js](components/pages/valuation.js) | 2,680 lines. Verbatim port of Valtrix `index.html` `<form>` tree + `app.js` body, wrapped in a hub page shell (back button, title, container). Built by [port-valtrix.ps1](../port-valtrix.ps1) at workspace root. |
| [styles/pages/valuation.css](styles/pages/valuation.css) | 583 lines. Port of Valtrix `style.css`. |

### How the port was assembled

[port-valtrix.ps1](../port-valtrix.ps1) (workspace root, not in repo)
reads `app.js` + `index.html` from `Desktop\Valuation Tool Project\`,
strips the `DOMContentLoaded` wrapper, splices the form HTML into a
template-literal `SHELL_HTML`, and writes a single ES-module file. It is
re-runnable — running it again will overwrite `components/pages/valuation.js`
with the same logic the script defines today.

All Valtrix DOM IDs are preserved unchanged (`valuationForm`, `coverImage`,
`baseYear`, `erp`, `dcfErp`, etc.) so the original html2canvas / jsPDF
selectors keep working.

---

## What works locally (assumed — not yet verified in a browser)

- Sidebar button shows the page.
- Form renders with all original IDs intact.
- Back button hides the page.

---

## What was fixed in the 2026-05-15 follow-up

1. **CDN → vendor.** Downloaded `vendor/jspdf.umd.min.js` (356 KB) and
   `vendor/html2canvas.min.js` (194 KB). [valuation.js:13-19](components/pages/valuation.js#L13-L19)
   now loads them locally.
2. **API_BASE.** [valuation.js:729](components/pages/valuation.js#L729)
   changed from `http://127.0.0.1:8000` → `/api/valuation` (relative).
3. **Call-site paths.** All 9 fetch templates simplified from
   `${API_BASE}/api/foo` → `${API_BASE}/foo` so they resolve to
   `/api/valuation/foo` against the new router prefix.
4. **Backend folder.** Full Valtrix backend copied into
   [api/valuation/](api/valuation/) (mirrors `api/clickup/`):
   - `main.py` rewritten with `APIRouter(prefix="/api/valuation")`,
     CORS tightened to GET-only, DB path resolved relative to the
     script, dev port now 8002.
   - `requirements.txt`, `Dockerfile`, and `README.md` added.
   - All source data shipped: `Rates1-4.csv`, `Tax Rates.csv`,
     `References.xlsx`, `valuation_reference.db`, plus
     `build_database.py`, `seed_database.py`, `update_damodaran.py`.
5. **systemd unit** [valuation-api.service](valuation-api.service) at
   repo root — mirrors `clickup-fees.service`, runs uvicorn on
   127.0.0.1:8002.
6. **nginx block** added to [nginx-treppides-hub.conf](nginx-treppides-hub.conf):
   `location /api/valuation/ { proxy_pass http://127.0.0.1:8002/api/valuation/; }`.
7. **.gitignore** updated to exclude `api/valuation/__pycache__/` and
   `api/valuation/venv/`.
8. **port-valtrix.ps1** patched so re-runs apply the hub-specific
   rewrites automatically (CDN → vendor in prologue, `API_BASE` regex
   substitution, `${API_BASE}/api/` strip).

### URL composition (verify mentally)

| Layer | Path |
|---|---|
| Frontend call | `` `${API_BASE}/dropdowns/continents` `` |
| Resolves to | `/api/valuation/dropdowns/continents` |
| nginx match | `location /api/valuation/` |
| Proxy target | `http://127.0.0.1:8002/api/valuation/dropdowns/continents` |
| FastAPI route | `router.get("/dropdowns/continents")` with `prefix="/api/valuation"` |

All four lines align.

## Original blockers (now resolved — kept for context)

### 1. CDN dependencies (violates hub Rule 4 — "no CDN")

[components/pages/valuation.js:16-19](components/pages/valuation.js#L16-L19)
loads jsPDF and html2canvas from `cdnjs.cloudflare.com`. LAN browsers
without internet will silently fail to export the PDF.

**Fix:** download both into `vendor/` and update `VENDOR_SCRIPTS`:

```
vendor/jspdf.umd.min.js
vendor/html2canvas.min.js
```

Then in valuation.js:
```js
const VENDOR_SCRIPTS = [
  "vendor/jspdf.umd.min.js",
  "vendor/html2canvas.min.js",
];
```

### 2. Hardcoded backend URL (violates hub Rule 1 — "no localhost in frontend")

[components/pages/valuation.js:729](components/pages/valuation.js#L729)
has `const API_BASE = 'http://127.0.0.1:8000';`. From a colleague's
browser this resolves to *their* machine, not the server.

**Fix:** change to relative path, e.g. `''` (so calls become `/api/valuation/dropdowns/...`),
and namespace the routes so they don't collide with the existing
`/api/clickup/*` and `/api/upload/*` blocks already proxied by nginx.

This also requires renaming the routes in the Valtrix `main.py` — see point 3.

### 3. Backend service is not deployed

The valuation frontend calls 9 endpoints that do not exist on the
server:

```
GET /api/dropdowns/continents
GET /api/dropdowns/countries
GET /api/dropdowns/industries
GET /api/dropdowns/currencies
GET /api/meta/damodaran-edition
GET /api/reference/continent/{name}
GET /api/reference/industry/{name}
GET /api/reference/tax-rate/{name}
GET /api/reference/currency/{name}
```

These live in `Desktop\Valuation Tool Project\main.py` — a small FastAPI
app backed by SQLite (`valuation_reference.db`).

**Decision needed before deploy:** namespace under `/api/valuation/*`
(recommended — keeps proxy rules clean) or run on a sibling port.

### 4. Reference database is local-only

`valuation_reference.db` (~120 KB) is populated from
`References.xlsx`, `Rates1.csv`…`Rates4.csv`, `Tax Rates.csv` by
[build_database.py](../Valuation%20Tool%20Project/build_database.py) and
[seed_database.py](../Valuation%20Tool%20Project/seed_database.py),
then refreshed by
[update_damodaran.py](../Valuation%20Tool%20Project/update_damodaran.py).

Either ship the prebuilt `.db` to the server **or** copy the source
data + run the build scripts on the server once.

### 5. No service unit, no nginx route

The Valtrix `main.py` runs with `uvicorn.run(reload=True)` for local
dev. Needs:

- A `requirements.txt` (`fastapi`, `uvicorn`, `sqlalchemy`, `pandas`,
  `xlrd`, `openpyxl`).
- A systemd unit (mirror `clickup-fees.service`, give it port 8002).
- An nginx `location /api/valuation/ { proxy_pass http://localhost:8002/; }`
  block in `/etc/nginx/sites-available/treppides-hub`.

### 6. CORS in `main.py`

[Valuation Tool Project/main.py:20](../Valuation%20Tool%20Project/main.py#L20)
has `allow_origins=["*"]`. Same-origin once we proxy through nginx, so
CORS can be removed entirely — but leave it permissive for the LAN
during initial cutover and tighten later.

---

## To make Valuation Tool live — checklist

### A. Local — commit and push

```bash
cd treppides-hub
git add api/valuation \
        valuation-api.service \
        nginx-treppides-hub.conf \
        vendor/jspdf.umd.min.js vendor/html2canvas.min.js \
        components/pages/valuation.js styles/pages/valuation.css \
        components/shell/sidebar.js index.html main.js styles/layout.css \
        .gitignore SESSION_11.md
git commit -m "feat: Valuation Tool — frontend + FastAPI backend + nginx/systemd wiring"
git push
```

### B. Server (192.168.0.221, six commands)

```bash
cd ~/treppides-hub && git pull

# Backend install
cd ~/treppides-hub/api/valuation
python3 -m venv venv
venv/bin/pip install -r requirements.txt

# Systemd unit
sudo cp ~/treppides-hub/valuation-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now valuation-api

# nginx
sudo cp ~/treppides-hub/nginx-treppides-hub.conf /etc/nginx/sites-enabled/treppides-hub
sudo nginx -t && sudo systemctl reload nginx
```

### C. Verify

```bash
# On server:
curl -s http://127.0.0.1:8002/api/valuation/health
# {"ok":true}

curl -sk https://hub.treppides.com/api/valuation/dropdowns/currencies
# ["AED","ARS","AUD",...]
```

Then from a colleague's browser:

1. Open `https://hub.treppides.com`, click **Valuation Tool**.
2. Industry / Country / Currency dropdowns populate.
3. Pick a continent — ERP fields auto-fill.
4. Fill a minimal valuation, click **Export PDF** — PDF downloads
   (proves vendored jsPDF + html2canvas loaded from `vendor/`).

---

## Open decisions for next session

These come from [HUB_DEPLOYMENT_PLAN.md](../Valuation%20Tool%20Project/HUB_DEPLOYMENT_PLAN.md)
(written before the hub port) and still apply:

- **Auth.** Hub is currently LAN-only with no auth. Valuation tool
  inherits that. If valuation data is more sensitive than the rest of
  the hub, a separate access layer needs deciding.
- **Damodaran refresh cadence.** `update_damodaran.py` is manual
  today. Cron job on the server, or keep it as a manual January/July
  ritual?
- **DB upgrade.** SQLite is fine for the read-mostly workload now. Move
  to Postgres only if a future feature needs concurrent writes.

---

## Critical hub rules — reminder for this work

1. No `localhost`/`127.0.0.1` in frontend — relative paths only.
2. `config.js` gitignored — never commit.
3. No build step, no npm, no bundler.
4. **No CDN dependencies** — vendor libs under `vendor/`.
5. Always `escapeHtml()` user-facing strings.
6. SSL private key lives only at `/etc/nginx/ssl/treppides.key` on the
   server.

The valuation port currently violates #1 and #4 — fixing those is the
first task before any server work.
