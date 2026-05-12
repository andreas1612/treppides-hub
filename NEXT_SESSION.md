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

## Last Session — 2026-05-12 (Session 9)

**What was done:**
- Announcements redesigned as social post feed (LinkedIn/FB style)
  - Inline images (single + grid up to 4), uploaded video, YouTube/Vimeo embeds
  - 10 posts shown (was 5)
- Admin panel: media composer added to Publish tab
  - Photo button → file picker → thumbnail preview grid
  - Video button → file picker → inline video preview (validates ≤150MB)
  - YouTube/Vimeo button → URL input → live iframe preview
  - On publish: uploads media first → gets URLs → embeds in BookStack page HTML
  - Auto-refreshes announcements feed after publish
- FastAPI (`clickup-fees`): `/api/upload/image` and `/api/upload/video` endpoints
- Nginx: `/media/` static block, `/api/upload/` proxy, `client_max_body_size 160m`
- `styles/widgets/announcements.css` created
- `media/images/` and `media/videos/` added to `.gitignore`

**Pending (needs sudo from terminal):**
```bash
sudo systemctl restart clickup-fees   # pick up new upload endpoints in server.py
```

---

## Priority 1 — DNS Record (5-minute task, just needs office router access)

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

## Priority 2 — OpenProject Deployment

Deploy OpenProject at `https://hub.treppides.com/projects`.

```bash
cd ~/openproject && sudo docker compose up -d
sudo systemctl reload nginx   # nginx config already has the /projects proxy block
```

---

## Priority 3 — Test Media Upload (after clickup-fees restart)

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
