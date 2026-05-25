# Session 13 — Valuation Tool: Historical Damodaran Archive (2008-2026)

**Date:** 2026-05-25
**Status:** Reference-data layer rebuilt around per-edition keying. The DB now
holds Damodaran's full archive 2008-2024 (where datasets exist), plus the
current January 2026 edition, plus the Jan 2024 baseline from the bundled
CSVs. A new edition-picker in the valuation form lets the user run a
valuation against any edition; every reference call is scoped to it.

`valuation_reference.db` is no longer committed — it is rebuilt on the
server from the seed/backfill/update scripts during deploy.

---

## What changed

### Schema — every Damodaran table is now `(entity, edition)`-keyed

[`api/valuation/build_database.py`](api/valuation/build_database.py)

- Added `Edition` model — catalog of every ingested edition.
- Added `edition` column to the composite PK of `Rates1`, `Rates2`,
  `Rates3`, `Rates4`, `TaxRatesReference`, and `ContinentAverages`.
- `exchange_rates` and `report_meta` unchanged — FX is edition-neutral.
- Edition IDs are `YYYY-MM` strings (e.g. `2024-01`) so they sort lexically
  the same way they sort chronologically.

### `seed_database.py` — baseline only

[`api/valuation/seed_database.py`](api/valuation/seed_database.py)

- Each `seed_*` function takes an `edition` arg (default `2024-01`) and
  stamps every row.
- Registers the baseline edition in the `editions` catalog with source
  `bundled-csv`.
- Writes a `damodaran_latest_edition_id` pointer to `report_meta`.
- Re-running drops + recreates tables — the script is the "from scratch"
  path. Historical and current editions are added afterwards by the next
  two scripts.

### `backfill_damodaran.py` — new

[`api/valuation/backfill_damodaran.py`](api/valuation/backfill_damodaran.py)

One-shot historical ingest from Damodaran's archive at
`https://pages.stern.nyu.edu/~adamodar/pc/archives/`. Walks years
2008-2024 by default, fetches each available workbook, parses it with
the same column-matching machinery used by the live-data updater, and
writes per-edition slices.

Coverage matrix (verified empirically against his archive):

| Dataset | Years | Notes |
|---|---|---|
| `rates2` (ctryprem) | 2008-2024 | `.xls` 08-21, `.xlsx` 22-24 |
| `rates3` (histgr)   | 2008-2024 | `.xls` throughout |
| `tax`   (taxrate)   | 2008-2024 | Renamed 2013: `taxrate` → `taxrateGlobal` |
| `rates1` (betaGlobal) | 2014-2024 | Pre-2014 archive is US-only `betas##.xls` — skipped |
| `rates4` (currencyriskfree) | 2024 only | Damodaran didn't archive earlier editions |

Flags: `--from`, `--to`, `--datasets`, `--dry-run`, `--force`.
Politeness sleep: 400ms between fetches.

For pre-2024 editions the UI surfaces a note when the user picks a currency
— the Rates4 table simply has no rows for that edition, and that's a data
availability fact, not a bug.

### `update_damodaran.py` — refit for append-only

[`api/valuation/update_damodaran.py`](api/valuation/update_damodaran.py)

- Detects the edition string from the workbook ("Month YYYY"), converts
  to `YYYY-MM`, and uses it as the ingest target.
- Skips by default if that edition is already in the catalog — re-ingest
  needs `--force`.
- Replaces only the rows for that specific `(edition, dataset)` slice
  rather than wiping the whole table. Every other edition is untouched.
- Updates `damodaran_latest_edition_id` only if the newly-ingested
  edition is the lexically-highest in the catalog (so re-ingesting an
  old edition doesn't clobber the "latest" pointer).
- New `--edition YYYY-MM` flag for the rare case where auto-detection
  can't find a date string in the workbook.

### API — `/editions` + edition-scoped reference calls

[`api/valuation/main.py`](api/valuation/main.py)

New routes:

- `GET /api/valuation/editions` — list editions, newest first, plus the
  `latest` pointer. UI calls this on page load.
- `GET /api/valuation/editions/{edition_id}` — details (label, source, notes).

Every `/reference/*` and `/dropdowns/*` endpoint accepts an optional
`?edition=YYYY-MM` query param. When omitted the API resolves to the
latest edition recorded in `report_meta`. When provided but not in the
catalog → 404 with a specific message.

`/reference/fx/*` is unchanged — FX data is edition-neutral.

### Frontend — edition picker + scoped fetches

[`components/pages/valuation.js`](components/pages/valuation.js)

- New `damodaranEdition` select in Section 2 ("Valuation & Dates"),
  populated from `/editions`, defaults to latest.
- `selectedEdition` state + `withEdition(url)` helper. Every reference
  call (continents, countries, industries, currencies dropdowns;
  continent/country/industry/tax-rate/currency reference fetches; CRP/ERP
  continent fallback) is now edition-scoped.
- Switching editions clears auto-populated fields and re-fetches every
  dropdown so the form is consistent with the chosen edition.
- When the user picks a pre-2024 edition and tries to read currency-specific
  risk-free rates, the UI surfaces an inline note explaining that data
  isn't available and asking them to enter it manually.

### `valuation_reference.db` removed from git

[`.gitignore`](.gitignore) now ignores `api/valuation/valuation_reference.db`.
The DB is rebuilt on the server via the bootstrap sequence (next section).

### `api/valuation/README.md` rewritten

Documents the new build flow, coverage matrix, and refresh cadence.

---

## To make this live (server bootstrap)

This deploy needs a one-time on-server bootstrap because the DB is no
longer committed.

```bash
cd ~/treppides-hub && git pull
cd api/valuation

# Wipe + rebuild from CSVs (baseline = Jan 2024)
venv/bin/python seed_database.py

# Pull every available edition 2008-2024 from his archive (~1 min)
venv/bin/python backfill_damodaran.py

# Append the current edition from the live URLs
venv/bin/python update_damodaran.py

sudo systemctl restart valuation-api

# Verify
curl -sk https://hub.treppides.com/api/valuation/editions | head -c 500
curl -sk 'https://hub.treppides.com/api/valuation/reference/country/Germany?edition=2020-01'
```

After this initial bootstrap, normal deploys are just
`git pull && sudo systemctl restart valuation-api`. Edition refreshes
each January (or July when he ships mid-year) are:

```bash
cd ~/treppides-hub/api/valuation
venv/bin/python update_damodaran.py
sudo systemctl restart valuation-api
```

---

## Files changed

```
M  api/valuation/build_database.py        (edition column on every Damodaran table; Edition model)
M  api/valuation/seed_database.py         (per-edition seed, registers Jan 2024 baseline)
M  api/valuation/update_damodaran.py      (detect edition, append to archive, do not wipe)
A  api/valuation/backfill_damodaran.py    (new — 2008-2024 from archive)
M  api/valuation/main.py                  (?edition= param on every reference call; /editions catalog)
M  api/valuation/README.md                (rewritten for server-build flow)
M  components/pages/valuation.js          (edition picker + withEdition() helper threaded through)
M  .gitignore                             (untrack valuation_reference.db)
M  STATUS.md                              (Valuation Tool row, credentials, what's-not-done)
A  SESSION_13.md                          (this file)
```

`api/valuation/valuation_reference.db` is no longer in the working tree
— deleted from the repo, rebuilt server-side. Local devs run
`seed_database.py` to recreate it.

---

## Open items / follow-ups

1. **Currency-specific risk-free rates pre-2024.** Damodaran didn't
   archive these. If pre-2024 valuations need a non-USD risk-free rate,
   the auditor enters it manually for now. Future option: reconstruct
   from each year's `ctryprem` (which carries local-currency gov bond
   yields per country) — would require schema research and per-year
   column-mapping work.

2. **Mid-year (July) editions.** Damodaran refreshes mid-year in place at
   `/datasets/` and does NOT archive the July file. The current updater
   captures the *current* state of the URL — if we run it in July it'll
   ingest a `YYYY-07` edition. Going forward, running the script twice a
   year captures both. Backfilled history is January-only.

3. **2025 edition isn't archived yet.** The current live URL points to
   the latest edition (2026-01 in May 2026). If a user picks "January
   2025" today they won't find it. We could backfill 2025 manually if
   someone has the workbook on disk, or wait for it to appear at
   `/archives/`.

4. **PDF audit-trail.** The PDF report still uses `damodaranEdition` for
   its prose footer. Confirmed it reflects the selected edition's label
   now that `damodaranEdition` is set from the picker. Worth adding an
   explicit "Reference data: <edition>" line in the section that lists
   model inputs.

5. **Older editions have fewer countries/industries.** When a user
   switches editions, the dropdowns reload but the *currently-selected*
   values may no longer exist. The form clears the dependent reference
   fields but doesn't clear the dropdown selection itself — minor UX
   wart, fix is a one-liner once we decide whether to also re-validate
   the form or just leave the bad selection visible.

6. **Backfill is fragile to URL changes.** If Damodaran renames anything
   under `/archives/`, the affected per-dataset block in
   `_*_files()` needs editing. The script logs 404s as skips rather than
   aborting, so a partial outage won't break the rest of the ingest.

---

## Critical hub rules — reminder

1. No `localhost`/`127.0.0.1` in frontend.
2. `config.js` gitignored.
3. No build step.
4. No CDN — vendor everything.
5. `media/` and `valuation_reference.db` not committed; both are rebuilt
   server-side.
6. SSL private key stays at `/etc/nginx/ssl/treppides.key` only.

This session touches no CDN dependencies and no new frontend libs — only
backend data + the existing fetch surface.
