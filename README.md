# Yatin Sharma — Portfolio

A dark, minimalist personal portfolio for a full-stack web developer.
Built with **React + Vite + Tailwind CSS**, with a **Firebase**-backed
"Ask Me Anything", live **GitHub / Last.fm / AniList** widgets, an ambient
**music player**, and **5 hidden mini-games**.

## Stack
- React 18 + Vite
- Tailwind CSS
- Firebase (Firestore + Google Auth) for the AMA inbox
- Deployed on Vercel

## Quick start
```bash
npm install
cp .env.example .env   # add your keys
npm run dev
```

## Structure
```
src/
├─ config/siteConfig.js   ← EDIT EVERYTHING HERE (your details)
├─ App.jsx
├─ firebase.js
├─ hooks/                 ← useGitHub, useLastFM, useAniList, useTheme, useReveal
└─ components/
   ├─ Intro, Topbar, MusicPlayer, Hero, About, Skills, Projects,
   ├─ LastFM, AniList, Interests, AMA, Footer
   └─ games/  (Snake, Flappy, Minesweeper, Reaction, Quiz)
```

See **DEPLOY.md** for full setup + how your API keys stay private.

## Features
- Intro animation (tap / swipe up to enter)
- Light / dark theme toggle
- Topbar ambient music player (YouTube IFrame)
- Live repo, scrobble and anime widgets
- Ask Me Anything with owner-only Google login to answer
- Hidden games at `#games` (also via the 🎮 buttons)
```
```
