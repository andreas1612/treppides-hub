"""
Refresh the local valuation_reference.db with the LATEST Damodaran edition.

Damodaran publishes annually (January) and sometimes mid-year (July) at
pages.stern.nyu.edu/~adamodar/pc/datasets/. This script pulls those live URLs,
detects the edition string from the workbook ("Month YYYY"), and appends the
data to the historical archive under a new `edition_id` of 'YYYY-MM'.

Unlike the older single-edition flavour, this script DOES NOT wipe earlier
data. Each ingest is keyed by edition and merged into the per-edition slice.

Usage:
    python update_damodaran.py              # fetch + detect + append
    python update_damodaran.py --dry-run    # fetch + detect + print, no DB writes
    python update_damodaran.py --force      # re-ingest even if edition already in catalog
    python update_damodaran.py --edition 2026-07
                                            # override auto-detection (last resort)

Dependencies (in addition to seed_database.py's): xlrd, openpyxl.
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
    Edition,
    Rates1Reference,
    Rates2Reference,
    Rates3Reference,
    Rates4Reference,
    ContinentAverages,
    ReportMeta,
)
from seed_database import clean_numeric, clean_data


CURRENT_BASE = "https://pages.stern.nyu.edu/~adamodar/pc/datasets"


DATASET_SOURCES = {
    "rates1": {
        "url": f"{CURRENT_BASE}/betaGlobal.xls",
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
        "url": f"{CURRENT_BASE}/ctryprem.xls",
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
        "continent_averages": True,
    },
    "rates3": {
        "url": f"{CURRENT_BASE}/histgr.xls",
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
        "url": f"{CURRENT_BASE}/currencyriskfree.xls",
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
MONTH_NUM = {
    "january": "01", "february": "02", "march": "03", "april": "04",
    "may": "05", "june": "06", "july": "07", "august": "08",
    "september": "09", "october": "10", "november": "11", "december": "12",
}

STRING_FIELDS = {
    "industry_name", "country", "currency", "continents",
    "moodys_rating", "bond_rating_moodys",
}


def fetch_bytes(url):
    try:
        import requests  # type: ignore
        resp = requests.get(url, timeout=30, headers={"User-Agent": "valtrix-update/1.0"})
        resp.raise_for_status()
        return resp.content
    except ImportError:
        req = urllib.request.Request(url, headers={"User-Agent": "valtrix-update/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read()


def detect_edition_string(content):
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


def edition_label_to_id(label):
    """'January 2024' -> '2024-01'"""
    if not label:
        return None
    parts = label.strip().split()
    if len(parts) != 2:
        return None
    month, year = parts
    mm = MONTH_NUM.get(month.lower())
    if not mm or not year.isdigit():
        return None
    return f"{year}-{mm}"


def map_columns(df, mapping):
    available = list(df.columns)
    ordered = sorted(mapping.items(), key=lambda kv: -max(len(g) for g in kv[1]))
    result = {}
    for field, candidate_groups in ordered:
        for group in candidate_groups:
            needles = [kw.lower() for kw in group]
            match = None
            for col in available:
                norm = str(col).strip().lower()
                if all(n in norm for n in needles):
                    match = col
                    break
            if match is not None:
                result[field] = match
                available.remove(match)
                break
    return result


def parse_dataset(content, cfg):
    sheet = cfg["sheet"]
    if isinstance(sheet, int) and sheet < 0:
        with pd.ExcelFile(io.BytesIO(content)) as xls:
            sheet = xls.sheet_names[sheet]
    df = pd.read_excel(io.BytesIO(content), sheet_name=sheet, skiprows=cfg["skiprows"])
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
            if field in STRING_FIELDS:
                record[field] = clean_data(val) if not isinstance(val, (int, float)) else val
                if isinstance(record[field], str):
                    record[field] = record[field].strip()
            else:
                record[field] = clean_numeric(val)
        if not record.get(cfg["key_field"]):
            continue
        rows.append(record)
    return col_map, missing, rows


def compute_continent_averages(rates2_rows):
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


def main():
    parser = argparse.ArgumentParser(description="Append current Damodaran edition to the archive.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true",
                        help="Re-ingest even if this edition is already in the catalog.")
    parser.add_argument("--edition", default=None,
                        help="Override auto-detected edition id (format YYYY-MM).")
    parser.add_argument("--db", default="sqlite:///valuation_reference.db")
    args = parser.parse_args()

    here = Path(__file__).parent
    print(f"Working dir: {here}")
    print(f"Dry run    : {args.dry_run}")
    print()

    parsed = {}
    edition_label = None
    edition_id = args.edition

    for name, cfg in DATASET_SOURCES.items():
        print(f"[{name}] fetching {cfg['url']}")
        try:
            content = fetch_bytes(cfg["url"])
        except Exception as e:
            print(f"  ! FETCH FAILED: {e}")
            print("  Aborting — refusing to write a partial edition.")
            sys.exit(1)
        print(f"  downloaded {len(content):,} bytes")

        if edition_label is None:
            edition_label = detect_edition_string(content)

        try:
            col_map, missing, rows = parse_dataset(content, cfg)
        except Exception as e:
            print(f"  ! PARSE FAILED: {e}")
            sys.exit(1)

        print(f"  parsed {len(rows)} rows; matched {len(col_map)} cols; missing: {missing or 'none'}")
        parsed[name] = rows
        print()

    if not edition_id:
        edition_id = edition_label_to_id(edition_label)
    if not edition_id:
        print("! Could not determine edition id. Re-run with --edition YYYY-MM.")
        sys.exit(2)

    print(f"Detected edition : {edition_label or '(unknown)'}")
    print(f"Edition id       : {edition_id}")
    print()

    if args.dry_run:
        print("Dry run — DB untouched.")
        return

    engine = create_engine(args.db, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    existing = session.query(Edition).filter(Edition.edition_id == edition_id).first()
    if existing and not args.force:
        print(f"Edition {edition_id} already ingested at {existing.ingested_at}. "
              f"Use --force to overwrite.")
        session.close()
        return

    try:
        for name, cfg in DATASET_SOURCES.items():
            Model = cfg["model"]
            # Replace this (edition, dataset) slice — leaves all other editions untouched.
            session.query(Model).filter(Model.edition == edition_id).delete()
            for row in parsed[name]:
                session.merge(Model(edition=edition_id, **row))
            print(f"[{name}] wrote {len(parsed[name])} rows for edition {edition_id}")

        if "rates2" in parsed and DATASET_SOURCES["rates2"].get("continent_averages"):
            session.query(ContinentAverages).filter(
                ContinentAverages.edition == edition_id
            ).delete()
            for c in compute_continent_averages(parsed["rates2"]):
                session.merge(ContinentAverages(edition=edition_id, **c))
            print(f"[rates2] rebuilt continent_averages for edition {edition_id}")

        session.merge(Edition(
            edition_id=edition_id,
            label=edition_label or edition_id,
            published_date=edition_id,
            ingested_at=dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
            source="current",
            notes="Fetched from live datasets URL.",
        ))

        # Update the 'latest edition' pointer iff this is the newest we've ingested.
        all_eds = sorted({e.edition_id for e in session.query(Edition).all()})
        latest = all_eds[-1] if all_eds else edition_id
        if latest == edition_id:
            session.merge(ReportMeta(key="damodaran_edition", value=edition_label or edition_id))
            session.merge(ReportMeta(key="damodaran_latest_edition_id", value=edition_id))
        session.merge(ReportMeta(
            key="damodaran_last_fetched",
            value=dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        ))

        session.commit()
        print()
        print(f"Done. Edition {edition_id} ingested. Latest edition pointer: {latest}")
    except Exception as e:
        session.rollback()
        print(f"! WRITE FAILED, rolled back: {e}")
        sys.exit(1)
    finally:
        session.close()


if __name__ == "__main__":
    main()
