# Telegram + Firestore AMA Setup Guide

This guide wires the portfolio AMA system so visitors can ask questions on the site, you can manage them from Telegram, and answered questions appear back on the site.

The current system supports:

- visitor question submission
- Telegram admin notifications
- answer preview and publish flow
- edit, dismiss, retrieve, delete
- pinned questions
- featured/spotlight AMA on the site
- voting and emoji reactions
- manual + automatic topic system
- WakaTime, Last.fm, visitor counter server functions
- optional Telegram log group with forum-topic routing

---

## Architecture overview

```txt
Website AMA form
  ↓
Firestore amaQuestions collection
  ↓
/api/telegram sends Telegram notification
  ↓
Telegram bot buttons / commands
  ↓
/api/telegram-webhook writes back to Firestore
  ↓
Website reads answered questions and renders Q&A
```

Server-side Firestore writes use a Firebase service account stored in Vercel environment variables.

---

# Part 1 — Firebase / Firestore

## 1.1 Create Firebase project

1. Go to <https://console.firebase.google.com>.
2. Click **Add project**.
3. Name it, for example:

```txt
yatin-portfolio
```

4. Google Analytics is optional. You can disable it.

---

## 1.2 Create Firestore database

1. Open your Firebase project.
2. Go to **Build → Firestore Database**.
3. Click **Create database**.
4. Start in **production mode**.
5. Pick a region near your users, for example:

```txt
asia-south1
```

---

## 1.3 Get Firebase Web API key and Project ID

This is used by the public frontend to create/read allowed documents.

1. Firebase Console → Project settings → General.
2. Scroll to **Your apps**.
3. Add a Web app using the `</>` icon.
4. Copy:

```txt
apiKey
projectId
```

5. Put them in `script.js`:

```js
firebase: {
  apiKey: 'YOUR_FIREBASE_WEB_API_KEY',
  projectId: 'YOUR_FIREBASE_PROJECT_ID'
}
```

These values are public. Firestore rules protect the database.

---

## 1.4 Publish Firestore rules

Open:

```txt
firestore.rules
```

Copy its full content into:

```txt
Firebase Console → Firestore Database → Rules
```

Click **Publish**.

The rules allow visitors to create safe question documents with strict fields, including:

```txt
id
name
question
answer
answered
createdAt
answeredAt
votes
pinned
dismissed
topic
topicManual
topicAt
```

Visitors can read answered questions. Admin/server writes use the service account.

---

## 1.5 Generate Firebase service account key

This is private and must only be stored in Vercel env vars.

1. Firebase Console → Project settings.
2. Open **Service accounts** tab.
3. Click **Generate new private key**.
4. Download the JSON.
5. You will paste the entire JSON into Vercel as:

```txt
FIREBASE_SERVICE_ACCOUNT_KEY
```

---

# Part 2 — Telegram bot

## 2.1 Create bot with BotFather

1. Open Telegram.
2. Search `@BotFather`.
3. Send:

```txt
/newbot
```

4. Choose bot name and username.
5. Copy the bot token:

```txt
123456:ABC-DEF...
```

This becomes:

```txt
TELEGRAM_BOT_TOKEN
```

---

## 2.2 Get your Telegram chat ID

Use one of these bots:

```txt
@userinfobot
@RawDataBot
```

Start it and copy your numeric ID, for example:

```txt
7652360832
```

This becomes:

```txt
TELEGRAM_CHAT_ID
```

Also send a message to your own bot once, so the bot is allowed to message you.

---

## 2.3 Configure BotFather commands

The repo contains:

```txt
botfather-commands.txt
```

In BotFather:

```txt
/mybots → your bot → Edit Bot → Edit Commands
```

Paste the file content.

---

# Part 3 — Vercel deployment

## 3.1 Import project

1. Push repo to GitHub.
2. Vercel → New Project → Import.
3. Framework preset: **Other**.
4. Build command: empty.
5. Output directory: empty or `.`.

---

## 3.2 Required environment variables

Add these in:

```txt
Vercel Project → Settings → Environment Variables
```

| Name | Required | Description |
|---|---:|---|
| `TELEGRAM_BOT_TOKEN` | yes | Bot token from BotFather |
| `TELEGRAM_CHAT_ID` | yes | Your Telegram chat ID; only this chat can control the bot |
| `TELEGRAM_WEBHOOK_SECRET` | yes | Random secret used by Telegram webhook |
| `FIREBASE_PROJECT_ID` | yes | Firebase project ID |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | yes | Full Firebase service account JSON |
| `LASTFM_API_KEY` | yes for Last.fm | Last.fm API key for proxy |
| `WAKATIME_API_KEY` | optional | WakaTime stats |
| `GROQ_API_KEY` | optional | Enables AI features — the "Ask my portfolio" chatbot and AI bot commands (`/draft`, `/improve`, `/shorten`, `/expand`, AI auto-topic). Free tier at console.groq.com |
| `GROQ_MODEL` | optional | Override the Groq model (default `llama-3.3-70b-versatile`) |
| `CRON_SECRET` | optional | Secures the scheduled endpoints `/api/digest-cron` and `/api/health-cron` |
| `TELEGRAM_LOG_CHAT_ID` | optional | Telegram group/channel for logs |
| `TELEGRAM_LOG_THREAD_MAP` | optional | Forum topic routing for logs |

### Example required env values

```txt
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_CHAT_ID=7652360832
TELEGRAM_WEBHOOK_SECRET=my-long-random-secret
FIREBASE_PROJECT_ID=portfolio-yatin
FIREBASE_SERVICE_ACCOUNT_KEY={...entire service account json...}
LASTFM_API_KEY=xxxxxxxxxxxxxxxx
```

### Service account JSON tip

Vercel accepts multiline JSON, but one-line JSON is safest. Paste the full object including braces:

```json
{"type":"service_account", ...}
```

---

# Part 4 — Connect Telegram webhook

After deployment, open this URL in your browser:

```txt
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<YOUR_VERCEL_URL>/api/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

Example:

```txt
https://api.telegram.org/bot123456:ABC/setWebhook?url=https://your-site.vercel.app/api/telegram-webhook&secret_token=mySecret123
```

Expected response:

```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

---

# Part 5 — Telegram logging setup optional but recommended

## 5.1 Basic log group/channel

Create a private Telegram group or channel for logs.

Add your bot to it.

For a channel, make the bot admin with permission to post.

Get the chat ID and set:

```txt
TELEGRAM_LOG_CHAT_ID=-100xxxxxxxxxx
```

Logs will include:

- site submissions
- unauthorized access attempts
- bot commands and button callbacks
- answer workflow events
- moderation actions
- delete audit events
- pin/unpin
- featured AMA changes
- topic management
- health checks and errors

---

## 5.2 Telegram forum-topic routing

If your log group has Telegram Topics enabled, create topics such as:

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

Get each topic's `message_thread_id` using `getUpdates`.

Then set:

```txt
TELEGRAM_LOG_THREAD_MAP={"site":4,"bot":5,"security":6,"answer":7,"moderation":8,"delete":9,"pin":10,"spotlight":11,"topic":12,"health":13,"error":13}
```

Replace numbers with your actual thread IDs.

If a category is missing from the map, that log goes to the default log group.

---

# Part 6 — Test end to end

## 6.1 Test site question

1. Open deployed site.
2. Go to **Ask Me Anything**.
3. Submit a question.
4. You should receive a Telegram question card.
5. If logging is enabled, a site log appears in your log group/topic.

## 6.2 Test answering

1. Press **Answer** in Telegram or reply to a question card.
2. Type your answer.
3. Confirm the preview.
4. Refresh the site.
5. Answer appears in the AMA section.

## 6.3 Test featured AMA

```txt
/spotlight <id>
/featured
```

The selected question should appear as Featured AMA on the site.

Clear it with:

```txt
/unspotlight
```

## 6.4 Test topic system

```txt
/topicof <id>
/topic <id> React Hooks
/cleartopic <id>
/retopic <id>
/retopics
/topics
```

The site should show a topic pill on AMA cards.

---

# Telegram commands

> The authoritative, always-current list lives in `botfather-commands.txt`
> (paste it into BotFather). The groups below mirror it.

## System

```txt
/start
/help
/cancel
/refresh
/stats
/health
```

## Queues and browsing

```txt
/pending
/queue
/recent
/all
/dismissed
```

## Find and inspect

```txt
/get <id>
/search <text>
/lookup
/export
```

## Insights

```txt
/digest
/inbox
/topics
/quality
/trends
/top
```

## Answering

```txt
/answer <id> <text>
/answerall
/edit <id>
```

## AI drafting (requires GROQ_API_KEY)

```txt
/draft <id>          AI-generate an answer suggestion, then preview
/improve <id>        AI-improve an existing answer
/shorten <id>        AI-shorten an existing answer
/expand <id>         AI-expand an existing answer
/publish <id>        Publish a saved draft answer
/drafts              List unpublished draft answers
/schedule <id> +2h   Auto-publish a draft later (or ISO time)
```

## Reply templates

```txt
/templates
/addtemplate name | template text
/usetemplate name <id>
/deltemplate name
```

## Pin and featured AMA

```txt
/pin <id>
/unpin <id>
/pinned
/spotlight <id>
/featured
/unspotlight
```

## Moderation

```txt
/dismiss <id>
/dismissall
/retrieve <id>
/retrieveall
```

## Delete

```txt
/delete <id>
/deleteall     (type-token confirm; /undo can restore)
/undo
```

## Topic management

```txt
/topic <id> <topic>
/topicof <id>
/cleartopic <id>
/retopic <id>
/retopics
```

---

# Topic system details

Every question has a stored topic:

```js
topic: string
topicManual: boolean
topicAt: string
```

## Automatic topics

The site and bot extract an important phrase/word from the question and answer.

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

## Manual topics

Set one manually:

```txt
/topic <id> <topic>
```

Clear manual topic and return to auto:

```txt
/cleartopic <id>
```

Recompute one auto topic:

```txt
/retopic <id>
```

Recompute all non-manual auto topics:

```txt
/retopics
```

---

# Security notes

- `TELEGRAM_WEBHOOK_SECRET` is fail-closed. If missing or incorrect, webhook requests are rejected.
- `TELEGRAM_CHAT_ID` limits bot control to your Telegram account/chat.
- Unauthorized Telegram users receive a professional access-restricted response.
- Unauthorized attempts are logged if logging is enabled.
- Firestore public writes are restricted by `firestore.rules`.
- Service account JSON is server-only and must never be committed.

---

# Troubleshooting

## Question does not arrive in Telegram

Check:

```txt
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
/api/telegram Vercel logs
```

Also make sure you messaged your bot once.

## Webhook commands do not work

Re-run the `setWebhook` URL and verify:

```txt
TELEGRAM_WEBHOOK_SECRET
```

matches Vercel exactly.

## Firestore permission denied on site submit

Check:

```txt
firestore.rules published
topic/topicManual/topicAt fields allowed
CONFIG.firebase.apiKey
CONFIG.firebase.projectId
```

## Bot writes fail

Check:

```txt
FIREBASE_SERVICE_ACCOUNT_KEY
FIREBASE_PROJECT_ID
```

## Logs do not appear

Check:

```txt
TELEGRAM_LOG_CHAT_ID
bot is in the log group/channel
bot can post messages
thread IDs are correct if using TELEGRAM_LOG_THREAD_MAP
```

## Site still shows old CSS/JS

The site uses a service worker. Hard refresh after deploy:

```txt
Ctrl + Shift + R
```

or unregister the service worker in DevTools if needed.

---

# Recommended log thread map

Use this as a template:

```json
{"site":4,"bot":5,"security":6,"answer":7,"moderation":8,"delete":9,"pin":10,"spotlight":11,"topic":12,"health":13,"error":13}
```

Replace numbers with your actual Telegram forum topic IDs.
