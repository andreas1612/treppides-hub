"""
Refresh ExchangeRates.csv with year-end USD-cross rates from the
Frankfurter API (https://frankfurter.dev — free, no API key, sourced
from ~55 central banks).

Covers every currency present in Rates4.csv. Year-end snapshots from
START_YEAR through END_YEAR. USD itself is injected as 1.0/identity.

Usage:
    python fetch_exchange_rates.py            # fetch + write CSV
    python fetch_exchange_rates.py --dry-run  # fetch + print summary, do not write

After it runs, re-seed the DB:
    python seed_database.py
"""

import argparse
import csv
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


# ---- Configuration ---------------------------------------------------------

START_YEAR = 2015
END_YEAR   = 2025

API_URL = "https://api.frankfurter.dev/v2/rates?date={date}&base=USD"
USER_AGENT = "valtrix-fetch/1.0"
REQUEST_DELAY_SEC = 0.4   # be polite to a free public API
SOURCE_LABEL = "Frankfurter API (ECB + central banks)"

# Rates4.csv currency name -> ISO 4217 code.
# Names on the LEFT must match exactly what's in Rates4.csv (and therefore
# what the frontend dropdown shows), so the seeded ExchangeRate rows can be
# looked up by the same currency_name the UI passes in.
NAME_TO_ISO = {
    "Australian $":       "AUD",
    "Brazilian Reai":     "BRL",
    "British Pound":      "GBP",
    "Bulgarian Lev":      "BGN",
    "Canadian $":         "CAD",
    "Chilean Peso":       "CLP",
    "Chinese Yuan":       "CNY",
    "Colombian Peso":     "COP",
    "Croatian Kuna":      "HRK",
    "Czech Koruna":       "CZK",
    "Danish Krone":       "DKK",
    "Euro":               "EUR",
    "HK $":               "HKD",
    "Hungarian Forint":   "HUF",
    "Iceland Krona":      "ISK",
    "Indian Rupee":       "INR",
    "Indonesian Rupiah":  "IDR",
    "Israeli Shekel":     "ILS",
    "Japanese Yen":       "JPY",
    "Kenyan Shilling":    "KES",
    "Korean Won":         "KRW",
    "Malyasian Ringgit":  "MYR",   # sic — matches Rates4.csv spelling
    "Mexican Peso":       "MXN",
    "Nigerian Naira":     "NGN",
    "Norwegian Krone":    "NOK",
    "NZ $":               "NZD",
    "Pakistani Rupee":    "PKR",
    "Peruvian Sol":       "PEN",
    "Phillipine Peso":    "PHP",   # sic — matches Rates4.csv spelling
    "Polish Zloty":       "PLN",
    "Qatari Dinar":       "QAR",
    "Romanian Lev":       "RON",
    "Russian Ruble":      "RUB",
    "Singapore $":        "SGD",
    "South African Rand": "ZAR",
    "Swedish Krona":      "SEK",
    "Swiss Franc":        "CHF",
    "Taiwanese $":        "TWD",
    "Thai Baht":          "THB",
    "Turkish Lira":       "TRY",
    "US $":               "USD",
    "Vietnamese Dong":    "VND",
    "Zambian kwacha":     "ZMW",
}


# ---- Helpers ---------------------------------------------------------------

def fetch_year_end(year):
    """Return {iso_code: rate_per_usd} for the last business day of `year`.

    Frankfurter resolves a non-trading date to the most recent prior trading
    day automatically, so 31 Dec on a weekend still returns the correct
    year-end snapshot. The response includes the actual date used, which we
    surface to the caller.
    """
    date_str = f"{year}-12-31"
    url = API_URL.format(date=date_str)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read())
    if not isinstance(payload, list) or not payload:
        raise RuntimeError(f"Unexpected response shape for {date_str}: {payload!r}")
    actual_date = payload[0].get("date", date_str)
    rates = {row["quote"]: row["rate"] for row in payload if "quote" in row and "rate" in row}
    return actual_date, rates


def build_rows(start_year, end_year):
    """Walk year-ends start..end inclusive, fetch each, return CSV rows.

    Each row: (Currency, As Of Date, Rate Per USD, Source).
    USD is injected as 1.0 with source 'identity'.
    Currencies not returned for a given year (e.g. HRK after Jan-2023 euro
    adoption) are reported and silently skipped — we don't want to invent
    rates for currencies that no longer trade.
    """
    rows = []
    skipped = []
    for year in range(start_year, end_year + 1):
        print(f"  fetching {year}-12-31 ...", end=" ", flush=True)
        actual_date, by_iso = fetch_year_end(year)
        print(f"got {len(by_iso)} rates (date={actual_date})")
        time.sleep(REQUEST_DELAY_SEC)

        for name, iso in NAME_TO_ISO.items():
            if iso == "USD":
                rows.append((name, actual_date, 1.0, "identity"))
                continue
            rate = by_iso.get(iso)
            if rate is None:
                skipped.append((name, iso, year))
                continue
            rows.append((name, actual_date, float(rate), SOURCE_LABEL))
    return rows, skipped


def write_csv(rows, path):
    """Sort by (currency, date) and write the canonical CSV header expected
    by seed_database.seed_exchange_rates."""
    rows_sorted = sorted(rows, key=lambda r: (r[0], r[1]))
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["Currency", "As Of Date", "Rate Per USD", "Source"])
        for r in rows_sorted:
            writer.writerow([r[0], r[1], f"{r[2]:.6f}".rstrip("0").rstrip("."), r[3]])


# ---- Main ------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true",
                        help="Fetch + summarise, but do not write the CSV.")
    parser.add_argument("--start", type=int, default=START_YEAR, help=f"First year (default {START_YEAR}).")
    parser.add_argument("--end",   type=int, default=END_YEAR,   help=f"Last year inclusive (default {END_YEAR}).")
    parser.add_argument("--out",   default=None,
                        help="Output CSV path (default: ExchangeRates.csv next to this script).")
    args = parser.parse_args()

    here = Path(__file__).resolve().parent
    out_path = Path(args.out) if args.out else here / "ExchangeRates.csv"

    if args.end < args.start:
        print(f"ERROR: --end ({args.end}) must be >= --start ({args.start})")
        sys.exit(2)

    print(f"Fetching year-end USD-cross rates {args.start}..{args.end} from Frankfurter")
    print(f"Currencies: {len(NAME_TO_ISO)} (from Rates4.csv)")
    print(f"Output:     {out_path}")
    print()

    try:
        rows, skipped = build_rows(args.start, args.end)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace") if hasattr(e, "read") else ""
        print(f"\n! HTTP {e.code} from Frankfurter: {body[:300]}")
        sys.exit(1)
    except Exception as e:
        print(f"\n! FETCH FAILED: {e}")
        sys.exit(1)

    print()
    print(f"Collected {len(rows)} rows.")
    if skipped:
        print(f"Skipped {len(skipped)} (currency,year) pairs not returned by API:")
        for name, iso, year in skipped:
            print(f"  - {name} ({iso}) {year}")

    if args.dry_run:
        print("\nDry run — CSV untouched.")
        return

    write_csv(rows, out_path)
    print(f"\nWrote {out_path}")
    print("Next step: python seed_database.py")


if __name__ == "__main__":
    main()
