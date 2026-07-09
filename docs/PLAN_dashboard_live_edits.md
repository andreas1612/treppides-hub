# Plan — Live Edits on the Group Dashboard → ClickUp

**Goal:** Let a Hub user edit a deal's **Status** and **Assignee**, and post a **Comment**,
directly from the Group Dashboard's per-deal detail card, writing straight through to ClickUp.

**Decisions locked with the user:**
- Editable: **Status**, **Assignee** (single, replaceable), **Comment** (→ ClickUp comment thread, *not* Description overwrite).
- Freshness: **optimistic UI update + targeted single-task re-sync** (beats the ~3-min mirror lag).
- Security: **require login (Azure SSO via `/projects/api/me`) + audit log** on every write.
- Level: edits act on an **individual deal task**, not the company rollup.

---

## Why this is mostly integration, not new work

- The dashboard is `components/pages/companies.js`, served read-only by **companies-api (port 8003)**
  (`api/companies/main.py`), which reads a SQLite mirror (`companies.db`) synced from ClickUp by `api/companies/sync.py`.
- The **companies service already has the ClickUp token** loaded (`sync.py:31`) and its own `requests` client,
  so it can both write to ClickUp and reconcile one row locally — no dependency on the 8001 service.
- Each deal row already carries the **ClickUp task id** (`_task_dict` exposes `t.id`, `main.py:261`),
  so the frontend already has the exact identifier to target a write. `assignees` and `status` are already serialized.
- Write patterns are proven: `api/clickup/server.py` already POSTs to ClickUp to create tasks + attachments
  (`server.py:712`, `:728`) and has value-coercion + status validation (`server.py:580-655`, `:682`).
- Reusable dropdown sources already exist in the 8001 service: `GET /api/clickup/forms/{key}/statuses` (`server.py:844`)
  and `GET /api/clickup/forms/{key}/members` (`server.py:810`).

## ClickUp write targets (all native task fields → one endpoint each)

| Field    | ClickUp call                                   | Body                                            | Notes |
|----------|------------------------------------------------|-------------------------------------------------|-------|
| Status   | `PUT /api/v2/task/{id}`                         | `{"status": "<name>"}`                           | **native task status**; validate against list's live statuses |
| Assignee | `PUT /api/v2/task/{id}`                         | `{"assignees": {"add": [newId], "rem": [oldIds]}}` | single, replaceable |
| Comment  | `POST /api/v2/task/{id}/comment`               | `{"comment_text": "<hub user> — <text>"}`        | appends; non-destructive |

Comment attribution in ClickUp is the *token's* user, so we prefix the Hub user's name/email into the body,
and the audit log is the authoritative record of who did it.

---

## Build order (phased)

### Phase 0 — Prerequisite: server-side auth on companies-api
Today `js/auth.js` only checks identity in the browser; the 8003 API trusts nothing/nobody.
Before any write route exists, add a backend auth dependency.

- **New:** `api/companies/auth.py`
  - `require_user(request)` FastAPI dependency: reads the session cookie, calls `GET {TM}/api/me`
    (server-to-server, forwarding the cookie) — mirrors `auth.js:27`. Returns the user dict.
  - Reject if not authenticated (401) or `tier == "NONE"` (403) — same gate as `auth.js:37`.
  - Config: `TM_INTERNAL_BASE` env (e.g. `http://127.0.0.1:8080`) so 8003 reaches Task Manager directly.
- Apply **only to write routes** in Phase 2 (reads stay open to avoid regressing the dashboard;
  tighten later as a separate hardening pass tied to the open no-auth finding).

### Phase 1 — ClickUp write client + single-task reconcile
- **New:** `api/companies/clickup_write.py`
  - `update_task(task_id, patch: dict)` → `PUT /task/{id}` (status / assignees). Reuse `_headers()`, error handling à la `server.py:718-724`.
  - `add_comment(task_id, text)` → `POST /task/{id}/comment`.
  - `list_statuses(list_id)` and `list_members()` — thin GET wrappers (or proxy the existing 8001 endpoints; prefer local to keep one service self-contained).
- **Edit:** `api/companies/sync.py`
  - `fetch_task(task_id)` → `GET /task/{id}` (single).
  - `sync_one(task_id)`: fetch → `normalize()` → `_upsert(session, [row], space_name_map)` → `rebuild_companies(session)`.
    Acquire the existing `_sync_lock` so it can't interleave with a bulk sync.

### Phase 2 — Write endpoints on companies-api
- **Edit:** `api/companies/main.py` — add under the existing router, all `Depends(require_user)`:
  - `PUT  /api/companies/deals/{task_id}/status`   body `{status}`
  - `PUT  /api/companies/deals/{task_id}/assignee` body `{assignee_id | null}`
  - `POST /api/companies/deals/{task_id}/comment`  body `{text}`
  - Each route: validate input → `clickup_write.*` → on success `sync.sync_one(task_id)` → return the fresh `_task_dict`.
  - Guard: confirm the target row exists and `is_deal` before writing.
- **New:** `api/companies/audit.py` — append-only log (`who` email, `task_id`, `field`, `old`→`new`, ISO timestamp).
  Persist to a new `AuditLog` table in `companies.db` (model added to `build_database.py`) — queryable,
  transactional with the same session, and restart-safe (chosen over a JSONL file).

### Phase 3 — Editable UI in the detail card
- **Edit:** `components/pages/companies.js`
  - In `taskRow`/`renderDetail` (`companies.js:170-204`, `:275`), for deal tasks render Status + Assignee as inline dropdowns
    and add a small "Add comment" control. Populate dropdowns from the status/member endpoints (cache per session).
  - Save handler: optimistic swap in the DOM → `PUT/POST` to the new endpoints (with `credentials:"include"`) →
    on success reconcile from the returned `_task_dict`; on error revert + toast.
  - Keep read views untouched; only the expanded per-deal detail becomes editable.
- **Edit:** `styles/pages/companies.css` — styles for inline editors + saving/error states.

### Phase 4 — Ops
- **Edit:** `nginx-treppides-hub.conf` — the `/api/companies/` block (`:247`) already proxies all methods;
  confirm PUT/POST pass through and that the rate-limit zone is acceptable for writes.
- Test end-to-end against a **non-production ClickUp deal** first (writes are real and immediate).
- Update `STATUS.md` / `NEXT_SESSION.md`.

---

## Risks & notes
- **Two services share one full-access `pk_` token** — this wires it into a UI write path; ties into the open
  token-rotation TODO. Consider a scoped token if ClickUp allows.
- **This forces the 8003 auth fix** (open no-auth finding) — prerequisite, but a net positive.
- **Optimistic + reconcile** keeps the mirror consistent, but `sync_one` failing after a successful ClickUp write
  leaves the DB briefly stale until the next 3-min tick — acceptable, and the write itself already succeeded.
- **No PUT/PATCH existed to ClickUp before** — `update_task` is new (~15 lines), following the create-task pattern.
- Concurrent edits: last-write-wins at ClickUp (same as editing in ClickUp directly); audit log preserves history.

## Files touched (summary)
- New: `api/companies/auth.py`, `api/companies/clickup_write.py`, `api/companies/audit.py`
- Edit: `api/companies/main.py`, `api/companies/sync.py`, `api/companies/build_database.py` (audit model),
  `api/companies/.env(.example)` (`TM_INTERNAL_BASE`), `components/pages/companies.js`,
  `styles/pages/companies.css`, `nginx-treppides-hub.conf`, `STATUS.md`/`NEXT_SESSION.md`
