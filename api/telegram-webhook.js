/* ============================================================
   api/telegram-webhook.js  —  Vercel serverless function
   The brain of the AMA Telegram interaction.

   Handles:
   • Inline button presses (Answer / Dismiss / Delete / Edit)
   • Reply-to-message answers (free-form text)
   • /start, /help, /stats, /refresh, /pending commands
   • /edit two-step flow

   Security: webhook secret is FAIL-CLOSED.
   ============================================================ */

const crypto = require('crypto');

const TELEGRAM_API = 'https://api.telegram.org/bot';
const COLLECTION = 'amaQuestions';
const EDIT_SESSION_COLLECTION = 'telegramEditSessions';

/* ── helpers ── */
function jsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return req.body;
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_KEY');
  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY must contain client_email and private_key');
  }
  return parsed;
}

function projectId() {
  const sa = serviceAccount();
  return process.env.FIREBASE_PROJECT_ID || sa.project_id;
}

function docPath(collection, id) {
  return `https://firestore.googleapis.com/v1/projects/${projectId()}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}`;
}

/* ── Google OAuth: mint a service-account JWT ── */
async function googleAccessToken() {
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || `Google token error ${response.status}`);
  }
  return data.access_token;
}

/* ── Firestore REST wrapper ── */
async function firestore(method, url, body) {
  const token = await googleAccessToken();
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `Firestore ${method} error ${response.status}`);
  return data;
}

function mask(fields) {
  return fields.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
}

/* ── Telegram send helper ── */
async function sendTelegram(chatId, text, replyToMessageId, replyMarkup) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !chatId) return;
  await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, text, parse_mode: 'HTML',
      reply_to_message_id: replyToMessageId,
      allow_sending_without_reply: true,
      reply_markup: replyMarkup
    })
  }).catch(() => null);
}

/* ── Answer callback query (for inline buttons) ── */
async function answerCallback(callbackId, text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;
  await fetch(`${TELEGRAM_API}${botToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text, show_alert: false })
  }).catch(() => null);
}

/* ── Edit the original message (after a button action) ── */
async function editMessage(chatId, messageId, text, replyMarkup) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;
  await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, message_id: messageId,
      text, parse_mode: 'HTML',
      reply_markup: replyMarkup
    })
  }).catch(() => null);
}

/* ── Question CRUD ── */
async function answerQuestion(id, answer) {
  return firestore('PATCH', `${docPath(COLLECTION, id)}?${mask(['answer', 'answered', 'answeredAt', 'dismissed'])}`, {
    fields: {
      answer: { stringValue: answer.slice(0, 1000) },
      answered: { booleanValue: true },
      answeredAt: { stringValue: new Date().toISOString() },
      dismissed: { booleanValue: false }
    }
  });
}
async function dismissQuestion(id) {
  return firestore('PATCH', `${docPath(COLLECTION, id)}?${mask(['dismissed', 'answered'])}`, {
    fields: { dismissed: { booleanValue: true }, answered: { booleanValue: false } }
  });
}
async function deleteQuestion(id) {
  return firestore('DELETE', docPath(COLLECTION, id));
}
async function editQuestionText(id, text) {
  return firestore('PATCH', `${docPath(COLLECTION, id)}?${mask(['question'])}`, {
    fields: { question: { stringValue: text.slice(0, 280) } }
  });
}

/* ── Edit session ── */
async function saveEditSession(chatId, questionId) {
  return firestore('PATCH', docPath(EDIT_SESSION_COLLECTION, String(chatId)), {
    fields: { chatId: { stringValue: String(chatId) }, questionId: { stringValue: String(questionId) }, createdAt: { stringValue: new Date().toISOString() } }
  });
}
async function getEditSession(chatId) {
  try { return await firestore('GET', docPath(EDIT_SESSION_COLLECTION, String(chatId))); }
  catch (e) { return null; }
}
async function clearEditSession(chatId) {
  try { await firestore('DELETE', docPath(EDIT_SESSION_COLLECTION, String(chatId))); } catch (e) {}
}

/* ── Parse + transform ── */
function extractQuestionId(replyText = '') {
  const match = String(replyText || '').match(/(?:ID:|🆔 )\s*<\/?(?:b|code|i)?>\s*([A-Za-z0-9_-]{8,80})/i)
         || String(replyText || '').match(/\b([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/i)
         || String(replyText || '').match(/\bID:\s*([A-Za-z0-9_-]{8,80})/i);
  return match ? match[1] : '';
}

function fromFirestoreDoc(doc) {
  const f = doc.fields || {};
  return {
    id: f.id?.stringValue || (doc.name ? doc.name.split('/').pop() : ''),
    name: f.name?.stringValue || 'Anonymous',
    question: f.question?.stringValue || '',
    answer: f.answer?.stringValue || '',
    answered: !!f.answered?.booleanValue,
    dismissed: !!f.dismissed?.booleanValue,
    createdAt: f.createdAt?.stringValue || '',
    answeredAt: f.answeredAt?.stringValue || '',
    votes: Number(f.votes?.integerValue || f.votes?.doubleValue || 0)
  };
}

function questionState(q) {
  if (q.dismissed) return 'DISMISSED';
  if (q.answered || String(q.answer || '').trim()) return 'ANSWERED';
  return 'UNANSWERED';
}

async function listAllQuestions() {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId()}/databases/(default)/documents/${COLLECTION}?pageSize=200`;
  const data = await firestore('GET', url);
  return (data.documents || []).map(fromFirestoreDoc);
}

async function getStats() {
  const all = await listAllQuestions();
  const unanswered = all.filter(q => questionState(q) === 'UNANSWERED').length;
  const answered = all.filter(q => questionState(q) === 'ANSWERED').length;
  const dismissed = all.filter(q => questionState(q) === 'DISMISSED').length;
  const totalVotes = all.reduce((s, q) => s + (q.votes || 0), 0);
  return { total: all.length, unanswered, answered, dismissed, totalVotes };
}

/* ── Command messages ── */
const HELP_TEXT = [
  `<b>🤖 AMA Bot — Commands</b>`,
  ``,
  `<b>📋 Commands:</b>`,
  `• <b>/help</b> — Show this menu`,
  `• <b>/stats</b> — Question statistics`,
  `• <b>/pending</b> — List unanswered questions`,
  `• <b>/refresh</b> — List unanswered + dismissed`,
  ``,
  `<b>⚡ Quick actions (via buttons):</b>`,
  `• <b>💬 Answer</b> — Reply to any question message`,
  `• <b>🙈 Dismiss</b> — Hide a question (keeps data)`,
  `• <b>🗑 Delete</b> — Permanently remove`,
  `• <b>✏️ Edit</b> — Change your answer to a question`,
  ``,
  `<i>Every new question from your site appears here automatically.</i>`
].join('\n');

const WELCOME_TEXT = [
  `<b>👋 Welcome, Yatin!</b>`,
  ``,
  `This bot manages the <b>Ask Me Anything</b> box on your portfolio.`,
  ``,
  `When someone asks a question, it appears here with action buttons.`,
  ``,
  `Type <b>/help</b> to see all commands.`
].join('\n');

/* ============================================================
   HANDLER
   ============================================================ */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, message: 'Telegram webhook endpoint is live.' });
  }

  // ✅ FAIL-CLOSED webhook secret
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error('TELEGRAM_WEBHOOK_SECRET is not set — refusing to process webhook.');
    return res.status(500).json({ ok: false, error: 'Webhook secret not configured.' });
  }
  if (req.headers['x-telegram-bot-api-secret-token'] !== expectedSecret) {
    return res.status(401).json({ ok: false, error: 'Invalid Telegram webhook secret' });
  }

  try {
    const update = jsonBody(req);
    const message = update.message || update.edited_message;
    const callback = update.callback_query;

    /* ── INLINE BUTTON PRESS ── */
    if (callback) {
      const cbChatId = callback.message?.chat?.id;
      const cbMessageId = callback.message?.message_id;
      const allowedChatId = String(process.env.TELEGRAM_CHAT_ID || '');
      if (allowedChatId && String(cbChatId) !== allowedChatId) {
        return res.status(200).json({ ok: true, ignored: 'wrong chat' });
      }
      const data = callback.data || '';
      const [action, ...rest] = data.split(':');
      const questionId = rest.join(':');

      if (action === 'answer') {
        await answerCallback(callback.id, '💬 Reply to the question message above to type your answer.');
      }
      else if (action === 'dismiss') {
        try {
          await dismissQuestion(questionId);
          await answerCallback(callback.id, '🙈 Dismissed');
          await editMessage(cbChatId, cbMessageId, `🙈 <b>This question was dismissed.</b>\n🆔 <code>${esc(questionId)}</code>`);
        } catch (e) { await answerCallback(callback.id, '⚠️ Could not dismiss'); }
      }
      else if (action === 'delete') {
        try {
          await deleteQuestion(questionId);
          await answerCallback(callback.id, '🗑 Deleted');
          await editMessage(cbChatId, cbMessageId, `🗑 <b>This question was deleted.</b>`);
        } catch (e) { await answerCallback(callback.id, '⚠️ Could not delete'); }
      }
      else if (action === 'edit') {
        try {
          await saveEditSession(cbChatId, questionId);
          await answerCallback(callback.id, '✏️ Send the new answer now');
          await sendTelegram(cbChatId, `✏️ <b>Edit Answer</b>\nSend the new answer text for this question:\n<code>${esc(questionId)}</code>\n\n<i>Type the new answer as your next message.</i>`);
        } catch (e) { await answerCallback(callback.id, '⚠️ Could not start edit'); }
      }
      else {
        await answerCallback(callback.id, 'Unknown action');
      }
      return res.status(200).json({ ok: true, callback: action });
    }

    /* ── TEXT MESSAGE ── */
    if (!message) return res.status(200).json({ ok: true, ignored: 'no message' });

    const chatId = message.chat?.id;
    const allowedChatId = String(process.env.TELEGRAM_CHAT_ID || '');
    if (allowedChatId && String(chatId) !== allowedChatId) {
      return res.status(200).json({ ok: true, ignored: 'wrong chat' });
    }

    const text = String(message.text || message.caption || '').trim();
    if (!text) return res.status(200).json({ ok: true, ignored: 'empty' });
    const command = text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, ''); // strip @botname

    /* /start */
    if (command === '/start') {
      await sendTelegram(chatId, WELCOME_TEXT, message.message_id);
      return res.status(200).json({ ok: true });
    }

    /* /help */
    if (command === '/help') {
      await sendTelegram(chatId, HELP_TEXT, message.message_id);
      return res.status(200).json({ ok: true });
    }

    /* /stats */
    if (command === '/stats') {
      try {
        const s = await getStats();
        const statsText = [
          `<b>📊 AMA Statistics</b>`,
          ``,
          `📥 <b>Total questions:</b> ${s.total}`,
          `⏳ <b>Unanswered:</b> ${s.unanswered}`,
          `✅ <b>Answered:</b> ${s.answered}`,
          `🙈 <b>Dismissed:</b> ${s.dismissed}`,
          `👍 <b>Total votes:</b> ${s.totalVotes}`
        ].join('\n');
        await sendTelegram(chatId, statsText, message.message_id);
      } catch (e) { await sendTelegram(chatId, '⚠️ Could not load stats.', message.message_id); }
      return res.status(200).json({ ok: true });
    }

    /* /pending — list unanswered only */
    if (command === '/pending') {
      const all = await listAllQuestions();
      const items = all.filter(q => questionState(q) === 'UNANSWERED')
                       .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      if (!items.length) { await sendTelegram(chatId, '✅ <b>No unanswered questions.</b> All caught up!', message.message_id); return res.status(200).json({ ok: true }); }
      await sendQuestionsList(chatId, '⏳ <b>Unanswered Questions</b>', items, message.message_id);
      return res.status(200).json({ ok: true });
    }

    /* /refresh — unanswered + dismissed */
    if (command === '/refresh') {
      const all = await listAllQuestions();
      const items = all.filter(q => questionState(q) === 'UNANSWERED' || questionState(q) === 'DISMISSED')
                       .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      if (!items.length) { await sendTelegram(chatId, '✅ <b>No pending or dismissed questions.</b>', message.message_id); return res.status(200).json({ ok: true }); }
      await sendQuestionsList(chatId, '📋 <b>Pending & Dismissed Questions</b>', items, message.message_id);
      return res.status(200).json({ ok: true });
    }

    /* If /edit was started, next normal message becomes the new ANSWER */
    const pending = await getEditSession(chatId);
    const pendingQuestionId = pending?.fields?.questionId?.stringValue;
    if (pendingQuestionId && !text.startsWith('/')) {
      await answerQuestion(pendingQuestionId, text);
      await clearEditSession(chatId);
      await sendTelegram(chatId, `✅ <b>Answer updated.</b>\n🆔 <code>${esc(pendingQuestionId)}</code>\n\n<i>Refresh your website to see the change.</i>`, message.message_id);
      return res.status(200).json({ ok: true, edited: pendingQuestionId });
    }

    /* Unknown command */
    if (text.startsWith('/')) {
      await sendTelegram(chatId, `❓ Unknown command.\n\nType <b>/help</b> to see available commands.`, message.message_id);
      return res.status(200).json({ ok: true });
    }

    /* Reply to a question message = answer it */
    const originalText = message.reply_to_message?.text || message.reply_to_message?.caption || '';
    const questionId = extractQuestionId(originalText);

    if (!questionId) {
      await sendTelegram(chatId, `💡 <i>To answer a question, reply to the bot message that contains it. Or type</i> /help <i>for commands.</i>`, message.message_id);
      return res.status(200).json({ ok: true, ignored: 'no question id' });
    }

    await answerQuestion(questionId, text);
    await sendTelegram(chatId, [
      `✅ <b>Answer published!</b>`,
      `🆔 <code>${esc(questionId)}</code>`,
      `💬 Your answer is now live on the website.`,
      ``,
      `<i>Refresh the page to see it.</i>`
    ].join('\n'), message.message_id);
    return res.status(200).json({ ok: true, answered: questionId });

  } catch (error) {
    console.error('Telegram webhook failed:', error);
    return res.status(200).json({ ok: false, error: error.message || 'Webhook failed' });
  }
};

/* ── Helper: send a paginated list of questions with buttons ── */
async function sendQuestionsList(chatId, title, items, replyToId) {
  let chunk = title + '\n\n';
  let sent = 0;
  for (let i = 0; i < items.length; i++) {
    const q = items[i];
    const tag = questionState(q);
    const tagEmoji = tag === 'UNANSWERED' ? '⏳' : '🙈';
    const line = `${i + 1}. ${tagEmoji} <b>[${tag}]</b> ${esc(q.name)}\n   <i>${esc(q.question).slice(0, 120)}</i>\n   🆔 <code>${esc(q.id)}</code>\n`;
    if ((chunk + line + '\n').length > 3500) {
      await sendTelegram(chatId, chunk.trim(), sent === 0 ? replyToId : undefined);
      sent++; chunk = '';
    }
    chunk += line + '\n';
  }
  if (chunk.trim()) { await sendTelegram(chatId, chunk.trim(), sent === 0 ? replyToId : undefined); sent++; }
  await sendTelegram(chatId, `<i>${items.length} question${items.length === 1 ? '' : 's'} listed. Reply to any question message to answer it, or use its buttons.</i>`);
}
