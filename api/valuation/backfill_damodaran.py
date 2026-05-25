"""
One-shot historical backfill of Damodaran's archived datasets, 2008-2024.

Reads from https://pages.stern.nyu.edu/~adamodar/pc/archives/ and ingests
each year as its own edition ('2008-01', '2009-01', ...) using the same
schema + column-mapping machinery as update_damodaran.py.

Per-dataset coverage (verified empirically from the archive):
  - Country Risk Premiums (ctryprem)       2008-2024  full
  - Historical Growth (histgr)             2008-2024  full
  - Tax Rates                              2008-2024  (file renamed 2013: taxrate -> taxrateGlobal)
  - Industry Betas (betaGlobal)            2014-2024  only — pre-2014 is US-only `betas##.xls`, different schema
  - Currency Risk-Free (currencyriskfree)  2024 only  — Damodaran did not archive earlier editions

Run modes:
  python backfill_damodaran.py                    # full backfill, all available years/datasets
  python backfill_damodaran.py --dry-run          # print the fetch matrix, do not write
  python backfill_damodaran.py --from 2018        # start year (inclusive)
  python backfill_damodaran.py --to 2020          # end year (inclusive)
  python backfill_damodaran.py --datasets rates2,rates3
  python backfill_damodaran.py --force            # re-ingest editions already in catalog
"""

import argparse
import datetime as dt
import io
import sys
import time
import urllib.error
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
    TaxRatesReference,
    ContinentAverages,
)
from seed_database import clean_numeric, clean_data


ARCHIVE_BASE = "https://pages.stern.nyu.edu/~adamodar/pc/archives"


def archive_url(filename):
    return f"{ARCHIVE_BASE}/{filename}"


# Per-dataset configuration. Each entry's `years` map year (int) -> filename
# under ARCHIVE_BASE. None means the file is not archived for that year.
# We could derive this with regex sweeps, but explicit beats clever — when
# Damodaran inevitably renames something in 2027, the fix is one line here.

def _ctryprem_files():
    """ctryprem: .xls 2008-2021, .xlsx 2022-2024."""
    out = {}
    for yy in range(8, 22):           # 08..21 → 2008..2021
        out[2000 + yy] = f"ctryprem{yy:02d}.xls"
    for yy in range(22, 25):          # 22..24 → 2022..2024
        out[2000 + yy] = f"ctryprem{yy:02d}.xlsx"
    return out


def _histgr_files():
    """histgr: .xls across the whole range."""
    return {2000 + yy: f"histgr{yy:02d}.xls" for yy in range(8, 25)}


def _betaglobal_files():
    """betaGlobal: archive starts at 2014."""
    return {2000 + yy: f"betaGlobal{yy:02d}.xls" for yy in range(14, 25)}


def _taxrate_files():
    """Tax rates: filename renamed 2013 from 'taxrate' to 'taxrateGlobal'."""
    out = {}
    for yy in range(8, 13):           # 08..12 → 2008..2012
        out[2000 + yy] = f"taxrate{yy:02d}.xls"
    for yy in range(13, 25):          # 13..24 → 2013..2024
        out[2000 + yy] = f"taxrateGlobal{yy:02d}.xls"
    return out


def _currencyriskfree_files():
    """currencyriskfree: only 2024 archived."""
    return {2024: "currencyriskfree24.xlsx"}


DATASETS = {
    "rates1": {
        "files": _betaglobal_files(),
        "model": Rates1Reference,
        "key_field": "industry_name",
        "sheet": "Industry Averages",
        "skiprows": 9,
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
        "files": _ctryprem_files(),
        "model": Rates2Reference,
        "key_field": "country",
        "sheet": "Regional breakdown",
        "skiprows": 0,
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
        "files": _histgr_files(),
        "model": Rates3Reference,
        "key_field": "industry_name",
        "sheet": "Industry Averages",
        "skiprows": 7,
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
        "files": _currencyriskfree_files(),
        "model": Rates4Reference,
        "key_field": "currency",
        "sheet": -1,
        "skiprows": 0,
        "mapping": {
            "currency":                       [["currency"]],
            "govt_bond_rate_12_31_22":        [["govt", "bond"], ["government", "bond"]],
            "bond_rating_moodys":             [["rating", "moody"], ["moody", "rating"]],
            "riskfree_rate":                  [["riskfree", "rate"]],
            "default_spread_based_on_rating": [["default", "spread"]],
            "risk_free_rate":                 [["risk", "free", "rate"]],
        },
    },
    "tax": {
        "files": _taxrate_files(),
        "model": TaxRatesReference,
        "key_field": "country",
        # Damodaran's tax-rate workbook layout has been inconsistent over the years.
        # Read the first sheet, header at row 0, then locate by column name.
        "sheet": 0,
        "skiprows": 0,
        "mapping": {
            "country":            [["country"]],
            "corporate_tax_rate": [["corporate", "tax"], ["tax", "rate"], ["effective", "tax"]],
        },
    },
}

STRING_FIELDS = {
    "industry_name", "country", "currency", "continents",
    "moodys_rating", "bond_rating_moodys",
}


# ----------------------------------------------------------------------------

def fetch_bytes(url, timeout=30):
    try:
        import requests  # type: ignore
        resp = requests.get(url, timeout=timeout, headers={"User-Agent": "valtrix-backfill/1.0"})
        resp.raise_for_status()
        return resp.content
    except ImportError:
        req = urllib.request.Request(url, headers={"User-Agent": "valtrix-backfill/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()


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


def parse_workbook(content, cfg):
    sheet = cfg["sheet"]
    if isinstance(sheet, int) and sheet < 0:
        with pd.ExcelFile(io.BytesIO(content)) as xls:
            sheet = xls.sheet_names[sheet]
    df = pd.read_excel(io.BytesIO(content), sheet_name=sheet, skiprows=cfg["skiprows"])
    df.columns = [str(c) for c in df.columns]
    df = df.dropna(how="all")

    col_map = map_columns(df, cfg["mapping"])
    if cfg["key_field"] not in col_map:
        raise RuntimeError(
            f"missing key column '{cfg['key_field']}'. Columns: {list(df.columns)}"
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
    return rows


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


def existing_edition_ids(session):
    return {row.edition_id for row in session.query(Edition).all()}


# ----------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Backfill historical Damodaran editions.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--from", dest="from_year", type=int, default=2008)
    parser.add_argument("--to", dest="to_year", type=int, default=2024)
    parser.add_argument("--datasets", default="rates1,rates2,rates3,rates4,tax",
                        help="comma-separated dataset keys to ingest")
    parser.add_argument("--force", action="store_true",
                        help="Re-ingest editions already present in the editions catalog")
    parser.add_argument("--db", default="sqlite:///valuation_reference.db")
    parser.add_argument("--sleep", type=float, default=0.4,
                        help="Seconds between fetches (politeness to NYU's server)")
    args = parser.parse_args()

    requested = [d.strip() for d in args.datasets.split(",") if d.strip()]
    unknown = [d for d in requested if d not in DATASETS]
    if unknown:
        sys.exit(f"Unknown dataset(s): {unknown}. Valid: {list(DATASETS)}")

    engine = create_engine(args.db, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    known = existing_edition_ids(session) if not args.force else set()

    # Build the work matrix: list of (year, dataset_key, filename)
    work = []
    for year in range(args.from_year, args.to_year + 1):
        for ds in requested:
            cfg = DATASETS[ds]
            filename = cfg["files"].get(year)
            if not filename:
                continue
            work.append((year, ds, filename))

    print(f"Backfill plan: {len(work)} (year, dataset) fetches")
    print(f"  years     : {args.from_year}..{args.to_year}")
    print(f"  datasets  : {requested}")
    print(f"  dry-run   : {args.dry_run}")
    print(f"  force     : {args.force}")
    print()

    # Track which (year, dataset) combos parsed cleanly so we can update
    # the editions catalog only for years where SOMETHING landed.
    parsed_per_year = {}

    for idx, (year, ds, filename) in enumerate(work, 1):
        edition_id = f"{year}-01"
        cfg = DATASETS[ds]

        if edition_id in known and not args.force and ds != "rates2":
            # Skip per-dataset writes for already-ingested editions, but always
            # re-emit rates2 continent_averages on force only — handled below.
            print(f"[{idx:>3}/{len(work)}] {year} {ds:<7} skipping ({edition_id} already in catalog)")
            continue

        url = archive_url(filename)
        print(f"[{idx:>3}/{len(work)}] {year} {ds:<7} GET {url}")
        try:
            content = fetch_bytes(url)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                print(f"            (404 — not archived, skipping)")
                continue
            print(f"            ! HTTP {e.code}: {e.reason}")
            continue
        except Exception as e:
            print(f"            ! fetch failed: {e}")
            continue

        try:
            rows = parse_workbook(content, cfg)
        except Exception as e:
            print(f"            ! parse failed: {e}")
            continue

        print(f"            parsed {len(rows)} rows")
        if args.dry_run:
            parsed_per_year.setdefault(year, []).append(ds)
            time.sleep(args.sleep)
            continue

        Model = cfg["model"]
        try:
            # Wipe just this (edition, dataset) slice then re-insert
            session.query(Model).filter(Model.edition == edition_id).delete()
            for r in rows:
                session.merge(Model(edition=edition_id, **r))

            if ds == "rates2" and cfg.get("continent_averages"):
                session.query(ContinentAverages).filter(
                    ContinentAverages.edition == edition_id
                ).delete()
                for c in compute_continent_averages(rows):
                    session.merge(ContinentAverages(edition=edition_id, **c))

            session.commit()
            parsed_per_year.setdefault(year, []).append(ds)
        except Exception as e:
            session.rollback()
            print(f"            ! DB write failed: {e}")

        time.sleep(args.sleep)

    # Register editions catalog rows for years where at least one dataset landed.
    if not args.dry_run:
        for year, ds_list in parsed_per_year.items():
            edition_id = f"{year}-01"
            label = f"January {year}"
            notes = f"Archived from NYU Stern. Datasets: {','.join(sorted(ds_list))}."
            session.merge(Edition(
                edition_id=edition_id,
                label=label,
                published_date=edition_id,
                ingested_at=dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
                source="archive",
                notes=notes,
            ))
        session.commit()

    session.close()

    print()
    if args.dry_run:
        print("Dry run complete — DB untouched.")
    else:
        print(f"Done. Editions touched: {sorted(parsed_per_year.keys())}")


if __name__ == "__main__":
    main()
