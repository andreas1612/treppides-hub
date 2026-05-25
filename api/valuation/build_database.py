from sqlalchemy import Column, String, Float, Integer
from sqlalchemy.orm import declarative_base

Base = declarative_base()

# Edition IDs are 'YYYY-MM' strings (e.g. '2024-01', '2025-07') so they sort
# lexically the same way they sort chronologically. Every Damodaran-derived
# table carries this column as part of its composite primary key so the DB
# can hold the full archive (2008-2026) and the API can serve a specific
# edition on request. Default for legacy/un-stamped rows is '2024-01' —
# that is what the bundled CSVs in this directory represent.

class Edition(Base):
    """Catalog of every Damodaran edition that has been ingested.
    The frontend reads this for the 'Reference data as of' dropdown."""
    __tablename__ = 'editions'
    edition_id = Column(String, primary_key=True, index=True)   # 'YYYY-MM'
    label = Column(String)                                      # 'January 2024'
    published_date = Column(String)                             # ISO date or 'YYYY-MM'
    ingested_at = Column(String)                                # ISO timestamp
    source = Column(String)                                     # 'archive' | 'current' | 'bundled-csv'
    notes = Column(String)


class Rates1Reference(Base):
    __tablename__ = 'rates1_reference'
    industry_name = Column(String, primary_key=True, index=True)
    edition = Column(String, primary_key=True, index=True)
    number_of_firms = Column(Integer)
    beta = Column(Float)
    d_e_ratio = Column(Float)
    effective_tax_rate = Column(Float)
    unlevered_beta = Column(Float)
    cash_firm_value = Column(Float)
    unlevered_beta_corrected_for_cash = Column(Float)
    hilo_risk = Column(Float)
    standard_deviation_of_equity = Column(Float)
    standard_deviation_in_operating_income = Column(Float)
    year_2020 = Column(Float)
    year_2021 = Column(Float)
    year_2022 = Column(Float)
    year_2022_1 = Column(Float)
    average_2020_24 = Column(Float)

class Rates2Reference(Base):
    __tablename__ = 'rates2_reference'
    country = Column(String, primary_key=True, index=True)
    edition = Column(String, primary_key=True, index=True)
    continents = Column(String)
    moodys_rating = Column(String)
    adj_default_spread = Column(Float)
    equity_risk_premium = Column(Float)
    country_risk_premium = Column(Float)

class Rates3Reference(Base):
    __tablename__ = 'rates3_reference'
    industry_name = Column(String, primary_key=True, index=True)
    edition = Column(String, primary_key=True, index=True)
    number_of_firms = Column(Integer)
    cagr_in_net_income_last_5_years = Column(Float)
    cagr_in_revenues_last_5_years = Column(Float)
    expected_growth_in_revenues_next_2_years = Column(Float)
    expected_growth_in_revenues_next_5_years = Column(Float)
    expected_growth_in_eps_next_5_years = Column(Float)

class Rates4Reference(Base):
    __tablename__ = 'rates4_reference'
    currency = Column(String, primary_key=True, index=True)
    edition = Column(String, primary_key=True, index=True)
    govt_bond_rate_12_31_22 = Column(Float)
    bond_rating_moodys = Column(String)
    riskfree_rate = Column(Float)
    default_spread_based_on_rating = Column(Float)
    risk_free_rate = Column(Float)

class TaxRatesReference(Base):
    __tablename__ = 'tax_rates_reference'
    country = Column(String, primary_key=True, index=True)
    edition = Column(String, primary_key=True, index=True)
    corporate_tax_rate = Column(Float)

class ContinentAverages(Base):
    __tablename__ = 'continent_averages'
    continent_name = Column(String, primary_key=True, index=True)
    edition = Column(String, primary_key=True, index=True)
    average_equity_risk_premium = Column(Float)
    average_country_risk_premium = Column(Float)

class ReportMeta(Base):
    """Key/value store for report-level metadata (latest Damodaran edition pointer,
    last fetch timestamps, etc.)."""
    __tablename__ = 'report_meta'
    key = Column(String, primary_key=True, index=True)
    value = Column(String)


class ExchangeRate(Base):
    """Historical FX rates expressed as <currency> per 1 USD (USD = 1.0).
    Composite key on (currency_name, as_of_date) so callers can look up the
    rate that matches a specific valuation date. `as_of_date` is YYYY-MM-DD.

    Not tied to Damodaran editions — sourced from Frankfurter/ECB and refreshed
    annually via fetch_exchange_rates.py."""
    __tablename__ = 'exchange_rates'
    currency_name = Column(String, primary_key=True, index=True)
    as_of_date = Column(String, primary_key=True, index=True)
    rate_per_usd = Column(Float, nullable=False)
    source = Column(String)
