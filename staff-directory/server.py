"""
staff-directory/server.py
FastAPI backend — proxies Microsoft Graph to serve staff data and photos.

Run:
    uvicorn server:app --reload --port 8010

Endpoints:
    GET /api/staff              — full staff list (cached 5 min)
    GET /api/staff/{id}/photo   — profile photo proxy (cached 1 hr)
"""

import os
import re
import time
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

# ── Azure AD credentials ───────────────────────────────────────────────────────
TENANT_ID     = os.environ["AZURE_TENANT_ID"]
CLIENT_ID     = os.environ["AZURE_CLIENT_ID"]
CLIENT_SECRET = os.environ["AZURE_CLIENT_SECRET"]
GRAPH_BASE    = "https://graph.microsoft.com/v1.0"
TOKEN_URL     = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"

# ── Graph fields to request ────────────────────────────────────────────────────
GRAPH_SELECT = ",".join([
    "id", "givenName", "surname", "mail",
    "jobTitle", "department", "officeLocation",
    "businessPhones", "mobilePhone", "accountEnabled", "userType",
])

VALID_LOCATIONS = {"nicosia", "limassol"}
EXT_PATTERN     = re.compile(r"^\d{3,5}$")

# ── Token cache ────────────────────────────────────────────────────────────────
_token_cache: dict = {"token": None, "expires_at": 0}

def get_access_token() -> str:
    if _token_cache["token"] and time.time() < _token_cache["expires_at"] - 60:
        return _token_cache["token"]

    resp = httpx.post(TOKEN_URL, data={
        "grant_type":    "client_credentials",
        "client_id":     CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "scope":         "https://graph.microsoft.com/.default",
    })
    resp.raise_for_status()
    data = resp.json()
    _token_cache["token"]      = data["access_token"]
    _token_cache["expires_at"] = time.time() + data.get("expires_in", 3600)
    return _token_cache["token"]

# ── Staff list cache ───────────────────────────────────────────────────────────
_staff_cache: dict = {"data": None, "expires_at": 0}

def fetch_all_staff() -> list:
    if _staff_cache["data"] and time.time() < _staff_cache["expires_at"]:
        return _staff_cache["data"]

    token   = get_access_token()
    headers = {"Authorization": f"Bearer {token}"}
    url     = (
        f"{GRAPH_BASE}/users"
        f"?$select={GRAPH_SELECT}"
        f"&$filter=accountEnabled eq true"
        f"&$top=999"
    )

    users = []
    while url:
        resp = httpx.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        body  = resp.json()
        users.extend(body.get("value", []))
        url   = body.get("@odata.nextLink")

    staff = []
    for u in users:
        # Skip shared mailboxes and guests
        if not u.get("givenName"):
            continue
        if u.get("userType") != "Member":
            continue

        # Validate officeLocation
        raw_loc = (u.get("officeLocation") or "").strip()
        location = raw_loc if raw_loc.lower() in VALID_LOCATIONS else None

        # Validate extension
        phones = u.get("businessPhones") or []
        raw_ext = phones[0].strip() if phones else ""
        extension = raw_ext if EXT_PATTERN.match(raw_ext) else None

        staff.append({
            "azureId":    u["id"],
            "name":       f"{u['givenName']} {u['surname']}",
            "email":      u.get("mail") or "",
            "department": u.get("department") or "Other",
            "location":   location,
            "extension":  extension,
            "jobTitle":   u.get("jobTitle") or None,
            "mobile":     u.get("mobilePhone") or None,
        })

    staff.sort(key=lambda s: s["name"])
    _staff_cache["data"]       = staff
    _staff_cache["expires_at"] = time.time() + 300  # 5 min
    return staff

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="Staff Directory API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

@app.get("/api/staff")
def staff_list():
    try:
        return fetch_all_staff()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Graph error: {e.response.status_code}")

@app.get("/api/staff/{azure_id}/photo")
def staff_photo(azure_id: str):
    # Basic ID format validation
    if not re.match(r"^[0-9a-f\-]{36}$", azure_id):
        raise HTTPException(status_code=400, detail="Invalid ID")
    try:
        token = get_access_token()
        resp  = httpx.get(
            f"{GRAPH_BASE}/users/{azure_id}/photo/$value",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="No photo")
        resp.raise_for_status()
        return Response(
            content=resp.content,
            media_type="image/jpeg",
            headers={"Cache-Control": "max-age=3600"},
        )
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Graph error: {e.response.status_code}")

# Serve static frontend files at /
app.mount("/", StaticFiles(directory=".", html=True), name="static")
