# Session 16 — Company Finder + Company Master Database

**Date:** 2026-06-02 (day 1) · 2026-06-03 (day 2)
**Status:** Built, verified, cleaned up. **NOT committed, NOT deployed** (user is holding
commit/deploy). Remaining: commit on a branch → deploy to server.

---

## Day 2 (2026-06-03) — bug fixes, lost-status change, cleanup done

Three things happened on day 2; all verified locally:

1. **Lost-status change.** `api/companies/.env` `COMPANIES_LOST_STATUSES` changed to
   `rejected,approved terminated` (was `rejected,on hold - stall`). `approved terminated`
   is a real ClickUp status with no deals assigned yet; `on hold - stall` now counts as
   **active**. After a clean full sync: lost = €26,500 (3 rejected only), active ≈ €6.1M.
   NOTE: classification is stored on each task at sync time → a config change needs a
   re-sync (`python sync.py --full`) to take effect.

2. **Two real bugs found & fixed** (both would have hit production too):
   - **SQLite param cap.** The bulk upsert sent one `INSERT…VALUES` per space; KT_CRM
     (6,874 rows × 19 cols ≈ 131k bind params) blew past SQLite's 32,766 limit →
     `OperationalError: too many SQL variables`, caught by the per-space try, so the
     **largest spaces silently didn't sync**. Fixed: `_upsert()` now **chunks** to
     ~8000 params/statement (`api/companies/sync.py`).
   - **Sync concurrency.** `sync_full`/`sync_incremental` didn't hold the lock (only
     `run_sync` did), so overlapping calls (cron + manual + direct) interleaved and
     corrupted `is_lost`/partial fetches. Fixed: lock is now a re-entrant `RLock` and
     both functions acquire it via `_sync_full_locked`/`_sync_incremental_locked`.
   - After both fixes a clean full sync ingests all **9,779 tasks** (KT_CRM included).

3. **Visual:** search-results list now shows each company's deal value inline, with
   no-deal companies flagged "— no deals" (muted pill + dimmed row) so they're obvious
   without expanding. Detail view already shows **deals only** (no Accounts/Contacts).

4. **Cleanup done** (see Remaining-work #2): v1 in-memory code removed from
   `api/clickup/server.py`, old test harness deleted, clickup `.env.example` trimmed.

---

## What this session built

A new **Company Finder** dashboard: search a company by name (or `TID-XXXXX`) and see
the **total Deal Value (fees)** it has accrued across deals, plus its deal tasks across
all 10 ClickUp CRM spaces. It went through two iterations:

1. **v1 (in-memory)** — search across spaces via an in-memory index on the existing
   `clickup-fees` service (`/api/clickup/company/*`). Worked, but had a disruptive
   2-3 min cold-rebuild every 15 min and couldn't do fee aggregation.
2. **v2 (master DB) — the keeper.** A dedicated **`companies-api`** service backed by a
   persistent SQLite database, incrementally synced. This is what we're shipping.

The v1 in-memory endpoints are still in `api/clickup/server.py` as a fallback and must
be **removed** as the final cleanup step (see "Remaining work").

---

## Architecture (v2 — the master DB)

**New service: `companies-api`, port 8003** — mirrors the Valuation API pattern
(SQLite WAL, systemd, sandboxed). Lives in `api/companies/`:

| File | Purpose |
|------|---------|
| `build_database.py` | SQLAlchemy schema (`tasks`, `companies`, `sync_state`) + WAL engine |
| `sync.py` | sync engine: full / incremental / deletion-reconcile / per-TID rollup |
| `main.py` | FastAPI routes (`/api/companies/*`) |
| `OUTLINE.md` | build/ops guide (was README.md, renamed). **This is the build doc.** |
| `.env.example`, `requirements.txt`, `Dockerfile` | support |
| `companies.db` | the master DB — gitignored, built by sync, ~9.8k tasks |
| `_local_test_server.py` | THROWAWAY combined test harness (gitignored `_*.py`) |

**Data model (profiled from live ClickUp):**
- 9,779 tasks / 6 list types. Company name lives in the **task title**.
- **`Clickup_TID`** (`TID-XXXXX`) = join key on every task (present on 99% of Deals).
- **Fees = the `Deal Value` currency field on `Deals`-list tasks** (EUR). The `Fees`
  field is AML-only and intentionally NOT used here.
- Headline = `SUM(Deal Value)` over **active** deals; **rejected/lost** deals shown
  separately. Lost statuses (env `COMPANIES_LOST_STATUSES`, default
  `rejected,on hold - stall`).
- Deal statuses seen: approved (1,841/€5.9M), proposal, completed, rejected,
  on hold - stall, on track - after proposal, discussions, new.

**Sync (the efficiency win):**
- `sync_full()` — initial/rebuild, fetches all spaces (~2-3 min). Also reconciles
  deletions (drops rows with `synced_at` < run start).
- `sync_incremental()` — fetches only tasks changed since each space's high-water mark
  via ClickUp `date_updated_gt`. **~12s.** This is the every-3-min cron job.
- Deletion reconcile (re-lists all spaces, heavy ~330s) is **gated to run at most every
  15 min** (`COMPANIES_RECONCILE_INTERVAL_MS`) so the 3-min tick stays light.
- Bulk upsert via SQLite `INSERT … ON CONFLICT DO UPDATE`. One sync at a time (lock).

**Endpoints** (`/api/companies/*`, nginx → 8003):
- `GET /search?q=` — name/TID → companies + fee totals, cap 50 + truncation note.
- `GET /{tid}` — **DEAL tasks only**, grouped by space, split active/lost. `has_deals` flag.
- `GET /sync` — incremental (`?full=true` rebuild, `?wait=true` block). Cron + Refresh btn.
- `GET /status` — DB counts, per-space last sync, last reconcile.
- `GET /health`.
- NOTE: `/sync` is registered BEFORE `/{tid}` so it isn't captured as tid="sync".

**Frontend** — `components/pages/companies.js` + `styles/pages/companies.css`:
- Fee headline per company (Total Deal Value + active count; `—` / "no deals" when none).
- Expand a card → lazy `GET /{tid}` → **deal tasks only**, per space, active + (red)
  rejected/lost groups. No-deal company shows "— No deal tasks for this company."
- Refresh button (top-right) → `/sync?wait=true` → re-runs current search; "Updated X ago".
- EUR via `Intl.NumberFormat('en-IE', …)`. Relative `/api/companies/*` (no localhost).

---

## Verified (local, against live ClickUp)

- DB built: **9,779 tasks / 4,515 companies / 10 spaces**.
- Fee rollup correct: SCALEZO (TID-42165) → €4,500 active (1 approved deal), the 2
  Accounts rows excluded; grand total active ≈ €6.06M.
- Detail = deals only (verified SCALEZO shows just its KT_CRM deal; no-deal company
  `1spin4win`/TID-40005 → `has_deals:false`).
- Incremental **11.9s** vs reconcile 338s → gating confirmed working.
- All endpoints via TestClient + through the combined proxy on :8080. AML `/fees`
  unaffected. Search cap (LIMITED → 50 of 1881) works.

---

## Remaining work (resume here tomorrow)

1. **UI confirmation** — user was re-testing in the browser
   (`http://127.0.0.1:8080/index.html` → Company Finder) when we paused. Confirm:
   deals-only detail, `—` for no-deal companies, refresh button, lost-deals styling.
2. **Cleanup — DONE (day 2).** Removed v1 in-memory company code from
   `api/clickup/server.py` (routes `company_search`/`company_refresh`/`company_status`,
   all index/cache helpers, `threading` warm-up, startup warm, the `COMPANY_*` config,
   and the `re`/`threading` imports). Verified: companies API works, AML `/fees` works,
   old `/api/clickup/company/search` → 404. Deleted `api/clickup/_local_test_server.py`.
   Removed the orphaned `CLICKUP_SPACE_IDS` block from `api/clickup/.env.example`
   (now points to `api/companies/.env`).
3. **Optional polish:** `OUTLINE.md` top heading still says "# Company Finder API"
   (reads like a README) — could retitle. Minor.
4. **Commit — NOT YET DONE (user asked to hold).** On a branch (repo deploys via
   push→pull). Files: see git state below. Do NOT commit `api/companies/.env`,
   `companies.db`, or `_*.py` (all gitignored).
5. **Deploy to server (192.168.0.221):**
   - `git pull` on server.
   - `cd ~/treppides-hub/api/companies` → create venv, `pip install -r requirements.txt`,
     `cp .env.example .env` and fill `CLICKUP_API_TOKEN` + `CLICKUP_SPACE_IDS` (same 10
     space IDs as `api/clickup/.env`), `chmod 600 .env`.
   - Initial build: `python sync.py --full` (~2-3 min).
   - `sudo cp companies-api.service /etc/systemd/system/ && sudo systemctl enable --now companies-api`.
   - Add nginx location (already in `nginx-treppides-hub.conf`) → `sudo nginx -t && sudo systemctl reload nginx`.
   - Add cron: `*/3 * * * * curl -s http://127.0.0.1:8003/api/companies/sync >/dev/null`.
   - (SETUP.sh now does venv+service+cron+build automatically; OUTLINE.md/SERVER-OPS.md have the manual steps.)
   - Verify: `curl http://127.0.0.1:8003/api/companies/status`.

---

## Git state at session end (branch `main`, last commit 3098c62)

**Modified (v1 + wiring + infra/docs):** `.gitignore`, `STATUS.md`, `SERVER-OPS.md`,
`SETUP.sh`, `backup.sh`, `nginx-treppides-hub.conf`, `index.html`, `main.js`,
`components/shell/sidebar.js`, `api/clickup/server.py`, `api/clickup/.env.example`.

**New (untracked):** `api/companies/` (whole dir — main.py, sync.py, build_database.py,
OUTLINE.md, .env.example, requirements.txt, Dockerfile), `companies-api.service`,
`components/pages/companies.js`, `styles/pages/companies.css`, `COMPANY_DB_DESIGN.md`,
this `SESSION_16.md`.

**Note (day 2):** `api/clickup/server.py` is now SMALLER than its v1 state — the
in-memory company code was removed. AML `/fees` + upload routes unchanged.

**Gitignored (won't push):** `api/companies/.env`, `api/companies/companies.db`(+wal/shm),
`api/companies/venv/`, `api/companies/_*.py`, `api/clickup/.env`, `config.js`.

**Heads-up:** `api/clickup/__pycache__/server.cpython-313.pyc` shows as modified —
`__pycache__` is gitignored so this shouldn't matter, but double-check it's not staged.

---

## Open decisions already settled (don't re-ask)
- Own service (companies-api 8003) ✓ · EUR ✓ · Deal Value only (not Fees) ✓ ·
  active vs rejected/lost split ✓ · 3-min sync + 15-min reconcile + refresh button ✓ ·
  detail shows deals only ✓ · no-deal companies shown with `—` ✓.

## Reference docs in repo
- `COMPANY_DB_DESIGN.md` — full feasibility/design write-up.
- `api/companies/OUTLINE.md` — build & ops guide (THE build doc for companies.db).
- Plan file (local, not in repo): `~/.claude/plans/serialized-wiggling-hare.md`.
