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
import re
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

# Forms feature — each Hub form creates a task in its own ClickUp List.
# List IDs come from .env (never hardcoded), same pattern as LIST_IDS above.
FORM_LIST_IDS: dict[str, str] = {
    "lead": os.getenv("CLICKUP_FORM_LEAD_LIST", ""),
    "deal": os.getenv("CLICKUP_FORM_DEAL_LIST", ""),
}
for _key, _val in FORM_LIST_IDS.items():
    if not _val:
        logging.warning(f"CLICKUP_FORM_{_key.upper()}_LIST not set — the '{_key}' form will be unavailable.")

# ---- App setup -------------------------------------------------------

app = FastAPI(title="ClickUp Fees API", version="2.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://hub.treppides.com",
        "http://192.168.0.221",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# ---- Media upload config ---------------------------------------------

MEDIA_ROOT      = Path(__file__).parent.parent.parent / "media"
MAX_IMAGE_BYTES = 20  * 1024 * 1024   # 20 MB per image
MAX_VIDEO_BYTES = 150 * 1024 * 1024   # 150 MB per video
ALLOWED_IMAGES  = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
ALLOWED_VIDEOS  = {".mp4", ".mov", ".webm"}

# Form attachments (e.g. the Deal form's LoE) are streamed straight to ClickUp,
# never written to the server's media dir. Allow common document/image types.
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024   # 25 MB per attachment
ALLOWED_ATTACHMENTS  = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".txt", ".csv", ".jpg", ".jpeg", ".png", ".gif", ".webp",
}

# Magic-byte signatures per extension. Extension alone is trivially spoofable
# (a .png can hold arbitrary bytes / HTML), so we sniff the leading bytes and
# require them to match the declared type before saving. mp4/mov/webm carry the
# type marker after a 4-byte size prefix, so we check a small window.
def _sniff_ok(ext: str, data: bytes) -> bool:
    head = data[:16]
    if ext in (".jpg", ".jpeg"):
        return head[:3] == b"\xff\xd8\xff"
    if ext == ".png":
        return head[:8] == b"\x89PNG\r\n\x1a\n"
    if ext == ".gif":
        return head[:6] in (b"GIF87a", b"GIF89a")
    if ext == ".webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if ext in (".mp4", ".mov"):
        return b"ftyp" in head            # ISO base media (mp4/mov)
    if ext == ".webm":
        return head[:4] == b"\x1a\x45\xdf\xa3"   # EBML / Matroska-WebM
    return False

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
        # (connect, read) timeouts so a hung/slow ClickUp can't pin a worker.
        try:
            resp = requests.get(url, headers=_clickup_headers(), params=params, timeout=(10, 30))
        except requests.RequestException as e:
            logging.error(f"ClickUp request failed (list {list_id}, page {page}): {e}")
            raise HTTPException(
                status_code=502,
                detail="Unable to fetch data from ClickUp. Please try again or contact IT support."
            )
        if resp.status_code != 200:
            logging.error(f"ClickUp API error: HTTP {resp.status_code} — {resp.text[:500]}")
            raise HTTPException(
                status_code=502,
                detail="Unable to fetch data from ClickUp. Please try again or contact IT support."
            )
        try:
            tasks = resp.json().get("tasks", [])
        except ValueError as e:  # malformed/non-JSON body
            logging.error(f"ClickUp returned non-JSON (list {list_id}, page {page}): {e}")
            raise HTTPException(
                status_code=502,
                detail="Unable to fetch data from ClickUp. Please try again or contact IT support."
            )
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
        # Field name/type come from the (attacker-influenceable) ClickUp workspace;
        # coerce to str so a non-string name can't throw on .lower().
        name = str(cf.get("name", "") or "")
        ftype = str(cf.get("type", "") or "")

        # Build a snake_case key from the field name
        key = name.lower().replace(" ", "_").replace("/", "_").replace("?", "")
        if not key:
            continue  # unnamed field → nothing to key on
        # Two distinct field names can collapse to the same key (e.g. "Deal Value"
        # and "Deal/Value" → deal_value). Don't silently overwrite financial data —
        # log it so the collision is visible rather than corrupting a value.
        if key in result and key != "task_name":
            logging.warning(
                f"Custom-field key collision on '{key}' (field name {name!r}) — "
                f"keeping first value, ignoring duplicate."
            )
            continue

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


# ======================================================================
# Forms — declarative schemas + ClickUp task creation
#
# Each form mirrors a live ClickUp form (captured from the form UI +
# the list's custom-field definitions via the ClickUp API). A form field
# is one of:
#   - a NATIVE task field   ("native": "name" | "status" | "description"
#                             | "assignee" | "due_date")
#   - a CUSTOM field         ("cf_id": "<uuid>") with a ClickUp "type"
#
# On submit we validate the payload against the schema, then POST a single
# create-task call (name + native fields + custom_fields[]), and finally
# attach any uploaded files to the created task.
#
# Field IDs/options below are the ground truth read from the ClickUp API
# for the Leads (901214051231) and Deals (901214051218) lists. If the
# workspace fields change, re-probe and update these schemas.
# ======================================================================

# Each option: {"id": <clickup option uuid>, "name": <label shown to user>}.
# drop_down submits the option id as the value; labels submits a list of ids.

FORMS: dict[str, dict[str, Any]] = {
    "lead": {
        "title": "Lead",
        "list_env": "lead",
        "subtitle": "Use this form to add a new lead into the CRM.",
        "status_info": [],
        # Plain single-section layout (matches the Deal form). Fields kept in
        # the same order as the original ClickUp Leads form.
        "sections": [
            {"heading": None, "fields": [
                {"key": "company_name", "label": "Company Name", "native": "name",
                 "type": "text", "required": True, "placeholder": "Enter text"},
                {"key": "engagement_leader", "label": "Engagement Leader", "native": "assignee",
                 "type": "assignee", "required": True},
                {"key": "service_description", "label": "Service Description", "native": "description",
                 "type": "textarea", "required": True, "placeholder": "Enter text"},
                {"key": "status", "label": "Status", "native": "status",
                 "type": "status", "required": True},
                {"key": "industry", "label": "Industry", "cf_id": "0575bd0f-ff72-40c4-a082-a9e98e7b3770",
                 "type": "textarea", "required": True, "placeholder": "Enter text"},
                {"key": "jurisdiction", "label": "Jurisdiction", "cf_id": "8855b253-24b8-434c-9b16-083f7a3fb3e9",
                 "type": "text", "required": True, "placeholder": "Enter text"},
                {"key": "contact_name", "label": "Client Contact Name", "cf_id": "fe25b267-eca8-4015-a536-b69439c163b1",
                 "type": "text", "required": True, "placeholder": "Enter text"},
                {"key": "job_title", "label": "Job Title", "cf_id": "2cd66129-79a6-4a3f-b1c6-c7989730310b",
                 "type": "text", "required": True, "placeholder": "Enter text"},
                {"key": "email", "label": "Contact Email", "cf_id": "95b17931-3610-4b01-b287-af1c2cac9aaf",
                 "type": "email", "required": True, "placeholder": "Enter email"},
                {"key": "phone", "label": "Contact Phone", "cf_id": "a2af5818-7cce-4cad-b78f-23392a8eb738",
                 "type": "phone", "required": True, "placeholder": "+357 99 123456"},
                {"key": "lead_source", "label": "Lead Source", "cf_id": "aa105c7e-583d-469f-b83c-d50d6d40199a",
                 "type": "drop_down", "required": True, "options": [
                    {"id": "8afc115f-6791-4196-9f24-cadca3d66cea", "name": "Event"},
                    {"id": "b15a0f72-b179-4a31-aaa5-5eac50d12938", "name": "Referral"},
                    {"id": "dec3b9ca-7782-4fe5-9a61-e2df99793b48", "name": "Existing Group"},
                    {"id": "5bc47c3f-bc8d-4126-8bee-8db7e638bead", "name": "Existing Client"},
                    {"id": "5d33394d-0b14-4759-aac9-9ea30ec02272", "name": "Client Initiative"},
                    {"id": "5c438cf7-fa8a-4872-acd9-733fb5ae5c3c", "name": "Associate"},
                    {"id": "fe0f6a91-4e7d-4294-a37d-7bc702241bba", "name": "MGA Approved auditors"},
                    {"id": "2f44602d-39dd-42cc-a25a-fe08f5ba54a0", "name": "Chris Antonopoulos  UHY"},
                    {"id": "6543006c-8691-4292-a495-9d56fc17332d", "name": "George Panayiotou"},
                    {"id": "7e152f03-fb5f-46ad-ac33-01829036e37f", "name": "MTG LLP"},
                 ]},
                {"key": "lead_details", "label": "Lead Details", "cf_id": "5ef34f10-db0d-4edd-9765-06d75f0ace83",
                 "type": "labels", "required": True, "options": [
                    {"id": "c2b12b8f-e51e-451a-8b2c-44cd9bf86d37", "name": "ICE London 2025"},
                    {"id": "3cd1ec92-374c-4736-8af2-46e81ab1d330", "name": "SBC Lisbon 2025"},
                    {"id": "91c798fe-9ade-4943-8e8f-1d305e76dce1", "name": "IFX HK 2025"},
                    {"id": "1329402c-9a36-40ac-aa70-e35298e4d6fd", "name": "Vassos Paraskevas"},
                    {"id": "1b54b910-b072-4608-bf42-22b7b34c9609", "name": "ICE Barcelona 2026"},
                    {"id": "9df69599-c33d-4744-a4d8-8c1e2a42d663", "name": "Cyprus-India Business & Investment Summit 2026"},
                    {"id": "71b5d4da-7835-4054-ba70-8e0a06b6695e", "name": "Marios Cosma"},
                    {"id": "15686a7c-dc06-4579-a3d5-f0dce66b3946", "name": "Daniel Shwartz"},
                    {"id": "927ad79f-caff-4a0c-b943-9db4fd0cb5a0", "name": "Antigoni Fakonti"},
                    {"id": "83a96000-6313-4bae-b458-b999c5151d58", "name": "Nicolas Treppides"},
                    {"id": "788bf70a-a36f-4649-a9af-d4571ff5b1df", "name": "Snir Levy"},
                    {"id": "be5c5ba0-eb48-4204-8b8b-485d4244cf29", "name": "Andreas Hadjioannou"},
                    {"id": "a1cedb24-acaa-427d-bf4b-cade3301ff14", "name": "Yoni Sidi"},
                    {"id": "4e1e56a9-ddcb-424a-a282-ecdfe6b97189", "name": "Nicolas Panteli"},
                    {"id": "c7e0960a-9626-45ed-9c3c-c188034ea08c", "name": "Amit Moyal"},
                    {"id": "51518e47-ce1b-4a9c-971a-2351419556a9", "name": "Darwin Tax"},
                    {"id": "197046d1-729d-4beb-b4c4-764f21b06180", "name": "Christina Maria Oxinou"},
                    {"id": "9e0b9979-66ac-4b87-a5f4-e7fa2e5b9496", "name": "Finanz"},
                    {"id": "34f87a8b-7f59-4cb9-9f1e-5bb4ee1a09ef", "name": "SBC Malta 2026"},
                    {"id": "5c629741-286b-4458-9e93-9c3d898736b4", "name": "Next.io Malta 2026"},
                    {"id": "f3e7fc7a-6ffb-403a-a0d0-f597a8a4a167", "name": "Maria Sourmeli"},
                    {"id": "2aeaada3-d262-40e2-89e1-91b56a99b803", "name": "existing"},
                    {"id": "4f24cc7f-2788-42a4-b66c-6bc21ddef850", "name": "Chara Acheriotou"},
                    {"id": "e6a03eee-1364-4d3b-860e-cea7dbbd3a8d", "name": "ZK"},
                    {"id": "614a5486-6b1f-4cb5-b74f-36e638440ee6", "name": "Andreas Vladimirou"},
                    {"id": "46ed55db-1a43-4edd-8d8e-fd4d6632fb70", "name": "Stelios Yiannaki"},
                    {"id": "056c3413-ac81-4e85-bb9c-b1983659952a", "name": "Nicolas Klappis"},
                    {"id": "bde204a9-fbc9-4a32-b6ba-7a0cbb4a2878", "name": "George Panayiotou"},
                 ]},
            ]},
        ],
    },
    "deal": {
        "title": "Deal",
        "list_env": "deal",
        "subtitle": "Use this form to directly add deals into the deal cycle.",
        "status_info": [],
        "sections": [
            {"heading": None, "fields": [
                {"key": "deal_name", "label": "Enter the Company Name and Deal Name", "native": "name",
                 "type": "text", "required": True, "placeholder": "Example Company Name - Example Deal Name"},
                {"key": "due_date", "label": "Due date", "native": "due_date",
                 "type": "date", "required": True},
                {"key": "assignee", "label": "Assignee", "native": "assignee",
                 "type": "assignee", "required": True},
                {"key": "status", "label": "Status", "native": "status",
                 "type": "status", "required": True},
                {"key": "description", "label": "Description", "native": "description",
                 "type": "textarea", "required": True, "placeholder": "Enter text"},
                {"key": "service", "label": "Service", "cf_id": "1c4cf919-3756-44a4-b864-b6db9302efcd",
                 "type": "labels", "required": True, "options": [
                    {"id": "d1bc883c-5a16-4e8a-be0e-d458886cbcca", "name": "Accounting"},
                    {"id": "f1834867-80b0-4114-9fa7-3bf018111759", "name": "AML Audit & Gap Analysis"},
                    {"id": "9c8e79eb-b716-43ec-80bf-8548c8d9b62a", "name": "Audit"},
                    {"id": "ab803d07-fa2f-4e26-9413-b8391a03816d", "name": "Bookkeeping"},
                    {"id": "fe97cc2d-e444-47a1-ae1d-d956eac3d04b", "name": "Compliance"},
                    {"id": "305e4458-34e2-47f8-829a-61f6723ee17b", "name": "Compliance Consulting"},
                    {"id": "cc1a98e2-2d0f-4da4-86a3-8046185da680", "name": "External Audit"},
                    {"id": "fd7a8097-6edc-446c-8163-03b4cf860d79", "name": "Internal Audit"},
                    {"id": "9ffe7013-388f-4c4e-bded-ec1c1e62f636", "name": "Licensing"},
                    {"id": "9099b805-4d2c-4c0e-a930-c3bd4a9f2019", "name": "Payroll"},
                    {"id": "587486fc-e71f-41e7-981a-e884f786ac54", "name": "Pillar III - ESG"},
                    {"id": "83d44182-c86b-461e-9ddd-7ce872764fd9", "name": "Risk"},
                    {"id": "f9d1ce12-257c-4252-945a-239f3af71091", "name": "Risk Management"},
                    {"id": "c481e0ad-d93f-4baf-85d5-3eaabd4b72ee", "name": "Tax"},
                    {"id": "97587cb1-ecd0-4e57-a3ed-f9182ef92626", "name": "Valuation"},
                    {"id": "c0c85f47-223d-412a-96f9-0bf4ba3113b5", "name": "VAT"},
                    {"id": "8d239009-1d4b-4fd5-91d2-45a6722f0486", "name": "Transfer Pricing"},
                    {"id": "5505ee0e-09a7-4926-8d43-28cc8d21fdeb", "name": "ICT"},
                 ]},
                {"key": "departement", "label": "Departement", "cf_id": "96806d3b-9f2d-4dd8-bc13-d09123e3a6f9",
                 "type": "labels", "required": True, "options": [
                    {"id": "86027df6-19c3-4da3-98d7-9c2b9b3c646a", "name": "Audit"},
                    {"id": "f43de04a-d9c0-4cab-bb3c-674bdf4f987f", "name": "FCR"},
                    {"id": "3b638a9a-f5e2-4b8a-bc35-d73b86bc952c", "name": "FRA"},
                    {"id": "e56d57a7-fcb9-4d3b-9a2c-81904ec4de05", "name": "Funds"},
                    {"id": "48f341a5-c8c3-4e96-b31b-360f1190f587", "name": "HR"},
                    {"id": "8442b599-fff7-4bce-b1db-e5d8d3a9bb8b", "name": "ICAS"},
                    {"id": "818b974f-2a92-4a5d-99fd-bfcdbcd01580", "name": "TAX"},
                    {"id": "050a8056-c759-4182-b90f-3b29d59ab24b", "name": "VAT"},
                 ]},
                {"key": "deal_value", "label": "Deal Value", "cf_id": "5d977a3f-8b17-4e32-bf5b-3732ef749d55",
                 "type": "currency", "required": True, "placeholder": "Enter currency"},
                {"key": "recurring_fee", "label": "Recurring fee", "cf_id": "cadf45a8-e7d4-4bc0-833e-fbb7f40725e8",
                 "type": "drop_down", "required": True, "options": [
                    {"id": "0966ccb0-c97f-4e43-ac8c-14ba88be6fca", "name": "YES"},
                    {"id": "94aa95bd-847f-4c02-bd8c-9d2db61a411f", "name": "NO"},
                 ]},
                {"key": "year_of_project", "label": "Year of project (i.e. audit 2025)", "cf_id": "8e63eb59-585f-4002-b1b7-4aa8eb3dcc55",
                 "type": "drop_down", "required": True, "options": [
                    {"id": "7b46f33c-91eb-4c05-a660-c65b2136be2d", "name": "2021"},
                    {"id": "a88a43c0-0361-4c2a-93eb-ad4ab838e4b0", "name": "2022"},
                    {"id": "dddf83e9-cb86-4d0b-a707-0fbcfa41c42a", "name": "2023"},
                    {"id": "a6791057-a9ba-4bca-9650-0d7b8f8d0db0", "name": "2024"},
                    {"id": "d1cebc3f-7586-4303-9cdf-d59ff17aa9b7", "name": "2025"},
                    {"id": "92093c4b-5c57-463c-bbd6-1eaba3a2358d", "name": "2026"},
                    {"id": "f0a75b69-227f-437f-bdb8-5e64ab85f8c4", "name": "2027"},
                    {"id": "26ba58f5-686d-46ae-878c-e858723ca689", "name": "2028"},
                    {"id": "c9e07db8-2b57-4590-89c5-ffc0015d44ab", "name": "2029"},
                    {"id": "61bc2a63-7f53-4117-bcd7-a439472ff057", "name": "2030"},
                 ]},
                {"key": "business_year", "label": "Business Year (current year)", "cf_id": "c06adc0e-2437-493f-b90e-20aeb5520a2b",
                 "type": "drop_down", "required": True, "options": [
                    {"id": "199a2a23-236d-4ae1-9c8e-248407eb2b57", "name": "2025"},
                    {"id": "5279b80e-87b7-41e9-b0a3-27639e837e1c", "name": "2026"},
                    {"id": "ed8b01f0-c2f5-4efa-9ae8-4c2925329b74", "name": "2027"},
                    {"id": "92e58bbb-70a1-4fc7-ba7a-53de0093a9cf", "name": "2028"},
                 ]},
                {"key": "deal_status", "label": "Deal Status", "cf_id": "aff3f1ed-d44c-4d7d-9375-73b965a226d6",
                 "type": "drop_down", "required": True, "options": [
                    {"id": "93edbecc-2464-424b-af6a-760ee5e60fef", "name": "New"},
                    {"id": "c324a962-763a-46ca-8e5d-f32ae18de483", "name": "Existisng (past year rollover)"},
                 ]},
                {"key": "contact_name", "label": "Contact Name", "cf_id": "fe25b267-eca8-4015-a536-b69439c163b1",
                 "type": "text", "required": True, "placeholder": "Enter text"},
                {"key": "contact_email", "label": "Contact Email", "cf_id": "9e7e64e0-8ee3-43d3-b3d7-19b3386bf7a2",
                 "type": "email", "required": True, "placeholder": "Enter email"},
                {"key": "project_status", "label": "Project Status", "cf_id": "676ff880-9e99-47a6-bafb-b6847d9155e9",
                 "type": "drop_down", "required": True, "options": [
                    {"id": "55bef471-e142-480b-b5eb-e4e802f3b948", "name": "Initial start"},
                    {"id": "1ea86f0b-f129-4447-a21c-8fd1b7a269ca", "name": "In progress"},
                    {"id": "a580c739-7507-486a-8df8-6138a0843edf", "name": "Project issues/On hold"},
                    {"id": "4fb8e0d1-8519-4eb5-b3e2-bd5862e46d5a", "name": "Terminated"},
                    {"id": "6539c5d2-b66d-4f3a-b5a4-9fea6cd039ac", "name": "Completed"},
                 ]},
                {"key": "loe", "label": "LoE", "type": "attachment", "required": False},
            ]},
        ],
    },
}


def _iter_form_fields(form: dict) -> list[dict]:
    """Flatten a form's sections into a single ordered field list (skips info sections)."""
    out: list[dict] = []
    for section in form["sections"]:
        out.extend(section.get("fields", []))
    return out


def _resolve_form(form_key: str) -> dict:
    form = FORMS.get(form_key)
    if not form:
        raise HTTPException(status_code=404,
                            detail=f"Unknown form '{form_key}'. Valid: {sorted(FORMS)}")
    return form


def _resolve_form_list_id(form: dict) -> str:
    list_id = FORM_LIST_IDS.get(form["list_env"], "")
    if not list_id:
        raise HTTPException(
            status_code=503,
            detail=f"The '{form['list_env']}' form is not configured on the server "
                   f"(set CLICKUP_FORM_{form['list_env'].upper()}_LIST in .env)."
        )
    return list_id


def _public_schema(form_key: str, form: dict) -> dict:
    """The schema shape sent to the browser for rendering (no server-only keys)."""
    return {
        "key": form_key,
        "title": form["title"],
        "subtitle": form.get("subtitle"),
        "status_info": form.get("status_info", []),
        "sections": form["sections"],
    }


# ---- Submission validation + ClickUp value conversion ----------------

def _coerce_field_value(field: dict, raw: Any) -> Any:
    """
    Validate one submitted value against its field schema and convert it to the
    representation ClickUp expects. Raises HTTPException(400) on bad input.
    Returns a sentinel-free value; callers decide native vs custom_fields placement.
    """
    ftype = field["type"]
    label = field["label"]

    # Empty check (all form fields are required; treat blank/empty list as missing)
    missing = raw is None or raw == "" or (isinstance(raw, list) and len(raw) == 0)
    if missing:
        if field.get("required"):
            raise HTTPException(status_code=400, detail=f"'{label}' is required.")
        return None

    if ftype == "phone":
        # ClickUp's phone field requires E.164 (leading "+" and country code),
        # else it returns FIELD_016 "Value is not a valid phone number". Normalize
        # spaces/dashes/parens, then validate the shape before sending.
        cleaned = re.sub(r"[\s().\-]", "", str(raw).strip())
        if not re.fullmatch(r"\+[1-9]\d{6,14}", cleaned):
            raise HTTPException(
                status_code=400,
                detail=f"'{label}' must be in international format, e.g. +35799123456 "
                       f"(include the country code with a leading +).")
        return cleaned

    if ftype in ("text", "textarea", "email"):
        return str(raw).strip()

    if ftype == "currency":
        try:
            return float(raw)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail=f"'{label}' must be a number.")

    if ftype == "date":
        # Accept YYYY-MM-DD (from <input type=date>) → Unix ms at midnight UTC.
        try:
            dt = datetime.datetime.strptime(str(raw), "%Y-%m-%d").replace(
                tzinfo=datetime.timezone.utc)
            return int(dt.timestamp() * 1000)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail=f"'{label}' must be a valid date.")

    if ftype == "status":
        # Validated against the list's statuses at submit time (see _validate_status).
        return str(raw).strip()

    if ftype == "assignee":
        try:
            return int(raw)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail=f"'{label}' must be a valid assignee.")

    if ftype == "drop_down":
        valid = {o["id"] for o in field.get("options", [])}
        if raw not in valid:
            raise HTTPException(status_code=400, detail=f"'{label}' has an invalid selection.")
        return raw

    if ftype == "labels":
        if not isinstance(raw, list):
            raise HTTPException(status_code=400, detail=f"'{label}' must be a list of selections.")
        valid = {o["id"] for o in field.get("options", [])}
        bad = [v for v in raw if v not in valid]
        if bad:
            raise HTTPException(status_code=400, detail=f"'{label}' has an invalid selection.")
        return raw

    if ftype == "attachment":
        # Attachments are uploaded separately (multipart), not in the JSON body.
        return None

    raise HTTPException(status_code=400, detail=f"'{label}' has an unsupported field type.")


def _build_create_payload(form: dict, values: dict, list_statuses: list[str]) -> dict:
    """
    Turn validated {field_key: coerced_value} into a ClickUp create-task body:
    native fields at top level, everything else under custom_fields[].
    """
    payload: dict[str, Any] = {}
    custom_fields: list[dict] = []

    for field in _iter_form_fields(form):
        if field["type"] == "attachment":
            continue
        val = values.get(field["key"])
        if val is None:
            continue

        native = field.get("native")
        if native == "name":
            payload["name"] = val
        elif native == "description":
            payload["description"] = val
        elif native == "assignee":
            payload["assignees"] = [val]
        elif native == "due_date":
            payload["due_date"] = val
        elif native == "status":
            # ClickUp rejects an unknown status; verify against the live list.
            if val.lower() not in {s.lower() for s in list_statuses}:
                raise HTTPException(status_code=400, detail=f"Invalid status '{val}'.")
            payload["status"] = val
        elif field.get("cf_id"):
            custom_fields.append({"id": field["cf_id"], "value": val})

    if "name" not in payload or not payload["name"]:
        raise HTTPException(status_code=400, detail="A name is required to create the task.")

    if custom_fields:
        payload["custom_fields"] = custom_fields
    return payload


def _fetch_list_meta(list_id: str) -> dict:
    """GET list metadata (used for live status validation). Sanitized errors."""
    url = f"https://api.clickup.com/api/v2/list/{list_id}"
    try:
        resp = requests.get(url, headers=_clickup_headers(), timeout=(10, 30))
    except requests.RequestException as e:
        logging.error(f"ClickUp list-meta request failed (list {list_id}): {e}")
        raise HTTPException(status_code=502, detail="Unable to reach ClickUp. Please try again.")
    if resp.status_code != 200:
        logging.error(f"ClickUp list-meta error: HTTP {resp.status_code} — {resp.text[:300]}")
        raise HTTPException(status_code=502, detail="Unable to reach ClickUp. Please try again.")
    return resp.json()


def _create_clickup_task(list_id: str, payload: dict) -> dict:
    """POST a new task to a ClickUp list. Returns the created task JSON."""
    url = f"https://api.clickup.com/api/v2/list/{list_id}/task"
    try:
        resp = requests.post(url, headers={**_clickup_headers(), "Content-Type": "application/json"},
                             json=payload, timeout=(10, 30))
    except requests.RequestException as e:
        logging.error(f"ClickUp create-task request failed (list {list_id}): {e}")
        raise HTTPException(status_code=502, detail="Unable to submit to ClickUp. Please try again.")
    if resp.status_code not in (200, 201):
        logging.error(f"ClickUp create-task error: HTTP {resp.status_code} — {resp.text[:500]}")
        raise HTTPException(status_code=502,
                            detail="ClickUp rejected the submission. Please check your entries or contact IT support.")
    return resp.json()


def _attach_file_to_task(task_id: str, data: bytes, filename: str) -> None:
    """POST an attachment to an existing task. Best-effort; caller handles failure."""
    url = f"https://api.clickup.com/api/v2/task/{task_id}/attachment"
    files = {"attachment": (filename, data)}
    resp = requests.post(url, headers=_clickup_headers(), files=files, timeout=(10, 60))
    if resp.status_code not in (200, 201):
        logging.error(f"ClickUp attachment failed (task {task_id}): HTTP {resp.status_code} — {resp.text[:300]}")
        raise RuntimeError("attachment upload failed")


# ======================================================================
# [REMOVED] Company Task Finder (v1, in-memory).
#
# The cross-space company search + fee dashboard now lives in its own
# service: api/companies/ (companies-api, port 8003), backed by a
# persistent SQLite master DB synced incrementally. The old in-memory
# implementation that lived here (the /api/clickup/company/* routes plus
# their index/cache/threading helpers) was removed once that service
# replaced it. See api/companies/OUTLINE.md.
# ======================================================================

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


# ---- Forms endpoints -------------------------------------------------

@app.get("/api/clickup/forms")
def list_forms():
    """List available forms (key + title) for the Forms landing/switcher."""
    return {"forms": [
        {"key": k, "title": v["title"]}
        for k, v in FORMS.items()
        if FORM_LIST_IDS.get(v["list_env"])
    ]}


@app.get("/api/clickup/forms/{form_key}/schema")
def get_form_schema(form_key: str):
    """Return the field schema for one form (drives frontend rendering)."""
    form = _resolve_form(form_key.lower())
    _resolve_form_list_id(form)  # 503 if not configured
    return _public_schema(form_key.lower(), form)


@app.get("/api/clickup/forms/{form_key}/members")
def get_form_members(form_key: str):
    """Return assignable members for a form's list (for the assignee picker)."""
    form = _resolve_form(form_key.lower())
    list_id = _resolve_form_list_id(form)
    url = f"https://api.clickup.com/api/v2/list/{list_id}/member"
    try:
        resp = requests.get(url, headers=_clickup_headers(), timeout=(10, 30))
    except requests.RequestException as e:
        logging.error(f"ClickUp members request failed (list {list_id}): {e}")
        raise HTTPException(status_code=502, detail="Unable to reach ClickUp. Please try again.")
    if resp.status_code != 200:
        logging.error(f"ClickUp members error: HTTP {resp.status_code} — {resp.text[:300]}")
        raise HTTPException(status_code=502, detail="Unable to reach ClickUp. Please try again.")
    members = resp.json().get("members", [])
    return {"members": [
        {"id": m.get("id"), "username": m.get("username"), "email": m.get("email")}
        for m in members
    ]}


@app.get("/api/clickup/forms/{form_key}/statuses")
def get_form_statuses(form_key: str):
    """Return the list's available statuses (for the Status dropdown)."""
    form = _resolve_form(form_key.lower())
    list_id = _resolve_form_list_id(form)
    meta = _fetch_list_meta(list_id)
    return {"statuses": [
        {"status": s.get("status"), "color": s.get("color")}
        for s in meta.get("statuses", [])
    ]}


@app.post("/api/clickup/forms/{form_key}/submit")
async def submit_form(
    form_key: str,
    payload: str = File(...),
    file: UploadFile | None = File(None),
):
    """
    Submit a form (multipart). Both forms use this one endpoint:
    `payload` is the JSON-stringified {field_key: value} map; `file` is an
    optional upload (e.g. the Deal form's LoE — the Lead form sends none).
    Creates the task, then attaches the file to it. Partial failure (task
    created, attach failed) is reported so it isn't silent.
    """
    import json
    form = _resolve_form(form_key.lower())
    list_id = _resolve_form_list_id(form)

    try:
        body = json.loads(payload)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Malformed submission.")

    # Find the attachment field (if any) and enforce required-ness up front.
    att_field = next((f for f in _iter_form_fields(form) if f["type"] == "attachment"), None)
    file_bytes: bytes | None = None
    file_name = ""
    if file is not None and file.filename:
        file_bytes = await file.read()
        file_name = file.filename
        if len(file_bytes) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(status_code=413, detail="Attachment exceeds the 25 MB limit.")
        ext = Path(file_name).suffix.lower()
        if ext not in ALLOWED_ATTACHMENTS:
            raise HTTPException(status_code=400,
                                detail=f"File type {ext or '(none)'} not allowed. Use: {sorted(ALLOWED_ATTACHMENTS)}")
    if att_field and att_field.get("required") and not file_bytes:
        raise HTTPException(status_code=400, detail=f"'{att_field['label']}' is required.")

    task = _process_submission(form, list_id, body)
    task_id = task.get("id")

    attach_ok = True
    if file_bytes and task_id:
        try:
            _attach_file_to_task(task_id, file_bytes, file_name)
        except Exception:
            attach_ok = False

    return {
        "ok": True,
        "task_id": task_id,
        "url": task.get("url"),
        "attachment_ok": attach_ok,
        "warning": None if attach_ok else
            "The task was created, but the file attachment failed to upload. "
            "Please attach it manually in ClickUp.",
    }


def _process_submission(form: dict, list_id: str, body: dict) -> dict:
    """Shared path: validate body → build payload → create task. Returns task JSON."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Malformed submission.")

    # Validate + coerce every schema field (ignores unknown keys in the body).
    values: dict[str, Any] = {}
    for field in _iter_form_fields(form):
        values[field["key"]] = _coerce_field_value(field, body.get(field["key"]))

    meta = _fetch_list_meta(list_id)
    statuses = [s.get("status") for s in meta.get("statuses", [])]
    payload = _build_create_payload(form, values, statuses)
    return _create_clickup_task(list_id, payload)


def _save_upload(data: bytes, ext: str, subdir: str) -> str:
    """Write upload bytes under a server-generated, collision-free name. The
    saved name is uuid4 + the validated extension — the client filename is never
    used in the path, so traversal/odd names can't influence where we write."""
    fname = f"{uuid.uuid4().hex}{ext}"
    dest = MEDIA_ROOT / subdir / fname
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return fname


@app.post("/api/upload/image")
async def upload_image(file: UploadFile = File(...)):
    """Upload an image. Returns { url, filename } (filename = safe stored name)."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_IMAGES:
        raise HTTPException(status_code=400, detail=f"File type {ext} not allowed. Use: {sorted(ALLOWED_IMAGES)}")

    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds 20 MB limit.")
    if not _sniff_ok(ext, data):
        raise HTTPException(status_code=400, detail="File content does not match its image type.")

    fname = _save_upload(data, ext, "images")
    return {"url": f"/media/images/{fname}", "filename": fname}


@app.post("/api/upload/video")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video (≤150 MB). Returns { url, filename } (filename = safe stored name)."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_VIDEOS:
        raise HTTPException(status_code=400, detail=f"File type {ext} not allowed. Use: {sorted(ALLOWED_VIDEOS)}")

    data = await file.read()
    if len(data) > MAX_VIDEO_BYTES:
        raise HTTPException(status_code=413, detail="Video exceeds 150 MB limit.")
    if not _sniff_ok(ext, data):
        raise HTTPException(status_code=400, detail="File content does not match its video type.")

    fname = _save_upload(data, ext, "videos")
    return {"url": f"/media/videos/{fname}", "filename": fname}


@app.get("/health")
def health():
    return {"status": "ok", "service": "clickup-fees-api", "version": "2.2.0"}
