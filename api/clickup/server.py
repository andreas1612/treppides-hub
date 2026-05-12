# ============================================================
# api/clickup/server.py — FastAPI backend for ClickUp fees data.
#
# Fetches all tasks from a ClickUp List, extracts and flattens
# ALL custom fields, cleans the data, and returns the full flat
# dataset as a JSON array.  All aggregation/grouping is done
# on the frontend for instant interactive drill-downs.
#
# Run:  uvicorn server:app --host 0.0.0.0 --port 8001 --reload
# ============================================================

import os
import time
import uuid
import logging
import datetime
from typing import Any
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# ---- Configuration ---------------------------------------------------

load_dotenv()  # reads .env in the same directory

CLICKUP_API_TOKEN = os.getenv("CLICKUP_API_TOKEN", "")

# Multi-list support — each AML Dashboard view points at its own ClickUp List.
# CLICKUP_LIST_NEW falls back to legacy CLICKUP_LIST_ID for back-compat with
# existing .env files on the server.
LIST_IDS: dict[str, str] = {
    "new":        os.getenv("CLICKUP_LIST_NEW")        or os.getenv("CLICKUP_LIST_ID", ""),
    "rejected":   os.getenv("CLICKUP_LIST_REJECTED", ""),
    "disengaged": os.getenv("CLICKUP_LIST_DISENGAGED", ""),
}

if not CLICKUP_API_TOKEN:
    logging.warning("CLICKUP_API_TOKEN not set. Create a .env file from .env.example.")
for _key, _val in LIST_IDS.items():
    if not _val:
        logging.warning(f"CLICKUP_LIST_{_key.upper()} not set — the '{_key}' view will be unavailable.")

# ---- App setup -------------------------------------------------------

app = FastAPI(title="ClickUp Fees API", version="2.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ---- Media upload config ---------------------------------------------

MEDIA_ROOT      = Path(__file__).parent.parent.parent / "media"
MAX_IMAGE_BYTES = 20  * 1024 * 1024   # 20 MB per image
MAX_VIDEO_BYTES = 150 * 1024 * 1024   # 150 MB per video
ALLOWED_IMAGES  = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
ALLOWED_VIDEOS  = {".mp4", ".mov", ".webm"}

# Per-list cache: { list_key: {"data": ..., "ts": ...} }
_cache: dict[str, dict[str, Any]] = {}
CACHE_TTL_SECONDS = 300  # 5 minutes


# ---- ClickUp API helpers --------------------------------------------

def _clickup_headers() -> dict:
    return {"Authorization": CLICKUP_API_TOKEN}


def _resolve_list_id(list_key: str) -> str:
    list_id = LIST_IDS.get(list_key)
    if not list_id:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown or unconfigured list '{list_key}'. "
                   f"Valid keys: {sorted(k for k, v in LIST_IDS.items() if v)}"
        )
    return list_id


def fetch_all_tasks(list_id: str) -> list[dict]:
    """Fetch ALL tasks from the given ClickUp List, handling pagination."""
    all_tasks: list[dict] = []
    page = 0
    while True:
        url = f"https://api.clickup.com/api/v2/list/{list_id}/task"
        params = {"page": page, "include_closed": "true"}
        resp = requests.get(url, headers=_clickup_headers(), params=params)
        if resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"ClickUp API error: HTTP {resp.status_code} — {resp.text[:300]}"
            )
        tasks = resp.json().get("tasks", [])
        all_tasks.extend(tasks)
        if len(tasks) < 100:
            break
        page += 1
    return all_tasks


# ---- Custom field resolution helpers ---------------------------------

MONTH_ORDER = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def resolve_dropdown(cf: dict) -> str | None:
    """Resolve a drop_down field orderindex → option name."""
    raw = cf.get("value")
    if raw is None:
        return None
    for opt in cf.get("type_config", {}).get("options", []):
        if str(opt.get("orderindex")) == str(raw):
            return opt.get("name")
    return None


def resolve_labels(cf: dict) -> str | None:
    """Resolve a labels (multi-select) field: list of UUIDs → comma-joined names."""
    val = cf.get("value")
    if not val or not isinstance(val, list):
        return None
    id_map = {o["id"]: o.get("label", "?") for o in cf.get("type_config", {}).get("options", [])}
    names = [id_map.get(v, v) for v in val]
    names = [n for n in names if n and n != "null"]
    return ", ".join(names) if names else None


def resolve_date(cf: dict) -> str | None:
    """Resolve a date field: Unix ms timestamp → YYYY-MM-DD."""
    val = cf.get("value")
    if not val:
        return None
    try:
        ts = int(val) / 1000
        return datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
    except (ValueError, TypeError, OSError):
        return None


# ---- Full field extraction -------------------------------------------

def extract_task_fields(task: dict) -> dict:
    """
    Extract ALL custom fields from a ClickUp task into a flat dict.

    Handles all ClickUp field types:
      - short_text / text → plain string
      - currency         → cast to float
      - drop_down        → resolved via orderindex → option name
      - labels           → resolved via UUID → label name, comma-joined
      - date             → formatted as YYYY-MM-DD
    """
    result = {"task_name": task.get("name", "")}

    for cf in task.get("custom_fields", []):
        name = cf.get("name", "")
        ftype = cf.get("type", "")

        # Build a snake_case key from the field name
        key = name.lower().replace(" ", "_").replace("/", "_").replace("?", "")

        if ftype in ("short_text", "text", "url", "email", "phone"):
            result[key] = (cf.get("value") or "").strip() or None

        elif ftype == "currency":
            raw = cf.get("value")
            try:
                result[key] = float(raw) if raw else None
            except (ValueError, TypeError):
                result[key] = None

        elif ftype == "drop_down":
            result[key] = resolve_dropdown(cf)

        elif ftype == "labels":
            result[key] = resolve_labels(cf)

        elif ftype == "date":
            result[key] = resolve_date(cf)

        elif ftype == "number":
            raw = cf.get("value")
            try:
                result[key] = float(raw) if raw else None
            except (ValueError, TypeError):
                result[key] = None

        else:
            # Fallback: store the raw value as string
            val = cf.get("value")
            result[key] = str(val) if val is not None else None

    return result


# ---- Data cleaning ---------------------------------------------------

def clean_tasks(raw_tasks: list[dict]) -> list[dict]:
    """
    Clean the extracted task list:
      1. Drop rows where Fees is null/empty (primary filter).
      2. Fill missing display fields with dashes.
      3. Build a combined "month_year" label.
      4. Sort chronologically.
    """
    rows: list[dict] = []

    for task in raw_tasks:
        row = extract_task_fields(task)

        # Gate: drop records where fees is null
        if row.get("fees") is None:
            continue

        # Fill blanks for key display fields
        row.setdefault("ubo", None)
        row["ubo"]               = row.get("ubo") or "—"
        row["client_status"]     = row.get("client_status") or "Unknown"
        row["month"]             = row.get("month") or "—"
        row["year"]              = row.get("year") or "—"
        row["managing_company"]  = row.get("managing_company") or "—"
        row["engagement_leader"] = row.get("engagement_leader") or "—"

        # Combined month_year label
        m, y = row.get("month", "—"), row.get("year", "—")
        if m != "—" and y != "—":
            row["month_year"] = f"{m} {y}"
        elif m != "—":
            row["month_year"] = m
        else:
            row["month_year"] = "—"

        rows.append(row)

    # Sort chronologically
    def sort_key(r):
        y = r.get("year", "")
        m = r.get("month", "")
        m_idx = MONTH_ORDER.index(m) if m in MONTH_ORDER else 99
        return (y, m_idx, r.get("task_name", ""))

    rows.sort(key=sort_key)
    return rows


def get_ordered_months(rows: list[dict]) -> list[str]:
    """Extract chronologically ordered unique month_year labels."""
    seen = set()
    ordered: list[str] = []
    for r in rows:
        my = r["month_year"]
        if my != "—" and my not in seen:
            seen.add(my)
            ordered.append(my)
    return ordered


# ---- API endpoints ---------------------------------------------------

@app.get("/api/clickup/fees")
def get_fees(list: str = Query("new", description="Which AML list: new | rejected | disengaged")):
    """
    Returns the full cleaned dataset for the requested list, with ALL custom
    fields + ordered month list.

    Response shape:
    {
      "list": "new",
      "months": ["April 2025", "January 2026", ...],
      "tasks": [ { ...all fields... }, ... ]
    }
    """
    list_key = list.lower()
    list_id  = _resolve_list_id(list_key)

    now    = time.time()
    bucket = _cache.get(list_key)
    if bucket and (now - bucket.get("ts", 0)) < CACHE_TTL_SECONDS:
        return bucket["data"]

    raw_tasks = fetch_all_tasks(list_id)
    cleaned   = clean_tasks(raw_tasks)
    months    = get_ordered_months(cleaned)
    result    = {"list": list_key, "months": months, "tasks": cleaned}

    _cache[list_key] = {"data": result, "ts": now}
    return result


@app.get("/api/clickup/fees/refresh")
def refresh_fees(list: str = Query("new", description="Which AML list: new | rejected | disengaged")):
    """Force-refresh: clears the cache for this list and re-fetches from ClickUp."""
    list_key = list.lower()
    _cache.pop(list_key, None)
    return get_fees(list=list_key)


@app.post("/api/upload/image")
async def upload_image(file: UploadFile = File(...)):
    """Upload an image. Returns { url, filename }."""
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_IMAGES:
        raise HTTPException(status_code=400, detail=f"File type {ext} not allowed. Use: {ALLOWED_IMAGES}")

    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds 20 MB limit.")

    fname = f"{uuid.uuid4().hex}{ext}"
    dest  = MEDIA_ROOT / "images" / fname
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)

    return {"url": f"/media/images/{fname}", "filename": file.filename}


@app.post("/api/upload/video")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video (≤150 MB). Returns { url, filename }."""
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_VIDEOS:
        raise HTTPException(status_code=400, detail=f"File type {ext} not allowed. Use: {ALLOWED_VIDEOS}")

    data = await file.read()
    if len(data) > MAX_VIDEO_BYTES:
        raise HTTPException(status_code=413, detail="Video exceeds 150 MB limit.")

    fname = f"{uuid.uuid4().hex}{ext}"
    dest  = MEDIA_ROOT / "videos" / fname
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)

    return {"url": f"/media/videos/{fname}", "filename": file.filename}


@app.get("/health")
def health():
    return {"status": "ok", "service": "clickup-fees-api", "version": "2.1.0"}
