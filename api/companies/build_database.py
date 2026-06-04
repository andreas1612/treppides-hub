# ============================================================
# api/companies/build_database.py — schema + engine for the
# Company Master Database.
#
# A persistent SQLite mirror of every ClickUp task across the 10 CRM
# spaces, annotated so each task's ORIGIN (space/folder/list) and full
# DETAILS (all custom fields) are preserved. Kept fresh by sync.py via
# ClickUp's date_updated_gt incremental fetch.
#
# Three tables:
#   tasks       — one row per ClickUp task (the raw, annotated mirror)
#   companies   — derived per-TID rollup (the fee totals the dashboard shows)
#   sync_state  — per-space resume cursor for incremental sync
#
# Run directly to (re)create the empty schema:
#   python build_database.py
# ============================================================

from pathlib import Path

from sqlalchemy import (
    Column, String, Float, Integer, Boolean, Text, Index, create_engine, event, inspect, text,
)
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()

DB_PATH = Path(__file__).resolve().parent / "companies.db"


class Task(Base):
    """One ClickUp task, mirrored and annotated. `custom_fields` keeps the full
    flattened field set as JSON so nothing the task carries is ever lost."""
    __tablename__ = "tasks"

    id            = Column(String, primary_key=True)     # ClickUp task id
    tid           = Column(String, index=True)           # Clickup_TID (company code), nullable
    name          = Column(String)                       # task title (company name lives here)

    # Origin — never lose where a task came from.
    list_name     = Column(String, index=True)           # 'Deals' | 'Accounts (Companies)' | ...
    folder_name   = Column(String)
    parent_id     = Column(String)                        # ClickUp parent task id (subtasks only)
    parent_name   = Column(String)                        # resolved parent task title (filled in sync 2nd pass)
    space_id      = Column(String, index=True)
    space_name    = Column(String)

    status        = Column(String)
    status_color  = Column(String)
    url           = Column(String)
    assignees     = Column(Text)                          # JSON array of names

    # Fee data (Deals only). deal_value is the parsed 'Deal Value' currency field.
    deal_value    = Column(Float)
    currency      = Column(String, default="EUR")
    is_deal       = Column(Boolean, default=False, index=True)   # list_name == 'Deals'
    is_lost       = Column(Boolean, default=False)               # status in LOST_STATUSES

    # Promoted custom fields used for filtering/sorting/display (also kept in the
    # custom_fields JSON). Indexed so the Group Dashboard filters are cheap.
    service         = Column(String, index=True)   # 'Service' field — Audit/Bookkeeping/VAT/...
    year_of_project = Column(String, index=True)   # 'Year of Project' — clean year string
    business_year   = Column(String, index=True)   # 'Business Year' field — clean year string
    department      = Column(String, index=True)   # 'Departement' field — Audit/FCR/FRA/...
    ubos            = Column(Text)                  # JSON array of normalized UBO names (from ubo/ubo_2/... slots)

    date_created  = Column(Integer)                       # Unix ms
    date_updated  = Column(Integer, index=True)           # Unix ms — drives incremental sync
    date_due      = Column(Integer)

    custom_fields = Column(Text)                          # full flattened JSON — nothing lost
    synced_at     = Column(Integer)                       # Unix ms of last upsert

Index("idx_tasks_name_nocase", Task.name)  # plain index; NOCASE handled in queries


class Company(Base):
    """Derived per-company rollup, rebuilt after each sync from `tasks`. This is
    what the dashboard reads for the headline fee figures."""
    __tablename__ = "companies"

    tid               = Column(String, primary_key=True)
    display_name      = Column(String, index=True)
    client_code       = Column(String)
    task_count        = Column(Integer, default=0)
    deal_count        = Column(Integer, default=0)

    active_deal_value = Column(Float, default=0.0)   # HEADLINE — excludes lost deals
    active_deal_count = Column(Integer, default=0)
    lost_deal_value   = Column(Float, default=0.0)   # shown separately
    lost_deal_count   = Column(Integer, default=0)

    space_names       = Column(Text)                 # JSON array of spaces this company appears in
    ubos              = Column(Text)                  # JSON array of this company's UBO names (union across its tasks)
    last_activity     = Column(Integer)              # max(date_updated)


class SyncState(Base):
    """Per-space incremental-sync cursor. last_synced_ms is the high-water mark
    of date_updated seen so far; the next incremental fetch uses
    date_updated_gt = last_synced_ms."""
    __tablename__ = "sync_state"

    space_id       = Column(String, primary_key=True)
    last_synced_ms = Column(Integer, default=0)
    last_run_ms    = Column(Integer)
    last_status    = Column(String)


def make_engine(db_path: Path = DB_PATH):
    """Create the SQLite engine with the same WAL/concurrency pragmas the
    Valuation API uses (api/valuation/main.py)."""
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA cache_size=-32000")
        cur.close()

    return engine


engine = make_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    """Create tables if missing, then bring existing tables up to the current
    schema by adding any columns the models declare but the DB lacks.

    create_all() does NOT alter an existing table, so when we add a column to a
    model a pre-existing DB would otherwise be missing it (and every insert that
    names the column fails with 'no such column'). SQLite supports cheap
    ALTER TABLE ... ADD COLUMN, so we backfill missing columns here. New columns
    start NULL and get populated on the next sync — no manual rebuild needed."""
    Base.metadata.create_all(engine)

    insp = inspect(engine)
    existing_tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue  # freshly created by create_all — already current
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                ddl = f'ALTER TABLE {table.name} ADD COLUMN "{col.name}" {col.type.compile(engine.dialect)}'
                conn.execute(text(ddl))


if __name__ == "__main__":
    init_db()
    print(f"Schema ready at {DB_PATH}")
