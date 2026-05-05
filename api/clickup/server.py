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
import logging
import datetime
from typing import Any

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# ---- Configuration ---------------------------------------------------

load_dotenv()  # reads .env in the same directory

CLICKUP_API_TOKEN = os.getenv("CLICKUP_API_TOKEN", "")
CLICKUP_LIST_ID   = os.getenv("CLICKUP_LIST_ID", "")

if not CLICKUP_API_TOKEN or not CLICKUP_LIST_ID:
    logging.warning(
        "CLICKUP_API_TOKEN and/or CLICKUP_LIST_ID not set. "
        "Create a .env file from .env.example and fill in real values."
    )

# ---- App setup -------------------------------------------------------

app = FastAPI(title="ClickUp Fees API", version="2.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

_cache: dict[str, Any] = {}
CACHE_TTL_SECONDS = 300  # 5 minutes


# ---- ClickUp API helpers --------------------------------------------

def _clickup_headers() -> dict:
    return {"Authorization": CLICKUP_API_TOKEN}


def fetch_all_tasks() -> list[dict]:
    """Fetch ALL tasks from the ClickUp List, handling pagination."""
    all_tasks: list[dict] = []
    page = 0
    while True:
        url = f"https://api.clickup.com/api/v2/list/{CLICKUP_LIST_ID}/task"
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
def get_fees():
    """
    Returns the full cleaned dataset with ALL custom fields + month list.

    Response shape:
    {
      "months": ["April 2025", "January 2026", ...],
      "tasks": [ { ...all fields... }, ... ]
    }
    """
    global _cache
    now = time.time()
    if _cache and (now - _cache.get("ts", 0)) < CACHE_TTL_SECONDS:
        return _cache["data"]

    raw_tasks = fetch_all_tasks()
    cleaned   = clean_tasks(raw_tasks)
    months    = get_ordered_months(cleaned)
    result    = {"months": months, "tasks": cleaned}

    _cache = {"data": result, "ts": now}
    return result


@app.get("/api/clickup/fees/refresh")
def refresh_fees():
    """Force-refresh: clears cache and re-fetches from ClickUp."""
    global _cache
    _cache = {}
    return get_fees()


@app.get("/health")
def health():
    return {"status": "ok", "service": "clickup-fees-api", "version": "2.1.0"}
