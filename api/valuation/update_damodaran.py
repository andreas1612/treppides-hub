"""
Refresh the local valuation_reference.db with the latest Damodaran datasets.

Damodaran publishes his datasets at pages.stern.nyu.edu/~adamodar/.
He refreshes them in early January (annual) and sometimes in early July (mid-year).
Run this script after each refresh.

Usage:
    python update_damodaran.py              # fetch + parse + commit
    python update_damodaran.py --dry-run    # fetch + parse, print summary, do NOT touch DB

Dependencies (in addition to what seed_database.py already needs):
    pip install xlrd openpyxl       # both — Damodaran mixes .xls and .xlsx
    # requests is optional; the script falls back to urllib if it's missing.

IMPORTANT — verify the URLs and column names below match Damodaran's current
publications. He occasionally renames files and tweaks column headers between
editions. If the script aborts with "missing column" or "could not fetch", open
his Current Data page (https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html),
find the right file, and update the DATASET_SOURCES dict below.
"""

import argparse
import datetime as dt
import io
import re
import sys
import urllib.request
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from build_database import (
    Base,
    Rates1Reference,
    Rates2Reference,
    Rates3Reference,
    Rates4Reference,
    ContinentAverages,
    ReportMeta,
)
from seed_database import clean_numeric, clean_data


# ---- Damodaran source configuration ----------------------------------------
# Each entry: { url, sheet, skiprows, model, mapping }
# `skiprows` = number of header/metadata rows above the actual column header row.
# `mapping` = field_name -> list of candidate column-name substrings (ordered).
# The script picks the first column whose name (case-insensitive, trimmed)
# contains ALL substrings in any candidate group. More-specific mappings are
# resolved first so e.g. "Unlevered beta" claims its column before plain "Beta".

DATASET_SOURCES = {
    "rates1": {
        "url": "https://pages.stern.nyu.edu/~adamodar/pc/datasets/betaGlobal.xls",
        "sheet": "Industry Averages",
        "skiprows": 9,
        "model": Rates1Reference,
        "key_field": "industry_name",
        "mapping": {
            "industry_name":                       [["industry", "name"], ["industry"]],
            "number_of_firms":                     [["number", "firms"]],
            "unlevered_beta_corrected_for_cash":   [["unlevered", "beta", "corrected"], ["unlevered", "beta", "cash"]],
            "unlevered_beta":                      [["unlevered", "beta"]],
            "beta":                                [["beta"]],
            "d_e_ratio":                           [["d/e"], ["d", "e", "ratio"], ["debt", "equity"]],
            "effective_tax_rate":                  [["effective", "tax"]],
            "cash_firm_value":                     [["cash", "firm"]],
            "hilo_risk":                           [["hilo"], ["hi", "lo"]],
            "standard_deviation_of_equity":        [["standard", "deviation", "equity"]],
            "standard_deviation_in_operating_income": [["standard", "deviation", "operating"]],
        },
    },
    "rates2": {
        "url": "https://pages.stern.nyu.edu/~adamodar/pc/datasets/ctryprem.xls",
        "sheet": "Regional breakdown",
        "skiprows": 0,
        "model": Rates2Reference,
        "key_field": "country",
        "mapping": {
            "country":                [["country"]],
            "continents":             [["region"], ["continent"]],
            "moodys_rating":          [["moody"]],
            "adj_default_spread":     [["adj", "default"], ["adjusted", "default"]],
            "equity_risk_premium":    [["total", "equity", "risk"], ["equity", "risk", "premium"]],
            "country_risk_premium":   [["country", "risk", "premium"]],
        },
        "continent_averages": True,   # also rebuild ContinentAverages from this data
    },
    "rates3": {
        "url": "https://pages.stern.nyu.edu/~adamodar/pc/datasets/histgr.xls",
        "sheet": "Industry Averages",
        "skiprows": 7,
        "model": Rates3Reference,
        "key_field": "industry_name",
        "mapping": {
            "industry_name":                            [["industry", "name"], ["industry"]],
            "number_of_firms":                          [["number", "firms"]],
            "cagr_in_net_income_last_5_years":          [["cagr", "net income"]],
            "cagr_in_revenues_last_5_years":            [["cagr", "revenue"]],
            "expected_growth_in_revenues_next_2_years": [["expected", "growth", "revenue", "2"]],
            "expected_growth_in_revenues_next_5_years": [["expected", "growth", "revenue", "5"]],
            "expected_growth_in_eps_next_5_years":      [["expected", "growth", "eps"]],
        },
    },
    "rates4": {
        "url": "https://pages.stern.nyu.edu/~adamodar/pc/datasets/currencyriskfree.xls",
        # Currency data lives on the LAST sheet; -1 is resolved at read time.
        "sheet": -1,
        "skiprows": 0,
        "model": Rates4Reference,
        "key_field": "currency",
        "mapping": {
            "currency":                       [["currency"]],
            "govt_bond_rate_12_31_22":        [["govt", "bond"], ["government", "bond"]],
            "bond_rating_moodys":             [["rating", "moody"], ["moody", "rating"]],
            "riskfree_rate":                  [["riskfree", "rate"]],
            "default_spread_based_on_rating": [["default", "spread"]],
            "risk_free_rate":                 [["risk", "free", "rate"]],
        },
    },
}

DATE_PATTERN = re.compile(
    r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})",
    re.IGNORECASE,
)


# ---- Helpers ---------------------------------------------------------------

def fetch_bytes(url):
    """Download a URL and return raw bytes. Uses requests if available, else urllib."""
    try:
        import requests  # type: ignore
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        return resp.content
    except ImportError:
        req = urllib.request.Request(url, headers={"User-Agent": "valtrix-update/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read()


def detect_edition_date(content):
    """Find a 'Month YYYY' string in the first ~10 rows of the first sheet."""
    try:
        df = pd.read_excel(io.BytesIO(content), sheet_name=0, header=None, nrows=10)
    except Exception:
        return None
    for _, row in df.iterrows():
        for val in row:
            if isinstance(val, str):
                m = DATE_PATTERN.search(val)
                if m:
                    return f"{m.group(1).capitalize()} {m.group(2)}"
    return None


def map_columns(df, mapping):
    """Return {field_name: column_name}, resolving more-specific mappings first."""
    available = list(df.columns)
    # Sort by the longest candidate keyword group descending — more specific wins.
    ordered = sorted(
        mapping.items(),
        key=lambda kv: -max(len(group) for group in kv[1]),
    )
    result = {}
    for field, candidate_groups in ordered:
        for group in candidate_groups:
            needles = [kw.lower() for kw in group]
            match = None
            for col in available:
                norm = str(col).strip().lower()
                if all(needle in norm for needle in needles):
                    match = col
                    break
            if match is not None:
                result[field] = match
                available.remove(match)
                break
    return result


def parse_dataset(content, cfg):
    """Read an Excel byte stream into rows of {field_name: cleaned value}."""
    sheet = cfg["sheet"]
    # Resolve negative sheet indexes (e.g. -1 = last sheet) by listing the workbook.
    if isinstance(sheet, int) and sheet < 0:
        with pd.ExcelFile(io.BytesIO(content)) as xls:
            sheet = xls.sheet_names[sheet]
    df = pd.read_excel(io.BytesIO(content), sheet_name=sheet, skiprows=cfg["skiprows"])
    # Drop fully-empty rows; coerce column names to strings.
    df.columns = [str(c) for c in df.columns]
    df = df.dropna(how="all")

    col_map = map_columns(df, cfg["mapping"])
    missing = [f for f in cfg["mapping"] if f not in col_map]
    if cfg["key_field"] in missing:
        raise RuntimeError(
            f"Could not locate the key column ({cfg['key_field']}). "
            f"Available columns: {list(df.columns)}"
        )

    rows = []
    for _, raw in df.iterrows():
        record = {}
        for field, source_col in col_map.items():
            val = raw.get(source_col)
            if pd.isna(val):
                record[field] = None
                continue
            # Strings (country/industry/currency names, ratings) stay as strings;
            # everything else goes through clean_numeric.
            if field in ("industry_name", "country", "currency", "continents", "moodys_rating", "bond_rating_moodys"):
                record[field] = clean_data(val) if not isinstance(val, (int, float)) else val
                if isinstance(record[field], str):
                    record[field] = record[field].strip()
            else:
                record[field] = clean_numeric(val)
        # Skip rows where the key field is empty
        if not record.get(cfg["key_field"]):
            continue
        rows.append(record)
    return col_map, missing, rows


def rebuild_continent_averages(rates2_rows):
    """Compute mean ERP/CRP per continent from the parsed Rates2 rows."""
    bucket = {}
    for r in rates2_rows:
        cont = r.get("continents")
        if not cont:
            continue
        bucket.setdefault(cont, {"erp": [], "crp": []})
        if r.get("equity_risk_premium") is not None:
            bucket[cont]["erp"].append(r["equity_risk_premium"])
        if r.get("country_risk_premium") is not None:
            bucket[cont]["crp"].append(r["country_risk_premium"])
    out = []
    for cont, vals in bucket.items():
        erp = sum(vals["erp"]) / len(vals["erp"]) if vals["erp"] else None
        crp = sum(vals["crp"]) / len(vals["crp"]) if vals["crp"] else None
        out.append({
            "continent_name": cont,
            "average_equity_risk_premium": erp,
            "average_country_risk_premium": crp,
        })
    return out


# ---- Main ------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Refresh local DB from Damodaran's datasets.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Fetch + parse + print summary, but do not write to DB.")
    parser.add_argument("--db", default="sqlite:///valuation_reference.db",
                        help="SQLAlchemy DB URL (default: sqlite:///valuation_reference.db).")
    args = parser.parse_args()

    here = Path(__file__).parent
    print(f"Working directory: {here}")
    print(f"Dry run: {args.dry_run}")
    print()

    parsed = {}
    edition_date = None

    for name, cfg in DATASET_SOURCES.items():
        print(f"[{name}] fetching {cfg['url']}")
        try:
            content = fetch_bytes(cfg["url"])
        except Exception as e:
            print(f"  ! FETCH FAILED: {e}")
            print("  Aborting — refusing to write a partial dataset.")
            sys.exit(1)
        print(f"  downloaded {len(content):,} bytes")

        if edition_date is None:
            edition_date = detect_edition_date(content)

        try:
            col_map, missing, rows = parse_dataset(content, cfg)
        except Exception as e:
            print(f"  ! PARSE FAILED: {e}")
            print(f"  Hint: verify sheet={cfg['sheet']!r}, skiprows={cfg['skiprows']}")
            sys.exit(1)

        print(f"  parsed {len(rows)} rows; matched {len(col_map)} columns; missing fields: {missing or 'none'}")
        if rows:
            sample = rows[0]
            sample_preview = {k: sample[k] for k in list(sample)[:4]}
            print(f"  sample: {sample_preview}")

        parsed[name] = rows
        print()

    print(f"Detected Damodaran edition: {edition_date or '(none — could not auto-detect)'}")
    print()

    if args.dry_run:
        print("Dry run — DB untouched. Re-run without --dry-run to commit.")
        return

    engine = create_engine(args.db, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        for name, cfg in DATASET_SOURCES.items():
            Model = cfg["model"]
            session.query(Model).delete()
            for row in parsed[name]:
                session.merge(Model(**row))
            print(f"[{name}] wrote {len(parsed[name])} rows to {Model.__tablename__}")

        if "rates2" in parsed and DATASET_SOURCES["rates2"].get("continent_averages"):
            session.query(ContinentAverages).delete()
            for row in rebuild_continent_averages(parsed["rates2"]):
                session.merge(ContinentAverages(**row))
            print(f"[rates2] rebuilt continent_averages")

        if edition_date:
            session.merge(ReportMeta(key="damodaran_edition", value=edition_date))
        session.merge(ReportMeta(key="damodaran_last_fetched", value=dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"))

        session.commit()
        print()
        print(f"Done. Damodaran edition recorded as: {edition_date or '(unchanged)'}")
    except Exception as e:
        session.rollback()
        print(f"! WRITE FAILED, rolled back: {e}")
        sys.exit(1)
    finally:
        session.close()


if __name__ == "__main__":
    main()
