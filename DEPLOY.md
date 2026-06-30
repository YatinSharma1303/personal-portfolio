# 🚀 Deploy Guide — Yatin Sharma Portfolio

A React + Vite + Tailwind site with a Firebase-backed "Ask Me Anything", hosted on Vercel.

---

## 1. Run it locally

```bash
npm install
cp .env.example .env     # then fill in your keys (see below)
npm run dev              # open http://localhost:5173
```

The site works WITHOUT keys — only the AMA database and Last.fm live stats stay
disabled until you add them.

---

## 2. Firebase setup (for "Ask Me Anything")

1. Go to <https://console.firebase.google.com> → **Add project**.
2. Build → **Firestore Database** → Create (Production mode).
3. Build → **Authentication** → Sign-in method → enable **Google**.
4. Project Settings (⚙) → **Your apps** → Web app → copy these into `.env`:
   - `apiKey`     → `VITE_FIREBASE_API_KEY`
   - `authDomain` → `VITE_FIREBASE_AUTH_DOMAIN`
   - `projectId`  → `VITE_FIREBASE_PROJECT_ID`
   - `appId`      → `VITE_FIREBASE_APP_ID`
5. Firestore → **Rules** tab → paste the contents of `firestore.rules` → **Publish**.
   (Already locked to `yatinsharma1303@gmail.com` as the only admin.)
6. First time you sort answered questions, Firestore may ask you to **create an
   index** — just click the link it prints in the browser console once.

### Why your keys are safe
- The Firebase web `apiKey` is **public by design** — it only identifies the
  project. Your data is protected by the **Firestore Rules**, which only let:
  - anyone *submit* a question,
  - anyone *read answered* questions,
  - **only you** (your Google email) answer/edit/delete.
- Extra hardening: Google Cloud Console → APIs & Services → Credentials →
  restrict the API key to your domain.

---

## 3. Last.fm stats (optional)

1. Get a free key: <https://www.last.fm/api/account/create>
2. Put it in `.env` as `VITE_LASTFM_API_KEY`.

---

## 4. Deploy to Vercel

1. Push this folder to a **GitHub** repo. (`.env` is gitignored — your secrets
   stay off GitHub automatically. ✅)
2. <https://vercel.com> → **Add New Project** → import the repo.
3. Framework preset: **Vite** (auto-detected). Build = `npm run build`,
   output = `dist`.
4. **Settings → Environment Variables** → add every `VITE_...` variable from
   your `.env` (same names + values).
5. **Deploy**. Done.

After deploy, in Firebase **Authentication → Settings → Authorized domains**,
add your Vercel domain (e.g. `your-site.vercel.app`) so Google sign-in works.

---

## 5. Editing your site later

Almost everything lives in **`src/config/siteConfig.js`** — name, bio, projects,
links, skills, interests, the AMA limit, and the music track. Change it there and
redeploy. No need to touch the components.
