# Company Finder — Build & Ops Guide

FastAPI backend (port **8003**, service `companies-api`) for the Hub's **Company
Finder** dashboard. It maintains a persistent SQLite **master database**
(`companies.db`) mirroring every ClickUp task across the 10 CRM spaces, and serves
instant company search plus **Deal Value (fee) totals** per company.

## Why a database (not a live index)

Searching ClickUp live / rebuilding an in-memory index meant a 2-3 min cold fetch
every cache cycle. This service instead keeps a local mirror, refreshed
**incrementally** (only tasks changed since the last sync, via ClickUp's
`date_updated_gt`), so searches and fee rollups are instant SQL queries.

## Data model

- **Company name** lives in the ClickUp **task title**.
- **`Clickup_TID`** (`TID-XXXXX`) is the join key on every task — same company,
  same TID across all spaces. (CRM TIDs were corrected 2026-06-03, which
  consolidated companies previously split across mismatched codes.)
- **Fees** = the **`Deal Value`** currency field on tasks in the **`Deals`** list
  (EUR). The `Fees` field is AML-specific and intentionally NOT used here.
- A company's headline total = `SUM(Deal Value)` over its **active** deals.
  **Rejected/lost** deals are summed and shown separately — a deal is "lost" when
  its status is in `COMPANIES_LOST_STATUSES` (env, default
  `rejected,approved terminated`).
- The dashboard **detail view shows DEAL tasks only** (Accounts/Contacts/Leads/
  Forms are excluded); companies with no deals show a `—` indicator.
- **Promoted, indexed columns** on `tasks` for filtering/sorting/display (also kept
  in the `custom_fields` JSON): `service`, `year_of_project`, `business_year`,
  `department`, `dashboard_tid`, plus `ubos` (JSON array of normalized UBO names
  from the ~55 `ubo*` slot fields). `companies.ubos` holds the union per company.
- **Two grouping keys.** `Clickup_TID` (`TID-XXXXX`) = per-company; `dashboard_tid`
  (`Dashboard TID`, `GID-XXXXX`) = a higher-level GROUP key that rolls several
  companies under one dashboard group. The list/search/detail/UBO key on TID; the
  **chart 'by company' groups on GID** (see below).
- **Subtasks:** `Task.parent_id` (ClickUp parent id) + `Task.parent_name` (resolved
  in a 2nd sync pass from the fetched task set). Deal rows show "↳ subtask of {parent}".
- **UBOs live on company/account tasks, not deals.** The chart attributes a deal's
  value to its company's UBOs (via TID) — full value to each UBO. UBO names are
  lightly normalized (case/trim, strip trailing "(NN%)", drop "null").

> ⚠ `is_lost` is computed and stored on each task **at sync time**. Changing
> `COMPANIES_LOST_STATUSES` only takes effect after a re-sync — run
> `python sync.py --full` (or `curl '.../sync?full=true&wait=true'`).

## Files

| File | Purpose |
|------|---------|
| `build_database.py` | SQLAlchemy schema (`tasks`, `companies`, `sync_state`) + WAL engine |
| `sync.py` | sync engine: full / incremental / deletion-reconcile / rollup |
| `main.py` | FastAPI app + routes |
| `.env.example` | template for `.env` (gitignored) |
| `companies.db` | the master DB (gitignored — rebuilt here, not committed) |

## How sync works

- **Incremental** (`sync_incremental`, the every-3-min cron): fetches only tasks
  changed since each space's high-water mark via `date_updated_gt`. ~10s.
- **Deletion reconcile**: heavier (re-lists all spaces to find vanished tasks), so
  it's gated to run at most once per `COMPANIES_RECONCILE_INTERVAL_MS` (default 15
  min). A `sync_full` always reconciles.
- **Full** (`sync_full`): re-fetches everything, rebuilds the rollup. Used for the
  initial build and after config changes.
- Sync is serialized by a re-entrant lock, and the bulk upsert is **chunked** to
  stay under SQLite's 32,766 bound-param limit (a single space can have ~6.9k
  rows). Both were real bugs fixed on 2026-06-03 — don't undo them.

## Setup (server)

```bash
cd ~/treppides-hub/api/companies
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill CLICKUP_API_TOKEN + CLICKUP_SPACE_IDS; chmod 600 .env
# initial full build (~2-3 min):
python sync.py --full
```

Install the service + 3-minute sync cron (see `../../SERVER-OPS.md`):

```bash
sudo cp ../../companies-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now companies-api
# crontab -e →  */3 * * * * curl -s http://127.0.0.1:8003/api/companies/sync >/dev/null
```

`../../SETUP.sh` automates the venv + service + cron + initial build.

## Endpoints

All search/browse/detail endpoints accept the optional **deal-level filters**
`space`, `year` (year_of_project), `business_year`, `service`, `assignee`,
`department` (comma-separated multi-value; ANY within a field, AND across fields).
`space` matches the raw space_name. When any filter is active, **Deal Value totals
recompute over the matching deals only**.

`GET /filters` is **cascading**: pass the current filters and each field's option
list is scoped to the others (e.g. `?space=ZK_CRM` → services/departments/years
narrow to that space). It returns `{spaces, years, business_years, assignees,
services, departments}`.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/companies/search?q=&<filters>` | search by company name or TID → companies + (filtered) active/lost fee totals (cap 50) |
| `GET /api/companies/companies?q=&sort=&dir=&page=&page_size=&include_nodeal=&<filters>` | The unified list (search built in). `q`=whole-word name/TID search. Sortable (`deal_value\|name\|deal_count\|last_activity`), paginated. Default deals-only; `include_nodeal=true` adds no-deal companies. Returns `grand_active_deal_value` |
| `GET /api/companies/chart?by=company\|ubo&select=&top=&<filters>` | Bar-chart data: active Deal Value. **`by=company` groups on `dashboard_tid` (GID)** — each bar = one dashboard group; `select`=comma GID keys; label = a **supername** (longest common leading words across the group's `company_name`s, e.g. "Capital Com"). `by=ubo` attributes each company's value to each of its UBOs. `select` empty → top-N (default 15, `top` cap 2000 so the picker can list all groups) |
| `GET /api/companies/ubos?q=&limit=` | Distinct UBO names with attributable Deal Value (ranked) — for the chart's UBO picker |
| `GET /api/companies/deals?q=&page=&page_size=&<filters>` | Flat list of individual DEAL tasks (active + lost) for the Custom Total picker. Honours filters + whole-word search; each row has value/status/service/space/company. Total is summed client-side from ticked rows |
| `GET /api/companies/filters` | CASCADING option lists: `{spaces, years, business_years, assignees, services, departments}` (scoped to the other active filters) |
| `GET /api/companies/{tid}?<filters>` | company detail: **deal tasks only**, grouped by space, split active vs rejected/lost (`has_deals` flag); honours filters |
| `GET /api/companies/sync` | incremental sync (+ gated reconcile); `?full=true` rebuild, `?wait=true` block |
| `GET /api/companies/status` | DB counts + per-space last-sync info |
| `GET /api/companies/health` | `{ok:true}` |

## Manual sync / rebuild

```bash
source venv/bin/activate
python sync.py            # incremental
python sync.py --full     # full rebuild (also re-applies COMPANIES_LOST_STATUSES)
```

## Local testing (off-server)

There is no committed test harness. To exercise the UI + both APIs on one origin
without nginx, run a throwaway combined server (mount the companies app + clickup
app + static repo) — name it `_something.py` so it's gitignored (`api/*/_*.py`).
