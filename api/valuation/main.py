# ============================================================
# api/valuation/main.py — FastAPI backend for the Valuation Tool.
#
# Serves the reference data the Valtrix frontend needs:
#   dropdowns (continents / countries / industries / currencies)
#   reference values (ERP, tax rate, industry betas, currency rates)
#   report metadata (Damodaran edition + last fetch)
#   editions catalog (historical 2008-2026)
#
# All routes are prefixed /api/valuation/* so nginx can proxy a
# single location block to this service without colliding with the
# ClickUp Fees API at /api/clickup/* (port 8001).
#
# Every /reference/* endpoint accepts an optional ?edition=YYYY-MM
# query parameter. When omitted the API resolves to the latest
# edition recorded in report_meta.damodaran_latest_edition_id.
#
# Run:  uvicorn main:app --host 127.0.0.1 --port 8002 --reload
# ============================================================

from pathlib import Path

from fastapi import FastAPI, HTTPException, Depends, APIRouter, Query
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from build_database import (
    Edition,
    Rates1Reference,
    Rates2Reference,
    Rates3Reference,
    Rates4Reference,
    TaxRatesReference,
    ContinentAverages,
    ReportMeta,
    ExchangeRate,
)

app = FastAPI(title="Valuation Reference API", version="2.0.0")

# No CORS middleware: same-origin behind nginx in production.

_DB_PATH = Path(__file__).resolve().parent / "valuation_reference.db"
engine = create_engine(
    f"sqlite:///{_DB_PATH}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


router = APIRouter(prefix="/api/valuation")


# --- Edition resolution -----------------------------------------------

def resolve_edition(db: Session, edition: str | None) -> str:
    """Return the edition_id to query. If `edition` is None, return the latest
    edition recorded in report_meta. If `edition` is provided but no such row
    exists in the catalog, 404."""
    if edition:
        row = db.query(Edition).filter(Edition.edition_id == edition).first()
        if not row:
            raise HTTPException(status_code=404, detail=f"Edition '{edition}' not in catalog")
        return edition
    meta = db.query(ReportMeta).filter(ReportMeta.key == "damodaran_latest_edition_id").first()
    if meta and meta.value:
        return meta.value
    # Last-resort fallback: pick the highest edition_id in the catalog.
    row = db.query(Edition).order_by(Edition.edition_id.desc()).first()
    if row:
        return row.edition_id
    raise HTTPException(status_code=503, detail="No editions ingested yet — run seed_database.py")


# --- Health -----------------------------------------------------------

@router.get("/health")
def health():
    return {"ok": True}


# --- Editions catalog -------------------------------------------------

@router.get("/editions")
def list_editions(db: Session = Depends(get_db)):
    """Return all ingested editions, newest first. UI uses this to populate
    the 'Reference data as of' dropdown."""
    rows = db.query(Edition).order_by(Edition.edition_id.desc()).all()
    latest_meta = db.query(ReportMeta).filter(ReportMeta.key == "damodaran_latest_edition_id").first()
    latest_id = latest_meta.value if latest_meta else (rows[0].edition_id if rows else None)
    return {
        "latest": latest_id,
        "editions": [
            {
                "edition_id": r.edition_id,
                "label": r.label,
                "published_date": r.published_date,
                "ingested_at": r.ingested_at,
                "source": r.source,
                "notes": r.notes,
            }
            for r in rows
        ],
    }


@router.get("/editions/{edition_id}")
def get_edition(edition_id: str, db: Session = Depends(get_db)):
    row = db.query(Edition).filter(Edition.edition_id == edition_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Edition not found")
    return {
        "edition_id": row.edition_id,
        "label": row.label,
        "published_date": row.published_date,
        "ingested_at": row.ingested_at,
        "source": row.source,
        "notes": row.notes,
    }


# --- Dropdown populators ---------------------------------------------
# Dropdowns are scoped to an edition so e.g. choosing an old edition only shows
# the countries/industries/currencies that existed in that edition.

@router.get("/dropdowns/continents")
def get_continents(edition: str | None = Query(None), db: Session = Depends(get_db)):
    ed = resolve_edition(db, edition)
    rows = (
        db.query(ContinentAverages.continent_name)
        .filter(ContinentAverages.edition == ed)
        .order_by(ContinentAverages.continent_name)
        .all()
    )
    return [r[0] for r in rows]


@router.get("/dropdowns/countries")
def get_countries(edition: str | None = Query(None), db: Session = Depends(get_db)):
    ed = resolve_edition(db, edition)
    rows = (
        db.query(Rates2Reference.country)
        .filter(Rates2Reference.edition == ed)
        .order_by(Rates2Reference.country)
        .all()
    )
    return [r[0] for r in rows]


@router.get("/dropdowns/industries")
def get_industries(edition: str | None = Query(None), db: Session = Depends(get_db)):
    ed = resolve_edition(db, edition)
    rows = (
        db.query(Rates1Reference.industry_name)
        .filter(Rates1Reference.edition == ed)
        .order_by(Rates1Reference.industry_name)
        .all()
    )
    return [r[0] for r in rows]


@router.get("/dropdowns/currencies")
def get_currencies(edition: str | None = Query(None), db: Session = Depends(get_db)):
    ed = resolve_edition(db, edition)
    rows = (
        db.query(Rates4Reference.currency)
        .filter(Rates4Reference.edition == ed)
        .order_by(Rates4Reference.currency)
        .all()
    )
    return [r[0] for r in rows]


# --- Reference-data fetchers -----------------------------------------

@router.get("/reference/continent/{continent_name}")
def get_continent_reference(
    continent_name: str,
    edition: str | None = Query(None),
    db: Session = Depends(get_db),
):
    ed = resolve_edition(db, edition)
    record = (
        db.query(ContinentAverages)
        .filter(ContinentAverages.continent_name == continent_name, ContinentAverages.edition == ed)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Continent not found for this edition")
    return {
        "continent_name": record.continent_name,
        "edition": record.edition,
        "equity_risk_premium": record.average_equity_risk_premium,
        "country_risk_premium": record.average_country_risk_premium,
    }


@router.get("/reference/tax-rate/{country_name}")
def get_tax_rate_reference(
    country_name: str,
    edition: str | None = Query(None),
    db: Session = Depends(get_db),
):
    ed = resolve_edition(db, edition)
    record = (
        db.query(TaxRatesReference)
        .filter(TaxRatesReference.country == country_name, TaxRatesReference.edition == ed)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Country not found for this edition")
    return {
        "country_name": record.country,
        "edition": record.edition,
        "statutory_tax_rate": record.corporate_tax_rate,
    }


@router.get("/reference/country/{country_name}")
def get_country_reference(
    country_name: str,
    edition: str | None = Query(None),
    db: Session = Depends(get_db),
):
    ed = resolve_edition(db, edition)
    record = (
        db.query(Rates2Reference)
        .filter(Rates2Reference.country == country_name, Rates2Reference.edition == ed)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Country not found for this edition")
    return {
        "country_name": record.country,
        "edition": record.edition,
        "continent": record.continents,
        "moodys_rating": record.moodys_rating,
        "adj_default_spread": record.adj_default_spread,
        "equity_risk_premium": record.equity_risk_premium,
        "country_risk_premium": record.country_risk_premium,
    }


@router.get("/reference/industry/{industry_name}")
def get_industry_reference(
    industry_name: str,
    edition: str | None = Query(None),
    db: Session = Depends(get_db),
):
    ed = resolve_edition(db, edition)
    r1 = (
        db.query(Rates1Reference)
        .filter(Rates1Reference.industry_name == industry_name, Rates1Reference.edition == ed)
        .first()
    )
    r3 = (
        db.query(Rates3Reference)
        .filter(Rates3Reference.industry_name == industry_name, Rates3Reference.edition == ed)
        .first()
    )
    if not r1 and not r3:
        raise HTTPException(status_code=404, detail="Industry not found for this edition")
    return {
        "industry_name": r1.industry_name if r1 else r3.industry_name,
        "edition": ed,
        "beta": r1.beta if r1 else None,
        "unlevered_beta": r1.unlevered_beta if r1 else None,
        "debt_to_equity": r1.d_e_ratio if r1 else None,
        "effective_tax_rate": r1.effective_tax_rate if r1 else None,
        "hist_revenue_cagr": r3.cagr_in_revenues_last_5_years if r3 else None,
        "exp_revenue_growth_2yr": r3.expected_growth_in_revenues_next_2_years if r3 else None,
        "exp_revenue_growth_5yr": r3.expected_growth_in_revenues_next_5_years if r3 else None,
        "exp_eps_growth_5yr": r3.expected_growth_in_eps_next_5_years if r3 else None,
    }


@router.get("/reference/currency/{currency_name}")
def get_currency_reference(
    currency_name: str,
    edition: str | None = Query(None),
    db: Session = Depends(get_db),
):
    ed = resolve_edition(db, edition)
    record = (
        db.query(Rates4Reference)
        .filter(Rates4Reference.currency == currency_name, Rates4Reference.edition == ed)
        .first()
    )
    if not record:
        # Currency table is only available for editions 2024-01 onward. Surface a
        # specific status so the UI can show a contextual note rather than a
        # generic 'not found' error.
        raise HTTPException(
            status_code=404,
            detail=f"Currency-specific risk-free rates not available for edition {ed}",
        )
    return {
        "currency_name": record.currency,
        "edition": record.edition,
        "govt_bond_rate": record.govt_bond_rate_12_31_22,
        "risk_free_rate": record.risk_free_rate,
        "default_spread": record.default_spread_based_on_rating,
    }


@router.get("/reference/fx/{currency_name}")
def get_fx_rate(currency_name: str, date: str | None = None, db: Session = Depends(get_db)):
    """Historical USD-to-currency rate. NOT tied to a Damodaran edition —
    Frankfurter/ECB feed, same data for every edition."""
    query = db.query(ExchangeRate).filter(ExchangeRate.currency_name == currency_name)
    if date:
        exact = query.filter(ExchangeRate.as_of_date == date).first()
        record = exact or query.filter(ExchangeRate.as_of_date <= date).order_by(ExchangeRate.as_of_date.desc()).first()
    else:
        record = query.order_by(ExchangeRate.as_of_date.desc()).first()
    if not record:
        raise HTTPException(status_code=404, detail="Exchange rate not found for currency/date")
    return {
        "currency_name": record.currency_name,
        "as_of_date": record.as_of_date,
        "rate_per_usd": record.rate_per_usd,
        "source": record.source,
        "exact_match": bool(date and record.as_of_date == date),
    }


# --- Report metadata -------------------------------------------------

@router.get("/meta/damodaran-edition")
def get_damodaran_edition(db: Session = Depends(get_db)):
    """Latest edition pointer + last fetch timestamp."""
    edition = db.query(ReportMeta).filter(ReportMeta.key == "damodaran_edition").first()
    latest_id = db.query(ReportMeta).filter(ReportMeta.key == "damodaran_latest_edition_id").first()
    fetched = db.query(ReportMeta).filter(ReportMeta.key == "damodaran_last_fetched").first()
    return {
        "edition": edition.value if edition else "January 2024",
        "edition_id": latest_id.value if latest_id else None,
        "last_fetched": fetched.value if fetched else None,
    }


app.include_router(router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8002, reload=True)
