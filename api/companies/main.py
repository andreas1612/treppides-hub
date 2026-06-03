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
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from build_database import Task, Company, SyncState, SessionLocal, init_db
import sync as sync_engine

app = FastAPI(title="Company Finder API", version="1.0.0")

# No CORS middleware: same-origin behind nginx in production.

TID_RE = re.compile(r"^\s*TID-\d+\s*$", re.IGNORECASE)
SEARCH_LIMIT = 50

router = APIRouter(prefix="/api/companies")


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
        "date_due": t.date_due,
        "date_created": t.date_created,
    }


def _company_summary(c: Company) -> dict:
    return {
        "tid": c.tid,
        "display_name": c.display_name,
        "task_count": c.task_count,
        "deal_count": c.deal_count,
        "active_deal_value": round(c.active_deal_value or 0.0, 2),
        "active_deal_count": c.active_deal_count or 0,
        "lost_deal_value": round(c.lost_deal_value or 0.0, 2),
        "lost_deal_count": c.lost_deal_count or 0,
        "currency": "EUR",
        "space_names": json.loads(c.space_names) if c.space_names else [],
        "last_activity": c.last_activity,
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

@router.get("/search")
def search(q: str = Query("", description="Company name or TID-XXXXX code"),
           db: Session = Depends(get_db)):
    """Search companies by name (matched on task title) or TID code. Returns
    companies with their Deal Value totals (active vs lost), capped at 50."""
    query = (q or "").strip()
    if not query:
        return {"query": "", "matched_tids": [], "companies": []}

    if TID_RE.match(query):
        tids = [r for r in db.execute(
            select(Company.tid).where(Company.tid == query.strip().upper())
        ).scalars().all()]
    else:
        # Find TIDs whose any task title matches; then return those companies.
        like = f"%{query}%"
        tids = [r for r in db.execute(
            select(Task.tid).where(Task.tid.isnot(None), Task.name.ilike(like)).distinct()
        ).scalars().all()]

    if not tids:
        return {"query": query, "matched_tids": [], "companies": []}

    total = len(tids)
    rows = db.execute(
        select(Company).where(Company.tid.in_(tids))
        .order_by(Company.active_deal_value.desc())
        .limit(SEARCH_LIMIT)
    ).scalars().all()

    return {
        "query": query,
        "matched_tids": sorted(tids),
        "total_companies": total,
        "truncated": total > SEARCH_LIMIT,
        "limit": SEARCH_LIMIT,
        "companies": [_company_summary(c) for c in rows],
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
def company_detail(tid: str, db: Session = Depends(get_db)):
    """Detail for one company: its DEAL tasks only, grouped by space and split
    into active vs rejected/lost. This is a fees dashboard — non-deal tasks
    (Accounts/Contacts/Leads/Forms) are intentionally excluded."""
    tid = tid.strip().upper()
    company = db.get(Company, tid)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    deals = db.execute(
        select(Task).where(Task.tid == tid, Task.is_deal.is_(True))
    ).scalars().all()

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

    return {
        "summary": _company_summary(company),
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
