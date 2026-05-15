# ============================================================
# api/valuation/main.py — FastAPI backend for the Valuation Tool.
#
# Serves the reference data the Valtrix frontend needs:
#   dropdowns (continents / countries / industries / currencies)
#   reference values (ERP, tax rate, industry betas, currency rates)
#   report metadata (Damodaran edition + last fetch)
#
# All routes are prefixed /api/valuation/* so nginx can proxy a
# single location block to this service without colliding with the
# ClickUp Fees API at /api/clickup/* (port 8001).
#
# Run:  uvicorn main:app --host 127.0.0.1 --port 8002 --reload
# ============================================================

from pathlib import Path

from fastapi import FastAPI, HTTPException, Depends, APIRouter
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from build_database import (
    Rates1Reference,
    Rates2Reference,
    Rates3Reference,
    Rates4Reference,
    TaxRatesReference,
    ContinentAverages,
    ReportMeta,
)

app = FastAPI(title="Valuation Reference API", version="1.0.0")

# No CORS middleware: in production, nginx serves both the UI and this
# API under https://hub.treppides.com, so all browser requests are
# same-origin and CORS never applies. Adding `Access-Control-Allow-Origin`
# headers here would only weaken that — a permissive origin would let
# any external page a logged-in colleague visits read these endpoints.
# If you ever need to call the API from a different origin (e.g. a dev
# tool on another port), re-add CORSMiddleware with an explicit allow-list.

# Resolve the SQLite file relative to this script so the service can be
# started from any working directory (systemd / docker / cwd dev).
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


# All endpoints hang off this router so nginx can proxy /api/valuation/*
# straight through without rewriting paths.
router = APIRouter(prefix="/api/valuation")


# --- Health -----------------------------------------------------------

@router.get("/health")
def health():
    return {"ok": True}


# --- Dropdown populators ---------------------------------------------

@router.get("/dropdowns/continents")
def get_continents(db: Session = Depends(get_db)):
    records = db.query(ContinentAverages.continent_name).order_by(ContinentAverages.continent_name).all()
    return [r[0] for r in records]


@router.get("/dropdowns/countries")
def get_countries(db: Session = Depends(get_db)):
    records = db.query(TaxRatesReference.country).order_by(TaxRatesReference.country).all()
    return [r[0] for r in records]


@router.get("/dropdowns/industries")
def get_industries(db: Session = Depends(get_db)):
    records = db.query(Rates1Reference.industry_name).order_by(Rates1Reference.industry_name).all()
    return [r[0] for r in records]


@router.get("/dropdowns/currencies")
def get_currencies(db: Session = Depends(get_db)):
    records = db.query(Rates4Reference.currency).order_by(Rates4Reference.currency).all()
    return [r[0] for r in records]


# --- Reference-data fetchers -----------------------------------------

@router.get("/reference/continent/{continent_name}")
def get_continent_reference(continent_name: str, db: Session = Depends(get_db)):
    record = db.query(ContinentAverages).filter(ContinentAverages.continent_name == continent_name).first()
    if not record:
        raise HTTPException(status_code=404, detail="Continent not found")
    return {
        "continent_name": record.continent_name,
        "equity_risk_premium": record.average_equity_risk_premium,
        "country_risk_premium": record.average_country_risk_premium,
    }


@router.get("/reference/tax-rate/{country_name}")
def get_tax_rate_reference(country_name: str, db: Session = Depends(get_db)):
    record = db.query(TaxRatesReference).filter(TaxRatesReference.country == country_name).first()
    if not record:
        raise HTTPException(status_code=404, detail="Country not found")
    return {
        "country_name": record.country,
        "statutory_tax_rate": record.corporate_tax_rate,
    }


@router.get("/reference/industry/{industry_name}")
def get_industry_reference(industry_name: str, db: Session = Depends(get_db)):
    r1 = db.query(Rates1Reference).filter(Rates1Reference.industry_name == industry_name).first()
    r3 = db.query(Rates3Reference).filter(Rates3Reference.industry_name == industry_name).first()
    if not r1 and not r3:
        raise HTTPException(status_code=404, detail="Industry not found")
    return {
        "industry_name": r1.industry_name if r1 else r3.industry_name,
        "beta": r1.beta if r1 else None,
        "unlevered_beta": r1.unlevered_beta if r1 else None,
        "debt_to_equity": r1.d_e_ratio if r1 else None,
        "effective_tax_rate": r1.effective_tax_rate if r1 else None,
        "hist_revenue_cagr": r3.cagr_in_revenues_last_5_years if r3 else None,
        "exp_revenue_growth_2yr": r3.expected_growth_in_revenues_next_2_years if r3 else None,
        "exp_eps_growth_5yr": r3.expected_growth_in_eps_next_5_years if r3 else None,
    }


@router.get("/reference/currency/{currency_name}")
def get_currency_reference(currency_name: str, db: Session = Depends(get_db)):
    record = db.query(Rates4Reference).filter(Rates4Reference.currency == currency_name).first()
    if not record:
        raise HTTPException(status_code=404, detail="Currency not found")
    return {
        "currency_name": record.currency,
        "govt_bond_rate": record.govt_bond_rate_12_31_22,
        "risk_free_rate": record.risk_free_rate,
        "default_spread": record.default_spread_based_on_rating,
    }


# --- Report metadata -------------------------------------------------

@router.get("/meta/damodaran-edition")
def get_damodaran_edition(db: Session = Depends(get_db)):
    """Return the recorded edition string for the Damodaran datasets (e.g. 'January 2024').
    Falls back to a sensible default if update_damodaran.py has never been run."""
    record = db.query(ReportMeta).filter(ReportMeta.key == "damodaran_edition").first()
    fetched = db.query(ReportMeta).filter(ReportMeta.key == "damodaran_last_fetched").first()
    return {
        "edition": record.value if record else "January 2024",
        "last_fetched": fetched.value if fetched else None,
    }


app.include_router(router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8002, reload=True)
