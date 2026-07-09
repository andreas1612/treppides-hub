# ============================================================
# api/companies/clickup_write.py — the ONLY place companies-api mutates ClickUp.
#
# Three write operations, backing the Group Dashboard's inline edits:
#   set_status(task_id, status)      → PUT  /task/{id}   {"status"}
#   set_assignee(task_id, add, rem)  → PUT  /task/{id}   {"assignees": {add, rem}}
#   add_comment(task_id, text)       → POST /task/{id}/comment
#
# Plus read helpers for the edit UI's dropdowns:
#   list_statuses(list_id)  — the target list's valid statuses
#   list_members()          — the workspace roster (id + display name)
#
# All calls use the same token + header convention as sync.py (`_headers`).
# Errors are logged with detail but surfaced to callers as clean HTTPExceptions
# so raw ClickUp responses never reach the browser.
#
# DRY_RUN: when COMPANIES_DRY_RUN is set, the mutating calls validate + log but
# do NOT contact ClickUp. Everything else (auth, audit, local reconcile against
# the CURRENT live state) still runs — lets you exercise the whole flow locally
# without changing real deals. Reads are always live.
# ============================================================

import os
import logging

import requests
from dotenv import load_dotenv
from fastapi import HTTPException

from sync import _headers, get_team_id, _API  # reuse token/header + team resolution

load_dotenv()

DRY_RUN = os.getenv("COMPANIES_DRY_RUN", "").strip().lower() in ("1", "true", "yes")

if DRY_RUN:
    logging.warning(
        "companies-api DRY_RUN is ON (COMPANIES_DRY_RUN) — status/assignee/comment "
        "writes are validated and audited but NOT sent to ClickUp."
    )

_TIMEOUT = (10, 30)


def _put_task(task_id: str, body: dict) -> None:
    """PUT a partial update to a task. Raises HTTPException(502) on failure."""
    if DRY_RUN:
        logging.info("[DRY_RUN] would PUT /task/%s %s", task_id, body)
        return
    url = f"{_API}/task/{task_id}"
    try:
        resp = requests.put(url, headers={**_headers(), "Content-Type": "application/json"},
                            json=body, timeout=_TIMEOUT)
    except requests.RequestException as e:
        logging.error("ClickUp update-task request failed (task %s): %s", task_id, e)
        raise HTTPException(status_code=502, detail="Unable to reach ClickUp. Please try again.")
    if resp.status_code not in (200, 201):
        logging.error("ClickUp update-task error (task %s): HTTP %s — %s",
                      task_id, resp.status_code, resp.text[:500])
        raise HTTPException(status_code=502,
                            detail="ClickUp rejected the change. Please try again or contact IT.")


def set_status(task_id: str, status: str) -> None:
    """Set the native task status. Caller must validate `status` against the
    list's statuses first (see list_statuses)."""
    _put_task(task_id, {"status": status})


def set_assignee(task_id: str, add_ids: list[int], rem_ids: list[int]) -> None:
    """Replace assignees: add `add_ids`, remove `rem_ids`. Pass empty lists as
    needed (e.g. clearing = add [] / rem [current])."""
    _put_task(task_id, {"assignees": {"add": add_ids, "rem": rem_ids}})


def add_comment(task_id: str, text: str) -> None:
    """Append a comment to the task's thread (non-destructive)."""
    if DRY_RUN:
        logging.info("[DRY_RUN] would POST /task/%s/comment: %s", task_id, text[:120])
        return
    url = f"{_API}/task/{task_id}/comment"
    try:
        resp = requests.post(url, headers={**_headers(), "Content-Type": "application/json"},
                             json={"comment_text": text, "notify_all": False}, timeout=_TIMEOUT)
    except requests.RequestException as e:
        logging.error("ClickUp comment request failed (task %s): %s", task_id, e)
        raise HTTPException(status_code=502, detail="Unable to reach ClickUp. Please try again.")
    if resp.status_code not in (200, 201):
        logging.error("ClickUp comment error (task %s): HTTP %s — %s",
                      task_id, resp.status_code, resp.text[:500])
        raise HTTPException(status_code=502,
                            detail="ClickUp rejected the comment. Please try again.")


# ---- Read helpers for the edit UI (always live, never dry-run) ----

def list_statuses(list_id: str) -> list[dict]:
    """The target list's valid statuses, in order, for the Status dropdown."""
    url = f"{_API}/list/{list_id}"
    try:
        resp = requests.get(url, headers=_headers(), timeout=_TIMEOUT)
    except requests.RequestException as e:
        logging.error("ClickUp list-meta request failed (list %s): %s", list_id, e)
        raise HTTPException(status_code=502, detail="Unable to reach ClickUp. Please try again.")
    if resp.status_code != 200:
        logging.error("ClickUp list-meta error (list %s): HTTP %s", list_id, resp.status_code)
        raise HTTPException(status_code=502, detail="Unable to reach ClickUp. Please try again.")
    return [
        {"status": s.get("status"), "color": s.get("color"), "orderindex": s.get("orderindex")}
        for s in resp.json().get("statuses", [])
    ]


def list_members() -> list[dict]:
    """The workspace roster (assignable users). Same source as the Forms assignee
    picker in api/clickup/server.py:get_form_members."""
    try:
        resp = requests.get(f"{_API}/team", headers=_headers(), timeout=_TIMEOUT)
    except requests.RequestException as e:
        logging.error("ClickUp team request failed: %s", e)
        raise HTTPException(status_code=502, detail="Unable to reach ClickUp. Please try again.")
    if resp.status_code != 200:
        logging.error("ClickUp team error: HTTP %s", resp.status_code)
        raise HTTPException(status_code=502, detail="Unable to reach ClickUp. Please try again.")
    seen: dict = {}
    for team in resp.json().get("teams", []):
        for m in team.get("members", []):
            u = m.get("user", {}) or {}
            uid = u.get("id")
            if uid is None or uid in seen:
                continue
            seen[uid] = {"id": uid, "username": u.get("username"), "email": u.get("email")}
    return sorted(seen.values(), key=lambda x: (x["username"] or x["email"] or "").lower())
