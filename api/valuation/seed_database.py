import pandas as pd
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from build_database import (
    Base,
    Rates1Reference,
    Rates2Reference,
    Rates3Reference,
    Rates4Reference,
    TaxRatesReference,
    ContinentAverages,
    ReportMeta,
    ExchangeRate,
)

engine = create_engine('sqlite:///valuation_reference.db', connect_args={"check_same_thread": False})
Session = sessionmaker(bind=engine)

def clean_data(val):
    if pd.isna(val):
        return None
    if isinstance(val, str):
        val = val.strip()
        if not val or val.lower() == 'na':
            return None
        if val.endswith('%'):
            try:
                return float(val.replace('%', '').replace(',', '').strip()) / 100.0
            except ValueError:
                return None
        if val.startswith('$'):
            try:
                return float(val.replace('$', '').replace(',', '').strip())
            except ValueError:
                return None
        if val.startswith('#'):
            return None
        return val
    return val

def clean_numeric(val):
    if pd.isna(val):
        return None
    if isinstance(val, str):
        val = val.strip()
        if not val or val.lower() in ['na', 'n/a', 'none', 'null']:
            return None
        if val.startswith('#'):
            return None
        if val.endswith('%'):
            try:
                return float(val.replace('%', '').replace(',', '').strip()) / 100.0
            except ValueError:
                return None
        if val.startswith('$'):
            try:
                return float(val.replace('$', '').replace(',', '').strip())
            except ValueError:
                return None
        try:
            return float(val.replace(',', ''))
        except ValueError:
            return None
    return float(val) if val is not None else None

def seed_rates1(file_path):
    print(f"Seeding {file_path} to Rates1Reference...")
    df = pd.read_csv(file_path)
    session = Session()
    try:
        for _, row in df.iterrows():
            ind = row.get('Industry Name')
            if pd.isna(ind): continue
            
            record = Rates1Reference(
                industry_name=str(ind).strip(),
                number_of_firms=clean_numeric(row.get('Number of firms')),
                beta=clean_numeric(row.get('Beta ')),
                d_e_ratio=clean_numeric(row.get('D/E Ratio')),
                effective_tax_rate=clean_numeric(row.get('Effective Tax rate')),
                unlevered_beta=clean_numeric(row.get('Unlevered beta')),
                cash_firm_value=clean_numeric(row.get('Cash/Firm value')),
                unlevered_beta_corrected_for_cash=clean_numeric(row.get('Unlevered beta corrected for cash')),
                hilo_risk=clean_numeric(row.get('HiLo Risk')),
                standard_deviation_of_equity=clean_numeric(row.get('Standard deviation of equity')),
                standard_deviation_in_operating_income=clean_numeric(row.get('Standard deviation in operating income (last 10 years)')),
                year_2020=clean_numeric(row.get('2020')),
                year_2021=clean_numeric(row.get('2021')),
                year_2022=clean_numeric(row.get('2022')),
                year_2022_1=clean_numeric(row.get('2022.1')),
                average_2020_24=clean_numeric(row.get('Average: 2020-24'))
            )
            session.merge(record)
        session.commit()
    except Exception as e:
        session.rollback()
        raise e
    finally:
        session.close()

def seed_rates2(file_path):
    print(f"Seeding {file_path} to Rates2Reference and processing ContinentAverages...")
    df = pd.read_csv(file_path)
    session = Session()
    try:
        # Seed 1-to-1 table
        for _, row in df.iterrows():
            country = row.get('Country')
            if pd.isna(country): continue
            
            record = Rates2Reference(
                country=str(country).strip(),
                continents=clean_data(row.get('Continents')),
                moodys_rating=str(row.get("Moody's rating", "")),
                adj_default_spread=clean_numeric(row.get('Adj. Default Spread')),
                equity_risk_premium=clean_numeric(row.get('Equity Risk Premium')),
                country_risk_premium=clean_numeric(row.get('Country Risk Premium'))
            )
            session.merge(record)
        session.commit()
        
        # Calculate Continent Averages
        df['ERP_Clean'] = df['Equity Risk Premium'].apply(clean_numeric)
        df['CRP_Clean'] = df['Country Risk Premium'].apply(clean_numeric)
        
        averages = df.groupby('Continents')[['ERP_Clean', 'CRP_Clean']].mean().reset_index()
        for _, row in averages.iterrows():
            cont = row['Continents']
            if pd.isna(cont): continue
            
            avg_rec = ContinentAverages(
                continent_name=str(cont).strip(),
                average_equity_risk_premium=float(row['ERP_Clean']) if pd.notna(row['ERP_Clean']) else None,
                average_country_risk_premium=float(row['CRP_Clean']) if pd.notna(row['CRP_Clean']) else None
            )
            session.merge(avg_rec)
        session.commit()
    except Exception as e:
        session.rollback()
        raise e
    finally:
        session.close()

def seed_rates3(file_path):
    print(f"Seeding {file_path} to Rates3Reference...")
    df = pd.read_csv(file_path)
    session = Session()
    try:
        for _, row in df.iterrows():
            ind = row.get('Industry Name')
            if pd.isna(ind): continue
            
            record = Rates3Reference(
                industry_name=str(ind).strip(),
                number_of_firms=clean_numeric(row.get('Number of Firms')),
                cagr_in_net_income_last_5_years=clean_numeric(row.get('CAGR in Net Income- Last 5 years')),
                cagr_in_revenues_last_5_years=clean_numeric(row.get('CAGR in Revenues- Last 5 years')),
                expected_growth_in_revenues_next_2_years=clean_numeric(row.get('Expected Growth in Revenues - Next 2 years')),
                expected_growth_in_revenues_next_5_years=clean_numeric(row.get('Expected Growth in Revenues - Next 5 years')),
                expected_growth_in_eps_next_5_years=clean_numeric(row.get('Expected Growth in EPS - Next 5 years'))
            )
            session.merge(record)
        session.commit()
    except Exception as e:
        session.rollback()
        raise e
    finally:
        session.close()

def seed_rates4(file_path):
    print(f"Seeding {file_path} to Rates4Reference...")
    df = pd.read_csv(file_path)
    session = Session()
    try:
        for _, row in df.iterrows():
            curr = row.get('Currency')
            if pd.isna(curr): continue
            
            record = Rates4Reference(
                currency=str(curr).strip(),
                govt_bond_rate_12_31_22=clean_numeric(row.get('Govt Bond Rate 12/31/22')),
                bond_rating_moodys=str(row.get("Bond Rating (Moody's)", "")),
                riskfree_rate=clean_numeric(row.get('Riskfree Rate')),
                default_spread_based_on_rating=clean_numeric(row.get('Default Spread based on rating')),
                risk_free_rate=clean_numeric(row.get('Risk free Rate'))
            )
            session.merge(record)
        session.commit()
    except Exception as e:
        session.rollback()
        raise e
    finally:
        session.close()

def seed_exchange_rates(file_path):
    """Load historical FX rates (currency per 1 USD) from a CSV. Currency names
    must match the dropdown names in Rates4.csv (e.g. 'Euro', 'British Pound')
    so frontend lookups resolve. Idempotent: re-running merges by (currency,
    date) composite key."""
    print(f"Seeding {file_path} to ExchangeRate...")
    if not Path(file_path).exists():
        print(f"  (skipped — {file_path} not present)")
        return
    df = pd.read_csv(file_path)
    session = Session()
    try:
        for _, row in df.iterrows():
            curr = row.get('Currency')
            date = row.get('As Of Date')
            rate = clean_numeric(row.get('Rate Per USD'))
            if pd.isna(curr) or pd.isna(date) or rate is None:
                continue
            record = ExchangeRate(
                currency_name=str(curr).strip(),
                as_of_date=str(date).strip(),
                rate_per_usd=float(rate),
                source=str(row.get('Source', '') or '').strip() or None,
            )
            session.merge(record)
        session.commit()
    except Exception as e:
        session.rollback()
        raise e
    finally:
        session.close()


def seed_tax_rates(file_path):
    print(f"Seeding {file_path} to TaxRatesReference...")
    df = pd.read_csv(file_path, encoding='latin1')
    session = Session()
    try:
        for _, row in df.iterrows():
            country = row.get('Country')
            if pd.isna(country): continue
            
            record = TaxRatesReference(
                country=str(country).strip(),
                corporate_tax_rate=clean_numeric(row.get('Corporate Tax Rate'))
            )
            session.merge(record)
        session.commit()
    except Exception as e:
        session.rollback()
        raise e
    finally:
        session.close()

if __name__ == "__main__":
    here = Path(__file__).parent

    print("Dropping all existing tables and recreating them...")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    print("Tables created. Commencing data ingestion...")

    seed_rates1(here / 'Rates1.csv')
    seed_rates2(here / 'Rates2.csv')
    seed_rates3(here / 'Rates3.csv')
    seed_rates4(here / 'Rates4.csv')
    seed_tax_rates(here / 'Tax Rates.csv')
    seed_exchange_rates(here / 'ExchangeRates.csv')

    # Default report metadata so the PDF has a sensible Damodaran edition string
    # even before update_damodaran.py is ever run. Overwritten by that script
    # when the live datasets are refreshed.
    session = Session()
    try:
        session.merge(ReportMeta(key='damodaran_edition', value='January 2024'))
        session.commit()
    finally:
        session.close()

    print("Database seeding completed successfully.")
