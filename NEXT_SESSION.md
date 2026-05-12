# NEXT SESSION — Start Here

> **This is the entry point for every session.**
> Read this first, then follow the links for deeper context.

---

## Quick Orient

| What | Where |
|---|---|
| Full project context, tech stack, rules | [PROJECT_BRIEF.md](PROJECT_BRIEF.md) |
| Infrastructure, config, troubleshooting | [README.md](README.md) |
| Current live status of all services | [STATUS.md](STATUS.md) |
| Full VM provisioning (fresh install) | `bash SETUP.sh` |

**Server:** `ssh -i ~/id_ed25519 tech-admin@192.168.0.221`
**Hub live at:** https://hub.treppides.com ✅
**Repo:** `git@github.com:andreas1612/treppides-hub.git`

---

## Last Session — 2026-05-12 (Session 7)

**What was done:**
- HTTPS fully live — port 443 opened in UFW, DNS record added by IT
- Real Treppides logo deployed — `logo.png` replaces SVG globe in sidebar + mobile bar
- Favicon updated to green Treppides globe matching brand colours
- All cert files on server at `/etc/nginx/ssl/`

**Hub is fully live at https://hub.treppides.com as of end of session 7.**

---

## Session 8 — Full Restructure

This is a large session. Work through priorities in order — each is independent so
stopping mid-session won't break anything that currently works.

---

## Priority 1 — Fix Knowledge Base (it is currently broken)

**Problem:** `initKnowledgeBase` calls `fetchShelfBooks(57)` but the section shows nothing.
Likely cause: BookStack shelf 57 has no books assigned, or the API call is silently failing.

**Diagnose first — on the server:**
```bash
curl -s "http://localhost:6875/api/shelves/57" \
  -H "Authorization: Token TOKEN_ID:TOKEN_SECRET" | python3 -m json.tool
```
Replace TOKEN_ID and TOKEN_SECRET from `~/treppides-hub/config.js`.

**If the shelf is empty in BookStack:**
- Log into BookStack admin at https://hub.treppides.com/docs
- Assign all department books to shelf 57 (Shelves → edit shelf → add books)

**If the API call itself is failing:**
- Check the browser console at https://hub.treppides.com for the error
- Common cause: `config.js` on server still has the old HTTP base URL

---

## Priority 2 — Restructure Home Screen

**Current home screen (too cluttered — staff don't use most of it):**
```
Announcements → Policies → Training → Knowledge Base cards → Quick Links
```

**New home screen (clean, announcement-focused):**
```
Announcements (larger, more prominent)
Policies & Procedures (keep — staff use these)
Training & Development (keep)
Quick Actions bar (IT Support button + AML shortcut + Staff Directory shortcut)
```

**What gets removed from home:**
- Knowledge Base card grid → moved to its own dedicated section (see Priority 3)
- Staff Directory is already its own section ✅

**Files to edit:**
- `index.html` — remove `#section-knowledgebase` from the `.page-content` area
- `components/announcements.js` — increase count from 5 → 8, make cards wider/taller
- `components/quicklinks.js` — replace KB card with AML Dashboard and Staff Directory shortcuts
- `main.js` — remove `initKnowledgeBase` from the `Promise.allSettled` block on home load

---

## Priority 3 — Knowledge Base as Dedicated Page

**Goal:** Knowledge Base becomes its own full-page view (same pattern as Staff Directory and AML Dashboard).

**How it works now:**
- `knowledgebase.js` mounts into `#section-knowledgebase` inside `.page-content`
- It shows inline on the home scroll

**How it should work:**
- Knowledge Base gets its own section outside `.page-content` (like `#section-staff`)
- Sidebar "Knowledge Base" nav item calls `window.__hub_kb.show()` instead of scrolling
- Back button returns to home
- The department book cards are the same — just in a dedicated full-page view

**Files to edit:**
- `index.html` — add `<div id="section-kb">` alongside `#section-staff`, `#section-aml`, `#section-fees`
- `components/knowledgebase.js` — add `showKbPage()` / `hideKbPage()`, expose `window.__hub_kb`, add back button
- `styles/layout.css` — add `.kb-active` visibility rule (same pattern as `.staff-active`, `.aml-active`)
- `components/sidebar.js` — change KB nav click from `scrollIntoView` to `window.__hub_kb.show()`
- `main.js` — `await initAml(CONFIG)` block: add `await initKnowledgeBase(CONFIG)` in same pre-content group

---

## Priority 4 — Compliance Manual → Knowledge Base

**Problem:** The Compliance Manual lives in the Policies book (book ID 3) in BookStack but
has null/empty content. It belongs in the Knowledge Base shelf instead.

**Action required in BookStack admin (you do this, not code):**
1. Log into https://hub.treppides.com/docs as admin
2. Find the Compliance Manual page(s) in the Policies book
3. Move them to the appropriate department book on shelf 57
   (create a "Compliance" book on shelf 57 if one doesn't exist)
4. If the Compliance Manual is a full document (PDF), upload it as an attachment
   to a page in the KB instead of trying to paste the content

**Code change (after the BookStack move):**
- `components/policies.js` — reduce count from 3 → 3 (no change needed if compliance is gone)
- Verify the Policies section still shows the remaining actual policies

---

## Priority 5 — Projects Section Redesign

**Current:** Sidebar "Projects" links to `https://hub.treppides.com/projects` which is
an OpenProject placeholder that isn't deployed.

**New design:** A dedicated landing page (like AML Dashboard) with project cards.
Each card = a tool or initiative with a button that opens it. Easy to add more later.

**Initial cards to build:**
```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  📋 ClickUp     │  │  📁 SharePoint  │  │  ➕ Coming Soon │
│  Task tracking  │  │  File storage   │  │  Add project    │
│  [Open ClickUp] │  │  [Open SP]      │  │  (placeholder)  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

**Files to create/edit:**
- `components/projects.js` — new component, same page-view pattern as `aml.js`
  Data is a static array of `{ title, description, url, icon }` objects — no backend needed
- `index.html` — add `#section-projects` mount point
- `styles/` — add project card styles to `cards.css`
- `components/sidebar.js` — Projects nav click → `window.__hub_projects.show()`
- `main.js` — import and initialise `initProjects`

**Config for project URLs** (add to `config.js` on server, `config.example.js` in repo):
```js
CLICKUP_URL:    "https://app.clickup.com/...",
SHAREPOINT_URL: "https://treppides.sharepoint.com/...",
```

---

## Priority 6 — Admin Panel Improvements (for marketing team)

**Current problems:**
- Plain text only — no way to bold text, add bullets, insert images inline
- No image preview before publishing
- After publishing, the relevant section doesn't auto-refresh
- "Section" dropdown shows technical names, confusing for non-tech users
- No way to set a "featured" or "pinned" announcement

**Improvements to build:**

### 6a — Rich text toolbar (simple)
Add a minimal formatting bar above the textarea:
- **Bold**, *Italic*, • Bullet list — inject markdown-style tags that BookStack renders
- OR use a lightweight contenteditable div instead of textarea
- File: `components/admin.js`, `styles/modals.css`

### 6b — Image drag-and-drop
- Current file picker works but has no preview
- Add drag-and-drop zone with image thumbnail preview
- Show file size warning if image > 2MB
- File: `components/admin.js`

### 6c — Auto-refresh after publish
- After a successful publish, automatically call `load()` on the relevant section
- Expose a `window.__hub_announcements.refresh()` / `window.__hub_policies.refresh()` global
  (same pattern as `window.__hub_fees`, `window.__hub_staff`)
- File: `components/announcements.js`, `components/policies.js`, `components/training.js`, `components/admin.js`

### 6d — Friendly section names + descriptions in dropdown
```
Announcements     — Visible to all staff on the home screen
Policies & Procedures — Company rules and compliance documents
Training & Development — Courses, guides, onboarding material
```

---

## Additional Suggestions (future sessions)

These are not blockers but worth planning:

| Idea | Value | Effort |
|---|---|---|
| **Pinned announcement** — one announcement always shown at top of home, admin can set it | High — marketing loves this | Medium |
| **Category badges** on announcements — Marketing / HR / IT / Finance tag on each card | Medium — helps staff find relevant news | Low |
| **"New" badge** on sidebar items — dot indicator when KB or Policies has content newer than X days | Medium — drives engagement | Low |
| **Search scoping** — search bar can filter to "Announcements only" or "Policies only" | Medium | Low |
| **Admin activity log** — simple list of last 10 publish/delete actions with timestamp | Low — audit trail | Medium |
| **OpenProject** — deploy at `/projects` once the card-based Projects page is live | High — Projects link goes nowhere | Medium (infra) |

---

## Critical Rules — Don't Forget

1. **Never `localhost` in frontend code** — always relative paths or `https://hub.treppides.com`
2. **`config.js` is gitignored** — only on the server at `~/treppides-hub/config.js`. Never commit it.
3. **BookStack token expires 15/08/2026** — rotate in BookStack admin → My Account → API Tokens
4. **No build step** — edit files, push, `git pull` on server, hard-refresh browser
5. **Chart.js is in `vendor/`** — do not switch to CDN
6. **SSL private key** — `/etc/nginx/ssl/treppides.key` only. chmod 600. Never move or copy.

---

## Page Pattern Reference

All dedicated pages follow the same pattern. Use this when building KB and Projects pages:

```
index.html     → add <div id="section-xxx"> outside .page-content
component.js   → showXxxPage() adds .xxx-active to .main
               → hideXxxPage() removes it
               → window.__hub_xxx = { show, hide }
layout.css     → .main.xxx-active .page-content { display: none }
               → .main.xxx-active #section-xxx  { display: block }
sidebar.js     → nav click calls window.__hub_xxx.show()
main.js        → await initXxx(CONFIG) before Promise.allSettled block
```

Existing examples: `staff.js`, `aml.js`, `fees.js`

---

## Service Health Check

```bash
sudo systemctl status nginx clickup-fees --no-pager
cd ~/bookstack && sudo docker compose ps
curl -sk https://hub.treppides.com/ | grep "<title>"
curl -sk https://hub.treppides.com/api/clickup/fees | python3 -m json.tool | head -5
```

---

*Update this file at the end of every session with what was done and what's next.*
