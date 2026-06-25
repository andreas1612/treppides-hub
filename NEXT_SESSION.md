# NEXT SESSION --- Start Here

> **Read this first, then follow links for deeper context.**

---

## Quick Orient

| What | Where |
|---|---|
| Full project context + tech stack | [PROJECT_BRIEF.md](PROJECT_BRIEF.md) |
| Current live status of all services | [STATUS.md](STATUS.md) |
| Server ops (backups, monitoring, firewall, crons) | [SERVER-OPS.md](SERVER-OPS.md) |
| Full VM provisioning | `sudo bash SETUP.sh` |

**Server:** `192.168.0.221` - Claude runs directly on the server --- no SSH needed
**Live URLs:** https://hub.treppides.com | https://tasks.treppides.com
**Repo:** `~/treppides-hub` (git, origin = github.com:andreas1612/treppides-hub)

---

## Deploy status

**⚠ PENDING DEPLOY (2026-06-25) — `origin/main` now at `3edef72`. Two new commits since the
last deploy, and this one needs a BACKEND restart (not just a pull):**
- `ef9b16e` **feat(forms)** — new **Forms tool** (Lead/Deal → creates a real ClickUp task).
  Backend changes in the `clickup-fees` service (port 8001) → needs **`pip install` +
  `systemctl restart clickup-fees`** AND two new lines in `api/clickup/.env`. Full steps in
  the **"Server deploy steps (2026-06-25)"** section near the bottom.
- `3edef72` **fix(tours)** — guided-tour fixes (sleek Valuation buttons; TB Ratio prompt no
  longer on the landing page; clearer "upload first" tour step). Frontend-only.

**Also still un-confirmed-deployed from before:** the 2026-06-22 **TB Ratio guided tour**
(frontend-only). A single `git pull` now brings down all of the above together.

Prior deployed baseline: `31552af` (2026-06-19 TB Ratio mapping discoverability), and
`6202295` (2026-06-09 Dashboard TID `--full` re-sync + service restarts).

---

## Last Session --- 2026-06-25 (Forms tool + tour fixes — COMMITTED + PUSHED, not deployed)

**Two commits pushed to `main` (`8d19a9d..3edef72`):**

**1. `ef9b16e` — Forms tool (new feature).** A **Forms** tool that submits **Leads** and
**Deals** straight into ClickUp (creates a real task). Reached from a **"Forms" button in the
Group Dashboard header** (next to Custom Total / Chart) — not a Tools card.
- **Backend** extends the `clickup-fees` service (port 8001 → v2.2.0): a `FORMS` schema
  registry + endpoints under `/api/clickup/forms` (`list` · `/{key}/schema` · `/{key}/members`
  · `/{key}/statuses` · `POST /{key}/submit`). Validates + converts each field to ClickUp's
  format, creates the task, attaches an optional file (Deal LoE). List IDs from `.env`
  (`CLICKUP_FORM_LEAD_LIST` `901214051231` / `CLICKUP_FORM_DEAL_LIST` `901214051218`); reuses
  the existing `CLICKUP_API_TOKEN`. Needs `python-multipart` (added to requirements.txt).
- **Frontend** new `components/pages/forms.js` + `styles/pages/forms.css`: AML-style card-grid
  landing → Lead/Deal form, schema-driven, client+server validation, "View in ClickUp" link.
  Wired additively into `companies.js` (header button) / `projects.js` (Tools card removed) /
  `sidebar.js` / `index.html` / `main.js`. No other component behaviour changed.
- **Caveats:** mirrors the two live ClickUp forms (structure from the API + screenshots — there
  is NO public API for form-view layout). ClickUp phone fields require **E.164** (`+357…`),
  enforced both sides. **No real task created in testing yet** — only validation-reject paths
  were exercised; the one remaining check is a real Lead + Deal submit on the deployed hub.

**2. `3edef72` — guided-tour fixes (frontend-only):**
- **Valuation tour buttons** restyled to the sleek TB-Ratio look (self-contained
  `val-tour-primary/secondary/x` classes + CSS; dropped the old global `btn` classes).
- **TB Ratio first-visit prompt** no longer shows on the **landing page** — it was fired at
  boot from `init()`; now fired from `showPage()` via `maybeTbratioPrompt()`, so it only
  appears on the TB Ratio page.
- **TB Ratio "upload first" tour step** now has a clear **"Close tour to upload"** button + a
  highlighted hint to re-press **Tutorial** to resume (was forcing the user to find "Skip").
- Verified via headless-Chrome screenshots of both states.

**Deploy:** see **"Server deploy steps (2026-06-25)"** below — this one needs a backend restart.

---

## Last Session --- 2026-06-22 (TB Ratio guided tour)

**What was done — new on-site guided tour for the TB Ratio Tool, modelled on the
Valuation tour:**
- **New files:** [`components/pages/tbratio-tour.js`](components/pages/tbratio-tour.js)
  (zero-dep, no-build ES module — ported from `valuation-tour.js`) and
  [`styles/pages/tbratio-tour.css`](styles/pages/tbratio-tour.css) (hub design tokens,
  `tbr-tour-*` classes, self-contained button styles).
- **Wiring:** `tbratio.js` `init()` calls `initTbratioTour()` (guarded in try/catch so a
  tour failure can never break the tool); `index.html` gets the stylesheet link after
  `tbratio.css`. A **Tutorial** button is injected into `.tbr-header-left`; first-time
  users get a one-off bottom-right prompt (localStorage `treppides:tbratio:tourSeen:v1`).
- **14 steps, two-phase / data-aware.** The tool is empty until a TB is uploaded (mapping
  panel, statements, ratios, export all render into `#tbr-output` after parsing). So steps
  3+ are flagged `requiresData`: with no TB loaded they show a centered "Upload a trial
  balance first" card; once a TB is in, they spotlight the real elements. Tab steps click
  the real `.tbr-map-tab[data-maptab="bs|pnl"]` buttons (no `<details>` accordions here).
- **Verified locally** (no Node; vanilla JS) via a throwaway auth-free harness + headless
  Chrome, the standard TB Ratio way — built a synthetic TB, fed it through the real
  `#tbr-file` upload path, and self-tested: Tutorial button present, `#tbr-output`
  rendered, **all 12 step anchors resolve to visible elements** on the correct tab, and the
  tour drives through all 14 steps to "Done" without throwing. Also verified the
  **pre-upload phase**: the upload-first card shows and the tour still reaches the end.
  Harness files removed.
- **Not yet exercised:** the live auth'd hub with real backends + a real E-Soft export
  (same standing caveat as the rest of TB Ratio). Eyeball pass after deploy: open TB Ratio
  → Tutorial button present → step through empty-page → upload a TB → replay → confirm tab
  switches + spotlights.
- **Deploy:** frontend-only, no-build → `git pull` + hard-refresh, no systemd/DB. Files to
  commit: `tbratio-tour.js`, `tbratio-tour.css`, `tbratio.js`, `index.html`, `README.md`.

---

## Earlier Session --- 2026-06-19b (TB Ratio discoverability, zero area, cross-statement rework)

**What was done (this local checkout) — all in `components/pages/tbratio.js` + `styles/pages/tbratio.css`:**
- **Mapping discoverability toolbar.** Live search box (dims non-matches, accent-rings matching
  chips AND the buckets containing them), a per-pane **match count** + **Jump to match** (scrolls
  to & flashes the first hit, expanding its bucket if collapsed), **collapse/expand** any bucket by
  its head, a **Collapse empty** toggle, and a **count badge** on every bucket head. Search term +
  collapsed state persist across the re-renders drag-drops trigger (DOM-class toggles, no re-render).
- **"No activity" area.** Accounts whose CLOSING balance is zero are pulled out of their line
  buckets into a single collapsed `tbr-bucket-zero` area at the bottom (default-collapsed, seeded in
  `handleFile`). Display-only grouping (model unchanged); still draggable onto a line; an explicitly
  mapped zero account (has an override) stays on its line.
- **Zero-aware empty-space drop.** Dropping a chip outside any bucket: a **zero**-balance chip goes
  to the No-Activity area (via `applyOverride(row, null)` = CLEAR override → re-parks), a chip with a
  value goes to Unmapped.
- **No-op on same-bucket drop (bug fix).** Dropping a chip back into the bucket it already sits in
  (or releasing it in empty space when already in Unmapped/No-Activity) no longer records a sticky,
  persisted override. Uses the dragged element `_dragEl` to compare source vs target body.
- **Cross-statement rework (SUPERSEDES the 2026-06-19a "Mapped elsewhere" design below).** The blue
  "Mapped on [other statement] — move it across" holding area was REMOVED. Now every account is
  available on both tabs: one auto-mapped to a line on THIS statement shows in that line bucket;
  anything else (mapped to the other statement, or unmapped) sits in THIS tab's **Unmapped** bucket,
  freely draggable onto any line here. (Old design wrongly locked out e.g. using Tax on the P&L
  because it sat on the BS.) `tbr-bucket-elsewhere` CSS removed.
- **Wording.** User-facing "E-Soft trial balance" → "trial balance sheet" (subtitle, drop-zone,
  parse-error). Internal parser comments still reference the E-Soft export format (accurate for devs).
- **Verified locally** via the auth-free harness + headless Chrome (search/collapse/counts, the
  No-Activity area collapsed+expanded, and the cross-statement Unmapped placement on both tabs).
  Drag-runtime behaviours (auto-scroll, empty-space routing, no-op drop) are in place but can't be
  exercised by screenshots. Harness + screenshots removed.
- **Note:** the bundled sample TB in the (now-deleted) test harness never balanced by design — it
  was hand-written to exercise the UI, not to tie out. Not a tool bug; a real export should pass the
  raw debits=credits check, and the balance-sheet check depends on correct mapping.

---

## Earlier Session --- 2026-06-19a (TB Ratio account-mapping UX + cross-statement first cut)

**What was done (this local checkout):**
- **TB Ratio Tool — three mapping-panel changes** (`components/pages/tbratio.js`,
  `styles/pages/tbratio.css`):
  1. **Drop in empty space → Unmapped.** Releasing a dragged account chip outside any bucket
     now moves it to Unmapped (previously nothing happened). Implemented via a `_dropHandled`
     flag: a real bucket drop sets it; if `dragend` fires with it still false, the chip is
     unmapped. Drop logic extracted into a shared `applyOverride(rowIndex, targetId)`.
  2. **Drag auto-scroll.** While dragging, the window auto-scrolls when the cursor nears the
     top/bottom viewport edge (`AUTOSCROLL_EDGE_PX` 90 / `AUTOSCROLL_SPEED_PX` 18, via rAF), so
     buckets off-screen in long mapping lists are reachable without dropping first.
  3. **CRITICAL FIX — accounts were exclusive to one statement.** Each posting row rendered in
     exactly ONE bucket on ONE tab, so e.g. a "depreciation"-named account auto-classified to the
     P&L was invisible on the Balance Sheet tab and couldn't be dragged to Fixed Assets. Now EVERY
     detected account is reachable from BOTH tabs: accounts mapped to the *other* statement appear
     in a new blue **"Mapped on [other statement] — drag onto a line here to move it across"**
     holding area (`.tbr-bucket-elsewhere`, read-only body), draggable onto any line in the current
     tab (which reassigns it). Bidirectional.
  - **Verified locally** via the auth-free harness + headless Chrome: bug #3 and the new hint text
    confirmed on both tabs (TB with both a `Depreciation Charge` and an `Accumulated Depreciation`
    asset — both reachable from BS and P&L). Auto-scroll + empty-space-drop are drag-runtime
    behaviours screenshots can't exercise; code paths in place. Harness + screenshots removed.

---

## Earlier Session --- 2026-06-18 (TB Ratio tabbed results + Valuation copy tweaks)

**What was done (this local checkout):**
- **TB Ratio Tool — split results onto two tabs.** The Balance Sheet and Profit & Loss
  results (statement + calculation/ratio tables) now sit on **separate tabs driven by the
  two existing BS / P&L buttons** that previously only switched the mapping view. Each tab
  now shows that statement's mapping panel **and** its statement + ratios together; the old
  cluttered "mapping → P&L results → BS results" stack is gone.
  - `components/pages/tbratio.js`: `render()` restructured into one shared top tab strip
    (`.tbr-tabs`) + two `.tbr-tabpane` panes; `renderMappingPanel(m, which)` now renders one
    statement's buckets (internal tab strip removed); `wireMappingPanel()` toggles the combined
    panes and calls `_pnlChart.resize()` when revealing the P&L pane (Chart.js can't size a
    canvas while its container is `display:none`); `onExportPdf()` temporarily un-hides both
    panes during `html2canvas` capture so the **PDF still contains both** statements.
  - `styles/pages/tbratio.css`: added `.tbr-tabs` / `.tbr-tabpane[hidden]`; removed the now-dead
    `.tbr-map-tabs` rule.
  - **Verified locally** via a throwaway auth-free harness (imported `tbratio.js` directly, no
    `main.js`/`initAuth`, no backend — the tool is fully client-side), fed a synthetic E-Soft TB
    through the real upload path, and headless-Chrome screenshotted: BS tab, P&L tab (chart sizes
    correctly), and single-period mode all confirmed. Harness + screenshots removed afterward.
- **Valuation Tool — copy tweaks** (`components/pages/valuation.js`): Box 3 tour text "that
  matches" → "that is closest to"; Box 4 "company name" → "name of the company under valuation";
  the input accordion tab **and** the PDF report Section I heading / sub-heading / TOC entry
  renamed "Company Overview" → "Company Under Valuation Overview".

---

## Earlier Session --- 2026-06-17 (Valuation guided tour + pull reconcile + TB Ratio WIP)

**What was done (this local checkout):**
- **Pulled `origin/main`** (was 8 commits behind → `0f005e1`, the Batch A–D security work +
  admin-only auth + Performance / Budget KPI sections + `staff.json` removal). Reconciled via
  stash → ff-pull → re-apply; resolved 22 additive merge conflicts in `sidebar.js` / `main.js`
  / `index.html` (kept Performance + Budget KPI **and** the local TB Ratio nav wiring).
- **Valuation Tool — on-site guided tour** (new feature). Coachmark/spotlight overlay that
  walks a user through the DCF workflow (17 steps), launched from a new **Tutorial** button in
  the tool header and auto-offered to first-time users (localStorage `treppides:valuation:tourSeen:v1`).
  - New: [`components/pages/valuation-tour.js`](components/pages/valuation-tour.js) (zero-dep,
    no-build ES module), [`styles/pages/valuation-tour.css`](styles/pages/valuation-tour.css).
  - Edited: `components/pages/valuation.js` (import + guarded `initValuationTour()` at end of
    `bootValuation()`), `index.html` (stylesheet link).
  - Robust to JS-populated result tables that are empty (0-size) before data is entered —
    `resolveAnchor()` climbs to the nearest visible ancestor; result-tab steps open their
    accordions before positioning.
  - **Verified structurally** (anchor resolution, brace balance, wiring) via a throwaway local
    harness; **not yet run against the live auth'd app + backends.** Harness file removed.
- **TB Ratio Tool** — in-progress (untracked WIP carried through the reconcile): nav entry,
  `components/pages/tbratio.js`, `styles/pages/tbratio.css`, vendored `vendor/xlsx.full.min.js`.
  Not yet feature-complete.

---

## Earlier Session --- 2026-06-09 (Dashboard TID chart grouping + security fixes + BookStack)

**What was done:**
- **Chart 'by company' now groups on `Dashboard TID` (GID)** — a new ClickUp custom field
  on the Deals lists that rolls several companies into one dashboard group. List / search /
  detail / UBO views still key on `Clickup_TID`; only the chart's company mode groups on GID.
- **companies-api**: added indexed `dashboard_tid` column (`build_database.py`), extracted it
  in `sync.py normalize()`, and grouped active Deal Value by GID in `main.py`
  (`filtered_group_rows`). Raised the `/chart` `top` cap to 2000 so the picker lists all groups.
- **Supername labels** — each grouped bar is labelled with a synthesized name: the longest
  common leading words across the group's member company names (e.g. "Capital Com", "Nuvei"),
  falling back to a representative company name, then the GID. (`_supername` in `main.py`.)
- **Chart picker** (`components/pages/companies.js`) repointed to `/chart?by=company` so its
  select values are GID keys that match the chart's `select=` param.
- **Security audit fixes (carried from 2026-06-05)** — `api/clickup/server.py` +
  `components/pages/valuation.js`: ClickUp fetch connect/read timeouts + error handling (H1);
  removed API-payload `console.log`s (H2); media-upload hardening — None-filename guard,
  magic-byte sniff, safe uuid name (M1); custom-field key-collision logging (M2); frontend
  error logs message-only (M3).
- **BookStack APP_URL fixed:** Changed `APP_URL` from `http://` to `https://hub.treppides.com/docs` — was causing mixed-content blocking.
- **config.js BASE_URL made relative:** Changed to `/docs` — eliminates cross-origin CSP blocks.
- **Reader overlay visibility fix:** `showOverlay()` removes page-active CSS classes before displaying.
- **Reader image rewrite fix:** Uses `src.includes("/docs/")` instead of `startsWith(CONFIG.BASE_URL)`.
- **CSP frame-src blob: added:** Fixes PDF preview iframe blocking.

---

## Earlier Session --- 2026-06-08 (Task Manager Integration)

**What was done:**
- **BookStack APP_URL fixed:** Changed `APP_URL` in `~/bookstack/docker-compose.yml` from `http://192.168.0.221/docs` to `https://hub.treppides.com/docs` --- was causing mixed-content blocking (all BookStack assets loaded over HTTP when page served via HTTPS). Container recreated.
- **config.js BASE_URL made relative:** Changed from absolute `https://hub.treppides.com/docs` to `/docs` --- eliminates cross-origin CSP blocks when users access hub via IP instead of domain. Updated `config.example.js` to match.
- **Reader overlay visibility fix:** `showOverlay()` in `reader.js` now removes page-active CSS classes (`kb-active`, `staff-active`, etc.) before displaying --- fixes bug where reader was invisible when opened from Knowledge Base page due to `.main.kb-active .reader-overlay { display: none !important }`.
- **Reader image rewrite fix:** Image src rewrite changed from `src.startsWith(CONFIG.BASE_URL)` to `src.includes("/docs/")` --- handles BookStack absolute image URLs correctly with relative BASE_URL.
- **CSP frame-src blob: added:** Added `blob:` to `frame-src` in nginx CSP header --- fixes "This content is blocked" error on PDF preview iframes.
- **BookStack port already secure:** Confirmed `127.0.0.1:6875:80` in docker-compose.yml --- issue #14 was already resolved.

---

## Service Health Check

```bash
# Quick status --- all services
systemctl is-active nginx clickup-fees valuation-api companies-api taskmanager docker

# Health endpoints
curl -s http://127.0.0.1:8001/health                    # ClickUp Fees API
curl -s http://127.0.0.1:8002/api/valuation/health       # Valuation API
curl -s http://127.0.0.1:8003/api/companies/health        # Company Finder API
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/   # Task Manager (expect 302)

# HTTPS endpoints
curl -sk -o /dev/null -w "%{http_code}" https://hub.treppides.com/        # Hub (expect 200)
curl -sk -o /dev/null -w "%{http_code}" https://tasks.treppides.com/      # Task Manager (expect 302)

# Auth check
curl -sk -o /dev/null -w "%{http_code}" https://hub.treppides.com/projects/api/me  # expect 401 if not authenticated

# Recent health log
tail -5 /var/log/hub-health.log

# Firewall + fail2ban
sudo ufw status
sudo fail2ban-client status
```

---

## Priorities

| # | Feature | Priority | Notes |
|---|---|---|---|
| 1 | Active monitoring notifications | Medium | Email/Slack alerts when healthcheck fails --- currently log-only |
| 2 | Mobile reader navigation | Medium | Drawer/bottom sheet for the in-app BookStack reader |
| 3 | Task Manager email notifications | Medium | Configured (Office 365 SMTP) but untested in production |
| 4 | Server-side BookStack token proxy | Low | Removes token from browser; enables per-session rate limiting |

---

## Critical Rules

1. **Never absolute URLs in frontend** --- always relative paths (`/api/...`, `/docs`). Nginx proxies. Absolute URLs break when users access via IP instead of domain (CSP cross-origin block).
2. **`config.js` is gitignored** --- only on server. Never commit.
3. **No build step** --- edit files, push, hard-refresh. Done.
4. **No CDN** --- vendor all JS libs under `vendor/`.
5. **BookStack token expires 15/08/2026** --- rotate in BookStack admin -> API Tokens.
6. **SSL cert expires 22/11/2026** --- renewal alerts run monthly.
7. **`media/` dirs gitignored** --- uploaded files live only on server, backed up daily.
8. **Never hardcode redirect-uri** --- Task Manager auto-generates from Host header. Hardcoding breaks hub vs direct access.
9. **TM backend changes need rebuild** --- `cd ~/taskmanager && ./mvnw package -DskipTests && sudo systemctl restart taskmanager`.
10. **Auth proxy paths are critical** --- `/projects/*`, `/oauth2/*`, `/login/oauth2/*` must all proxy to port 8080.

---

## Server deploy steps (2026-06-25 — Forms tool + tour fixes)

Brings down everything up to `3edef72`. The tour fixes are frontend-only, but the **Forms
tool changes the `clickup-fees` backend**, so this deploy needs a `pip install` + service
restart + two new `.env` lines — NOT just a pull.

```bash
cd ~/treppides-hub
git pull                                   # → 3edef72

# 1. Add the two Forms list IDs to the clickup-fees env (gitignored, server-only).
#    Append if not already present:
cat >> api/clickup/.env <<'EOF'
CLICKUP_FORM_LEAD_LIST=901214051231
CLICKUP_FORM_DEAL_LIST=901214051218
EOF

# 2. Install the new backend dep (python-multipart) into the service venv.
cd api/clickup && source venv/bin/activate && pip install -r requirements.txt && deactivate
cd ~/treppides-hub

# 3. Restart the backend so the new /api/clickup/forms/* endpoints load.
sudo systemctl restart clickup-fees

# 4. Hard-refresh the hub in the browser (Ctrl-Shift-R) for the frontend.
```

**Sanity checks after deploy:**
- `curl -s http://127.0.0.1:8001/api/clickup/forms` → `{"forms":[{"key":"lead",...},{"key":"deal",...}]}`
  (empty list = the `.env` IDs aren't set / service not restarted).
- Hub → **Group Dashboard** → a **Forms** button sits next to Custom Total / Chart → opens the
  Lead/Deal card grid. Submit a **test Lead and a test Deal** (phone must be `+357…`) and
  confirm they appear in the ClickUp Leads/Deals lists (then delete the tests). This is the
  one end-to-end check not yet done locally.
- Valuation & TB Ratio **Tutorial** buttons show the sleek button styling; the TB Ratio
  first-visit prompt appears only on the TB Ratio page, and its "upload first" step shows a
  "Close tour to upload" button.

If `/api/clickup/forms` 500s on `python-multipart`, step 2 didn't take — re-run it in the
service venv and restart.

---

## Server deploy steps (for the 2026-06-17 commit)

This commit is **frontend-only** (vanilla JS/CSS/HTML, no build step), so deploy is the
standard pull + refresh — **no systemd restart, no DB rebuild** for the Valuation tour:

```bash
cd ~/treppides-hub
git pull
# Hard-refresh the hub in the browser (Ctrl-Shift-R) — nginx serves the repo dir directly.
```

Notes:
- nginx serves the repo directory as static files, so the new `valuation-tour.js` /
  `valuation-tour.css` and the edited `valuation.js` / `index.html` go live on pull.
- No change to `valuation-api` (port 8002) or its SQLite DB — the tour is pure frontend
  and points only at existing DOM; it makes no new API calls.
- The TB Ratio Tool WIP ships in the same commit but is **not finished** — confirm it's
  acceptable to deploy partially, or finish it first.
- Sanity check after refresh: open Valuation Tool → a **Tutorial** button appears in the
  header; first-time load shows the tour prompt bottom-right.
