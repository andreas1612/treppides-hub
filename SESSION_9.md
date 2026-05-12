# Session 9 — Social Media Style Announcements

> Pull this file on the server, then follow each priority in order.
> Every change is independent — stopping mid-session won't break anything live.

---

## Project context

**Repo:** https://github.com/andreas1612/treppides-hub
**Server:** ssh -i ~/id_ed25519 tech-admin@192.168.0.221
**Live URL:** https://hub.treppides.com
**Stack:** Vanilla HTML/CSS/JS, no build step. nginx serves ~/treppides-hub directly.
**Deploy after every change:** `cd ~/treppides-hub && git pull` then hard-refresh browser.

**File structure (after session 8 refactor):**
```
components/
  shell/   → sidebar.js, topbar.js, admin.js, support.js
  pages/   → aml.js, fees.js, knowledgebase.js, projects.js, reader.js, staff.js
  widgets/ → announcements.js, policies.js, training.js, quicklinks.js
styles/
  pages/   → aml.css, fees.css, knowledgebase.css, reader.css, staff.css
api/
  bookstack.js
  clickup/server.py   ← FastAPI backend (systemd: clickup-fees)
```

---

## Goal

Transform the announcements section into a LinkedIn/Facebook style social feed.
- Admin panel (PIN-protected sidebar button) is the ONLY place to publish content
- Posts can include: text, multiple images, OR a video (upload ≤150MB OR YouTube/Vimeo link)
- Feed displays media inline — no download prompts, no external clicks needed
- Cards redesigned as social posts: full-width media hero → title → text → date

---

## Priority 1 — Server: media upload infrastructure

### 1a — Create media directories on the server

```bash
mkdir -p ~/treppides-hub/media/images
mkdir -p ~/treppides-hub/media/videos
chmod 755 ~/treppides-hub/media
```

### 1b — Add /media/ to nginx config

Edit `~/treppides-hub/nginx-treppides-hub.conf` — add this block inside the HTTPS server block,
before the closing `}`:

```nginx
# Media uploads — images and videos served as static files
location /media/ {
    alias /home/tech-admin/treppides-hub/media/;
    expires 7d;
    add_header Cache-Control "public, immutable";

    # Allow video streaming (range requests)
    add_header Accept-Ranges bytes;

    # Security — no script execution in uploads folder
    location ~* \.(php|py|sh|pl|rb)$ {
        deny all;
    }
}
```

Deploy nginx config:
```bash
sudo cp ~/treppides-hub/nginx-treppides-hub.conf /etc/nginx/sites-enabled/treppides-hub
sudo nginx -t && sudo systemctl reload nginx
```

### 1c — Add upload endpoint to FastAPI backend

Edit `~/treppides-hub/api/clickup/server.py`.

Add these imports at the top (after existing imports):
```python
import uuid
import shutil
from pathlib import Path
from fastapi import UploadFile, File, Form
```

Add these constants after the existing config section:
```python
MEDIA_ROOT       = Path(__file__).parent.parent.parent / "media"
MAX_IMAGE_BYTES  = 20  * 1024 * 1024   # 20 MB per image
MAX_VIDEO_BYTES  = 150 * 1024 * 1024   # 150 MB per video
ALLOWED_IMAGES   = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
ALLOWED_VIDEOS   = {".mp4", ".mov", ".webm"}
```

Add these two endpoints (paste before the `if __name__` block or at end of file):

```python
@app.post("/api/upload/image")
async def upload_image(file: UploadFile = File(...)):
    """Upload an image. Returns { url, filename }."""
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_IMAGES:
        raise HTTPException(status_code=400, detail=f"File type {ext} not allowed. Use: {ALLOWED_IMAGES}")

    # Read and size-check
    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail=f"Image exceeds 20 MB limit.")

    # Save with unique name to avoid collisions
    fname   = f"{uuid.uuid4().hex}{ext}"
    dest    = MEDIA_ROOT / "images" / fname
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)

    return {"url": f"/media/images/{fname}", "filename": file.filename}


@app.post("/api/upload/video")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video (≤150 MB). Returns { url, filename }."""
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_VIDEOS:
        raise HTTPException(status_code=400, detail=f"File type {ext} not allowed. Use: {ALLOWED_VIDEOS}")

    data = await file.read()
    if len(data) > MAX_VIDEO_BYTES:
        raise HTTPException(status_code=413, detail=f"Video exceeds 150 MB limit.")

    fname = f"{uuid.uuid4().hex}{ext}"
    dest  = MEDIA_ROOT / "videos" / fname
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)

    return {"url": f"/media/videos/{fname}", "filename": file.filename}
```

Restart the service:
```bash
sudo systemctl restart clickup-fees
sudo systemctl status clickup-fees --no-pager
# Smoke test:
curl -s https://hub.treppides.com/health
```

---

## Priority 2 — Admin panel redesign (components/shell/admin.js)

Replace the entire Publish panel section with a social-style composer.
The Manage tab stays exactly as-is — only the Publish tab changes.

Key changes to `buildAdminModal()`:
- Replace the plain textarea with a styled composer area
- Add three media buttons: Photo, Video (upload), Video (YouTube link)
- Show image preview grid when images are selected
- Show video preview player when video is selected or URL pasted
- On publish: upload media first → get URLs → embed in page HTML → create BookStack page

### New publish flow logic (in handlePublish):

```
1. User fills title + text
2. User optionally attaches images OR a video (upload or URL)
3. On "Publish" click:
   a. If images selected:
      - POST each to /api/upload/image
      - Collect returned URLs
      - Build HTML: <div class="hub-media-grid">
                      <img src="URL" ...> for each
                    </div>
                    <div class="hub-post-body">TEXT</div>
   b. If video file selected:
      - POST to /api/upload/video
      - Build HTML: <div class="hub-media-video">
                      <video controls preload="metadata" src="URL"></video>
                    </div>
                    <div class="hub-post-body">TEXT</div>
   c. If YouTube/Vimeo URL entered:
      - Convert to embed URL (extract video ID)
      - Build HTML: <div class="hub-media-video">
                      <iframe src="EMBED_URL" allowfullscreen ...></iframe>
                    </div>
                    <div class="hub-post-body">TEXT</div>
   d. If no media:
      - Build HTML: <div class="hub-post-body">TEXT</div>
4. POST to BookStack createPage(bookId, title, html)
5. Show success, clear form, trigger announcements refresh
```

### YouTube URL converter (add as helper function in admin.js):

```js
function youtubeEmbedUrl(url) {
  // Handles: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID
  const patterns = [
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return `https://www.youtube.com/embed/${m[1]}?rel=0`;
  }
  // Vimeo
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}
```

### Auto-refresh after publish:
After successful publish, call `window.__hub_announcements?.refresh()`.
This global is exposed by announcements.js (see Priority 3).

---

## Priority 3 — Announcements feed redesign (components/widgets/announcements.js)

### 3a — Expose refresh global

At the bottom of `init()`, add:
```js
window.__hub_announcements = { refresh: load };
```

### 3b — Media parser helper

Add this function to announcements.js:

```js
/**
 * Parse a BookStack page's HTML and extract media for inline display.
 * Returns { type: 'images'|'video'|'none', images: [], videoHtml: '' }
 */
function extractMedia(html) {
  if (!html) return { type: "none", images: [], videoHtml: "" };

  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  // Check for video (uploaded .mp4/.webm or iframe embed)
  const video  = tmp.querySelector("video");
  const iframe = tmp.querySelector("iframe");

  if (video) {
    return {
      type: "video",
      videoHtml: `<video class="post-video" controls preload="metadata"
                         src="${escapeHtml(video.src || video.getAttribute("src") || "")}">
                  </video>`,
    };
  }

  if (iframe) {
    const src = iframe.src || iframe.getAttribute("src") || "";
    return {
      type: "video",
      videoHtml: `<div class="post-iframe-wrap">
                    <iframe src="${escapeHtml(src)}" frameborder="0"
                            allow="accelerometer; autoplay; clipboard-write;
                                   encrypted-media; gyroscope; picture-in-picture"
                            allowfullscreen></iframe>
                  </div>`,
    };
  }

  // Check for images
  const imgs = [...tmp.querySelectorAll("img")].map(i => i.src || i.getAttribute("src")).filter(Boolean);
  if (imgs.length) {
    return { type: "images", images: imgs };
  }

  return { type: "none", images: [], videoHtml: "" };
}
```

### 3c — New card HTML (replace cardHtml function)

```js
function cardHtml(page) {
  const title   = page.name || "Untitled";
  const date    = formatDate(page.updated_at);
  const rawHtml = page.preview_html?.content || "";
  const media   = extractMedia(rawHtml);

  // Strip HTML tags for text excerpt
  const tmp = document.createElement("div");
  tmp.innerHTML = rawHtml;
  // Remove media elements so excerpt is text-only
  tmp.querySelectorAll("video,iframe,img,.hub-media-grid,.hub-media-video").forEach(el => el.remove());
  const excerpt = (tmp.textContent || "").trim().slice(0, 160);

  // Build media block
  let mediaHtml = "";
  if (media.type === "video") {
    mediaHtml = `<div class="post-media">${media.videoHtml}</div>`;
  } else if (media.type === "images" && media.images.length === 1) {
    mediaHtml = `<div class="post-media">
                   <img class="post-img-single" src="${escapeHtml(media.images[0])}" alt="" loading="lazy">
                 </div>`;
  } else if (media.type === "images" && media.images.length > 1) {
    const grid = media.images.slice(0, 4).map(src =>
      `<img class="post-img-grid-item" src="${escapeHtml(src)}" alt="" loading="lazy">`
    ).join("");
    mediaHtml = `<div class="post-media post-img-grid post-img-grid-${Math.min(media.images.length, 4)}">${grid}</div>`;
  }

  return `
    <article class="post-card">
      ${mediaHtml}
      <div class="post-card-body">
        <h3 class="post-title">
          <a class="reader-link" href="#"
             data-page-id="${page.id}"
             data-page-name="${escapeHtml(title)}"
             data-book-id="${CONFIG.ANNOUNCEMENTS_BOOK_ID}"
             data-book-name="Announcements">
            ${escapeHtml(title)}
          </a>
        </h3>
        <div class="post-meta">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8"  y1="2" x2="8"  y2="6"/>
            <line x1="3"  y1="10" x2="21" y2="10"/>
          </svg>
          ${escapeHtml(date)}
        </div>
        ${excerpt ? `<p class="post-excerpt">${escapeHtml(excerpt)}</p>` : ""}
        <div class="post-card-footer">
          <a class="post-read-more reader-link" href="#"
             data-page-id="${page.id}"
             data-page-name="${escapeHtml(title)}"
             data-book-id="${CONFIG.ANNOUNCEMENTS_BOOK_ID}"
             data-book-name="Announcements">
            Read more →
          </a>
        </div>
      </div>
    </article>`;
}
```

### 3d — Increase announcement count
Change `fetchPages(CONFIG.ANNOUNCEMENTS_BOOK_ID, 5)` → `fetchPages(CONFIG.ANNOUNCEMENTS_BOOK_ID, 10)`

### 3e — Change grid to feed layout
In the load() function, change:
```js
cardsEl.innerHTML = `<div class="cards-grid">${pages.map(cardHtml).join("")}</div>`;
```
to:
```js
cardsEl.innerHTML = `<div class="post-feed">${pages.map(cardHtml).join("")}</div>`;
```

---

## Priority 4 — CSS for social feed (styles/widgets/announcements.css)

Create new file `styles/widgets/announcements.css` and add a link in `index.html`:
```html
<link rel="stylesheet" href="styles/widgets/announcements.css" />
```

File contents:

```css
/* ============================================================
   announcements.css — Social media style post feed
   ============================================================ */

/* --- Feed container --- */
.post-feed {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 680px;
}

/* --- Post card --- */
.post-card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow);
  transition: box-shadow var(--transition);
}
.post-card:hover {
  box-shadow: var(--shadow-hover);
}

/* --- Media area --- */
.post-media {
  width: 100%;
  background: #000;
  max-height: 480px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Single image */
.post-img-single {
  width: 100%;
  max-height: 480px;
  object-fit: cover;
  display: block;
}

/* Image grid (2–4 images) */
.post-img-grid {
  display: grid;
  gap: 2px;
  max-height: 400px;
}
.post-img-grid-2 { grid-template-columns: 1fr 1fr; }
.post-img-grid-3 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
.post-img-grid-3 .post-img-grid-item:first-child { grid-row: 1 / 3; }
.post-img-grid-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }

.post-img-grid-item {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  min-height: 140px;
}

/* Uploaded video */
.post-video {
  width: 100%;
  max-height: 480px;
  display: block;
  background: #000;
}

/* YouTube / Vimeo iframe */
.post-iframe-wrap {
  position: relative;
  width: 100%;
  padding-bottom: 56.25%; /* 16:9 */
  background: #000;
}
.post-iframe-wrap iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
}

/* --- Card body --- */
.post-card-body {
  padding: 18px 20px 16px;
}

.post-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px;
  line-height: 1.35;
}

.post-title a {
  color: inherit;
  text-decoration: none;
}
.post-title a:hover {
  color: var(--accent);
}

.post-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 10px;
}
.post-meta svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}

.post-excerpt {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 14px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.post-card-footer {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  margin-top: 4px;
}

.post-read-more {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  text-decoration: none;
}
.post-read-more:hover {
  text-decoration: underline;
}
```

---

## Priority 5 — Admin panel media composer UI (components/shell/admin.js)

Replace the existing Publish panel HTML inside `buildAdminModal()`.
Key new elements:

```html
<!-- Media type selector -->
<div class="hub-media-btns" id="hub-media-btns">
  <button class="hub-media-btn" id="hub-media-photo-btn" type="button">
    📷 Photo
  </button>
  <button class="hub-media-btn" id="hub-media-video-btn" type="button">
    🎥 Video
  </button>
  <button class="hub-media-btn" id="hub-media-yt-btn" type="button">
    🔗 YouTube / Vimeo
  </button>
</div>

<!-- Hidden inputs (shown when corresponding button clicked) -->
<div id="hub-photo-area" hidden>
  <input type="file" id="hub-photo-input" accept="image/*" multiple hidden>
  <label for="hub-photo-input" class="hub-file-label">Choose images…</label>
  <div class="hub-photo-previews" id="hub-photo-previews"></div>
</div>

<div id="hub-video-area" hidden>
  <input type="file" id="hub-video-input" accept="video/mp4,video/mov,video/webm" hidden>
  <label for="hub-video-input" class="hub-file-label">Choose video (max 150 MB)…</label>
  <div id="hub-video-preview"></div>
</div>

<div id="hub-yt-area" hidden>
  <input class="hub-input" id="hub-yt-input" type="url"
         placeholder="https://www.youtube.com/watch?v=...">
  <div id="hub-yt-preview"></div>
</div>
```

**Image preview logic:**
When images selected, show thumbnail grid using `URL.createObjectURL()`.
Max 4 images per post (show count badge if more selected, only use first 4).

**Video preview logic:**
When video selected, show `<video>` tag with `src=URL.createObjectURL(file)`.
Show file size. If > 150MB, show error and clear input.

**YouTube preview logic:**
On input blur/enter, call `youtubeEmbedUrl(value)`. If valid, show `<iframe>` preview.

---

## Priority 6 — .gitignore update

Add media uploads to .gitignore so large files are never committed:

```bash
echo "media/images/" >> ~/treppides-hub/.gitignore
echo "media/videos/" >> ~/treppides-hub/.gitignore
git add .gitignore && git commit -m "gitignore: exclude uploaded media from version control"
git push
```

---

## Deploy checklist (run after all code changes are pushed)

```bash
cd ~/treppides-hub && git pull

# Reload nginx (only needed for nginx config change)
sudo cp ~/treppides-hub/nginx-treppides-hub.conf /etc/nginx/sites-enabled/treppides-hub
sudo nginx -t && sudo systemctl reload nginx

# Restart FastAPI (only needed for server.py change)
sudo systemctl restart clickup-fees

# Smoke tests
curl -s https://hub.treppides.com/health
curl -s https://hub.treppides.com/media/  # should return 403 (dir listing disabled)
```

Then hard-refresh https://hub.treppides.com (`Ctrl+Shift+R`).

---

## Critical rules — do not touch

- `config.js` — gitignored, only on server. Never commit.
- `vendor/` — Chart.js local bundle. No CDN.
- `/etc/nginx/ssl/` — SSL certs. Never move.
- `api/clickup/.env` — ClickUp credentials. Never commit.
- Mobile nav — out of scope.
- Policies, Training, Staff, AML, KB, Reader, Fees — do not modify these this session.
