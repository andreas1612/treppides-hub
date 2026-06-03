# Company Master Database — Feasibility & Design

> Status: **design proposal for review** (not yet implemented).
> Supersedes the in-memory index in the current Company Task Finder.

## Why (the problem)

The current Company Finder builds an **in-memory** index by fetching all ~9,800
tasks across the 10 spaces, with a 15-minute TTL. Two consequences:

1. **Disruptive cold starts.** Every 15 min the cache expires; the next user's
   search triggers a full ~2-3 min re-fetch. (Observed live mid-session.)
2. **No real aggregation.** The dashboard's *main* goal — **total fees a company
   has accrued across its deals** — needs durable, queryable, joined data, not a
   transient list.

A persistent, incrementally-synced **master database** fixes both: searches and
fee totals become instant SQL queries, and the data is never lost or rebuilt
from scratch.

## What the data actually looks like (profiled from live ClickUp)

9,779 tasks across the 10 CRM spaces, in 6 list types:

| List | Count | Role |
|---|---|---|
| Contacts | 3,988 | People linked to companies |
| **Accounts (Companies)** | 3,573 | **Company master record** — carries `Clickup_TID`, client code, directors, etc. |
| **Deals** | 1,877 | **Fee-bearing engagements** |
| Leads | 233 | Prospects |
| Accounts (Individuals) | 105 | Individual clients |
| Form | 3 | Intake submissions |

**Fees live on Deal tasks, not company tasks.** Two currency fields:
- `Deal Value` — 1,805 Deal tasks populated (primary fee figure)
- `Fees` — 263 tasks (already used by the AML dashboard)

**The join works.** Of 1,877 Deal tasks: 1,858 carry `Clickup_TID` (99%), 1,786
have both a TID and a Deal Value. So:

```
total fees for a company  =  SUM(Deal Value) over Deal tasks WHERE tid = <company TID>
```

Deals also carry a **status** (proposal / approved / …), so fees can be broken
down by deal stage. The company name lives in the **task title** (confirmed: no
dedicated name field); `Clickup_TID` (format `TID-XXXXX`) is the join key on
every task type.

## Feasibility verdict: **clearly feasible, recommended**

- **Incremental sync is cheap and supported.** The filtered-tasks endpoint
  accepts **`date_updated_gt`** (Unix ms). After one initial full load, each sync
  fetches only tasks changed since the last run — typically a handful, not 9,800.
  This is the key enabler for "update the DB when new entries show up."
- **Proven local pattern.** The Valuation API already runs SQLite (WAL) under a
  hardened systemd service. We reuse that exact shape — no new infrastructure
  type, no new ops burden.
- **Webhooks exist** (`taskCreated/Updated/Deleted`, scoped per space) for true
  real-time, but require ClickUp to POST to a reachable URL — awkward on a
  LAN-only server. **Recommendation: poll with `date_updated_gt`** (no inbound
  exposure); webhooks remain a clean future upgrade.

## Proposed architecture

### Storage: SQLite (WAL), mirroring the Valuation API

A new database `api/companies/companies.db` served by either:
- **(Recommended) the existing `clickup-fees` service** — add the DB + sync there,
  since it already holds the ClickUp token and CORS config. One service, one token.
- *(Alt)* a dedicated `companies-api` on port 8003 like the valuation service.
  Cleaner separation but another systemd unit. Decide before build.

### Schema

```sql
-- Every task, fully annotated so ORIGIN is never lost and DETAILS are preserved.
CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,         -- ClickUp task id
  tid           TEXT,                     -- Clickup_TID (company code), nullable
  name          TEXT,                     -- task title (company name lives here)
  list_name     TEXT,                     -- 'Deals' | 'Accounts (Companies)' | ...
  folder_name   TEXT,
  space_id      TEXT,
  space_name    TEXT,                     -- origin space (denormalized for fast reads)
  status        TEXT,
  status_color  TEXT,
  url           TEXT,
  assignees     TEXT,                     -- JSON array of names
  deal_value    REAL,                     -- parsed 'Deal Value' (NULL if absent)
  fees          REAL,                     -- parsed 'Fees'
  currency      TEXT,                     -- currency code if available
  date_created  INTEGER,                  -- Unix ms
  date_updated  INTEGER,                  -- Unix ms — drives incremental sync
  date_due      INTEGER,
  custom_fields TEXT,                     -- full JSON blob — nothing is lost
  raw           TEXT,                     -- optional: full raw task JSON (audit/debug)
  synced_at     INTEGER
);
CREATE INDEX idx_tasks_tid  ON tasks(tid);
CREATE INDEX idx_tasks_name ON tasks(name COLLATE NOCASE);
CREATE INDEX idx_tasks_list ON tasks(list_name);

-- Derived per-company rollup (rebuilt/updated after each sync). Optional —
-- could also be a VIEW; a table is faster for the dashboard's default sort.
CREATE TABLE companies (
  tid              TEXT PRIMARY KEY,
  display_name     TEXT,                  -- best-guess from Accounts(Companies) title
  client_code      TEXT,
  task_count       INTEGER,
  deal_count       INTEGER,
  total_deal_value REAL,                  -- THE headline number: SUM(deal_value)
  total_fees       REAL,
  space_names      TEXT,                  -- JSON: spaces this company appears in
  last_activity    INTEGER                -- max(date_updated)
);

-- One row per space: where incremental sync resumes from.
CREATE TABLE sync_state (
  space_id        TEXT PRIMARY KEY,
  last_synced_ms  INTEGER,                -- max date_updated seen; next sync uses date_updated_gt = this
  last_run_ms     INTEGER,
  last_status     TEXT
);
```

Optionally a **FTS5** virtual table on `tasks(name)` for fast fuzzy company-name
search — nice-to-have; the `NOCASE` index covers substring search adequately at
this scale.

### Sync engine

- **`sync_full()`** — first run (or manual rebuild). Paginate all spaces once,
  upsert every task, record `max(date_updated)` per space into `sync_state`.
- **`sync_incremental()`** — for each space, fetch
  `?space_ids[]=<s>&date_updated_gt=<sync_state.last_synced_ms>&include_closed=true&subtasks=true`,
  upsert the (usually few) changed tasks, advance `last_synced_ms`. Then refresh
  the affected `companies` rollup rows.
- **Deletions** — `date_updated_gt` can't see deletes. Handle via either
  (a) a periodic full reconcile (e.g. nightly: list all live task ids, mark
  missing as deleted), or (b) webhooks later. Low urgency for fee accuracy.
- **Scheduling** — a background thread on a timer (e.g. every 3-5 min) inside the
  service, OR a cron job hitting a `/sync` endpoint (consistent with the existing
  `backup.sh`/`healthcheck.sh` cron pattern in SERVER-OPS.md). Cron is simpler to
  reason about and observe.
- **Upsert** = `INSERT … ON CONFLICT(id) DO UPDATE`. Idempotent; safe to re-run.

### API endpoints (served behind nginx `/api/clickup/*`, no localhost in frontend)

| Endpoint | Purpose |
|---|---|
| `GET /company/search?q=` | name/TID search — instant SQL `LIKE`/exact on `tasks`, grouped by company. Returns the same rich shape the frontend already renders, **plus** `total_deal_value` / `total_fees` per company. |
| `GET /company/{tid}` | full company detail: all tasks grouped by space + list, fee rollup, deal-by-stage breakdown. |
| `GET /company/sync` | trigger incremental sync (cron/manual); `?full=true` for a rebuild. Returns counts + timing. Non-blocking. |
| `GET /company/status` | DB freshness: row counts, last sync time per space. |

Searches no longer ever return an "indexing" state — the DB is always queryable;
sync happens in the background and only ever *adds* freshness.

### Fee aggregation (the headline feature)

```sql
-- Total fees a company has accrued across all its deals:
SELECT tid,
       SUM(deal_value)                        AS total_deal_value,
       COUNT(*) FILTER (WHERE list_name='Deals') AS deal_count
FROM tasks
WHERE tid = :tid
GROUP BY tid;

-- Broken down by deal stage (proposal vs approved vs …):
SELECT status, COUNT(*), SUM(deal_value)
FROM tasks WHERE tid = :tid AND list_name = 'Deals'
GROUP BY status;
```

The dashboard surfaces, per company: **total deal value**, deal count, a
stage breakdown, and the full task list grouped by origin space — with every
task's details and origin intact (the `tasks` row + `custom_fields` JSON).

## Migration path (low risk, incremental)

1. **Build the schema + sync engine** in `api/companies/` (DB build script mirrors
   `api/valuation/build_database.py`). Keep the existing in-memory endpoints live.
2. **Run an initial `sync_full()`** on the server (one-time ~2-3 min, off-peak).
3. **Point the existing search endpoint at the DB** (swap the in-memory filter for
   SQL). The frontend `companies.js` barely changes — same response shape, plus a
   fee total to display.
4. **Add the fee rollup to the UI** — the headline "Total fees: €X across N deals".
5. **Wire the sync** (cron every few min + manual refresh button/endpoint).
6. **Retire** the in-memory index + 15-min TTL cold-start machinery.
7. **`.gitignore`** the `.db` (like the valuation DB — rebuilt on server, not
   committed).

## Open questions to settle before implementation

1. **Service placement** — fold into existing `clickup-fees`, or a new
   `companies-api` service (port 8003)? (Recommend: fold in.)
2. **Currency** — are Deal Values all in EUR, or multi-currency? If mixed, do we
   need FX normalization (the valuation API already has FX data we could reuse) or
   show per-currency subtotals?
3. **Which fee field is authoritative** — `Deal Value` only, or `Deal Value` +
   `Fees`? Should closed/rejected/lost deals be included in the total or shown
   separately?
4. **Sync cadence** — every 3 min? 5? And do we want a manual "Refresh" button in
   the dashboard for power users?
5. **Deletions** — is a nightly reconcile enough, or do stale/deleted deals need to
   disappear within minutes (→ webhooks)?
```
