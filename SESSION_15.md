# Session 15 — Live Server Assessment + Long-Term Capacity Plan

**Date:** 2026-05-29
**Planning horizon:** 200 total staff, ~60–80 concurrent at peak, 3-year roadmap
**Scope:** Documentation + planning only. No code changes, no server changes.
Read-only SSH session against `tech-admin@192.168.0.221`.

This session is the canonical reference for the hub's current resource
posture, its optimal target specs, and the architecture options on the
table for the next 3 years. README.md, STATUS.md and PROJECT_BRIEF.md
all point back here.

---

## 1. Why this session

The earlier capacity work (v1–v3 of `Treppides_Hub_Capacity_and_Video_
Streaming_Plan.docx`) was written from project documentation, not from
the live box. We finally SSH'd in and pulled the real numbers. Several
v3 assumptions turned out to be wrong (RAM was a guess; disk was
smaller than imagined; BookStack's port binding was a confirmed
finding, not theoretical). This document records what we actually
found so every future session starts from facts rather than guesses.

The other reason: the firm wants the hub opened to all ~200 staff and
a video-hosting subsystem added. Those two changes together force a
real sizing exercise rather than a vibes-based "the box is fine".

---

## 2. Live snapshot (2026-05-29)

### 2.1 Hardware as the VM actually reports it

| Resource | Value | Comment |
|---|---|---|
| CPU | AMD EPYC 7F72, **4 vCPU** (SMT off) | High-frequency server CPU, KVM guest |
| RAM | **9.5 GiB total**, 980 MiB used, 8.6 GiB available | 5.3 GiB is reclaimable buff/cache |
| Swap | 4 GiB allocated, 0 B used | Healthy |
| Root disk (`/`) | **72 GB total, 9.7 GB used (15 %)**, 62 GB free | Smaller than v3 docx assumed |
| `/boot` | 2 GB (201 MB used) | Normal |
| Uptime | 65 days | All services stable since last reboot |
| Load avg | 0.06 / 0.02 / 0.00 | Box is essentially idle |
| Hostname | `tech-srv` | IP `192.168.0.221`; docker bridges `172.17.0.1`, `172.18.0.1` |

### 2.2 Service footprint (host systemd)

| Service | Up since | RSS | Notes |
|---|---|---|---|
| `nginx` (host) | 2026-05-15 | 6.8 MB | Reverse proxy + TLS. Trivial cost. |
| `clickup-fees` | 2026-05-12 | 50.6 MB | FastAPI on `127.0.0.1:8001` |
| `valuation-api` | 2026-05-25 | 50.1 MB | FastAPI on `127.0.0.1:8002` |

BookStack + MariaDB (Docker) couldn't be measured without sudo, but the
9.5 GB / 980 MB used reading tells us their combined RSS is well under
1 GB.

### 2.3 Network listeners (what's actually exposed)

| Address | Port | Service | Exposure |
|---|---|---|---|
| `0.0.0.0` | 443 | nginx (host) | LAN — HTTPS |
| `0.0.0.0` | 80 | nginx (host) | LAN — redirects to 443 |
| `0.0.0.0` | 22 | sshd | LAN — SSH |
| **`0.0.0.0`** | **6875** | **BookStack (container)** | **LAN — bypasses nginx TLS** |
| `127.0.0.1` | 8001 | clickup-fees | Local-only (good) |
| `127.0.0.1` | 8002 | valuation-api | Local-only (good) |

**BookStack on `0.0.0.0:6875` is the v3 §10.2 finding confirmed live.**
Anyone on the LAN can hit `http://192.168.0.221:6875/` directly and
bypass nginx — no TLS, no security headers, no rate limits. Fix is to
bind the Docker port to `127.0.0.1:6875` in
`~/bookstack/docker-compose.yml`.

### 2.4 Traffic (real, not modelled)

| Measure | Value |
|---|---|
| `access.log` size today | 16 KB |
| Total request lines today | 68 |
| Log files for last ~20 days | All < 10 KB compressed |

The hub is in pilot — almost no live traffic. Today's numbers cannot
be extrapolated to 200 users; the sizing work in §4 is from first
principles, calibrated against nginx/FastAPI/BookStack benchmark
literature on EPYC-class hardware.

### 2.5 nginx tuning state vs. recommended

| Setting | Current (host nginx) | Recommended for 200 users |
|---|---|---|
| `worker_processes` | `auto` (= 4) | `auto` — fine, will grow to 8 after VM resize |
| `worker_connections` | **768** (Ubuntu default) | `4096` |
| `keepalive_timeout` | default 75s | `30s` |
| `keepalive_requests` | default 1000 | keep |
| `gzip` | `on`, but **no `gzip_types`** set | enable for text/css, js, json, svg |
| Brotli | not installed | optional — `ngx_brotli` |
| `limit_req_zone` | **none** | layered design — see §5 |

### 2.6 Kernel tuning state

| Parameter | Current | Recommended |
|---|---|---|
| `net.core.somaxconn` | **4096** (already good) | keep |
| `net.ipv4.tcp_tw_reuse` | `2` (enabled with constraints) | keep |
| `net.ipv4.tcp_fin_timeout` | `60` | `15` |
| `fs.file-max` | 9.2e18 (effectively unlimited) | keep |
| `vm.swappiness` | **60** (default) | `10` |

### 2.7 Backups / operations

- **No crontab for `tech-admin`** — no automated jobs of any kind.
- **`~/backups/` does not exist** — no backup target configured.
- `/var/log/nginx/access.log` is `www-data:adm` 640 — `tech-admin`
  cannot read it without sudo. Future log-aggregation tooling must
  run as root or in the `adm` group.

### 2.8 Media disk usage

```
~/treppides-hub/media               4.2 MB total
~/treppides-hub/media/images        4.2 MB
~/treppides-hub/media/videos        4 KB (empty)
~/treppides-hub/api/valuation/
  valuation_reference.db            840 KB
```

Effectively zero media so far. The current disk allocation has not
been stressed.

---

## 3. Optimal resources for 200 users / 3-year horizon

### 3.1 Recommended target spec

| Resource | Current | **Target (≤ 24 months)** | Why |
|---|---|---|---|
| vCPU | 4 | **8** | Headroom for one FFmpeg transcode + normal traffic in parallel |
| RAM | 9.5 GB | **16 GB** | OpenProject (+2–3 GB), FFmpeg worker peak (+1 GB), kernel cache headroom |
| Root disk | 72 GB | **250 GB** | OS + logs + BookStack data growth |
| Data disk | n/a (lives on root) | **1 TB SSD** (dedicated, mounted at `/srv/media`) | Video library over 3 years |
| Network | 1 Gbps LAN | unchanged | 1 Gbps saturates around ~280 concurrent 1080p viewers — well beyond 200 staff |

The lift from current is **+4 vCPU, +6.5 GB RAM, +1 TB SSD**. RAM is
less of a constraint than initially modelled because the live box
shows 8.6 GB available with the full current stack running.

### 3.2 Sizing rationale (200 staff, ~75 concurrent peak)

- **CPU.** ~25 RPS dominated by BookStack page renders (200–400 ms each).
  Even with zero caching, 8 vCPU absorbs this at < 25 % CPU. Crucial
  property: a transcode job pinning 4 cores leaves another 4 for users.
- **RAM.** BookStack + MariaDB ~1.5 GB · two FastAPI services ~0.1 GB
  · OpenProject ~2.5 GB · OS + nginx ~1 GB · FFmpeg worker peak ~1 GB
  · kernel buff/cache ~8 GB → fits 16 GB with comfort, tight at 12 GB.
- **Disk.** 200 staff × ~10 GB attachments/PDFs over 3 years ≈ 20–30 GB
  for BookStack; 100–500 GB video over 3 years (depending on cadence
  — see v3 docx §17.4); ~50 GB OS + logs. **1 TB is the right number;
  500 GB will fit if video cadence is restrained.**
- **Network.** 1080p HLS at 3.5 Mbps means a 1 Gbps LAN handles ~280
  concurrent viewers before saturating. We will never approach that.

---

## 4. Long-term architecture — VM options for 200 users / 3 years

Three honest paths, in order of complexity. Recommendation in §4.4.

### 4.1 Option 1 — Single VM, vertically scaled  *(recommended start)*

Resize `tech-srv` from 4 vCPU / 9.5 GB / 72 GB → **8 vCPU / 16 GB /
250 GB + 1 TB data SSD**. Keep everything on one host: nginx,
BookStack + MariaDB, FastAPI services, video transcoder,
OpenProject when it lands.

- **Pros:** zero migration; same IP, same OS, same data; single
  monitoring + backup target; lowest ops overhead.
- **Cons:** transcode jobs can briefly steal CPU from interactive
  users; single point of failure for the entire portal.
- **When this stops being enough:** any of (a) concurrent video
  viewership > 100 sustained, (b) disk > 70 % full despite retention
  policies, (c) a transcode job causes a user-visible slowdown
  twice in production.

### 4.2 Option 2 — Two VMs: `hub-srv` + `media-srv`

Split the workload by responsibility.

| VM | Specs | Workload |
|---|---|---|
| `hub-srv` (this box, lightly scaled) | 6 vCPU / 12 GB / 100 GB | nginx (TLS), BookStack, MariaDB, FastAPI, OpenProject, Admin Panel |
| `media-srv` (new) | 8 vCPU / 16 GB / 2 TB SSD | FFmpeg worker, HLS segments, internal nginx serving `/media/video/` |

`hub-srv` reverse-proxies `/media/video/` to `media-srv`'s internal
nginx over the LAN.

- **Pros:** transcoding can't slow the portal; either VM can be
  patched/rebooted independently; clean disk-growth path on
  `media-srv`; resilience improves.
- **Cons:** two boxes to monitor, backup, patch; nginx config gains
  an upstream block; ops time ~2×.

### 4.3 Option 3 — Three VMs: `hub-srv` + `data-srv` + `media-srv`

Adds isolation for BookStack + MariaDB on a dedicated `data-srv`.
Pays off only if compliance demands strict separation between the
content layer and the database. **Skip unless explicitly required.**

### 4.4 Decision matrix

| Criterion | 1 — Single VM | 2 — hub + media | 3 — hub + data + media |
|---|---|---|---|
| Cost (1 year) | + small VM resize | + one new VM | + two new VMs |
| Effort to implement | 0.5 day | 1.5–2 days | 3–4 days |
| Tolerates daytime video uploads | Yes (with concurrency = 1) | Yes (concurrency = 2) | Yes |
| Storage ceiling (practical) | ~500 videos | Thousands | Thousands |
| Isolation of failure | Low | Medium | High |
| Suits 200 users / 3 years | **Yes — sweet spot** | Yes — over-provisioned for years 1–2 | Over-provisioned |

**Recommended path:** start with Option 1 *now*. Plan and document
the migration to Option 2 (§4.5) but don't execute until one of the
trigger conditions in §4.1 fires.

### 4.5 Migration playbook — Option 1 → Option 2

When the trigger conditions fire, the migration order is:

1. Provision `media-srv` (Ubuntu 24.04, 8 vCPU / 16 GB / 2 TB SSD,
   static IP on same LAN, e.g. `192.168.0.222`).
2. `apt install nginx ffmpeg`; install the transcoder Python venv
   and `video-transcoder.service` systemd unit.
3. Bind a private internal cert (`*.treppides.com` wildcard already
   covers it) so the inter-VM upstream is HTTPS.
4. `rsync -av` of `~/treppides-hub/media/video/` from `hub-srv` to
   `media-srv:/srv/media/video/`.
5. Add `upstream media_backend { server 192.168.0.222:443; }` to
   `hub-srv`'s nginx and switch `/media/video/` from `alias` to
   `proxy_pass https://media_backend;` with `proxy_cache` enabled.
6. Drain transcoder queue on `hub-srv`, disable + remove the
   `video-transcoder.service` unit, leave `/srv/media/video/` symlinked
   read-only as a safety net for 30 days.
7. Update `STATUS.md` services table and write a SESSION file.

The cutover is reversible up to step 5 by reverting the nginx block.

---

## 5. Rate limiting — design for 200 users behind office NAT

The v3 docx proposed a per-IP rate limit
(`limit_req_zone $binary_remote_addr`). That's the right *backstop*
but the wrong *primary* for a corporate LAN where everyone shares one
office WAN IP and an unknown number of internal IPs (the office
network may NAT internal clients differently per VLAN).

Four mechanisms exist; the hub should use **three of them layered**:

### 5.1 Mechanism comparison

| Mechanism | nginx key | Pros | Cons |
|---|---|---|---|
| **Per-IP hash** | `$binary_remote_addr` | Zero config, no identity needed | NAT shares one bucket — one user can starve the floor |
| **Per-session cookie** | `$cookie_hub_session` | Each browser tab/user gets its own bucket | Requires we issue a session cookie (we don't today) |
| **Per-authenticated user** | `$http_authorization` or set by SSO | True per-user fairness across devices | Needs SSO/LDAP (Phase 2) |
| **Per-endpoint global cap** | constant `"global"` | Total ceiling — "no more than X/min ever" | Blunt, not user-aware |

### 5.2 Recommended layered design

In `/etc/nginx/nginx.conf` http {}:

```nginx
# Primary — per session (after BookStack-token proxy ships, hub sets this cookie)
limit_req_zone $cookie_hub_session    zone=sess_api:10m       rate=10r/s;

# Backstop — per source IP
limit_req_zone $binary_remote_addr    zone=ip_api:10m         rate=30r/s;
limit_req_zone $binary_remote_addr    zone=ip_upload:10m      rate=5r/s;

# Catastrophe ceiling — transcode enqueues
limit_req_zone "global"               zone=global_xcode:10m   rate=2r/m;
```

Then in the relevant server-block locations:

```nginx
location /api/upload/         {
    limit_req zone=ip_upload     burst=10 nodelay;
}
location /api/upload/video     {
    limit_req zone=ip_upload     burst=10 nodelay;
    limit_req zone=global_xcode  burst=5  nodelay;
}
location /api/clickup/         {
    limit_req zone=sess_api      burst=60  nodelay;
    limit_req zone=ip_api        burst=120 nodelay;
}
location /api/valuation/       {
    limit_req zone=sess_api      burst=60  nodelay;
    limit_req zone=ip_api        burst=120 nodelay;
}
```

### 5.3 Trade-offs and gotchas

- **Zone memory.** `10m` ≈ 160 000 unique keys per zone. With ~200
  users + transient session cookies, plenty of headroom.
- **`$binary_remote_addr` vs `$remote_addr`.** Always use the binary
  form for IP keys — 4 bytes (IPv4) vs ~15 bytes text. Same hashing,
  less zone memory pressure.
- **`nodelay`.** Returns 503 immediately on overage. Better for an
  internal portal than nginx's default queue-and-drip, because users
  get a clear failure they can react to.
- **`$cookie_hub_session` will be empty until the BookStack-token
  proxy lands** (v3 docx §8.3). Until then the session limiter is
  effectively a no-op and only the IP backstop runs. That's
  acceptable — IP backstop alone is still better than no limit, and
  the session layer activates automatically once the cookie exists.
- **Reverse proxy in front.** If a future load balancer terminates
  TLS upstream of nginx, switch the key to
  `$http_x_forwarded_for` with `real_ip_header` set. Not applicable
  today.

---

## 6. The "etc" — operational items for a 200-user / 3-year posture

These are the items that aren't sizing but are part of a long-term plan.

### 6.1 Monitoring & alerting

- **Now (Phase A):** Netdata installed on `tech-srv`, UI restricted
  to IT subnet via ufw. Alerts at: CPU > 80 % for 5 min, disk > 75 %
  used, any of the 4 services exit, cert expiry < 30 days.
- **When Option 2 lands:** Prometheus on `hub-srv` scraping both
  hosts (node_exporter + nginx_exporter + cAdvisor). Grafana on the
  same VM. Keeps the monitoring layer cheap and centralised.

### 6.2 Backups

Currently **non-existent**. Minimum bar before opening the hub
firm-wide:

```bash
# /etc/cron.d/treppides-backup
0 2 * * * tech-admin /home/tech-admin/bin/nightly-backup.sh
```

`nightly-backup.sh` should `tar | gzip | rsync` to a separate
machine (or at minimum a second disk):

- `~/bookstack/mysql_data/`
- `~/treppides-hub/media/`
- `~/treppides-hub/api/valuation/valuation_reference.db`
- nginx + systemd configs (`/etc/nginx/`, `/etc/systemd/system/*.service`)

Weekly full to a removable drive held by IT for 30 days. Quarterly
restore dry-run on a scratch VM.

### 6.3 SSO / LDAP

The right time is "when 200 users go live", not before. Two
benefits unlock when it lands:

1. Per-user rate limiting (§5.2 sess_api zone upgrades to per-user)
2. Audit log gets per-user attribution instead of session-only.

### 6.4 TLS cert lifecycle

Sectigo wildcard `*.treppides.com` valid until **22 Nov 2026**.
Manual renewal. Long term:

- Move to Let's Encrypt wildcard via `acme.sh` with the office DNS
  provider's API for automated renewal (eliminates the cliff).
- Calendar reminders at 60 / 30 / 7 days before any manual cert
  expires.

### 6.5 Storage growth

When video library crosses 500 GB:

- Move `_raw/` source files to a slower/cheaper disk or NAS.
- Keep HLS segments (`{video_id}/*.ts`) on fast SSD — they're the
  hot read path.

### 6.6 OpenProject

Already staged at `~/openproject/docker-compose.yml`. Reserve 2–3
GB RAM + 10 GB disk in the sizing. Fits comfortably on the 16 GB
target.

---

## 7. What was assessed but not changed in this session

Everything below is from observation only. **No edits, no restarts,
no installs.** The deltas vs prior docs are captured here so future
sessions can act on them.

| Item | What we learned | Action |
|---|---|---|
| Server RAM | 9.5 GB (v3 docx assumed unknown ≥ 8 GB) | README + STATUS updated |
| Root disk size | 72 GB (v3 assumed unbounded) | README + STATUS updated |
| BookStack port | `0.0.0.0:6875` (v3 listed as theoretical) | Promote to confirmed High in next pass |
| Backups | None exist | Add to Phase A blockers |
| nginx tuning | Ubuntu defaults | Add to Phase A blockers |
| Kernel tuning | Mostly defaults; somaxconn already 4096 | Add to Phase A |
| Crontab | Empty | Add to Phase A |
| FastAPI binds | Both on 127.0.0.1 (good — v3 worry doesn't apply) | Note in STATUS |

---

## 8. Open items / follow-ups

1. **Build v4 of the capacity docx** if the firm wants the live
   numbers reflected in the formal report. Key deltas:
   - Replace assumed RAM/disk with the live 9.5 GB / 72 GB.
   - Promote BookStack `:6875` exposure from theoretical to
     confirmed (severity = High).
   - Replace the IP-only rate-limit section with §5's layered design.
   - Add the §4.5 migration playbook from Option 1 → Option 2.

2. **STATUS.md "What Is NOT Done Yet" needs broadening** to include
   the operational gaps (backups, monitoring, nginx tuning, rate
   limits). Done in this commit at the bottom of STATUS.md.

3. **NEXT_SESSION.md is still on Session 10.** Out of scope for
   this session; flagged for the next maintainer.

4. **README.md was last edited at Session 4.** Brought partially
   up to date in this commit (new resources + long-term sections
   appended); a full rewrite is still owed but is a separate piece
   of work.

---

## 9. Critical hub rules — reminder

1. No `localhost`/`127.0.0.1` in frontend.
2. `config.js` gitignored.
3. No build step.
4. No CDN — vendor everything.
5. `media/` and `valuation_reference.db` not committed; both are
   rebuilt server-side.
6. SSL private key stays at `/etc/nginx/ssl/treppides.key` only.

This session touches no code paths — only documentation — so all
rules are unaffected.
