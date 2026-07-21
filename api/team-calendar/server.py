"""
api/team-calendar/server.py
FastAPI backend for the Team Calendar hub tool.

- Staff list + team grouping from staff-directory API (department + subDepartment)
- Event CRUD on InternalTools.dbo.CalendarEvents (KTDEV:1433, pymssql)
- Identity passed from frontend via X-User-Email header (trusted — behind nginx, admin-only hub)

Run:
    uvicorn server:app --reload --port 8004

Endpoints:
    GET  /api/teamcal/my-view          — departments visible to the logged-in user
    GET  /api/teamcal/staff            — staff in a department
    GET  /api/teamcal/events           — events for a date range + department
    POST /api/teamcal/events           — create event
    PUT  /api/teamcal/events/{id}      — edit event
    DELETE /api/teamcal/events/{id}    — delete event
"""

import os
import time
from datetime import date, datetime
from typing import Optional

import httpx
import pymssql
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

# ── DB credentials ────────────────────────────────────────────────────────────
DB_HOST     = os.environ.get("DB_HOST", "KTDEV")
DB_PORT     = int(os.environ.get("DB_PORT", "1433"))
DB_USER     = os.environ.get("DB_USER", "kyc_app")
DB_PASSWORD = os.environ["DB_PASSWORD"]
DB_NAME     = os.environ.get("DB_NAME", "InternalTools")

# ── Staff directory API (same server, port 8010) ─────────────────────────────
# Single source of truth for staff list + team grouping.
# Returns department + subDepartment per person (from departments.json).
STAFFDIR_URL = "http://127.0.0.1:8010/api/staff"

_staff_cache: dict = {"data": None, "by_email": None, "expires_at": 0}


def fetch_all_staff() -> list:
    """Fetch staff list from the staff-directory API (5-min cache)."""
    if _staff_cache["data"] and time.time() < _staff_cache["expires_at"]:
        return _staff_cache["data"]

    resp = httpx.get(STAFFDIR_URL, timeout=30)
    resp.raise_for_status()
    raw = resp.json()

    staff = []
    for s in raw:
        email = (s.get("email") or "").lower().strip()
        if not email:
            continue
        dept = s.get("department") or "Other"
        sub  = s.get("subDepartment") or None
        staff.append({
            "azureId":       s.get("azureId"),
            "name":          s.get("name") or email,
            "email":         email,
            "department":    dept,
            "subDepartment": sub,
            "teamKey":       f"{dept} / {sub}" if sub else dept,
            "jobTitle":      s.get("jobTitle") or None,
            "location":      s.get("location") or None,
        })

    staff.sort(key=lambda s: s["name"])
    by_email = {s["email"]: s for s in staff}
    _staff_cache["data"]       = staff
    _staff_cache["by_email"]   = by_email
    _staff_cache["expires_at"] = time.time() + 300  # 5 min
    return staff


def get_staff_by_email() -> dict:
    fetch_all_staff()
    return _staff_cache["by_email"] or {}


# ── Team resolution ──────────────────────────────────────────────────────────
# A "team" = all people sharing the same (department, subDepartment) pair
# from the staff directory.  e.g. "ICAS / Compliance" or "Technology".
# Directors will be hardcoded later (multi-team view).


def resolve_team(email: str) -> tuple[list[dict], str]:
    """
    Resolve the team the user belongs to using the staff directory.

    Team = all people with the same (department, subDepartment).
    Everyone sees all members of their team, regardless of seniority.

    Returns (team_members[], viewMode).
    """
    email = email.lower().strip()
    all_staff = fetch_all_staff()
    by_email  = get_staff_by_email()

    user = by_email.get(email)
    if not user:
        return [], "single"

    user_key = user["teamKey"]
    teammates = [s for s in all_staff if s["teamKey"] == user_key]

    # Make sure current user is always included
    if not any(m["email"] == email for m in teammates):
        teammates.append(user)

    teammates.sort(key=lambda m: m["name"])
    depts = sorted(set(m["department"] for m in teammates))
    return teammates, "multi" if len(depts) > 1 else "single"


# ── DB helpers ────────────────────────────────────────────────────────────────
def get_db():
    return pymssql.connect(
        server=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        as_dict=True,
    )


# ── Pydantic models ──────────────────────────────────────────────────────────
class EventCreate(BaseModel):
    title:      str = Field(..., max_length=200)
    eventType:  str = Field(..., pattern=r"^(LEAVE|MEETING|DEADLINE)$")
    ownerEmail: str = Field(..., max_length=150)
    startDate:  date
    endDate:    date
    allDay:     bool = True
    notes:      Optional[str] = Field(None, max_length=500)


class EventUpdate(BaseModel):
    title:     Optional[str] = Field(None, max_length=200)
    eventType: Optional[str] = Field(None, pattern=r"^(LEAVE|MEETING|DEADLINE)$")
    startDate: Optional[date] = None
    endDate:   Optional[date] = None
    allDay:    Optional[bool] = None
    notes:     Optional[str] = Field(None, max_length=500)


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Team Calendar API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://hub.treppides.com"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
    allow_credentials=True,
)


def _get_user_email(request: Request) -> str:
    """Extract user email from X-User-Email header or email query param."""
    email = request.headers.get("x-user-email") or request.query_params.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Missing user email")
    return email.lower().strip()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/teamcal/my-view")
def my_view(request: Request):
    """
    Returns the user's team (via manager hierarchy) + departments for filtering.

    - Manager/director: team = themselves + their direct reports.
    - Junior/senior: team = their manager + manager's other reports (peers).
    - Includes the full team member list so the frontend doesn't need a second call.
    """
    email = _get_user_email(request)
    by_email = get_staff_by_email()
    user = by_email.get(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found in directory")

    team, view_mode = resolve_team(email)
    depts = sorted(set(m["department"] for m in team)) if team else [user["department"]]

    return {
        "viewMode":    view_mode,
        "myDept":      user["department"],
        "myTeam":      user.get("teamKey"),
        "departments": depts,
        "team": [
            {
                "name":       m["name"],
                "email":      m["email"],
                "department": m["department"],
                "subDepartment": m.get("subDepartment"),
                "teamKey":    m.get("teamKey"),
                "azureId":    m.get("azureId"),
                "jobTitle":   m.get("jobTitle"),
            }
            for m in team
        ],
        "teamCount": len(team),
    }


@app.get("/api/teamcal/staff")
def staff_by_dept(dept: str = Query(..., description="Department name")):
    """Staff list filtered by department."""
    all_staff = fetch_all_staff()
    filtered = [s for s in all_staff if s["department"] == dept]
    if not filtered:
        # Try case-insensitive match
        dept_lower = dept.lower()
        filtered = [s for s in all_staff if s["department"].lower() == dept_lower]
    return filtered


@app.get("/api/teamcal/departments")
def all_departments():
    """List all unique departments from the staff directory."""
    all_staff = fetch_all_staff()
    depts = sorted(set(s["department"] for s in all_staff))
    return depts


@app.get("/api/teamcal/events")
def get_events(
    dept: Optional[str] = Query(None, description="Department filter"),
    owner: Optional[str] = Query(None, description="Owner email filter"),
    start: str = Query(..., description="Start date YYYY-MM-DD", alias="from"),
    end:   str = Query(..., description="End date YYYY-MM-DD",   alias="to"),
):
    """
    Events in a date range, optionally filtered by department or owner.
    An event overlaps the range if its StartDate <= end AND EndDate >= start.
    """
    try:
        start_dt = datetime.strptime(start, "%Y-%m-%d").date()
        end_dt   = datetime.strptime(end,   "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format — use YYYY-MM-DD")

    by_email = get_staff_by_email()

    try:
        conn = get_db()
    except Exception:
        # DB unreachable — return empty (calendar is read-only until table exists)
        return []

    try:
        cursor = conn.cursor()
        sql = """
            SELECT EventId, Title, EventType, OwnerEmail, Department,
                   StartDate, EndDate, AllDay, Notes, Status, CreatedBy, CreatedAt
            FROM dbo.CalendarEvents
            WHERE StartDate <= %s AND EndDate >= %s
        """
        params = [end_dt, start_dt]

        if dept:
            sql += " AND Department = %s"
            params.append(dept)
        if owner:
            sql += " AND OwnerEmail = %s"
            params.append(owner.lower())

        sql += " ORDER BY StartDate, OwnerEmail"
        cursor.execute(sql, tuple(params))
        rows = cursor.fetchall()
    except pymssql.ProgrammingError:
        # Table doesn't exist yet — DBA must run CalendarEvents_create.sql
        return []
    finally:
        conn.close()

    events = []
    for r in rows:
        owner_info = by_email.get((r["OwnerEmail"] or "").lower(), {})
        events.append({
            "eventId":    r["EventId"],
            "title":      r["Title"],
            "eventType":  r["EventType"],
            "ownerEmail": r["OwnerEmail"],
            "ownerName":  owner_info.get("name", r["OwnerEmail"]),
            "department": r["Department"],
            "startDate":  r["StartDate"].isoformat() if hasattr(r["StartDate"], "isoformat") else str(r["StartDate"]),
            "endDate":    r["EndDate"].isoformat()   if hasattr(r["EndDate"],   "isoformat") else str(r["EndDate"]),
            "allDay":     bool(r["AllDay"]),
            "notes":      r["Notes"],
            "status":     r["Status"],
            "createdBy":  r["CreatedBy"],
            "createdAt":  r["CreatedAt"].isoformat() if hasattr(r["CreatedAt"], "isoformat") else str(r["CreatedAt"]),
        })
    return events


@app.post("/api/teamcal/events", status_code=201)
def create_event(body: EventCreate, request: Request):
    """Create a new calendar event."""
    created_by = _get_user_email(request)
    by_email = get_staff_by_email()

    owner_email = body.ownerEmail.lower().strip()
    owner = by_email.get(owner_email)
    department = owner["department"] if owner else "Other"

    if body.endDate < body.startDate:
        raise HTTPException(status_code=400, detail="End date must be >= start date")

    try:
        conn = get_db()
    except Exception:
        raise HTTPException(status_code=503, detail="Database unavailable")

    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO dbo.CalendarEvents
                (Title, EventType, OwnerEmail, Department, StartDate, EndDate, AllDay, Notes, Status, CreatedBy)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            body.title, body.eventType, owner_email, department,
            body.startDate, body.endDate, body.allDay, body.notes,
            "APPROVED", created_by,
        ))
        conn.commit()

        # Get the inserted ID
        cursor.execute("SELECT SCOPE_IDENTITY() AS id")
        row = cursor.fetchone()
        event_id = row["id"] if row else None
    except pymssql.ProgrammingError:
        raise HTTPException(status_code=503, detail="CalendarEvents table not created yet — ask DBA to run CalendarEvents_create.sql")
    finally:
        conn.close()

    return {
        "eventId":    event_id,
        "title":      body.title,
        "eventType":  body.eventType,
        "ownerEmail": owner_email,
        "ownerName":  owner["name"] if owner else owner_email,
        "department": department,
        "startDate":  body.startDate.isoformat(),
        "endDate":    body.endDate.isoformat(),
        "allDay":     body.allDay,
        "notes":      body.notes,
        "status":     "APPROVED",
        "createdBy":  created_by,
    }


@app.put("/api/teamcal/events/{event_id}")
def update_event(event_id: int, body: EventUpdate, request: Request):
    """Update an existing event (own events or admin)."""
    user_email = _get_user_email(request)

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT CreatedBy, OwnerEmail FROM dbo.CalendarEvents WHERE EventId = %s",
            (event_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")

        # Allow edit if user created it or owns it
        if row["CreatedBy"].lower() != user_email and row["OwnerEmail"].lower() != user_email:
            raise HTTPException(status_code=403, detail="Not authorized to edit this event")

        # Build dynamic UPDATE
        fields = []
        params = []
        if body.title is not None:
            fields.append("Title = %s")
            params.append(body.title)
        if body.eventType is not None:
            fields.append("EventType = %s")
            params.append(body.eventType)
        if body.startDate is not None:
            fields.append("StartDate = %s")
            params.append(body.startDate)
        if body.endDate is not None:
            fields.append("EndDate = %s")
            params.append(body.endDate)
        if body.allDay is not None:
            fields.append("AllDay = %s")
            params.append(body.allDay)
        if body.notes is not None:
            fields.append("Notes = %s")
            params.append(body.notes)

        if not fields:
            raise HTTPException(status_code=400, detail="No fields to update")

        params.append(event_id)
        cursor.execute(
            f"UPDATE dbo.CalendarEvents SET {', '.join(fields)} WHERE EventId = %s",
            tuple(params),
        )
        conn.commit()
    finally:
        conn.close()

    return {"ok": True, "eventId": event_id}


@app.delete("/api/teamcal/events/{event_id}")
def delete_event(event_id: int, request: Request):
    """Delete an event (own events or admin)."""
    user_email = _get_user_email(request)

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT CreatedBy, OwnerEmail FROM dbo.CalendarEvents WHERE EventId = %s",
            (event_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")

        if row["CreatedBy"].lower() != user_email and row["OwnerEmail"].lower() != user_email:
            raise HTTPException(status_code=403, detail="Not authorized to delete this event")

        cursor.execute("DELETE FROM dbo.CalendarEvents WHERE EventId = %s", (event_id,))
        conn.commit()
    finally:
        conn.close()

    return {"ok": True, "eventId": event_id}
