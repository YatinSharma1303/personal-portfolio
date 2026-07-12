/* ============================================================
 api/telegram-webhook.js - Vercel serverless function v4.3
 The brain of the AMA Telegram interaction.

 Handles:
 - Inline button presses (Answer / Dismiss / Delete / Edit)
 - Delete confirmation flow (2-step)
 - Reply-to-message answers (free-form text)
 - /start, /help, /stats, /pending, /refresh, /recent
 - /search, /export, /pin, /answer, /get, /lookup, /all
 - /dismiss, /dismissall, /dismissed, /retrieve, /retrieveall
 - /delete, /deleteall, /edit, /pinned
 - Answer preview flow (preview -> confirm -> publish)
 - Reaction summary in detail cards
 - Telegram Reply Keyboard for quick actions

 Security: webhook secret is FAIL-CLOSED.
 ============================================================ */

var crypto = require('crypto');

var TELEGRAM_API = 'https://api.telegram.org/bot';
var COLLECTION = 'amaQuestions';
var EDIT_SESSION_COLLECTION = 'telegramEditSessions';
var LOOKUP_SESSION_COLLECTION = 'telegramLookupSessions';
var PREVIEW_SESSION_COLLECTION = 'telegramPreviewSessions';
var ANSWER_SESSION_COLLECTION = 'telegramAnswerSessions';
var SESSION_TTL_MS = 10 * 60 * 1000;

/* Per-invocation caches — cleared at the start of each webhook request.
   - _questionsCache avoids redundant listAllQuestions() calls within one request.
   - _cachedToken / _cachedTokenExpiry reuse the Google OAuth token across Firestore calls. */
var _questionsCache = null;

function isSessionExpired(sessionDoc) {
  if (!sessionDoc || !sessionDoc.fields) return true;
  var createdAt = sessionDoc.fields.createdAt && sessionDoc.fields.createdAt.stringValue;
  if (!createdAt) return true;
  return (Date.now() - new Date(createdAt).getTime()) > SESSION_TTL_MS;
}

/* -- helpers -- */
function jsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return req.body;
}

function esc(value) {
  value = value || '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function serviceAccount() {
  var raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_KEY');
  var parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY must contain client_email and private_key');
  }
  return parsed;
}

function projectId() {
  var sa = serviceAccount();
  return process.env.FIREBASE_PROJECT_ID || sa.project_id;
}

function docPath(collection, id) {
  return 'https://firestore.googleapis.com/v1/projects/' + projectId() + '/databases/(default)/documents/' + collection + '/' + encodeURIComponent(id);
}

/* -- Google OAuth: mint a service-account JWT (cached per invocation) -- */
var _cachedToken = null;
var _cachedTokenExpiry = 0;

async function googleAccessToken() {
  /* Reuse token if still valid for at least 60 more seconds.
     This avoids minting a new JWT for every Firestore call within
     a single webhook invocation (typically 2-5 calls). */
  if (_cachedToken && Date.now() < _cachedTokenExpiry - 60000) {
    return _cachedToken;
  }
  var sa = serviceAccount();
  var now = Math.floor(Date.now() / 1000);
  var header = { alg: 'RS256', typ: 'JWT' };
  var payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  };
  var unsigned = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(payload));
  var signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  var response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature })
  });
  var data = await response.json().catch(function() { return null; });
  if (!response.ok || !data || !data.access_token) {
    throw new Error((data && data.error_description) || (data && data.error) || 'Google token error ' + response.status);
  }
  _cachedToken = data.access_token;
  _cachedTokenExpiry = Date.now() + ((data.expires_in || 3600) * 1000);
  return _cachedToken;
}

/* -- Firestore REST wrapper -- */
async function firestore(method, url, body) {
  var token = await googleAccessToken();
  var response = await fetch(url, {
    method: method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined
  });
  var data = await response.json().catch(function() { return null; });
  if (!response.ok) throw new Error((data && data.error && data.error.message) || 'Firestore ' + method + ' error ' + response.status);
  return data;
}

function mask(fields) {
  return fields.map(function(f) { return 'updateMask.fieldPaths=' + encodeURIComponent(f); }).join('&');
}

/* -- Telegram send helper -- */
async function sendTelegram(chatId, text, replyToMessageId, replyMarkup) {
  var botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !chatId) return;
  var result = await fetch(TELEGRAM_API + botToken + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, text: text, parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_to_message_id: replyToMessageId,
      allow_sending_without_reply: true,
      reply_markup: replyMarkup
    })
  });
  var data = await result.json().catch(function() { return null; });
  if (!result.ok || !data || !data.ok) {
    console.error('sendTelegram failed:', (data && data.description) || result.status);
    return null;
  }
  return data.result || null;
}

/* -- Answer callback query -- */
async function answerCallback(callbackId, text) {
  var botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;
  var result = await fetch(TELEGRAM_API + botToken + '/answerCallbackQuery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text: text, show_alert: false })
  });
  var data = await result.json().catch(function() { return null; });
  if (!result.ok) console.error('answerCallback failed:', (data && data.description) || result.status);
}

/* -- Edit the original message -- */
async function editMessage(chatId, messageId, text, replyMarkup) {
  var botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;

  /* Telegram editMessageText only accepts InlineKeyboardMarkup.
     Reply keyboards ({ keyboard: ... }) are valid for sendMessage,
     but invalid for edits and were causing loading cards to stay stuck.
     So when editing a loading card into final content, keep inline buttons
     if present and silently omit regular reply keyboards. */
  var payload = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: 'HTML'
  };
  if (replyMarkup && replyMarkup.inline_keyboard) payload.reply_markup = replyMarkup;

  var result = await fetch(TELEGRAM_API + botToken + '/editMessageText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  var data = await result.json().catch(function() { return null; });
  if (!result.ok) {
    console.error('editMessage failed:', (data && data.description) || result.status);
    return null;
  }
  return data && data.result ? data.result : null;
}

/* -- Question CRUD -- */
async function answerQuestion(id, answer) {
  return firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['answer', 'answered', 'answeredAt', 'dismissed']), {
    fields: {
      answer: { stringValue: answer.slice(0, 1000) },
      answered: { booleanValue: true },
      answeredAt: { stringValue: new Date().toISOString() },
      dismissed: { booleanValue: false }
    }
  });
}

async function editAnswer(id, answer) {
  return firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['answer', 'editedAt']), {
    fields: {
      answer: { stringValue: answer.slice(0, 1000) },
      editedAt: { stringValue: new Date().toISOString() }
    }
  });
}

async function dismissQuestion(id) {
  /* Set dismissed=true AND answered=false so the site's Firestore query
     (answered == true) naturally excludes dismissed questions.
     The bot's questionState() checks dismissed first, so the card
     still shows as DISMISSED regardless of answered value. */
  return firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['dismissed', 'answered']), {
    fields: { dismissed: { booleanValue: true }, answered: { booleanValue: false } }
  });
}

async function retrieveQuestion(id) {
  var doc = await firestore('GET', docPath(COLLECTION, id));
  var q = fromFirestoreDoc(doc);
  if (!q.dismissed) {
    return { restoredAs: 'not_dismissed', question: q };
  }
  var hasAnswer = q.answer && String(q.answer).trim().length > 0;
  if (hasAnswer) {
    await firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['dismissed', 'answered']), {
      fields: { dismissed: { booleanValue: false }, answered: { booleanValue: true } }
    });
    return { restoredAs: 'answered', question: q };
  } else {
    await firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['dismissed', 'answered']), {
      fields: { dismissed: { booleanValue: false }, answered: { booleanValue: false } }
    });
    return { restoredAs: 'unanswered', question: q };
  }
}

async function deleteQuestion(id) {
  return firestore('DELETE', docPath(COLLECTION, id));
}

/* -- Pin/Unpin -- */
async function pinQuestion(id) {
  return firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['pinned']), {
    fields: { pinned: { booleanValue: true } }
  });
}

async function unpinQuestion(id) {
  return firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['pinned']), {
    fields: { pinned: { booleanValue: false } }
  });
}

/* -- Edit session -- */
async function saveEditSession(chatId, questionId) {
  return firestore('PATCH', docPath(EDIT_SESSION_COLLECTION, String(chatId)), {
    fields: { chatId: { stringValue: String(chatId) }, questionId: { stringValue: questionId }, createdAt: { stringValue: new Date().toISOString() } }
  });
}

async function getEditSession(chatId) {
  try { return await firestore('GET', docPath(EDIT_SESSION_COLLECTION, String(chatId))); }
  catch (e) { return null; }
}

async function clearEditSession(chatId) {
  try { await firestore('DELETE', docPath(EDIT_SESSION_COLLECTION, String(chatId))); } catch (e) {}
}

/* -- Lookup session -- */
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

/* -- Preview session (answer preview -> confirm flow) -- */
async function savePreviewSession(chatId, questionId, answerText) {
  return firestore('PATCH', docPath(PREVIEW_SESSION_COLLECTION, String(chatId)), {
    fields: { chatId: { stringValue: String(chatId) }, questionId: { stringValue: questionId }, answerText: { stringValue: answerText.slice(0, 1000) }, createdAt: { stringValue: new Date().toISOString() } }
  });
}

async function getPreviewSession(chatId) {
  try { return await firestore('GET', docPath(PREVIEW_SESSION_COLLECTION, String(chatId))); }
  catch (e) { return null; }
}

async function clearPreviewSession(chatId) {
  try { await firestore('DELETE', docPath(PREVIEW_SESSION_COLLECTION, String(chatId))); } catch (e) {}
}

/* -- Answer session (Answer button -> type answer -> preview flow) -- */
async function saveAnswerSession(chatId, questionId) {
  return firestore('PATCH', docPath(ANSWER_SESSION_COLLECTION, String(chatId)), {
    fields: { chatId: { stringValue: String(chatId) }, questionId: { stringValue: questionId }, createdAt: { stringValue: new Date().toISOString() } }
  });
}

async function getAnswerSession(chatId) {
  try { return await firestore('GET', docPath(ANSWER_SESSION_COLLECTION, String(chatId))); }
  catch (e) { return null; }
}

async function clearAnswerSession(chatId) {
  try { await firestore('DELETE', docPath(ANSWER_SESSION_COLLECTION, String(chatId))); } catch (e) {}
}

/* -- Parse Firestore doc -- */
function fromFirestoreDoc(doc) {
  var f = (doc && doc.fields) || {};
  var reactions = {};
  if (f.reactions && f.reactions.mapValue && f.reactions.mapValue.fields) {
    Object.keys(f.reactions.mapValue.fields).forEach(function(emoji) {
      reactions[emoji] = Number(f.reactions.mapValue.fields[emoji].integerValue || f.reactions.mapValue.fields[emoji].doubleValue || 0);
    });
  }
  return {
    id: (f.id && f.id.stringValue) || (doc.name ? doc.name.split('/').pop() : ''),
    name: (f.name && f.name.stringValue) || 'Anonymous',
    question: (f.question && f.question.stringValue) || '',
    answer: (f.answer && f.answer.stringValue) || '',
    answered: !!(f.answered && f.answered.booleanValue),
    dismissed: !!(f.dismissed && f.dismissed.booleanValue),
    pinned: !!(f.pinned && f.pinned.booleanValue),
    createdAt: (f.createdAt && f.createdAt.stringValue) || '',
    answeredAt: (f.answeredAt && f.answeredAt.stringValue) || '',
    editedAt: (f.editedAt && f.editedAt.stringValue) || '',
    votes: Number((f.votes && f.votes.integerValue) || (f.votes && f.votes.doubleValue) || 0),
    reactions: reactions
  };
}

function questionState(q) {
  if (q.dismissed) return 'DISMISSED';
  if (q.answered || String(q.answer || '').trim()) return 'ANSWERED';
  return 'UNANSWERED';
}

async function listAllQuestions() {
  /* Per-request cache: if already fetched within this webhook
     invocation, return the same array. Cleared at handler start. */
  if (_questionsCache) return _questionsCache;
  var allDocs = [];
  var url = 'https://firestore.googleapis.com/v1/projects/' + projectId() + '/databases/(default)/documents/' + COLLECTION + '?pageSize=200';
  while (url) {
    var data = await firestore('GET', url);
    if (data.documents) {
      allDocs = allDocs.concat(data.documents.map(fromFirestoreDoc));
    }
    if (data.nextPageToken) {
      url = 'https://firestore.googleapis.com/v1/projects/' + projectId() + '/databases/(default)/documents/' + COLLECTION + '?pageSize=200&pageToken=' + data.nextPageToken;
    } else {
      url = null;
    }
  }
  _questionsCache = allDocs;
  return allDocs;
}

async function getQuestion(id) {
  try {
    var doc = await firestore('GET', docPath(COLLECTION, id));
    return fromFirestoreDoc(doc);
  } catch (e) { return null; }
}

/* -- Stats -- */
async function getStats() {
  var all = await listAllQuestions();
  var unanswered = all.filter(function(q) { return questionState(q) === 'UNANSWERED'; }).length;
  var answered = all.filter(function(q) { return questionState(q) === 'ANSWERED'; }).length;
  var dismissed = all.filter(function(q) { return questionState(q) === 'DISMISSED'; }).length;
  var totalVotes = all.reduce(function(s, q) { return s + (q.votes || 0); }, 0);
  var answeredQs = all.filter(function(q) { return questionState(q) === 'ANSWERED'; });
  var mostVoted = answeredQs.length > 0 ? answeredQs.reduce(function(max, q) { return (q.votes || 0) > (max.votes || 0) ? q : max; }) : null;
  var responseTimes = answeredQs
    .filter(function(q) { return q.createdAt && q.answeredAt; })
    .map(function(q) { return new Date(q.answeredAt).getTime() - new Date(q.createdAt).getTime(); });
  var avgResponseMs = responseTimes.length ? responseTimes.reduce(function(a, b) { return a + b; }, 0) / responseTimes.length : 0;
  var pinnedCount = all.filter(function(q) { return q.pinned; }).length;
  return { total: all.length, unanswered: unanswered, answered: answered, dismissed: dismissed, totalVotes: totalVotes, mostVoted: mostVoted, avgResponseMs: avgResponseMs, pinned: pinnedCount };
}

/* -- Time formatters -- */
function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: true
    });
  } catch (e) { return ''; }
}

function timeAgo(iso) {
  if (!iso) return '';
  var ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  var secs = Math.floor(ms / 1000);
  if (secs < 60) return 'just now';
  var mins = Math.floor(secs / 60);
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ' + (mins % 60) + 'm ago';
  var days = Math.floor(hrs / 24);
  return days + 'd ' + (hrs % 24) + 'h ago';
}

function responseTime(createdAt, answeredAt) {
  if (!createdAt || !answeredAt) return '';
  var ms = new Date(answeredAt).getTime() - new Date(createdAt).getTime();
  if (ms < 0) return 'instantly';
  var mins = Math.floor(ms / 60000);
  if (mins < 1) return 'under 1 min';
  if (mins < 60) return mins + ' min';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ' + (mins % 60) + 'm';
  var days = Math.floor(hrs / 24);
  return days + 'd ' + (hrs % 24) + 'h';
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '\u2014';
  var mins = Math.floor(ms / 60000);
  if (mins < 1) return 'under 1 min';
  if (mins < 60) return mins + ' min';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ' + (mins % 60) + 'm';
  var days = Math.floor(hrs / 24);
  return days + 'd ' + (hrs % 24) + 'h';
}

/* -- Unicode progress bar -- */
function progressBar(value, max, width) {
  width = width || 10;
  if (max === 0) return '\u2591'.repeat(width);
  var filled = Math.round((value / max) * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

/* -- Reaction summary line -- */
function reactionLine(reactions) {
  if (!reactions || typeof reactions !== 'object') return '';
  var entries = Object.entries(reactions).filter(function(e) { return e[1] > 0; });
  if (!entries.length) return '';
  return entries.map(function(e) { return e[0] + ' ' + e[1]; }).join('  ');
}

/* ============================================================
 MESSAGE TEMPLATES - Consistent, warm, concise
 ============================================================ */

/* Box-drawing shortcuts */
var BOX_TL = '\u250C', BOX_TR = '\u2510', BOX_BL = '\u2514', BOX_BR = '\u2518';
var BOX_H = '\u2500', BOX_V = '\u2502';

function cardTop(title) {
  return BOX_TL + BOX_H + title + BOX_H.repeat(5) + BOX_TR;
}
var cardBottom = BOX_BL + BOX_H.repeat(30) + BOX_BR;

function loadingCard(title, line) {
  return cardTop(title) + '\n' + BOX_V + '\n' + BOX_V + ' ' + line + '\n' + BOX_V + '\n' + cardBottom;
}

async function sendLoadingCard(chatId, title, line, replyToId) {
  var msg = await sendTelegram(chatId, loadingCard(title, line), replyToId);
  return msg && msg.message_id ? msg.message_id : null;
}

async function respondTelegram(chatId, text, replyToId, replyMarkup, editMessageId) {
  if (editMessageId) return editMessage(chatId, editMessageId, text, replyMarkup);
  return sendTelegram(chatId, text, replyToId, replyMarkup);
}

function visitorName(name) {
  var n = String(name || '').trim();
  if (!n || n.toLowerCase() === 'anonymous') return 'Anonymous visitor';
  return n;
}

function clipText(value, max) {
  var s = String(value || '').replace(/\s+/g, ' ').trim();
  max = max || 120;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function answerPreviewCard(q, answerText, questionId) {
  var name = visitorName(q && q.name);
  var question = q ? q.question : 'Question unavailable';
  return [
    cardTop('\uD83D\uDC41 <b>ANSWER PREVIEW</b>'),
    BOX_V,
    BOX_V + ' \uD83D\uDC64 Visitor \u2500 <b>' + esc(name) + '</b>',
    BOX_V + ' \uD83C\uDD94 ID \u2500 <code>' + esc(questionId) + '</code>',
    BOX_V,
    BOX_V + ' \uD83D\uDCAC <b>Question</b>',
    BOX_V + ' “' + esc(clipText(question, 160)) + '”',
    BOX_V,
    BOX_V + ' \u270D\uFE0F <b>Your answer</b>',
    BOX_V + ' “' + esc(clipText(answerText, 500)) + '”',
    BOX_V,
    BOX_V + ' Publish this to the site?',
    BOX_V,
    cardBottom
  ].join('\n');
}

function previewButtons() {
  return { inline_keyboard: [
    [{ text: '\u2705 Publish', callback_data: 'previewconfirm' }, { text: '\u270F\uFE0F Revise', callback_data: 'previewedit' }],
    [{ text: '\u274C Cancel', callback_data: 'previewcancel' }]
  ] };
}

/* -- /start -- Dynamic welcome with live stats -- */
async function buildWelcomeText() {
  var s = { total: 0, unanswered: 0, answered: 0, dismissed: 0, pinned: 0, totalVotes: 0, avgResponseMs: 0 };
  try { s = await getStats(); } catch (e) {}
  var health = s.unanswered === 0 ? 'Clear' : (s.unanswered <= 3 ? 'Active' : 'Busy');
  var avg = s.avgResponseMs > 0 ? formatDuration(s.avgResponseMs) : '—';

  return [
    cardTop('\u2728 <b>AMA CONTROL ROOM</b>'),
    BOX_V,
    BOX_V + ' Portfolio inbox is online.',
    BOX_V + ' Inbox health \u2500 <b>' + health + '</b>',
    BOX_V,
    BOX_V + ' \uD83D\uDCEC Total     \u2500 <b>' + s.total + '</b>',
    BOX_V + ' \u23F3 Pending   \u2500 <b>' + s.unanswered + '</b>',
    BOX_V + ' \u2705 Answered  \u2500 <b>' + s.answered + '</b>',
    BOX_V + ' \uD83D\uDE48 Hidden    \u2500 <b>' + s.dismissed + '</b>',
    BOX_V + ' \uD83D\uDCCD Pinned    \u2500 <b>' + s.pinned + '</b>',
    BOX_V + ' \u26A1 Avg reply \u2500 <b>' + esc(avg) + '</b>',
    BOX_V,
    BOX_V + ' <b>Quick actions</b>',
    BOX_V + ' /pending  · unanswered queue',
    BOX_V + ' /stats    · dashboard',
    BOX_V + ' /recent   · latest answers',
    BOX_V + ' /all      · browse database',
    BOX_V + ' /help     · command guide',
    BOX_V,
    BOX_V + ' Tip: tap <b>Answer</b> or reply to any',
    BOX_V + ' question card to publish with preview.',
    BOX_V,
    cardBottom
  ].join('\n');
}

/* -- /help -- Command reference -- */
var HELP_TEXT = [
  cardTop('\uD83D\uDCD6 <b>AMA COMMAND GUIDE</b>'),
  BOX_V,
  BOX_V + ' <b>Queues</b>',
  BOX_V + ' /pending  \u2500 unanswered inbox',
  BOX_V + ' /recent   \u2500 latest answers',
  BOX_V + ' /all      \u2500 all questions',
  BOX_V + ' /dismissed \u2500 hidden questions',
  BOX_V + ' /pinned   \u2500 pinned to site',
  BOX_V,
  BOX_V + ' <b>Single question actions</b>',
  BOX_V + ' /get &lt;id&gt;          \u2500 detail card',
  BOX_V + ' /answer &lt;id&gt; text  \u2500 preview answer',
  BOX_V + ' /edit &lt;id&gt;         \u2500 revise answer',
  BOX_V + ' /pin &lt;id&gt;          \u2500 pin to top',
  BOX_V + ' /unpin &lt;id&gt;        \u2500 remove pin',
  BOX_V + ' /dismiss &lt;id&gt;      \u2500 hide safely',
  BOX_V + ' /retrieve &lt;id&gt;     \u2500 restore hidden',
  BOX_V + ' /delete &lt;id&gt;       \u2500 permanent delete',
  BOX_V,
  BOX_V + ' <b>Bulk actions</b>',
  BOX_V + ' /dismissall  \u2500 hide active questions',
  BOX_V + ' /retrieveall \u2500 restore hidden questions',
  BOX_V + ' /deleteall   \u2500 delete everything',
  BOX_V,
  BOX_V + ' <b>Utilities</b>',
  BOX_V + ' /stats       \u2500 AMA dashboard',
  BOX_V + ' /search text \u2500 find by keyword/name',
  BOX_V + ' /lookup      \u2500 paste ID mode',
  BOX_V + ' /export      \u2500 text backup',
  BOX_V + ' /cancel      \u2500 exit answer/edit/lookup',
  BOX_V,
  BOX_V + ' Every answer shows a preview first,',
  BOX_V + ' including the visitor name + question.',
  BOX_V,
  cardBottom
].join('\n');

/* -- Reply Keyboard (always visible quick actions) -- */
var REPLY_KEYBOARD = {
  keyboard: [
    [{ text: '\uD83D\uDCCB Pending' }, { text: '\uD83D\uDCCA Stats' }, { text: '\uD83D\uDD50 Recent' }],
    [{ text: '\uD83D\uDCD6 Help' }, { text: '\uD83D\uDD0D Search' }]
  ],
  resize_keyboard: true,
  one_time_keyboard: false,
  input_field_placeholder: 'Type a command, tap Answer, or reply\u2026'
};

/* -- Stats dashboard -- */
async function sendStats(chatId, replyToId, editMessageId) {
  try {
    var s = await getStats();
    var maxStat = Math.max(s.total, 1);
    var health = s.unanswered === 0 ? 'Clean' : (s.unanswered <= 3 ? 'Healthy' : 'Needs attention');
    var avg = s.avgResponseMs > 0 ? formatDuration(s.avgResponseMs) : '—';

    var topQ = '';
    if (s.mostVoted) {
      topQ = '\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDD25 <b>Top question</b>' +
        '\n' + BOX_V + ' “' + esc(clipText(s.mostVoted.question, 70)) + '”' +
        '\n' + BOX_V + ' ' + (s.mostVoted.votes || 0) + ' votes';
    }

    var statsText = [
      cardTop('\uD83D\uDCCA <b>AMA DASHBOARD</b>'),
      BOX_V,
      BOX_V + ' Inbox health \u2500 <b>' + health + '</b>',
      BOX_V,
      BOX_V + ' \uD83D\uDCEC Total     ' + progressBar(s.total, maxStat, 8) + ' <b>' + s.total + '</b>',
      BOX_V + ' \u23F3 Pending   ' + progressBar(s.unanswered, maxStat, 8) + ' <b>' + s.unanswered + '</b>',
      BOX_V + ' \u2705 Answered  ' + progressBar(s.answered, maxStat, 8) + ' <b>' + s.answered + '</b>',
      BOX_V + ' \uD83D\uDE48 Hidden    ' + progressBar(s.dismissed, maxStat, 8) + ' <b>' + s.dismissed + '</b>',
      BOX_V + ' \uD83D\uDCCD Pinned    ' + progressBar(s.pinned, Math.max(s.answered, 1), 8) + ' <b>' + s.pinned + '</b>',
      BOX_V,
      BOX_V + ' \uD83D\uDC4D Votes     \u2500 <b>' + s.totalVotes + '</b>',
      BOX_V + ' \u26A1 Avg reply \u2500 <b>' + esc(avg) + '</b>' + topQ,
      BOX_V,
      cardBottom
    ].join('\n');
    await respondTelegram(chatId, statsText, replyToId, REPLY_KEYBOARD, editMessageId);
  } catch (e) {
    await respondTelegram(chatId,
      cardTop('\u26A0\uFE0F <b>STATS ERROR</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Dashboard could not load.\n' + BOX_V + ' Please try again in a moment.\n' + BOX_V + '\n' + cardBottom,
      replyToId, REPLY_KEYBOARD, editMessageId);
  }
}

/* -- Answered card with reactions -- */
async function sendAnsweredCard(chatId, questionId, answerText, replyToId, isUpdate) {
  isUpdate = isUpdate || false;
  var q = await getQuestion(questionId);
  var qName = visitorName(q && q.name);
  var qText = q ? q.question : 'Question text unavailable';
  var qVotes = q ? q.votes : 0;
  var rTime = q ? responseTime(q.createdAt, q.answeredAt) : '';
  var qAge = q ? timeAgo(q.createdAt) : '';
  var rLine = q ? reactionLine(q.reactions) : '';

  var headerText = isUpdate ? '\u270F\uFE0F <b>ANSWER UPDATED</b>' : '\u2705 <b>ANSWER PUBLISHED</b>';

  var metaLine = '';
  if (rTime) metaLine += '\n' + BOX_V + ' \u26A1 Responded in <b>' + esc(rTime) + '</b>';
  if (qAge) metaLine += '\n' + BOX_V + ' \uD83D\uDD50 Question was ' + esc(qAge);
  if (q && q.editedAt) metaLine += '\n' + BOX_V + ' \u270F\uFE0F Edited ' + esc(formatTime(q.editedAt)) + ' IST';
  if (qVotes > 0) metaLine += '\n' + BOX_V + ' \uD83D\uDC4D ' + qVotes + ' votes';
  if (rLine) metaLine += '\n' + BOX_V + ' ' + rLine;
  if (q && q.pinned) metaLine += '\n' + BOX_V + ' \uD83D\uDCCD Pinned to top on site';

  var text = [
    cardTop(headerText),
    BOX_V,
    BOX_V + ' \uD83D\uDC64 Visitor \u2500 <b>' + esc(qName) + '</b>' + ((q && q.pinned) ? '\n' + BOX_V + ' \uD83D\uDCCD Pinned to top' : ''),
    BOX_V + ' \uD83C\uDD94 ID \u2500 <code>' + esc(questionId) + '</code>',
    BOX_V,
    BOX_V + ' \uD83D\uDCAC <b>Question</b>',
    BOX_V + ' “' + esc(clipText(qText, 170)) + '”',
    BOX_V,
    BOX_V + ' \u270D\uFE0F <b>Answer</b>',
    BOX_V + ' “' + esc(clipText(answerText, 500)) + '”',
    metaLine ? BOX_V + metaLine : BOX_V,
    BOX_V,
    cardBottom
  ].join('\n');

  var buttons = [
    [{ text: '\u270F\uFE0F Edit', callback_data: 'edit:' + questionId }],
    [{ text: (q && q.pinned) ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: ((q && q.pinned) ? 'unpin:' : 'pin:') + questionId }],
    [
      { text: '\uD83D\uDE48 Dismiss', callback_data: 'dismiss:' + questionId },
      { text: '\uD83D\uDDD1 Delete', callback_data: 'delete:' + questionId }
    ]
  ];

  await sendTelegram(chatId, text, replyToId, { inline_keyboard: buttons });
}

/* -- Build card for question's current state -- */
function buildCardForQuestion(q) {
  var state = questionState(q);
  var name = visitorName(q.name);
  var qAge = timeAgo(q.createdAt);
  var rLine = reactionLine(q.reactions);
  var pinLine = q.pinned ? '\n' + BOX_V + ' \uD83D\uDCCD Pinned to top' : '';

  if (state === 'ANSWERED') {
    var rTime = responseTime(q.createdAt, q.answeredAt);
    var meta = [];
    if (qAge) meta.push('asked ' + qAge);
    if (rTime) meta.push('replied in ' + rTime);
    if (q.editedAt) meta.push('edited ' + formatTime(q.editedAt) + ' IST');
    var text = [
      cardTop('\u2705 <b>ANSWERED QUESTION</b>'),
      BOX_V,
      BOX_V + ' \uD83D\uDC64 Visitor \u2500 <b>' + esc(name) + '</b>' + pinLine,
      BOX_V + ' \uD83C\uDD94 ID \u2500 <code>' + esc(q.id) + '</code>',
      BOX_V,
      BOX_V + ' \uD83D\uDCAC <b>Question</b>',
      BOX_V + ' “' + esc(clipText(q.question, 170)) + '”',
      BOX_V,
      BOX_V + ' \u270D\uFE0F <b>Answer</b>',
      BOX_V + ' “' + esc(clipText(q.answer, 500)) + '”',
      BOX_V,
      BOX_V + ' ' + (meta.length ? meta.join(' · ') : 'published'),
      q.votes > 0 ? BOX_V + ' \uD83D\uDC4D ' + q.votes + ' votes' : BOX_V,
      rLine ? BOX_V + ' ' + rLine : BOX_V,
      cardBottom
    ].join('\n');
    return { text: text, replyMarkup: {
      inline_keyboard: [
        [{ text: '\u270F\uFE0F Edit Answer', callback_data: 'edit:' + q.id }],
        [{ text: q.pinned ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: (q.pinned ? 'unpin:' : 'pin:') + q.id }],
        [{ text: '\uD83D\uDE48 Dismiss', callback_data: 'dismiss:' + q.id }, { text: '\uD83D\uDDD1 Delete', callback_data: 'delete:' + q.id }]
      ]
    } };
  }

  if (state === 'DISMISSED') {
    var hasAnswer = q.answer && String(q.answer).trim().length > 0;
    var textLines = [
      cardTop('\uD83D\uDE48 <b>HIDDEN QUESTION</b>'),
      BOX_V,
      BOX_V + ' Hidden from the site. Data is preserved.',
      BOX_V + ' Restore target \u2500 <b>' + (hasAnswer ? 'site with answer' : 'pending queue') + '</b>',
      BOX_V,
      BOX_V + ' \uD83D\uDC64 Visitor \u2500 <b>' + esc(name) + '</b>' + pinLine,
      BOX_V + ' \uD83C\uDD94 ID \u2500 <code>' + esc(q.id) + '</code>',
      BOX_V,
      BOX_V + ' \uD83D\uDCAC <b>Question</b>',
      BOX_V + ' “' + esc(clipText(q.question, 170)) + '”'
    ];
    if (hasAnswer) {
      textLines.push(BOX_V);
      textLines.push(BOX_V + ' \u270D\uFE0F Previous answer');
      textLines.push(BOX_V + ' “' + esc(clipText(q.answer, 220)) + '”');
    }
    if (rLine) textLines.push(BOX_V + ' ' + rLine);
    textLines.push(BOX_V);
    textLines.push(cardBottom);
    return { text: textLines.join('\n'), replyMarkup: {
      inline_keyboard: [
        [{ text: '\u21A9\uFE0F Retrieve', callback_data: 'retrieve:' + q.id }],
        [{ text: '\uD83D\uDCAC Answer', callback_data: 'answer:' + q.id }],
        [{ text: q.pinned ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: (q.pinned ? 'unpin:' : 'pin:') + q.id }],
        [{ text: '\uD83D\uDDD1 Delete', callback_data: 'delete:' + q.id }]
      ]
    } };
  }

  var text = [
    cardTop('\uD83D\uDCEC <b>NEW AMA QUESTION</b>'),
    BOX_V,
    BOX_V + ' \uD83D\uDC64 Visitor \u2500 <b>' + esc(name) + '</b>' + pinLine,
    BOX_V + ' \uD83D\uDD50 Asked \u2500 ' + esc(formatTime(q.createdAt)) + ' IST' + (qAge ? ' · ' + esc(qAge) : ''),
    BOX_V + ' \uD83C\uDD94 ID \u2500 <code>' + esc(q.id) + '</code>',
    BOX_V,
    BOX_V + ' \uD83D\uDCAC <b>Question</b>',
    BOX_V + ' “' + esc(clipText(q.question, 220)) + '”',
    BOX_V,
    BOX_V + ' Tap <b>Answer</b> or reply to this card.',
    BOX_V,
    cardBottom
  ].join('\n');
  return { text: text, replyMarkup: {
    inline_keyboard: [
      [{ text: '\uD83D\uDCAC Answer', callback_data: 'answer:' + q.id }],
      [{ text: q.pinned ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: (q.pinned ? 'unpin:' : 'pin:') + q.id }],
      [{ text: '\uD83D\uDE48 Dismiss', callback_data: 'dismiss:' + q.id }, { text: '\uD83D\uDDD1 Delete', callback_data: 'delete:' + q.id }]
    ]
  } };
}

/* -- Full detail card for /get -- */
async function sendFullDetailCard(chatId, questionId, replyToId, editMessageId) {
  var q = await getQuestion(questionId);
  if (!q) {
    await respondTelegram(chatId,
      cardTop('\u26A0\uFE0F <b>QUESTION NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No AMA entry exists for this ID.\n' + BOX_V + ' ID \u2500 <code>' + esc(questionId) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Try /all, /pending, or /search.\n' + BOX_V + '\n' + cardBottom,
      replyToId, REPLY_KEYBOARD, editMessageId);
    return;
  }

  var state = questionState(q);
  var stateEmoji = state === 'ANSWERED' ? '\u2705' : state === 'DISMISSED' ? '\uD83D\uDE48' : '\u23F3';
  var rTime = responseTime(q.createdAt, q.answeredAt);
  var qAge = timeAgo(q.createdAt);
  var rLine = reactionLine(q.reactions);
  var name = visitorName(q.name);

  var lines = [
    cardTop('\uD83D\uDCCB <b>QUESTION DETAIL</b>'),
    BOX_V,
    BOX_V + ' ' + stateEmoji + ' Status \u2500 <b>' + state + '</b>' + (q.pinned ? ' · \uD83D\uDCCD pinned' : ''),
    BOX_V + ' \uD83D\uDC64 Visitor \u2500 <b>' + esc(name) + '</b>',
    BOX_V + ' \uD83C\uDD94 ID \u2500 <code>' + esc(q.id) + '</code>',
    BOX_V + ' \uD83D\uDD50 Asked \u2500 ' + esc(formatTime(q.createdAt)) + ' IST' + (qAge ? ' · ' + esc(qAge) : ''),
    BOX_V,
    BOX_V + ' \uD83D\uDCAC <b>Question</b>',
    BOX_V + ' “' + esc(clipText(q.question, 260)) + '”'
  ];

  if (q.answer) {
    lines.push(BOX_V);
    lines.push(BOX_V + ' \u270D\uFE0F <b>Answer</b>');
    lines.push(BOX_V + ' “' + esc(clipText(q.answer, 650)) + '”');
    if (q.answeredAt) lines.push(BOX_V + ' \uD83D\uDD50 Answered \u2500 ' + esc(formatTime(q.answeredAt)) + ' IST');
    if (q.editedAt) lines.push(BOX_V + ' \u270F\uFE0F Edited \u2500 ' + esc(formatTime(q.editedAt)) + ' IST');
    if (rTime) lines.push(BOX_V + ' \u26A1 Response time \u2500 <b>' + esc(rTime) + '</b>');
  }
  if (q.votes > 0) lines.push(BOX_V + ' \uD83D\uDC4D Votes \u2500 <b>' + q.votes + '</b>');
  if (rLine) lines.push(BOX_V + ' ' + rLine);
  lines.push(BOX_V);
  lines.push(cardBottom);

  var buttons = [];
  if (state === 'DISMISSED') {
    buttons.push([{ text: '\u21A9\uFE0F Retrieve', callback_data: 'retrieve:' + q.id }]);
    buttons.push([{ text: '\uD83D\uDCAC Answer', callback_data: 'answer:' + q.id }]);
    buttons.push([{ text: q.pinned ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: (q.pinned ? 'unpin:' : 'pin:') + q.id }]);
  } else if (state === 'UNANSWERED') {
    buttons.push([{ text: '\uD83D\uDCAC Answer', callback_data: 'answer:' + q.id }]);
    buttons.push([{ text: q.pinned ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: (q.pinned ? 'unpin:' : 'pin:') + q.id }]);
  } else {
    buttons.push([{ text: '\u270F\uFE0F Edit Answer', callback_data: 'edit:' + q.id }]);
    buttons.push([{ text: q.pinned ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: (q.pinned ? 'unpin:' : 'pin:') + q.id }]);
  }
  buttons.push([{ text: '\uD83D\uDE48 Dismiss', callback_data: 'dismiss:' + q.id }, { text: '\uD83D\uDDD1 Delete', callback_data: 'delete:' + q.id }]);

  await respondTelegram(chatId, lines.join('\n'), replyToId, { inline_keyboard: buttons }, editMessageId);
}

/* -- /recent -- Last 5 answered -- */
async function sendRecent(chatId, replyToId, editMessageId) {
  var all = await listAllQuestions();
  var answered = all
    .filter(function(q) { return questionState(q) === 'ANSWERED'; })
    .sort(function(a, b) { return new Date(b.answeredAt || 0) - new Date(a.answeredAt || 0); })
    .slice(0, 5);

  if (!answered.length) {
    await respondTelegram(chatId,
      cardTop('\uD83D\uDD50 <b>RECENT ANSWERS</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No answers published yet.\n' + BOX_V + ' New replies will appear here.\n' + BOX_V + '\n' + cardBottom,
      replyToId, REPLY_KEYBOARD, editMessageId);
    return;
  }

  var lines = [
    cardTop('\uD83D\uDD50 <b>RECENT ANSWERS</b>'),
    BOX_V
  ];

  for (var idx = 0; idx < answered.length; idx++) {
    var q = answered[idx];
    var rTime = responseTime(q.createdAt, q.answeredAt);
    var qAge = timeAgo(q.answeredAt);
    lines.push(BOX_V + ' ' + (idx + 1) + '. <b>' + esc(visitorName(q.name)) + '</b>' + (qAge ? ' · ' + esc(qAge) : '') + (q.pinned ? ' · \uD83D\uDCCD' : ''));
    lines.push(BOX_V + ' Q: “' + esc(clipText(q.question, 82)) + '”');
    lines.push(BOX_V + ' A: “' + esc(clipText(q.answer, 82)) + '”');
    if (rTime) lines.push(BOX_V + ' \u26A1 ' + esc(rTime) + (q.votes > 0 ? ' · \uD83D\uDC4D ' + q.votes : ''));
    lines.push(BOX_V + ' ID: <code>' + esc(q.id) + '</code>');
    lines.push(BOX_V);
  }

  lines.push(BOX_V + ' Use /get &lt;id&gt; for full actions.');
  lines.push(cardBottom);

  await respondTelegram(chatId, lines.join('\n'), replyToId, REPLY_KEYBOARD, editMessageId);
}

/* -- /search <text> -- */
async function searchQuestions(chatId, searchText, replyToId, editMessageId) {
  if (!searchText || searchText.length < 2) {
    await respondTelegram(chatId,
      cardTop('\uD83D\uDD0D <b>SEARCH AMA</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Type at least 2 characters.\n' + BOX_V + '\n' + BOX_V + ' Examples:\n' + BOX_V + ' /search react\n' + BOX_V + ' /search anonymous\n' + BOX_V + '\n' + cardBottom,
      replyToId, REPLY_KEYBOARD, editMessageId);
    return;
  }

  var all = await listAllQuestions();
  var query = searchText.toLowerCase();
  var results = all.filter(function(q) {
    return (q.question || '').toLowerCase().includes(query) ||
           (q.answer || '').toLowerCase().includes(query) ||
           (q.name || '').toLowerCase().includes(query);
  }).sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); }).slice(0, 8);

  if (!results.length) {
    await respondTelegram(chatId,
      cardTop('\uD83D\uDD0D <b>NO MATCHES</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Nothing matched “' + esc(searchText) + '”.\n' + BOX_V + '\n' + BOX_V + ' Try a different keyword, or use /all.\n' + BOX_V + '\n' + cardBottom,
      replyToId, REPLY_KEYBOARD, editMessageId);
    return;
  }

  var lines = [
    cardTop('\uD83D\uDD0D <b>SEARCH RESULTS</b>'),
    BOX_V,
    BOX_V + ' Query \u2500 “' + esc(clipText(searchText, 40)) + '”',
    BOX_V + ' Matches \u2500 <b>' + results.length + '</b>',
    BOX_V
  ];

  for (var idx = 0; idx < results.length; idx++) {
    var q = results[idx];
    var st = questionState(q);
    var stateEmoji = st === 'ANSWERED' ? '\u2705' : st === 'DISMISSED' ? '\uD83D\uDE48' : '\u23F3';
    lines.push(BOX_V + ' ' + stateEmoji + ' <b>' + st + '</b> · ' + esc(visitorName(q.name)) + (q.pinned ? ' · \uD83D\uDCCD' : ''));
    lines.push(BOX_V + ' “' + esc(clipText(q.question, 105)) + '”');
    if (st === 'ANSWERED' && q.answer) lines.push(BOX_V + ' → “' + esc(clipText(q.answer, 80)) + '”');
    lines.push(BOX_V + ' ID: <code>' + esc(q.id) + '</code>');
    lines.push(BOX_V);
  }

  lines.push(BOX_V + ' Use /get &lt;id&gt; for full actions.');
  lines.push(cardBottom);

  await respondTelegram(chatId, lines.join('\n'), replyToId, REPLY_KEYBOARD, editMessageId);
}

/* -- /export -- */
async function exportQuestions(chatId, replyToId, editMessageId) {
  var all = await listAllQuestions();
  if (!all.length) {
        await respondTelegram(chatId,
          cardTop('\uD83D\uDCE4 <b>EXPORT</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No questions to export.\n' + BOX_V + '\n' + cardBottom,
          replyToId, REPLY_KEYBOARD, editMessageId);
    return;
  }

  var sorted = all.sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
  var lines = ['\uD83D\uDCCB AMA EXPORT \u2014 ' + new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST', ''];

  for (var idx = 0; idx < sorted.length; idx++) {
    var q = sorted[idx];
    var st = questionState(q);
    lines.push('\u2500\u2500\u2500 ' + st + (q.pinned ? ' \u00B7 \uD83D\uDCCD PINNED' : '') + ' \u2500\u2500\u2500');
    lines.push('From: ' + q.name);
    lines.push('Asked: ' + formatTime(q.createdAt));
    lines.push('Q: ' + q.question);
    if (q.answer) {
      lines.push('A: ' + q.answer);
      lines.push('Answered: ' + formatTime(q.answeredAt));
    if (q.editedAt) lines.push('Edited: ' + formatTime(q.editedAt));
    }
    if (q.votes > 0) lines.push('Votes: ' + q.votes);
    var rLine = reactionLine(q.reactions);
    if (rLine) lines.push('Reactions: ' + rLine);
    lines.push('ID: ' + q.id);
    lines.push('');
  }

  lines.push('Total: ' + all.length + ' questions');

  // Split into chunks if too long (Telegram limit: 4096 chars)
  var chunks = [];
  var current = '';
  for (var li = 0; li < lines.length; li++) {
    if ((current + lines[li] + '\n').length > 3800) {
      chunks.push(current.trim());
      current = '';
    }
    current += lines[li] + '\n';
  }
  if (current.trim()) chunks.push(current.trim());

  for (var ci = 0; ci < chunks.length; ci++) {
    if (ci === 0 && editMessageId) {
      await editMessage(chatId, editMessageId, '<pre>' + esc(chunks[ci]) + '</pre>');
    } else {
      await sendTelegram(chatId, '<pre>' + esc(chunks[ci]) + '</pre>', ci === 0 ? replyToId : undefined);
    }
  }
}

/* -- Build /all and /dismissed pages -- */
var ALL_PER_PAGE = 4;

function buildAllPageText(sorted, page) {
  var total = sorted.length;
  var pages = Math.max(1, Math.ceil(total / ALL_PER_PAGE));
  if (page > pages) page = pages;
  if (page < 1) page = 1;
  var start = (page - 1) * ALL_PER_PAGE;
  var slice = sorted.slice(start, start + ALL_PER_PAGE);
  var lines = [
    cardTop('\uD83D\uDCCB <b>AMA DATABASE</b>'),
    BOX_V,
    BOX_V + ' Total \u2500 <b>' + total + '</b> · Page <b>' + page + '/' + pages + '</b>',
    BOX_V
  ];
  for (var i = 0; i < slice.length; i++) {
    var q = slice[i];
    var st = questionState(q);
    var stateEmoji = st === 'ANSWERED' ? '\u2705' : st === 'DISMISSED' ? '\uD83D\uDE48' : '\u23F3';
    var qAge = timeAgo(q.createdAt);
    lines.push(BOX_V + ' ' + stateEmoji + ' <b>' + st + '</b> · ' + esc(visitorName(q.name)) + (qAge ? ' · ' + esc(qAge) : '') + (q.pinned ? ' · \uD83D\uDCCD' : ''));
    lines.push(BOX_V + ' “' + esc(clipText(q.question, 120)) + '”');
    if (st === 'ANSWERED' && q.answer) lines.push(BOX_V + ' → “' + esc(clipText(q.answer, 95)) + '”');
    if (q.votes > 0) lines.push(BOX_V + ' \uD83D\uDC4D ' + q.votes + ' votes');
    lines.push(BOX_V + ' ID: <code>' + esc(q.id) + '</code>');
    lines.push(BOX_V);
  }
  lines.push(BOX_V + ' Tap/copy ID · /get &lt;id&gt; for actions');
  lines.push(cardBottom);
  return { text: lines.join('\n'), pages: pages, page: page };
}

function buildAllPageButtons(page, pages) {
  var row = [];
  if (page > 1) row.push({ text: '\u25C0 Prev', callback_data: 'all:' + (page - 1) });
  row.push({ text: page + ' / ' + pages, callback_data: 'all:noop' });
  if (page < pages) row.push({ text: 'Next \u25B6', callback_data: 'all:' + (page + 1) });
  return { inline_keyboard: [row] };
}

var QUEUE_PER_PAGE = 4;
function buildQueuePageText(items, page, title, footer) {
  var total = items.length;
  var pages = Math.max(1, Math.ceil(total / QUEUE_PER_PAGE));
  if (page > pages) page = pages;
  if (page < 1) page = 1;
  var start = (page - 1) * QUEUE_PER_PAGE;
  var slice = items.slice(start, start + QUEUE_PER_PAGE);
  var lines = [
    cardTop(title),
    BOX_V,
    BOX_V + ' Total \u2500 <b>' + total + '</b> · Page <b>' + page + '/' + pages + '</b>',
    BOX_V
  ];
  for (var i = 0; i < slice.length; i++) {
    var q = slice[i];
    var st = questionState(q);
    var emoji = st === 'DISMISSED' ? '\uD83D\uDE48' : '\u23F3';
    var age = timeAgo(q.createdAt);
    lines.push(BOX_V + ' ' + emoji + ' <b>' + st + '</b> · ' + esc(visitorName(q.name)) + (age ? ' · ' + esc(age) : '') + (q.pinned ? ' · \uD83D\uDCCD' : ''));
    lines.push(BOX_V + ' “' + esc(clipText(q.question, 130)) + '”');
    lines.push(BOX_V + ' ID: <code>' + esc(q.id) + '</code>');
    lines.push(BOX_V);
  }
  lines.push(BOX_V + footer);
  lines.push(cardBottom);
  return { text: lines.join('\n'), pages: pages, page: page };
}

function buildQueuePageButtons(action, page, pages) {
  var row = [];
  if (page > 1) row.push({ text: '\u25C0 Prev', callback_data: action + ':' + (page - 1) });
  row.push({ text: page + ' / ' + pages, callback_data: action + ':noop' });
  if (page < pages) row.push({ text: 'Next \u25B6', callback_data: action + ':' + (page + 1) });
  return { inline_keyboard: [row] };
}

var DISMISSED_PER_PAGE = 4;

function buildDismissedPageText(sorted, page) {
  var total = sorted.length;
  var pages = Math.max(1, Math.ceil(total / DISMISSED_PER_PAGE));
  if (page > pages) page = pages;
  if (page < 1) page = 1;
  var start = (page - 1) * DISMISSED_PER_PAGE;
  var slice = sorted.slice(start, start + DISMISSED_PER_PAGE);
  var lines = [
    cardTop('\uD83D\uDE48 <b>HIDDEN QUESTIONS</b>'),
    BOX_V,
    BOX_V + ' Total \u2500 <b>' + total + '</b> · Page <b>' + page + '/' + pages + '</b>',
    BOX_V
  ];
  for (var i = 0; i < slice.length; i++) {
    var q = slice[i];
    var hasAnswer = q.answer && String(q.answer).trim().length > 0;
    var qAge = timeAgo(q.createdAt);
    lines.push(BOX_V + ' ' + (hasAnswer ? '\u2705' : '\u23F3') + ' <b>' + (hasAnswer ? 'Answered before hide' : 'Pending before hide') + '</b>');
    lines.push(BOX_V + ' Visitor \u2500 <b>' + esc(visitorName(q.name)) + '</b>' + (qAge ? ' · ' + esc(qAge) : ''));
    lines.push(BOX_V + ' “' + esc(clipText(q.question, 120)) + '”');
    if (hasAnswer) lines.push(BOX_V + ' → “' + esc(clipText(q.answer, 80)) + '”');
    if (q.votes > 0) lines.push(BOX_V + ' \uD83D\uDC4D ' + q.votes + ' votes');
    lines.push(BOX_V + ' ID: <code>' + esc(q.id) + '</code>');
    lines.push(BOX_V);
  }
  lines.push(BOX_V + ' /retrieve &lt;id&gt; · /retrieveall');
  lines.push(cardBottom);
  return { text: lines.join('\n'), pages: pages, page: page };
}

function buildDismissedPageButtons(page, pages) {
  var row = [];
  if (page > 1) row.push({ text: '\u25C0 Prev', callback_data: 'dismissed:' + (page - 1) });
  row.push({ text: page + ' / ' + pages, callback_data: 'dismissed:noop' });
  if (page < pages) row.push({ text: 'Next \u25B6', callback_data: 'dismissed:' + (page + 1) });
  return { inline_keyboard: [row] };
}

/* -- Extract question ID from message text -- */
function extractQuestionId(replyText) {
  replyText = replyText || '';
  var match = String(replyText).match(/(?:ID:|\uD83C\uDD94 )\s*<\/?(?:b|code|i)?>\s*([A-Za-z0-9_-]{8,80})/i)
    || String(replyText).match(/\b([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/i)
    || String(replyText).match(/\bID:\s*([A-Za-z0-9_-]{8,80})/i);
  return match ? match[1] : '';
}

/* -- Send a list of questions (for /pending, /refresh) -- */
async function sendQuestionsList(chatId, title, items, replyToId, editMessageId) {
  var chunk = title + '\n\n';
  var sent = 0;
  for (var i = 0; i < items.length; i++) {
    var q = items[i];
    var tag = questionState(q);
    var tagEmoji = tag === 'UNANSWERED' ? '\u23F3' : '\uD83D\uDE48';
    var qAge = timeAgo(q.createdAt);
    var line = [
      cardTop(tagEmoji + ' <b>' + tag + '</b>'),
      BOX_V,
      BOX_V + ' Visitor \u2500 <b>' + esc(visitorName(q.name)) + '</b>' + (qAge ? ' · ' + esc(qAge) : '') + (q.pinned ? ' · \uD83D\uDCCD' : ''),
      BOX_V + ' ID \u2500 <code>' + esc(q.id) + '</code>',
      BOX_V,
      BOX_V + ' “' + esc(clipText(q.question, 150)) + '”',
      BOX_V,
      cardBottom,
      ''
    ].join('\n');
    if ((chunk + line + '\n').length > 3500) {
      if (sent === 0 && editMessageId) await editMessage(chatId, editMessageId, chunk.trim());
      else await sendTelegram(chatId, chunk.trim(), sent === 0 ? replyToId : undefined);
      sent++;
      chunk = '';
    }
    chunk += line + '\n';
  }
  if (chunk.trim()) {
    if (sent === 0 && editMessageId) await editMessage(chatId, editMessageId, chunk.trim());
    else await sendTelegram(chatId, chunk.trim(), sent === 0 ? replyToId : undefined);
    sent++;
  }
  await sendTelegram(chatId,
    cardTop('\u2705 <b>LIST READY</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Listed <b>' + items.length + '</b> question' + (items.length === 1 ? '' : 's') + '.\n' + BOX_V + ' Tap Answer or reply to answer.\n' + BOX_V + '\n' + cardBottom,
    undefined, REPLY_KEYBOARD);
}

/* ============================================================
 HANDLER
 ============================================================ */
module.exports = async function handler(req, res) {
  /* Clear per-invocation caches for fresh data on each webhook request.
     The JWT token cache is also cleared so a stale token from a
     previous invocation never leaks into a new cold-start. */
  _questionsCache = null;
  _cachedToken = null;
  _cachedTokenExpiry = 0;

  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, message: 'Telegram webhook endpoint is live.' });
  }

  // FAIL-CLOSED webhook secret
  var expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error('TELEGRAM_WEBHOOK_SECRET is not set - refusing to process webhook.');
    return res.status(500).json({ ok: false, error: 'Webhook secret not configured.' });
  }
  if (req.headers['x-telegram-bot-api-secret-token'] !== expectedSecret) {
    return res.status(401).json({ ok: false, error: 'Invalid Telegram webhook secret' });
  }

  try {
    var update = jsonBody(req);
    var message = update.message || update.edited_message;
    var callback = update.callback_query;

    /* -- INLINE BUTTON PRESS -- */
    if (callback) {
      var cbChatId = callback.message && callback.message.chat && callback.message.chat.id;
      var cbMessageId = callback.message && callback.message.message_id;
      var allowedChatId = String(process.env.TELEGRAM_CHAT_ID || '');
      if (allowedChatId && String(cbChatId) !== allowedChatId) {
        return res.status(200).json({ ok: true, ignored: 'wrong chat' });
      }
      var data = callback.data || '';
      var parts = data.split(':');
      var action = parts[0];
      var questionId = parts.slice(1).join(':');

      // DELETE CONFIRMATION FLOW
      if (action === 'delete') {
        await answerCallback(callback.id, '\u26A0\uFE0F Confirming delete\u2026');
        await editMessage(cbChatId, cbMessageId,
          cardTop('\u26A0\uFE0F <b>DELETE QUESTION?</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This permanently removes the question\n' + BOX_V + ' and all related data.\n' + BOX_V + '\n' + BOX_V + ' ID \u2500 <code>' + esc(questionId) + '</code>\n' + BOX_V + '\n' + BOX_V + ' This cannot be undone.\n' + BOX_V + '\n' + cardBottom,
          { inline_keyboard: [[
            { text: '\u2705 Yes, Delete', callback_data: 'confirmdelete:' + questionId },
            { text: '\u274C Cancel', callback_data: 'canceldelete:' + questionId }
          ]] }
        );
      }
      else if (action === 'confirmdelete') {
        try {
          await deleteQuestion(questionId);
          await answerCallback(callback.id, '\u2705 Deleted');
          await editMessage(cbChatId, cbMessageId,
            cardTop('\uD83D\uDDD1 <b>DELETED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Question removed permanently.\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDD50 ' + formatTime(new Date().toISOString()) + ' IST\n' + BOX_V + '\n' + cardBottom
          );
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not delete - try again'); }
      }
      else if (action === 'canceldelete') {
        await answerCallback(callback.id, 'Delete cancelled');
        try {
          var q = await getQuestion(questionId);
          if (q) {
            var card = buildCardForQuestion(q);
            await editMessage(cbChatId, cbMessageId, card.text, card.replyMarkup);
          } else {
            await editMessage(cbChatId, cbMessageId,
              cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This question may have already\n' + BOX_V + ' been deleted.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(questionId) + '</code>\n' + BOX_V + '\n' + cardBottom
            );
          }
        } catch (e) {
          await editMessage(cbChatId, cbMessageId,
            cardTop('\u26A0\uFE0F <b>RESTORE FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not restore the question card.\n' + BOX_V + ' Use /get ' + esc(questionId) + ' to check its state.\n' + BOX_V + '\n' + cardBottom
          );
        }
      }
      else if (action === 'answer') {
        await clearEditSession(cbChatId);
        await clearLookupSession(cbChatId);
        await clearPreviewSession(cbChatId);
        await saveAnswerSession(cbChatId, questionId);
        await answerCallback(callback.id, 'Answer mode ready');
        var aq = await getQuestion(questionId).catch(function() { return null; });
        await sendTelegram(cbChatId,
          cardTop('\uD83D\uDCAC <b>ANSWER MODE</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Reply with your answer. Preview comes first.\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDC64 Visitor \u2500 <b>' + esc(visitorName(aq && aq.name)) + '</b>\n' + BOX_V + ' \uD83C\uDD94 ID \u2500 <code>' + esc(questionId) + '</code>\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDCAC <b>Question</b>\n' + BOX_V + ' “' + esc(clipText(aq && aq.question || 'Question unavailable', 150)) + '”\n' + BOX_V + '\n' + BOX_V + ' /cancel to exit.\n' + BOX_V + '\n' + cardBottom
        );
      }
      else if (action === 'dismiss') {
        try {
          await dismissQuestion(questionId);
          await answerCallback(callback.id, '\uD83D\uDE48 Dismissed');
          var dq = await getQuestion(questionId);
          var dPinned = dq && dq.pinned;
          await editMessage(cbChatId, cbMessageId,
            cardTop('\uD83D\uDE48 <b>DISMISSED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Question hidden from your site.\n' + BOX_V + ' Data preserved safely.\n' + BOX_V + '\n' + BOX_V + ' \u21A9\uFE0F Use Retrieve to restore it.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(questionId) + '</code>\n' + BOX_V + ' \uD83D\uDD50 ' + formatTime(new Date().toISOString()) + ' IST\n' + BOX_V + '\n' + cardBottom,
            { inline_keyboard: [
              [{ text: '\u21A9\uFE0F Retrieve', callback_data: 'retrieve:' + questionId }],
              [{ text: '\uD83D\uDCAC Answer', callback_data: 'answer:' + questionId }],
              [{ text: dPinned ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: (dPinned ? 'unpin:' : 'pin:') + questionId }],
              [{ text: '\uD83D\uDDD1 Delete', callback_data: 'delete:' + questionId }]
            ] }
          );
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not dismiss - try again'); }
      }
      else if (action === 'edit') {
        try {
          await clearAnswerSession(cbChatId);
          await clearLookupSession(cbChatId);
          await clearPreviewSession(cbChatId);
          await saveEditSession(cbChatId, questionId);
          await answerCallback(callback.id, '\u270F\uFE0F Edit mode ready');
          var eq = await getQuestion(questionId).catch(function() { return null; });
          await sendTelegram(cbChatId,
            cardTop('\u270F\uFE0F <b>EDIT MODE</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Send the revised answer as your next message.\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDC64 Visitor \u2500 <b>' + esc(visitorName(eq && eq.name)) + '</b>\n' + BOX_V + ' \uD83C\uDD94 ID \u2500 <code>' + esc(questionId) + '</code>\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDCAC <b>Question</b>\n' + BOX_V + ' “' + esc(clipText(eq && eq.question || 'Question unavailable', 140)) + '”\n' + BOX_V + '\n' + BOX_V + ' Current answer: “' + esc(clipText(eq && eq.answer || '—', 140)) + '”\n' + BOX_V + '\n' + BOX_V + ' /cancel to exit.\n' + BOX_V + '\n' + cardBottom
          );
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not start edit - try again'); }
      }
      else if (action === 'pin') {
        try {
          var q = await getQuestion(questionId);
          if (!q) { await answerCallback(callback.id, '\u26A0\uFE0F Question not found \u2014 it may have been deleted'); return res.status(200).json({ ok: true }); }
          if (q.dismissed) { await answerCallback(callback.id, '\u26A0\uFE0F Cannot pin \u2014 question is dismissed. Retrieve it first.'); return res.status(200).json({ ok: true }); }
          if (q.pinned) { await answerCallback(callback.id, '\uD83D\uDCCD Already pinned'); return res.status(200).json({ ok: true }); }
          await pinQuestion(questionId);
          await answerCallback(callback.id, '\uD83D\uDCCD Pinned to top on site');
          q.pinned = true; var card = buildCardForQuestion(q); await editMessage(cbChatId, cbMessageId, card.text, card.replyMarkup);
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not pin - try again'); }
      }
      else if (action === 'unpin') {
        try {
          var q = await getQuestion(questionId);
          if (!q) { await answerCallback(callback.id, '\u26A0\uFE0F Question not found \u2014 it may have been deleted'); return res.status(200).json({ ok: true }); }
          if (q.dismissed) { await answerCallback(callback.id, '\u26A0\uFE0F Cannot unpin \u2014 question is dismissed. Retrieve it first.'); return res.status(200).json({ ok: true }); }
          if (!q.pinned) { await answerCallback(callback.id, '\uD83D\uDCCD Not pinned'); return res.status(200).json({ ok: true }); }
          await unpinQuestion(questionId);
          await answerCallback(callback.id, '\uD83D\uDCCD Unpinned');
          q.pinned = false; var card = buildCardForQuestion(q); await editMessage(cbChatId, cbMessageId, card.text, card.replyMarkup);
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not unpin - try again'); }
      }
      // PREVIEW CONFIRM (answer preview -> confirm flow)
      else if (action === 'previewconfirm') {
        try {
          var session = await getPreviewSession(cbChatId);
          if (!session || !session.fields || isSessionExpired(session)) { await clearPreviewSession(cbChatId); await answerCallback(callback.id, '\u26A0\uFE0F Session expired - try answering again'); return res.status(200).json({ ok: true }); }
          var qid = session.fields.questionId && session.fields.questionId.stringValue;
          var ansText = session.fields.answerText && session.fields.answerText.stringValue;
          if (!qid || !ansText) { await clearPreviewSession(cbChatId); await answerCallback(callback.id, '\u26A0\uFE0F Session data missing \u2014 try answering again'); return res.status(200).json({ ok: true }); }
          await answerQuestion(qid, ansText);
          await clearPreviewSession(cbChatId);
          await answerCallback(callback.id, '\u2705 Published!');
          await sendAnsweredCard(cbChatId, qid, ansText, undefined, false);
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Publish failed - try again'); }
      }
      else if (action === 'previewedit') {
        try {
          var session = await getPreviewSession(cbChatId);
          if (!session || !session.fields || isSessionExpired(session)) { await clearPreviewSession(cbChatId); await answerCallback(callback.id, '\u26A0\uFE0F Session expired'); return res.status(200).json({ ok: true }); }
          var qid = session.fields.questionId && session.fields.questionId.stringValue;
          await clearPreviewSession(cbChatId);
          await answerCallback(callback.id, '\u270F\uFE0F Send your revised answer');
          await saveEditSession(cbChatId, qid);
          await sendTelegram(cbChatId,
            cardTop('\u270F\uFE0F <b>REVISE ANSWER</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Send the corrected answer for:\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' <i>Type your revised answer as\n' + BOX_V + ' your next message.</i>\n' + BOX_V + '\n' + cardBottom
          );
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not enter edit mode \u2014 use /edit id'); }
      }
      else if (action === 'previewcancel') {
        await clearPreviewSession(cbChatId);
        await answerCallback(callback.id, 'Answer cancelled');
        await editMessage(cbChatId, cbMessageId,
          cardTop('\u274C <b>ANSWER CANCELLED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Your answer was not published.\n' + BOX_V + ' The question is unchanged.\n' + BOX_V + '\n' + cardBottom
        );
      }
      else if (action === 'retrieve') {
        try {
          var result = await retrieveQuestion(questionId);
          if (result.restoredAs === 'not_dismissed') {
            await answerCallback(callback.id, '\u26A0\uFE0F Already active (not dismissed)');
            var q = result.question;
            var card = buildCardForQuestion(q);
            await editMessage(cbChatId, cbMessageId, card.text, card.replyMarkup);
          } else {
            var q = result.question;
            q.dismissed = false;
            if (result.restoredAs === 'answered') {
              q.answered = true;
              await answerCallback(callback.id, '\u21A9\uFE0F Restored &amp; published to site');
              var card = buildCardForQuestion(q);
              await editMessage(cbChatId, cbMessageId, card.text, card.replyMarkup);
            } else {
              q.answered = false;
              await answerCallback(callback.id, '\u21A9\uFE0F Restored to pending queue');
              var card = buildCardForQuestion(q);
              await editMessage(cbChatId, cbMessageId, card.text, card.replyMarkup);
            }
          }
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not retrieve - try /get id'); }
      }
      // /all pagination
      else if (action === 'all') {
        if (questionId === 'noop') { await answerCallback(callback.id, ''); return res.status(200).json({ ok: true, callback: action }); }
        var page = parseInt(questionId, 10) || 1;
        try {
          var all = await listAllQuestions();
          var sorted = all.slice().sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
          var result = buildAllPageText(sorted, page);
          await answerCallback(callback.id, 'Page ' + page + '/' + result.pages);
          await editMessage(cbChatId, cbMessageId, result.text, buildAllPageButtons(page, result.pages));
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Error loading page'); }
      }
      else if (action === 'confirmdeleteall') {
        try {
          var all = await listAllQuestions();
          var count = all.length;
          await answerCallback(callback.id, '\uD83D\uDDD1 Deleting\u2026');
          await editMessage(cbChatId, cbMessageId,
            cardTop('\uD83D\uDDD1 <b>DELETING ALL\u2026</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Removing ' + count + ' questions\u2026\n' + BOX_V + '\n' + cardBottom
          );
          var deleted = 0;
          for (var di = 0; di < all.length; di++) {
            try { await deleteQuestion(all[di].id); deleted++; } catch (e) {}
          }
          await editMessage(cbChatId, cbMessageId,
            cardTop('\u2705 <b>ALL DELETED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Successfully deleted <b>' + deleted + '</b> question' + (deleted === 1 ? '' : 's') + '.\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDD50 ' + formatTime(new Date().toISOString()) + ' IST\n' + BOX_V + '\n' + cardBottom
          );
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Delete all failed'); }
      }
      else if (action === 'canceldeleteall') {
        await answerCallback(callback.id, 'Delete all cancelled');
        await editMessage(cbChatId, cbMessageId,
          cardTop('\u2705 <b>CANCELLED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' All questions are safe.\n' + BOX_V + ' Nothing was deleted.\n' + BOX_V + '\n' + cardBottom
        );
      }
      else if (action === 'confirmretrieveall') {
        try {
          await answerCallback(callback.id, '\u21A9\uFE0F Retrieving all\u2026');
          await editMessage(cbChatId, cbMessageId,
            loadingCard('\u21A9\uFE0F <b>RETRIEVING ALL\u2026</b>', 'Restoring dismissed questions...')
          );
          var all = await listAllQuestions();
          var dismissed = all.filter(function(q) { return questionState(q) === 'DISMISSED'; });
          var toPending = 0, toSite = 0;
          for (var ri = 0; ri < dismissed.length; ri++) {
            var hasA = dismissed[ri].answer && String(dismissed[ri].answer).trim().length > 0;
            if (hasA) toSite++; else toPending++;
            await retrieveQuestion(dismissed[ri].id);
          }
          await answerCallback(callback.id, '\u21A9\uFE0F All retrieved!');
          var detailLines = BOX_V + ' All dismissed questions restored.\n';
          if (toPending > 0) detailLines += BOX_V + ' \u23F3 <b>' + toPending + '</b> \u2192 pending queue\n';
          if (toSite > 0) detailLines += BOX_V + ' \u2705 <b>' + toSite + '</b> \u2192 back on site (with answers)\n';
          await editMessage(cbChatId, cbMessageId,
            cardTop('\u2705 <b>ALL RETRIEVED</b>') + '\n' + BOX_V + '\n' + detailLines + BOX_V + '\n' + BOX_V + ' \uD83D\uDD50 ' + formatTime(new Date().toISOString()) + ' IST\n' + BOX_V + '\n' + cardBottom
          );
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Retrieve all failed'); }
      }
      else if (action === 'cancelretrieveall') {
        await answerCallback(callback.id, 'Retrieve all cancelled');
        await editMessage(cbChatId, cbMessageId,
          cardTop('\u2705 <b>CANCELLED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Questions remain dismissed.\n' + BOX_V + ' Nothing was changed.\n' + BOX_V + '\n' + cardBottom
        );
      }
      // DISMISS ALL confirmation flow
      else if (action === 'confirmdismissall') {
        try {
          await answerCallback(callback.id, '\uD83D\uDE48 Dismissing all\u2026');
          await editMessage(cbChatId, cbMessageId,
            cardTop('\uD83D\uDE48 <b>DISMISSING ALL\u2026</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Hiding active questions from site...\n' + BOX_V + '\n' + cardBottom
          );

          var all = await listAllQuestions();
          var active = all.filter(function(q) { return questionState(q) !== 'DISMISSED'; });
          var answeredCount = 0, unansweredCount = 0;
          var dismissedCount = 0;
          for (var di = 0; di < active.length; di++) {
            var st = questionState(active[di]);
            if (st === 'ANSWERED') answeredCount++; else unansweredCount++;
            try {
              await dismissQuestion(active[di].id);
              dismissedCount++;
            } catch (e) {}
          }
          await answerCallback(callback.id, '\uD83D\uDE48 All dismissed!');
          var detailLines = BOX_V + ' Successfully dismissed <b>' + dismissedCount + '</b> question' + (dismissedCount === 1 ? '' : 's') + '.\n';
          if (answeredCount > 0) detailLines += BOX_V + ' \u2705 <b>' + answeredCount + '</b> answered \u2192 hidden (retrieve \u2192 back on site)\n';
          if (unansweredCount > 0) detailLines += BOX_V + ' \u23F3 <b>' + unansweredCount + '</b> unanswered \u2192 hidden (retrieve \u2192 back to pending)\n';
          detailLines += BOX_V + '\n' + BOX_V + ' Use /retrieveall or /retrieve &lt;id&gt;\n';
          detailLines += BOX_V + ' to restore any question.\n';
          await editMessage(cbChatId, cbMessageId,
            cardTop('\uD83D\uDE48 <b>ALL DISMISSED</b>') + '\n' + BOX_V + '\n' + detailLines + BOX_V + '\n' + BOX_V + ' \uD83D\uDD50 ' + formatTime(new Date().toISOString()) + ' IST\n' + BOX_V + '\n' + cardBottom
          );
          return res.status(200).json({ ok: true, callback: 'confirmdismissall' });
        } catch (e) {
          await answerCallback(callback.id, '\u26A0\uFE0F Dismiss all failed - try again');
          return res.status(200).json({ ok: true, error: e.message });
        }
      }
      else if (action === 'canceldismissall') {
        await answerCallback(callback.id, 'Dismiss all cancelled');
        await editMessage(cbChatId, cbMessageId,
          cardTop('\u2705 <b>CANCELLED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No questions were dismissed.\n' + BOX_V + ' Everything stays as it was.\n' + BOX_V + '\n' + cardBottom
        );
      }
      // /dismissed pagination
      else if (action === 'dismissed') {
        if (questionId === 'noop') { await answerCallback(callback.id, ''); return res.status(200).json({ ok: true, callback: action }); }
        var page = parseInt(questionId, 10) || 1;
        try {
          var all = await listAllQuestions();
          var dismissed = all.filter(function(q) { return questionState(q) === 'DISMISSED'; })
            .sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
          var result = buildDismissedPageText(dismissed, page);
          await answerCallback(callback.id, 'Page ' + page + '/' + result.pages);
          await editMessage(cbChatId, cbMessageId, result.text, buildDismissedPageButtons(page, result.pages));
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Error loading page'); }
      }
      else if (action === 'pending') {
        if (questionId === 'noop') { await answerCallback(callback.id, ''); return res.status(200).json({ ok: true, callback: action }); }
        var page = parseInt(questionId, 10) || 1;
        try {
          var all = await listAllQuestions();
          var items = all.filter(function(q) { return questionState(q) === 'UNANSWERED'; })
            .sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
          var result = buildQueuePageText(items, page, '\u23F3 <b>PENDING INBOX</b>', 'Tap Answer or reply to a card.');
          await answerCallback(callback.id, 'Page ' + page + '/' + result.pages);
          await editMessage(cbChatId, cbMessageId, result.text, buildQueuePageButtons('pending', result.page, result.pages));
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Error loading page'); }
      }
      else if (action === 'refresh') {
        if (questionId === 'noop') { await answerCallback(callback.id, ''); return res.status(200).json({ ok: true, callback: action }); }
        var page = parseInt(questionId, 10) || 1;
        try {
          var all = await listAllQuestions();
          var items = all.filter(function(q) { return questionState(q) === 'UNANSWERED' || questionState(q) === 'DISMISSED'; })
            .sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
          var result = buildQueuePageText(items, page, '\uD83D\uDD04 <b>ATTENTION QUEUE</b>', 'Pending + hidden questions.');
          await answerCallback(callback.id, 'Page ' + page + '/' + result.pages);
          await editMessage(cbChatId, cbMessageId, result.text, buildQueuePageButtons('refresh', result.page, result.pages));
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Error loading page'); }
      }
      else {
        await answerCallback(callback.id, 'Unknown action');
      }
      return res.status(200).json({ ok: true, callback: action });
    }

    /* -- TEXT MESSAGE -- */
    if (!message) return res.status(200).json({ ok: true, ignored: 'no message' });

    var chatId = message.chat && message.chat.id;
    var allowedChatId = String(process.env.TELEGRAM_CHAT_ID || '');
    if (allowedChatId && String(chatId) !== allowedChatId) {
      return res.status(200).json({ ok: true, ignored: 'wrong chat' });
    }

    var text = String((message.text || message.caption) || '').trim();
    if (!text) return res.status(200).json({ ok: true, ignored: 'empty' });
    var command = text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, '');

    /* Keyboard shortcut handling */
    if (text === '\uD83D\uDCCB Pending') { /* fall through to /pending */ }
    else if (text === '\uD83D\uDCCA Stats') { /* fall through to /stats */ }
    else if (text === '\uD83D\uDD50 Recent') { /* fall through to /recent */ }
    else if (text === '\uD83D\uDCD6 Help') { /* fall through to /help */ }
    else if (text === '\uD83D\uDD0D Search') {
      await sendTelegram(chatId,
        cardTop('\uD83D\uDD0D <b>SEARCH</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Type your search like:\n' + BOX_V + ' /search react\n' + BOX_V + ' /search healthcare\n' + BOX_V + ' /search anonymous\n' + BOX_V + '\n' + cardBottom,
        message.message_id, REPLY_KEYBOARD);
      return res.status(200).json({ ok: true });
    }

    /* /start */
    if (command === '/start') {
      var welcomeText = await buildWelcomeText();
      await sendTelegram(chatId, welcomeText, message.message_id, REPLY_KEYBOARD);
      return res.status(200).json({ ok: true });
    }

    /* /help */
    if (command === '/help') {
      await sendTelegram(chatId, HELP_TEXT, message.message_id, REPLY_KEYBOARD);
      return res.status(200).json({ ok: true });
    }

    /* /cancel - abort edit or lookup sessions */
    if (command === '/cancel') {
      var editSess = await getEditSession(chatId);
      var lookupSess = await getLookupSession(chatId);
      var previewSess = await getPreviewSession(chatId);
      var answerSess = await getAnswerSession(chatId);
      var sessions = [];
      if (editSess && !isSessionExpired(editSess)) sessions.push('edit');
      if (lookupSess && !isSessionExpired(lookupSess)) sessions.push('lookup');
      if (previewSess && !isSessionExpired(previewSess)) sessions.push('preview');
      if (answerSess && !isSessionExpired(answerSess)) sessions.push('answer');
      await clearEditSession(chatId);
      await clearLookupSession(chatId);
      await clearPreviewSession(chatId);
      await clearAnswerSession(chatId);
      if (sessions.length === 0) {
        await sendTelegram(chatId,
          cardTop('\u2705 <b>NO ACTIVE SESSION</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No session was running.\n' + BOX_V + ' You are already in normal mode.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
      } else {
        await sendTelegram(chatId,
          cardTop('\u2705 <b>CANCELLED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Cleared: <b>' + sessions.join(', ') + '</b>\n' + BOX_V + ' session' + (sessions.length > 1 ? 's' : '') + '. You are back\n' + BOX_V + ' to normal mode.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
      }
      return res.status(200).json({ ok: true });
    }

    /* /stats */
    if (command === '/stats' || text === '\uD83D\uDCCA Stats') {
      var loadingId = await sendLoadingCard(chatId, '\uD83D\uDCCA <b>LOADING STATS\u2026</b>', 'Crunching your AMA dashboard...', message.message_id);
      await sendStats(chatId, message.message_id, loadingId);
      return res.status(200).json({ ok: true });
    }

    /* /pending */
    if (command === '/pending' || text === '\uD83D\uDCCB Pending') {
      var loadingId = await sendLoadingCard(chatId, '\uD83D\uDCCB <b>LOADING PENDING\u2026</b>', 'Checking your unanswered queue...', message.message_id);
      var all = await listAllQuestions();
      var items = all.filter(function(q) { return questionState(q) === 'UNANSWERED'; })
        .sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
      if (!items.length) {
        await respondTelegram(chatId,
          cardTop('\u2705 <b>ALL CAUGHT UP</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No unanswered questions right now.\n' + BOX_V + ' Enjoy the peace while it lasts.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
        return res.status(200).json({ ok: true });
      }
      var result = buildQueuePageText(items, 1, '\u23F3 <b>PENDING INBOX</b>', 'Tap Answer or reply to a card.');
      await respondTelegram(chatId, result.text, message.message_id, buildQueuePageButtons('pending', result.page, result.pages), loadingId);
      return res.status(200).json({ ok: true });
    }

    /* /refresh */
    if (command === '/refresh') {
      var loadingId = await sendLoadingCard(chatId, '\uD83D\uDD04 <b>REFRESHING QUEUE\u2026</b>', 'Reloading pending and dismissed questions...', message.message_id);
      var all = await listAllQuestions();
      var items = all.filter(function(q) { return questionState(q) === 'UNANSWERED' || questionState(q) === 'DISMISSED'; })
        .sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
      if (!items.length) {
        await respondTelegram(chatId,
          cardTop('\u2705 <b>QUEUE EMPTY</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No pending or dismissed questions.\n' + BOX_V + ' Everything is handled.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
        return res.status(200).json({ ok: true });
      }
      var result = buildQueuePageText(items, 1, '\uD83D\uDD04 <b>ATTENTION QUEUE</b>', 'Pending + hidden questions.');
      await respondTelegram(chatId, result.text, message.message_id, buildQueuePageButtons('refresh', result.page, result.pages), loadingId);
      return res.status(200).json({ ok: true });
    }

    /* /recent */
    if (command === '/recent' || text === '\uD83D\uDD50 Recent') {
      var loadingId = await sendLoadingCard(chatId, '\uD83D\uDD50 <b>LOADING RECENT\u2026</b>', 'Finding your latest answers...', message.message_id);
      await sendRecent(chatId, message.message_id, loadingId);
      return res.status(200).json({ ok: true });
    }

    /* /search <text> */
    if (command === '/search') {
      var searchTerm = text.split(/\s+/).slice(1).join(' ');
      var loadingId = searchTerm && searchTerm.trim().length >= 2
        ? await sendLoadingCard(chatId, '\uD83D\uDD0D <b>SEARCHING\u2026</b>', 'Scanning questions, answers, and names...', message.message_id)
        : null;
      await searchQuestions(chatId, searchTerm, message.message_id, loadingId);
      return res.status(200).json({ ok: true });
    }

    /* /export */
    if (command === '/export') {
      var loadingId = await sendLoadingCard(chatId, '\uD83D\uDCE6 <b>EXPORTING\u2026</b>', 'Preparing your AMA export...', message.message_id);
      await exportQuestions(chatId, message.message_id, loadingId);
      return res.status(200).json({ ok: true });
    }

    /* /edit <id> - enter edit mode for an answered question */
    if (command === '/edit') {
      var qid = text.split(/\s+/)[1];
      if (!qid) {
        await sendTelegram(chatId,
          cardTop('\u270F\uFE0F <b>EDIT</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Edit the answer to a question.\n' + BOX_V + ' Only works on answered questions.\n' + BOX_V + '\n' + BOX_V + ' <code>/edit &lt;id&gt;</code>\n' + BOX_V + '\n' + BOX_V + ' Then send the new answer text.\n' + BOX_V + ' /cancel to abort.\n' + BOX_V + '\n' + BOX_V + ' Use /all or /recent to find IDs.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      try {
        var loadingId = await sendLoadingCard(chatId, '\u270F\uFE0F <b>LOADING EDIT MODE\u2026</b>', 'Checking the answer before edit mode...', message.message_id);
        var q = await getQuestion(qid);
        if (!q) {
          await respondTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question with that ID exists.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /all to browse IDs.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD, loadingId);
          return res.status(200).json({ ok: true });
        }
        if (questionState(q) !== 'ANSWERED') {
          await respondTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>CANNOT EDIT</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This question is <b>' + questionState(q) + '</b>.\n' + BOX_V + ' Only answered questions can be edited.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /answer ' + esc(qid) + ' to answer it first.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD, loadingId);
          return res.status(200).json({ ok: true });
        }
        await clearAnswerSession(chatId);
        await clearLookupSession(chatId);
        await clearPreviewSession(chatId);
        await saveEditSession(chatId, qid);
        await respondTelegram(chatId,
          cardTop('\u270F\uFE0F <b>EDIT MODE</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Send the revised answer as your next message.\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDC64 Visitor \u2500 <b>' + esc(visitorName(q.name)) + '</b>\n' + BOX_V + ' \uD83C\uDD94 ID \u2500 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDCAC <b>Question</b>\n' + BOX_V + ' “' + esc(clipText(q.question, 140)) + '”\n' + BOX_V + '\n' + BOX_V + ' Current answer: “' + esc(clipText(q.answer || '—', 140)) + '”\n' + BOX_V + '\n' + BOX_V + ' /cancel to exit.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
      } catch (e) {
        await respondTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>EDIT FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not start edit. Check the ID.\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
      }
      return res.status(200).json({ ok: true });
    }

    /* /answer <id> <text> - one-shot answer */
    if (command === '/answer') {
      var parts = text.split(/\s+/);
      var qid = parts[1];
      var answerText = parts.slice(2).join(' ').trim();
      if (!qid || !answerText) {
        await sendTelegram(chatId,
          cardTop('\uD83D\uDCA1 <b>TIP</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Answer a question in one shot:\n' + BOX_V + '\n' + BOX_V + ' <code>/answer &lt;id&gt; &lt;your answer&gt;</code>\n' + BOX_V + '\n' + BOX_V + ' Example:\n' + BOX_V + ' <code>/answer abc123 Yes, I use React!</code>\n' + BOX_V + '\n' + BOX_V + ' Or reply to a question message\n' + BOX_V + ' to answer it directly.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      try {
        var q = await getQuestion(qid);
        if (!q) {
          await sendTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question with that ID exists.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /pending or /all to find IDs.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD);
          return res.status(200).json({ ok: true });
        }
        if (questionState(q) === 'ANSWERED') {
          await sendTelegram(chatId,
            cardTop('\u270F\uFE0F <b>ALREADY ANSWERED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This question already has an answer.\n' + BOX_V + ' Use /edit to revise the existing one.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' <code>/edit ' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD);
          return res.status(200).json({ ok: true });
        }
        await savePreviewSession(chatId, qid, answerText);
        await sendTelegram(chatId,
          answerPreviewCard(q, answerText, qid),
          message.message_id,
          previewButtons()
        );
      } catch (e) {
        await sendTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>ANSWER FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not process your answer.\n' + BOX_V + ' Check the ID and try again.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
      }
      return res.status(200).json({ ok: true });
    }

    /* /pin <id> */
    if (command === '/pin') {
      var qid = text.split(/\s+/)[1];
      if (!qid) {
        await sendTelegram(chatId,
          cardTop('\uD83D\uDCCD <b>PIN</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Pin a question to the top of\n' + BOX_V + ' your site\'s AMA section.\n' + BOX_V + '\n' + BOX_V + ' <code>/pin &lt;id&gt;</code>\n' + BOX_V + '\n' + BOX_V + ' Use /all to find IDs.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      try {
        var loadingId = await sendLoadingCard(chatId, '\uD83D\uDCCD <b>PINNING\u2026</b>', 'Checking the question before pinning...', message.message_id);
        var q = await getQuestion(qid);
        if (!q) {
          await respondTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question with that ID exists.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /all to browse IDs.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD, loadingId);
          return res.status(200).json({ ok: true });
        }
        if (q.dismissed) {
          await respondTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>CANNOT PIN</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Dismissed questions are hidden\n' + BOX_V + ' from your site. Retrieve it first.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /retrieve ' + esc(qid) + ' first.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD, loadingId);
          return res.status(200).json({ ok: true });
        }
        if (q.pinned) {
          await respondTelegram(chatId,
            cardTop('\uD83D\uDCCD <b>ALREADY PINNED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This question is already pinned\n' + BOX_V + ' to the top of your site.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /unpin ' + esc(qid) + ' to remove.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD, loadingId);
          return res.status(200).json({ ok: true });
        }
        await pinQuestion(qid);
        await respondTelegram(chatId,
          cardTop('\uD83D\uDCCD <b>PINNED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This question is now pinned to\n' + BOX_V + ' the top of your site\'s AMA section.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /unpin ' + esc(qid) + ' to remove.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
      } catch (e) {
        await respondTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>PIN FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not pin. Check the ID.\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
      }
      return res.status(200).json({ ok: true });
    }

    /* /unpin <id> */
    if (command === '/unpin') {
      var qid = text.split(/\s+/)[1];
      if (!qid) {
        await sendTelegram(chatId,
          cardTop('\uD83D\uDCCD <b>UNPIN</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Remove pin from a question.\n' + BOX_V + ' It returns to normal sort order.\n' + BOX_V + '\n' + BOX_V + ' <code>/unpin &lt;id&gt;</code>\n' + BOX_V + '\n' + BOX_V + ' Use /all to find IDs.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      try {
        var loadingId = await sendLoadingCard(chatId, '\uD83D\uDCCD <b>UNPINNING\u2026</b>', 'Checking the question before removing the pin...', message.message_id);
        var q = await getQuestion(qid);
        if (!q) {
          await respondTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question with that ID exists.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /all to browse IDs.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD, loadingId);
          return res.status(200).json({ ok: true });
        }
        if (q.dismissed) {
          await respondTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>CANNOT UNPIN</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Dismissed questions are hidden\n' + BOX_V + ' from your site. Retrieve it first.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /retrieve ' + esc(qid) + ' first.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD, loadingId);
          return res.status(200).json({ ok: true });
        }
        if (!q.pinned) {
          await respondTelegram(chatId,
            cardTop('\uD83D\uDCCD <b>NOT PINNED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This question is not pinned.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD, loadingId);
          return res.status(200).json({ ok: true });
        }
        await unpinQuestion(qid);
        await respondTelegram(chatId,
          cardTop('\uD83D\uDCCD <b>UNPINNED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Pin removed. Question is back\n' + BOX_V + ' in normal order on your site.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
      } catch (e) {
        await respondTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>UNPIN FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not unpin. Check the ID.\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
      }
      return res.status(200).json({ ok: true });
    }

    /* /pinned - list all pinned questions */
    if (command === '/pinned') {
      var loadingId = await sendLoadingCard(chatId, '\uD83D\uDCCD <b>LOADING PINNED\u2026</b>', 'Finding questions pinned to the site...', message.message_id);
      var all = await listAllQuestions();
      var pinned = all.filter(function(q) { return q.pinned && questionState(q) !== 'DISMISSED'; })
        .sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
      if (!pinned.length) {
        await respondTelegram(chatId,
          cardTop('\uD83D\uDCCD <b>NO PINNED QUESTIONS</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Nothing is pinned right now.\n' + BOX_V + '\n' + BOX_V + ' Use /pin &lt;id&gt; to pin a question\n' + BOX_V + ' to the top of your site.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
        return res.status(200).json({ ok: true });
      }
      var lines = [
        cardTop('\uD83D\uDCCD <b>PINNED QUESTIONS</b> (' + pinned.length + ')'),
        BOX_V
      ];
      for (var idx = 0; idx < pinned.length; idx++) {
        var q = pinned[idx];
        var st = questionState(q);
        var stateEmoji = st === 'ANSWERED' ? '\u2705' : st === 'DISMISSED' ? '\uD83D\uDE48' : '\u23F3';
        var qAge = timeAgo(q.createdAt);
        lines.push(BOX_V + ' ' + stateEmoji + ' <b>' + esc(visitorName(q.name)) + '</b>' + (qAge ? ' \u00B7 ' + esc(qAge) : ''));
        lines.push(BOX_V + ' \uD83D\uDCAC ' + esc(q.question).slice(0, 120));
        if (st === 'ANSWERED' && q.answer) {
          lines.push(BOX_V + ' \u2192 ' + esc(q.answer).slice(0, 80));
        }
        if (q.votes > 0) lines.push(BOX_V + ' \uD83D\uDC4D ' + q.votes + ' votes');
        lines.push(BOX_V + ' \uD83C\uDD94 <code>' + esc(q.id) + '</code>');
        lines.push(BOX_V);
      }
      lines.push(BOX_V + ' /unpin &lt;id&gt; to remove a pin');
      lines.push(cardBottom);
      await respondTelegram(chatId, lines.join('\n'), message.message_id, REPLY_KEYBOARD, loadingId);
      return res.status(200).json({ ok: true });
    }

    /* /get <id> */
    if (command === '/get') {
      var qid = text.split(/\s+/)[1];
      if (!qid) {
        await sendTelegram(chatId,
          cardTop('\uD83D\uDCA1 <b>TIP</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Look up a question by ID.\n' + BOX_V + '\n' + BOX_V + ' <code>/get &lt;id&gt;</code>\n' + BOX_V + '\n' + BOX_V + ' Example:\n' + BOX_V + ' <code>/get abc123-def456</code>\n' + BOX_V + '\n' + BOX_V + ' Use /all to browse all IDs.\n' + BOX_V + ' Use /lookup for interactive mode.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      var loadingId = await sendLoadingCard(chatId, '\uD83D\uDCCB <b>LOADING DETAILS\u2026</b>', 'Fetching the full question card...', message.message_id);
      await sendFullDetailCard(chatId, qid, message.message_id, loadingId);
      return res.status(200).json({ ok: true });
    }

    /* /lookup */
    if (command === '/lookup') {
      await saveLookupSession(chatId);
      await sendTelegram(chatId,
        cardTop('\uD83D\uDD0D <b>LOOKUP MODE</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Paste a question ID below.\n' + BOX_V + '\n' + BOX_V + ' Use /all to browse all IDs\n' + BOX_V + ' and find the one you need.\n' + BOX_V + '\n' + BOX_V + ' Send /cancel to exit.\n' + BOX_V + '\n' + cardBottom,
        message.message_id, REPLY_KEYBOARD);
      return res.status(200).json({ ok: true });
    }

    /* /all */
    if (command === '/all') {
      var loadingId = await sendLoadingCard(chatId, '\uD83D\uDCCB <b>LOADING ALL\u2026</b>', 'Browsing the full AMA database...', message.message_id);
      var all = await listAllQuestions();
      if (!all.length) {
        await respondTelegram(chatId,
          cardTop('\uD83D\uDCEC <b>NO QUESTIONS YET</b>') + '\n' + BOX_V + '\n' + BOX_V + ' The database is empty.\n' + BOX_V + ' Questions will appear here when\n' + BOX_V + ' visitors submit them.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
        return res.status(200).json({ ok: true });
      }
      var sorted = all.slice().sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
      var result = buildAllPageText(sorted, 1);
      var buttons = buildAllPageButtons(result.page, result.pages);
      await respondTelegram(chatId, result.text, message.message_id, buttons, loadingId);
      return res.status(200).json({ ok: true });
    }

    /* /deleteall */
    if (command === '/deleteall') {
      var loadingId = await sendLoadingCard(chatId, '\uD83D\uDDD1 <b>CHECKING DELETE ALL\u2026</b>', 'Counting questions before confirmation...', message.message_id);
      var all = await listAllQuestions();
      if (!all.length) {
        await respondTelegram(chatId,
          cardTop('\uD83D\uDCEC <b>NOTHING TO DELETE</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No questions in the database.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
        return res.status(200).json({ ok: true });
      }
      var count = all.length;
      await respondTelegram(chatId,
        cardTop('\u26A0\uFE0F <b>DELETE ALL?</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This permanently deletes <b>' + count + '</b> question' + (count === 1 ? '' : 's') + '.\n' + BOX_V + ' This cannot be undone.\n' + BOX_V + '\n' + BOX_V + ' Use only when you want a clean reset.\n' + BOX_V + '\n' + cardBottom,
        message.message_id,
        { inline_keyboard: [[
          { text: '\u2705 Yes, Delete All', callback_data: 'confirmdeleteall' },
          { text: '\u274C Cancel', callback_data: 'canceldeleteall' }
        ]] },
        loadingId
      );
      return res.status(200).json({ ok: true });
    }
    /* /delete <id> - delete a single question with confirmation */
    if (command === '/delete') {
      var qid = text.split(/\s+/)[1];
      if (qid === 'all') {
        await sendTelegram(chatId,
          cardTop('\uD83D\uDDD1\uFE0F <b>DELETE ALL</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Did you mean /deleteall?\n' + BOX_V + ' Use that to delete all questions.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      if (!qid) {
        await sendTelegram(chatId,
          cardTop('\uD83D\uDDD1\uFE0F <b>DELETE</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Delete a single question permanently.\n' + BOX_V + '\n' + BOX_V + ' <code>/delete &lt;id&gt;</code>\n' + BOX_V + '\n' + BOX_V + ' Use /all or /pending to find IDs.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      try {
        var loadingId = await sendLoadingCard(chatId, '\uD83D\uDDD1 <b>CHECKING DELETE\u2026</b>', 'Looking up the question before confirmation...', message.message_id);
        var q = await getQuestion(qid);
        if (!q) {
          await respondTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question with that ID exists.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /all to browse IDs.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD, loadingId);
          return res.status(200).json({ ok: true });
        }
        await respondTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>DELETE QUESTION?</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This permanently removes the question.\n' + BOX_V + ' This cannot be undone.\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDC64 Visitor \u2500 <b>' + esc(visitorName(q.name)) + '</b>\n' + BOX_V + ' \uD83C\uDD94 ID \u2500 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' “' + esc(clipText(q.question, 140)) + '”\n' + BOX_V + '\n' + cardBottom,
          message.message_id,
          { inline_keyboard: [[
            { text: '\u2705 Yes, Delete', callback_data: 'confirmdelete:' + qid },
            { text: '\u274C Cancel', callback_data: 'canceldelete:' + qid }
          ]] },
          loadingId
        );
      } catch (e) {
        await respondTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>DELETE FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not look up the question.\n' + BOX_V + ' Check the ID and try again.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
      }
      return res.status(200).json({ ok: true });
    }


    /* /dismissall - dismiss all active (non-dismissed) questions with confirmation */
    if (command === '/dismissall') {
      try {
        var loadingId = await sendLoadingCard(chatId, '\uD83D\uDE48 <b>CHECKING DISMISS ALL\u2026</b>', 'Counting active questions before confirmation...', message.message_id);
        var all = await listAllQuestions();
        var active = all.filter(function(q) { return questionState(q) !== 'DISMISSED'; });
        if (!active.length) {
          await respondTelegram(chatId,
            cardTop('\u2705 <b>NOTHING TO DISMISS</b>') + '\n' + BOX_V + '\n' + BOX_V + ' All questions are already dismissed.\n' + BOX_V + '\n' + BOX_V + ' Use /retrieveall to restore them.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD, loadingId);
          return res.status(200).json({ ok: true });
        }
        var answeredCount = active.filter(function(q) { return questionState(q) === 'ANSWERED'; }).length;
        var unansweredCount = active.length - answeredCount;
        var detailLine = BOX_V + ' <b>' + active.length + '</b> active question' + (active.length === 1 ? '' : 's') + ' will be hidden from your site.';
        if (answeredCount > 0) detailLine += '\n' + BOX_V + ' \u2705 ' + answeredCount + ' answered \u2192 retrieve restores to site';
        if (unansweredCount > 0) detailLine += '\n' + BOX_V + ' \u23F3 ' + unansweredCount + ' unanswered \u2192 retrieve restores to pending';

        await respondTelegram(chatId,
          cardTop('\uD83D\uDE48 <b>DISMISS ALL?</b>') + '\n' + BOX_V + '\n' + detailLine + '\n' + BOX_V + '\n' + BOX_V + ' Data stays safe and can be restored.\n' + BOX_V + ' Use /retrieveall to bring them back.\n' + BOX_V + '\n' + cardBottom,
          message.message_id,
          { inline_keyboard: [[
            { text: '\uD83D\uDE48 Yes, Dismiss All', callback_data: 'confirmdismissall' },
            { text: '\u274C Cancel', callback_data: 'canceldismissall' }
          ]] },
          loadingId
        );
        return res.status(200).json({ ok: true });
      } catch (e) {
        console.error('/dismissall error:', e);
        await respondTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>DISMISS ALL FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not load questions.\n' + BOX_V + ' Please try again in a moment.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
        return res.status(200).json({ ok: true, error: e.message });
      }
    }

    /* /dismiss <id> - dismiss a single question by ID */
    if (command === '/dismiss') {
      var qid = text.split(/\s+/)[1];
      if (qid === 'all') {
        await sendTelegram(chatId,
          cardTop('\uD83D\uDE48 <b>DISMISS ALL</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Did you mean /dismissall?\n' + BOX_V + ' Use that to hide all questions at once.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      if (!qid) {
        await sendTelegram(chatId,
          cardTop('\uD83D\uDE48 <b>DISMISS</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Hide a question from your site.\n' + BOX_V + ' Data is preserved safely.\n' + BOX_V + '\n' + BOX_V + ' <code>/dismiss &lt;id&gt;</code>\n' + BOX_V + '\n' + BOX_V + ' Use /all or /pending to find IDs.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      try {
        var loadingId = await sendLoadingCard(chatId, '\uD83D\uDE48 <b>DISMISSING\u2026</b>', 'Checking the question before hiding it...', message.message_id);
        var q = await getQuestion(qid);
        if (!q) {
          await respondTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question with that ID exists.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /all to browse IDs.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD, loadingId);
          return res.status(200).json({ ok: true });
        }
        if (q.dismissed) {
          await respondTelegram(chatId,
            cardTop('\uD83D\uDE48 <b>ALREADY DISMISSED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This question is already dismissed.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /retrieve ' + esc(qid) + ' to restore.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD, loadingId);
          return res.status(200).json({ ok: true });
        }
        await dismissQuestion(qid);
        await respondTelegram(chatId,
          cardTop('\uD83D\uDE48 <b>QUESTION HIDDEN</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Hidden from the site. Data is preserved.\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDC64 Visitor \u2500 <b>' + esc(visitorName(q.name)) + '</b>\n' + BOX_V + ' \uD83C\uDD94 ID \u2500 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' “' + esc(clipText(q.question, 140)) + '”\n' + BOX_V + '\n' + BOX_V + ' Use Retrieve to restore it.\n' + BOX_V + ' \uD83D\uDD50 ' + formatTime(new Date().toISOString()) + ' IST\n' + BOX_V + '\n' + cardBottom,
          message.message_id,
          { inline_keyboard: [
            [{ text: '\u21A9\uFE0F Retrieve', callback_data: 'retrieve:' + qid }],
            [{ text: '\uD83D\uDCAC Answer', callback_data: 'answer:' + qid }],
            [{ text: q.pinned ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: (q.pinned ? 'unpin:' : 'pin:') + qid }],
            [{ text: '\uD83D\uDDD1 Delete', callback_data: 'delete:' + qid }]
          ] },
          loadingId
        );
      } catch (e) {
        await respondTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>DISMISS FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not dismiss. Check the ID.\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
      }
      return res.status(200).json({ ok: true });
    }

    /* /dismissed */
    if (command === '/dismissed') {
      var loadingId = await sendLoadingCard(chatId, '\uD83D\uDE48 <b>LOADING DISMISSED\u2026</b>', 'Finding hidden questions...', message.message_id);
      var all = await listAllQuestions();
      var dismissed = all.filter(function(q) { return questionState(q) === 'DISMISSED'; })
        .sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
      if (!dismissed.length) {
        await respondTelegram(chatId,
          cardTop('\u2705 <b>NO DISMISSED QUESTIONS</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Nothing has been dismissed.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
        return res.status(200).json({ ok: true });
      }
      var result = buildDismissedPageText(dismissed, 1);
      var buttons = buildDismissedPageButtons(result.page, result.pages);
      await respondTelegram(chatId, result.text, message.message_id, buttons, loadingId);
      return res.status(200).json({ ok: true });
    }

    /* /retrieveall */
    if (command === '/retrieveall') {
      var loadingId = await sendLoadingCard(chatId, '\u21A9\uFE0F <b>CHECKING RETRIEVE ALL\u2026</b>', 'Counting dismissed questions before confirmation...', message.message_id);
      var all = await listAllQuestions();
      var dismissed = all.filter(function(q) { return questionState(q) === 'DISMISSED'; });
      if (!dismissed.length) {
        await respondTelegram(chatId,
          cardTop('\u2705 <b>NOTHING TO RETRIEVE</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No dismissed questions found.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
        return res.status(200).json({ ok: true });
      }
      var withAnswer = dismissed.filter(function(q) { return q.answer && String(q.answer).trim().length > 0; }).length;
      var withoutAnswer = dismissed.length - withAnswer;
      var detailLine = BOX_V + ' <b>' + dismissed.length + '</b> dismissed question' + (dismissed.length === 1 ? '' : 's') + ' will be restored.';
      if (withAnswer > 0) detailLine += '\n' + BOX_V + ' \u2705 ' + withAnswer + ' \u2192 back on site (with answers)';
      if (withoutAnswer > 0) detailLine += '\n' + BOX_V + ' \u23F3 ' + withoutAnswer + ' \u2192 pending queue (no answers)';

      await respondTelegram(chatId,
        cardTop('\u21A9\uFE0F <b>RETRIEVE ALL?</b>') + '\n' + BOX_V + '\n' + detailLine + '\n' + BOX_V + '\n' + BOX_V + ' Restores hidden questions to their\n' + BOX_V + ' correct destination.\n' + BOX_V + '\n' + cardBottom,
        message.message_id,
        { inline_keyboard: [[
          { text: '\u2705 Yes, Retrieve All', callback_data: 'confirmretrieveall' },
          { text: '\u274C Cancel', callback_data: 'cancelretrieveall' }
        ]] },
        loadingId
      );
      return res.status(200).json({ ok: true });
    }
    /* /retrieve <id> */
    if (command === '/retrieve') {
      var qid = text.split(/\s+/)[1];
      if (qid === 'all') {
        await sendTelegram(chatId,
          cardTop('\u21A9\uFE0F <b>RETRIEVE ALL</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Did you mean /retrieveall?\n' + BOX_V + ' Use that to restore all dismissed questions.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      if (!qid) {
        await sendTelegram(chatId,
          cardTop('\uD83D\uDCA1 <b>TIP</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Restore a dismissed question.\n' + BOX_V + '\n' + BOX_V + ' <code>/retrieve &lt;id&gt;</code>\n' + BOX_V + '\n' + BOX_V + ' Use /dismissed to browse all\n' + BOX_V + ' dismissed question IDs.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      try {
        var q = await getQuestion(qid);
        if (!q) {
          await sendTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question with that ID exists.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /dismissed to browse IDs.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD);
          return res.status(200).json({ ok: true });
        }
        if (questionState(q) !== 'DISMISSED') {
          await sendTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>NOT DISMISSED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This question is currently\n' + BOX_V + ' <b>' + questionState(q) + '</b> - only dismissed\n' + BOX_V + ' questions can be retrieved.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD);
          return res.status(200).json({ ok: true });
        }
        var result = await retrieveQuestion(qid);
        if (result.restoredAs === 'answered') {
          await sendTelegram(chatId,
            cardTop('\u21A9\uFE0F <b>RESTORED TO SITE</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Published again with its answer.\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDC64 Visitor \u2500 <b>' + esc(visitorName(q.name)) + '</b>\n' + BOX_V + ' \uD83C\uDD94 ID \u2500 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Q: “' + esc(clipText(q.question, 120)) + '”\n' + BOX_V + ' A: “' + esc(clipText(q.answer, 120)) + '”\n' + BOX_V + '\n' + cardBottom,
            message.message_id,
            { inline_keyboard: [
              [{ text: '\u270F\uFE0F Edit', callback_data: 'edit:' + qid }],
              [{ text: q.pinned ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: (q.pinned ? 'unpin:' : 'pin:') + qid }],
              [
                { text: '\uD83D\uDE48 Dismiss', callback_data: 'dismiss:' + qid },
                { text: '\uD83D\uDDD1 Delete', callback_data: 'delete:' + qid }
              ]
            ] }
          );
        } else {
          await sendTelegram(chatId,
            cardTop('\u21A9\uFE0F <b>RESTORED TO PENDING</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Back in your pending queue.\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDC64 Visitor \u2500 <b>' + esc(visitorName(q.name)) + '</b>\n' + BOX_V + ' \uD83C\uDD94 ID \u2500 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' “' + esc(clipText(q.question, 140)) + '”\n' + BOX_V + '\n' + BOX_V + ' Tap Answer or reply to answer it.\n' + BOX_V + '\n' + cardBottom,
            message.message_id,
            { inline_keyboard: [
              [{ text: '\uD83D\uDCAC Answer', callback_data: 'answer:' + qid }],
              [{ text: q.pinned ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: (q.pinned ? 'unpin:' : 'pin:') + qid }],
              [
                { text: '\uD83D\uDE48 Dismiss', callback_data: 'dismiss:' + qid },
                { text: '\uD83D\uDDD1 Delete', callback_data: 'delete:' + qid }
              ]
            ] }
          );
        }
        return res.status(200).json({ ok: true, retrieved: qid });
      } catch (e) {
        await sendTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>RETRIEVE FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not retrieve the question.\n' + BOX_V + ' Check the ID and try again.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
    }


    /* Answer session (from Answer button) */
    var answerSess = await getAnswerSession(chatId);
    if (answerSess && !text.startsWith('/')) {
      if (isSessionExpired(answerSess)) {
        await clearAnswerSession(chatId);
      } else {
        var answerQid = answerSess.fields && answerSess.fields.questionId && answerSess.fields.questionId.stringValue;
        await clearAnswerSession(chatId);
        if (answerQid) {
          await savePreviewSession(chatId, answerQid, text);
          var q = await getQuestion(answerQid);
          await sendTelegram(chatId,
            answerPreviewCard(q, text, answerQid),
            message.message_id,
            previewButtons()
          );
          return res.status(200).json({ ok: true, preview: answerQid });
        }
      }
    }

    /* Edit answer session */
    var pending = await getEditSession(chatId);
    var pendingQuestionId = null;
    if (pending && !isSessionExpired(pending)) {
      pendingQuestionId = pending.fields && pending.fields.questionId && pending.fields.questionId.stringValue;
    } else if (pending) {
      await clearEditSession(chatId);
    }
    if (pendingQuestionId && !text.startsWith('/')) {
      try {
        await editAnswer(pendingQuestionId, text);
        await clearEditSession(chatId);
        await sendAnsweredCard(chatId, pendingQuestionId, text, message.message_id, true);
        return res.status(200).json({ ok: true, edited: pendingQuestionId });
      } catch (e) {
        await clearEditSession(chatId);
        await respondTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>EDIT FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not save the edit.\n' + BOX_V + ' The question may have been deleted.\n' + BOX_V + '\n' + BOX_V + ' Edit session cleared. Try /pending\n' + BOX_V + ' to check current questions.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true, editError: e.message });
      }
    }

    /* Lookup session */
    var lookupSession = await getLookupSession(chatId);
    if (lookupSession && !text.startsWith('/')) {
      if (isSessionExpired(lookupSession)) {
        await clearLookupSession(chatId);
      } else {
        var pastedId = text.trim();
        await clearLookupSession(chatId);
        if (pastedId.length >= 8) {
          await sendFullDetailCard(chatId, pastedId, message.message_id);
        } else {
          await sendTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>INVALID ID</b>') + '\n' + BOX_V + '\n' + BOX_V + ' That ID looks too short.\n' + BOX_V + ' Try /lookup again with a full ID.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD);
        }
        return res.status(200).json({ ok: true, lookup: pastedId });
      }
    }

    /* Unknown command */
    if (text.startsWith('/')) {
      await sendTelegram(chatId,
        cardTop('\u2753 <b>UNKNOWN COMMAND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' That command doesn\'t exist.\n' + BOX_V + '\n' + BOX_V + ' Type /help to see all commands.\n' + BOX_V + '\n' + cardBottom,
        message.message_id, REPLY_KEYBOARD);
      return res.status(200).json({ ok: true });
    }

    /* Reply to a question message = answer it (with preview) */
    var originalText = (message.reply_to_message && (message.reply_to_message.text || message.reply_to_message.caption)) || '';
    var questionId = extractQuestionId(originalText);

    if (!questionId) {
      await sendTelegram(chatId,
        cardTop('\uD83D\uDCA1 <b>TIP</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Tap Answer or reply to a bot\n' + BOX_V + ' message to answer a question.\n' + BOX_V + '\n' + BOX_V + ' Or type /help for all commands.\n' + BOX_V + '\n' + cardBottom,
        message.message_id, REPLY_KEYBOARD);
      return res.status(200).json({ ok: true, ignored: 'no question id' });
    }

    // Save to preview session and show confirmation
    await savePreviewSession(chatId, questionId, text);
    var q = await getQuestion(questionId);
    await sendTelegram(chatId,
      answerPreviewCard(q, text, questionId),
      message.message_id,
      previewButtons()
    );
    return res.status(200).json({ ok: true, preview: questionId });

  } catch (error) {
    console.error('Telegram webhook failed:', error);
    return res.status(200).json({ ok: false, error: error.message || 'Webhook failed' });
  }
};