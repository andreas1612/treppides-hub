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


def _word_matchers(query: str):
    """Compile a whole-word, case-insensitive regex per search term. A title
    matches only if EVERY term appears as a whole word (any order). Word
    boundaries (\\b) treat spaces/punctuation in titles like 'FCR - ACME LTD'
    as separators, so 'isp' matches 'ISP Holdings' but not 'KLISP'."""
    terms = [t for t in re.split(r"\s+", query.strip()) if t]
    return [re.compile(rf"\b{re.escape(t)}\b", re.IGNORECASE) for t in terms]


def _title_matches(name: str, matchers: list) -> bool:
    return bool(name) and all(m.search(name) for m in matchers)


# ---- Filtering ------------------------------------------------------

def _multi(val: str | None) -> list[str]:
    """Parse a comma-separated multi-value filter param into a clean list."""
    if not val:
        return []
    return [v.strip() for v in val.split(",") if v.strip()]


def deal_filters(year=None, assignee=None, service=None, department=None,
                 space=None, business_year=None, exclude=None):
    """Build a list of SQLAlchemy predicates over Task for the Group Dashboard
    filters. ANY within a field, AND across fields (standard faceted search).
    All operate on DEAL tasks (caller already constrains is_deal).

    `space` matches the display space (raw space_name; the frontend sends the
    raw name). `exclude` is a field key to skip — used by /filters to compute a
    field's options WITHOUT constraining on that same field (so a multi-select
    keeps showing all its sibling options)."""
    exclude = exclude or ""
    clauses = []
    if exclude != "space" and (spaces := _multi(space)):
        clauses.append(Task.space_name.in_(spaces))
    if exclude != "year" and (years := _multi(year)):
        clauses.append(Task.year_of_project.in_(years))
    if exclude != "business_year" and (byrs := _multi(business_year)):
        clauses.append(Task.business_year.in_(byrs))
    if exclude != "service" and (services := _multi(service)):
        clauses.append(Task.service.in_(services))
    if exclude != "department" and (departments := _multi(department)):
        clauses.append(Task.department.in_(departments))
    if exclude != "assignee" and (assignees := _multi(assignee)):
        # assignees stored as a JSON array string; match each as "Name" substring.
        clauses.append(or_(*[Task.assignees.like(f'%"{a}"%') for a in assignees]))
    return clauses


def has_active_filters(year=None, assignee=None, service=None, department=None,
                       space=None, business_year=None) -> bool:
    return any(_multi(v) for v in (year, assignee, service, department, space, business_year))


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
        "parent_id": t.parent_id,
        "parent_name": t.parent_name,
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
        "business_year": t.business_year,
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
def filter_options(year: str | None = Query(None), assignee: str | None = Query(None),
                   service: str | None = Query(None), department: str | None = Query(None),
                   space: str | None = Query(None), business_year: str | None = Query(None),
                   db: Session = Depends(get_db)):
    """Option lists for the dashboard filter dropdowns, computed over DEAL tasks.

    CASCADING: each field's options are scoped to the OTHER active filters (e.g.
    pick a Space → Service/Department/Year options narrow to that space). A field
    is computed with itself excluded from the constraint, so a multi-select keeps
    offering all of its own sibling values."""
    kw = dict(year=year, assignee=assignee, service=service, department=department,
              space=space, business_year=business_year)

    def distinct(col, field_key):
        conds = [Task.is_deal.is_(True), col.isnot(None), col != "",
                 *deal_filters(**kw, exclude=field_key)]
        return [r for r in db.execute(
            select(col).where(and_(*conds)).distinct().order_by(col)
        ).scalars().all()]

    # Assignees: union across JSON arrays on deal tasks matching the other filters.
    assignees = set()
    a_conds = [Task.is_deal.is_(True), Task.assignees.isnot(None),
               *deal_filters(**kw, exclude="assignee")]
    for raw in db.execute(select(Task.assignees).where(and_(*a_conds))).scalars().all():
        try:
            for a in json.loads(raw):
                if a and a != "?":
                    assignees.add(a)
        except (ValueError, TypeError):
            pass

    return {
        "spaces": distinct(Task.space_name, "space"),
        "years": sorted(distinct(Task.year_of_project, "year"), reverse=True),
        "business_years": sorted(distinct(Task.business_year, "business_year"), reverse=True),
        "assignees": sorted(assignees),
        # Drop compound values (e.g. "Bookkeeping, VAT") from the dropdowns.
        "services": [s for s in distinct(Task.service, "service") if "," not in s],
        "departments": [d for d in distinct(Task.department, "department") if "," not in d],
    }


@router.get("/search")
def search(q: str = Query("", description="Company name or TID-XXXXX code"),
           year: str | None = Query(None), assignee: str | None = Query(None),
           service: str | None = Query(None), department: str | None = Query(None),
           space: str | None = Query(None), business_year: str | None = Query(None),
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
        # Whole-word match: cheap LIKE prefilter (every term must appear as a
        # substring somewhere), then a precise \b word-boundary check in Python
        # so 'isp' matches 'ISP Holdings' but not 'KLISP'. All terms required.
        matchers = _word_matchers(query)
        if not matchers:
            return {"query": query, "matched_tids": [], "companies": []}
        conds = [Task.tid.isnot(None)]
        for t in re.split(r"\s+", query.strip()):
            if t:
                conds.append(Task.name.ilike(f"%{t}%"))
        candidates = db.execute(
            select(Task.tid, Task.name).where(*conds)
        ).all()
        tids = sorted({tid for tid, name in candidates if _title_matches(name, matchers)})

    if not tids:
        return {"query": query, "matched_tids": [], "companies": []}

    filters = deal_filters(year, assignee, service, department, space, business_year)
    active = has_active_filters(year, assignee, service, department, space, business_year)

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
    q: str = Query("", description="optional company name / TID search (whole-word)"),
    sort: str = Query("deal_value"), dir: str = Query("desc"),
    page: int = Query(1, ge=1), page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    include_nodeal: bool = Query(False),
    year: str | None = Query(None), assignee: str | None = Query(None),
    service: str | None = Query(None), department: str | None = Query(None),
    space: str | None = Query(None), business_year: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """All-companies consolidated list — searchable, sortable, paginated,
    filterable. Default: companies with >=1 deal. Totals reflect active filters."""
    sort = sort if sort in SORT_FIELDS else "deal_value"
    descending = dir != "asc"
    filters = deal_filters(year, assignee, service, department, space, business_year)
    active = has_active_filters(year, assignee, service, department, space, business_year)

    # Optional in-list search (whole-word name match, or TID). Narrows candidates.
    search_tids = None
    query = (q or "").strip()
    if query:
        if TID_RE.match(query):
            search_tids = {query.upper()}
        else:
            matchers = _word_matchers(query)
            conds = [Task.tid.isnot(None)]
            for t in re.split(r"\s+", query):
                if t:
                    conds.append(Task.name.ilike(f"%{t}%"))
            cand = db.execute(select(Task.tid, Task.name).where(*conds)).all()
            search_tids = {tid for tid, name in cand if _title_matches(name, matchers)}
        if not search_tids:
            return {"total": 0, "page": page, "page_size": page_size, "sort": sort,
                    "dir": dir, "grand_active_deal_value": 0, "grand_lost_deal_value": 0,
                    "companies": []}

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

    # Intersect the in-list search, if any.
    if search_tids is not None:
        candidate_tids = [t for t in (candidate_tids if candidate_tids is not None
                                      else [r for r in db.execute(select(Company.tid)).scalars().all()])
                          if t in search_tids]

    stmt = select(Company)
    if candidate_tids is not None:
        if not candidate_tids:
            return {"total": 0, "page": page, "page_size": page_size, "sort": sort,
                    "dir": dir, "grand_active_deal_value": 0, "grand_lost_deal_value": 0,
                    "companies": []}
        stmt = stmt.where(Company.tid.in_(candidate_tids))
    rows = db.execute(stmt).scalars().all()

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


# ---- Chart (compare companies or UBOs by Deal Value) ----------------

@router.get("/ubos")
def list_ubos(q: str = Query("", description="optional name filter"),
              limit: int = Query(200, ge=1, le=1000), db: Session = Depends(get_db)):
    """Distinct UBO names that have attributable active Deal Value — for the
    chart's UBO picker. Ranked by total value so the picker shows big ones first.
    Optional `q` substring-filters the names."""
    rows = db.execute(select(Company.ubos, Company.active_deal_value)
                      .where(Company.ubos.isnot(None), Company.active_deal_value > 0)).all()
    agg = {}
    for ubos_json, val in rows:
        for u in (json.loads(ubos_json) if ubos_json else []):
            slot = agg.setdefault(u.lower(), {"label": u, "value": 0.0})
            slot["value"] += (val or 0.0)
    items = sorted(agg.values(), key=lambda x: x["value"], reverse=True)
    needle = q.strip().lower()
    if needle:
        items = [it for it in items if needle in it["label"].lower()]
    return {"ubos": [it["label"] for it in items[:limit]]}


@router.get("/chart")
def chart(by: str = Query("company", description="company | ubo"),
          select_: str | None = Query(None, alias="select",
                                       description="comma-separated TIDs (company) or UBO names to compare"),
          top: int = Query(15, ge=1, le=100),
          year: str | None = Query(None), assignee: str | None = Query(None),
          service: str | None = Query(None), department: str | None = Query(None),
          space: str | None = Query(None), business_year: str | None = Query(None),
          db: Session = Depends(get_db)):
    """Bar-chart data comparing active Deal Value by company or by UBO. Honours
    all filters. If `select` is given, returns exactly those items; otherwise the
    top-N (default 15) by value. For UBO mode a company's value is attributed in
    full to each of its UBOs (so UBO totals can exceed the real fee sum)."""
    by = by if by in ("company", "ubo") else "company"
    fkw = dict(year=year, assignee=assignee, service=service, department=department,
               space=space, business_year=business_year)
    filters = deal_filters(**fkw)

    # Active Deal Value per TID over the filtered deal set.
    totals = filtered_company_rows(db, filters)  # {tid: {...}}
    if not totals:
        return {"by": by, "top": top, "selected": False, "items": []}

    tids = list(totals.keys())
    companies = {c.tid: c for c in db.execute(
        select(Company).where(Company.tid.in_(tids))
    ).scalars().all()}

    if by == "company":
        items = [{
            "key": tid,
            "label": companies[tid].display_name if tid in companies else tid,
            "value": totals[tid]["active_deal_value"],
            "deal_count": totals[tid]["active_deal_count"],
        } for tid in tids if tid in companies]
        wanted = _multi(select_)
        selected = bool(wanted)
        if selected:
            wset = {w.upper() for w in wanted}
            items = [it for it in items if it["key"].upper() in wset]
    else:  # ubo — attribute each company's active value to each of its UBOs
        agg = {}  # lowerkey -> {label, value, companies}
        for tid, t in totals.items():
            c = companies.get(tid)
            if not c or not c.ubos:
                continue
            val = t["active_deal_value"]
            for u in json.loads(c.ubos):
                slot = agg.setdefault(u.lower(), {"label": u, "value": 0.0, "companies": 0})
                slot["value"] += val
                slot["companies"] += 1
        items = [{"key": v["label"], "label": v["label"],
                  "value": round(v["value"], 2), "company_count": v["companies"]}
                 for v in agg.values()]
        wanted = _multi(select_)
        selected = bool(wanted)
        if selected:
            wset = {w.lower() for w in wanted}
            items = [it for it in items if it["label"].lower() in wset]

    items.sort(key=lambda x: x["value"], reverse=True)
    if not selected:
        items = items[:top]
    return {
        "by": by,
        "top": top,
        "selected": selected,
        "filtered": has_active_filters(**fkw),
        "items": items,
    }


# ---- Deals (flat list — for the Custom Total picker) ----------------

@router.get("/deals")
def list_deals(q: str = Query("", description="optional whole-word name/TID search"),
               page: int = Query(1, ge=1), page_size: int = Query(200, ge=1, le=500),
               year: str | None = Query(None), assignee: str | None = Query(None),
               service: str | None = Query(None), department: str | None = Query(None),
               space: str | None = Query(None), business_year: str | None = Query(None),
               db: Session = Depends(get_db)):
    """Flat, filtered list of individual DEAL tasks (active AND lost) for the
    Custom Total picker. Honours the dashboard filters + whole-word search.
    Each row carries its value, status, service, space and company display name so
    the frontend can total client-side. Sorted by deal_value desc, paginated."""
    conds = [Task.is_deal.is_(True),
             *deal_filters(year, assignee, service, department, space, business_year)]

    query = (q or "").strip()
    if query:
        if TID_RE.match(query):
            conds.append(Task.tid == query.upper())
        else:
            matchers = _word_matchers(query)
            like_conds = [Task.name.ilike(f"%{t}%") for t in re.split(r"\s+", query) if t]
            cand = db.execute(select(Task).where(and_(*conds, *like_conds))).scalars().all()
            rows = [t for t in cand if _title_matches(t.name, matchers)]
            return _deals_response(db, rows, page, page_size)

    rows = db.execute(select(Task).where(and_(*conds))).scalars().all()
    return _deals_response(db, rows, page, page_size)


def _deals_response(db, rows, page, page_size):
    """Sort deal Tasks by value desc, attach company display_name, paginate."""
    rows.sort(key=lambda t: (t.deal_value or 0.0), reverse=True)
    total = len(rows)
    start = (page - 1) * page_size
    page_rows = rows[start:start + page_size]

    tids = {t.tid for t in page_rows if t.tid}
    names = {}
    if tids:
        names = {c.tid: c.display_name for c in db.execute(
            select(Company.tid, Company.display_name).where(Company.tid.in_(tids))
        ).all()}

    deals = []
    for t in page_rows:
        d = _task_dict(t)
        # Resolve a real company name, never echo the deal's own task title:
        #   1) the deal's 'company_name' custom field (most reliable, ~96% coverage)
        #   2) the company rollup display_name — but only if it isn't just the task title
        #   3) "—"
        cf = json.loads(t.custom_fields) if t.custom_fields else {}
        cn = (cf.get("company_name") or "").strip()
        disp = (names.get(t.tid) or "").strip()
        taskname = (t.name or "").strip().lower()
        if not cn and disp and disp.lower() != taskname:
            cn = disp
        d["company_name"] = cn or "—"
        deals.append(d)
    return {"total": total, "page": page, "page_size": page_size, "deals": deals}


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
                   space: str | None = Query(None), business_year: str | None = Query(None),
                   db: Session = Depends(get_db)):
    """Detail for one company: its DEAL tasks only, grouped by space and split
    into active vs rejected/lost. Honours the same filters as search/browse, so
    an open card reflects the active filter. Non-deal tasks are excluded."""
    tid = tid.strip().upper()
    company = db.get(Company, tid)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    fkw = dict(year=year, assignee=assignee, service=service, department=department,
               space=space, business_year=business_year)
    active = has_active_filters(**fkw)
    conds = [Task.tid == tid, Task.is_deal.is_(True), *deal_filters(**fkw)]
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

    totals = filtered_company_rows(db, deal_filters(**fkw), tids=[tid]).get(tid) if active else None
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
