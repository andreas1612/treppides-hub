# ============================================================
# api/companies/audit.py — append-only audit trail for dashboard edits.
#
# Every status/assignee/comment write records who (Hub identity from
# /api/me), what task/field, old→new value, whether it was a dry run, and
# the result. Persisted to the audit_log table in companies.db (see the
# AuditLog model in build_database.py) — queryable and restart-safe.
#
# record() opens its own short-lived session so it never shares the write
# route's transaction: the audit row is committed independently of whether
# the ClickUp write or the reconcile later succeeds.
# ============================================================

import time
import logging

from build_database import AuditLog, SessionLocal


def record(*, who: dict, task_id: str, tid: str | None, field: str,
           old_value, new_value, dry_run: bool, result: str) -> None:
    """Append one audit row. Best-effort: a logging failure must never break the
    user's edit, so exceptions here are caught and logged, not raised."""
    session = SessionLocal()
    try:
        session.add(AuditLog(
            ts_ms=int(time.time() * 1000),
            who_email=(who or {}).get("email") or "unknown",
            who_name=(who or {}).get("name"),
            task_id=task_id,
            tid=tid,
            field=field,
            old_value=None if old_value is None else str(old_value),
            new_value=None if new_value is None else str(new_value),
            dry_run=dry_run,
            result=result,
        ))
        session.commit()
    except Exception as e:
        session.rollback()
        logging.error("Failed to write audit row (task %s, field %s): %s", task_id, field, e)
    finally:
        session.close()
