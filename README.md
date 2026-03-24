# Treppides Employee Hub

**Status: FRONTEND COMPLETE — DEMO READY**
**Blocked on: VPS provisioning by IT**

Internal company portal to replace SharePoint. Staff land here daily to access announcements, policies, training materials, and quick links to the knowledge base and project management tools.

---

## For the Team — Start Here

| Document | Purpose |
|---|---|
| **This file** | Quick-start and orientation |
| [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md) | Full technical reference — architecture, all TODOs, bug log, decisions, flag reference, handoff checklist. **Read this before touching any code.** |
| [`Hub_Proposal_v3.docx`](Hub_Proposal_v3.docx) | Original business proposal — background, scope, and stakeholder requirements |

---

## Run It Locally (30 seconds)

No install, no build step, no dependencies.

```bash
git clone https://github.com/Katsiolas/Treppides-Employee-Hub.git
cd Treppides-Employee-Hub
python -m http.server 8080
```

Open **http://localhost:8080** in your browser. That's it.

> Requires Python 3 (ships with most systems). On Windows, use Git Bash or the terminal in VS Code.

---

## What You'll See

The hub runs fully on **mock data** right now — no backend needed. You will see:

- Sidebar navigation with Treppides branding
- Latest Announcements, Policies, and Training cards (9 mock items total)
- Search bar in the topbar (searches mock content)
- Quick Links row — Knowledge Base and Projects show a "Coming Soon" modal (backend not yet live)
- 600ms skeleton loading animation on every page load (confirms loading states work)

---

## File Structure

```
hub/
├── index.html              Shell — loads CSS and main.js only
├── main.js                 Entry point — boots all components
├── config.js               All config and feature flags live here
├── favicon.svg             Treppides globe favicon
│
├── components/
│   ├── sidebar.js          Left nav + mobile burger menu
│   ├── topbar.js           Header bar + search
│   ├── announcements.js    Announcements feed
│   ├── policies.js         Policies feed
│   ├── training.js         Training feed
│   └── quicklinks.js       Quick access widgets
│
├── api/
│   ├── bookstack.js        All API calls (fetchPages, searchPages)
│   └── mock.js             Mock data — realistic Treppides content
│
├── utils/
│   ├── dom.js              Shared DOM helpers
│   └── format.js           Date and text formatting
│
└── styles/
    ├── theme.css           Brand colours — edit here to retheme
    ├── base.css            Reset and defaults
    ├── layout.css          App shell and responsive layout
    └── cards.css           Cards, skeletons, animations
```

---

## Three Flags to Know

All in [`config.js`](config.js). These control the environment state:

| Flag | Current value | What it does |
|---|---|---|
| `USE_MOCK` | `true` | Serves mock data instead of calling BookStack API |
| `ENV_LIVE` | `false` | Shows "Coming Soon" modals on KB and Projects links |
| `SEARCH_ENABLED` | `true` | Shows search bar in topbar |

**To go live:** set `USE_MOCK = false` and `ENV_LIVE = true` in `config.js`. No other changes needed.

---

## What's Blocked / Next Steps

1. IT provisions the VPS (Ubuntu Server LTS)
2. Deploy BookStack + MariaDB via Docker Compose
3. Configure Nginx + SSL (Let's Encrypt)
4. Insert real API tokens and book IDs into `config.js`
5. Flip `USE_MOCK = false` and `ENV_LIVE = true`

Full checklist in [`PROJECT_BRIEF.md → Handoff Triggers`](PROJECT_BRIEF.md#handoff-triggers).

---

## Editing the Brand / Theme

All colours are CSS custom properties in [`styles/theme.css`](styles/theme.css). Change values there — nothing else needs touching to retheme the entire hub.

Key colours: sidebar `#0a0a0a` · accent `#c8d400` · page bg `#f5f5f5`

---

*Built by Andreas Pieri · Vanilla HTML/CSS/JS · Zero dependencies*
