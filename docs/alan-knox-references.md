# Alan Knox — Relevant Articles for the Treppides Hub

> **Source:** https://alanknox.com/category/articles/
> **Curated:** 2026-05-29 (session 15)
> **Scope:** the "Engineering for Vibe Coders" series + a couple of
> production-tip articles. Alan Knox writes about AI-coded apps and
> general engineering practices for builders. The articles below are
> the ones whose advice maps directly onto active decisions in the
> Treppides Hub project — capacity planning, security, the upcoming
> video subsystem, and operational hardening.

This file is a **reference index**, not a replacement for the original
articles. Each entry distils the strongest practical points and ties
them back to a specific section of the project documentation
(`SESSION_15.md`, the v4 capacity docx, or specific files in the repo)
so a future engineer can immediately see where the advice would land.

The site is large (~225 articles across 25 pages). This file is
intentionally short. If a future session uncovers another article
worth keeping, append it under the same structure.

---

## How to read each entry

| Field | What it is |
|---|---|
| **What it says** | 4–6 bullets capturing the article's strongest recommendations |
| **How it applies** | The specific hub component, file, or doc section the advice maps onto |
| **Watch-outs** | The pitfalls the article warns against, restated in hub terms |
| **URL** | The original article |

---

## 1. Rate Limiting

**URL:** https://alanknox.com/rate-limiting-engineering-for-vibe-coders/

**What it says**
- List abusable actions *before* you prototype — authentication, public APIs, AI calls, file uploads, expensive queries are the obvious targets.
- Plan for unexpected scale: assume endpoints will be hit faster than you expect.
- Make limits transparent — return clear errors with retry guidance so they don't look like random failures.
- Distinguish temporary (capacity-driven) limits from permanent (product-rule) limits.
- Rate limiting is a *safety mechanism*, not a performance feature. Don't confuse the two.
- Bolting it on after deployment is much harder than designing it in upfront.

**How it applies**
- Directly informs **v4 §10.4** (the layered rate-limit design — per-session-cookie primary + per-IP backstop + per-endpoint global ceiling).
- Reinforces the choice in **SESSION_15 §5** to give `/api/upload/` its own tighter zone than the read-only endpoints.
- The "make limits transparent" rule maps to using `nodelay` so users see an immediate 503 rather than a queued delay they can't reason about.

**Watch-outs**
- Don't pretend the office NAT means we don't need limits — one malicious script behind the NAT can still saturate. The backstop layer matters even when the population is staff.
- Don't treat the 5 r/s upload limit as "performance tuning" — it's there because each upload is a 150 MB write, not because it's slow.

---

## 2. Background Jobs

**URL:** https://alanknox.com/background-jobs-engineering-for-vibe-coders/

**What it says**
- Decide which actions must be immediate and which can be eventual *before writing a line of code*.
- Work taking more than a second or two is a candidate for background processing.
- Document failure detection + recovery for every async task upfront.
- Always give users explicit feedback — "silent work that may or may not finish" is the worst possible UX.
- Design with 10× growth in mind: which jobs should scale independently from user requests?
- Validation, permission checks and critical business rules belong in the foreground.

**How it applies**
- This is the manual for the **video transcoder worker** in **v4 §15.5** and the rollout in **§20 step 3**.
- The hub's planned worker already follows the bones of this advice: a SQLite `videos`/`video_jobs` table, polling, explicit `state` transitions (`queued → running → done | failed`), retries capped at 3.
- The user-feedback rule informs the admin-upload UX in **v4 §16.2**: poll `/api/upload/video/{id}` every 5 s and show progress until `state='done'` or `'failed'`. Don't leave the admin staring at a spinner.

**Watch-outs**
- Don't move validation or PIN-gating into the worker — those are foreground concerns (cross-references §8 of v4).
- A worker without journalctl visibility is a black box. Confirm the systemd unit logs every state transition so we can debug from `journalctl -u video-transcoder`.

---

## 3. Retry Strategies

**URL:** https://alanknox.com/retry-strategies-engineering-for-vibe-coders/

**What it says**
- Classify failures as **transient** or **permanent** before coding; only retry the transient ones.
- Use backoff with increasing delays (the article gives 1 s → 5 s → 10 s as an illustration), not immediate retries.
- Add randomness (jitter) so multiple clients don't all retry simultaneously.
- Make operations **idempotent** before you retry them — otherwise you double-charge / double-send / double-write.
- Set explicit retry limits + a clear handler for "retries exhausted".
- Don't inherit retry behaviour from libraries without understanding their assumptions.

**How it applies**
- Direct input to the transcoder worker's failure policy (**v4 §15.5**): "retries capped at 3, then mark `failed` and log".
- The "classify before retrying" rule means the worker should distinguish FFmpeg's exit codes. Codec / format errors are permanent (don't retry — surface to the admin). Disk-full or signal interruption is transient.
- Reinforces the idempotency design in the worker: claim a row with `UPDATE jobs SET state='running' WHERE id=? AND state='queued'` so two worker processes can't both claim the same job.

**Watch-outs**
- A bad upload (corrupt source MP4) is a *permanent* failure. The worker must not loop on it forever; that wastes CPU and disk.
- "Payment was charged but response timed out" — the article's payment example translates here to "transcode succeeded but the DB update failed". The worker needs to be safe if killed mid-step: re-running the FFmpeg invocation must overwrite, not error.

---

## 4. Race Conditions

**URL:** https://alanknox.com/race-conditions-engineering-for-vibe-coders/

**What it says**
- Race conditions are **correctness bugs, not performance bugs**. Adding delays or hardware makes them worse, not better.
- Pre-prototype habit: list every place where two actions could touch the same data at the same time.
- Assume concurrent execution is the default — every important action *can* happen simultaneously.
- High-risk areas: counters, status transitions, inventory, payments, session updates.
- Logging and debugging don't fix race conditions — they mask the timing dependency.
- Goal: **make invalid states impossible**, not just unlikely. Use atomicity, DB constraints, locks, idempotent operations, single-writer patterns.

**How it applies**
- Directly informs the transcoder's job-claim pattern (**v4 §15.5**). The atomic claim is:
  ```sql
  UPDATE video_jobs
     SET state='running', claimed_at=?
   WHERE id=? AND state='queued'
  ```
  with a check on the affected row count. If two worker processes ever run (Option 2 with `media-srv`), only one wins the row.
- Status transitions in the job table (`queued → running → done | failed`) are exactly the "status transitions" the article calls out as high-risk.
- The "single-writer pattern" justifies **concurrency = 1** on the 4-vCPU box (v4 §15.5) — until SQLite is replaced or moved off-VM, one writer is the safest choice.

**Watch-outs**
- Don't add `sleep()` to "fix" a race in the worker — it's the article's headline anti-pattern.
- SQLite's default journal mode can deadlock under concurrent writers. If we ever raise worker concurrency, switch the jobs DB to WAL mode (`PRAGMA journal_mode=WAL`).

---

## 5. Aggregate Logs and Set Alerts Early

**URL:** https://alanknox.com/production-tip-aggregate-logs-and-set-alerts-early/

**What it says**
- Route logs to a centralised system that supports structured JSON, field filtering, real-time alerts, and dashboards.
- Set up alerting *before* failures happen — don't wait for a system to break.
- Configure alerts for error-rate spikes, specific failing requests, and latency increases.
- Tools to look at: Graylog, Splunk, ELK, Grafana + Loki.
- Local file logging or "the console" fails as soon as you have more than one container or service.
- Raw log files without centralisation become a liability — debugging production becomes nearly impossible.

**How it applies**
- Informs **SESSION_15 §6.1** (monitoring) and **v4 §5.4 / §21.1**. The Phase A choice is Netdata for speed; Phase B switches to Prometheus + Grafana once `media-srv` lands.
- Reinforces the **§3.1 blocker #2** (install monitoring) — currently the live box has no aggregation. `journalctl -u` is the only debugging path.
- The "alerts before failures" rule maps to the v4 alert thresholds: CPU > 80 % 5 min, disk > 75 %, any service exit, cert < 30 days.

**Watch-outs**
- The hub already has logs scattered across `nginx`, `journalctl -u clickup-fees`, `journalctl -u valuation-api`, and the BookStack container. Without aggregation, correlating a slowdown across services means SSH'ing in and tailing each one.
- `/var/log/nginx/access.log` is owned `www-data:adm` — any aggregation collector must run as root or be added to the `adm` group (SESSION_15 §2.7).

---

## 6. Anonymize Logs Before You Regret It

**URL:** https://alanknox.com/anonymize-logs-before-you-regret-it/

**What it says**
- Build a log wrapper that sanitises sensitive fields *before* data reaches disk.
- Replace names/emails with placeholder tokens; mask or hash user/session IDs.
- Redact known PII formats (emails, phone numbers) from structured data.
- Use Presidio / pii-extract for sophisticated detection at scale.
- Enforce sanitisation at the processor layer (Fluentd / Logstash) so it can't be bypassed.
- "You only need one leaked email in a log file to lose user trust."

**How it applies**
- Directly informs the **`video_views` table design (v4 §16.5)**: store `anonymised user ref` (a hashed session token until SSO lands), never raw email or name.
- Same principle applies to the **planned audit log on the BookStack token proxy** (v4 §8.3, §11.4) — log the action (`createPage`, `deletePage`), the page ID, the timestamp, and a hashed user identifier. Don't log the page body unless explicitly required.
- IT support tickets (FormSubmit, v4 §10.6) already leave the LAN — staff should be reminded not to paste sensitive data into the ticket field, and the future in-house replacement should sanitise on the server before mailing.

**Watch-outs**
- nginx `access.log` records full request URIs. If a future endpoint accepts an email or staff ID in the path, that ID is now in the access log. Either move identifiers into POST bodies, or scrub the access log format.
- The valuation tool exports JSON snapshots (v4 §16 / Session 14). Those files can contain client-identifying information. Treat them as PII; don't dump them into logs.

---

## 7. PII & Data Handling

**URL:** https://alanknox.com/pii-data-handling-engineering-for-vibe-coders/

**What it says**
- Identify all data entry / exit points before building. Treat every prototype as if real users will eventually access it.
- Minimise data collection: for every field, ask "what specific purpose does this serve?"
- Log only essential debugging info; turn off verbose output before deployment.
- Classify data before sending it to external AI systems. Assume prompts aren't private.
- Define access controls **early**, not "later".
- Review AI-generated code critically for missing authorisation, exposed credentials, unsafe patterns.
- Closing check: "If this system were exposed publicly tomorrow, what sensitive information would be at risk?"

**How it applies**
- Maps to the entire **Part 2 (§§7–12) of v4**: most of the security work *is* a PII / data-handling exercise — the BookStack token in `config.js`, the ADMIN_PIN default, the `allow_origins=*`, the missing CSP, all amount to "we deferred access controls".
- The "minimise collection" rule applies to:
  - `staff.json` — currently a flat static file. Confirm every column has a defined purpose; remove any that exist "just in case".
  - The valuation tool's JSON snapshot (Session 14) — review what gets serialised; client names + financials should not leave the server without explicit user action.
- Reinforces the choice in **v4 §3.1 #4** to rotate `ADMIN_PIN` before opening to the firm. The "if exposed tomorrow" thought experiment makes the default PIN indefensible.

**Watch-outs**
- The hub doesn't send anything to external AI systems today, but if a future feature does (e.g., a BookStack page summariser), this article becomes the design checklist.
- "It's just a prototype" is exactly the rationalisation that left `ADMIN_PIN: "1234"` in production for months. Apply the closing check to every new feature.

---

## Cross-reference — which article informs which hub decision

| Decision in the project | Articles that reinforce it |
|---|---|
| Layered rate-limiting design (v4 §10.4) | 1. Rate Limiting |
| Video transcoder worker design (v4 §15.5) | 2. Background Jobs · 3. Retry Strategies · 4. Race Conditions |
| Admin-upload UX polling (v4 §16.2) | 2. Background Jobs |
| Phase A monitoring choice (SESSION_15 §6.1, v4 §5.4) | 5. Aggregate Logs · 1. Rate Limiting |
| `video_views` audit table design (v4 §16.5) | 6. Anonymize Logs · 7. PII & Data Handling |
| BookStack token proxy + per-request audit (v4 §8.3, §11.4) | 6. Anonymize Logs · 7. PII & Data Handling |
| Rotate `ADMIN_PIN` off the default (v4 §3.1 #4) | 7. PII & Data Handling |
| Single-writer transcoder concurrency = 1 (v4 §15.5) | 4. Race Conditions |
| IT support ticket replacement (v4 §10.6) | 6. Anonymize Logs · 7. PII & Data Handling |

---

## Articles the site has that DON'T meaningfully apply

For honesty's sake — the site is ~225 articles deep. Most of it is
about AI-agent design, prompt engineering, vibe-coder workflow,
GitHub setup, and Claude API patterns. Those are interesting reads
but they don't change any decision in this project. Specifically,
these had promising titles but turned out not to be relevant:

- **Streaming & Chunked Responses** — about LLM token streaming, not HLS.
- **Concurrency Basics** — overlaps with the Race Conditions article above; the latter is the more directly applicable read.
- **Definition of Done (DoD)** — generic; the project's existing SESSION_*.md exit criteria already cover this.
- **File & Folder Structure** — relevant only if we ever refactor again; the Session 8 split into `shell/pages/widgets/` already follows similar principles.

If you find a new one worth keeping, append it below this line under
the same structure used above.

---

# Second pass — full catalogue review (2026-05-29)

After the first 7 entries above were captured, a complete inventory of
all 25 pages of the article archive was performed (~225 titles).
Triaged against the project's active decisions (capacity, security,
video subsystem, FastAPI / nginx ops, testing strategy) plus the
existing topics from the first pass. The 15 entries below are the
additions that materially apply to something the project is actually
doing — they are not exhaustive of the catalogue, just the ones that
would change or confirm a decision in v4 / SESSION_15.

Articles that turned out *not* to apply (AI agents, vibe-coding
philosophy, ROI, hype-cycle commentary, "I Wish AI Could…" series,
RFP/calendar/fraud-detection AI guides) are documented at the bottom
under "Articles reviewed and rejected (second pass)".

---

## 8. SQL Injection

**URL:** https://alanknox.com/sql-injection-engineering-for-vibe-coders/

**What it says**
- Use parameterised queries by default. The database treats parameters strictly as data, never as executable code.
- Never concatenate user input into query strings. This is the headline anti-pattern.
- Validation reduces attack surface but must accompany parameterisation, not replace it.
- Be careful with dynamic query construction across layers — search filters, sort columns, partial query building all hide vulnerabilities.
- Treat AI-generated query strings with extra suspicion.
- Even ORMs can reintroduce the bug if you drop into raw-query mode.

**How it applies**
- `api/clickup/server.py` and `api/valuation/main.py` both use SQLite via SQLAlchemy/raw queries. The Damodaran query path (Session 13's `Rates2Reference` lookup) builds filters from URL parameters — verify it uses parameterised binding, not f-string concatenation.
- When the BookStack token proxy (v4 §8.3) lands, any query against a future audit-log SQLite table must follow the same rule.
- The valuation tool's CSV import (Session 12's `fetch_exchange_rates.py`) doesn't write user input to SQL, but any future "saved valuations" feature will.

**Watch-outs**
- The pattern `"SELECT * FROM users WHERE email = '{input}'"` is the textbook hole. Search the codebase for f-strings or `%` formatting that touches `cur.execute()`.
- AI-generated code: if a future feature is scaffolded by an AI assistant, this is the first thing to check before merging.

---

## 9. DNS & Domain Management

**URL:** https://alanknox.com/dns-domain-management-engineering-for-vibe-coders/

**What it says**
- Plan subdomains as architecture (app., api., staging.), not as last-minute config.
- Centralise DNS — pick one primary provider, don't split records across systems.
- Use shorter TTLs during development; raise them in production for stability.
- Plan SSL from day one — every public endpoint should be HTTPS, mapped to the right hostname.
- Document the domain-to-services map as part of the architecture.
- Separate dev / staging / prod with subdomains to prevent test traffic affecting live.

**How it applies**
- Today: `hub.treppides.com` → `192.168.0.221` is the single record. Working but undocumented.
- v4 **§19 step 3** of the Option 1 → Option 2 migration playbook calls for `media-srv.treppides.com` → `192.168.0.222`. The Sectigo wildcard already covers it — confirms the article's "plan SSL from day one" advice was retroactively followed.
- Future: when video lands, consider `video.hub.treppides.com` if a dedicated subdomain helps with `auth_request` signed-URL gating (v4 §16.4).

**Watch-outs**
- Don't put dev/staging variants on the same hostname as production. The article's anti-pattern of "testing affecting live" maps directly to anything that mutates BookStack via the same API path.
- The DNS-to-services map belongs in SESSION_15 or STATUS.md — add a small table when the second VM lands so the next maintainer doesn't have to grep nginx configs to figure out which host serves what.

---

## 10. Backups & Data Recovery

**URL:** https://alanknox.com/backups-data-recovery-engineering-for-vibe-coders/

**What it says**
- Classify data before backing up — back up *only* what truly matters (accounts, configs, generated outputs).
- Define RPO (acceptable data loss) and RTO (recovery time) before building the backup mechanism.
- "A backup you haven't restored is not a backup." Test recovery on a schedule.
- Document recovery steps explicitly before handling important data.
- Keep backups geographically separated from the primary system.
- Use simple, maintainable tooling for prototypes — not enterprise complexity.

**How it applies**
- Directly maps to **v4 §3.1 blocker #1** ("Stand up nightly off-box backups") and **§5.3 / §21.2**.
- The "what to back up" checklist for the hub: BookStack MariaDB volume; `~/treppides-hub/media/`; `valuation_reference.db`; nginx + systemd configs. That's the four-target list already in **`nightly-backup.sh` (v4 §23.2)** — confirmed correct by the article's "back up only what matters" rule.
- RPO/RTO for the hub: realistic targets are RPO = 24 h (nightly), RTO = 4 h (rebuild on a scratch VM via SETUP.sh + last backup).

**Watch-outs**
- The "backup you haven't restored" warning is the one that bites. v4 §5.3 already prescribes a quarterly restore drill — *do them*. Calendar reminder, not a wish.
- Don't back up `valuation_reference.db` *only* — also keep the rebuild scripts (`seed_database.py`, `backfill_damodaran.py`, `update_damodaran.py`) so it can be reconstructed if the backup is corrupt. Session 13 already confirmed this works.
- A backup on the same VM is not a backup. The Option 1 → Option 2 second VM (`media-srv`) is also a candidate backup target for `hub-srv`.

---

## 11. Caching

**URL:** https://alanknox.com/caching-engineering-for-vibe-coders/

**What it says**
- List slow / expensive / repeated operations before coding — that's the candidate set.
- Define staleness rules upfront: acceptable age + invalidation triggers.
- Start with in-memory or file-based caches; don't reach for Redis until you need it.
- For each candidate, ask "if reused, will this still be correct?"
- Plan invalidation strategy: TTL, manual trigger, or version-based keys.

**How it applies**
- The hub already follows this advice in two places:
  - `clickup-fees`: 5-minute in-memory TTL cache on fees data (verified in `server.py`).
  - nginx: `/media/` block has `expires 7d` + `Cache-Control: public, immutable` (verified in `nginx-treppides-hub.conf`).
  - v4 §15.6 video segments use 24h immutable cache.
- Confirms the choice not to introduce Redis / memcached at current scale — both caches are correct *and* simple.

**Watch-outs**
- The "if reused, will this still be correct?" question matters for the fees cache. ClickUp data changes throughout the day; 5 min is a reasonable upper bound but a force-refresh endpoint (`/api/clickup/fees/refresh`) is the right escape hatch — already implemented.
- The valuation tool's reference data (Damodaran, FX) is *never* cache-invalidated mid-day — it's reseeded annually. The DB itself is the cache. No staleness rule needed because the data is by definition historical.
- If a future feature caches per-user data, isolation matters (one user's data must never be served to another). Today's caches are global so this doesn't apply.

---

## 12. Idempotency

**URL:** https://alanknox.com/idempotency-engineering-for-vibe-coders/

**What it says**
- Identify repeatable actions before coding. Plan retry-safe behaviour upfront.
- Assign unique identifiers (request IDs, transaction IDs) to track each action.
- Check if an action has already been processed before executing it again.
- Store minimal history of processed requests.
- Make critical operations safe to repeat even if accidentally triggered.

**How it applies**
- Directly informs the **video transcoder worker (v4 §15.5)**. Every job has a UUIDv4 `video_id`; re-running FFmpeg with the same `video_id` overwrites deterministically into the same `{video_id}/360p|720p|1080p/` directory tree. Crash mid-transcode → re-claim → re-run → final state correct.
- The atomic `UPDATE video_jobs SET state='running' WHERE id=? AND state='queued'` claim (Race Conditions, entry #4) plus idempotent FFmpeg invocation together make the worker safe under crash + restart.
- Media uploads are idempotent by accident — `uuid4().hex` generates a fresh filename per upload, so a double-clicked submit creates two files rather than corrupting one. Consider adding an explicit dedupe key (e.g., hash of the source bytes) before announcing video to the firm.

**Watch-outs**
- Network retries can double-submit. The admin upload UX (v4 §16.2) should disable the submit button on first click and only re-enable on `done` or `failed` — not on every poll response.
- Idempotency keys should outlive their action: store the `(client_request_id, result)` mapping for at least the maximum retry window, otherwise the second attempt looks new.

---

## 13. Authentication vs Authorization

**URL:** https://alanknox.com/authentication-vs-authorization-engineering-for-vibe-coders/

**What it says**
- Plan access models before coding — sketch auth methods and role permissions upfront.
- Default-deny: anything not explicitly allowed is blocked.
- Choose lightweight early options (API keys, simple username/password) over enterprise solutions.
- Map sensitive functionality to roles before development begins.
- Security must be enforced server-side — never rely on hidden buttons or frontend-only checks.

**How it applies**
- This article is the conceptual underpinning of **v4 §8.2 / §8.3**. The current ADMIN_PIN check is *frontend-only* — the exact anti-pattern the article calls out ("hidden buttons"). v4 §8.3 (the BookStack token proxy) moves the check server-side, which is the rule the article states.
- The future SSO/LDAP work (v4 §21.3) will give the hub real authentication (who you are); the proxy will handle authorisation (what you can do).
- The "default-deny" rule maps to v4's **§10.5 CSP** — no script/img/connect source not explicitly listed.

**Watch-outs**
- "Three authentication methods": today's hub has PIN only. SSO is the upgrade path. The intermediate state (proxy + PIN) is acceptable for Phase A but not the destination.
- The article's "users only see their own data" example doesn't apply today (no per-user data segregation), but will when SSO + per-user `video_views` logs land (v4 §16.5).

---

## 14. Configuration Management & Secrets Basics

**URL:** https://alanknox.com/configuration-management-secrets-basics-engineering-for-vibe-coders/

**What it says**
- Separate configuration from code *before* writing functional code.
- Use environment variables exclusively for secrets. Never commit credentials to source control or log them.
- Structure non-sensitive settings in JSON/YAML/TOML files for versioning and easy environment switching.
- Create local override files (`.env.local`) so personal settings don't pollute team configs.
- Document configuration expectations with `.env.example` / `config.example.json`.

**How it applies**
- The hub *partially* follows this:
  - Good: `config.example.js` is committed; `config.js` is gitignored; `api/clickup/.env` is gitignored with a `.env.example` template.
  - Bad: secrets are in `config.js` which loads in the browser (v4 §8.3 — the whole point of moving the BookStack token to a server-side proxy is to make `config.js` non-sensitive again).
- After **v4 §8.3** lands, `config.js` should contain only public values (URLs, feature flags) — true to the article's "non-sensitive settings in config files" rule.
- The `ADMIN_PIN: "1234"` default is the article's "hardcoded credentials" anti-pattern.

**Watch-outs**
- Screenshots that show config — be careful in PR videos / Loom recordings.
- The article warns about secrets in client-side JavaScript explicitly. That's exactly the current bug.
- A future Python service should read from `.env`, not from a Python module. `api/clickup/server.py` already does this correctly.

---

## 15. Logging & Observability

**URL:** https://alanknox.com/logging-observability-engineering-for-vibe-coders/

**What it says**
- Plan before coding: which events, inputs, metrics to track.
- Use structured logging (consistent key-value, not free-form text) at info/warning/error/debug levels.
- Three observability pillars: metrics, tracing, alerts.
- Define metric thresholds for success/failure indicators early.
- Make logs accessible — decide on storage/display upfront.
- Don't build "black box" prototypes without internal visibility.

**How it applies**
- Pairs with the existing #5 ("Aggregate Logs") to form the monitoring story for the hub.
- Today: nginx `access.log` (line-based, not structured) + `journalctl -u clickup-fees | -u valuation-api`. No structured logging on the FastAPI services.
- v4 §5.4 / §21.1 Phase A: Netdata gives metrics; Phase B Prometheus adds proper observability.
- Tracing is *not* needed at current scale (one VM, ≤ 5 services). Skip the temptation to add OpenTelemetry until there's a real reason.

**Watch-outs**
- Structured logging is cheap to add to a new FastAPI service (`structlog` or stdlib `logging` with a JSON formatter). The transcoder worker should ship with this from day one — easier than retrofitting.
- The "metrics thresholds" rule is what v4 §5.4 actually does (CPU > 80 %, disk > 75 %, etc.) — confirms the choice.
- The article's "make logs accessible" warning: nginx logs are root-only today (SESSION_15 §2.7). A future Phase A item is making them readable by `tech-admin` or the future Netdata collector.

---

## 16. Performance & Scalability Testing

**URL:** https://alanknox.com/performance-scalability-testing-engineering-for-vibe-coders/

**What it says**
- Define expected load scenarios before coding (e.g., "10 users, 50 requests/minute").
- Identify critical functions that must stay responsive under stress.
- Set input size limits as defaults to prevent crashes from heavy inputs.
- Sketch growth projections early — ask how latency changes if user count doubles.
- Three testing types: load testing (expected), stress testing (breaking points), capacity planning (forecasting).
- Plan acceptable failure points before stress testing begins.

**How it applies**
- This is what **v4 §4 (Capacity Model)** and **§17 (Capacity Impact of Adding Video)** are. The article validates the structure (load envelopes, scenarios, projections).
- The "input size limits" rule is already followed: nginx `client_max_body_size 160m`, FastAPI `MAX_VIDEO_BYTES = 150 * 1024 * 1024`.
- The 200-staff / ~75 concurrent number in SESSION_15 §1 and v4 §4 *is* the "expected load scenario" the article calls for.
- The "how does latency change if user count doubles?" question is what justifies the 8 vCPU / 16 GiB Option 1 resize.

**Watch-outs**
- Article says "spend minutes planning before coding to prevent hours of debugging later". This *is* the value of v4 — but v4 is planning, not the actual load test. Before declaring the hub firm-wide live, run a synthetic load test (e.g., `wrk` or `k6`) against `https://hub.treppides.com` to validate the model's claim of 5–15 % CPU at 75 concurrent.
- Stress test should target the bottleneck: BookStack page rendering, not nginx. A test that just hits `/` won't reveal anything.

---

## 17. Automated Testing

**URL:** https://alanknox.com/automated-testing-engineering-for-vibe-coders/

**What it says**
- Plan tests before coding — sketch testing outlines during design.
- Start with unit tests — small, isolated, runs in milliseconds.
- **Turn every bug into a regression test** — prevent the same bug from coming back.
- Identify integration seams (function-to-function, service-to-service) — that's where most bugs hide.
- Define core system properties that must always be true ("totals never negative").
- Plan fuzz testing for external inputs (untrusted data, files, API responses).

**How it applies**
- The hub has **zero automated tests today**. The architecture (vanilla JS frontend, FastAPI backend, BookStack as the source of truth) makes testing harder than average — but not impossible.
- Realistic starting points for the hub:
  - FastAPI services: `pytest` + `httpx.AsyncClient` against the running app. Test `/api/clickup/fees` returns the expected shape; `/api/valuation/editions` returns 6 editions.
  - File upload validation: unit test `Path(filename).suffix.lower() in ALLOWED_*` (and after v4 §9.1 lands, the content-based MIME check).
  - Valuation reference: `seed_database.py` already runs end-to-end on every deploy — that's a de facto integration test.
- "Turn every bug into a regression test" — the AML breakdown bug (Session 10) should have produced a unit test against `breakdownField` per list. Worth adding now.

**Watch-outs**
- Don't gold-plate. The article emphasises starting with unit tests in milliseconds. A 30-second test suite is fine; a 5-minute one will be skipped.
- Tests against BookStack require a test instance — don't run integration tests against the live MariaDB. The Docker stack makes this easy: spin up a second `bookstack-test` container.

---

## 18. Security-First Coding

**URL:** https://alanknox.com/security-first-coding-engineering-for-vibe-coder/

**What it says**
- Map data flows before coding — what's collected, where it goes, who can see it.
- Externalise secrets immediately — never hard-code, even temporarily.
- Validate all inputs early; define accepted formats, lengths, types in scaffolding.
- Apply least-privilege access — separate test DBs, limited-permission accounts.
- Design secure defaults: deny unknown requests, require auth even in dev, mask sensitive data in logs.
- The habits you form in your prototype become the architecture of your product.

**How it applies**
- Backstops the entire **Part 2 (§§7–12) of v4**. Every High finding is a violation of one of this article's rules:
  - ADMIN_PIN = default → "secure defaults"
  - Token in config.js → "externalise secrets"
  - BookStack 0.0.0.0 → "least-privilege access" (no external client should reach the DB-layer port)
  - allow_origins=* → "deny unknown requests"
- The 10-minute pre-prototype checklist the article gives is a good template for any future hub feature: who reads/writes what, where do secrets live, what's the input format, what does the AI tool see, what gets logged.

**Watch-outs**
- "The habits you form in your prototype become the architecture of your product" — this is exactly how the hub ended up with ADMIN_PIN=1234 in production. Same warning applies to any future feature.
- The BookStack token's read-only label in the `config.js` comment (v4 §8.3) was wrong — that's an example of "secure defaults assumed, not verified". Document the actual scope of every credential.

---

## 19. Alerting & Error Notifications

**URL:** https://alanknox.com/alerting-error-notifications-engineering-for-vibe-coders/

**What it says**
- Classify errors before prototyping: immediate-action, later-investigation, no-action.
- Define alert thresholds tied to user/business impact, not arbitrary numbers.
- Assign clear ownership — who receives, what they do, response time.
- Apply the "2 a.m. test": would this notification justify waking someone?
- Logs are passive; alerts are active. Don't conflate them.
- Don't alert on every exception — creates fatigue and trains teams to ignore alerts.

**How it applies**
- Directly maps to **v4 §5.4 alert thresholds** (CPU > 80 % 5 min, disk > 75 %, any service exit, cert < 30 days). All pass the 2 a.m. test except disk > 75 %, which is more of a "next business day" item — worth differentiating severity.
- Currently no alerting at all. The IT team is the only oncall channel — phone/email — and the hub doesn't push to anything.
- Netdata can email alerts; for the hub's size, that's enough. No PagerDuty needed.

**Watch-outs**
- The "alert on every exception" anti-pattern is what some Sentry-style integrations default to. If we ever add Sentry, configure error-rate thresholds, not per-exception notifications.
- "Cert expiry < 30 days" is the textbook 2 a.m. test failure — it's *not* a 2 a.m. issue at 30 days, but it *is* at 7 days. Use staggered thresholds.

---

## 20. Timeouts & Circuit Breakers

**URL:** https://alanknox.com/timeouts-circuit-breakers-engineering-for-vibe-coders/

**What it says**
- Establish timeout values *before* coding, based on acceptable latency, not averages.
- Identify all external dependencies; assign timeouts per dependency.
- Wrap each dependency in a circuit breaker to prevent cascading failures.
- Circuit breakers operate in phases: detect failures → trip and block → allow test calls after recovery.
- Plan retry rules with backoff limits (don't worsen the failing service's load).
- Document fallback behaviour for when breakers trip.

**How it applies**
- The hub has three external dependencies on the server side: ClickUp API (`clickup-fees`), Damodaran archive (manual refresh), Frankfurter FX (manual refresh). And in the browser: BookStack via the proxy.
- `clickup-fees` already uses `requests.get(url, ...)` without an explicit timeout — **bug**. Default timeout is None (infinite). If ClickUp hangs, the FastAPI worker blocks. Quick fix: `requests.get(url, ..., timeout=(5, 30))` (5 s connect, 30 s read).
- v4 nginx `proxy_read_timeout 30s` on `/api/clickup/` (per the current config) prevents the *browser* from hanging, but doesn't prevent the *backend* worker from being stuck — both layers need timeouts.
- A circuit breaker around ClickUp is *probably* overkill — but the existing 5-minute cache effectively acts as one: stale data is served if ClickUp is down (which is a graceful degradation, even if unintentional).

**Watch-outs**
- The "retries without limit worsen the failing service" warning is real for ClickUp. If a ClickUp rate-limit kicks in, retrying immediately just locks us out further. Pair retry with backoff (Retry Strategies, entry #3).
- BookStack proxy (v4 §8.3) needs a timeout too: if BookStack hangs, every hub page that fetches a wiki article hangs with it. 30 s is the right read timeout.

---

## 21. Latency Is a Feature, Not Just a Metric

**URL:** https://alanknox.com/latency-is-a-feature-not-just-a-metric/

**What it says**
- Cache frequent queries; precompute common responses ahead of user requests.
- Stream to show progress and reduce perceived wait.
- Optimise model and prompt for speed from the start (applies to AI; analogue: optimise SQL and ORM calls).
- Treat latency as a design feature, not an afterthought.
- 10 seconds is acceptable in a demo, never in production.
- The gap between demo and production is invisible scaffolding that doesn't survive.

**How it applies**
- The hub's caching choices (entry #11) are exactly what the article prescribes.
- HLS streaming (v4 §14) is the article's "stream to show progress" rule, applied to video.
- BookStack page-render latency is the slow piece (200–400 ms uncached, 30–50 ms warm). Worth profiling once load testing happens — if a user hits a "cold" page, they wait. MariaDB query cache should be warmed by default.
- The valuation tool's PDF export is the longest user-visible latency (5–15 s depending on report). Currently shows a spinner, which is the right pattern, but could be faster if `html2canvas` rendering is incremental.

**Watch-outs**
- 10-second wait is the threshold the article calls out. Hub interactions are well under this *except* PDF export and (future) video transcode. Both should show progress, not a spinner.
- "Demo conditions don't survive production" — relevant to v4 §4. The capacity numbers there are calibrated against benchmarks, not measured under firm-wide load. Validate with synthetic load (entry #16) before declaring the model correct.

---

## 22. Data Validation

**URL:** https://alanknox.com/data-validation-engineering-for-vibe-coders/

**What it says**
- Map all input sources first (users, APIs, DB, AI models).
- Define validation rules upfront: type, required, range, format.
- Validate external outputs (AI/API responses) explicitly before downstream use.
- Five validation layers: type, range/length, format, required-vs-optional, business rules.
- Start lightweight (built-in type checks, regex) before adding libraries.
- Return meaningful errors; don't fail silently.

**How it applies**
- Directly informs **v4 §9.1** (content-based MIME validation on uploads — currently extension-only).
- Already partially followed in the valuation tool: country/currency/edition values are validated against the SQLite tables before being used. Invalid input returns 404, not 500.
- `clickup-fees` parsing of ClickUp responses (the `resolve_dropdown`, `resolve_labels`, `resolve_date` helpers in `server.py`) is exactly the "validate external API outputs" rule — confirmed correct.

**Watch-outs**
- The article's "don't fail silently" rule: today's valuation FX fallback (Session 12) silently uses the most recent prior date when the exact date isn't available. The UI doesn't surface this. Open follow-up #1 in SESSION_12.
- Five validation layers — the upload path checks one (file extension). Adding type/size/format/business layers is roughly half a day of work and would close the §9.1 gap fully.

---

# Cross-reference — second pass

| Decision in the project | Articles that reinforce it |
|---|---|
| BookStack token proxy + audit log (v4 §8.3, §11.4) | 13. Auth vs Authz · 14. Config & Secrets · 18. Security-First Coding |
| Backup design (v4 §3.1, §5.3, §23.2) | 10. Backups & Data Recovery |
| Caching choices (clickup-fees 5-min, nginx /media/ 7d, video segments 24h) | 11. Caching · 21. Latency Is a Feature |
| Transcoder idempotency + retries (v4 §15.5) | 12. Idempotency · 3. Retry Strategies (first pass) |
| Capacity model for 200 staff (v4 §4, §17) | 16. Performance & Scalability Testing · 21. Latency Is a Feature |
| Alert thresholds (v4 §5.4, §21.1) | 19. Alerting & Error Notifications · 15. Logging & Observability |
| SQL safety in FastAPI services | 8. SQL Injection · 22. Data Validation |
| Upload MIME validation (v4 §9.1) | 22. Data Validation |
| DNS planning for media-srv (v4 §19 step 3) | 9. DNS & Domain Management |
| External-API timeouts (ClickUp, Damodaran, FX) | 20. Timeouts & Circuit Breakers |
| Future automated test suite | 17. Automated Testing |
| Phase A security fixes overall (v4 §§7–12) | 18. Security-First Coding (umbrella) |

---

# Articles reviewed and rejected (second pass)

These titles were considered but determined not to materially apply to
the hub's active decisions. Recording them so a future maintainer
doesn't waste time re-evaluating:

- "Five Questions Before You Deploy an AI Agent" — agent-specific; no agents in the hub.
- "Data Contracts" — relevant if/when the hub talks to other in-house services with formal schemas. Not today.
- "Database Indexes" — SQLite tables are small enough (Damodaran <1 MB, sessions DB future) that indexes are not the bottleneck. Revisit if a future table grows past ~100k rows.
- "Database Migrations" — Session 13 already followed the right pattern (add `edition` column, backfill). No new migration tooling needed for current scale.
- "Serverless" — the hub is explicitly self-hosted; no serverless component planned.
- "Webhooks" — no incoming webhooks today.
- "Production Thinking", "System Design", "Trade-Offs & Constraints", "Separation of Concerns", "Component Architecture", "Frontend vs Backend" — generic engineering posts whose advice is already implicit in v4 / SESSION_15. Not enough new signal to justify a dedicated entry.
- "Cost Observability", "License Management" — applies to AI-cost tracking, not relevant.
- "CI/CD & Deployment Discipline" — the hub's "edit, push, hard-refresh" model is intentional (no build step). The article advocates for staging environments and tested releases, which is the *right* call long-term but requires architectural change. Defer.
- "Long-Running Processes", "State Management", "Threading & Parallelism", "Messaging Queues" — overlap with the Background Jobs + Race Conditions entries (first pass); marginal additional value.
- "Edge Case Thinking", "Graceful Degradation", "Mock External Services", "Batching Operations", "Event Handling" — general advice; nothing the hub specifically does or plans to do.
- "Performance Monitoring", "Auditing" — covered by Logging & Observability + Alerting entries.
- "Error Handling" — every FastAPI service already uses FastAPI's built-in `HTTPException`; correct pattern.
- "Deployment Targets" — Option 1 (single VM) is the deployment target. Article doesn't add to v4 §18.
- "Testing in Production" — risky pattern that requires feature flags and rollback infra the hub doesn't have. Out of scope.
- "Configuration Files" (the older article, distinct from Configuration Management & Secrets) — duplicative.
- "Browser Developer Tools", "Development Environments (IDEs)" — generic developer hygiene; not project-specific.
- "AI Strategy" / "ROI" / "Hype" / "Customer Experience" / "I Wish AI Could…" entire series — business commentary, not engineering.
- "AI-Powered X" strategic implementation guides — none of these features are planned for the hub.
- "Run Your Logging Platform on a Separate Server" — true in principle but over-engineered for current scale; revisit when Option 2 lands.

The full triage covered all 25 pages (~225 articles). The 22 entries
in this file are the ones with concrete project relevance. The
remainder are reviewed-and-rejected above or were never close to the
cut line.

---

## How to use this file

- **When planning a new feature**, scan the cross-reference table for any article that touches the area; read its 4–6 bullets before writing code.
- **When reviewing a PR**, the "Watch-outs" sections double as a code-review checklist for the relevant area.
- **When debugging a production issue**, the monitoring / logging articles (5 and 6) are the first stop.
- This file is intentionally short and curated. Resist the urge to dump in every article — the value is in the filtering.
