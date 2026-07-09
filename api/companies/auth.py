# ============================================================
# api/companies/auth.py — server-side identity for write routes.
#
# The Group Dashboard's edit endpoints must not trust the browser. This
# module provides a FastAPI dependency that validates the caller against
# the Task Manager session (the same Azure-AD-backed session the rest of
# the Hub uses via js/auth.js → /projects/api/me).
#
# Flow (production):
#   1. Browser sends its TM session cookie with the write request
#      (fetch(..., {credentials: "include"})). nginx proxies /api/companies/*
#      to this service, so the cookie rides along.
#   2. require_user() forwards that cookie to TM's /api/me server-to-server.
#   3. Authenticated + tier != NONE  → return the user dict.
#      401 (no session) / 403 (tier NONE) otherwise — mirrors auth.js:37.
#
# Local dev:
#   Set COMPANIES_LOCAL_DEV=1 to bypass the TM round-trip and inject a fake
#   admin. Lets you exercise the edit UI without running Task Manager (8080).
#   The injected identity is still recorded in the audit log (who_email =
#   the configured dev email, so local edits are distinguishable).
# ============================================================

import os
import logging

import requests
from dotenv import load_dotenv
from fastapi import HTTPException, Request

load_dotenv()

# Where this service reaches Task Manager. In production TM is on the same
# host; default to loopback:8080. Overridable for other layouts.
TM_INTERNAL_BASE = os.getenv("TM_INTERNAL_BASE", "http://127.0.0.1:8080").rstrip("/")

# Local-dev bypass — NEVER set this in production (.env on the server must
# not contain it). When on, no TM session is required.
LOCAL_DEV = os.getenv("COMPANIES_LOCAL_DEV", "").strip().lower() in ("1", "true", "yes")
LOCAL_DEV_EMAIL = os.getenv("COMPANIES_LOCAL_DEV_EMAIL", "local-dev@treppides.com")

if LOCAL_DEV:
    logging.warning(
        "companies-api AUTH BYPASS is ON (COMPANIES_LOCAL_DEV) — every write is "
        "attributed to %s. This must never be set in production.", LOCAL_DEV_EMAIL,
    )


def require_user(request: Request) -> dict:
    """FastAPI dependency for write routes. Returns the authenticated Hub user
    ({email, name, tier, ...}) or raises 401/403. In LOCAL_DEV, returns a fake
    admin without contacting Task Manager."""
    if LOCAL_DEV:
        return {
            "email": LOCAL_DEV_EMAIL,
            "name": "Local Dev",
            "tier": "ADMIN",
            "isAdmin": True,
            "_local_dev": True,
        }

    cookie = request.headers.get("cookie", "")
    if not cookie:
        raise HTTPException(status_code=401, detail="Not signed in.")

    try:
        res = requests.get(
            f"{TM_INTERNAL_BASE}/api/me",
            headers={"Cookie": cookie, "X-Requested-With": "XMLHttpRequest"},
            timeout=(5, 15),
        )
    except requests.RequestException as e:
        logging.error("Task Manager unreachable for auth: %s", e)
        raise HTTPException(status_code=503, detail="Authentication service unavailable.")

    if res.status_code == 401 or res.status_code == 403:
        raise HTTPException(status_code=401, detail="Not signed in.")
    if res.status_code != 200:
        logging.error("Unexpected /api/me status %s during auth.", res.status_code)
        raise HTTPException(status_code=503, detail="Authentication service error.")

    user = res.json()
    tier = (user.get("tier") or "").upper()
    if not tier or tier == "NONE":
        # Same access gate as the frontend (auth.js:37): eligible Hub users only.
        raise HTTPException(status_code=403, detail="You are not eligible to make edits.")
    return user
