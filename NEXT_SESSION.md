# NEXT SESSION — Start Here

> **This is the entry point for every session.**
> Read this first, then follow the links below for deeper context.

---

## Quick Orient

| What | Where |
|---|---|
| Full project context, tech stack, rules | [PROJECT_BRIEF.md](PROJECT_BRIEF.md) |
| Current live status of all services | [STATUS.md](STATUS.md) |
| Full VM provisioning (fresh install) | `bash SETUP.sh` |

**Server:** `192.168.0.221` · Claude runs directly on the server — no SSH needed
**Live URL:** https://hub.treppides.com
**Repo:** `~/treppides-hub` (git, origin = github.com:andreas1612/treppides-hub)

---

## Last Session — 2026-05-12 (Session 10)

**What was done — AML dashboard fees broken down per list:**
- Each AML list now has its own breakdown field driving KPIs, chart, and
  drill-down badges:
  - `new` → `client_status` (Existing / New) — unchanged behaviour
  - `rejected` → `rejection_reason`
  - `disengaged` → `disengaged_reason`
- Fixes a silent bug: Rejected/Disengaged previously had €0 in the
  Existing/New KPI cards (because those lists have no `client_status`
  field) **and** every bar in the chart was force-bucketed as "Existing".
- New KPI layout for rejected/disengaged: **Top {Reason}** (€ value +
  truncated reason name) + **{Reason}s** (distinct value count). The new
  list keeps Existing / New cards exactly as before.
- Chart datasets and legend now built dynamically from the distinct
  breakdown values present in the data, with a stable per-load palette
  (Existing/New keep their fixed blue/green; other reasons cycle through
  a 9-colour palette).
- Drill-down table cells in the breakdown column render as colour-coded
  badges matching the chart bars (full text on hover for long labels).
- Single file changed: `components/pages/fees.js` (commit `5f30c35`).

**Unverified assumption — verify after server pull (see Priority 1):**
The snake-cased ClickUp field keys are assumed to be `rejection_reason`
and `disengaged_reason`. If they're different in ClickUp, the chart will
show a single grey "Unknown" bar — fix is to update `LIST_META` in
`components/pages/fees.js`.

**Earlier today (Session 9):** Social-post announcements + media upload
infrastructure. See PROJECT_BRIEF.md session log for details.

**Pending (carry-over from Session 9):**
```bash
sudo systemctl restart clickup-fees   # pick up new upload endpoints in server.py
```

---

## Priority 1 — Verify AML breakdown field names (5-minute task)

After `git pull` on the server, hard-refresh the AML pages and check:

| List | Expected |
|---|---|
| New | Identical to before — Existing blue, New green |
| Rejected | Multiple coloured bars stacked by rejection reason, legend listing each reason, "Top Rejection Reason" KPI with real € value |
| Disengaged | Same, by disengagement reason |

If Rejected/Disengaged shows a single grey "Unknown" bar, the snake-cased
key in `LIST_META` doesn't match what ClickUp returns. Diagnose from the
server:

```bash
curl -sk https://192.168.0.221/api/clickup/fees?list=rejected | \
  python3 -c "import json,sys;d=json.load(sys.stdin);print(sorted({k for t in d['tasks'] for k in t}))"
curl -sk https://192.168.0.221/api/clickup/fees?list=disengaged | \
  python3 -c "import json,sys;d=json.load(sys.stdin);print(sorted({k for t in d['tasks'] for k in t}))"
```

Find the actual key (e.g. maybe `disengagement_reason` or `reason_for_rejection`),
update `breakdownField` per list in `components/pages/fees.js` `LIST_META`,
push.

---

## Priority 2 — DNS Record (5-minute task, just needs office router access)

Add an A record to the **office router / Active Directory DNS**:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `hub.treppides.com` | `192.168.0.221` | 300 |

Once added: any LAN browser hitting `https://hub.treppides.com` gets the padlock.

**Temporary workaround** (per-PC): add to Windows hosts file `C:\Windows\System32\drivers\etc\hosts`:
```
192.168.0.221   hub.treppides.com
```

---

## Priority 3 — OpenProject Deployment

Deploy OpenProject at `https://hub.treppides.com/projects`.

```bash
cd ~/openproject && sudo docker compose up -d
sudo systemctl reload nginx   # nginx config already has the /projects proxy block
```

---

## Priority 4 — Test Media Upload (after clickup-fees restart)

1. Open hub, click Admin in sidebar, enter PIN
2. Select Announcements section
3. Click Photo → choose an image → verify preview grid shows
4. Publish → verify it appears in the feed with inline image
5. Test Video and YouTube paths the same way

---

## Service Health Check

```bash
sudo systemctl status nginx clickup-fees --no-pager
cd ~/bookstack && sudo docker compose ps
curl -s http://localhost:8001/health
curl -s https://hub.treppides.com/ | grep "<title>"
```

---

## Critical Rules — Don't Forget

1. **Never `localhost` in frontend** — always relative paths (`/api/...`). Nginx proxies.
2. **`config.js` is gitignored** — only on server. Never commit.
3. **No build step** — edit files, `git add -A && git commit && git push`, hard-refresh. Done.
4. **BookStack token expires 15/08/2026** — rotate in BookStack admin → My Account → API Tokens.
5. **Chart.js in `vendor/`** — do not use CDN.
6. **SSL private key** — `/etc/nginx/ssl/treppides.key`, chmod 600, never commit/email.
7. **`media/` dirs gitignored** — uploaded files live only on server, never in git.
8. **Always re-read the session MD file** — it contains exact specs; don't rely on memory.
