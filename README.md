# Yatin Sharma — Portfolio

A fast, single-page portfolio built with **vanilla HTML / CSS / JS** — the same tech and the same dark glassmorphism design language as the reference site, but clean (≈67 KB total, zero inlined images).

Live data integrations (all client-side, no build step):
- **GitHub** — profile stats + recent repos (auto)
- **Last.fm** — scrobble stats + top tracks (`YATINSHARMA`)
- **AniList** — anime list (`YatinSharma1303`)
- **YouTube** — embedded music player (Tsuisou · Michiru Oshima)

---

## Run locally
```bash
cd yatin-portfolio
python3 -m http.server 8000
# open http://localhost:8000
```
Any static server works. No `npm install`, no build.

## Deploy
Push the folder to GitHub and import it on **Vercel** or **Netlify** (framework: *Other*, build command: none, output dir: project root).

---

## Customize

### Your info
Everything is in **`index.html`** (name, bio, quote, stack, interests) and the data arrays at the top of **`script.js`** (`SKILLS`, `PROJECTS`, `CONFIG`). Search-and-replace is easy.

### Images — currently placeholders
To keep the repo light and to avoid shipping other people's photos, project thumbnails use **CSS gradients with initials**. To use real images:

1. Drop image files into an `/assets` folder, e.g. `assets/smarthealthcare.png`.
2. In `script.js`, in the `PROJECTS` array, replace the `gradient` line of a project with an `img` key:
   ```js
   img: 'assets/smarthealthcare.png'
   ```
3. In the `projects()` render function, swap the gradient div for:
   ```html
   <img class="project-thumb" src="${p.img}" alt="${p.name}">
   ```
   (The `.project-thumb` class already styles it.)

Your GitHub avatar and AniList/Last.fm artwork are fetched live from those APIs — nothing to set up.

### Music track
`CONFIG.ytVideoId` in `script.js` (currently `y5PW7rqXUhk`). Change to any YouTube video ID. This is a legitimate embed — no copyrighted file is re-hosted.

### AMA box
This ships with the **full Telegram + Firestore backend** — visitors' questions reach you on Telegram, and your replies appear back on the site. Follow **`SETUP_TELEGRAM_FIRESTORE.md`** (the 4-part guide) to turn it on. It needs:

- A free **Firebase** project (Firestore) + the rules in `firestore.rules`
- A free **Telegram bot** (via BotFather)
- 5 **Vercel env vars** (all listed in the setup guide)

Until you add your Firebase `apiKey`/`projectId` to `CONFIG` in `script.js`, the AMA box gracefully degrades: if deployed, it still forwards questions to your Telegram via `/api/telegram`.

---

## File map
| File | What |
|---|---|
| `index.html` | Markup + SEO/OG meta |
| `style.css` | Full design system (dark/light, glassmorphism, responsive) |
| `script.js` | Preloader, music player, GitHub/Last.fm/AniList, skills, projects, AMA (Firestore), animations |
| `api/telegram.js` | Vercel fn — notifies you on Telegram when a question is submitted |
| `api/telegram-webhook.js` | Vercel fn — receives your Telegram replies, saves answers to Firestore (fail-closed secret) |
| `firestore.rules` | Firestore security rules (create-gated, read-only-if-answered, admin-only edit) |
| `SETUP_TELEGRAM_FIRESTORE.md` | Step-by-step setup for the AMA backend |

Everything is commented and organized by numbered sections. Theme (dark/light) is remembered via `localStorage`.
