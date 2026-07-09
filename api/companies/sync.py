# ============================================================
# api/companies/sync.py — the sync engine for the Company Master DB.
#
#   sync_full()         — initial / rebuild: fetch every task, upsert all.
#   sync_incremental()  — fetch only tasks changed since last sync
#                         (ClickUp date_updated_gt), upsert the few that changed.
#   reconcile_deletions() — drop DB rows for tasks no longer present in ClickUp.
#   rebuild_companies() — recompute the per-TID rollup from `tasks`.
#
# Sync is serialized by a lock and runnable in a background thread so the
# 3-minute cron trigger and a manual Refresh button never overlap destructively.
# ============================================================

import os
import re
import json
import time
import logging
import datetime
import threading

import requests
from dotenv import load_dotenv
from sqlalchemy import func, select, delete
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from build_database import Task, Company, SyncState, SessionLocal, init_db

load_dotenv()

CLICKUP_API_TOKEN = os.getenv("CLICKUP_API_TOKEN", "")
SPACE_IDS = [s.strip() for s in os.getenv("CLICKUP_SPACE_IDS", "").split(",") if s.strip()]
TEAM_ID_ENV = os.getenv("CLICKUP_TEAM_ID", "").strip()

# Deal statuses that count as Rejected/Lost — excluded from the headline total
# and shown separately. Tunable via env (comma-separated) without code changes.
_DEFAULT_LOST = "rejected,on hold - stall"
LOST_STATUSES = {
    s.strip().lower()
    for s in os.getenv("COMPANIES_LOST_STATUSES", _DEFAULT_LOST).split(",")
    if s.strip()
}

DEALS_LIST = "deals"  # list_name (lowercased) that carries Deal Value

# Deletion reconcile re-lists every task across all spaces (~9.8k) to find rows
# that vanished — too heavy to run on every 3-min incremental tick. Run it at
# most once per this interval. Deletions are still caught "within minutes".
RECONCILE_MIN_INTERVAL_MS = int(os.getenv("COMPANIES_RECONCILE_INTERVAL_MS", str(15 * 60 * 1000)))
_RECONCILE_KEY = "__reconcile__"  # sentinel row in sync_state tracking last reconcile

_API = "https://api.clickup.com/api/v2"

# Sync coordination — one sync at a time across cron + manual triggers + direct
# CLI calls. RLock so run_sync() can hold it while calling sync_full/incremental,
# which also acquire it (re-entrant in the same thread). A second thread trying
# to sync blocks until the first finishes, preventing the interleaving that
# corrupts is_lost / partial fetches.
_sync_lock = threading.RLock()
_syncing = False
_team_id_cache = None


def _headers():
    return {"Authorization": CLICKUP_API_TOKEN}


def _now_ms() -> int:
    return int(time.time() * 1000)


def get_team_id() -> str:
    global _team_id_cache
    if TEAM_ID_ENV:
        return TEAM_ID_ENV
    if _team_id_cache:
        return _team_id_cache
    r = requests.get(f"{_API}/team", headers=_headers(), timeout=30)
    r.raise_for_status()
    teams = r.json().get("teams", [])
    if not teams:
        raise RuntimeError("No ClickUp workspace available for this token.")
    _team_id_cache = str(teams[0]["id"])
    return _team_id_cache


# ---- ClickUp custom-field resolvers (ported from api/clickup/server.py) ----

def _resolve_dropdown(cf):
    raw = cf.get("value")
    if raw is None:
        return None
    for opt in cf.get("type_config", {}).get("options", []):
        if str(opt.get("orderindex")) == str(raw):
            return opt.get("name")
    return None


def _resolve_labels(cf):
    val = cf.get("value")
    if not val or not isinstance(val, list):
        return None
    id_map = {o["id"]: o.get("label", "?") for o in cf.get("type_config", {}).get("options", [])}
    names = [id_map.get(v, v) for v in val]
    names = [n for n in names if n and n != "null"]
    return ", ".join(names) if names else None


def _resolve_date(cf):
    val = cf.get("value")
    if not val:
        return None
    try:
        return datetime.datetime.fromtimestamp(int(val) / 1000).strftime("%Y-%m-%d")
    except (ValueError, TypeError, OSError):
        return None


def _flatten_custom_fields(task: dict) -> dict:
    """Flatten ALL custom fields into a snake_cased dict (mirrors
    extract_task_fields in server.py). 'Clickup_TID' → 'clickup_tid'."""
    out = {}
    for cf in task.get("custom_fields", []):
        name = cf.get("name", "")
        ftype = cf.get("type", "")
        key = name.lower().replace(" ", "_").replace("/", "_").replace("?", "")
        if ftype in ("short_text", "text", "url", "email", "phone"):
            out[key] = (cf.get("value") or "").strip() or None
        elif ftype in ("currency", "number"):
            raw = cf.get("value")
            try:
                out[key] = float(raw) if raw not in (None, "", []) else None
            except (ValueError, TypeError):
                out[key] = None
        elif ftype == "drop_down":
            out[key] = _resolve_dropdown(cf)
        elif ftype == "labels":
            out[key] = _resolve_labels(cf)
        elif ftype == "date":
            out[key] = _resolve_date(cf)
        else:
            v = cf.get("value")
            out[key] = str(v) if v is not None else None
    return out


_UBO_KEY_RE = re.compile(r"^ubo(_?\d+)?$")        # ubo, ubo_2..ubo_9, ubo10..ubo55
_UBO_PCT_RE = re.compile(r"\s*\(\s*\d+(\.\d+)?\s*%?\s*\)\s*$")  # trailing "(100%)" / "(50)"

def extract_ubos(fields: dict) -> list[str]:
    """Collect + lightly normalize UBO names from the ~55 ubo* slot fields.
    Case/space normalized and trailing '(NN%)' stripped so 'ANTON KRASNYY' and
    'Anton Krasnyy (100%)' merge; literal 'null'/blank dropped. Dedup, keep order.
    Stored canonicalized (Title Case) for display; matching is case-insensitive."""
    seen, out = set(), []
    for k, v in fields.items():
        if not _UBO_KEY_RE.match(k) or not v or not isinstance(v, str):
            continue
        name = _UBO_PCT_RE.sub("", v).strip()
        if not name or name.lower() == "null":
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(name)
    return out


def _to_int(val):
    try:
        return int(val) if val not in (None, "", []) else None
    except (ValueError, TypeError):
        return None


def normalize(task: dict) -> dict:
    """Map a raw ClickUp task to a `tasks` row dict."""
    fields = _flatten_custom_fields(task)
    tid = fields.get("clickup_tid")
    tid = str(tid).strip().upper() if tid else None

    list_name = (task.get("list") or {}).get("name") or ""
    status = (task.get("status") or {}).get("status")
    is_deal = list_name.strip().lower() == DEALS_LIST
    is_lost = bool(status and status.strip().lower() in LOST_STATUSES)

    deal_value = fields.get("deal_value") if is_deal else None

    return {
        "id":           task.get("id"),
        "tid":          tid,
        "name":         task.get("name", ""),
        "list_name":    list_name,
        "folder_name":  (task.get("folder") or {}).get("name"),
        "parent_id":    task.get("parent"),     # ClickUp parent task id (subtasks); name resolved in 2nd pass
        "parent_name":  None,
        "space_id":     str((task.get("space") or {}).get("id") or ""),
        "status":       status,
        "status_color": (task.get("status") or {}).get("color"),
        "url":          task.get("url"),
        "assignees":    json.dumps([a.get("username") or a.get("email") or "?"
                                    for a in task.get("assignees", [])]),
        "deal_value":   deal_value,
        "currency":     "EUR",
        "is_deal":      is_deal,
        "is_lost":      is_lost,
        "service":         fields.get("service"),
        "year_of_project": (str(fields["year_of_project"]).strip()
                            if fields.get("year_of_project") not in (None, "") else None),
        "business_year":   (str(fields["business_year"]).strip()
                            if fields.get("business_year") not in (None, "") else None),
        "department":      fields.get("departement"),
        "dashboard_tid":   (str(fields["dashboard_tid"]).strip().upper()
                            if fields.get("dashboard_tid") not in (None, "") else None),
        "ubos":            json.dumps(extract_ubos(fields), ensure_ascii=False),
        "date_created": _to_int(task.get("date_created")),
        "date_updated": _to_int(task.get("date_updated")),
        "date_due":     _to_int(task.get("due_date")),
        "custom_fields": json.dumps(fields, ensure_ascii=False),
        "synced_at":    _now_ms(),
    }


# ---- Fetching ----

def _fetch_space_page(space_id, page, date_updated_gt=None):
    params = {
        "page": page,
        "include_closed": "true",
        "subtasks": "true",
        "space_ids[]": [space_id],
    }
    if date_updated_gt:
        params["date_updated_gt"] = int(date_updated_gt)
    r = requests.get(f"{_API}/team/{get_team_id()}/task", headers=_headers(), params=params, timeout=60)
    r.raise_for_status()
    return r.json().get("tasks", [])


def _fetch_space_tasks(space_id, date_updated_gt=None):
    """Yield all tasks for a space (paginated), optionally only those updated
    after date_updated_gt."""
    page = 0
    while True:
        tasks = _fetch_space_page(space_id, page, date_updated_gt)
        for t in tasks:
            yield t
        if len(tasks) < 100:
            break
        page += 1


def _space_name_map():
    r = requests.get(f"{_API}/team/{get_team_id()}/space",
                     headers=_headers(), params={"archived": "false"}, timeout=30)
    names = {}
    if r.ok:
        for sp in r.json().get("spaces", []):
            names[str(sp.get("id"))] = sp.get("name", str(sp.get("id")))
    return names


# ---- Upsert ----

def _upsert(session, rows, space_name):
    """Bulk-upsert task rows via SQLite INSERT … ON CONFLICT(id) DO UPDATE.
    Far faster than a per-row get-then-set. Returns the max date_updated seen.

    Chunked: a single multi-row VALUES carries len(rows) * ncols bound params,
    and SQLite caps bound params at 32,766 (SQLITE_MAX_VARIABLE_NUMBER). A big
    space (~6.9k rows × ~20 cols ≈ 138k params) blows past that and the whole
    statement raises — so we batch to stay well under the cap."""
    if not rows:
        return 0
    max_updated = 0
    for row in rows:
        row["space_name"] = space_name.get(row["space_id"], row["space_id"] or "Unknown space")
        if row["date_updated"]:
            max_updated = max(max_updated, row["date_updated"])

    cols = list(rows[0].keys())
    # Rows per statement so that rows*ncols stays well under SQLite's 32,766
    # bound-param cap (e.g. 20 cols → 400 rows → ~8k params).
    chunk = max(1, 8000 // max(1, len(cols)))
    for i in range(0, len(rows), chunk):
        batch = rows[i:i + chunk]
        stmt = sqlite_insert(Task).values(batch)
        stmt = stmt.on_conflict_do_update(
            index_elements=["id"],
            set_={c: stmt.excluded[c] for c in cols if c != "id"},
        )
        session.execute(stmt)
    return max_updated


# ---- Rollup ----

def rebuild_companies(session):
    """Recompute the per-TID rollup from `tasks`. Cheap at ~10k rows."""
    session.execute(delete(Company))

    # Aggregate per TID in one pass.
    rows = session.execute(
        select(
            Task.tid,
            func.count(Task.id),
            func.max(Task.date_updated),
        ).where(Task.tid.isnot(None)).group_by(Task.tid)
    ).all()

    for tid, task_count, last_activity in rows:
        deals = session.execute(
            select(Task.deal_value, Task.is_lost, Task.name, Task.list_name, Task.space_name, Task.ubos)
            .where(Task.tid == tid)
        ).all()

        active_val = active_cnt = lost_val = lost_cnt = deal_cnt = 0
        active_val = 0.0; lost_val = 0.0
        spaces = set()
        ubo_set = {}  # lower-key -> canonical display, dedup case-insensitively across tasks
        company_title = None
        shortest = None
        for dv, is_lost, name, list_name, space_name, ubos_json in deals:
            if space_name:
                spaces.add(space_name)
            if name and (shortest is None or len(name) < len(shortest)):
                shortest = name
            if list_name and list_name.strip().lower() == "accounts (companies)" and company_title is None:
                company_title = name
            for u in (json.loads(ubos_json) if ubos_json else []):
                ubo_set.setdefault(u.lower(), u)
            if list_name and list_name.strip().lower() == DEALS_LIST:
                deal_cnt += 1
                v = dv or 0.0
                if is_lost:
                    lost_val += v; lost_cnt += 1
                else:
                    active_val += v; active_cnt += 1

        session.add(Company(
            tid=tid,
            display_name=company_title or shortest or tid,
            task_count=task_count,
            deal_count=deal_cnt,
            active_deal_value=active_val,
            active_deal_count=active_cnt,
            lost_deal_value=lost_val,
            lost_deal_count=lost_cnt,
            space_names=json.dumps(sorted(spaces)),
            ubos=json.dumps(sorted(ubo_set.values(), key=str.lower)),
            last_activity=last_activity,
        ))


# ---- Parent-name resolution ----

def resolve_parent_names(session):
    """Fill parent_name for subtasks by looking up their parent_id in the tasks
    table. Runs after upserts (the parent task is in our dataset since we fetch
    everything). Sets parent_name=NULL for orphans (parent not found)."""
    id_to_name = dict(session.execute(select(Task.id, Task.name)).all())
    subs = session.execute(
        select(Task).where(Task.parent_id.isnot(None))
    ).scalars().all()
    for t in subs:
        t.parent_name = id_to_name.get(t.parent_id)


# ---- Sync drivers ----

def _set_sync_state(session, space_id, max_updated, status):
    st = session.get(SyncState, space_id)
    now = _now_ms()
    if not st:
        st = SyncState(space_id=space_id, last_synced_ms=0)
        session.add(st)
    if max_updated and max_updated > (st.last_synced_ms or 0):
        st.last_synced_ms = max_updated
    st.last_run_ms = now
    st.last_status = status


def sync_full():
    """Fetch and upsert every task across all spaces, then rebuild rollups.
    Because it touches every live task, deletions are reconciled by dropping any
    row whose synced_at predates this run. Serialized by _sync_lock."""
    with _sync_lock:
        return _sync_full_locked()


def _sync_full_locked():
    init_db()
    names = _space_name_map()
    session = SessionLocal()
    total = 0
    deleted = 0
    run_start = _now_ms()
    try:
        all_ok = True
        for sid in SPACE_IDS:
            try:
                rows = [normalize(t) for t in _fetch_space_tasks(sid)]
                mx = _upsert(session, rows, names)
                _set_sync_state(session, sid, mx, "ok")
                total += len(rows)
                session.commit()
                logging.info(f"[sync_full] space {sid}: {len(rows)} tasks")
            except Exception as e:
                all_ok = False
                session.rollback()
                _set_sync_state(session, sid, 0, f"error: {e}")
                session.commit()
                logging.error(f"[sync_full] space {sid} failed: {e}")

        # Only reconcile if every space loaded — otherwise we'd delete rows we
        # simply failed to refetch.
        if all_ok:
            res = session.execute(delete(Task).where(Task.synced_at < run_start))
            deleted = res.rowcount or 0
            _mark_reconcile(session)
        resolve_parent_names(session)
        rebuild_companies(session)
        session.commit()
    finally:
        session.close()
    logging.info(f"[sync_full] done: {total} tasks, {deleted} stale removed")
    return {"mode": "full", "tasks": total, "deleted": deleted}


def _due_for_reconcile(session) -> bool:
    st = session.get(SyncState, _RECONCILE_KEY)
    last = (st.last_run_ms if st else 0) or 0
    return (_now_ms() - last) >= RECONCILE_MIN_INTERVAL_MS


def _mark_reconcile(session):
    st = session.get(SyncState, _RECONCILE_KEY)
    if not st:
        st = SyncState(space_id=_RECONCILE_KEY, last_synced_ms=0)
        session.add(st)
    st.last_run_ms = _now_ms()
    st.last_status = "ok"


def sync_incremental(force_reconcile=False):
    """Fetch only tasks updated since each space's high-water mark (fast, ~10s),
    upsert them, then rebuild rollups. Deletion reconcile is heavier (re-lists
    all spaces) so it runs at most once per RECONCILE_MIN_INTERVAL_MS — or now,
    if force_reconcile. Serialized by _sync_lock."""
    with _sync_lock:
        return _sync_incremental_locked(force_reconcile)


def _sync_incremental_locked(force_reconcile=False):
    init_db()
    names = _space_name_map()
    session = SessionLocal()
    changed = 0
    deleted = 0
    try:
        for sid in SPACE_IDS:
            st = session.get(SyncState, sid)
            cursor = (st.last_synced_ms if st else 0) or 0
            if cursor == 0:
                # Never synced this space — do a full pass for it.
                rows = [normalize(t) for t in _fetch_space_tasks(sid)]
            else:
                rows = [normalize(t) for t in _fetch_space_tasks(sid, date_updated_gt=cursor)]
            try:
                mx = _upsert(session, rows, names)
                _set_sync_state(session, sid, mx, "ok")
                changed += len(rows)
                session.commit()
            except Exception as e:
                session.rollback()
                _set_sync_state(session, sid, 0, f"error: {e}")
                session.commit()
                logging.error(f"[sync_incremental] space {sid} failed: {e}")

        reconciled = False
        if force_reconcile or _due_for_reconcile(session):
            deleted = reconcile_deletions(session)
            _mark_reconcile(session)
            reconciled = True

        resolve_parent_names(session)
        rebuild_companies(session)
        session.commit()
    finally:
        session.close()
    logging.info(f"[sync_incremental] {changed} changed, {deleted} deleted, reconciled={reconciled}")
    return {"mode": "incremental", "changed": changed, "deleted": deleted, "reconciled": reconciled}


def reconcile_deletions(session):
    """Fetch the id-only set of live tasks across all spaces and delete DB rows
    no longer present. Catches deletions/archival. Heavier than incremental —
    gated by RECONCILE_MIN_INTERVAL_MS in sync_incremental()."""
    live_ids = set()
    for sid in SPACE_IDS:
        try:
            for t in _fetch_space_tasks(sid):
                live_ids.add(t.get("id"))
        except Exception as e:
            # If a space fetch fails, skip reconcile for safety (don't delete
            # rows we simply failed to list).
            logging.warning(f"[reconcile] space {sid} list failed, skipping reconcile: {e}")
            return 0

    db_ids = set(session.execute(select(Task.id)).scalars().all())
    stale = db_ids - live_ids
    if stale:
        session.execute(delete(Task).where(Task.id.in_(stale)))
    return len(stale)


def fetch_task(task_id: str) -> dict | None:
    """Fetch a single task by ClickUp id. Returns the raw task dict, or None if
    ClickUp reports it missing (404)."""
    r = requests.get(f"{_API}/task/{task_id}", headers=_headers(),
                     params={"include_subtasks": "false"}, timeout=30)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()


def sync_one(task_id: str) -> dict:
    """Reconcile a single task after an edit: re-fetch it from ClickUp, upsert the
    one row, and rebuild the rollup so the dashboard reflects the change without
    waiting for the next full/incremental tick. Serialized by _sync_lock so it
    can't interleave with a bulk sync. Returns {reconciled, tid}."""
    with _sync_lock:
        raw = fetch_task(task_id)
        session = SessionLocal()
        try:
            if raw is None:
                # Task vanished (deleted/archived) — drop the row, refresh rollup.
                session.execute(delete(Task).where(Task.id == task_id))
                rebuild_companies(session)
                session.commit()
                return {"reconciled": False, "tid": None, "deleted": True}

            names = _space_name_map()
            row = normalize(raw)
            _upsert(session, [row], names)
            resolve_parent_names(session)
            rebuild_companies(session)
            session.commit()
            return {"reconciled": True, "tid": row.get("tid"), "deleted": False}
        finally:
            session.close()


def run_sync(full=False):
    """Entry point used by the API. Serialized; safe to call concurrently."""
    global _syncing
    with _sync_lock:
        _syncing = True
        try:
            return sync_full() if full else sync_incremental()
        finally:
            _syncing = False


def is_syncing():
    return _syncing


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    import sys
    mode_full = "--full" in sys.argv
    t0 = time.time()
    result = run_sync(full=mode_full)
    print(result, f"in {time.time()-t0:.1f}s")
