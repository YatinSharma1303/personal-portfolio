# Telegram + Firestore AMA — Setup Guide

This wires up the **"Ask Me Anything"** box so that:
1. A visitor submits a question → it's saved to **Firestore** + you get a **Telegram notification**.
2. You **reply in Telegram** → the answer is saved back to Firestore and **appears on your site**.

You can also manage questions from Telegram: `/delete`, `/dismiss`, `/edit`, `/refresh`.

> **What you need:** a Firebase project (free), a Telegram bot (free), ~30 minutes.
> **No coding** beyond copy-pasting values.

---

## Part 1 — Firebase (Firestore)

### 1.1 Create the project
1. Go to **https://console.firebase.google.com** → **Add project**.
2. Name it (e.g. `yatin-portfolio`). Disable Google Analytics (not needed). Create.

### 1.2 Create a Firestore database
3. In the project, left menu → **Build → Firestore Database → Create database**.
4. Choose **Start in production mode**. Pick a location near you (e.g. `asia-south1` for India). Done.

### 1.3 Get your public Web API key + Project ID (for `script.js`)
5. ⚙️ **Project settings** (gear icon, top-left) → **General** tab.
6. Scroll to **"Your apps"** → click the **`</>` (Web)** icon to add a web app.
7. Register it (any nickname). You can skip hosting.
8. It shows a `firebaseConfig`. Copy these **two values**:
   - `apiKey` → e.g. `AIzaSyXXXX...`
   - `projectId` → e.g. `yatin-portfolio`
9. Open **`script.js`** and paste them:
   ```js
   firebase: {
     apiKey: 'AIzaSyXXXX...',          // ← paste here
     projectId: 'yatin-portfolio'      // ← paste here
   }
   ```
   *(These are public — safe in frontend code. Security comes from the rules in Part 1.4.)*

### 1.4 Publish the security rules
10. In Firebase Console → **Firestore Database → Rules** tab.
11. Paste the entire contents of **`firestore.rules`** (from this repo) and click **Publish**.

This allows visitors to *create* a question (with strict field limits) and *read* only answered ones. Only you can edit/delete.

### 1.5 Get the Service Account key (for the webhook — server-side only)
12. ⚙️ **Project settings → Service accounts** tab → **Generate new private key** → download the JSON.
13. Keep it handy — you'll paste the **entire JSON** as a Vercel env var in Part 3.

---

## Part 2 — Telegram Bot

### 2.1 Create the bot
1. Open Telegram → search **@BotFather** → `/newbot`.
2. Give it a name + username (must end in `bot`). It gives you a **bot token** like `123456:ABC-DEF...`.
3. Copy the **token**.

### 2.2 Get YOUR chat ID (so only YOU receive messages)
4. Search **@userinfobot** (or **@RawDataBot**) → start it → it replies with your numeric **chat ID** (e.g. `7652360832`).
5. Copy the **chat ID**.
6. **Send any message to your own bot** first (e.g. `/start`). This is required so the bot is allowed to message you back.

---

## Part 3 — Deploy + Environment Variables

### 3.1 Push to GitHub
Push this whole folder to a GitHub repo.

### 3.2 Import on Vercel
1. **https://vercel.com → New Project → Import** your repo.
2. Framework Preset: **Other**. Build Command: *(leave empty)*. Output Directory: *(leave as `.` or empty)*.
3. **Before clicking Deploy**, open **Settings → Environment Variables** and add these (all marked **Sensitive**):

| Name | Value | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `123456:ABC-DEF...` | from BotFather |
| `TELEGRAM_CHAT_ID` | `7652360832` | your numeric chat ID |
| `FIREBASE_PROJECT_ID` | `yatin-portfolio` | same as in `script.js` |
| `TELEGRAM_WEBHOOK_SECRET` | `any-random-text-here` | make one up, e.g. `mySecret123abc` |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | *(entire JSON from Part 1.5)* | paste the whole `{...}` on one line |

> **Tip for `FIREBASE_SERVICE_ACCOUNT_KEY`:** open the downloaded JSON in a text editor, join it into one line (or paste multi-line — Vercel accepts it), and paste the full thing as the value.

4. Click **Deploy**. Wait for it to finish. Note your URL, e.g. `https://yatin-portfolio.vercel.app`.

> Voting (`api/ama-vote.js`) needs **no extra env vars** — it reuses the same `FIREBASE_SERVICE_ACCOUNT_KEY` + `FIREBASE_PROJECT_ID` you already added. The Playground games run 100% client-side, so nothing to configure for them either.

---

## Part 4 — Connect the Webhook (the final link)

This tells Telegram: "send my bot's messages to my Vercel function."

Open this URL in your browser, replacing the 3 values:

```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<YOUR_VERCEL_URL>/api/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

Example:
```
https://api.telegram.org/bot123456:ABC/setWebhook?url=https://yatin-portfolio.vercel.app/api/telegram-webhook&secret_token=mySecret123abc
```

You should see:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

✅ **Done!** The whole loop is live.

---

## Test it end-to-end

1. Open your deployed site → scroll to **Ask Me Anything**.
2. Type a question → **Send**.
3. You should get a **Telegram message** within seconds, containing the question + an `ID: ...` line.
4. **Reply to that bot message** (long-press → Reply in Telegram) and type your answer.
5. Refresh your site → your answer now appears under the box.

---

## Managing questions from Telegram

| Action | How |
|---|---|
| **Answer** | Reply to the bot's question message with your answer text. |
| **Delete** | Reply with `/delete` |
| **Dismiss** (hide, keep it) | Reply with `/dismiss` |
| **Edit** the question text | Reply with `/edit`, then send the new text |
| **List** all pending | Send `/refresh` directly to the bot |

---

## Security notes (what I fixed vs. the original)

- ✅ **Webhook secret is fail-closed.** The original repo skipped auth if the secret was unset; this version **rejects** the request if `TELEGRAM_WEBHOOK_SECRET` is missing. Don't leave it blank.
- ✅ **Firestore rules** lock creates to safe fields with length caps; reads only return answered questions.
- ✅ **All real secrets** (bot token, service-account JSON, webhook secret) live in **Vercel env vars**, never in frontend code.
- ✅ Telegram chat-ID check ensures only **your** chat can manage questions.

---

## Troubleshooting

- **Question doesn't arrive in Telegram:** check `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` in Vercel, and that you messaged the bot first. Check Vercel → Functions logs.
- **Reply doesn't save / shows nowhere:** re-run the `setWebhook` URL (Part 4); confirm the secret token matches exactly. Check Vercel function logs for `/api/telegram-webhook`.
- **`Permission denied` on Firestore create:** you didn't publish the rules (Part 1.4), or pasted them wrong.
- **`Permission denied` when webhook writes answers:** service account JSON is malformed in Vercel env var. Re-paste the full JSON on one line.
- **Questions show but answers don't appear on site:** answers only render for docs where `answered == true`. The webhook sets that — check it ran without errors.
