/* ============================================================
   api/telegram-webhook.js  —  Vercel serverless function
   The brain of the AMA Telegram interaction.

   Handles:
   • Inline button presses (Answer / Dismiss / Delete / Edit)
   • Delete confirmation flow (2-step)
   • Reply-to-message answers (free-form text)
   • /start, /help, /stats, /refresh, /pending commands
   • After-action status cards with timestamps

   Security: webhook secret is FAIL-CLOSED.
   ============================================================ */

const crypto = require('crypto');

const TELEGRAM_API = 'https://api.telegram.org/bot';
const COLLECTION = 'amaQuestions';
const EDIT_SESSION_COLLECTION = 'telegramEditSessions';
const LOOKUP_SESSION_COLLECTION = 'telegramLookupSessions';

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

/* ── Lookup session (for /lookup interactive flow) ── */
async function saveLookupSession(chatId) {
  return firestore('PATCH', docPath(LOOKUP_SESSION_COLLECTION, String(chatId)), {
    fields: { chatId: { stringValue: String(chatId) }, createdAt: { stringValue: new Date().toISOString() } }
  });
}
async function getLookupSession(chatId) {
  try { return await firestore('GET', docPath(LOOKUP_SESSION_COLLECTION, String(chatId))); }
  catch (e) { return null; }
}
async function clearLookupSession(chatId) {
  try { await firestore('DELETE', docPath(LOOKUP_SESSION_COLLECTION, String(chatId))); } catch (e) {}
}

/* ── Build one page of /all list ── */
const ALL_PER_PAGE = 4;
function buildAllPageText(sorted, page) {
  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / ALL_PER_PAGE));
  if (page > pages) page = pages;
  if (page < 1) page = 1;
  const start = (page - 1) * ALL_PER_PAGE;
  const slice = sorted.slice(start, start + ALL_PER_PAGE);
  const lines = [
    '\u250C\u2500\uD83D\uDCCB <b>ALL QUESTIONS</b> (' + total + ') \u2500 Page ' + page + '/' + pages + '\u2500\u2500\u2500\u2500\u2510',
    '\u2502'
  ];
  for (let i = 0; i < slice.length; i++) {
    const q = slice[i];
    const state = questionState(q);
    const stateEmoji = state === 'ANSWERED' ? '\u2705' : state === 'DISMISSED' ? '\uD83D\uDE48' : '\u23F3';
    const qAge = timeAgo(q.createdAt);
    lines.push('\u2502  ' + stateEmoji + ' <b>[' + state + ']</b> ' + esc(q.name) + (qAge ? ' \u00B7 ' + esc(qAge) : ''));
    lines.push('\u2502  \uD83D\uDCAC <blockquote>' + esc(q.question).slice(0, 120) + '</blockquote>');
    if (state === 'ANSWERED' && q.answer) {
      lines.push('\u2502  \u2705 <blockquote>' + esc(q.answer).slice(0, 100) + '</blockquote>');
    }
    if (q.votes > 0) lines.push('\u2502  \uD83D\uDC4D ' + q.votes + ' votes');
    lines.push('\u2502  \uD83C\uDD94 <code>' + esc(q.id) + '</code>');
    lines.push('\u2502');
  }
  lines.push('\u2502  <i>Tap ID to copy \u00B7 /get id for actions</i>');
  lines.push('\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518');
  return { text: lines.join('\n'), pages, page };
}
function buildAllPageButtons(page, pages) {
  const row = [];
  if (page > 1) row.push({ text: '\u25C0 Previous', callback_data: 'all:page:' + (page - 1) });
  row.push({ text: page + ' / ' + pages, callback_data: 'all:noop' });
  if (page < pages) row.push({ text: 'Next \u25B6', callback_data: 'all:page:' + (page + 1) });
  return { inline_keyboard: [row] };
}

/* ── Build full detail card for /get and /lookup ── */
async function sendFullDetailCard(chatId, questionId, replyToId) {
  const q = await getQuestion(questionId);
  if (!q) {
    await sendTelegram(chatId, '\u250C\u2500\u26A0\uFE0F <b>NOT FOUND</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n\u2502\n\u2502  No question found with that ID.\n\u2502\n\u2502  \uD83C\uDD94 <code>' + esc(questionId) + '</code>\n\u2502\n\u2502  Send /all to browse all IDs.\n\u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', replyToId);
    return;
  }
  const state = questionState(q);
  const stateEmoji = state === 'ANSWERED' ? '\u2705' : state === 'DISMISSED' ? '\uD83D\uDE48' : '\u23F3';
  const rTime = responseTime(q.createdAt, q.answeredAt);
  const qAge = timeAgo(q.createdAt);

  const lines = [
    '\u250C\u2500\uD83D\uDCCB <b>QUESTION DETAILS</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510',
    '\u2502',
    '\u2502  ' + stateEmoji + ' Status: <b>' + state + '</b>',
    '\u2502',
    '\u2502  \uD83D\uDC64 <b>' + esc(q.name) + '</b>',
    '\u2502  \uD83D\uDCAC <blockquote>' + esc(q.question) + '</blockquote>',
    '\u2502',
    '\u2502  \uD83D\uDD50 Asked ' + esc(formatTime(q.createdAt)) + ' IST' + (qAge ? ' \u00B7 ' + esc(qAge) : '')
  ];

  if (state === 'ANSWERED') {
    lines.push('\u2502');
    lines.push('\u2502  \u2705 <b>Answer:</b>');
    lines.push('\u2502  <blockquote>' + esc(q.answer) + '</blockquote>');
    lines.push('\u2502  \uD83D\uDD50 Answered ' + esc(formatTime(q.answeredAt)) + ' IST');
    if (rTime) lines.push('\u2502  \u26A1 Responded in <b>' + esc(rTime) + '</b>');
  }

  if (q.votes > 0) lines.push('\u2502  \uD83D\uDC4D ' + q.votes + ' votes');
  lines.push('\u2502');
  lines.push('\u2502  \uD83C\uDD94 <code>' + esc(q.id) + '</code>');
  lines.push('\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518');

  const buttons = [];
  if (state === 'UNANSWERED' || state === 'DISMISSED') {
    buttons.push([{ text: '\uD83D\uDCAC  Answer', callback_data: 'answer:' + q.id }]);
  }
  buttons.push([{ text: '\u270F\uFE0F  Edit Answer', callback_data: 'edit:' + q.id }]);
  buttons.push([
    { text: '\uD83D\uDE48  Dismiss', callback_data: 'dismiss:' + q.id },
    { text: '\uD83D\uDDD1  Delete', callback_data: 'delete:' + q.id }
  ]);

  await sendTelegram(chatId, lines.join('\n'), replyToId, { inline_keyboard: buttons });
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
  const answeredQs = all.filter(q => questionState(q) === 'ANSWERED');
  const mostVoted = answeredQs.length > 0 ? answeredQs.reduce((max, q) => (q.votes || 0) > (max.votes || 0) ? q : max) : null;
  return { total: all.length, unanswered, answered, dismissed, totalVotes, mostVoted };
}

/* ── Time formatter ── */
function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: true
    });
  } catch (e) { return ''; }
}

/* ── Relative time (e.g. "2h 15m ago", "3d ago") ── */
function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ' + (mins % 60) + 'm ago';
  const days = Math.floor(hrs / 24);
  return days + 'd ' + (hrs % 24) + 'h ago';
}

/* ── Response time between question creation and answer ── */
function responseTime(createdAt, answeredAt) {
  if (!createdAt || !answeredAt) return '';
  const ms = new Date(answeredAt).getTime() - new Date(createdAt).getTime();
  if (ms < 0) return 'instantly';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'under 1 min';
  if (mins < 60) return mins + ' min';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ' + (mins % 60) + 'm';
  const days = Math.floor(hrs / 24);
  return days + 'd ' + (hrs % 24) + 'h';
}

/* ── Unicode progress bar ── */
function progressBar(value, max, width) {
  width = width || 10;
  if (max === 0) return '\u2591'.repeat(width);
  const filled = Math.round((value / max) * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

/* ── 4. POLISHED STATS DASHBOARD ── */
async function sendStats(chatId, replyToId) {
  try {
    const s = await getStats();
    const maxStat = Math.max(s.total, 1);

    let mv = '';
    if (s.mostVoted) {
      const qText = esc(s.mostVoted.question).slice(0, 45);
      mv = '\n\u2502\n\u2502  \uD83D\uDD25 <b>Top Question</b>\n\u2502  "' + qText + '"\n\u2502  with ' + (s.mostVoted.votes || 0) + ' \uD83D\uDC4D votes';
    }

    const statsText = [
      '\u250C\u2500\uD83D\uDCCA <b>AMA DASHBOARD</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510',
      '\u2502',
      '\u2502  \uD83D\uDCEC Total \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 <b>' + s.total + '</b>',
      '\u2502',
      '\u2502  \u23F3 Pending \u2500\u2500\u2500\u2500\u2500\u2500 ' + progressBar(s.unanswered, maxStat) + ' <b>' + s.unanswered + '</b>',
      '\u2502  \u2705 Answered \u2500\u2500\u2500\u2500\u2500\u2500 ' + progressBar(s.answered, maxStat) + ' <b>' + s.answered + '</b>',
      '\u2502  \uD83D\uDE48 Dismissed \u2500\u2500\u2500\u2500\u2500 ' + progressBar(s.dismissed, maxStat) + ' <b>' + s.dismissed + '</b>',
      '\u2502',
      '\u2502  \uD83D\uDC4D Total votes \u2500\u2500\u2500 <b>' + s.totalVotes + '</b>' + mv,
      '\u2502',
      '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518'
    ].join('\n');
    await sendTelegram(chatId, statsText, replyToId);
  } catch (e) {
    await sendTelegram(chatId,
      '\u250C\u2500\u26A0\uFE0F <b>ERROR</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n\u2502\n\u2502  Could not load statistics.\n\u2502  Try again in a moment.\n\u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518',
      replyToId);
  }
}

/* ── Fetch a single question ── */
async function getQuestion(id) {
  try {
    const doc = await firestore('GET', docPath(COLLECTION, id));
    return fromFirestoreDoc(doc);
  } catch (e) {
    return null;
  }
}

/* ── Build and send the rich "Answered" card with buttons ── */
async function sendAnsweredCard(chatId, questionId, answerText, replyToId, isUpdate) {
  isUpdate = isUpdate || false;
  const q = await getQuestion(questionId);
  const qName = q ? q.name : 'Anonymous';
  const qText = q ? q.question : 'Question text unavailable';
  const qVotes = q ? q.votes : 0;
  const rTime = q ? responseTime(q.createdAt, q.answeredAt) : '';
  const qAge = q ? timeAgo(q.createdAt) : '';

  const headerText = isUpdate ? '\u2705 <b>ANSWER UPDATED</b>' : '\u2705 <b>ANSWER PUBLISHED</b>';

  let metaLine = '';
  if (rTime) metaLine += '\n\u2502  \u26A1 Responded in <b>' + esc(rTime) + '</b>';
  if (qAge) metaLine += '\n\u2502  \uD83D\uDD50 Question was ' + esc(qAge);
  if (qVotes > 0) metaLine += '\n\u2502  \uD83D\uDC4D ' + qVotes + ' votes';

  const text = [
    '\u250C\u2500' + headerText + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510',
    '\u2502',
    '\u2502  \uD83D\uDC64 <b>' + esc(qName) + '</b> asked:',
    '\u2502  <blockquote>' + esc(qText) + '</blockquote>',
    '\u2502',
    '\u2502  \uD83D\uDCAC <b>Your answer:</b>',
    '\u2502  <blockquote>' + esc(answerText) + '</blockquote>',
    '\u2502' + metaLine,
    '\u2502',
    '\u2502  \uD83C\uDD94 <code>' + esc(questionId) + '</code>',
    '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518'
  ].join('\n');

  const replyMarkup = {
    inline_keyboard: [
      [{ text: '\u270F\uFE0F  Edit Answer', callback_data: 'edit:' + questionId }],
      [
        { text: '\uD83D\uDE48  Dismiss', callback_data: 'dismiss:' + questionId },
        { text: '\uD83D\uDDD1  Delete', callback_data: 'delete:' + questionId }
      ]
    ]
  };

  await sendTelegram(chatId, text, replyToId, replyMarkup);
}

/* ── Build the correct card (text + buttons) for a question's CURRENT state.
   Used to restore the exact original message when a Delete action is
   cancelled — instead of showing a generic "Question Restored" stub. ── */
function buildCardForQuestion(q) {
  const state = questionState(q);

  if (state === 'ANSWERED') {
    const rTime = responseTime(q.createdAt, q.answeredAt);
    const qAge = timeAgo(q.createdAt);
    let metaLine = '';
    if (rTime) metaLine += '\n\u2502  \u26A1 Responded in <b>' + esc(rTime) + '</b>';
    if (qAge) metaLine += '\n\u2502  \uD83D\uDD50 Question was ' + esc(qAge);
    if (q.votes > 0) metaLine += '\n\u2502  \uD83D\uDC4D ' + q.votes + ' votes';

    const text = [
      '\u250C\u2500\u2705 <b>ANSWER PUBLISHED</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510',
      '\u2502',
      '\u2502  \uD83D\uDC64 <b>' + esc(q.name) + '</b> asked:',
      '\u2502  <blockquote>' + esc(q.question) + '</blockquote>',
      '\u2502',
      '\u2502  \uD83D\uDCAC <b>Your answer:</b>',
      '\u2502  <blockquote>' + esc(q.answer) + '</blockquote>',
      '\u2502' + metaLine,
      '\u2502',
      '\u2502  \uD83C\uDD94 <code>' + esc(q.id) + '</code>',
      '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518'
    ].join('\n');
    const replyMarkup = {
      inline_keyboard: [
        [{ text: '\u270F\uFE0F  Edit Answer', callback_data: 'edit:' + q.id }],
        [
          { text: '\uD83D\uDE48  Dismiss', callback_data: 'dismiss:' + q.id },
          { text: '\uD83D\uDDD1  Delete', callback_data: 'delete:' + q.id }
        ]
      ]
    };
    return { text, replyMarkup };
  }

  if (state === 'DISMISSED') {
    const text = [
      '\u250C\u2500\uD83D\uDE48 <b>QUESTION DISMISSED</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510',
      '\u2502',
      '\u2502  \uD83D\uDC64 <b>' + esc(q.name) + '</b> asked:',
      '\u2502  <blockquote>' + esc(q.question) + '</blockquote>',
      '\u2502',
      '\u2502  This question is hidden from your site.',
      '\u2502  Data is safely preserved.',
      '\u2502',
      '\u2502  \uD83C\uDD94 <code>' + esc(q.id) + '</code>',
      '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518'
    ].join('\n');
    const replyMarkup = {
      inline_keyboard: [
        [{ text: '\uD83D\uDCAC  Answer', callback_data: 'answer:' + q.id }],
        [{ text: '\u270F\uFE0F  Edit Answer', callback_data: 'edit:' + q.id }],
        [
          { text: '\uD83D\uDE48  Dismiss', callback_data: 'dismiss:' + q.id },
          { text: '\uD83D\uDDD1  Delete', callback_data: 'delete:' + q.id }
        ]
      ]
    };
    return { text, replyMarkup };
  }

  // UNANSWERED — the original "New Question" notification card
  const qAge = timeAgo(q.createdAt);
  const text = [
    '\u250C\u2500\uD83D\uDCE8 <b>INCOMING QUESTION</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510',
    '\u2502',
    '\u2502  \uD83D\uDC64  <b>' + esc(q.name) + '</b>',
    '\u2502',
    '\u2502  \uD83D\uDCAC  <blockquote>' + esc(q.question) + '</blockquote>',
    '\u2502',
    '\u2502  \uD83D\uDD50  ' + esc(formatTime(q.createdAt)) + ' IST' + (qAge ? ' \u00B7 ' + esc(qAge) : ''),
    '\u2502  \uD83C\uDD94  <code>' + esc(q.id) + '</code>',
    '\u2502',
    '\u2514\u2500\u26A1 <i>reply below to answer</i>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518'
  ].join('\n');
  const replyMarkup = {
    inline_keyboard: [
      [{ text: '\uD83D\uDCAC  Answer', callback_data: 'answer:' + q.id }],
      [{ text: '\u270F\uFE0F  Edit Answer', callback_data: 'edit:' + q.id }],
      [
        { text: '\uD83D\uDE48  Dismiss', callback_data: 'dismiss:' + q.id },
        { text: '\uD83D\uDDD1  Delete', callback_data: 'delete:' + q.id }
      ]
    ]
  };
  return { text, replyMarkup };
}

/* ── Command messages ── */
const HELP_TEXT = [
  '\u250C\u2500\uD83D\uDD16 <b>AMA BOT \u00B7 COMMANDS</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510',
  '\u2502',
  '\u2502  <b>\uD83D\uDCCB Commands</b>',
  '\u2502  \u2022 <b>/help</b> \u2500 Show this menu',
  '\u2502  \u2022 <b>/stats</b> \u2500 Statistics dashboard',
  '\u2502  \u2022 <b>/pending</b> \u2500 Unanswered questions',
  '\u2502  \u2022 <b>/refresh</b> \u2500 Unanswered + dismissed',
  '\u2502',
  '\u2502  <b>\uD83D\uDD0D Lookup & Browse</b>',
  '\u2502  \u2022 <b>/all</b> \u2500 Browse all Q&A (tap ID to copy)',
  '\u2502  \u2022 <b>/get id</b> \u2500 Full detail + action buttons',
  '\u2502  \u2022 <b>/lookup</b> \u2500 Interactive: paste ID next',
  '\u2502',
  '\u2502  <b>\u26A1 Quick Actions (via buttons)</b>',
  '\u2502  \u2022 <b>\uD83D\uDCAC Answer</b> \u2500 Reply to a question msg',
  '\u2502  \u2022 <b>\u270F\uFE0F Edit</b> \u2500 Change your reply',
  '\u2502  \u2022 <b>\uD83D\uDE48 Dismiss</b> \u2500 Hide (keeps data)',
  '\u2502  \u2022 <b>\uD83D\uDDD1 Delete</b> \u2500 Remove permanently',
  '\u2502',
  '\u2502  <i>New questions arrive here automatically.</i>',
  '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518'
].join('\n');

const WELCOME_TEXT = [
  '\u250C\u2500\uD83E\uDD16 <b>AMA BOT v2.0</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510',
  '\u2502',
  '\u2502  <i>welcome back, overlord.</i>',
  '\u2502',
  '\u2502  Your AMA command center is online.',
  '\u2502  Visitor questions get piped here',
  '\u2502  straight from your portfolio.',
  '\u2502',
  '\u2502  <b>Quick Start:</b>',
  '\u2502  \u2022 <b>/help</b> \u2500 See all commands',
  '\u2502  \u2022 <b>/stats</b> \u2500 View dashboard',
  '\u2502  \u2022 <b>/pending</b> \u2500 Check queue',
  '\u2502',
  '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518'
].join('\n');

/* ============================================================
   HANDLER
   ============================================================ */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, message: 'Telegram webhook endpoint is live.' });
  }

  // FAIL-CLOSED webhook secret
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

      // DELETE CONFIRMATION FLOW
      if (action === 'delete') {
        await answerCallback(callback.id, '\u26A0\uFE0F Confirm deletion?');
        await editMessage(cbChatId, cbMessageId,
          '\u250C\u2500\u26A0\uFE0F <b>CONFIRM DELETE</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n\u2502\n\u2502  Are you sure you want to\n\u2502  <b>permanently delete</b> this question?\n\u2502\n\u2502  \uD83C\uDD94 <code>' + esc(questionId) + '</code>\n\u2502\n\u2502  <i>This cannot be undone.</i>\n\u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518',
          { inline_keyboard: [[
            { text: '\u2705 Confirm Delete', callback_data: 'confirmdelete:' + questionId },
            { text: '\u274C Cancel', callback_data: 'canceldelete:' + questionId }
          ]] }
        );
      }
      else if (action === 'confirmdelete') {
        try {
          await deleteQuestion(questionId);
          await answerCallback(callback.id, '\u2705 Deleted permanently');
          await editMessage(cbChatId, cbMessageId,
            '\u250C\u2500\uD83D\uDDD1 <b>QUESTION DELETED</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n\u2502\n\u2502  This question and all its data have\n\u2502  been permanently removed.\n\u2502\n\u2502  \uD83D\uDD50 ' + formatTime(new Date().toISOString()) + ' IST\n\u2502  \u26A0\uFE0F <i>This action cannot be undone</i>\n\u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518'
          );
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not delete'); }
      }
      else if (action === 'canceldelete') {
        await answerCallback(callback.id, 'Cancelled');
        try {
          const q = await getQuestion(questionId);
          if (q) {
            const { text, replyMarkup } = buildCardForQuestion(q);
            await editMessage(cbChatId, cbMessageId, text, replyMarkup);
          } else {
            await editMessage(cbChatId, cbMessageId,
              '\u250C\u2500\u26A0\uFE0F <b>QUESTION NOT FOUND</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n\u2502\n\u2502  It may have already been deleted.\n\u2502\n\u2502  \uD83C\uDD94 <code>' + esc(questionId) + '</code>\n\u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518'
            );
          }
        } catch (e) {
          await editMessage(cbChatId, cbMessageId,
            '\u250C\u2500\u26A0\uFE0F <b>RESTORE FAILED</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n\u2502\n\u2502  Could not restore the question.\n\u2502  Try <b>/refresh</b> to see current state.\n\u2502\n\u2502  \uD83C\uDD94 <code>' + esc(questionId) + '</code>\n\u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518'
          );
        }
      }
      else if (action === 'answer') {
        await answerCallback(callback.id, '\uD83D\uDCAC Reply to the question message above to type your answer.');
      }
      else if (action === 'dismiss') {
        try {
          await dismissQuestion(questionId);
          await answerCallback(callback.id, '\uD83D\uDE48 Dismissed');
          await editMessage(cbChatId, cbMessageId,
            '\u250C\u2500\uD83D\uDE48 <b>QUESTION DISMISSED</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n\u2502\n\u2502  This question has been hidden\n\u2502  from your website.\n\u2502\n\u2502  Data is safely preserved.\n\u2502\n\u2502  \uD83C\uDD94 <code>' + esc(questionId) + '</code>\n\u2502  \uD83D\uDD50 ' + formatTime(new Date().toISOString()) + ' IST\n\u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518'
          );
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not dismiss'); }
      }
      else if (action === 'edit') {
        try {
          await saveEditSession(cbChatId, questionId);
          await answerCallback(callback.id, '\u270F\uFE0F Send the new answer now');
          await sendTelegram(cbChatId,
            '\u250C\u2500\u270F\uFE0F <b>EDIT MODE</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n\u2502\n\u2502  Send the new answer text for:\n\u2502  \uD83C\uDD94 <code>' + esc(questionId) + '</code>\n\u2502\n\u2502  <i>Type your new answer as\n\u2502  your next message.</i>\n\u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518'
          );
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not start edit'); }
      }
      else if (action === 'all') {
        // Pagination for /all command
        const page = parseInt(questionId, 10) || 1;
        try {
          const all = await listAllQuestions();
          const sorted = all.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
          const { text, pages } = buildAllPageText(sorted, page);
          await answerCallback(callback.id, 'Page ' + page + '/' + pages);
          await editMessage(cbChatId, cbMessageId, text, buildAllPageButtons(page, pages));
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Error loading page'); }
      }
      else if (action === 'noop') {
        await answerCallback(callback.id, '');
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
    const command = text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, '');

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
      await sendStats(chatId, message.message_id);
      return res.status(200).json({ ok: true });
    }

    /* /pending */
    if (command === '/pending') {
      const all = await listAllQuestions();
      const items = all.filter(q => questionState(q) === 'UNANSWERED')
                       .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      if (!items.length) {
        await sendTelegram(chatId,
          '\u250C\u2500\u2705 <b>ALL CLEAR</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n\u2502\n\u2502  No unanswered questions.\n\u2502  <i>You\u2019re all caught up. Go touch grass.</i>\n\u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518',
          message.message_id);
        return res.status(200).json({ ok: true });
      }
      await sendQuestionsList(chatId, '\u23F3 <b>UNANSWERED QUESTIONS</b>', items, message.message_id);
      return res.status(200).json({ ok: true });
    }

    /* /refresh */
    if (command === '/refresh') {
      const all = await listAllQuestions();
      const items = all.filter(q => questionState(q) === 'UNANSWERED' || questionState(q) === 'DISMISSED')
                       .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      if (!items.length) {
        await sendTelegram(chatId,
          '\u250C\u2500\u2705 <b>QUEUE EMPTY</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n\u2502\n\u2502  No pending or dismissed questions.\n\u2502  <i>Nothing in the queue right now.</i>\n\u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518',
          message.message_id);
        return res.status(200).json({ ok: true });
      }
      await sendQuestionsList(chatId, '\uD83D\uDCCB <b>PENDING & DISMISSED</b>', items, message.message_id);
      return res.status(200).json({ ok: true });
    }

    /* /get <id> */
    if (command === '/get') {
      const qid = text.split(/\s+/)[1];
      if (!qid) {
        await sendTelegram(chatId, '\u250C\u2500\uD83D\uDCA1 <b>TIP</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n\u2502\n\u2502  Send a question ID to look it up.\n\u2502\n\u2502  Example:\n\u2502  <code>/get a1b2c3d4-e5f6-...</code>\n\u2502\n\u2502  Send /all to browse all IDs.\n\u2502  Send /lookup for interactive mode.\n\u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', message.message_id);
        return res.status(200).json({ ok: true });
      }
      await sendFullDetailCard(chatId, qid, message.message_id);
      return res.status(200).json({ ok: true });
    }

    /* /lookup (interactive - waits for next message as ID) */
    if (command === '/lookup') {
      await saveLookupSession(chatId);
      await sendTelegram(chatId, '\u250C\u2500\uD83D\uDD0D <b>LOOKUP MODE</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n\u2502\n\u2502  Paste a question ID below.\n\u2502\n\u2502  Send /all to browse all IDs\n\u2502  and find the one you need.\n\u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', message.message_id);
      return res.status(200).json({ ok: true });
    }

    /* /all (one big message with all Q&A, copyable IDs) */
    if (command === '/all') {
      const all = await listAllQuestions();
      if (!all.length) {
        await sendTelegram(chatId, '\u250C\u2500\uD83D\uDCE8 <b>NO QUESTIONS</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n\u2502\n\u2502  No questions in the database yet.\n\u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', message.message_id);
        return res.status(200).json({ ok: true });
      }
      const sorted = all.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      const { text, pages, page } = buildAllPageText(sorted, 1);
      const buttons = buildAllPageButtons(page, pages);
      await sendTelegram(chatId, text, message.message_id, buttons);
      return res.status(200).json({ ok: true });
    }

    /* Edit answer session */
    const pending = await getEditSession(chatId);
    const pendingQuestionId = pending?.fields?.questionId?.stringValue;
    if (pendingQuestionId && !text.startsWith('/')) {
      await answerQuestion(pendingQuestionId, text);
      await clearEditSession(chatId);
      await sendAnsweredCard(chatId, pendingQuestionId, text, message.message_id, true);
      return res.status(200).json({ ok: true, edited: pendingQuestionId });
    }

    /* Lookup session (interactive /lookup flow) */
    const lookupSession = await getLookupSession(chatId);
    if (lookupSession && !text.startsWith('/')) {
      const pastedId = text.trim();
      await clearLookupSession(chatId);
      if (pastedId.length >= 8) {
        await sendFullDetailCard(chatId, pastedId, message.message_id);
      } else {
        await sendTelegram(chatId, '\u250C\u2500\u26A0\uFE0F <b>INVALID ID</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n',
          '\u2502\n',
          '\u2502  That ID looks too short.\n',
          '\u2502  Try again with /lookup.\n',
          '\u2502\n',
          '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518', message.message_id);
      }
      return res.status(200).json({ ok: true, lookup: pastedId });
    }

    /* Unknown command */
    if (text.startsWith('/')) {
      await sendTelegram(chatId,
        '\u250C\u2500\u2753 <b>UNKNOWN COMMAND</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n\u2502\n\u2502  That command doesn\u2019t exist.\n\u2502\n\u2502  Type <b>/help</b> to see\n\u2502  available commands.\n\u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518',
        message.message_id);
      return res.status(200).json({ ok: true });
    }

    /* Reply to a question message = answer it */
    const originalText = message.reply_to_message?.text || message.reply_to_message?.caption || '';
    const questionId = extractQuestionId(originalText);

    if (!questionId) {
      await sendTelegram(chatId,
        '\u250C\u2500\uD83D\uDCA1 <b>TIP</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n\u2502\n\u2502  To answer a question, reply to\n\u2502  the bot message that contains it.\n\u2502\n\u2502  Or type <b>/help</b> for commands.\n\u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518',
        message.message_id);
      return res.status(200).json({ ok: true, ignored: 'no question id' });
    }

    await answerQuestion(questionId, text);
    await sendAnsweredCard(chatId, questionId, text, message.message_id);
    return res.status(200).json({ ok: true, answered: questionId });

  } catch (error) {
    console.error('Telegram webhook failed:', error);
    return res.status(200).json({ ok: false, error: error.message || 'Webhook failed' });
  }
};

/* ── Helper: send a list of questions ── */
async function sendQuestionsList(chatId, title, items, replyToId) {
  let chunk = title + '\n\n';
  let sent = 0;
  for (let i = 0; i < items.length; i++) {
    const q = items[i];
    const tag = questionState(q);
    const tagEmoji = tag === 'UNANSWERED' ? '\u23F3' : '\uD83D\uDE48';
    const qAge = timeAgo(q.createdAt);
    const ageStr = qAge ? ' \u00B7 ' + esc(qAge) : '';
    const line = '\u250C\u2500' + tagEmoji + ' <b>[' + tag + ']</b> ' + esc(q.name) + ageStr + '\n\u2502  <blockquote>' + esc(q.question).slice(0, 120) + '</blockquote>\n\u2502  \uD83C\uDD94 <code>' + esc(q.id) + '</code>\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n';
    if ((chunk + line + '\n').length > 3500) {
      await sendTelegram(chatId, chunk.trim(), sent === 0 ? replyToId : undefined);
      sent++; chunk = '';
    }
    chunk += line + '\n';
  }
  if (chunk.trim()) { await sendTelegram(chatId, chunk.trim(), sent === 0 ? replyToId : undefined); sent++; }
  await sendTelegram(chatId, '<i>' + items.length + ' question' + (items.length === 1 ? '' : 's') + ' listed.\nReply to any question message to answer it, or use its buttons.</i>');
}
