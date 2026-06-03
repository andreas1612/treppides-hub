# ============================================================
# api/companies/main.py — FastAPI backend for the Company Finder.
#
# Serves the Company Master Database (companies.db): instant company
# search and per-company Deal Value (fee) totals, plus sync control.
#
# All routes are prefixed /api/companies/* so nginx proxies a single
# location block to this service (port 8003) without colliding with the
# ClickUp Fees API (8001) or the Valuation API (8002).
#
# Run:  uvicorn main:app --host 127.0.0.1 --port 8003 --reload
# ============================================================

import re
import json
import threading

from fastapi import FastAPI, HTTPException, Depends, APIRouter, Query
from sqlalchemy import select, func, or_, and_, case
from sqlalchemy.orm import Session

from build_database import Task, Company, SyncState, SessionLocal, init_db
import sync as sync_engine

app = FastAPI(title="Company Finder API", version="2.0.0")

# No CORS middleware: same-origin behind nginx in production.

TID_RE = re.compile(r"^\s*TID-\d+\s*$", re.IGNORECASE)
SEARCH_LIMIT = 50
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200
SORT_FIELDS = {"deal_value", "name", "deal_count", "last_activity"}

router = APIRouter(prefix="/api/companies")


# ---- Filtering ------------------------------------------------------

def _multi(val: str | None) -> list[str]:
    """Parse a comma-separated multi-value filter param into a clean list."""
    if not val:
        return []
    return [v.strip() for v in val.split(",") if v.strip()]


def deal_filters(year=None, assignee=None, service=None, department=None):
    """Build a list of SQLAlchemy predicates over Task for the Group Dashboard
    filters. ANY within a field, AND across fields (standard faceted search).
    All operate on DEAL tasks (caller already constrains is_deal)."""
    clauses = []
    years = _multi(year)
    if years:
        clauses.append(Task.year_of_project.in_(years))
    services = _multi(service)
    if services:
        clauses.append(Task.service.in_(services))
    departments = _multi(department)
    if departments:
        clauses.append(Task.department.in_(departments))
    assignees = _multi(assignee)
    if assignees:
        # assignees stored as a JSON array string; match each as "Name" substring.
        clauses.append(or_(*[Task.assignees.like(f'%"{a}"%') for a in assignees]))
    return clauses


def has_active_filters(year=None, assignee=None, service=None, department=None) -> bool:
    return any(_multi(v) for v in (year, assignee, service, department))


def filtered_company_rows(db, filters, tids=None):
    """Compute per-TID Deal Value rollups over the DEAL tasks matching `filters`
    (and optionally restricted to `tids`). Returns {tid: {...totals...}}.
    Active = not lost; lost shown separately — same split as the precomputed rollup,
    but recomputed over the filtered deal set so totals reflect the filter."""
    active_val = func.sum(case((Task.is_lost.is_(False), Task.deal_value), else_=0.0))
    active_cnt = func.sum(case((Task.is_lost.is_(False), 1), else_=0))
    lost_val   = func.sum(case((Task.is_lost.is_(True), Task.deal_value), else_=0.0))
    lost_cnt   = func.sum(case((Task.is_lost.is_(True), 1), else_=0))

    conds = [Task.is_deal.is_(True), Task.tid.isnot(None), *filters]
    if tids is not None:
        conds.append(Task.tid.in_(tids))

    rows = db.execute(
        select(
            Task.tid, active_val, active_cnt, lost_val, lost_cnt, func.count(Task.id)
        ).where(and_(*conds)).group_by(Task.tid)
    ).all()

    out = {}
    for tid, av, ac, lv, lc, dc in rows:
        out[tid] = {
            "active_deal_value": round(av or 0.0, 2),
            "active_deal_count": int(ac or 0),
            "lost_deal_value": round(lv or 0.0, 2),
            "lost_deal_count": int(lc or 0),
            "deal_count": int(dc or 0),
        }
    return out


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---- Serialization helpers ------------------------------------------

def _task_dict(t: Task) -> dict:
    return {
        "id": t.id,
        "tid": t.tid,
        "task_name": t.name,
        "list_name": t.list_name,
        "folder_name": t.folder_name,
        "space_id": t.space_id,
        "space_name": t.space_name,
        "status": t.status,
        "status_color": t.status_color,
        "url": t.url,
        "assignees": json.loads(t.assignees) if t.assignees else [],
        "deal_value": t.deal_value,
        "currency": t.currency,
        "is_deal": bool(t.is_deal),
        "is_lost": bool(t.is_lost),
        "service": t.service,
        "year_of_project": t.year_of_project,
        "department": t.department,
        "date_due": t.date_due,
        "date_created": t.date_created,
    }


def _company_summary(c: Company, totals: dict | None = None) -> dict:
    """Serialize a Company. If `totals` is given (filtered rollup for this TID),
    its Deal Value figures override the precomputed full-rollup numbers so the
    UI reflects the active filter."""
    return {
        "tid": c.tid,
        "display_name": c.display_name,
        "task_count": c.task_count,
        "deal_count": (totals or {}).get("deal_count", c.deal_count),
        "active_deal_value": (totals or {}).get("active_deal_value", round(c.active_deal_value or 0.0, 2)),
        "active_deal_count": (totals or {}).get("active_deal_count", c.active_deal_count or 0),
        "lost_deal_value": (totals or {}).get("lost_deal_value", round(c.lost_deal_value or 0.0, 2)),
        "lost_deal_count": (totals or {}).get("lost_deal_count", c.lost_deal_count or 0),
        "currency": "EUR",
        "space_names": json.loads(c.space_names) if c.space_names else [],
        "last_activity": c.last_activity,
        "filtered": totals is not None,
    }


# ---- Health & status ------------------------------------------------

@router.get("/health")
def health():
    return {"ok": True}


@router.get("/status")
def status(db: Session = Depends(get_db)):
    task_count = db.scalar(select(func.count(Task.id))) or 0
    company_count = db.scalar(select(func.count(Company.tid))) or 0
    states = db.execute(select(SyncState)).scalars().all()

    space_states = [s for s in states if s.space_id != sync_engine._RECONCILE_KEY]
    reconcile = next((s for s in states if s.space_id == sync_engine._RECONCILE_KEY), None)
    return {
        "task_count": task_count,
        "company_count": company_count,
        "syncing": sync_engine.is_syncing(),
        "last_reconcile_ms": reconcile.last_run_ms if reconcile else None,
        "spaces": [
            {
                "space_id": s.space_id,
                "last_synced_ms": s.last_synced_ms,
                "last_run_ms": s.last_run_ms,
                "last_status": s.last_status,
            }
            for s in space_states
        ],
    }


# ---- Search ---------------------------------------------------------

@router.get("/filters")
def filter_options(db: Session = Depends(get_db)):
    """Distinct values for the dashboard filter dropdowns, computed over DEAL
    tasks. Assignees are flattened from the per-task JSON arrays."""
    def distinct(col):
        return [r for r in db.execute(
            select(col).where(Task.is_deal.is_(True), col.isnot(None), col != "")
            .distinct().order_by(col)
        ).scalars().all()]

    # Assignees: union across JSON arrays on deal tasks.
    assignees = set()
    for raw in db.execute(
        select(Task.assignees).where(Task.is_deal.is_(True), Task.assignees.isnot(None))
    ).scalars().all():
        try:
            for a in json.loads(raw):
                if a and a != "?":
                    assignees.add(a)
        except (ValueError, TypeError):
            pass

    years = distinct(Task.year_of_project)
    # Drop compound service values (e.g. "Bookkeeping, VAT", "Audit, Bookkeeping")
    # from the dropdown — they clutter the list. Deals keep their literal value.
    services = [s for s in distinct(Task.service) if "," not in s]
    return {
        "years": sorted(years, reverse=True),
        "assignees": sorted(assignees),
        "services": services,
        "departments": [d for d in distinct(Task.department) if "," not in d],
    }


@router.get("/search")
def search(q: str = Query("", description="Company name or TID-XXXXX code"),
           year: str | None = Query(None), assignee: str | None = Query(None),
           service: str | None = Query(None), department: str | None = Query(None),
           db: Session = Depends(get_db)):
    """Search companies by name (matched on task title) or TID code, optionally
    constrained by deal-level filters. Deal Value totals reflect the filters."""
    query = (q or "").strip()
    if not query:
        return {"query": "", "matched_tids": [], "companies": []}

    if TID_RE.match(query):
        tids = [r for r in db.execute(
            select(Company.tid).where(Company.tid == query.strip().upper())
        ).scalars().all()]
    else:
        like = f"%{query}%"
        tids = [r for r in db.execute(
            select(Task.tid).where(Task.tid.isnot(None), Task.name.ilike(like)).distinct()
        ).scalars().all()]

    if not tids:
        return {"query": query, "matched_tids": [], "companies": []}

    filters = deal_filters(year, assignee, service, department)
    active = has_active_filters(year, assignee, service, department)

    # With filters, restrict to TIDs that actually have a matching deal, and use
    # filtered totals. Without filters, use the precomputed Company rollup.
    totals_by_tid = filtered_company_rows(db, filters, tids=tids) if active else {}
    if active:
        tids = [t for t in tids if t in totals_by_tid]
        if not tids:
            return {"query": query, "matched_tids": [], "total_companies": 0,
                    "truncated": False, "limit": SEARCH_LIMIT, "companies": []}

    total = len(tids)
    rows = db.execute(select(Company).where(Company.tid.in_(tids))).scalars().all()
    summaries = [_company_summary(c, totals_by_tid.get(c.tid) if active else None) for c in rows]
    summaries.sort(key=lambda s: s["active_deal_value"], reverse=True)

    return {
        "query": query,
        "matched_tids": sorted(tids),
        "total_companies": total,
        "truncated": total > SEARCH_LIMIT,
        "limit": SEARCH_LIMIT,
        "grand_active_deal_value": round(sum(s["active_deal_value"] for s in summaries), 2),
        "grand_lost_deal_value": round(sum(s["lost_deal_value"] for s in summaries), 2),
        "companies": summaries[:SEARCH_LIMIT],
    }


@router.get("/companies")
def browse_companies(
    sort: str = Query("deal_value"), dir: str = Query("desc"),
    page: int = Query(1, ge=1), page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    include_nodeal: bool = Query(False),
    year: str | None = Query(None), assignee: str | None = Query(None),
    service: str | None = Query(None), department: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """All-companies consolidated list — sortable, paginated, filterable.
    Default: companies with >=1 deal. Totals reflect active filters."""
    sort = sort if sort in SORT_FIELDS else "deal_value"
    descending = dir != "asc"
    filters = deal_filters(year, assignee, service, department)
    active = has_active_filters(year, assignee, service, department)

    # Determine the candidate companies + their (filtered or full) totals.
    if active:
        totals_by_tid = filtered_company_rows(db, filters)  # only TIDs with matching deals
        candidate_tids = list(totals_by_tid.keys())
    else:
        totals_by_tid = {}
        if include_nodeal:
            candidate_tids = None  # all companies
        else:
            candidate_tids = [r for r in db.execute(
                select(Company.tid).where(Company.deal_count > 0)
            ).scalars().all()]

    q = select(Company)
    if candidate_tids is not None:
        if not candidate_tids:
            return {"total": 0, "page": page, "page_size": page_size,
                    "sort": sort, "dir": dir, "companies": []}
        q = q.where(Company.tid.in_(candidate_tids))
    rows = db.execute(q).scalars().all()

    summaries = [_company_summary(c, totals_by_tid.get(c.tid) if active else None) for c in rows]

    keymap = {
        "deal_value": lambda s: s["active_deal_value"],
        "name": lambda s: (s["display_name"] or "").lower(),
        "deal_count": lambda s: s["deal_count"],
        "last_activity": lambda s: s["last_activity"] or 0,
    }
    # name sorts ascending-by-default feel; others default desc. Respect `dir`.
    summaries.sort(key=keymap[sort], reverse=descending)

    total = len(summaries)
    start = (page - 1) * page_size
    # Grand totals across the FULL filtered set (not just this page).
    grand_active = round(sum(s["active_deal_value"] for s in summaries), 2)
    grand_lost = round(sum(s["lost_deal_value"] for s in summaries), 2)
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "sort": sort,
        "dir": "desc" if descending else "asc",
        "grand_active_deal_value": grand_active,
        "grand_lost_deal_value": grand_lost,
        "companies": summaries[start:start + page_size],
    }


# ---- Sync control ---------------------------------------------------
# NOTE: must be registered BEFORE the /{tid} catch-all, or "/sync" would be
# captured as tid="sync".

@router.get("/sync")
def trigger_sync(full: bool = Query(False, description="Full rebuild instead of incremental"),
                 wait: bool = Query(False, description="Block until the sync finishes")):
    """Trigger a sync. Incremental by default (cron / Refresh button). Runs in a
    background thread unless ?wait=true. Skipped if a sync is already running."""
    if sync_engine.is_syncing():
        return {"ok": True, "started": False, "reason": "already syncing"}

    if wait:
        result = sync_engine.run_sync(full=full)
        return {"ok": True, "started": True, "result": result}

    threading.Thread(target=sync_engine.run_sync, kwargs={"full": full},
                     name="companies-sync", daemon=True).start()
    return {"ok": True, "started": True, "background": True}


# ---- Company detail -------------------------------------------------

@router.get("/{tid}")
def company_detail(tid: str,
                   year: str | None = Query(None), assignee: str | None = Query(None),
                   service: str | None = Query(None), department: str | None = Query(None),
                   db: Session = Depends(get_db)):
    """Detail for one company: its DEAL tasks only, grouped by space and split
    into active vs rejected/lost. Honours the same filters as search/browse, so
    an open card reflects the active filter. Non-deal tasks are excluded."""
    tid = tid.strip().upper()
    company = db.get(Company, tid)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    active = has_active_filters(year, assignee, service, department)
    conds = [Task.tid == tid, Task.is_deal.is_(True), *deal_filters(year, assignee, service, department)]
    deals = db.execute(select(Task).where(and_(*conds))).scalars().all()

    # Group deals by space, separating active from rejected/lost.
    spaces: dict[str, dict] = {}
    active_deals, lost_deals = [], []
    for t in deals:
        td = _task_dict(t)
        sp = spaces.setdefault(t.space_id, {
            "space_id": t.space_id, "space_name": t.space_name,
            "active": [], "lost": [],
        })
        if t.is_lost:
            sp["lost"].append(td)
            lost_deals.append(td)
        else:
            sp["active"].append(td)
            active_deals.append(td)

    space_list = sorted(spaces.values(), key=lambda s: (s["space_name"] or "").lower())

    totals = filtered_company_rows(db, deal_filters(year, assignee, service, department),
                                   tids=[tid]).get(tid) if active else None
    return {
        "summary": _company_summary(company, totals),
        "has_deals": len(deals) > 0,
        "spaces": space_list,
        "active_deals": active_deals,
        "lost_deals": lost_deals,
    }


app.include_router(router)


@app.on_event("startup")
def _startup():
    init_db()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8003, reload=True)
