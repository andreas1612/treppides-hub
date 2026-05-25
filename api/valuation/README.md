# Valuation Reference API

FastAPI service backing the **Valuation Tool** page in the hub. Serves
historical Damodaran reference data (industry betas, country risk premiums,
historical growth, tax rates, currency risk-free rates) plus historical
FX rates from a local SQLite database. The DB holds **every ingested
Damodaran edition (2008-2026)** so a valuation can be run against the
edition that matches the valuation date.

- Frontend: [`components/pages/valuation.js`](../../components/pages/valuation.js)
- Routes all live under `/api/valuation/*`, proxied by nginx from
  `https://hub.treppides.com/api/valuation/...` to `http://127.0.0.1:8002`.

## Files

| File | Purpose |
|---|---|
| `main.py` | FastAPI app — dropdowns, reference fetchers, edition catalog, FX |
| `build_database.py` | SQLAlchemy table definitions (composite-keyed on `edition`) |
| `seed_database.py` | One-shot baseline seed from the CSVs in this dir (= Jan 2024 edition) |
| `backfill_damodaran.py` | Historical ingest 2008-2024 from Damodaran's archive |
| `update_damodaran.py` | Refresh: append the LATEST edition from his current-data URLs |
| `fetch_exchange_rates.py` | Refresh historical year-end FX rates via Frankfurter/ECB |
| `valuation_reference.db` | SQLite DB — **not** committed; rebuilt on the server (see below) |
| `Rates1.csv` … `Rates4.csv`, `Tax Rates.csv`, `ExchangeRates.csv` | Bundled seed data |
| `requirements.txt` | Python deps |

## Editions

Every Damodaran-derived table carries a composite primary key
`(entity, edition)`. Editions are stamped `YYYY-MM` (e.g. `2024-01`).
The `editions` catalog table lists everything that has been ingested
and is the source for the UI's *Reference data as of* dropdown.

Per-dataset coverage in the archive:

| Dataset | Years available | Notes |
|---|---|---|
| Country Risk Premiums (`rates2`) | 2008-2026 | Full coverage |
| Historical Growth (`rates3`) | 2008-2026 | Full coverage |
| Tax Rates | 2008-2026 | Filename renamed 2013: `taxrate` → `taxrateGlobal` |
| Industry Betas (`rates1`) | 2014-2026 | Pre-2014 archive is US-only with a different schema — skipped |
| Currency Risk-Free (`rates4`) | 2024+ only | Damodaran didn't archive earlier editions |

`exchange_rates` is independent of Damodaran editions (sourced from
Frankfurter/ECB) and serves every edition the same way.

## Server bootstrap (192.168.0.221)

`valuation_reference.db` is **not** tracked in git — it is rebuilt on the
server. This avoids merge conflicts every time the data refreshes.

First-time bootstrap on a fresh server:

```bash
cd ~/treppides-hub/api/valuation
python3 -m venv venv
venv/bin/pip install -r requirements.txt

# 1. Baseline seed (creates schema + Jan 2024 from bundled CSVs)
venv/bin/python seed_database.py

# 2. Historical backfill (2008-2024, ~80 fetches, ~1 minute)
venv/bin/python backfill_damodaran.py

# 3. Latest edition from the live URLs
venv/bin/python update_damodaran.py

# 4. Restart so SQLAlchemy re-opens the DB
sudo systemctl restart valuation-api
curl -sk https://hub.treppides.com/api/valuation/editions | head
```

After this, normal deploys are just `git pull && sudo systemctl restart valuation-api`.

## Refreshing reference data on the server

Each January (and optionally each July) Damodaran posts a new edition:

```bash
cd ~/treppides-hub/api/valuation
venv/bin/python update_damodaran.py            # detects + appends
sudo systemctl restart valuation-api
```

The script is idempotent — if the detected edition is already in the
`editions` catalog it refuses to re-ingest (use `--force` to override).

`--dry-run` parses the workbooks without writing to the DB so you can
sanity-check the detected edition string and column matches first.

Annual FX refresh in January (after Frankfurter publishes year-end data,
typically T+1):

```bash
venv/bin/python fetch_exchange_rates.py --end <new-year>
# Re-seeds exchange_rates (idempotent merge):
venv/bin/python -c "from seed_database import seed_exchange_rates; \
                    seed_exchange_rates('ExchangeRates.csv')"
sudo systemctl restart valuation-api
```

## Local dev

```bash
cd api/valuation
python3 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/python seed_database.py          # baseline only
# Optional: venv/bin/python backfill_damodaran.py --to 2024
venv/bin/uvicorn main:app --host 127.0.0.1 --port 8002 --reload

curl http://127.0.0.1:8002/api/valuation/health
curl http://127.0.0.1:8002/api/valuation/editions
curl 'http://127.0.0.1:8002/api/valuation/reference/country/Germany?edition=2020-01'
```
