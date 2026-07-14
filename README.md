# Yatin Sharma — Personal Portfolio

A full-featured personal portfolio built with **vanilla HTML, CSS, and JavaScript**, backed by **Vercel Serverless Functions**, **Firebase Firestore**, and a powerful **Telegram admin bot**.

The project is intentionally framework-free on the frontend: no React, no Next.js, no bundler, no build step. It is a fast static site with selected serverless API routes for private keys, Telegram automation, Firestore admin writes, WakaTime, Last.fm, visitor stats, and GitHub contribution data.

---

## Table of contents

- [Overview](#overview)
- [Core features](#core-features)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Live integrations](#live-integrations)
- [AMA system](#ama-system)
- [Telegram admin bot](#telegram-admin-bot)
- [Topic system](#topic-system)
- [Featured AMA / spotlight](#featured-ama--spotlight)
- [Telegram logging system](#telegram-logging-system)
- [Environment variables](#environment-variables)
- [Run locally](#run-locally)
- [Deploy](#deploy)
- [Customization guide](#customization-guide)
- [File map](#file-map)
- [Firestore data model](#firestore-data-model)
- [Security model](#security-model)
- [Service worker and cache notes](#service-worker-and-cache-notes)
- [Maintenance checklist](#maintenance-checklist)
- [Troubleshooting](#troubleshooting)

---

## Overview

This portfolio is a single-page site with a polished dark/light glassmorphism UI, animated intro, live stats, custom music player, games, and a deeply integrated Ask Me Anything system.

Visitors can submit questions on the site. You receive them in Telegram, answer with preview/confirmation, and the answer appears publicly on the portfolio. From Telegram you can manage the full AMA database: answer, edit, dismiss, retrieve, delete, pin, feature, tag/topic, inspect, export, and audit actions.

---

## Core features

### Frontend

- Single-page portfolio
- Dark/light theme
- Animated intro overlay
- Custom cursor/click effects
- Scroll progress and reveal animations
- Command palette
- YouTube-based music player
- GitHub stats and repos
- GitHub contribution heatmap
- Last.fm music dashboard
- AniList anime list
- WakaTime coding stats
- Visitor counter
- AMA form and answered Q&A feed
- Featured AMA card
- Topic pills on AMA cards
- Playground games

### Backend

- Telegram notification endpoint
- Telegram webhook/admin bot
- Last.fm secure proxy and bundled endpoint
- WakaTime proxy
- GitHub contribution proxy
- Firestore-powered visitor counter
- Vote endpoint
- Emoji reaction endpoint
- Service-account Firestore writes

---

## Tech stack

### Frontend

```txt
HTML
CSS
Vanilla JavaScript
Service Worker
```

### Backend

```txt
Vercel Serverless Functions
Node.js CommonJS API handlers
Firestore REST API
Telegram Bot API
Last.fm API
WakaTime API
GitHub APIs
AniList GraphQL
```

### Database

```txt
Firebase Firestore
```

---

## Architecture

```txt
Browser
  ├─ static HTML/CSS/JS
  ├─ reads public answered AMA docs from Firestore
  ├─ creates new AMA questions in Firestore
  ├─ calls /api/telegram for Telegram notification
  ├─ calls /api/lastfm for Last.fm data
  ├─ calls /api/wakatime for coding stats
  ├─ calls /api/contributions for GitHub calendar
  ├─ calls /api/visitor for visitor count
  ├─ calls /api/ama-vote for votes
  └─ calls /api/reactions for emoji reactions

Telegram
  └─ sends webhook updates to /api/telegram-webhook

Vercel Functions
  ├─ use env vars for private API keys
  ├─ mint Firebase service-account access tokens
  ├─ write admin changes to Firestore
  └─ send logs to Telegram log group/topics

Firestore
  ├─ amaQuestions
  ├─ telegram session collections
  └─ siteStats
```

---

## Live integrations

## GitHub

Frontend fetches GitHub profile/repo data and renders:

- profile stats
- recent repositories
- language chart

Contribution heatmap is fetched through:

```txt
/api/contributions
```

## Last.fm

Last.fm is proxied through:

```txt
/api/lastfm
```

This keeps the Last.fm API key server-side.

The frontend uses a bundled endpoint:

```txt
/api/lastfm?bundle=1&user=YATINSHARMA
```

The bundle loads:

- user info
- top tracks
- top artists
- recent tracks

Now-playing/recent tracks bypass cache and refresh around every 12 seconds.

## AniList

AniList is fetched directly from the browser using GraphQL.

If AniList fails, the UI falls back to a small local fallback anime list instead of staying broken.

## WakaTime

WakaTime stats are proxied through:

```txt
/api/wakatime
```

Requires:

```txt
WAKATIME_API_KEY
```

If missing, the UI shows a friendly setup message.

## YouTube music player

The music player uses YouTube IFrame API, controlled by:

```js
CONFIG.ytVideoId
```

No audio files are hosted in the repo.

---

## AMA system

The AMA system is the largest feature of the project.

### Visitor flow

```txt
Visitor submits question
  ↓
Firestore document is created
  ↓
/api/telegram sends notification to Telegram
  ↓
You answer from Telegram
  ↓
/api/telegram-webhook writes answer
  ↓
Site displays answered question
```

### Site AMA features

- optional name field
- blank name becomes `Anonymous`
- old saved names are not reused
- daily submit limit via localStorage
- answered Q&A feed
- sorting by top/recent/oldest
- pinned cards
- featured AMA card
- topic pill
- votes
- emoji reactions
- manual refresh
- auto-refresh when section is visible

---

## Telegram admin bot

The bot is controlled only by your configured:

```txt
TELEGRAM_CHAT_ID
```

Unauthorized users receive a professional private-bot notice and cannot run commands.

### Command groups

#### System

```txt
/start
/help
/cancel
```

#### Queues and browsing

```txt
/pending
/refresh
/recent
/all
/dismissed
/pinned
```

#### Find and inspect

```txt
/get <id>
/search <text>
/lookup
/export
```

#### Insights

```txt
/digest
/inbox
/topics
/quality
/health
```

#### Answering

```txt
/answer <id> <text>
/edit <id>
```

#### Pin and featured AMA

```txt
/pin <id>
/unpin <id>
/spotlight <id>
/featured
/unspotlight
```

#### Moderation

```txt
/dismiss <id>
/dismissall
/retrieve <id>
/retrieveall
```

#### Delete

```txt
/delete <id>
/deleteall
```

#### Topic management

```txt
/topic <id> <topic>
/topicof <id>
/cleartopic <id>
/retopic <id>
/retopics
```

### Interaction style

Most bot operations use:

```txt
loading card → final card
```

This keeps Telegram responsive and avoids silent waits.

Many cards include inline buttons that navigate to related actions:

- Open question
- Edit answer
- Topic info
- Clear topic
- View featured
- Clear featured
- Smart inbox
- Digest
- Stats
- Health

---

## Topic system

Every question stores a topic in Firestore.

```js
topic: string
topicManual: boolean
topicAt: string
```

### Automatic topic

When a visitor submits a question, the site computes a topic automatically from the most important phrase/word.

Examples:

```txt
Disease Prediction
React Hooks
SmartHealthCare
Firestore
Telegram Bot
Machine Learning
Resume
Naruto
Portfolio
RAG Chatbot
```

### Manual topic

You can override any topic:

```txt
/topic <id> React Hooks
```

Manual topics take priority.

### Clear manual topic

```txt
/cleartopic <id>
```

This removes the manual override and stores a recomputed automatic topic.

### Recompute topics

Single question:

```txt
/retopic <id>
```

All non-manual topics:

```txt
/retopics
```

Manual topics are preserved.

---

## Featured AMA / spotlight

You can feature one answered AMA on the site.

```txt
/spotlight <id>
```

The site displays it as a Featured AMA card.

Show current featured AMA:

```txt
/featured
```

Clear featured AMA:

```txt
/unspotlight
```

If stale documents have old spotlight flags, `/unspotlight` clears all spotlight flags.

---

## Telegram logging system

Optional logging is controlled by:

```txt
TELEGRAM_LOG_CHAT_ID
```

If unset, logging is disabled safely.

### Logs include

- site question submissions
- Telegram notification failures
- unauthorized access attempts
- bot commands
- inline callbacks
- answer preview lifecycle
- answer publish/edit
- dismiss/retrieve
- delete/deleteall
- pin/unpin
- spotlight/unspotlight
- topic set/clear/recompute
- health checks

### Forum-topic routing

If your Telegram log group has Topics enabled, set:

```txt
TELEGRAM_LOG_THREAD_MAP
```

Example:

```json
{"site":4,"bot":5,"security":6,"answer":7,"moderation":8,"delete":9,"pin":10,"spotlight":11,"topic":12,"health":13,"error":13}
```

### Recommended Telegram forum topics

```txt
🌐 Site Activity Logs
🤖 Bot Command Logs
🚫 Unauthorized Access Logs
✅ Answer Workflow Logs
🛠 Moderation Action Logs
🗑 Delete Audit Logs
📌 Pin Action Logs
🌟 Featured AMA Logs
🏷 Topic Management Logs
🩺 System Health & Error Logs
```

---

## Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `TELEGRAM_BOT_TOKEN` | yes | Telegram Bot API token |
| `TELEGRAM_CHAT_ID` | yes | Authorized owner/admin chat |
| `TELEGRAM_WEBHOOK_SECRET` | yes | Webhook secret token |
| `FIREBASE_PROJECT_ID` | yes | Firebase project ID |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | yes | Server-side Firestore access |
| `LASTFM_API_KEY` | yes for Last.fm | Last.fm proxy |
| `WAKATIME_API_KEY` | optional | WakaTime stats |
| `TELEGRAM_LOG_CHAT_ID` | optional | Telegram log group/channel |
| `TELEGRAM_LOG_THREAD_MAP` | optional | Telegram forum-topic log routing |

See [`SETUP_TELEGRAM_FIRESTORE.md`](SETUP_TELEGRAM_FIRESTORE.md) for full setup.

---

## Run locally

```bash
cd personal-portfolio
python3 -m http.server 8000
```

Open:

```txt
http://localhost:8000
```

This serves only the static frontend. Vercel API routes do not run through Python's static server.

---

## Deploy

Recommended: **Vercel**.

1. Push repo to GitHub.
2. Import on Vercel.
3. Framework preset: **Other**.
4. Build command: empty.
5. Output directory: empty or `.`.
6. Add env vars.
7. Deploy.
8. Set Telegram webhook.

Webhook URL:

```txt
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<YOUR_DOMAIN>/api/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

---

## Customization guide

### Personal text and sections

Edit:

```txt
index.html
```

For headings, bio, about section, interests, and section text.

### Skills and projects

Edit arrays in:

```txt
script.js
```

Look for:

```js
SKILLS
PROJECTS
CONFIG
```

### Project images

Images live in:

```txt
assets/
```

Project cards use `img` paths inside `PROJECTS`.

### Music

Change:

```js
CONFIG.ytVideoId
```

### Theme and styling

Edit:

```txt
style.css
```

The design uses CSS variables under `:root` and `html.light`.

---

## File map

| File | Purpose |
|---|---|
| `index.html` | Main single-page markup |
| `style.css` | Full UI styling and responsive design |
| `script.js` | Main frontend logic and integrations |
| `games.js` | Playground games |
| `sw.js` | Service worker cache strategy |
| `404.html` | Custom 404 page |
| `firestore.rules` | Firestore client security rules |
| `botfather-commands.txt` | BotFather command list |
| `SETUP_TELEGRAM_FIRESTORE.md` | Full backend setup guide |
| `api/telegram.js` | Site question notification endpoint |
| `api/telegram-webhook.js` | Telegram admin bot and Firestore admin logic |
| `api/ama-vote.js` | Vote endpoint |
| `api/reactions.js` | Emoji reaction endpoint |
| `api/visitor.js` | Visitor counter endpoint |
| `api/lastfm.js` | Last.fm proxy and bundle endpoint |
| `api/wakatime.js` | WakaTime proxy |
| `api/contributions.js` | GitHub contributions proxy |

---

## Firestore data model

### `amaQuestions/{id}`

Important fields:

```js
{
  id: string,
  name: string,
  question: string,
  answer: string,
  answered: boolean,
  dismissed: boolean,
  pinned: boolean,
  spotlight: boolean,
  spotlightAt: string,
  topic: string,
  topicManual: boolean,
  topicAt: string,
  createdAt: string,
  answeredAt: string,
  editedAt: string,
  votes: number,
  reactions: map
}
```

### Bot session collections

```txt
telegramEditSessions
telegramLookupSessions
telegramPreviewSessions
telegramAnswerSessions
```

These are server-only.

### Visitor stats

```txt
siteStats/visitors
```

---

## Security model

- Telegram webhook is protected by `TELEGRAM_WEBHOOK_SECRET`.
- Bot admin actions are restricted to `TELEGRAM_CHAT_ID`.
- Unauthorized users receive access-denied messages.
- Firestore client rules allow only safe question creation and answered reads.
- Server-side writes use Firebase service account.
- Last.fm and WakaTime API keys are server-side only.
- Service account JSON must never be committed.

---

## Service worker and cache notes

Static assets are cached by `sw.js`.

When you change CSS/JS, bump cache/version query strings:

```html
style.css?v=x.x
script.js?v=x.x
```

And update:

```js
CACHE_NAME
```

If browser still shows old UI:

```txt
DevTools → Application → Service Workers → Unregister
```

or hard refresh:

```txt
Ctrl + Shift + R
```

---

## Maintenance checklist

After major changes:

```bash
node --check script.js
node --check api/telegram-webhook.js
node --check api/telegram.js
node --check api/lastfm.js
```

Also check:

- Vercel env vars are present
- Firestore rules are published
- Telegram webhook is set
- BotFather commands are updated
- service worker cache version is bumped
- `/health` returns OK
- `/featured` matches site Featured AMA
- `/topics` shows expected topic counts

---

## Troubleshooting

### Telegram question not received

Check:

```txt
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
/api/telegram logs in Vercel
```

### Telegram commands not working

Check webhook:

```txt
/api/telegram-webhook
TELEGRAM_WEBHOOK_SECRET
setWebhook URL
```

### Firestore create denied

Check:

```txt
firestore.rules
CONFIG.firebase.apiKey
CONFIG.firebase.projectId
```

### Answers not showing on site

Check the Firestore document:

```txt
answered == true
dismissed == false
answer is not empty
```

### Featured AMA not showing

Check:

```txt
/featured
spotlight == true
answered == true
hard refresh site
service worker cache
```

### Last.fm slow or stale

Check:

```txt
LASTFM_API_KEY
/api/lastfm?bundle=1&user=YATINSHARMA
/api/lastfm?method=user.getrecenttracks&user=YATINSHARMA&limit=10
```

Recent tracks bypass cache. Heavy stats use bundle/cache.

### Logs not appearing

Check:

```txt
TELEGRAM_LOG_CHAT_ID
bot is in log group/channel
bot can post messages
TELEGRAM_LOG_THREAD_MAP if using forum topics
```

---

## License / reuse

This is a personal portfolio. If reusing, replace all personal data, usernames, project info, Firebase config, env vars, assets, and bot setup.
