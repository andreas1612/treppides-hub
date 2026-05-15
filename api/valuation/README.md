# Valuation Reference API

FastAPI service backing the **Valuation Tool** page in the hub.
Serves reference data (Damodaran tables, country ERP, tax rates,
currency rates) from a local SQLite database.

- Frontend: [`components/pages/valuation.js`](../../components/pages/valuation.js)
- Routes all live under `/api/valuation/*` and are proxied by nginx
  from `https://hub.treppides.com/api/valuation/...` to
  `http://127.0.0.1:8002`.

## Files

| File | Purpose |
|---|---|
| `main.py` | FastAPI app — dropdowns, reference fetchers, meta endpoint |
| `build_database.py` | SQLAlchemy table definitions (imported by `main.py` and the seed/update scripts) |
| `seed_database.py` | One-shot: build `valuation_reference.db` from the CSVs + `References.xlsx` |
| `update_damodaran.py` | Refresh the four Damodaran datasets (run manually each January / July) |
| `valuation_reference.db` | SQLite reference database — shipped with the repo |
| `Rates1.csv` … `Rates4.csv`, `Tax Rates.csv`, `References.xlsx` | Source data the seed script reads |
| `requirements.txt` | Python deps |
| `Dockerfile` | Container build (optional — systemd is the primary deploy) |

## Local dev

```bash
cd api/valuation
python3 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/uvicorn main:app --host 127.0.0.1 --port 8002 --reload
# Smoke test:
curl http://127.0.0.1:8002/api/valuation/health
curl http://127.0.0.1:8002/api/valuation/dropdowns/currencies
```

## Server deployment (192.168.0.221)

```bash
cd ~/treppides-hub
git pull

# One-time: install
cd ~/treppides-hub/api/valuation
python3 -m venv venv
venv/bin/pip install -r requirements.txt

# Install systemd unit (file shipped at repo root)
sudo cp ~/treppides-hub/valuation-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now valuation-api

# Add the nginx proxy block (already present in repo's nginx-treppides-hub.conf)
sudo cp ~/treppides-hub/nginx-treppides-hub.conf /etc/nginx/sites-enabled/treppides-hub
sudo nginx -t && sudo systemctl reload nginx

# Verify
curl -sk https://hub.treppides.com/api/valuation/health
```

## Refreshing reference data

> **Refresh locally, not on the server.** `valuation_reference.db` is
> tracked in git. Running `update_damodaran.py` directly on the server
> mutates the tracked file and creates a `git pull` conflict on the
> next deploy — and a force-pull would silently lose the fresh data.
> The convention is:
>
> 1. Run the refresh on this workstation (the one with the `.venv`
>    in `Desktop\Valuation Tool Project\`, or a fresh venv in
>    `api/valuation/`):
>    ```powershell
>    cd treppides-hub\api\valuation
>    venv\Scripts\python update_damodaran.py
>    ```
> 2. Verify the new edition string and a couple of values look sane.
> 3. Commit the updated `.db` and push:
>    ```bash
>    git add api/valuation/valuation_reference.db
>    git commit -m "data: refresh Damodaran reference data (<edition>)"
>    git push
>    ```
> 4. On the server, `git pull` and restart the service so SQLAlchemy
>    re-opens the file:
>    ```bash
>    cd ~/treppides-hub && git pull
>    sudo systemctl restart valuation-api
>    ```
>
> If you ever need to refresh on the server (e.g. workstation
> unavailable), reset the working tree first so git knows the file
> changed: `git stash`, run the script, verify, then
> `git commit api/valuation/valuation_reference.db ...` directly from
> the server checkout and push.
