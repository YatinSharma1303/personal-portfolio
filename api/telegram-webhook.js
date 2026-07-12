/* ============================================================
 api/telegram-webhook.js - Vercel serverless function v4.2
 The brain of the AMA Telegram interaction.

 Handles:
 - Inline button presses (Answer / Dismiss / Delete / Edit)
 - Delete confirmation flow (2-step)
 - Reply-to-message answers (free-form text)
 - /start, /help, /stats, /pending, /refresh, /recent
 - /search, /export, /pin, /answer, /get, /lookup, /all
 - /dismiss, /dismissed, /retrieve, /retrieveall
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

/* -- Google OAuth: mint a service-account JWT -- */
async function googleAccessToken() {
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
  return data.access_token;
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
  }
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
  var result = await fetch(TELEGRAM_API + botToken + '/editMessageText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, message_id: messageId,
      text: text, parse_mode: 'HTML',
      reply_markup: replyMarkup
    })
  });
  var data = await result.json().catch(function() { return null; });
  if (!result.ok) console.error('editMessage failed:', (data && data.description) || result.status);
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
  return firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['dismissed']), {
    fields: { dismissed: { booleanValue: true } }
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
    await firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['dismissed']), {
      fields: { dismissed: { booleanValue: false } }
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
  var url = 'https://firestore.googleapis.com/v1/projects/' + projectId() + '/databases/(default)/documents/' + COLLECTION + '?pageSize=200';
  var data = await firestore('GET', url);
  return (data.documents || []).map(fromFirestoreDoc);
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

/* -- /start -- Dynamic welcome with live stats -- */
async function buildWelcomeText() {
  var statsBlock = '';
  try {
    var s = await getStats();
    var parts = [];
    if (s.total > 0) parts.push('\uD83D\uDCEC ' + s.total + ' total');
    if (s.unanswered > 0) parts.push('\u23F3 ' + s.unanswered + ' pending');
    if (s.answered > 0) parts.push('\u2705 ' + s.answered + ' answered');
    if (s.dismissed > 0) parts.push('\uD83D\uDE48 ' + s.dismissed + ' dismissed');
    if (s.totalVotes > 0) parts.push('\uD83D\uDC4D ' + s.totalVotes + ' votes');
    if (s.avgResponseMs > 0) parts.push('\u26A1 ~' + formatDuration(s.avgResponseMs) + ' avg response');
    if (parts.length) statsBlock = '\n' + BOX_V + ' ' + parts.join(' \u00B7 ') + '\n';
  } catch (e) {}

  return [
    cardTop('\uD83E\uDD16 <b>AMA BOT v4.2</b>'),
    BOX_V,
    BOX_V + ' Your portfolio AMA is live.',
    BOX_V + ' Every visitor question arrives here',
    BOX_V + ' instantly. Answer, dismiss, or pin \u2014',
    BOX_V + ' you\'re in control.',
    BOX_V,
    statsBlock,
    BOX_V + ' <b>\u26A1 Quick commands:</b>',
    BOX_V,
    BOX_V + ' \uD83D\uDCCB /pending  \u00B7 Unanswered queue',
    BOX_V + ' \uD83D\uDCCA /stats    \u00B7 Full dashboard',
    BOX_V + ' \uD83D\uDD50 /recent   \u00B7 Latest answers',
    BOX_V + ' \uD83D\uDD0D /search   \u00B7 Find by keyword',
    BOX_V + ' \uD83D\uDCD6 /help     \u00B7 All commands',
    BOX_V,
    BOX_V + ' \uD83D\uDCA1 Reply to any question message',
    BOX_V + ' to answer it directly.',
    BOX_V,
    cardBottom
  ].join('\n');
}

/* -- /help -- Command reference -- */
var HELP_TEXT = [
  cardTop('\uD83D\uDCD6 <b>COMMANDS A\u2013Z</b>'),
  BOX_V,
  BOX_V + ' <b>\uD83D\uDCEC /all [page]</b>',
  BOX_V + ' Browse every question. Paginated,',
  BOX_V + ' shows state, preview &amp; ID. Tap to copy.',
  BOX_V,
  BOX_V + ' <b>\u270D\uFE0F /answer &lt;id&gt; &lt;text&gt;</b>',
  BOX_V + ' Answer a question in one shot. Shows',
  BOX_V + ' a preview before publishing. Reviseable.',
  BOX_V + '   \u21B3 <b>/cancel</b>',
  BOX_V + '     Abort active session (answer, edit,',
  BOX_V + '     lookup). Returns to normal mode.',
  BOX_V,
  BOX_V + ' <b>\u270F\uFE0F /edit &lt;id&gt;</b>',
  BOX_V + ' Edit the answer to a question.',
  BOX_V + ' Only works on answered questions.',
  BOX_V + ' Send new answer as next message.',
  BOX_V + '   \u21B3 <b>/cancel</b>',
  BOX_V + '     Abort the edit session.',
  BOX_V,
  BOX_V + ' <b>\uD83D\uDDD1 /delete &lt;id&gt;</b>',
  BOX_V + ' Delete a single question permanently.',
  BOX_V + ' \u26A0\uFE0F Confirms first. Cannot be undone.',
  BOX_V,
  BOX_V + ' <b>\uD83D\uDDD1 /deleteall</b>',
  BOX_V + ' Permanently delete ALL questions.',
  BOX_V + ' \u26A0\uFE0F Confirms first. Cannot be undone.',
  BOX_V,
  BOX_V + ' <b>\uD83D\uDE48 /dismiss &lt;id&gt;</b>',
  BOX_V + ' Hide one question from your site.',
  BOX_V + ' Data preserved. Retrieve later.',
  BOX_V,
  BOX_V + ' <b>\uD83D\uDE48 /dismissed [page]</b>',
  BOX_V + ' Browse all dismissed (hidden) questions.',
  BOX_V + ' Shows if each had an answer before hiding.',
  BOX_V + '   \u21B3 <b>/retrieve &lt;id&gt;</b>',
  BOX_V + '     Restore one dismissed question.',
  BOX_V + '     Answered\u2192site, unanswered\u2192pending.',
  BOX_V + '   \u21B3 <b>/retrieveall</b>',
  BOX_V + '     Restore ALL dismissed at once.',
  BOX_V + '     Confirms first. Shows site vs pending.',
  BOX_V,
  BOX_V + ' <b>\uD83D\uDCE4 /export</b>',
  BOX_V + ' Download all Q&amp;A as formatted text.',
  BOX_V + ' Includes votes, reactions &amp; timestamps.',
  BOX_V,
  BOX_V + ' <b>\uD83D\uDCCB /get &lt;id&gt;</b>',
  BOX_V + ' Full detail card with answer, response',
  BOX_V + ' time, votes, reactions &amp; action buttons.',
  BOX_V,
  BOX_V + ' <b>\uD83D\uDCD6 /help</b>',
  BOX_V + ' This message. Lists every command',
  BOX_V + ' with its description &amp; usage.',
  BOX_V,
  BOX_V + ' <b>\uD83D\uDD0D /lookup</b>',
  BOX_V + ' Interactive ID lookup mode. Paste an',
  BOX_V + ' ID to get details. /cancel to exit.',
  BOX_V,
  BOX_V + ' <b>\uD83D\uDCCD /pin &lt;id&gt;</b>',
  BOX_V + ' Pin question to top of site AMA section.',
  BOX_V + ' Pinned Qs appear first with \uD83D\uDCCD badge.',
  BOX_V + '   \u21B3 <b>/unpin &lt;id&gt;</b>',
  BOX_V + '     Remove pin. Question returns to',
  BOX_V + '     normal sort order on your site.',
  BOX_V + '   \u21B3 <b>/pinned</b>',
  BOX_V + '     List all currently pinned questions.',
  BOX_V,
  BOX_V + ' <b>\u23F3 /pending</b>',
  BOX_V + ' List all unanswered questions waiting',
  BOX_V + ' for your reply. Tap Answer or reply.',
  BOX_V,
  BOX_V + ' <b>\uD83D\uDD50 /recent</b>',
  BOX_V + ' Last 5 answered questions with response',
  BOX_V + ' times. Quick overview of latest activity.',
  BOX_V,
  BOX_V + ' <b>\uD83D\uDD01 /refresh</b>',
  BOX_V + ' Combined view: unanswered + dismissed.',
  BOX_V + ' Everything that still needs attention.',
  BOX_V,
  BOX_V + ' <b>\uD83D\uDD0D /search &lt;text&gt;</b>',
  BOX_V + ' Search Q&amp;A by keyword. Matches question,',
  BOX_V + ' answer &amp; name. Case-insensitive, max 8.',
  BOX_V,
  BOX_V + ' <b>\uD83D\uDE80 /start</b>',
  BOX_V + ' Welcome message with live stats &amp;',
  BOX_V + ' quick command reference + reply keyboard.',
  BOX_V,
  BOX_V + ' <b>\uD83D\uDCCA /stats</b>',
  BOX_V + ' Full dashboard: totals, pinned count,',
  BOX_V + ' avg response time &amp; top question.',
  BOX_V,
  BOX_V + ' <b>\uD83D\uDCAC Answer a question</b>',
  BOX_V + ' Tap the Answer button on any card,',
  BOX_V + ' reply to a bot message, or use',
  BOX_V + ' /answer &lt;id&gt; &lt;text&gt;. Preview first.',
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
async function sendStats(chatId, replyToId) {
  try {
    var s = await getStats();
    var maxStat = Math.max(s.total, 1);

    var topQ = '';
    if (s.mostVoted) {
      var qText = esc(s.mostVoted.question).slice(0, 50);
      topQ = '\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDD25 <b>Top Question</b>\n' + BOX_V + ' "' + qText + '"\n' + BOX_V + ' with ' + (s.mostVoted.votes || 0) + ' \uD83D\uDC4D votes';
    }

    var avgLine = '';
    if (s.avgResponseMs > 0) {
      avgLine = '\n' + BOX_V + ' \u26A1 Avg response time \u2500 <b>' + formatDuration(s.avgResponseMs) + '</b>';
    }

    var statsText = [
      cardTop('\uD83D\uDCCA <b>AMA DASHBOARD</b>'),
      BOX_V,
      BOX_V + ' \uD83D\uDCEC Total \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 <b>' + s.total + '</b>',
      BOX_V,
      BOX_V + ' \u23F3 Pending \u2500\u2500 ' + progressBar(s.unanswered, maxStat) + ' <b>' + s.unanswered + '</b>',
      BOX_V + ' \u2705 Answered \u2500 ' + progressBar(s.answered, maxStat) + ' <b>' + s.answered + '</b>',
      BOX_V + ' \uD83D\uDE48 Dismissed \u2500 ' + progressBar(s.dismissed, maxStat) + ' <b>' + s.dismissed + '</b>',
      BOX_V + ' \uD83D\uDCCD Pinned \u2500\u2500\u2500 ' + progressBar(s.pinned, Math.max(s.answered, 1)) + ' <b>' + s.pinned + '</b>',
      BOX_V,
      BOX_V + ' \uD83D\uDC4D Total votes \u2500\u2500\u2500\u2500\u2500\u2500 <b>' + s.totalVotes + '</b>' + avgLine + topQ,
      BOX_V,
      cardBottom
    ].join('\n');
    await sendTelegram(chatId, statsText, replyToId, REPLY_KEYBOARD);
  } catch (e) {
    await sendTelegram(chatId,
      cardTop('\u26A0\uFE0F <b>STATS ERROR</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not load statistics.\n' + BOX_V + ' Please try again in a moment.\n' + BOX_V + '\n' + cardBottom,
      replyToId, REPLY_KEYBOARD);
  }
}

/* -- Answered card with reactions -- */
async function sendAnsweredCard(chatId, questionId, answerText, replyToId, isUpdate) {
  isUpdate = isUpdate || false;
  var q = await getQuestion(questionId);
  var qName = q ? q.name : 'Anonymous';
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
    BOX_V + ' \uD83D\uDC64 <b>' + esc(qName) + '</b> asked:',
    BOX_V + '\n&gt; ' + esc(qText) + '\n' + BOX_V,
    BOX_V + ' \uD83D\uDCAC <b>Answer:</b>',
    BOX_V + '\n&gt; ' + esc(answerText) + '\n' + BOX_V,
    BOX_V + metaLine,
    BOX_V,
    BOX_V + ' \uD83C\uDD94 <code>' + esc(questionId) + '</code>',
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
  var rLine = reactionLine(q.reactions);

  if (state === 'ANSWERED') {
    var rTime = responseTime(q.createdAt, q.answeredAt);
    var qAge = timeAgo(q.createdAt);
    var metaLine = '';
    if (rTime) metaLine += '\n' + BOX_V + ' \u26A1 Responded in <b>' + esc(rTime) + '</b>';
    if (qAge) metaLine += '\n' + BOX_V + ' \uD83D\uDD50 Asked ' + esc(qAge);
    if (q.editedAt) metaLine += '\n' + BOX_V + ' \u270F\uFE0F Edited ' + esc(formatTime(q.editedAt)) + ' IST';
    if (q.votes > 0) metaLine += '\n' + BOX_V + ' \uD83D\uDC4D ' + q.votes + ' votes';
    if (rLine) metaLine += '\n' + BOX_V + ' ' + rLine;
    if (q.pinned) metaLine += '\n' + BOX_V + ' \uD83D\uDCCD Pinned to top';

    var text = [
      cardTop('\u2705 <b>ANSWERED</b>'),
      BOX_V,
      BOX_V + ' \uD83D\uDC64 <b>' + esc(q.name) + '</b> asked:',
      BOX_V + '\n&gt; ' + esc(q.question) + '\n' + BOX_V,
      BOX_V + ' \uD83D\uDCAC <b>Answer:</b>',
      BOX_V + '\n&gt; ' + esc(q.answer) + '\n' + BOX_V,
      BOX_V + metaLine,
      BOX_V,
      BOX_V + ' \uD83C\uDD94 <code>' + esc(q.id) + '</code>',
      cardBottom
    ].join('\n');
    var replyMarkup = {
      inline_keyboard: [
        [{ text: '\u270F\uFE0F Edit', callback_data: 'edit:' + q.id }],
        [{ text: q.pinned ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: (q.pinned ? 'unpin:' : 'pin:') + q.id }],
        [
          { text: '\uD83D\uDE48 Dismiss', callback_data: 'dismiss:' + q.id },
          { text: '\uD83D\uDDD1 Delete', callback_data: 'delete:' + q.id }
        ]
      ]
    };
    return { text: text, replyMarkup: replyMarkup };
  }

  if (state === 'DISMISSED') {
    var hasAnswer = q.answer && String(q.answer).trim().length > 0;
    var tag = hasAnswer ? '\uD83D\uDCDD Was answered \u2014 retrieve restores to site' : '\u23F3 Was unanswered \u2014 retrieve restores to pending';
    var answerLines = hasAnswer
      ? [BOX_V, BOX_V + ' \uD83D\uDCAC <b>Previous answer:</b>', BOX_V + '\n&gt; ' + esc(q.answer) + '\n' + BOX_V]
      : [];
    if (rLine && hasAnswer) answerLines.push(BOX_V + ' ' + rLine);

    var allLines = [
      cardTop('\uD83D\uDE48 <b>DISMISSED</b>'),
      BOX_V,
      BOX_V + ' ' + tag,
      BOX_V,
      BOX_V + ' \uD83D\uDC64 <b>' + esc(q.name) + '</b> asked:',
      BOX_V + '\n&gt; ' + esc(q.question) + '\n' + BOX_V
    ].concat(answerLines).concat([
      BOX_V + ' Hidden from your site.',
      BOX_V + ' \u21A9\uFE0F Retrieve to restore it.',
      BOX_V,
      BOX_V + ' \uD83C\uDD94 <code>' + esc(q.id) + '</code>',
      cardBottom
    ]);
    var text = allLines.join('\n');
    var replyMarkup = {
      inline_keyboard: [
        [{ text: '\u21A9\uFE0F Retrieve', callback_data: 'retrieve:' + q.id }],
        [{ text: '\uD83D\uDCAC Answer', callback_data: 'answer:' + q.id }],
        [{ text: q.pinned ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: (q.pinned ? 'unpin:' : 'pin:') + q.id }],
        [{ text: '\uD83D\uDDD1 Delete', callback_data: 'delete:' + q.id }]
      ]
    };
    return { text: text, replyMarkup: replyMarkup };
  }

  // UNANSWERED - incoming question
  var qAge = timeAgo(q.createdAt);
  var pinnedLine = '';
  if (q.pinned) pinnedLine = '\n' + BOX_V + ' \uD83D\uDCCD Pinned to top';
  var text = [
    cardTop('\uD83D\uDCD8 <b>NEW QUESTION</b>'),
    BOX_V,
    BOX_V + ' \uD83D\uDC64 <b>' + esc(q.name) + '</b>',
    BOX_V,
    BOX_V + ' \uD83D\uDCAC\n&gt; ' + esc(q.question) + '\n' + BOX_V,
    BOX_V + ' \uD83D\uDD50 ' + esc(formatTime(q.createdAt)) + ' IST' + (qAge ? ' \u00B7 ' + esc(qAge) : '') + pinnedLine,
    BOX_V + ' \uD83C\uDD94 <code>' + esc(q.id) + '</code>',
    BOX_V,
    BOX_BL + BOX_H + '\u26A1 <i>tap Answer or reply</i>' + BOX_H.repeat(10) + BOX_BR
  ].join('\n');
  var replyMarkup = {
    inline_keyboard: [
      [{ text: '\uD83D\uDCAC Answer', callback_data: 'answer:' + q.id }],
      [{ text: q.pinned ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: (q.pinned ? 'unpin:' : 'pin:') + q.id }],
      [
        { text: '\uD83D\uDE48 Dismiss', callback_data: 'dismiss:' + q.id },
        { text: '\uD83D\uDDD1 Delete', callback_data: 'delete:' + q.id }
      ]
    ]
  };
  return { text: text, replyMarkup: replyMarkup };
}

/* -- Full detail card for /get -- */
async function sendFullDetailCard(chatId, questionId, replyToId) {
  var q = await getQuestion(questionId);
  if (!q) {
    await sendTelegram(chatId,
      cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question with that ID exists.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(questionId) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Try /all to browse all IDs.\n' + BOX_V + '\n' + cardBottom,
      replyToId, REPLY_KEYBOARD);
    return;
  }
  var state = questionState(q);
  var stateEmoji = state === 'ANSWERED' ? '\u2705' : state === 'DISMISSED' ? '\uD83D\uDE48' : '\u23F3';
  var rTime = responseTime(q.createdAt, q.answeredAt);
  var qAge = timeAgo(q.createdAt);
  var rLine = reactionLine(q.reactions);

  var lines = [
    cardTop('\uD83D\uDCCB <b>QUESTION DETAILS</b>'),
    BOX_V,
    BOX_V + ' ' + stateEmoji + ' Status: <b>' + state + '</b>' + (q.pinned ? ' \u00B7 \uD83D\uDCCD Pinned' : ''),
    BOX_V,
    BOX_V + ' \uD83D\uDC64 <b>' + esc(q.name) + '</b>',
    BOX_V + ' \uD83D\uDCAC\n&gt; ' + esc(q.question) + '\n' + BOX_V,
    BOX_V + ' \uD83D\uDD50 Asked ' + esc(formatTime(q.createdAt)) + ' IST' + (qAge ? ' \u00B7 ' + esc(qAge) : '')
  ];

  if (state === 'ANSWERED') {
    lines.push(BOX_V);
    lines.push(BOX_V + ' \uD83D\uDCAC <b>Answer:</b>');
    lines.push(BOX_V + '\n&gt; ' + esc(q.answer) + '\n' + BOX_V);
    lines.push(BOX_V + ' \uD83D\uDD50 Answered ' + esc(formatTime(q.answeredAt)) + ' IST');
    if (q.editedAt) lines.push(BOX_V + ' \u270F\uFE0F Edited ' + esc(formatTime(q.editedAt)) + ' IST');
    if (rTime) lines.push(BOX_V + ' \u26A1 Responded in <b>' + esc(rTime) + '</b>');
  }

  if (q.votes > 0) lines.push(BOX_V + ' \uD83D\uDC4D ' + q.votes + ' votes');
  if (rLine) lines.push(BOX_V + ' ' + rLine);
  lines.push(BOX_V);
  lines.push(BOX_V + ' \uD83C\uDD94 <code>' + esc(q.id) + '</code>');
  lines.push(cardBottom);

  var buttons = [];
  if (state === 'DISMISSED') {
    buttons.push([{ text: '\u21A9\uFE0F Retrieve', callback_data: 'retrieve:' + q.id }]);
    buttons.push([{ text: '\uD83D\uDCAC Answer', callback_data: 'answer:' + q.id }]);
    buttons.push([{ text: q.pinned ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: (q.pinned ? 'unpin:' : 'pin:') + q.id }]);
  } else if (state === 'UNANSWERED') {
    buttons.push([{ text: '\uD83D\uDCAC Answer', callback_data: 'answer:' + q.id }]);
    buttons.push([{ text: q.pinned ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: (q.pinned ? 'unpin:' : 'pin:') + q.id }]);
  }
  if (state === 'ANSWERED') {
    buttons.push([{ text: '\u270F\uFE0F Edit Answer', callback_data: 'edit:' + q.id }]);
    buttons.push([{ text: q.pinned ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: (q.pinned ? 'unpin:' : 'pin:') + q.id }]);
  }
  buttons.push([
    { text: '\uD83D\uDE48 Dismiss', callback_data: 'dismiss:' + q.id },
    { text: '\uD83D\uDDD1 Delete', callback_data: 'delete:' + q.id }
  ]);

  await sendTelegram(chatId, lines.join('\n'), replyToId, { inline_keyboard: buttons });
}

/* -- /recent -- Last 5 answered -- */
async function sendRecent(chatId, replyToId) {
  var all = await listAllQuestions();
  var answered = all
    .filter(function(q) { return questionState(q) === 'ANSWERED'; })
    .sort(function(a, b) { return new Date(b.answeredAt || 0) - new Date(a.answeredAt || 0); })
    .slice(0, 5);

  if (!answered.length) {
    await sendTelegram(chatId,
      cardTop('\uD83D\uDCCB <b>NO ANSWERED QUESTIONS</b>') + '\n' + BOX_V + '\n' + BOX_V + ' You haven\'t answered anything yet.\n' + BOX_V + ' When you do, they\'ll show up here.\n' + BOX_V + '\n' + cardBottom,
      replyToId, REPLY_KEYBOARD);
    return;
  }

  var lines = [
    cardTop('\uD83D\uDD50 <b>RECENTLY ANSWERED</b>'),
    BOX_V
  ];

  for (var idx = 0; idx < answered.length; idx++) {
    var q = answered[idx];
    var rTime = responseTime(q.createdAt, q.answeredAt);
    var qAge = timeAgo(q.answeredAt);
    lines.push(BOX_V + ' \uD83D\uDC64 <b>' + esc(q.name) + '</b>' + (qAge ? ' \u00B7 ' + esc(qAge) : ''));
    lines.push(BOX_V + ' \uD83D\uDCAC ' + esc(q.question).slice(0, 80));
    lines.push(BOX_V + ' \u2192 ' + esc(q.answer).slice(0, 80));
    if (rTime) lines.push(BOX_V + ' \u26A1 ' + esc(rTime));
    if (q.votes > 0) lines.push(BOX_V + ' \uD83D\uDC4D ' + q.votes + ' votes');
    lines.push(BOX_V);
  }

  lines.push(BOX_V + ' \uD83C\uDD94 Use /get id for full details + actions');
  lines.push(cardBottom);

  await sendTelegram(chatId, lines.join('\n'), replyToId, REPLY_KEYBOARD);
}

/* -- /search <text> -- */
async function searchQuestions(chatId, searchText, replyToId) {
  if (!searchText || searchText.length < 2) {
    await sendTelegram(chatId,
      cardTop('\uD83D\uDD0D <b>SEARCH</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Type at least 2 characters.\n' + BOX_V + '\n' + BOX_V + ' Example:\n' + BOX_V + ' /search react\n' + BOX_V + ' /search healthcare\n' + BOX_V + '\n' + cardBottom,
      replyToId, REPLY_KEYBOARD);
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
    await sendTelegram(chatId,
      cardTop('\uD83D\uDD0D <b>NO RESULTS</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Nothing found for "' + esc(searchText) + '".\n' + BOX_V + '\n' + BOX_V + ' Try different keywords, or\n' + BOX_V + ' use /all to browse everything.\n' + BOX_V + '\n' + cardBottom,
      replyToId, REPLY_KEYBOARD);
    return;
  }

  var lines = [
    cardTop('\uD83D\uDD0D <b>RESULTS</b> for "' + esc(searchText) + '" \u2500\u2500 ' + results.length + ' found'),
    BOX_V
  ];

  for (var idx = 0; idx < results.length; idx++) {
    var q = results[idx];
    var st = questionState(q);
    var stateEmoji = st === 'ANSWERED' ? '\u2705' : st === 'DISMISSED' ? '\uD83D\uDE48' : '\u23F3';
    lines.push(BOX_V + ' ' + stateEmoji + ' <b>[' + st + ']</b> ' + esc(q.name));
    lines.push(BOX_V + ' \uD83D\uDCAC ' + esc(q.question).slice(0, 100));
    if (st === 'ANSWERED' && q.answer) {
      lines.push(BOX_V + ' \u2192 ' + esc(q.answer).slice(0, 80));
    }
    lines.push(BOX_V + ' \uD83C\uDD94 <code>' + esc(q.id) + '</code>');
    lines.push(BOX_V);
  }

  lines.push(BOX_V + ' Use /get id for full details + actions');
  lines.push(cardBottom);

  await sendTelegram(chatId, lines.join('\n'), replyToId);
}

/* -- /export -- */
async function exportQuestions(chatId, replyToId) {
  var all = await listAllQuestions();
  if (!all.length) {
        await sendTelegram(chatId,
          cardTop('\uD83D\uDCE4 <b>EXPORT</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No questions to export.\n' + BOX_V + '\n' + cardBottom,
          replyToId, REPLY_KEYBOARD);
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
    await sendTelegram(chatId, '<pre>' + esc(chunks[ci]) + '</pre>', undefined);
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
    cardTop('\uD83D\uDCCB <b>ALL QUESTIONS</b> (' + total + ') \u00B7 Page ' + page + '/' + pages),
    BOX_V
  ];
  for (var i = 0; i < slice.length; i++) {
    var q = slice[i];
    var st = questionState(q);
    var stateEmoji = st === 'ANSWERED' ? '\u2705' : st === 'DISMISSED' ? '\uD83D\uDE48' : '\u23F3';
    var qAge = timeAgo(q.createdAt);
    lines.push(BOX_V + ' ' + stateEmoji + ' <b>[' + st + ']</b> ' + esc(q.name) + (qAge ? ' \u00B7 ' + esc(qAge) : '') + (q.pinned ? ' \uD83D\uDCCD' : ''));
    lines.push(BOX_V + ' \uD83D\uDCAC\n&gt; ' + esc(q.question).slice(0, 120) + '\n' + BOX_V);
    if (st === 'ANSWERED' && q.answer) {
      lines.push(BOX_V + ' \u2192\n&gt; ' + esc(q.answer).slice(0, 100) + '\n' + BOX_V);
    }
    if (q.votes > 0) lines.push(BOX_V + ' \uD83D\uDC4D ' + q.votes + ' votes');
    lines.push(BOX_V + ' \uD83C\uDD94 <code>' + esc(q.id) + '</code>');
    lines.push(BOX_V);
  }
  lines.push(BOX_V + ' Tap ID to copy \u00B7 /get id for actions');
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

var DISMISSED_PER_PAGE = 4;

function buildDismissedPageText(sorted, page) {
  var total = sorted.length;
  var pages = Math.max(1, Math.ceil(total / DISMISSED_PER_PAGE));
  if (page > pages) page = pages;
  if (page < 1) page = 1;
  var start = (page - 1) * DISMISSED_PER_PAGE;
  var slice = sorted.slice(start, start + DISMISSED_PER_PAGE);
  var lines = [
    cardTop('\uD83D\uDE48 <b>DISMISSED</b> (' + total + ') \u00B7 Page ' + page + '/' + pages),
    BOX_V
  ];
  for (var i = 0; i < slice.length; i++) {
    var q = slice[i];
    var hasAnswer = q.answer && String(q.answer).trim().length > 0;
    var tag = hasAnswer ? 'WAS ANSWERED' : 'WAS UNANSWERED';
    var tagEmoji = hasAnswer ? '\uD83D\uDCDD' : '\u23F3';
    var qAge = timeAgo(q.createdAt);
    lines.push(BOX_V + ' ' + tagEmoji + ' <b>[' + tag + ']</b> ' + esc(q.name) + (qAge ? ' \u00B7 ' + esc(qAge) : ''));
    lines.push(BOX_V + ' \uD83D\uDCAC\n&gt; ' + esc(q.question).slice(0, 120) + '\n' + BOX_V);
    if (hasAnswer) lines.push(BOX_V + ' \u2192\n&gt; ' + esc(q.answer).slice(0, 80) + '\n' + BOX_V);
    if (q.votes > 0) lines.push(BOX_V + ' \uD83D\uDC4D ' + q.votes + ' votes');
    lines.push(BOX_V + ' \uD83C\uDD94 <code>' + esc(q.id) + '</code>');
    lines.push(BOX_V);
  }
  lines.push(BOX_V + ' /retrieve id to restore \u00B7 /retrieveall for all');
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
async function sendQuestionsList(chatId, title, items, replyToId) {
  var chunk = title + '\n\n';
  var sent = 0;
  for (var i = 0; i < items.length; i++) {
    var q = items[i];
    var tag = questionState(q);
    var tagEmoji = tag === 'UNANSWERED' ? '\u23F3' : '\uD83D\uDE48';
    var qAge = timeAgo(q.createdAt);
    var ageStr = qAge ? ' \u00B7 ' + esc(qAge) : '';
    var line = cardTop(tagEmoji + ' <b>[' + tag + ']</b> ' + esc(q.name) + ageStr) + '\n' + BOX_V + ' \uD83D\uDCAC\n&gt; ' + esc(q.question).slice(0, 120) + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(q.id) + '</code>\n' + cardBottom + '\n';
    if ((chunk + line + '\n').length > 3500) {
      await sendTelegram(chatId, chunk.trim(), sent === 0 ? replyToId : undefined);
      sent++;
      chunk = '';
    }
    chunk += line + '\n';
  }
  if (chunk.trim()) { await sendTelegram(chatId, chunk.trim(), sent === 0 ? replyToId : undefined); sent++; }
  await sendTelegram(chatId, ' <i>' + items.length + ' question' + (items.length === 1 ? '' : 's') + ' listed.\nTap Answer or reply to answer one.</i>', undefined, REPLY_KEYBOARD);
}

/* ============================================================
 HANDLER
 ============================================================ */
module.exports = async function handler(req, res) {
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
          cardTop('\u26A0\uFE0F <b>CONFIRM DELETE</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This will permanently remove\n' + BOX_V + ' this question and all its data.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(questionId) + '</code>\n' + BOX_V + '\n' + BOX_V + ' \u26A0\uFE0F <i>This cannot be undone.</i>\n' + BOX_V + '\n' + cardBottom,
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
        await answerCallback(callback.id, '');
        await sendTelegram(cbChatId,
          cardTop('\uD83D\uDCAC <b>ANSWER MODE</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Send your answer for:\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(questionId) + '</code>\n' + BOX_V + '\n' + BOX_V + ' <i>Type your answer as your\n' + BOX_V + ' next message.</i>\n' + BOX_V + '\n' + BOX_V + ' Send /cancel to abort.\n' + BOX_V + '\n' + cardBottom
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
          await answerCallback(callback.id, '\u270F\uFE0F Edit mode activated');
          await sendTelegram(cbChatId,
            cardTop('\u270F\uFE0F <b>EDIT MODE</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Send the new answer text for:\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(questionId) + '</code>\n' + BOX_V + '\n' + BOX_V + ' <i>Type your new answer as\n' + BOX_V + ' your next message.</i>\n' + BOX_V + '\n' + BOX_V + ' Send /cancel to abort.\n' + BOX_V + '\n' + cardBottom
          );
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not start edit - try again'); }
      }
      else if (action === 'pin') {
        try {
          var q = await getQuestion(questionId);
          if (!q) { await answerCallback(callback.id, '\u26A0\uFE0F Question not found'); return res.status(200).json({ ok: true }); }
          if (q.pinned) { await answerCallback(callback.id, '\uD83D\uDCCD Already pinned'); return res.status(200).json({ ok: true }); }
          await pinQuestion(questionId);
          await answerCallback(callback.id, '\uD83D\uDCCD Pinned to top on site');
          q.pinned = true; var card = buildCardForQuestion(q); await editMessage(cbChatId, cbMessageId, card.text, card.replyMarkup);
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not pin - try again'); }
      }
      else if (action === 'unpin') {
        try {
          var q = await getQuestion(questionId);
          if (!q) { await answerCallback(callback.id, '\u26A0\uFE0F Question not found'); return res.status(200).json({ ok: true }); }
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
          if (!qid || !ansText) { await clearPreviewSession(cbChatId); await answerCallback(callback.id, '\u26A0\uFE0F Session data missing'); return res.status(200).json({ ok: true }); }
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
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not enter edit mode'); }
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
            await answerCallback(callback.id, '\u26A0\uFE0F Already active');
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
      await sendStats(chatId, message.message_id);
      return res.status(200).json({ ok: true });
    }

    /* /pending */
    if (command === '/pending' || text === '\uD83D\uDCCB Pending') {
      var all = await listAllQuestions();
      var items = all.filter(function(q) { return questionState(q) === 'UNANSWERED'; })
        .sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
      if (!items.length) {
        await sendTelegram(chatId,
          cardTop('\u2705 <b>ALL CAUGHT UP</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No unanswered questions right now.\n' + BOX_V + ' Enjoy the peace while it lasts.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      await sendQuestionsList(chatId, '\u23F3 <b>UNANSWERED QUESTIONS</b>', items, message.message_id);
      return res.status(200).json({ ok: true });
    }

    /* /refresh */
    if (command === '/refresh') {
      var all = await listAllQuestions();
      var items = all.filter(function(q) { return questionState(q) === 'UNANSWERED' || questionState(q) === 'DISMISSED'; })
        .sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
      if (!items.length) {
        await sendTelegram(chatId,
          cardTop('\u2705 <b>QUEUE EMPTY</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No pending or dismissed questions.\n' + BOX_V + ' Everything is handled.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      await sendQuestionsList(chatId, '\uD83D\uDCCB <b>PENDING &amp; DISMISSED</b>', items, message.message_id);
      return res.status(200).json({ ok: true });
    }

    /* /recent */
    if (command === '/recent' || text === '\uD83D\uDD50 Recent') {
      await sendRecent(chatId, message.message_id);
      return res.status(200).json({ ok: true });
    }

    /* /search <text> */
    if (command === '/search') {
      var searchTerm = text.split(/\s+/).slice(1).join(' ');
      await searchQuestions(chatId, searchTerm, message.message_id);
      return res.status(200).json({ ok: true });
    }

    /* /export */
    if (command === '/export') {
      await exportQuestions(chatId, message.message_id);
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
        var q = await getQuestion(qid);
        if (!q) {
          await sendTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question with that ID exists.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /all to browse IDs.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD);
          return res.status(200).json({ ok: true });
        }
        if (questionState(q) !== 'ANSWERED') {
          await sendTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>CANNOT EDIT</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This question is <b>' + questionState(q) + '</b>.\n' + BOX_V + ' Only answered questions can be edited.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /answer ' + esc(qid) + ' to answer it first.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD);
          return res.status(200).json({ ok: true });
        }
        await clearAnswerSession(chatId);
        await clearLookupSession(chatId);
        await clearPreviewSession(chatId);
        await saveEditSession(chatId, qid);
        await sendTelegram(chatId,
          cardTop('\u270F\uFE0F <b>EDIT MODE</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Send the new answer text for:\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDC64 <b>' + esc(q.name) + '</b> asked:\n' + BOX_V + ' ' + esc(q.question).slice(0, 120) + '\n' + BOX_V + '\n' + BOX_V + ' <i>Type your new answer as\n' + BOX_V + ' your next message.</i>\n' + BOX_V + '\n' + BOX_V + ' Send /cancel to abort.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
      } catch (e) {
        await sendTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>EDIT FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not start edit. Check the ID.\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
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
        var qName = q ? q.name : 'Anonymous';
        var qText = q ? q.question : 'Question unavailable';

        await sendTelegram(chatId,
          cardTop('\uD83D\uDC41 <b>ANSWER PREVIEW</b>') + '\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDC64 <b>' + esc(qName) + '</b> asked:\n' + BOX_V + ' ' + esc(qText).slice(0, 100) + '\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDCAC <b>Answer:</b>\n' + BOX_V + ' ' + esc(answerText) + '\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' <i>Review before publishing.</i>\n' + BOX_V + '\n' + cardBottom,
          message.message_id,
          { inline_keyboard: [
            [{ text: '\u2705 Publish', callback_data: 'previewconfirm' }, { text: '\u270F\uFE0F Revise', callback_data: 'previewedit' }],
            [{ text: '\u274C Cancel', callback_data: 'previewcancel' }]
          ] }
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
        var q = await getQuestion(qid);
        if (!q) {
          await sendTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question with that ID exists.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /all to browse IDs.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD);
          return res.status(200).json({ ok: true });
        }
        if (q.dismissed) {
          await sendTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>CANNOT PIN</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Dismissed questions are hidden\n' + BOX_V + ' from your site. Retrieve it first.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /retrieve ' + esc(qid) + ' first.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD);
          return res.status(200).json({ ok: true });
        }
        if (q.pinned) {
          await sendTelegram(chatId,
            cardTop('\uD83D\uDCCD <b>ALREADY PINNED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This question is already pinned\n' + BOX_V + ' to the top of your site.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /unpin ' + esc(qid) + ' to remove.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD);
          return res.status(200).json({ ok: true });
        }
        await pinQuestion(qid);
        await sendTelegram(chatId,
          cardTop('\uD83D\uDCCD <b>PINNED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This question is now pinned to\n' + BOX_V + ' the top of your site\'s AMA section.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /unpin ' + esc(qid) + ' to remove.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
      } catch (e) {
        await sendTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>PIN FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not pin. Check the ID.\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
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
        var q = await getQuestion(qid);
        if (!q) {
          await sendTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question with that ID exists.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /all to browse IDs.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD);
          return res.status(200).json({ ok: true });
        }
        if (q.dismissed) {
          await sendTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>CANNOT UNPIN</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Dismissed questions are hidden\n' + BOX_V + ' from your site. Retrieve it first.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /retrieve ' + esc(qid) + ' first.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD);
          return res.status(200).json({ ok: true });
        }
        if (!q.pinned) {
          await sendTelegram(chatId,
            cardTop('\uD83D\uDCCD <b>NOT PINNED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This question is not pinned.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD);
          return res.status(200).json({ ok: true });
        }
        await unpinQuestion(qid);
        await sendTelegram(chatId,
          cardTop('\uD83D\uDCCD <b>UNPINNED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Pin removed. Question is back\n' + BOX_V + ' in normal order on your site.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
      } catch (e) {
        await sendTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>UNPIN FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not unpin. Check the ID.\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
      }
      return res.status(200).json({ ok: true });
    }

    /* /pinned - list all pinned questions */
    if (command === '/pinned') {
      var all = await listAllQuestions();
      var pinned = all.filter(function(q) { return q.pinned && questionState(q) !== 'DISMISSED'; })
        .sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
      if (!pinned.length) {
        await sendTelegram(chatId,
          cardTop('\uD83D\uDCCD <b>NO PINNED QUESTIONS</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Nothing is pinned right now.\n' + BOX_V + '\n' + BOX_V + ' Use /pin &lt;id&gt; to pin a question\n' + BOX_V + ' to the top of your site.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
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
        lines.push(BOX_V + ' ' + stateEmoji + ' <b>' + esc(q.name) + '</b>' + (qAge ? ' \u00B7 ' + esc(qAge) : ''));
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
      await sendTelegram(chatId, lines.join('\n'), message.message_id, REPLY_KEYBOARD);
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
      await sendFullDetailCard(chatId, qid, message.message_id);
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
      var all = await listAllQuestions();
      if (!all.length) {
        await sendTelegram(chatId,
          cardTop('\uD83D\uDCEC <b>NO QUESTIONS YET</b>') + '\n' + BOX_V + '\n' + BOX_V + ' The database is empty.\n' + BOX_V + ' Questions will appear here when\n' + BOX_V + ' visitors submit them.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      var sorted = all.slice().sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
      var result = buildAllPageText(sorted, 1);
      var buttons = buildAllPageButtons(result.page, result.pages);
      await sendTelegram(chatId, result.text, message.message_id, buttons);
      return res.status(200).json({ ok: true });
    }

    /* /delete <id> - delete a single question with confirmation */
    if (command === '/delete') {
      var qid = text.split(/\s+/)[1];
      if (!qid) {
        await sendTelegram(chatId,
          cardTop('\uD83D\uDDD1\uFE0F <b>DELETE</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Delete a single question permanently.\n' + BOX_V + '\n' + BOX_V + ' <code>/delete &lt;id&gt;</code>\n' + BOX_V + '\n' + BOX_V + ' Use /all or /pending to find IDs.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      try {
        var q = await getQuestion(qid);
        if (!q) {
          await sendTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question with that ID exists.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /all to browse IDs.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD);
          return res.status(200).json({ ok: true });
        }
        await sendTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>CONFIRM DELETE</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Permanently delete this question?\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDC64 <b>' + esc(q.name) + '</b> asked:\n' + BOX_V + ' ' + esc(q.question).slice(0, 120) + '\n' + BOX_V + '\n' + BOX_V + ' \u26A0\uFE0F <i>This cannot be undone.</i>\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id,
          { inline_keyboard: [[
            { text: '\u2705 Yes, Delete', callback_data: 'confirmdelete:' + qid },
            { text: '\u274C Cancel', callback_data: 'canceldelete:' + qid }
          ]] }
        );
      } catch (e) {
        await sendTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>DELETE FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not look up the question.\n' + BOX_V + ' Check the ID and try again.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
      }
      return res.status(200).json({ ok: true });
    }

    /* /deleteall */
    if (command === '/deleteall') {
      var all = await listAllQuestions();
      if (!all.length) {
        await sendTelegram(chatId,
          cardTop('\uD83D\uDCEC <b>NOTHING TO DELETE</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No questions in the database.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      var count = all.length;
      await sendTelegram(chatId,
        cardTop('\u26A0\uFE0F <b>CONFIRM DELETE ALL</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This will permanently delete\n' + BOX_V + ' <b>all ' + count + ' question' + (count === 1 ? '' : 's') + '</b> from the database.\n' + BOX_V + '\n' + BOX_V + ' \u26A0\uFE0F <i>This cannot be undone.</i>\n' + BOX_V + '\n' + cardBottom,
        message.message_id,
        { inline_keyboard: [[
          { text: '\u2705 Yes, Delete All', callback_data: 'confirmdeleteall' },
          { text: '\u274C Cancel', callback_data: 'canceldeleteall' }
        ]] }
      );
      return res.status(200).json({ ok: true });
    }

    /* /dismiss <id> - dismiss a single question by ID */
    if (command === '/dismiss') {
      var qid = text.split(/\s+/)[1];
      if (!qid) {
        await sendTelegram(chatId,
          cardTop('\uD83D\uDE48 <b>DISMISS</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Hide a question from your site.\n' + BOX_V + ' Data is preserved safely.\n' + BOX_V + '\n' + BOX_V + ' <code>/dismiss &lt;id&gt;</code>\n' + BOX_V + '\n' + BOX_V + ' Use /all or /pending to find IDs.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      try {
        var q = await getQuestion(qid);
        if (!q) {
          await sendTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question with that ID exists.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /all to browse IDs.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD);
          return res.status(200).json({ ok: true });
        }
        if (q.dismissed) {
          await sendTelegram(chatId,
            cardTop('\uD83D\uDE48 <b>ALREADY DISMISSED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This question is already dismissed.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' Use /retrieve ' + esc(qid) + ' to restore.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD);
          return res.status(200).json({ ok: true });
        }
        await dismissQuestion(qid);
        await sendTelegram(chatId,
          cardTop('\uD83D\uDE48 <b>DISMISSED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDC64 <b>' + esc(q.name) + '</b> asked:\n' + BOX_V + ' ' + esc(q.question).slice(0, 120) + '\n' + BOX_V + '\n' + BOX_V + ' Hidden from your site.\n' + BOX_V + ' Data preserved safely.\n' + BOX_V + ' \u21A9\uFE0F Use Retrieve to restore it.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + ' \uD83D\uDD50 ' + formatTime(new Date().toISOString()) + ' IST\n' + BOX_V + '\n' + cardBottom,
          message.message_id,
          { inline_keyboard: [
            [{ text: '\u21A9\uFE0F Retrieve', callback_data: 'retrieve:' + qid }],
            [{ text: '\uD83D\uDCAC Answer', callback_data: 'answer:' + qid }],
            [{ text: q.pinned ? '\uD83D\uDCCD Unpin' : '\uD83D\uDCCD Pin', callback_data: (q.pinned ? 'unpin:' : 'pin:') + qid }],
            [{ text: '\uD83D\uDDD1 Delete', callback_data: 'delete:' + qid }]
          ] }
        );
      } catch (e) {
        await sendTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>DISMISS FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not dismiss. Check the ID.\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
      }
      return res.status(200).json({ ok: true });
    }

    /* /dismissed */
    if (command === '/dismissed') {
      var all = await listAllQuestions();
      var dismissed = all.filter(function(q) { return questionState(q) === 'DISMISSED'; })
        .sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
      if (!dismissed.length) {
        await sendTelegram(chatId,
          cardTop('\u2705 <b>NO DISMISSED QUESTIONS</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Nothing has been dismissed.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      var result = buildDismissedPageText(dismissed, 1);
      var buttons = buildDismissedPageButtons(result.page, result.pages);
      await sendTelegram(chatId, result.text, message.message_id, buttons);
      return res.status(200).json({ ok: true });
    }

    /* /retrieve <id> */
    if (command === '/retrieve') {
      var qid = text.split(/\s+/)[1];
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
            cardTop('\u21A9\uFE0F <b>RETRIEVED &amp; PUBLISHED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDC64 <b>' + esc(q.name) + '</b> asked:\n' + BOX_V + ' ' + esc(q.question).slice(0, 120) + '\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDCAC Previous answer:\n' + BOX_V + ' ' + esc(q.answer).slice(0, 120) + '\n' + BOX_V + '\n' + BOX_V + ' \u2705 Back on your site with its answer.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + cardBottom,
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
            cardTop('\u21A9\uFE0F <b>RETRIEVED TO PENDING</b>') + '\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDC64 <b>' + esc(q.name) + '</b> asked:\n' + BOX_V + ' ' + esc(q.question).slice(0, 120) + '\n' + BOX_V + '\n' + BOX_V + ' \u23F3 Back in your pending queue.\n' + BOX_V + ' Tap Answer or reply to answer it.\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + cardBottom,
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

    /* /retrieveall */
    if (command === '/retrieveall') {
      var all = await listAllQuestions();
      var dismissed = all.filter(function(q) { return questionState(q) === 'DISMISSED'; });
      if (!dismissed.length) {
        await sendTelegram(chatId,
          cardTop('\u2705 <b>NOTHING TO RETRIEVE</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No dismissed questions found.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      var withAnswer = dismissed.filter(function(q) { return q.answer && String(q.answer).trim().length > 0; }).length;
      var withoutAnswer = dismissed.length - withAnswer;
      var detailLine = BOX_V + ' <b>' + dismissed.length + '</b> dismissed question' + (dismissed.length === 1 ? '' : 's') + ' will be restored.';
      if (withAnswer > 0) detailLine += '\n' + BOX_V + ' \u2705 ' + withAnswer + ' \u2192 back on site (with answers)';
      if (withoutAnswer > 0) detailLine += '\n' + BOX_V + ' \u23F3 ' + withoutAnswer + ' \u2192 pending queue (no answers)';

      await sendTelegram(chatId,
        cardTop('\u21A9\uFE0F <b>CONFIRM RETRIEVE ALL</b>') + '\n' + BOX_V + '\n' + detailLine + '\n' + BOX_V + '\n' + BOX_V + ' \u21A9\uFE0F This will restore them all.\n' + BOX_V + '\n' + cardBottom,
        message.message_id,
        { inline_keyboard: [[
          { text: '\u2705 Yes, Retrieve All', callback_data: 'confirmretrieveall' },
          { text: '\u274C Cancel', callback_data: 'cancelretrieveall' }
        ]] }
      );
      return res.status(200).json({ ok: true });
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
          var qName = q ? q.name : 'Anonymous';
          var qText = q ? q.question : 'Question unavailable';

          await sendTelegram(chatId,
            cardTop('\uD83D\uDC41 <b>ANSWER PREVIEW</b>') + '\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDC64 <b>' + esc(qName) + '</b> asked:\n' + BOX_V + ' ' + esc(qText).slice(0, 100) + '\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDCAC <b>Answer:</b>\n' + BOX_V + ' ' + esc(text) + '\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(answerQid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' <i>Review before publishing.</i>\n' + BOX_V + '\n' + cardBottom,
            message.message_id,
            { inline_keyboard: [
              [{ text: '\u2705 Publish', callback_data: 'previewconfirm' }, { text: '\u270F\uFE0F Revise', callback_data: 'previewedit' }],
              [{ text: '\u274C Cancel', callback_data: 'previewcancel' }]
            ] }
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
      await editAnswer(pendingQuestionId, text);
      await clearEditSession(chatId);
      await sendAnsweredCard(chatId, pendingQuestionId, text, message.message_id, true);
      return res.status(200).json({ ok: true, edited: pendingQuestionId });
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
    var qName = q ? q.name : 'Anonymous';
    var qText = q ? q.question : 'Question unavailable';

    await sendTelegram(chatId,
      cardTop('\uD83D\uDC41 <b>ANSWER PREVIEW</b>') + '\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDC64 <b>' + esc(qName) + '</b> asked:\n' + BOX_V + ' ' + esc(qText).slice(0, 100) + '\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDCAC <b>Answer:</b>\n' + BOX_V + ' ' + esc(text) + '\n' + BOX_V + '\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(questionId) + '</code>\n' + BOX_V + '\n' + BOX_V + ' <i>Review before publishing.</i>\n' + BOX_V + '\n' + cardBottom,
      message.message_id,
      { inline_keyboard: [
        [{ text: '\u2705 Publish', callback_data: 'previewconfirm' }, { text: '\u270F\uFE0F Revise', callback_data: 'previewedit' }],
        [{ text: '\u274C Cancel', callback_data: 'previewcancel' }]
      ] }
    );
    return res.status(200).json({ ok: true, preview: questionId });

  } catch (error) {
    console.error('Telegram webhook failed:', error);
    return res.status(200).json({ ok: false, error: error.message || 'Webhook failed' });
  }
};
