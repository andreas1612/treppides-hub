# New Session Prompt — Paste this to start

---

Continue the Treppides Hub project. Read these files before touching any code:

1. `NEXT_SESSION.md` — priorities and what was done last
2. `PROJECT_BRIEF.md` — full project context, stack, rules
3. `STATUS.md` — live service status and known issues

Server: `192.168.0.221` · User: `tech-admin` · Repo: `~/treppides-hub`

---

## This Session — Build These Three Features

### A — Staff Directory (`components/staff.js`)

Build a staff directory component for the hub dashboard.

**Data source:** `~/treppides-hub/staff.json` — converted from the employee Excel file
(`K.TREPPIDESCO LTD.xlsx` was scp'd to the server). Parse the Excel and produce a JSON array:
```json
[
  { "name": "...", "department": "...", "extension": "...", "email": "..." },
  ...
]
```

**Component requirements:**
- Mounts into `#section-staff` in `index.html`
- Section header consistent with other sections (same `.hub-section` / `.section-header` pattern)
- Department filter dropdown — selecting a department filters the cards
- Search input — filters by name in real time
- Staff cards: name (bold), department tag, phone extension, email
- Sidebar nav item: add "Staff Directory" with a person icon between Knowledge Base and Projects
- Wire into `main.js` boot sequence (after initSupport, alongside other content sections)
- Data loaded from `/staff.json` via `fetch()` — static file, no backend

**Style:** follow existing card/grid patterns in `styles/cards.css`. Add any staff-specific styles to a new `styles/staff.css`.

---

### C — Fees CSV Export (`components/fees.js`)

Add a CSV export button to the fees dashboard header (next to the existing Refresh button).

**Requirements:**
- Exports the currently visible data: filtered by active month tab AND current view mode (UBO/Company)
- Columns: all fields from `DRILL_COLUMNS` array already defined in `fees.js`
- Filename: `fees-{activeMonth}.csv` e.g. `fees-April-2026.csv`
- Pure frontend — `Blob` + `URL.createObjectURL` + `<a download>` — no backend changes
- Button label: "Export CSV" with a download icon, same style as `.btn-refresh`
- Only enabled when data is loaded (disabled during load/error states)

---

### D — Department Landing Pages (`components/reader.js`)

Replace the blank "select a page from the left" welcome screen when a user opens a book.

**Current state:** `renderBookView()` in `reader.js` shows a minimal welcome panel with just the book name, description, and page count.

**Requirements:**
- Show department description (already in `_book.description`)
- List all chapters with their page count (expand/collapse not needed here — just the list)
- Show the 3 most recently updated pages as clickable cards (use `updated_at` from `_book.contents`)
- Clicking a recent page card opens that page via `openPage()`
- No extra API calls — all data is already in the `fetchBook()` response (`_book.contents`)
- Keep the left nav sidebar as-is — only the right content panel changes
- Style within existing `styles/reader.css` — add a `.dept-landing` section

---

## Rules — Do Not Break These

1. **No `localhost` in frontend code** — use relative paths or server IP
2. **`config.js` is gitignored** — never commit it
3. **No build step** — vanilla JS/CSS/HTML only, ES modules, no npm
4. **No CDN dependencies** — bundle locally in `vendor/` if any lib is needed
5. **Existing patterns** — match `.hub-section`, `.section-header`, `.cards-grid`, `.card` exactly
6. **`escapeHtml()`** — always escape user-facing strings from API/JSON data (in `utils/dom.js`)

---

## Current Config Reference

```js
BASE_URL:              "http://192.168.0.221/docs"
CLICKUP_FEES_API:      "/api/clickup/fees"
ANNOUNCEMENTS_BOOK_ID: 58
POLICIES_BOOK_ID:      3
TRAINING_BOOK_ID:      59
DEPARTMENTS_SHELF_ID:  57
ENV_LIVE:              true
```

## File Structure Reference (relevant files)

```
components/          — one file per section
styles/              — one CSS file per component
utils/dom.js         — escapeHtml, renderSkeleton, renderError, renderEmpty
utils/format.js      — formatDate, excerptFromHtml
api/bookstack.js     — all BookStack API calls
config.js            — all config (gitignored)
index.html           — add mount divs here
main.js              — import and boot new components here
```
