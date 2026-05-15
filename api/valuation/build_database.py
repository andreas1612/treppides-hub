from sqlalchemy import Column, String, Float, Integer
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class Rates1Reference(Base):
    __tablename__ = 'rates1_reference'
    industry_name = Column(String, primary_key=True, index=True)
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
    continents = Column(String)
    moodys_rating = Column(String)
    adj_default_spread = Column(Float)
    equity_risk_premium = Column(Float)
    country_risk_premium = Column(Float)

class Rates3Reference(Base):
    __tablename__ = 'rates3_reference'
    industry_name = Column(String, primary_key=True, index=True)
    number_of_firms = Column(Integer)
    cagr_in_net_income_last_5_years = Column(Float)
    cagr_in_revenues_last_5_years = Column(Float)
    expected_growth_in_revenues_next_2_years = Column(Float)
    expected_growth_in_revenues_next_5_years = Column(Float)
    expected_growth_in_eps_next_5_years = Column(Float)

class Rates4Reference(Base):
    __tablename__ = 'rates4_reference'
    currency = Column(String, primary_key=True, index=True)
    govt_bond_rate_12_31_22 = Column(Float)
    bond_rating_moodys = Column(String)
    riskfree_rate = Column(Float)
    default_spread_based_on_rating = Column(Float)
    risk_free_rate = Column(Float)

class TaxRatesReference(Base):
    __tablename__ = 'tax_rates_reference'
    country = Column(String, primary_key=True, index=True)
    corporate_tax_rate = Column(Float)

class ContinentAverages(Base):
    __tablename__ = 'continent_averages'
    continent_name = Column(String, primary_key=True, index=True)
    average_equity_risk_premium = Column(Float)
    average_country_risk_premium = Column(Float)

class ReportMeta(Base):
    """Key/value store for report-level metadata (Damodaran edition, last fetch timestamps, etc.)"""
    __tablename__ = 'report_meta'
    key = Column(String, primary_key=True, index=True)
    value = Column(String)
