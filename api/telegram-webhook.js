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
var ai = require('./_ai');

var TELEGRAM_API = 'https://api.telegram.org/bot';
var COLLECTION = 'amaQuestions';
var EDIT_SESSION_COLLECTION = 'telegramEditSessions';
var LOOKUP_SESSION_COLLECTION = 'telegramLookupSessions';
var PREVIEW_SESSION_COLLECTION = 'telegramPreviewSessions';
var ANSWER_SESSION_COLLECTION = 'telegramAnswerSessions';
var TEMPLATE_COLLECTION = 'telegramTemplates';   // saved reply templates (52)
var UNDO_COLLECTION = 'telegramUndo';            // last-action snapshot for /undo (45)
var DELETEALL_CONFIRM_COLLECTION = 'telegramDeleteAllConfirm'; // typed-token confirm (46)
var DELETEALL_TOKEN = 'DELETE ALL';
var SESSION_TTL_MS = 10 * 60 * 1000;

/* Per-invocation caches — cleared at the start of each webhook request.
   - _questionsCache avoids redundant listAllQuestions() calls within one request.
   - _cachedToken / _cachedTokenExpiry reuse the Google OAuth token across Firestore calls. */
var _questionsCache = null;
var _currentActor = null;
var _suppressItemLogs = false;

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
  value = (value == null) ? '' : value;   // keep 0 / false — only null/undefined become ''
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

function actorFromUser(user) {
  user = user || {};
  var name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || (user.username ? '@' + user.username : 'Unknown');
  return {
    name: name,
    id: user.id ? String(user.id) : 'unknown',
    username: user.username ? '@' + user.username : '—'
  };
}

function inferLogCategory(title) {
  title = String(title || '').toUpperCase();
  if (title.indexOf('SITE ') === 0 || title.indexOf('SITE_') === 0) return title.indexOf('FAILED') !== -1 ? 'error' : 'site';
  if (title.indexOf('UNAUTHORIZED') !== -1) return 'security';
  if (title.indexOf('BOT COMMAND') !== -1 || title.indexOf('BOT CALLBACK') !== -1) return 'bot';
  if (title.indexOf('ANSWER') !== -1) return 'answer';
  if (title.indexOf('DISMISS') !== -1 || title.indexOf('RETRIEVE') !== -1) return 'moderation';
  if (title.indexOf('DELETE') !== -1 || title.indexOf('DELETED') !== -1) return 'delete';
  if (title.indexOf('PINNED') !== -1 || title.indexOf('UNPINNED') !== -1) return 'pin';
  if (title.indexOf('SPOTLIGHT') !== -1) return 'spotlight';
  if (title.indexOf('TOPIC') !== -1) return 'topic';
  if (title.indexOf('HEALTH') !== -1) return 'health';
  if (title.indexOf('ERROR') !== -1 || title.indexOf('FAILED') !== -1) return 'error';
  return 'bot';
}

function logThreadIdFor(category) {
  var raw = process.env.TELEGRAM_LOG_THREAD_MAP;
  if (!raw) return null;
  try {
    var map = JSON.parse(raw);
    var v = map && map[category];
    if (v && typeof v === 'object') v = v.threadId || v.id || v.message_thread_id;
    var n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (e) { return null; }
}

function logCategoryLabel(category) {
  var labels = {
    site: '🌐 Site Activity Logs',
    bot: '🤖 Bot Command Logs',
    security: '🚫 Unauthorized Access Logs',
    answer: '✅ Answer Workflow Logs',
    moderation: '🛠 Moderation Action Logs',
    delete: '🗑 Delete Audit Logs',
    pin: '📌 Pin Action Logs',
    spotlight: '🌟 Featured AMA Logs',
    topic: '🏷 Topic Management Logs',
    health: '🩺 System Health Logs',
    error: '⚠️ Error Logs'
  };
  return labels[category] || '🧾 General Logs';
}

function humanLogTitle(title) {
  return String(title || 'LOG')
    .toLowerCase()
    .split(/[_\s]+/)
    .map(function(w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : ''; })
    .join(' ');
}

function prettyFieldName(key) {
  var map = {
    ID: 'Question ID', id: 'Question ID', qid: 'Question ID',
    ToSite: 'Restored To Site', ToPending: 'Restored To Pending',
    PreservedManual: 'Preserved Manual', AutoTopic: 'Auto Topic',
    OldTopic: 'Old Topic', NewTopic: 'New Topic',
    Text: 'Command Text', Value: 'Callback Value'
  };
  return map[key] || String(key || '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function severityForLog(title, category) {
  var t = String(title || '').toUpperCase();
  if (category === 'security') return 'Warning';
  if (category === 'error' || t.indexOf('FAILED') !== -1 || t.indexOf('ERROR') !== -1) return 'Warning';
  if (category === 'delete' || t.indexOf('DELETE') !== -1 || t.indexOf('DELETED') !== -1) return 'Critical';
  if (t.indexOf('BULK') !== -1) return 'Important';
  return 'Info';
}

function summaryForLog(title, fields, category) {
  var t = String(title || '').toUpperCase();
  fields = fields || {};
  if (t === 'SITE QUESTION RECEIVED') return 'A visitor submitted a new AMA question.';
  if (t.indexOf('UNAUTHORIZED') !== -1) return 'An unauthorized Telegram user attempted to use the bot.';
  if (t === 'BOT COMMAND') return 'A bot command was received and processed.';
  if (t === 'BOT CALLBACK') return 'An inline button interaction was received.';
  if (t === 'ANSWER PUBLISHED') return 'An answer was published to the site.';
  if (t === 'ANSWER UPDATED') return 'A published answer was updated.';
  if (t.indexOf('ANSWER PREVIEW') === 0) return 'An answer preview workflow changed state.';
  if (t === 'QUESTION DISMISSED') return 'A question was hidden from the public site.';
  if (t === 'QUESTION RETRIEVED') return 'A hidden question was restored.';
  if (t === 'QUESTION DELETED') return 'A question was permanently deleted.';
  if (t === 'BULK DELETE ALL') return 'A bulk delete operation completed.';
  if (t === 'BULK DISMISS ALL') return 'A bulk dismiss operation completed.';
  if (t === 'BULK RETRIEVE ALL') return 'A bulk retrieve operation completed.';
  if (t === 'QUESTION PINNED') return 'A question was pinned on the site.';
  if (t === 'QUESTION UNPINNED') return 'A question pin was removed.';
  if (t === 'SPOTLIGHT SET') return 'The featured AMA was changed.';
  if (t === 'SPOTLIGHT CLEARED') return 'The featured AMA was cleared.';
  if (t === 'TOPIC SET') return 'A manual topic was assigned.';
  if (t === 'TOPIC CLEARED') return 'A manual topic was removed and auto topic restored.';
  if (t === 'TOPIC RECOMPUTED') return 'An automatic topic was recomputed.';
  if (t === 'TOPICS RECOMPUTED') return 'Automatic topics were recomputed in bulk.';
  if (t === 'HEALTH CHECK') return 'The bot health check was run.';
  return 'A bot log event was recorded.';
}

function isIdField(key) {
  return /(^id$|id$|question id|chat)$/i.test(String(key || ''));
}

function formatFieldValue(key, value) {
  var v = esc(clipText(String(value), 180));
  return isIdField(key) ? '<code>' + v + '</code>' : v;
}

function buildLogMessage(title, fields, emoji, actor, category) {
  fields = fields || {};
  emoji = emoji || '🧾';
  var eventCode = String(title || 'LOG').toUpperCase().replace(/\s+/g, '_');
  var severity = severityForLog(title, category);
  var env = process.env.VERCEL_ENV || process.env.NODE_ENV || 'production';
  var D = CARD_W - 2;
  var lines = [
    '\u2502 ' + severityBadge(severity) + ' ' + emoji + ' <b>' + esc(humanLogTitle(title)) + '</b>',
    '\u2502 ' + BOX_H.repeat(D),
    '\u2502 <b>' + esc(severity) + '</b>  \u00b7  ' + esc(logCategoryShort(category)) + '  \u00b7  <code>' + esc(eventCode) + '</code>',
    '\u2502',
    '\u2502 ' + esc(summaryForLog(title, fields, category))
  ];

  if (actor) {
    lines.push('│');
    lines.push('│ <b>Actor</b>');
    lines.push('│ Name: ' + esc(actor.name));
    lines.push('│ ID: <code>' + esc(actor.id) + '</code>' + ((actor.username && actor.username !== '—') ? ' · ' + esc(actor.username) : ''));
  }

  var preferred = ['ID','Question ID','Command','Text','Action','Value','Topic','OldTopic','NewTopic','AutoTopic','Previous','Visitor','Question','Answer','Draft','Restored','Updated','Deleted','Dismissed','Answered','Unanswered','ToSite','ToPending','Requested','PreservedManual','Source','Chat','Attempt','Error'];
  var keys = [];
  preferred.forEach(function(k) { if (Object.prototype.hasOwnProperty.call(fields, k)) keys.push(k); });
  Object.keys(fields).forEach(function(k) { if (keys.indexOf(k) === -1) keys.push(k); });
  keys = keys.filter(function(k) { var v = fields[k]; return !(v === undefined || v === null || v === ''); });
  if (keys.length) {
    lines.push('│');
    lines.push('│ <b>Details</b>');
    keys.forEach(function(k) { lines.push('│ ' + esc(prettyFieldName(k)) + ': ' + formatFieldValue(k, fields[k])); });
  }

  try {
    lines.push('\u2502');
    lines.push('\u2502 ' + esc(formatTime(new Date().toISOString())) + ' IST \u00b7 ' + esc(env));
  } catch (e) {}
  lines.push('\u2502 ' + BOX_H.repeat(D));
  lines.push('\u2514\u2500\u2500 portfolio-bot');
  return lines.join('\n');
}

async function sendLog(title, fields, emoji, actorOverride, category) {
  var logChatId = process.env.TELEGRAM_LOG_CHAT_ID;
  var botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!logChatId || !botToken) return;
  fields = fields || {};
  emoji = emoji || '\uD83E\uDDFE';
  category = category || inferLogCategory(title);
  var actor = actorOverride || _currentActor;
  try {
    var payload = {
      chat_id: logChatId,
      text: buildLogMessage(title, fields, emoji, actor, category),
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };
    var threadId = logThreadIdFor(category);
    if (threadId) payload.message_thread_id = threadId;
    await fetch(TELEGRAM_API + botToken + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {}
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
  var result = await firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['answer', 'answered', 'answeredAt', 'dismissed']), {
    fields: {
      answer: { stringValue: answer.slice(0, 1000) },
      answered: { booleanValue: true },
      answeredAt: { stringValue: new Date().toISOString() },
      dismissed: { booleanValue: false }
    }
  });
  if (!_suppressItemLogs) await sendLog('ANSWER PUBLISHED', { ID: id, Answer: clipText(answer, 120) }, '\u2705');
  return result;
}

async function editAnswer(id, answer) {
  var result = await firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['answer', 'editedAt']), {
    fields: {
      answer: { stringValue: answer.slice(0, 1000) },
      editedAt: { stringValue: new Date().toISOString() }
    }
  });
  if (!_suppressItemLogs) await sendLog('ANSWER UPDATED', { ID: id, Answer: clipText(answer, 120) }, '\u270F\uFE0F');
  return result;
}

async function dismissQuestion(id) {
  /* Set dismissed=true AND answered=false so the site's Firestore query
     (answered == true) naturally excludes dismissed questions.
     The bot's questionState() checks dismissed first, so the card
     still shows as DISMISSED regardless of answered value. */
  var result = await firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['dismissed', 'answered']), {
    fields: { dismissed: { booleanValue: true }, answered: { booleanValue: false } }
  });
  if (!_suppressItemLogs) await sendLog('QUESTION DISMISSED', { ID: id }, '\uD83D\uDE48');
  return result;
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
    if (!_suppressItemLogs) await sendLog('QUESTION RETRIEVED', { ID: id, Restored: 'site with answer' }, '\u21A9\uFE0F');
    return { restoredAs: 'answered', question: q };
  } else {
    await firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['dismissed', 'answered']), {
      fields: { dismissed: { booleanValue: false }, answered: { booleanValue: false } }
    });
    if (!_suppressItemLogs) await sendLog('QUESTION RETRIEVED', { ID: id, Restored: 'pending queue' }, '\u21A9\uFE0F');
    return { restoredAs: 'unanswered', question: q };
  }
}

async function deleteQuestion(id) {
  var result = await firestore('DELETE', docPath(COLLECTION, id));
  if (!_suppressItemLogs) await sendLog('QUESTION DELETED', { ID: id }, '\uD83D\uDDD1');
  return result;
}

/* -- Pin/Unpin -- */
async function pinQuestion(id) {
  var result = await firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['pinned']), {
    fields: { pinned: { booleanValue: true } }
  });
  if (!_suppressItemLogs) await sendLog('QUESTION PINNED', { ID: id }, '\uD83D\uDCCD');
  return result;
}

async function unpinQuestion(id) {
  var result = await firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['pinned']), {
    fields: { pinned: { booleanValue: false } }
  });
  if (!_suppressItemLogs) await sendLog('QUESTION UNPINNED', { ID: id }, '\uD83D\uDCCD');
  return result;
}

async function setSpotlightQuestion(id) {
  var all = await listAllQuestions();
  for (var i = 0; i < all.length; i++) {
    if (all[i].spotlight && all[i].id !== id) {
      try {
        await firestore('PATCH', docPath(COLLECTION, all[i].id) + '?' + mask(['spotlight']), {
          fields: { spotlight: { booleanValue: false } }
        });
      } catch (e) {}
    }
  }
  var result = await firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['spotlight', 'spotlightAt']), {
    fields: { spotlight: { booleanValue: true }, spotlightAt: { stringValue: new Date().toISOString() } }
  });
  if (!_suppressItemLogs) await sendLog('SPOTLIGHT SET', { ID: id }, '\uD83C\uDF1F');
  return result;
}

async function clearSpotlightQuestion(id) {
  var result = await firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['spotlight']), {
    fields: { spotlight: { booleanValue: false } }
  });
  if (!_suppressItemLogs) await sendLog('SPOTLIGHT CLEARED', { ID: id }, '\uD83C\uDF1F');
  return result;
}

async function setQuestionTopic(id, topic, oldTopic) {
  var normalized = normalizeTopic(topic);
  var result = await firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['topic', 'topicManual', 'topicAt']), {
    fields: {
      topic: { stringValue: normalized },
      topicManual: { booleanValue: true },
      topicAt: { stringValue: new Date().toISOString() }
    }
  });
  if (!_suppressItemLogs) await sendLog('TOPIC SET', { ID: id, OldTopic: oldTopic || '—', NewTopic: normalized, Source: 'manual' }, '\uD83C\uDFF7');
  return result;
}

async function setAutoQuestionTopic(id, topic) {
  return firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['topic', 'topicManual', 'topicAt']), {
    fields: {
      topic: { stringValue: normalizeTopic(topic) },
      topicManual: { booleanValue: false },
      topicAt: { stringValue: new Date().toISOString() }
    }
  });
}

async function clearQuestionTopic(id) {
  return firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['topic', 'topicManual', 'topicAt']), {
    fields: {
      topic: { stringValue: '' },
      topicManual: { booleanValue: false },
      topicAt: { stringValue: new Date().toISOString() }
    }
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
  var result = await firestore('PATCH', docPath(PREVIEW_SESSION_COLLECTION, String(chatId)), {
    fields: { chatId: { stringValue: String(chatId) }, questionId: { stringValue: questionId }, answerText: { stringValue: answerText.slice(0, 1000) }, createdAt: { stringValue: new Date().toISOString() } }
  });
  await sendLog('ANSWER PREVIEW CREATED', { ID: questionId, Draft: clipText(answerText, 120) }, '\uD83D\uDC41');
  return result;
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
    spotlight: !!(f.spotlight && f.spotlight.booleanValue),
    spotlightAt: (f.spotlightAt && f.spotlightAt.stringValue) || '',
    topic: (f.topic && f.topic.stringValue) || '',
    topicManual: !!(f.topicManual && f.topicManual.booleanValue),
    topicAt: (f.topicAt && f.topicAt.stringValue) || '',
    createdAt: (f.createdAt && f.createdAt.stringValue) || '',
    answeredAt: (f.answeredAt && f.answeredAt.stringValue) || '',
    editedAt: (f.editedAt && f.editedAt.stringValue) || '',
    votes: Number((f.votes && f.votes.integerValue) || (f.votes && f.votes.doubleValue) || 0),
    reactions: reactions,
    // Draft / scheduled-publish state (54, 56)
    draft: !!(f.draft && f.draft.booleanValue),
    draftAnswer: (f.draftAnswer && f.draftAnswer.stringValue) || '',
    draftAt: (f.draftAt && f.draftAt.stringValue) || '',
    publishAt: (f.publishAt && f.publishAt.stringValue) || '',
    // Spam/profanity auto-flag (55)
    flagged: !!(f.flagged && f.flagged.booleanValue),
    flagReason: (f.flagReason && f.flagReason.stringValue) || ''
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
  return entries.map(function(e) { return esc(e[0]) + ' ' + e[1]; }).join('  ');
}

/* ============================================================
 MESSAGE TEMPLATES - Consistent, warm, concise
 ============================================================ */

/* Box-drawing shortcuts */
/* Box-drawing shortcuts — rounded modern panel. cardTop/cardBottom frame each
   message; bars and tables render inline (no <pre> code-box, so messages are
   not one big copyable block). */
var BOX_TL = '\u256D', BOX_TR = '\u256E', BOX_BL = '\u2570', BOX_BR = '\u256F';
var BOX_H = '\u2500', BOX_V = '\u2502';
var CARD_W = 34;

/* visible (tag/entity-stripped) length, for monospace alignment */
function visLen(html) {
  return String(html == null ? '' : html).replace(/<[^>]+>/g, '').replace(/&[a-zA-Z#0-9]+;/g, ' ').length;
}

function cardTop(title) {
  var pad = CARD_W - 2 - visLen(title);
  if (pad < 2) pad = 2;
  return BOX_TL + BOX_H + title + ' ' + BOX_H.repeat(pad) + BOX_TR;
}
var cardBottom = BOX_BL + BOX_H.repeat(CARD_W) + BOX_BR;

/* ── Dashboard widgets (rendered inline in the card) ── */
function bar(value, max, width) {
  width = width || 10;
  if (!max) return '\u2591'.repeat(width);
  var f = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return '\u2588'.repeat(f) + '\u2591'.repeat(width - f);
}
function padR(s, n) {
  s = String(s == null ? '' : s);
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}
/* aligned stat row:  │ 📬  Total     ████████████░░░░░░░░  142 */
function statRow(emoji, label, value, max, width) {
  width = width || 12;
  return BOX_V + ' ' + emoji + ' ' + padR(label, 9) + bar(value, max, width) + '  <b>' + esc(value) + '</b>';
}
/* aligned key/value row */
function kvRow(label, value) {
  return BOX_V + ' ' + padR(label, 13) + esc(value);
}
function divider() {
  return BOX_V + ' ' + BOX_H.repeat(CARD_W - 2);
}
function sectionLabel(icon, text) {
  return BOX_V + ' ' + icon + ' <b>' + esc(text) + '</b>';
}
function checkRow(ok, label) {
  return BOX_V + '  ' + (ok ? '\u2705' : '\u274C') + '  ' + esc(label);
}

/* ── Logging helpers ── */
function severityBadge(sev) {
  return ({ Info: '\u2139\uFE0F', Important: '\uD83D\uDD35', Warning: '\u26A0\uFE0F', Critical: '\uD83D\uDEA8' })[sev] || '\u2139\uFE0F';
}
function logCategoryShort(category) {
  return ({
    site: 'Site', bot: 'Bot', security: 'Security', answer: 'Answer',
    moderation: 'Moderation', delete: 'Delete', pin: 'Pin', spotlight: 'Spotlight',
    topic: 'Topic', health: 'Health', error: 'Error'
  })[category] || 'General';
}

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

function telegramUserName(user) {
  user = user || {};
  var full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || (user.username ? '@' + user.username : 'Telegram user');
}

function privateBotStartNotice(user) {
  user = user || {};
  var name = telegramUserName(user);
  var userId = user.id ? String(user.id) : 'Unavailable';
  var username = user.username ? '@' + user.username : 'Unavailable';
  return [
    cardTop('\uD83D\uDD12 <b>PRIVATE ADMIN BOT</b>'),
    BOX_V,
    BOX_V + ' Hello, <b>' + esc(name) + '</b>.',
    BOX_V,
    BOX_V + ' This bot is the private admin',
    BOX_V + ' assistant for Yatin Sharma\'s',
    BOX_V + ' portfolio AMA system.',
    BOX_V,
    BOX_V + ' Access is restricted to the owner.',
    BOX_V + ' No commands are available here.',
    BOX_V,
    BOX_V + ' <b>Your Telegram details</b>',
    BOX_V + ' Name \u2500 ' + esc(name),
    BOX_V + ' ID \u2500 <code>' + esc(userId) + '</code>',
    BOX_V + ' Username \u2500 ' + esc(username),
    BOX_V,
    BOX_V + ' If this is unexpected, please',
    BOX_V + ' contact the owner directly.',
    BOX_V,
    cardBottom
  ].join('\n');
}

function privateBotCommandDeniedNotice(user, command) {
  user = user || {};
  var userId = user.id ? String(user.id) : 'Unavailable';
  var username = user.username ? '@' + user.username : 'Unavailable';
  return [
    cardTop('\u26D4 <b>ACCESS RESTRICTED</b>'),
    BOX_V,
    BOX_V + ' This is a private admin bot.',
    BOX_V + ' Your command was not processed.',
    BOX_V,
    BOX_V + ' Command \u2500 <code>' + esc(command || 'unknown') + '</code>',
    BOX_V + ' ID \u2500 <code>' + esc(userId) + '</code>',
    BOX_V + ' Username \u2500 ' + esc(username),
    BOX_V,
    BOX_V + ' Use /start to view ownership',
    BOX_V + ' and access information.',
    BOX_V,
    cardBottom
  ].join('\n');
}

function privateBotMessageDeniedNotice(user) {
  user = user || {};
  var userId = user.id ? String(user.id) : 'Unavailable';
  return [
    cardTop('\uD83D\uDD12 <b>PRIVATE BOT</b>'),
    BOX_V,
    BOX_V + ' This bot is restricted to',
    BOX_V + ' its owner only.',
    BOX_V,
    BOX_V + ' Messages from this chat are',
    BOX_V + ' not processed.',
    BOX_V,
    BOX_V + ' Your Telegram ID:',
    BOX_V + ' <code>' + esc(userId) + '</code>',
    BOX_V,
    BOX_V + ' Use /start for more details.',
    BOX_V,
    cardBottom
  ].join('\n');
}

async function sendUnauthorizedNotice(chatId, user, replyToId, kind, command) {
  try {
    var text = kind === 'start'
      ? privateBotStartNotice(user)
      : kind === 'command'
        ? privateBotCommandDeniedNotice(user, command)
        : privateBotMessageDeniedNotice(user);
    await sendTelegram(chatId, text, replyToId);
  } catch (e) {}
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
    [{ text: '\uD83D\uDCDD Save as draft', callback_data: 'previewdraft' }, { text: '\u274C Cancel', callback_data: 'previewcancel' }]
  ] };
}

function cmdBtn(text, command) { return { text: text, callback_data: 'cmd:' + command }; }
function getBtn(text, id) { return { text: text, callback_data: 'get:' + id }; }
function searchBtn(text, query) { return { text: text, callback_data: 'search:' + query }; }
function navMarkup(rows) { return { inline_keyboard: rows }; }

function digestButtons() {
  return navMarkup([
    [cmdBtn('\uD83D\uDCE5 Smart Inbox', 'inbox')],
    [cmdBtn('\uD83C\uDFF7 Topics', 'topics'), cmdBtn('\uD83E\uDDEA Quality', 'quality')],
    [cmdBtn('\uD83D\uDCCA Stats', 'stats'), cmdBtn('\uD83E\uDE7A Health', 'health')],
    [exportEntryBtn()]
  ]);
}
function inboxButtons(firstId) {
  var rows = [];
  if (firstId) rows.push([getBtn('\uD83C\uDFAF Open Top Priority', firstId)]);
  rows.push([cmdBtn('\uD83D\uDCCB Pending', 'pending'), cmdBtn('\uD83D\uDCEC All', 'all')]);
  rows.push([cmdBtn('\uD83D\uDDDE Digest', 'digest'), cmdBtn('\uD83D\uDCCA Stats', 'stats')]);
  return navMarkup(rows);
}
function qualityButtons(firstId) {
  var rows = [];
  if (firstId) rows.push([getBtn('\uD83C\uDFAF Open First', firstId)]);
  rows.push([cmdBtn('\uD83E\uDDEA Recheck', 'quality'), cmdBtn('\uD83D\uDDDE Digest', 'digest')]);
  rows.push([cmdBtn('\uD83D\uDCCA Stats', 'stats')]);
  return navMarkup(rows);
}
function healthButtons() {
  return navMarkup([
    [cmdBtn('\uD83D\uDD04 Recheck Health', 'health')],
    [cmdBtn('\uD83D\uDCCA Stats', 'stats'), cmdBtn('\uD83D\uDDDE Digest', 'digest')]
  ]);
}

function exportButtons() {
  return { inline_keyboard: [[
    { text: '\uD83D\uDCC4 Text', callback_data: 'export:text' },
    { text: '{ } JSON', callback_data: 'export:json' },
    { text: '\uD83D\uDCE9 CSV', callback_data: 'export:csv' }
  ]] };
}
function exportEntryBtn() { return { text: '\uD83D\uDCE4 Export', callback_data: 'export:menu' }; }
function exportMenuCard() {
  return cardTop('\uD83D\uDCE4 <b>EXPORT FORMAT</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Choose a format for your AMA export.\n' + BOX_V + '\n' + BOX_V + '  \uD83D\uDCC4  Text   \u2500 readable summary\n' + BOX_V + '  { }  JSON   \u2500 structured data\n' + BOX_V + '  \uD83D\uDCE9  CSV    \u2500 spreadsheet-ready\n' + BOX_V + '\n' + cardBottom;
}
function statsButtons() {
  return navMarkup([
    [cmdBtn('\uD83D\uDDDE Digest', 'digest'), cmdBtn('\uD83D\uDCE5 Inbox', 'inbox')],
    [cmdBtn('\uD83C\uDFF7 Topics', 'topics'), cmdBtn('\uD83E\uDE7A Health', 'health')],
    [exportEntryBtn()]
  ]);
}
function featuredButtons(hasFeatured) {
  if (hasFeatured) return navMarkup([
    [{ text: '\uD83E\uDDF9 Clear Featured', callback_data: 'cmd:unspotlight' }],
    [cmdBtn('\uD83D\uDCEC Browse All', 'all'), cmdBtn('\uD83D\uDCCA Stats', 'stats')]
  ]);
  return navMarkup([[cmdBtn('\uD83D\uDCEC Browse All', 'all'), cmdBtn('\uD83D\uDCE5 Inbox', 'inbox')]]);
}
function spotlightSuccessButtons() {
  return navMarkup([
    [{ text: '\uD83C\uDF1F View Featured', callback_data: 'featured:show' }],
    [{ text: '\uD83E\uDDF9 Clear Featured', callback_data: 'cmd:unspotlight' }],
    [cmdBtn('\uD83D\uDCEC Browse All', 'all')]
  ]);
}
function unspotlightButtons() {
  return navMarkup([
    [cmdBtn('\uD83D\uDCEC Browse All', 'all'), cmdBtn('\uD83D\uDCE5 Inbox', 'inbox')],
    [cmdBtn('\uD83D\uDDDE Digest', 'digest')]
  ]);
}
function topicSearchKey(topicName) {
  var map = { 'AI/ML': 'ai', 'React': 'react', 'Career': 'career', 'Projects': 'project', 'Anime': 'anime', 'Personal': 'personal', 'General': 'general' };
  return map[topicName] || String(topicName || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 30);
}
function topicsButtons(topics) {
  var rows = [];
  topics.slice(0, 4).forEach(function(t) { rows.push([searchBtn('\uD83D\uDD0D Search ' + t.name, topicSearchKey(t.name))]); });
  rows.push([cmdBtn('\uD83D\uDD04 Recompute Auto', 'retopics')]);
  rows.push([cmdBtn('\uD83D\uDCE5 Inbox', 'inbox'), cmdBtn('\uD83D\uDDDE Digest', 'digest')]);
  return navMarkup(rows);
}
function topicInfoButtons(id) {
  return navMarkup([
    [getBtn('\uD83D\uDCCB Open Question', id)],
    [{ text: '\uD83D\uDD04 Recompute Auto', callback_data: 'retopic:' + id }, { text: '\uD83E\uDDF9 Clear Topic', callback_data: 'cleartopic:' + id }],
    [cmdBtn('\uD83C\uDFF7 Topics', 'topics')]
  ]);
}

function normalizeTopic(input) {
  var raw = String(input || '').trim();
  var t = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!t) return 'General';
  if (['ai', 'ml', 'ai ml', 'aiml', 'machine learning', 'artificial intelligence', 'llm', 'rag', 'data science'].indexOf(t) !== -1) return 'AI/ML';
  if (['react', 'frontend', 'front end', 'javascript', 'js', 'typescript', 'ts', 'tailwind', 'css', 'html'].indexOf(t) !== -1) return 'React';
  if (['career', 'job', 'jobs', 'intern', 'internship', 'resume', 'roadmap', 'learning', 'learn'].indexOf(t) !== -1) return 'Career';
  if (['project', 'projects', 'portfolio', 'github', 'smarthealthcare', 'yatini', 'build'].indexOf(t) !== -1) return 'Projects';
  if (['anime', 'manga', 'naruto', 'gaara', 'one piece', 'bleach', 'aot'].indexOf(t) !== -1) return 'Anime';
  if (['personal', 'life', 'hobby', 'music', 'food', 'college', 'about you'].indexOf(t) !== -1) return 'Personal';
  return raw.split(' ').map(function(w) { return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''; }).join(' ').slice(0, 40);
}

function titleTopic(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).map(function(w) {
    var lower = w.toLowerCase();
    var upperKeep = ['ai', 'ml', 'rag', 'llm', 'api', 'css', 'html', 'js', 'ui', 'ux'];
    if (upperKeep.indexOf(lower) !== -1) return lower.toUpperCase();
    if (lower === 'react') return 'React';
    if (lower === 'firebase') return 'Firebase';
    if (lower === 'firestore') return 'Firestore';
    if (lower === 'github') return 'GitHub';
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ').slice(0, 40) || 'General';
}

function autoTopicForQuestion(q) {
  var text = ((q.question || '') + ' ' + (q.answer || '')).toLowerCase();
  var phraseMap = [
    ['smarthealthcare', 'SmartHealthCare'],
    ['smart healthcare', 'SmartHealthCare'],
    ['disease prediction', 'Disease Prediction'],
    ['drug recommendation', 'Drug Recommendation'],
    ['heart risk', 'Heart Risk'],
    ['machine learning', 'Machine Learning'],
    ['deep learning', 'Deep Learning'],
    ['data science', 'Data Science'],
    ['random forest', 'Random Forest'],
    ['rag chatbot', 'RAG Chatbot'],
    ['telegram bot', 'Telegram Bot'],
    ['firebase firestore', 'Firestore'],
    ['firestore rules', 'Firestore Rules'],
    ['react hooks', 'React Hooks'],
    ['portfolio website', 'Portfolio'],
    ['full stack', 'Full Stack'],
    ['resume tips', 'Resume'],
    ['career roadmap', 'Career Roadmap'],
    ['anime list', 'Anime List'],
    ['last fm', 'Last.fm'],
    ['last.fm', 'Last.fm']
  ];
  for (var i = 0; i < phraseMap.length; i++) if (text.indexOf(phraseMap[i][0]) !== -1) return phraseMap[i][1];

  var important = ['smarthealthcare','yatini','react','firebase','firestore','telegram','wakatime','lastfm','anilist','github','portfolio','resume','internship','roadmap','career','anime','naruto','gaara','bleach','pokemon','healthcare','prediction','medicine','disease','model','rag','llm','api','database','frontend','backend','python','javascript','typescript','tailwind','vercel','streamlit','faiss','groq'];
  for (var j = 0; j < important.length; j++) {
    var wordRe = new RegExp('(^|[^a-z0-9])' + important[j].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i');
    if (wordRe.test(text)) return titleTopic(important[j]);
  }

  var stop = { what:1, why:1, how:1, can:1, you:1, your:1, the:1, and:1, for:1, with:1, about:1, please:1, tell:1, me:1, is:1, are:1, do:1, does:1, did:1, this:1, that:1, from:1, have:1, has:1, want:1, need:1, question:1, answer:1, ask:1, anything:1, best:1, good:1, like:1, use:1, using:1, make:1, made:1, build:1, built:1, start:1, learn:1, explain:1 };
  var words = text.replace(/[^a-z0-9+#.\s-]/g, ' ').split(/\s+/).filter(function(w) { return w.length >= 4 && !stop[w]; });
  var counts = {};
  words.forEach(function(w) { counts[w] = (counts[w] || 0) + 1; });
  var best = Object.keys(counts).sort(function(a, b) { return (counts[b] * 10 + b.length) - (counts[a] * 10 + a.length); })[0];
  return best ? titleTopic(best) : 'General';
}

function resolvedTopic(q) {
  if (q && q.topic && String(q.topic).trim()) return normalizeTopic(q.topic);
  return autoTopicForQuestion(q || {});
}

function topicSource(q) {
  return q && q.topic && q.topicManual ? 'manual' : 'auto';
}

async function ensureTopicStored(q) {
  if (!q || !q.id) return q;
  if (q.topic && String(q.topic).trim()) return q;
  var topic = autoTopicForQuestion(q);
  try { await setAutoQuestionTopic(q.id, topic); q.topic = topic; q.topicManual = false; q.topicAt = new Date().toISOString(); } catch (e) {}
  return q;
}

async function ensureTopicsStored(all) {
  for (var i = 0; i < all.length; i++) await ensureTopicStored(all[i]);
  return all;
}

function topicForQuestion(q) { return resolvedTopic(q); }

function topTopics(all) {
  var counts = {};
  all.forEach(function(q) { var t = topicForQuestion(q); counts[t] = (counts[t] || 0) + 1; });
  return Object.keys(counts).map(function(name) { return { name: name, count: counts[name] }; })
    .sort(function(a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
}

function questionValueScore(q) {
  var st = questionState(q);
  var ageDays = q.createdAt ? Math.max(0, (Date.now() - new Date(q.createdAt).getTime()) / 86400000) : 0;
  var score = 0;
  if (q.pinned) score += 30;
  if (st === 'UNANSWERED') score += 25;
  if (st === 'DISMISSED' && !q.answer) score += 10;
  score += Math.min(20, ageDays * 2);
  score += Math.min(15, String(q.question || '').length / 20);
  score += Math.min(15, q.votes || 0);
  return score;
}

function topicLines(all, limit) {
  var topics = topTopics(all).slice(0, limit || 7);
  if (!topics.length) return [BOX_V + ' No topic data yet.'];
  return topics.map(function(t, i) { return BOX_V + ' ' + (i + 1) + '. <b>' + esc(t.name) + '</b> — ' + t.count; });
}

/* -- /start -- Dynamic welcome with live stats -- */
async function buildWelcomeText() {
  var s = { total: 0, unanswered: 0, answered: 0, dismissed: 0, pinned: 0, totalVotes: 0, avgResponseMs: 0 };
  try { s = await getStats(); } catch (e) {}
  var health = s.unanswered === 0 ? 'Clear' : (s.unanswered <= 3 ? 'Active' : 'Busy');
  var healthEmoji = s.unanswered === 0 ? '\uD83D\uDFE2' : (s.unanswered <= 3 ? '\uD83D\uDFE1' : '\uD83D\uDD34');
  var avg = s.avgResponseMs > 0 ? formatDuration(s.avgResponseMs) : '\u2014';
  var mx = Math.max(s.total, 1);
  return [
    cardTop('\u2728 <b>AMA CONTROL ROOM</b>'),
    BOX_V,
    BOX_V + ' Portfolio inbox is online.',
    BOX_V + ' ' + healthEmoji + ' Inbox health \u2500 <b>' + health + '</b>',
    divider(),
    statRow('\uD83D\uDCEC', 'Total', s.total, mx),
    statRow('\u23F3', 'Pending', s.unanswered, mx),
    statRow('\u2705', 'Answered', s.answered, mx),
    statRow('\uD83D\uDE48', 'Hidden', s.dismissed, mx),
    statRow('\uD83D\uDCCD', 'Pinned', s.pinned, Math.max(s.answered, 1)),
    divider(),
    kvRow('Avg reply', avg),
    kvRow('Total votes', s.totalVotes),
    divider(),
    sectionLabel('\u26A1', 'Quick actions'),
    BOX_V + '   /inbox    \u00b7 priority queue',
    BOX_V + '   /queue    \u00b7 answer pending inline',
    BOX_V + '   /digest   \u00b7 7-day summary',
    BOX_V + '   /pending  \u00b7 unanswered queue',
    BOX_V + '   /featured \u00b7 featured AMA',
    BOX_V + '   /health   \u00b7 system check',
    BOX_V,
    BOX_V + ' Tip: tap <b>Answer</b> or reply to any',
    BOX_V + ' question card to publish with preview.',
    BOX_V,
    cardBottom
  ].join('\n');
}

/* -- /help -- Command reference -- */
var HELP_TEXT = [
  cardTop('📖 <b>AMA COMMAND GUIDE</b>'),
  BOX_V,
  BOX_V + ' <b>System</b>',
  BOX_V + ' /start',
  BOX_V + '   Open bot dashboard.',
  BOX_V + ' /help',
  BOX_V + '   Show this command guide.',
  BOX_V + ' /cancel',
  BOX_V + '   Exit active input mode.',
  BOX_V,
  BOX_V + ' <b>Queues</b>',
  BOX_V + ' /pending',
  BOX_V + '   Unanswered questions.',
  BOX_V + ' /refresh',
  BOX_V + '   Pending + hidden queue.',
  BOX_V + ' /recent',
  BOX_V + '   Latest answered posts.',
  BOX_V + ' /all',
  BOX_V + '   Browse all questions.',
  BOX_V + ' /dismissed',
  BOX_V + '   Browse hidden questions.',
  BOX_V + ' /pinned',
  BOX_V + '   Browse pinned questions.',
  BOX_V,
  BOX_V + ' <b>Find</b>',
  BOX_V + ' /get &lt;id&gt;',
  BOX_V + '   Open full question card.',
  BOX_V + ' /search &lt;text&gt;',
  BOX_V + '   Search Q, A, and name.',
  BOX_V + ' /lookup',
  BOX_V + '   Paste an ID to inspect.',
  BOX_V + ' /export',
  BOX_V + '   Export as Text / JSON / CSV.',
  BOX_V + '   /export json \u00b7 /export csv',
  BOX_V,
  BOX_V + ' <b>Insights</b>',
  BOX_V + ' /digest',
  BOX_V + '   7-day activity summary.',
  BOX_V + ' /inbox',
  BOX_V + '   Smart priority queue.',
  BOX_V + ' /topics',
  BOX_V + '   Topic breakdown.',
  BOX_V + ' /topic &lt;id&gt; &lt;topic&gt;',
  BOX_V + '   Set manual topic.',
  BOX_V + ' /topicof &lt;id&gt;',
  BOX_V + '   Show topic source.',
  BOX_V + ' /cleartopic &lt;id&gt;',
  BOX_V + '   Return to auto topic.',
  BOX_V + ' /retopic &lt;id&gt;',
  BOX_V + '   Recompute one auto topic.',
  BOX_V + ' /retopics',
  BOX_V + '   Recompute all auto topics.',
  BOX_V + ' /quality',
  BOX_V + '   Answers to improve.',
  BOX_V + ' /trends',
  BOX_V + '   Activity + response times.',
  BOX_V + ' /top',
  BOX_V + '   Most upvoted / reacted.',
  BOX_V + ' /health',
  BOX_V + '   Bot and database status.',
  BOX_V,
  BOX_V + ' <b>Answer</b>',
  BOX_V + ' /answer &lt;id&gt; &lt;text&gt;',
  BOX_V + '   Draft and preview reply.',
  BOX_V + ' /edit &lt;id&gt;',
  BOX_V + '   Revise published answer.',
  BOX_V + ' /queue',
  BOX_V + '   Answer pending inline (bulk).',
  BOX_V + ' /draft &lt;id&gt; 🤖',
  BOX_V + '   AI-suggest an answer.',
  BOX_V + ' /improve · /shorten · /expand &lt;id&gt; 🤖',
  BOX_V + '   AI-refine the current answer.',
  BOX_V,
  BOX_V + ' <b>Drafts</b>',
  BOX_V + ' /drafts',
  BOX_V + '   List unpublished drafts.',
  BOX_V + ' /publish &lt;id&gt;',
  BOX_V + '   Publish a saved draft.',
  BOX_V + ' /schedule &lt;id&gt; &lt;when&gt;',
  BOX_V + '   Auto-publish later (e.g. +2h).',
  BOX_V,
  BOX_V + ' <b>Templates</b>',
  BOX_V + ' /templates',
  BOX_V + '   List saved reply templates.',
  BOX_V + ' /addtemplate name | text',
  BOX_V + '   Save a template.',
  BOX_V + ' /usetemplate name &lt;id&gt;',
  BOX_V + '   Load one as a preview.',
  BOX_V + ' /deltemplate name',
  BOX_V + '   Remove a template.',
  BOX_V,
  BOX_V + ' <b>Pin</b>',
  BOX_V + ' /pin &lt;id&gt;',
  BOX_V + '   Keep question on top.',
  BOX_V + ' /unpin &lt;id&gt;',
  BOX_V + '   Remove top placement.',
  BOX_V + ' /spotlight &lt;id&gt;',
  BOX_V + '   Feature answered AMA.',
  BOX_V + ' /featured',
  BOX_V + '   Show featured AMA.',
  BOX_V + ' /unspotlight',
  BOX_V + '   Clear featured AMA.',
  BOX_V,
  BOX_V + ' <b>Hide / restore</b>',
  BOX_V + ' /dismiss &lt;id&gt;',
  BOX_V + '   Hide from public site.',
  BOX_V + ' /dismissall',
  BOX_V + '   Hide all active items.',
  BOX_V + ' /retrieve &lt;id&gt;',
  BOX_V + '   Restore one hidden item.',
  BOX_V + ' /retrieveall',
  BOX_V + '   Restore all hidden items.',
  BOX_V,
  BOX_V + ' <b>Delete</b>',
  BOX_V + ' /delete &lt;id&gt;',
  BOX_V + '   Permanently remove one.',
  BOX_V + ' /deleteall',
  BOX_V + '   Remove all (type-token confirm).',
  BOX_V + ' /undo',
  BOX_V + '   Reverse last delete / dismiss.',
  BOX_V,
  BOX_V + ' <b>Dashboard</b>',
  BOX_V + ' /stats',
  BOX_V + '   Totals and performance.',
  BOX_V,
  BOX_V + ' 🤖 = needs GROQ_API_KEY (AI features).',
  BOX_V,
  BOX_V + ' Type /help anytime to',
  BOX_V + ' reopen this reference.',
  BOX_V,
  cardBottom
].join('\n');

/* -- Reply Keyboard (always visible quick actions) -- */
var REPLY_KEYBOARD = {
  keyboard: [
    [{ text: '\uD83D\uDCE5 Inbox' }, { text: '\uD83D\uDDDE Digest' }, { text: '\uD83D\uDCCA Stats' }],
    [{ text: '\uD83D\uDCCB Pending' }, { text: '\uD83D\uDD50 Recent' }, { text: '\uD83D\uDD0D Search' }],
    [{ text: '\uD83D\uDDC2 Queue' }, { text: '\uD83D\uDCDD Drafts' }, { text: '\uD83D\uDCC8 Trends' }],
    [{ text: '\uD83C\uDF1F Featured' }, { text: '\uD83E\uDE7A Health' }, { text: '\uD83D\uDCD6 Help' }]
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
    var healthEmoji = s.unanswered === 0 ? '\uD83D\uDFE2' : (s.unanswered <= 3 ? '\uD83D\uDFE1' : '\uD83D\uDD34');
    var answerRate = s.total ? Math.round((s.answered / s.total) * 100) : 0;
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
      BOX_V + ' ' + healthEmoji + ' Inbox \u2500 <b>' + health + '</b>   \uD83D\uDC4D Answer rate \u2500 <b>' + answerRate + '%</b>',
      divider(),
      sectionLabel('\uD83D\uDCCA', 'Volume'),
      statRow('\uD83D\uDCEC', 'Total', s.total, maxStat),
      statRow('\u23F3', 'Pending', s.unanswered, maxStat),
      statRow('\u2705', 'Answered', s.answered, maxStat),
      statRow('\uD83D\uDE48', 'Hidden', s.dismissed, maxStat),
      statRow('\uD83D\uDCCD', 'Pinned', s.pinned, Math.max(s.answered, 1)),
      divider(),
      sectionLabel('\u26A1', 'Performance'),
      kvRow('Avg reply', esc(avg)),
      kvRow('Total votes', s.totalVotes)
    ];
    if (s.mostVoted) {
      statsText.push(divider());
      statsText.push(sectionLabel('\uD83D\uDD25', 'Top question'));
      statsText.push(BOX_V + ' \u201C' + esc(clipText(s.mostVoted.question, 60)) + '\u201D');
      statsText.push(BOX_V + ' ' + bar((s.mostVoted.votes || 0), Math.max(s.mostVoted.votes || 0, 1), 12) + '  <b>' + (s.mostVoted.votes || 0) + '</b> votes');
    }
    statsText.push(BOX_V);
    statsText.push(cardBottom);
    statsText = statsText.join('\n');
    await respondTelegram(chatId, statsText, replyToId, statsButtons(), editMessageId);
  } catch (e) {
    await respondTelegram(chatId,
      cardTop('\u26A0\uFE0F <b>STATS ERROR</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Dashboard could not load.\n' + BOX_V + ' Please try again in a moment.\n' + BOX_V + '\n' + cardBottom,
      replyToId, healthButtons(), editMessageId);
  }
}

async function sendDigest(chatId, replyToId, editMessageId) {
  var all = await listAllQuestions();
  var since = Date.now() - 7 * 86400000;
  var week = all.filter(function(q) { return q.createdAt && new Date(q.createdAt).getTime() >= since; });
  var answeredWeek = week.filter(function(q) { return questionState(q) === 'ANSWERED'; });
  var pending = all.filter(function(q) { return questionState(q) === 'UNANSWERED'; });
  var top = all.filter(function(q) { return questionState(q) === 'ANSWERED'; })
    .sort(function(a, b) { return (b.votes || 0) - (a.votes || 0); })[0];
  var topics = topTopics(week.length ? week : all);
  var weekRate = week.length ? Math.round((answeredWeek.length / week.length) * 100) : 0;
  var mx = Math.max(week.length, 1);
  var suggestion = pending.length ? 'Answer oldest pending question.' : 'Inbox is clear. Review /quality.';
  var lines = [
    cardTop('\uD83D\uDDDE <b>AMA DIGEST</b>'),
    BOX_V,
    BOX_V + ' Window \u2500 <b>last 7 days</b>',
    divider(),
    statRow('\uD83D\uDCDD', 'New', week.length, mx),
    statRow('\u2705', 'Answered', answeredWeek.length, mx),
    statRow('\u23F3', 'Pending', pending.length, mx),
    BOX_V,
    kvRow('Reply rate', weekRate + '%'),
    kvRow('Top topic', (topics[0] && topics[0].name) || '—'),
    divider(),
    sectionLabel('\uD83C\uDFAF', 'Top question'),
    top ? BOX_V + ' \u201C' + esc(clipText(top.question, 70)) + '\u201D' : BOX_V + ' —',
    BOX_V,
    sectionLabel('\u2705', 'Suggested action'),
    BOX_V + ' ' + esc(suggestion),
    BOX_V,
    cardBottom
  ];
  await respondTelegram(chatId, lines.join('\n'), replyToId, digestButtons(), editMessageId);
}

async function sendSmartInbox(chatId, replyToId, editMessageId) {
  var all = await listAllQuestions();
  var items = all.filter(function(q) { return questionState(q) === 'UNANSWERED' || (questionState(q) === 'DISMISSED' && !q.answer); })
    .sort(function(a, b) { return questionValueScore(b) - questionValueScore(a); })
    .slice(0, 6);
  if (!items.length) {
    await respondTelegram(chatId,
      cardTop('\uD83D\uDCE5 <b>SMART INBOX</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No priority items right now.\n' + BOX_V + ' Your AMA inbox is clean.\n' + BOX_V + '\n' + cardBottom,
      replyToId, inboxButtons(null), editMessageId);
    return;
  }
  var lines = [cardTop('\uD83D\uDCE5 <b>SMART INBOX</b>'), BOX_V, BOX_V + ' Priority questions to handle first.', BOX_V];
  items.forEach(function(q, i) {
    var st = questionState(q);
    var badge = st === 'UNANSWERED' ? '\u23F3' : '\uD83D\uDE48';
    lines.push(BOX_V + ' ' + badge + ' <b>' + (i + 1) + '.</b> ' + esc(visitorName(q.name)) + (q.pinned ? '  \uD83D\uDCCD' : ''));
    lines.push(BOX_V + '   \u201C' + esc(clipText(q.question, 100)) + '\u201D');
    lines.push(BOX_V + '   ID \u2500 <code>' + esc(q.id) + '</code>');
    lines.push(BOX_V);
  });
  lines.push(BOX_V + ' Use /get &lt;id&gt; or tap Answer.');
  lines.push(cardBottom);
  await respondTelegram(chatId, lines.join('\n'), replyToId, inboxButtons(items[0] && items[0].id), editMessageId);
}

async function sendTopics(chatId, replyToId, editMessageId) {
  var all = await ensureTopicsStored(await listAllQuestions());
  var topics = topTopics(all);
  var manualCount = all.filter(function(q) { return q.topic && q.topicManual; }).length;
  var autoCount = all.length - manualCount;
  var topics8 = topics.slice(0, 8);
  var maxCount = Math.max(topics8.length ? topics8[0].count : 0, 1);
  var lines = [cardTop('\uD83C\uDFF7 <b>AMA TOPICS</b>'), BOX_V, BOX_V + ' Manual \u2500 <b>' + manualCount + '</b>  \u00b7  Auto \u2500 <b>' + autoCount + '</b>', divider()];
  if (!topics8.length) {
    lines.push(BOX_V + ' No topic data yet.');
  } else {
    topics8.forEach(function(t, i) {
      var lbl = (i + 1) + '. ' + t.name;
      lbl = lbl.length > 16 ? lbl.slice(0, 15) + '\u2026' : lbl;
      lines.push(BOX_V + ' ' + padR(esc(lbl), 16) + bar(t.count, maxCount, 10) + '  <b>' + t.count + '</b>');
    });
  }
  lines.push(BOX_V);
  lines.push(BOX_V + ' Tap a topic to search deeper.');
  lines.push(cardBottom);
  await respondTelegram(chatId, lines.join('\n'), replyToId, topicsButtons(topics), editMessageId);
}

async function sendQuality(chatId, replyToId, editMessageId) {
  var all = await listAllQuestions();
  var answered = all.filter(function(q) { return questionState(q) === 'ANSWERED'; });
  var weak = answered.map(function(q) {
    var reasons = [];
    var len = String(q.answer || '').trim().length;
    if (len < 80) reasons.push('short answer');
    if (q.question.length > 120 && len < 180) reasons.push('detailed Q, brief A');
    if ((q.votes || 0) >= 3 && len < 220) reasons.push('popular but brief');
    return { q: q, reasons: reasons };
  }).filter(function(x) { return x.reasons.length; })
    .sort(function(a, b) { return (b.q.votes || 0) - (a.q.votes || 0); })
    .slice(0, 6);
  if (!weak.length) {
    await respondTelegram(chatId,
      cardTop('\uD83E\uDDEA <b>ANSWER QUALITY</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No weak answers detected.\n' + BOX_V + ' Published answers look healthy.\n' + BOX_V + '\n' + cardBottom,
      replyToId, qualityButtons(null), editMessageId);
    return;
  }
  var lines = [cardTop('\uD83E\uDDEA <b>ANSWER QUALITY</b>'), BOX_V, BOX_V + ' Answers worth improving:', BOX_V];
  weak.forEach(function(x, i) {
    lines.push(BOX_V + ' \u26A0\uFE0F <b>' + (i + 1) + '.</b> ' + esc(x.reasons.join(', ')));
    lines.push(BOX_V + '   \u201C' + esc(clipText(x.q.question, 92)) + '\u201D');
    lines.push(BOX_V + '   ID \u2500 <code>' + esc(x.q.id) + '</code>');
    lines.push(BOX_V);
  });
  lines.push(BOX_V + ' Use /edit &lt;id&gt; to improve.');
  lines.push(cardBottom);
  await respondTelegram(chatId, lines.join('\n'), replyToId, qualityButtons(weak[0] && weak[0].q && weak[0].q.id), editMessageId);
}

async function sendHealth(chatId, replyToId, editMessageId) {
  var okFirestore = false, count = 0, tokenOk = !!process.env.TELEGRAM_BOT_TOKEN;
  try { var all = await listAllQuestions(); okFirestore = true; count = all.length; } catch (e) {}
  var saOk = !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  var secretOk = !!process.env.TELEGRAM_WEBHOOK_SECRET;
  var chatIdOk = !!process.env.TELEGRAM_CHAT_ID;
  var overall = (tokenOk && saOk && okFirestore && secretOk && chatIdOk);
  var lines = [
    cardTop('\uD83E\uDE7A <b>BOT HEALTH</b>'),
    BOX_V,
    BOX_V + ' ' + (overall ? '\uD83D\uDFE2' : '\uD83D\uDD34') + ' Overall \u2500 <b>' + (overall ? 'Operational' : 'Issues detected') + '</b>',
    divider(),
    sectionLabel('\uD83D\uDD27', 'Checks'),
    checkRow(tokenOk, 'Telegram token'),
    checkRow(saOk, 'Firebase service account'),
    checkRow(okFirestore, 'Firestore connection'),
    checkRow(secretOk, 'Webhook secret'),
    checkRow(chatIdOk, 'Admin chat ID (access lock)'),
    divider(),
    kvRow('Questions', count),
    kvRow('Checked', formatTime(new Date().toISOString()) + ' IST'),
    BOX_V,
    cardBottom
  ];
  await sendLog('HEALTH CHECK', { Firestore: okFirestore ? 'OK' : 'ERROR', Questions: count }, '\uD83E\uDE7A');
  await respondTelegram(chatId, lines.join('\n'), replyToId, healthButtons(), editMessageId);
}

async function sendTopicInfo(chatId, questionId, replyToId, editMessageId) {
  var q = await getQuestion(questionId);
  if (!q) {
    await respondTelegram(chatId,
      cardTop('\u26A0\uFE0F <b>QUESTION NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No AMA entry exists for this ID.\n' + BOX_V + ' ID \u2500 <code>' + esc(questionId) + '</code>\n' + BOX_V + '\n' + cardBottom,
      replyToId, REPLY_KEYBOARD, editMessageId);
    return;
  }
  var autoTopic = autoTopicForQuestion(q);
  var activeTopic = resolvedTopic(q);
  var source = topicSource(q);
  var lines = [
    cardTop('\uD83C\uDFF7 <b>QUESTION TOPIC</b>'),
    BOX_V,
    BOX_V + ' Active \u2500 <b>' + esc(activeTopic) + '</b> (' + source + ')',
    BOX_V + ' Auto \u2500 <b>' + esc(autoTopic) + '</b>',
    BOX_V + ' Manual \u2500 <b>' + (q.topicManual ? esc(q.topic) : 'not set') + '</b>',
    BOX_V,
    BOX_V + ' ID \u2500 <code>' + esc(q.id) + '</code>',
    BOX_V + ' “' + esc(clipText(q.question, 130)) + '”',
    BOX_V,
    cardBottom
  ];
  await respondTelegram(chatId, lines.join('\n'), replyToId, topicInfoButtons(q.id), editMessageId);
}

async function sendFeatured(chatId, replyToId, editMessageId) {
  var all = await listAllQuestions();
  var spotlighted = all.filter(function(x) { return x.spotlight; })
    .sort(function(a, b) { return new Date(b.spotlightAt || b.answeredAt || 0) - new Date(a.spotlightAt || a.answeredAt || 0); });
  var q = spotlighted[0];
  if (!q) {
    await respondTelegram(chatId,
      cardTop('\uD83C\uDF1F <b>FEATURED AMA</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No spotlight question set.\n' + BOX_V + ' Use /spotlight &lt;id&gt; to feature one.\n' + BOX_V + '\n' + cardBottom,
      replyToId, featuredButtons(false), editMessageId);
    return;
  }
  var lines = [
    cardTop('\uD83C\uDF1F <b>FEATURED AMA</b>'),
    BOX_V,
    BOX_V + ' Visitor \u2500 <b>' + esc(visitorName(q.name)) + '</b>',
    BOX_V + ' ID \u2500 <code>' + esc(q.id) + '</code>',
    BOX_V,
    BOX_V + ' Q: “' + esc(clipText(q.question, 140)) + '”',
    q.answer ? BOX_V + ' A: “' + esc(clipText(q.answer, 180)) + '”' : BOX_V + ' No answer yet.',
    BOX_V,
    cardBottom
  ];
  await respondTelegram(chatId, lines.join('\n'), replyToId, featuredButtons(true), editMessageId);
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
      BOX_V + ' \uD83C\uDFF7 Topic \u2500 <b>' + esc(resolvedTopic(q)) + '</b> (' + topicSource(q) + ')',
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
        [{ text: '\uD83C\uDFF7 Topic Info', callback_data: 'topicof:' + q.id }],
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
      BOX_V + ' \uD83C\uDFF7 Topic \u2500 <b>' + esc(resolvedTopic(q)) + '</b> (' + topicSource(q) + ')',
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
        [{ text: '\uD83C\uDFF7 Topic Info', callback_data: 'topicof:' + q.id }],
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
    BOX_V + ' \uD83C\uDFF7 Topic \u2500 <b>' + esc(resolvedTopic(q)) + '</b> (' + topicSource(q) + ')',
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
      [{ text: '\uD83C\uDFF7 Topic Info', callback_data: 'topicof:' + q.id }],
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
    BOX_V + ' \uD83C\uDFF7 Topic \u2500 <b>' + esc(resolvedTopic(q)) + '</b> (' + topicSource(q) + ')',
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
  buttons.push([{ text: '\uD83C\uDFF7 Topic Info', callback_data: 'topicof:' + q.id }]);
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
           (q.name || '').toLowerCase().includes(query) ||
           resolvedTopic(q).toLowerCase().includes(query);
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
async function exportQuestions(chatId, replyToId, editMessageId, format) {
  var all = await listAllQuestions();
  if (!all.length) {
        await respondTelegram(chatId,
          cardTop('\uD83D\uDCE4 <b>EXPORT</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No questions to export.\n' + BOX_V + '\n' + cardBottom,
          replyToId, REPLY_KEYBOARD, editMessageId);
    return;
  }
  format = (format || 'text').toLowerCase();
  var sorted = all.sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
  var stamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
  var content;

  if (format === 'json') {
    var payload = sorted.map(function(q) {
      return { id: q.id, name: q.name, question: q.question, answer: q.answer || '', state: questionState(q), pinned: !!q.pinned, topic: resolvedTopic(q), votes: q.votes || 0, reactions: q.reactions || {}, createdAt: q.createdAt || '', answeredAt: q.answeredAt || '', editedAt: q.editedAt || '' };
    });
    content = JSON.stringify({ exportedAt: new Date().toISOString(), window: stamp, count: payload.length, questions: payload }, null, 2);
  } else if (format === 'csv') {
    var cell = function(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var rows = [['id','name','question','answer','state','pinned','topic','votes','createdAt','answeredAt'].join(',')];
    sorted.forEach(function(q) {
      rows.push([cell(q.id), cell(q.name), cell(q.question), cell(q.answer || ''), cell(questionState(q)), cell(q.pinned ? 'yes' : 'no'), cell(resolvedTopic(q)), cell(q.votes || 0), cell(q.createdAt || ''), cell(q.answeredAt || '')].join(','));
    });
    content = '# AMA Export \u2014 ' + stamp + '\n' + rows.join('\n');
  } else {
    var lines = ['\uD83D\uDCCB AMA EXPORT \u2014 ' + stamp, ''];
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
    content = lines.join('\n');
  }

  // Chunk + send (Telegram limit ~4096 chars/message).
  for (var ci = 0; ci < content.length; ci += 3800) {
    var chunk = content.slice(ci, ci + 3800);
    if (ci === 0 && editMessageId) await editMessage(chatId, editMessageId, '<pre>' + esc(chunk) + '</pre>');
    else await sendTelegram(chatId, '<pre>' + esc(chunk) + '</pre>', ci === 0 ? replyToId : undefined);
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
  return { inline_keyboard: [row, [exportEntryBtn()]] };
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
  return { inline_keyboard: [row, [exportEntryBtn()]] };
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
 J-FEATURE HELPERS (items 41–56)
 ============================================================ */

/* Compact card builder — cardTop + body lines + cardBottom. */
function infoCard(title, lines) {
  var body = (lines || []).map(function (l) { return BOX_V + (l ? ' ' + l : ''); }).join('\n');
  return cardTop(title) + '\n' + BOX_V + '\n' + body + '\n' + BOX_V + '\n' + cardBottom;
}

/* -- Undo (45): snapshot last destructive action per chat -- */
async function saveUndo(chatId, payload) {
  try {
    var serialized = JSON.stringify(payload);
    // Don't store a TRUNCATED payload — a cut-off JSON string fails to parse on
    // /undo and silently restores nothing. If it's too big to snapshot safely,
    // clear any stale undo and report that undo isn't available for this batch.
    if (serialized.length > 90000) { await clearUndo(chatId); return false; }
    await firestore('PATCH', docPath(UNDO_COLLECTION, String(chatId)), {
      fields: {
        chatId: { stringValue: String(chatId) },
        payload: { stringValue: serialized },
        createdAt: { stringValue: new Date().toISOString() }
      }
    });
    return true;
  } catch (e) { return false; }
}
async function getUndo(chatId) {
  try {
    var doc = await firestore('GET', docPath(UNDO_COLLECTION, String(chatId)));
    var raw = doc && doc.fields && doc.fields.payload && doc.fields.payload.stringValue;
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
async function clearUndo(chatId) {
  try { await firestore('DELETE', docPath(UNDO_COLLECTION, String(chatId))); } catch (e) {}
}
/* Fetch the raw Firestore fields object for a doc (for delete snapshots). */
async function getRawFields(id) {
  try { var doc = await firestore('GET', docPath(COLLECTION, id)); return (doc && doc.fields) || null; }
  catch (e) { return null; }
}
/* Recreate a deleted doc from a saved fields snapshot. */
async function recreateFromSnapshot(id, fields) {
  return firestore('PATCH', docPath(COLLECTION, id), { fields: fields });
}

/* -- Saved reply templates (52) -- */
function templateKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
async function saveTemplate(name, textVal) {
  var key = templateKey(name);
  if (!key) throw new Error('bad name');
  await firestore('PATCH', docPath(TEMPLATE_COLLECTION, key), {
    fields: { name: { stringValue: key }, text: { stringValue: String(textVal).slice(0, 1000) }, createdAt: { stringValue: new Date().toISOString() } }
  });
  return key;
}
async function getTemplate(name) {
  try {
    var doc = await firestore('GET', docPath(TEMPLATE_COLLECTION, templateKey(name)));
    return (doc && doc.fields && doc.fields.text && doc.fields.text.stringValue) || null;
  } catch (e) { return null; }
}
async function deleteTemplate(name) {
  try { await firestore('DELETE', docPath(TEMPLATE_COLLECTION, templateKey(name))); return true; } catch (e) { return false; }
}
async function listTemplates() {
  try {
    var url = 'https://firestore.googleapis.com/v1/projects/' + projectId() + '/databases/(default)/documents/' + TEMPLATE_COLLECTION + '?pageSize=100';
    var data = await firestore('GET', url);
    return ((data && data.documents) || []).map(function (d) {
      return { name: (d.fields && d.fields.name && d.fields.name.stringValue) || d.name.split('/').pop(), text: (d.fields && d.fields.text && d.fields.text.stringValue) || '' };
    });
  } catch (e) { return []; }
}

/* -- Draft / unpublish (54) + scheduled publish (56) -- */
async function saveDraftAnswer(id, answer, publishAt) {
  var fieldNames = ['draft', 'draftAnswer', 'draftAt', 'answered', 'dismissed', 'publishAt'];
  var fields = {
    draft: { booleanValue: true },
    draftAnswer: { stringValue: String(answer).slice(0, 1000) },
    draftAt: { stringValue: new Date().toISOString() },
    answered: { booleanValue: false },
    dismissed: { booleanValue: false },
    publishAt: { stringValue: publishAt || '' }
  };
  var result = await firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(fieldNames), { fields: fields });
  if (!_suppressItemLogs) await sendLog(publishAt ? 'ANSWER SCHEDULED' : 'ANSWER DRAFTED', { ID: id, Draft: clipText(answer, 120), When: publishAt || 'manual' }, '📝');
  return result;
}
/* Publish a stored draft to the public site. */
async function publishDraftAnswer(id) {
  var q = await getQuestion(id);
  if (!q) throw new Error('not found');
  var text = q.draftAnswer || q.answer;
  if (!text) throw new Error('no draft');
  await firestore('PATCH', docPath(COLLECTION, id) + '?' + mask(['answer', 'answered', 'answeredAt', 'dismissed', 'draft', 'draftAnswer', 'publishAt']), {
    fields: {
      answer: { stringValue: text.slice(0, 1000) },
      answered: { booleanValue: true },
      answeredAt: { stringValue: new Date().toISOString() },
      dismissed: { booleanValue: false },
      draft: { booleanValue: false },
      draftAnswer: { stringValue: '' },
      publishAt: { stringValue: '' }
    }
  });
  if (!_suppressItemLogs) await sendLog('DRAFT PUBLISHED', { ID: id, Answer: clipText(text, 120) }, '✅');
  return text;
}

/* -- AI helpers (41, 42) -- */
async function aiDraftAnswer(q) {
  var system = 'You are helping Yatin Sharma answer questions on his portfolio "Ask Me Anything". '
    + 'Write a concise, friendly, first-person answer (as Yatin) to the visitor\'s question. '
    + '1–3 short sentences, warm and genuine, no preamble, no sign-off. Output only the answer text.';
  var name = q.name && q.name !== 'Anonymous' ? q.name : 'a visitor';
  return ai.complete({ system: system, prompt: 'Question from ' + name + ': "' + q.question + '"', maxTokens: 400 });
}
async function aiTransform(kind, currentText, questionText) {
  var instr = kind === 'shorten' ? 'Rewrite this AMA answer to be noticeably shorter and punchier while keeping the meaning.'
    : kind === 'expand' ? 'Expand this AMA answer with a little more helpful detail and warmth, staying concise (max ~4 sentences).'
    : 'Improve this AMA answer: fix grammar, tighten wording, and make it clear and friendly. Keep the same meaning and length roughly.';
  var system = 'You edit short first-person answers for a developer\'s portfolio AMA. Output ONLY the revised answer text, no preamble or quotes.';
  var prompt = instr + (questionText ? '\n\nThe question was: "' + questionText + '"' : '') + '\n\nCurrent answer:\n' + currentText;
  return ai.complete({ system: system, prompt: prompt, maxTokens: 500 });
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
    _currentActor = actorFromUser((callback && callback.from) || (message && message.from) || {});

    /* -- INLINE BUTTON PRESS -- */
    if (callback) {
      var cbChatId = callback.message && callback.message.chat && callback.message.chat.id;
      var cbMessageId = callback.message && callback.message.message_id;
      var allowedChatId = String(process.env.TELEGRAM_CHAT_ID || '');
      // Fail CLOSED: with no TELEGRAM_CHAT_ID configured, deny everyone rather
      // than exposing every command to any user who reaches the bot.
      if (!allowedChatId || String(cbChatId) !== allowedChatId) {
        await answerCallback(callback.id, 'Private bot. Access denied.');
        await sendLog('UNAUTHORIZED CALLBACK', { Chat: cbChatId, Action: callback.data || 'unknown' }, '\uD83D\uDEAB', actorFromUser(callback.from));
        return res.status(200).json({ ok: true, denied: 'wrong chat' });
      }
      var data = callback.data || '';
      var parts = data.split(':');
      var action = parts[0];
      var questionId = parts.slice(1).join(':');
      await sendLog('BOT CALLBACK', { Action: action, Value: clipText(questionId, 80) }, '\uD83D\uDD18');

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
          var snapFields = await getRawFields(questionId);
          await deleteQuestion(questionId);
          if (snapFields) await saveUndo(cbChatId, { type: 'delete', items: [{ id: questionId, fields: snapFields }] });
          await answerCallback(callback.id, '\u2705 Deleted');
          await editMessage(cbChatId, cbMessageId,
            infoCard('\uD83D\uDDD1 <b>DELETED</b>', ['Question removed permanently.', '', '\u21A9\uFE0F /undo restores it.', '', '\uD83D\uDD50 ' + formatTime(new Date().toISOString()) + ' IST'])
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
      // 41/53. AI-draft an answer inline, then show the publish preview.
      else if (action === 'aidraft') {
        if (!ai.aiConfigured()) { await answerCallback(callback.id, '\uD83E\uDD16 Set GROQ_API_KEY to enable AI'); return res.status(200).json({ ok: true }); }
        await answerCallback(callback.id, '\uD83E\uDD16 Drafting\u2026');
        try {
          var q = await getQuestion(questionId);
          if (!q) { await sendTelegram(cbChatId, infoCard('\u26A0\uFE0F <b>NOT FOUND</b>', ['That question no longer exists.'])); return res.status(200).json({ ok: true }); }
          var aiText = (await aiDraftAnswer(q) || '').trim();
          if (!aiText) { await sendTelegram(cbChatId, infoCard('\u26A0\uFE0F <b>NO OUTPUT</b>', ['AI returned nothing. Try /draft ' + esc(questionId) + '.'])); return res.status(200).json({ ok: true }); }
          await clearAnswerSession(cbChatId); await clearEditSession(cbChatId);
          await savePreviewSession(cbChatId, questionId, aiText);
          await sendTelegram(cbChatId, answerPreviewCard(q, aiText, questionId), undefined, previewButtons());
        } catch (e) { await sendTelegram(cbChatId, infoCard('\u26A0\uFE0F <b>AI ERROR</b>', [esc(clipText(e.message || 'failed', 120))])); }
      }
      else if (action === 'dismiss') {
        try {
          await dismissQuestion(questionId);
          await saveUndo(cbChatId, { type: 'dismiss', items: [{ id: questionId }] });
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
          await sendLog('ANSWER PREVIEW REVISED', { ID: qid }, '\u270F\uFE0F');
          await answerCallback(callback.id, '\u270F\uFE0F Send your revised answer');
          await saveEditSession(cbChatId, qid);
          await sendTelegram(cbChatId,
            cardTop('\u270F\uFE0F <b>REVISE ANSWER</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Send the corrected answer for:\n' + BOX_V + ' \uD83C\uDD94 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + BOX_V + ' <i>Type your revised answer as\n' + BOX_V + ' your next message.</i>\n' + BOX_V + '\n' + cardBottom
          );
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not enter edit mode \u2014 use /edit id'); }
      }
      else if (action === 'previewcancel') {
        var cancelSession = await getPreviewSession(cbChatId);
        var cancelQid = cancelSession && cancelSession.fields && cancelSession.fields.questionId && cancelSession.fields.questionId.stringValue;
        await clearPreviewSession(cbChatId);
        await sendLog('ANSWER PREVIEW CANCELLED', { ID: cancelQid || 'unknown' }, '\u274C');
        await answerCallback(callback.id, 'Answer cancelled');
        await editMessage(cbChatId, cbMessageId,
          cardTop('\u274C <b>ANSWER CANCELLED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Your answer was not published.\n' + BOX_V + ' The question is unchanged.\n' + BOX_V + '\n' + cardBottom
        );
      }
      // 54. Save the previewed answer as a private draft (publish later).
      else if (action === 'previewdraft') {
        try {
          var session = await getPreviewSession(cbChatId);
          if (!session || !session.fields || isSessionExpired(session)) { await clearPreviewSession(cbChatId); await answerCallback(callback.id, '\u26A0\uFE0F Session expired'); return res.status(200).json({ ok: true }); }
          var qid = session.fields.questionId && session.fields.questionId.stringValue;
          var ansText = session.fields.answerText && session.fields.answerText.stringValue;
          if (!qid || !ansText) { await clearPreviewSession(cbChatId); await answerCallback(callback.id, '\u26A0\uFE0F Session data missing'); return res.status(200).json({ ok: true }); }
          await saveDraftAnswer(qid, ansText);
          await clearPreviewSession(cbChatId);
          await answerCallback(callback.id, '\uD83D\uDCDD Saved as draft');
          await editMessage(cbChatId, cbMessageId,
            infoCard('\uD83D\uDCDD <b>DRAFT SAVED</b>', ['Answer stored privately \u2014 not on the site yet.', '', '\uD83C\uDD94 <code>' + esc(qid) + '</code>', '/publish ' + esc(qid) + ' to go live', '/schedule ' + esc(qid) + ' +2h to auto-publish'])
          );
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not save draft'); }
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
          var undoItems = [];
          _suppressItemLogs = true;
          for (var di = 0; di < all.length; di++) {
            try {
              var snap = await getRawFields(all[di].id);
              await deleteQuestion(all[di].id);
              if (snap) undoItems.push({ id: all[di].id, fields: snap });
              deleted++;
            } catch (e) {}
          }
          _suppressItemLogs = false;
          var undoSavedCb = undoItems.length ? await saveUndo(cbChatId, { type: 'delete', items: undoItems }) : false;
          await sendLog('BULK DELETE ALL', { Requested: count, Deleted: deleted, Undo: undoSavedCb ? 'yes' : 'no' }, '\uD83D\uDDD1');
          await editMessage(cbChatId, cbMessageId,
            cardTop('\u2705 <b>ALL DELETED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Successfully deleted <b>' + deleted + '</b> question' + (deleted === 1 ? '' : 's') + '.\n' + BOX_V + '\n' + BOX_V + ' ' + (undoSavedCb ? '\u21A9\uFE0F /undo restores the whole batch.' : '\u26A0\uFE0F Batch too large to snapshot \u2014 /undo can\u2019t restore this one.') + '\n' + BOX_V + '\n' + BOX_V + ' \uD83D\uDD50 ' + formatTime(new Date().toISOString()) + ' IST\n' + BOX_V + '\n' + cardBottom
          );
        } catch (e) { _suppressItemLogs = false; await answerCallback(callback.id, '\u26A0\uFE0F Delete all failed'); }
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
          _suppressItemLogs = true;
          for (var ri = 0; ri < dismissed.length; ri++) {
            var hasA = dismissed[ri].answer && String(dismissed[ri].answer).trim().length > 0;
            if (hasA) toSite++; else toPending++;
            await retrieveQuestion(dismissed[ri].id);
          }
          _suppressItemLogs = false;
          await answerCallback(callback.id, '\u21A9\uFE0F All retrieved!');
          var detailLines = BOX_V + ' All dismissed questions restored.\n';
          if (toPending > 0) detailLines += BOX_V + ' \u23F3 <b>' + toPending + '</b> \u2192 pending queue\n';
          if (toSite > 0) detailLines += BOX_V + ' \u2705 <b>' + toSite + '</b> \u2192 back on site (with answers)\n';
          await sendLog('BULK RETRIEVE ALL', { ToSite: toSite, ToPending: toPending }, '\u21A9\uFE0F');
          await editMessage(cbChatId, cbMessageId,
            cardTop('\u2705 <b>ALL RETRIEVED</b>') + '\n' + BOX_V + '\n' + detailLines + BOX_V + '\n' + BOX_V + ' \uD83D\uDD50 ' + formatTime(new Date().toISOString()) + ' IST\n' + BOX_V + '\n' + cardBottom
          );
        } catch (e) { _suppressItemLogs = false; await answerCallback(callback.id, '\u26A0\uFE0F Retrieve all failed'); }
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
          _suppressItemLogs = true;
          for (var di = 0; di < active.length; di++) {
            var st = questionState(active[di]);
            if (st === 'ANSWERED') answeredCount++; else unansweredCount++;
            try {
              await dismissQuestion(active[di].id);
              dismissedCount++;
            } catch (e) {}
          }
          _suppressItemLogs = false;
          await answerCallback(callback.id, '\uD83D\uDE48 All dismissed!');
          var detailLines = BOX_V + ' Successfully dismissed <b>' + dismissedCount + '</b> question' + (dismissedCount === 1 ? '' : 's') + '.\n';
          if (answeredCount > 0) detailLines += BOX_V + ' \u2705 <b>' + answeredCount + '</b> answered \u2192 hidden (retrieve \u2192 back on site)\n';
          if (unansweredCount > 0) detailLines += BOX_V + ' \u23F3 <b>' + unansweredCount + '</b> unanswered \u2192 hidden (retrieve \u2192 back to pending)\n';
          detailLines += BOX_V + '\n' + BOX_V + ' Use /retrieveall or /retrieve &lt;id&gt;\n';
          detailLines += BOX_V + ' to restore any question.\n';
          await sendLog('BULK DISMISS ALL', { Dismissed: dismissedCount, Answered: answeredCount, Unanswered: unansweredCount }, '\uD83D\uDE48');
          await editMessage(cbChatId, cbMessageId,
            cardTop('\uD83D\uDE48 <b>ALL DISMISSED</b>') + '\n' + BOX_V + '\n' + detailLines + BOX_V + '\n' + BOX_V + ' \uD83D\uDD50 ' + formatTime(new Date().toISOString()) + ' IST\n' + BOX_V + '\n' + cardBottom
          );
          return res.status(200).json({ ok: true, callback: 'confirmdismissall' });
        } catch (e) {
          _suppressItemLogs = false;
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
      else if (action === 'cmd') {
        try {
          await answerCallback(callback.id, 'Loading ' + questionId + '…');
          if (questionId === 'digest') await sendDigest(cbChatId, undefined, cbMessageId);
          else if (questionId === 'inbox') await sendSmartInbox(cbChatId, undefined, cbMessageId);
          else if (questionId === 'topics') await sendTopics(cbChatId, undefined, cbMessageId);
          else if (questionId === 'quality') await sendQuality(cbChatId, undefined, cbMessageId);
          else if (questionId === 'health') await sendHealth(cbChatId, undefined, cbMessageId);
          else if (questionId === 'featured') await sendFeatured(cbChatId, undefined, cbMessageId);
          else if (questionId === 'stats') await sendStats(cbChatId, undefined, cbMessageId);
          else if (questionId === 'recent') await sendRecent(cbChatId, undefined, cbMessageId);
          else if (questionId === 'all') {
            var all = await listAllQuestions();
            var sorted = all.slice().sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
            var result = buildAllPageText(sorted, 1);
            await editMessage(cbChatId, cbMessageId, result.text, buildAllPageButtons(result.page, result.pages));
          }
          else if (questionId === 'pending') {
            var all = await listAllQuestions();
            var items = all.filter(function(q) { return questionState(q) === 'UNANSWERED'; }).sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
            var result = buildQueuePageText(items, 1, '\u23F3 <b>PENDING INBOX</b>', 'Tap Answer or reply to a card.');
            await editMessage(cbChatId, cbMessageId, result.text, buildQueuePageButtons('pending', result.page, result.pages));
          }
          else if (questionId === 'refresh') {
            var all = await listAllQuestions();
            var items = all.filter(function(q) { return questionState(q) === 'UNANSWERED' || questionState(q) === 'DISMISSED'; }).sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
            var result = buildQueuePageText(items, 1, '\uD83D\uDD04 <b>ATTENTION QUEUE</b>', 'Pending + hidden questions.');
            await editMessage(cbChatId, cbMessageId, result.text, buildQueuePageButtons('refresh', result.page, result.pages));
          }
          else if (questionId === 'dismissed') {
            var all = await listAllQuestions();
            var dismissed = all.filter(function(q) { return questionState(q) === 'DISMISSED'; }).sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
            var result = buildDismissedPageText(dismissed, 1);
            await editMessage(cbChatId, cbMessageId, result.text, buildDismissedPageButtons(result.page, result.pages));
          }
          else if (questionId === 'pinned') {
            var all = await listAllQuestions();
            var pinned = all.filter(function(q) { return q.pinned && questionState(q) !== 'DISMISSED'; }).sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
            if (!pinned.length) await editMessage(cbChatId, cbMessageId, cardTop('\uD83D\uDCCD <b>NO PINNED QUESTIONS</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Nothing is pinned right now.\n' + BOX_V + '\n' + cardBottom, statsButtons());
            else { var lines = [cardTop('\uD83D\uDCCD <b>PINNED QUESTIONS</b>'), BOX_V]; pinned.slice(0, 6).forEach(function(q, i) { lines.push(BOX_V + ' ' + (i + 1) + '. <b>' + esc(visitorName(q.name)) + '</b>'); lines.push(BOX_V + ' “' + esc(clipText(q.question, 110)) + '”'); lines.push(BOX_V + ' ID: <code>' + esc(q.id) + '</code>'); lines.push(BOX_V); }); lines.push(cardBottom); await editMessage(cbChatId, cbMessageId, lines.join('\n'), statsButtons()); }
          }
          else if (questionId === 'help') {
            await editMessage(cbChatId, cbMessageId, HELP_TEXT);
          }
          else if (questionId === 'retopics') {
            var all = await listAllQuestions();
            var changed = 0;
            for (var ri = 0; ri < all.length; ri++) {
              if (all[ri].topicManual) continue;
              var t = autoTopicForQuestion(all[ri]);
              try { await setAutoQuestionTopic(all[ri].id, t); changed++; } catch (e) {}
            }
            await sendLog('TOPICS RECOMPUTED', { Updated: changed, PreservedManual: 'manual preserved' }, '\uD83D\uDD04');
            await editMessage(cbChatId, cbMessageId, cardTop('\uD83D\uDD04 <b>AUTO TOPICS UPDATED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Recomputed <b>' + changed + '</b> auto topic' + (changed === 1 ? '' : 's') + '.\n' + BOX_V + ' Manual topics were preserved.\n' + BOX_V + '\n' + cardBottom, topicsButtons(topTopics(await listAllQuestions())));
          }
          else if (questionId === 'unspotlight') {
            var all = await listAllQuestions();
            var spotlighted = all.filter(function(x) { return x.spotlight; });
            var q = spotlighted.sort(function(a, b) { return new Date(b.spotlightAt || b.answeredAt || 0) - new Date(a.spotlightAt || a.answeredAt || 0); })[0];
            if (!q) await editMessage(cbChatId, cbMessageId, cardTop('\uD83C\uDF1F <b>NO SPOTLIGHT SET</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No AMA is currently featured.\n' + BOX_V + '\n' + cardBottom, featuredButtons(false));
            else { for (var si = 0; si < spotlighted.length; si++) { try { await clearSpotlightQuestion(spotlighted[si].id); } catch (e) {} } await editMessage(cbChatId, cbMessageId, cardTop('\uD83C\uDF1F <b>SPOTLIGHT CLEARED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Featured AMA has been removed.\n' + BOX_V + '\n' + BOX_V + ' Previous ID \u2500 <code>' + esc(q.id) + '</code>\n' + BOX_V + '\n' + cardBottom, unspotlightButtons()); }
          }
          else await answerCallback(callback.id, 'Unknown command button');
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not load command'); }
      }
      else if (action === 'get') {
        try { await answerCallback(callback.id, 'Opening…'); await sendFullDetailCard(cbChatId, questionId, undefined, cbMessageId); }
        catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not open'); }
      }
      else if (action === 'search') {
        try { await answerCallback(callback.id, 'Searching…'); await searchQuestions(cbChatId, questionId, undefined, cbMessageId); }
        catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Search failed'); }
      }
      else if (action === 'topicof') {
        try { await answerCallback(callback.id, 'Topic info'); await sendTopicInfo(cbChatId, questionId, undefined, cbMessageId); }
        catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not load topic'); }
      }
      else if (action === 'retopic') {
        try {
          await answerCallback(callback.id, 'Recomputing topic…');
          var q = await getQuestion(questionId);
          if (!q) await editMessage(cbChatId, cbMessageId, cardTop('\u26A0\uFE0F <b>QUESTION NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question exists for this ID.\n' + BOX_V + '\n' + cardBottom);
          else {
            var t = autoTopicForQuestion(q);
            await setAutoQuestionTopic(questionId, t);
            await sendLog('TOPIC RECOMPUTED', { ID: questionId, Topic: t, Source: 'auto' }, '\uD83D\uDD04');
            q.topic = t; q.topicManual = false;
            await sendTopicInfo(cbChatId, questionId, undefined, cbMessageId);
          }
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not recompute topic'); }
      }
      else if (action === 'cleartopic') {
        try {
          await answerCallback(callback.id, 'Clearing topic…');
          var q = await getQuestion(questionId);
          if (!q) { await editMessage(cbChatId, cbMessageId, cardTop('\u26A0\uFE0F <b>QUESTION NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question exists for this ID.\n' + BOX_V + '\n' + cardBottom); }
          else {
            var oldTopic = q.topic || '—';
            await clearQuestionTopic(questionId);
            q.topic = autoTopicForQuestion(q); q.topicManual = false;
            await setAutoQuestionTopic(questionId, q.topic);
            await sendLog('TOPIC CLEARED', { ID: questionId, Previous: oldTopic, AutoTopic: q.topic }, '\uD83E\uDDF9');
            await editMessage(cbChatId, cbMessageId,
              cardTop('\uD83E\uDDF9 <b>TOPIC CLEARED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Manual topic removed.\n' + BOX_V + ' Auto topic is now active.\n' + BOX_V + '\n' + BOX_V + ' Topic \u2500 <b>' + esc(q.topic) + '</b>\n' + BOX_V + ' ID \u2500 <code>' + esc(questionId) + '</code>\n' + BOX_V + '\n' + cardBottom,
              navMarkup([[getBtn('\uD83D\uDCCB Open Question', questionId)], [cmdBtn('\uD83C\uDFF7 Topics', 'topics')]]));
          }
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not clear topic'); }
      }
      else if (action === 'featured') {
        try {
          await answerCallback(callback.id, 'Featured AMA');
          await sendFeatured(cbChatId, undefined, cbMessageId);
        } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Could not load featured'); }
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
      else if (action === 'export') {
        var ef = questionId;
        if (ef === 'text' || ef === 'json' || ef === 'csv') {
          await answerCallback(callback.id, 'Exporting ' + ef + '\u2026');
          try {
            await editMessage(cbChatId, cbMessageId, loadingCard('\uD83D\uDCE6 <b>EXPORTING\u2026</b>', 'Preparing ' + ef + ' export...'));
            await exportQuestions(cbChatId, undefined, cbMessageId, ef);
          } catch (e) { await answerCallback(callback.id, '\u26A0\uFE0F Export failed'); }
        } else {
          await answerCallback(callback.id, 'Export menu');
          await editMessage(cbChatId, cbMessageId, exportMenuCard(), exportButtons());
        }
      }
      else {
        await answerCallback(callback.id, 'Unknown action');
      }
      return res.status(200).json({ ok: true, callback: action });
    }

    /* -- TEXT MESSAGE -- */
    if (!message) return res.status(200).json({ ok: true, ignored: 'no message' });

    var chatId = message.chat && message.chat.id;
    var text = String((message.text || message.caption) || '').trim();
    if (!text) return res.status(200).json({ ok: true, ignored: 'empty' });
    var command = text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, '');

    var allowedChatId = String(process.env.TELEGRAM_CHAT_ID || '');
    // Fail CLOSED: no TELEGRAM_CHAT_ID configured => deny all (never open the bot up).
    if (!allowedChatId || String(chatId) !== allowedChatId) {
      var denialKind = command === '/start' ? 'start' : (text.startsWith('/') ? 'command' : 'message');
      await sendUnauthorizedNotice(chatId, message.from, message.message_id, denialKind, command);
      await sendLog('UNAUTHORIZED ' + denialKind.toUpperCase(), { Chat: chatId, Attempt: clipText(text, 120) }, '\uD83D\uDEAB', actorFromUser(message.from));
      return res.status(200).json({ ok: true, denied: 'wrong chat' });
    }

    /* Keyboard shortcut handling */
    if (text === '\uD83D\uDCE5 Inbox') { command = '/inbox'; }
    else if (text === '\uD83D\uDDDE Digest') { command = '/digest'; }
    else if (text === '\uD83D\uDCCB Pending') { /* fall through to /pending */ }
    else if (text === '\uD83D\uDCCA Stats') { /* fall through to /stats */ }
    else if (text === '\uD83D\uDD50 Recent') { /* fall through to /recent */ }
    else if (text === '\uD83C\uDF1F Featured') { command = '/featured'; }
    else if (text === '\uD83E\uDE7A Health') { command = '/health'; }
    else if (text === '\uD83D\uDCD6 Help') { /* fall through to /help */ }
    else if (text === '\uD83D\uDDC2 Queue') { command = '/queue'; }
    else if (text === '\uD83D\uDCDD Drafts') { command = '/drafts'; }
    else if (text === '\uD83D\uDCC8 Trends') { command = '/trends'; }
    else if (text === '\uD83D\uDD0D Search') {
      await sendLog('BOT COMMAND', { Command: '/search', Text: 'Search keyboard button' }, '\uD83E\uDD16');
      await sendTelegram(chatId,
        cardTop('\uD83D\uDD0D <b>SEARCH</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Type your search like:\n' + BOX_V + ' /search react\n' + BOX_V + ' /search healthcare\n' + BOX_V + ' /search anonymous\n' + BOX_V + '\n' + cardBottom,
        message.message_id, REPLY_KEYBOARD);
      return res.status(200).json({ ok: true });
    }

    var logCommand = command;
    if (text === '\uD83D\uDCE5 Inbox') logCommand = '/inbox';
    else if (text === '\uD83D\uDDDE Digest') logCommand = '/digest';
    else if (text === '\uD83D\uDCCB Pending') logCommand = '/pending';
    else if (text === '\uD83D\uDCCA Stats') logCommand = '/stats';
    else if (text === '\uD83D\uDD50 Recent') logCommand = '/recent';
    else if (text === '\uD83C\uDF1F Featured') logCommand = '/featured';
    else if (text === '\uD83E\uDE7A Health') logCommand = '/health';
    else if (text === '\uD83D\uDCD6 Help') logCommand = '/help';
    await sendLog('BOT COMMAND', { Command: logCommand, Text: clipText(text, 80) }, '\uD83E\uDD16');

    /* /start */
    if (command === '/start') {
      var welcomeText = await buildWelcomeText();
      await sendTelegram(chatId, welcomeText, message.message_id, REPLY_KEYBOARD);
      return res.status(200).json({ ok: true });
    }

    /* /help */
    if (command === '/help' || text === '📖 Help') {
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
      var fmt = (text.split(/\s+/)[1] || '').toLowerCase();
      if (fmt === 'text' || fmt === 'json' || fmt === 'csv') {
        var loadingId = await sendLoadingCard(chatId, '\uD83D\uDCE6 <b>EXPORTING\u2026</b>', 'Preparing ' + fmt + ' export...', message.message_id);
        await exportQuestions(chatId, message.message_id, loadingId, fmt);
      } else {
        await sendTelegram(chatId, exportMenuCard(), message.message_id, exportButtons());
      }
      return res.status(200).json({ ok: true });
    }

    /* /digest */
    if (command === '/digest') {
      var loadingId = await sendLoadingCard(chatId, '\uD83D\uDDDE <b>BUILDING DIGEST\u2026</b>', 'Summarizing recent AMA activity...', message.message_id);
      await sendDigest(chatId, message.message_id, loadingId);
      return res.status(200).json({ ok: true });
    }

    /* /inbox */
    if (command === '/inbox') {
      var loadingId = await sendLoadingCard(chatId, '\uD83D\uDCE5 <b>BUILDING INBOX\u2026</b>', 'Ranking questions by priority...', message.message_id);
      await sendSmartInbox(chatId, message.message_id, loadingId);
      return res.status(200).json({ ok: true });
    }

    /* /topics */
    if (command === '/topics') {
      var loadingId = await sendLoadingCard(chatId, '\uD83C\uDFF7 <b>SCANNING TOPICS\u2026</b>', 'Grouping questions by theme...', message.message_id);
      await sendTopics(chatId, message.message_id, loadingId);
      return res.status(200).json({ ok: true });
    }

    /* /quality */
    if (command === '/quality') {
      var loadingId = await sendLoadingCard(chatId, '\uD83E\uDDEA <b>CHECKING QUALITY\u2026</b>', 'Finding answers worth improving...', message.message_id);
      await sendQuality(chatId, message.message_id, loadingId);
      return res.status(200).json({ ok: true });
    }

    /* /health */
    if (command === '/health') {
      var loadingId = await sendLoadingCard(chatId, '\uD83E\uDE7A <b>CHECKING HEALTH\u2026</b>', 'Testing bot and Firestore status...', message.message_id);
      await sendHealth(chatId, message.message_id, loadingId);
      return res.status(200).json({ ok: true });
    }

    /* /featured */
    if (command === '/featured') {
      var loadingId = await sendLoadingCard(chatId, '\uD83C\uDF1F <b>LOADING FEATURED\u2026</b>', 'Checking current spotlight AMA...', message.message_id);
      await sendFeatured(chatId, message.message_id, loadingId);
      return res.status(200).json({ ok: true });
    }

    /* /spotlight <id> */
    if (command === '/spotlight') {
      var qid = text.split(/\s+/)[1];
      if (!qid) {
        await sendTelegram(chatId,
          cardTop('\uD83C\uDF1F <b>SPOTLIGHT</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Feature one answered AMA.\n' + BOX_V + '\n' + BOX_V + ' Usage: /spotlight &lt;id&gt;\n' + BOX_V + ' Check current: /featured\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      var loadingId = await sendLoadingCard(chatId, '\uD83C\uDF1F <b>SETTING SPOTLIGHT\u2026</b>', 'Preparing featured AMA card...', message.message_id);
      try {
        var q = await getQuestion(qid);
        if (!q) {
          await respondTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question exists for this ID.\n' + BOX_V + ' ID \u2500 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD, loadingId);
          return res.status(200).json({ ok: true });
        }
        if (questionState(q) !== 'ANSWERED') {
          await respondTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>CANNOT SPOTLIGHT</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Spotlight works best with answered\n' + BOX_V + ' public questions only.\n' + BOX_V + '\n' + BOX_V + ' Status \u2500 <b>' + questionState(q) + '</b>\n' + BOX_V + ' ID \u2500 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD, loadingId);
          return res.status(200).json({ ok: true });
        }
        await setSpotlightQuestion(qid);
        q.spotlight = true;
        await respondTelegram(chatId,
          cardTop('\uD83C\uDF1F <b>SPOTLIGHT SET</b>') + '\n' + BOX_V + '\n' + BOX_V + ' This AMA is now featured.\n' + BOX_V + '\n' + BOX_V + ' Visitor \u2500 <b>' + esc(visitorName(q.name)) + '</b>\n' + BOX_V + ' ID \u2500 <code>' + esc(q.id) + '</code>\n' + BOX_V + '\n' + BOX_V + ' “' + esc(clipText(q.question, 130)) + '”\n' + BOX_V + '\n' + cardBottom,
          message.message_id,
          spotlightSuccessButtons(),
          loadingId);
      } catch (e) {
        await respondTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>SPOTLIGHT FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not set spotlight.\n' + BOX_V + ' Try again in a moment.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
      }
      return res.status(200).json({ ok: true });
    }

    /* /unspotlight */
    if (command === '/unspotlight') {
      var loadingId = await sendLoadingCard(chatId, '\uD83C\uDF1F <b>CLEARING SPOTLIGHT\u2026</b>', 'Removing featured AMA selection...', message.message_id);
      try {
        var all = await listAllQuestions();
        var spotlighted = all.filter(function(x) { return x.spotlight; });
        var q = spotlighted.sort(function(a, b) { return new Date(b.spotlightAt || b.answeredAt || 0) - new Date(a.spotlightAt || a.answeredAt || 0); })[0];
        if (!q) {
          await respondTelegram(chatId,
            cardTop('\uD83C\uDF1F <b>NO SPOTLIGHT SET</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No AMA is currently featured.\n' + BOX_V + ' Use /spotlight &lt;id&gt; to set one.\n' + BOX_V + '\n' + cardBottom,
            message.message_id, featuredButtons(false), loadingId);
          return res.status(200).json({ ok: true });
        }
        for (var si = 0; si < spotlighted.length; si++) { try { await clearSpotlightQuestion(spotlighted[si].id); } catch (e) {} }
        await respondTelegram(chatId,
          cardTop('\uD83C\uDF1F <b>SPOTLIGHT CLEARED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Featured AMA has been removed.\n' + BOX_V + '\n' + BOX_V + ' Previous featured ID \u2500 <code>' + esc(q.id) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id, unspotlightButtons(), loadingId);
      } catch (e) {
        await respondTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>CLEAR FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not clear spotlight.\n' + BOX_V + ' Try again in a moment.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
      }
      return res.status(200).json({ ok: true });
    }

    /* /topic <id> <topic> */
    if (command === '/topic') {
      var parts = text.split(/\s+/);
      var qid = parts[1];
      var topicText = parts.slice(2).join(' ').trim();
      if (!qid || !topicText) {
        await sendTelegram(chatId,
          cardTop('\uD83C\uDFF7 <b>SET TOPIC</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Assign a manual topic.\n' + BOX_V + '\n' + BOX_V + ' Usage: /topic &lt;id&gt; &lt;topic&gt;\n' + BOX_V + ' Example: /topic abc123 React\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      var loadingId = await sendLoadingCard(chatId, '\uD83C\uDFF7 <b>SETTING TOPIC\u2026</b>', 'Saving manual topic to Firestore...', message.message_id);
      try {
        var q = await getQuestion(qid);
        if (!q) {
          await respondTelegram(chatId,
            cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question exists for this ID.\n' + BOX_V + ' ID \u2500 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
            message.message_id, REPLY_KEYBOARD, loadingId);
          return res.status(200).json({ ok: true });
        }
        var topic = normalizeTopic(topicText);
        await setQuestionTopic(qid, topic, q.topic || '—');
        await respondTelegram(chatId,
          cardTop('\uD83C\uDFF7 <b>TOPIC SET</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Manual topic saved.\n' + BOX_V + '\n' + BOX_V + ' Topic \u2500 <b>' + esc(topic) + '</b>\n' + BOX_V + ' Auto suggestion \u2500 <b>' + esc(autoTopicForQuestion(q)) + '</b>\n' + BOX_V + ' ID \u2500 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id,
          navMarkup([[getBtn('\uD83D\uDCCB Open Question', qid)], [{ text: '\uD83E\uDDF9 Clear Topic', callback_data: 'cleartopic:' + qid }], [cmdBtn('\uD83C\uDFF7 Topics', 'topics')]]),
          loadingId);
      } catch (e) {
        await respondTelegram(chatId,
          cardTop('\u26A0\uFE0F <b>TOPIC FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not save topic.\n' + BOX_V + ' Try again in a moment.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD, loadingId);
      }
      return res.status(200).json({ ok: true });
    }

    /* /topicof <id> */
    if (command === '/topicof') {
      var qid = text.split(/\s+/)[1];
      if (!qid) {
        await sendTelegram(chatId,
          cardTop('\uD83C\uDFF7 <b>TOPIC INFO</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Usage: /topicof &lt;id&gt;\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      var loadingId = await sendLoadingCard(chatId, '\uD83C\uDFF7 <b>LOADING TOPIC\u2026</b>', 'Checking manual and auto topics...', message.message_id);
      await sendTopicInfo(chatId, qid, message.message_id, loadingId);
      return res.status(200).json({ ok: true });
    }

    /* /cleartopic <id> */
    if (command === '/cleartopic') {
      var qid = text.split(/\s+/)[1];
      if (!qid) {
        await sendTelegram(chatId,
          cardTop('\uD83E\uDDF9 <b>CLEAR TOPIC</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Usage: /cleartopic &lt;id&gt;\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      var loadingId = await sendLoadingCard(chatId, '\uD83E\uDDF9 <b>CLEARING TOPIC\u2026</b>', 'Returning question to auto topic...', message.message_id);
      try {
        var q = await getQuestion(qid);
        if (!q) {
          await respondTelegram(chatId, cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question exists for this ID.\n' + BOX_V + '\n' + cardBottom, message.message_id, REPLY_KEYBOARD, loadingId);
          return res.status(200).json({ ok: true });
        }
        var oldTopic = q.topic || '—';
        var autoT = autoTopicForQuestion(q);
        await setAutoQuestionTopic(qid, autoT);
        await sendLog('TOPIC CLEARED', { ID: qid, Previous: oldTopic, AutoTopic: autoT }, '\uD83E\uDDF9');
        await respondTelegram(chatId,
          cardTop('\uD83E\uDDF9 <b>TOPIC CLEARED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Manual topic removed.\n' + BOX_V + ' Auto topic is active.\n' + BOX_V + '\n' + BOX_V + ' Topic \u2500 <b>' + esc(autoT) + '</b>\n' + BOX_V + ' ID \u2500 <code>' + esc(qid) + '</code>\n' + BOX_V + '\n' + cardBottom,
          message.message_id,
          navMarkup([[getBtn('\uD83D\uDCCB Open Question', qid)], [cmdBtn('\uD83C\uDFF7 Topics', 'topics')]]),
          loadingId);
      } catch (e) {
        await respondTelegram(chatId, cardTop('\u26A0\uFE0F <b>CLEAR FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not clear topic.\n' + BOX_V + '\n' + cardBottom, message.message_id, REPLY_KEYBOARD, loadingId);
      }
      return res.status(200).json({ ok: true });
    }

    /* /retopic <id> */
    if (command === '/retopic') {
      var qid = text.split(/\s+/)[1];
      if (!qid) {
        await sendTelegram(chatId,
          cardTop('\uD83D\uDD04 <b>RECOMPUTE TOPIC</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Recompute automatic topic.\n' + BOX_V + '\n' + BOX_V + ' Usage: /retopic &lt;id&gt;\n' + BOX_V + '\n' + cardBottom,
          message.message_id, REPLY_KEYBOARD);
        return res.status(200).json({ ok: true });
      }
      var loadingId = await sendLoadingCard(chatId, '\uD83D\uDD04 <b>RECOMPUTING TOPIC\u2026</b>', 'Analyzing important words...', message.message_id);
      try {
        var q = await getQuestion(qid);
        if (!q) {
          await respondTelegram(chatId, cardTop('\u26A0\uFE0F <b>NOT FOUND</b>') + '\n' + BOX_V + '\n' + BOX_V + ' No question exists for this ID.\n' + BOX_V + '\n' + cardBottom, message.message_id, REPLY_KEYBOARD, loadingId);
          return res.status(200).json({ ok: true });
        }
        var topic = autoTopicForQuestion(q);
        await setAutoQuestionTopic(qid, topic);
        await sendLog('TOPIC RECOMPUTED', { ID: qid, Topic: topic, Source: 'auto' }, '\uD83D\uDD04');
        q.topic = topic; q.topicManual = false;
        await sendTopicInfo(chatId, qid, message.message_id, loadingId);
      } catch (e) {
        await respondTelegram(chatId, cardTop('\u26A0\uFE0F <b>RETOPIC FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not recompute topic.\n' + BOX_V + '\n' + cardBottom, message.message_id, REPLY_KEYBOARD, loadingId);
      }
      return res.status(200).json({ ok: true });
    }

    /* /retopics */
    if (command === '/retopics') {
      var loadingId = await sendLoadingCard(chatId, '\uD83D\uDD04 <b>RECOMPUTING TOPICS\u2026</b>', 'Updating every automatic topic...', message.message_id);
      try {
        var all = await listAllQuestions();
        var changed = 0, skipped = 0;
        for (var ri = 0; ri < all.length; ri++) {
          if (all[ri].topicManual) { skipped++; continue; }
          var topic = autoTopicForQuestion(all[ri]);
          try { await setAutoQuestionTopic(all[ri].id, topic); changed++; } catch (e) {}
        }
        await sendLog('TOPICS RECOMPUTED', { Updated: changed, PreservedManual: skipped }, '\uD83D\uDD04');
        await respondTelegram(chatId,
          cardTop('\uD83D\uDD04 <b>AUTO TOPICS UPDATED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Recomputed <b>' + changed + '</b> question' + (changed === 1 ? '' : 's') + '.\n' + BOX_V + ' Preserved <b>' + skipped + '</b> manual topic' + (skipped === 1 ? '' : 's') + '.\n' + BOX_V + '\n' + cardBottom,
          message.message_id, topicsButtons(topTopics(await listAllQuestions())), loadingId);
      } catch (e) {
        await respondTelegram(chatId, cardTop('\u26A0\uFE0F <b>RETOPICS FAILED</b>') + '\n' + BOX_V + '\n' + BOX_V + ' Could not recompute topics.\n' + BOX_V + '\n' + cardBottom, message.message_id, REPLY_KEYBOARD, loadingId);
      }
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
      var PIN_CAP = 8;                       // keep the card under Telegram's 4096-char limit
      var pinnedShown = pinned.slice(0, PIN_CAP);
      var lines = [
        cardTop('\uD83D\uDCCD <b>PINNED QUESTIONS</b> (' + pinned.length + ')'),
        BOX_V
      ];
      for (var idx = 0; idx < pinnedShown.length; idx++) {
        var q = pinnedShown[idx];
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
      if (pinned.length > PIN_CAP) {
        lines.push(BOX_V + ' … and ' + (pinned.length - PIN_CAP) + ' more (showing ' + PIN_CAP + ')');
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
      // 46. Typed-token confirmation \u2014 safer than a single tap.
      try {
        await firestore('PATCH', docPath(DELETEALL_CONFIRM_COLLECTION, String(chatId)), {
          fields: { chatId: { stringValue: String(chatId) }, count: { integerValue: String(count) }, createdAt: { stringValue: new Date().toISOString() } }
        });
      } catch (e) {}
      await respondTelegram(chatId,
        infoCard('\u26A0\uFE0F <b>DELETE ALL?</b>', [
          'This permanently deletes <b>' + count + '</b> question' + (count === 1 ? '' : 's') + '.',
          '',
          'To confirm, reply with exactly:',
          '<code>' + DELETEALL_TOKEN + '</code>',
          '',
          'Anything else cancels. /undo can restore',
          'the batch right after.'
        ]),
        message.message_id, REPLY_KEYBOARD, loadingId);
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


    /* 46. Delete-all typed-token confirmation (intercept before other sessions) */
    if (!text.startsWith('/')) {
      var daConfirm = null;
      try { daConfirm = await firestore('GET', docPath(DELETEALL_CONFIRM_COLLECTION, String(chatId))); } catch (e) {}
      if (daConfirm && daConfirm.fields) {
        try { await firestore('DELETE', docPath(DELETEALL_CONFIRM_COLLECTION, String(chatId))); } catch (e) {}
        if (isSessionExpired(daConfirm)) {
          await sendTelegram(chatId, infoCard('⌛ <b>CONFIRMATION EXPIRED</b>', ['Run /deleteall again to retry.']), message.message_id, REPLY_KEYBOARD);
          return res.status(200).json({ ok: true });
        }
        if (text.trim().toUpperCase() === DELETEALL_TOKEN) {
          var loadingId = await sendLoadingCard(chatId, '🗑 <b>DELETING ALL…</b>', 'Removing every question…', message.message_id);
          var all = await listAllQuestions();
          var deleted = 0, undoItems = [];
          _suppressItemLogs = true;
          for (var di = 0; di < all.length; di++) {
            try { var snap = await getRawFields(all[di].id); await deleteQuestion(all[di].id); if (snap) undoItems.push({ id: all[di].id, fields: snap }); deleted++; } catch (e) {}
          }
          _suppressItemLogs = false;
          var undoSaved = undoItems.length ? await saveUndo(chatId, { type: 'delete', items: undoItems }) : false;
          await sendLog('BULK DELETE ALL', { Deleted: deleted, Via: 'typed-token', Undo: undoSaved ? 'yes' : 'no' }, '🗑');
          await respondTelegram(chatId, infoCard('✅ <b>ALL DELETED</b>', ['Deleted <b>' + deleted + '</b> question' + (deleted === 1 ? '' : 's') + '.', '', undoSaved ? '↩️ /undo restores the whole batch.' : '⚠️ Batch too large to snapshot — /undo can’t restore this one.']), message.message_id, REPLY_KEYBOARD, loadingId);
        } else {
          await sendTelegram(chatId, infoCard('✅ <b>CANCELLED</b>', ['Token did not match — nothing deleted.']), message.message_id, REPLY_KEYBOARD);
        }
        return res.status(200).json({ ok: true });
      }
    }

    /* ===== J-FEATURE COMMANDS (41,42,45,50,51,52,54,56) ===== */
    if (command === '/undo') {
      var undo = await getUndo(chatId);
      if (!undo) { await sendTelegram(chatId, infoCard('↩️ <b>NOTHING TO UNDO</b>', ['No recent delete or dismiss to reverse.']), message.message_id, REPLY_KEYBOARD); return res.status(200).json({ ok: true }); }
      var loadingId = await sendLoadingCard(chatId, '↩️ <b>UNDOING…</b>', 'Reversing the last action…', message.message_id);
      var restored = 0;
      try {
        _suppressItemLogs = true;
        if (undo.type === 'delete') {
          for (var ui = 0; ui < (undo.items || []).length; ui++) {
            try { await recreateFromSnapshot(undo.items[ui].id, undo.items[ui].fields); restored++; } catch (e) {}
          }
        } else if (undo.type === 'dismiss') {
          for (var ui2 = 0; ui2 < (undo.items || []).length; ui2++) {
            try { await retrieveQuestion(undo.items[ui2].id); restored++; } catch (e) {}
          }
        }
        _suppressItemLogs = false;
        await clearUndo(chatId);
        await sendLog('UNDO', { Type: undo.type, Restored: restored }, '↩️');
        await respondTelegram(chatId, infoCard('✅ <b>UNDONE</b>', ['Restored <b>' + restored + '</b> ' + (undo.type === 'delete' ? 'deleted' : 'dismissed') + ' item' + (restored === 1 ? '' : 's') + '.']), message.message_id, REPLY_KEYBOARD, loadingId);
      } catch (e) {
        _suppressItemLogs = false;
        await respondTelegram(chatId, infoCard('⚠️ <b>UNDO FAILED</b>', ['Could not fully reverse the action.']), message.message_id, REPLY_KEYBOARD, loadingId);
      }
      return res.status(200).json({ ok: true });
    }

    if (command === '/draft' || command === '/improve' || command === '/shorten' || command === '/expand') {
      var did = text.split(/\s+/)[1];
      if (!ai.aiConfigured()) { await sendTelegram(chatId, infoCard('🤖 <b>AI NOT SET UP</b>', ['Set GROQ_API_KEY in your Vercel', 'environment to enable AI features.']), message.message_id, REPLY_KEYBOARD); return res.status(200).json({ ok: true }); }
      if (!did) { await sendTelegram(chatId, infoCard('🤖 <b>' + command.slice(1).toUpperCase() + '</b>', ['Usage: <code>' + command + ' &lt;id&gt;</code>', 'Find IDs via /pending or /all.']), message.message_id, REPLY_KEYBOARD); return res.status(200).json({ ok: true }); }
      var loadingId = await sendLoadingCard(chatId, '🤖 <b>THINKING…</b>', 'Generating with AI…', message.message_id);
      try {
        var q = await getQuestion(did);
        if (!q) { await respondTelegram(chatId, infoCard('⚠️ <b>NOT FOUND</b>', ['No question with ID <code>' + esc(did) + '</code>.']), message.message_id, REPLY_KEYBOARD, loadingId); return res.status(200).json({ ok: true }); }
        var aiText;
        if (command === '/draft') {
          aiText = await aiDraftAnswer(q);
        } else {
          var current = q.draftAnswer || q.answer;
          if (!current) { await respondTelegram(chatId, infoCard('⚠️ <b>NO ANSWER YET</b>', ['There is no answer to ' + command.slice(1) + '.', 'Use /draft ' + did + ' or answer it first.']), message.message_id, REPLY_KEYBOARD, loadingId); return res.status(200).json({ ok: true }); }
          aiText = await aiTransform(command.slice(1), current, q.question);
        }
        aiText = (aiText || '').trim();
        if (!aiText) { await respondTelegram(chatId, infoCard('⚠️ <b>NO OUTPUT</b>', ['The AI returned nothing. Try again.']), message.message_id, REPLY_KEYBOARD, loadingId); return res.status(200).json({ ok: true }); }
        await clearAnswerSession(chatId); await clearEditSession(chatId);
        await savePreviewSession(chatId, did, aiText);
        await respondTelegram(chatId, answerPreviewCard(q, aiText, did), message.message_id, previewButtons(), loadingId);
      } catch (e) {
        await respondTelegram(chatId, infoCard('⚠️ <b>AI ERROR</b>', [esc(clipText(e.message || 'Request failed', 120))]), message.message_id, REPLY_KEYBOARD, loadingId);
      }
      return res.status(200).json({ ok: true });
    }

    if (command === '/publish') {
      var pid = text.split(/\s+/)[1];
      if (!pid) { await sendTelegram(chatId, infoCard('📤 <b>PUBLISH</b>', ['Publish a saved draft to the site.', 'Usage: <code>/publish &lt;id&gt;</code>', 'See drafts with /drafts.']), message.message_id, REPLY_KEYBOARD); return res.status(200).json({ ok: true }); }
      try {
        var pubText = await publishDraftAnswer(pid);
        await sendAnsweredCard(chatId, pid, pubText, message.message_id, false);
      } catch (e) {
        await sendTelegram(chatId, infoCard('⚠️ <b>CANNOT PUBLISH</b>', ['No draft found for <code>' + esc(pid) + '</code>.', 'Save one first (Save as draft).']), message.message_id, REPLY_KEYBOARD);
      }
      return res.status(200).json({ ok: true });
    }

    if (command === '/drafts') {
      var loadingId = await sendLoadingCard(chatId, '📝 <b>DRAFTS…</b>', 'Loading unpublished answers…', message.message_id);
      var all = await listAllQuestions();
      var drafts = all.filter(function (q) { return q.draft && (q.draftAnswer || q.answer); });
      if (!drafts.length) { await respondTelegram(chatId, infoCard('📝 <b>NO DRAFTS</b>', ['You have no unpublished answers.']), message.message_id, REPLY_KEYBOARD, loadingId); return res.status(200).json({ ok: true }); }
      var lines = ['<b>' + drafts.length + '</b> draft' + (drafts.length === 1 ? '' : 's') + ':', ''];
      drafts.slice(0, 15).forEach(function (q) {
        lines.push('🆔 <code>' + esc(q.id) + '</code>' + (q.publishAt ? ' ⏰ ' + esc(formatTime(q.publishAt)) : ''));
        lines.push('“' + esc(clipText(q.question, 60)) + '”');
        lines.push('↳ ' + esc(clipText(q.draftAnswer || q.answer, 90)));
        lines.push('');
      });
      lines.push('/publish &lt;id&gt; to go live · /schedule &lt;id&gt; &lt;when&gt;');
      await respondTelegram(chatId, infoCard('📝 <b>DRAFTS</b>', lines), message.message_id, REPLY_KEYBOARD, loadingId);
      return res.status(200).json({ ok: true });
    }

    if (command === '/schedule') {
      var sparts = text.split(/\s+/);
      var sid = sparts[1], swhen = sparts.slice(2).join(' ').trim();
      if (!sid || !swhen) { await sendTelegram(chatId, infoCard('⏰ <b>SCHEDULE</b>', ['Publish a draft automatically later.', 'Usage: <code>/schedule &lt;id&gt; &lt;when&gt;</code>', 'when = +2h, +30m, +1d, or ISO time.']), message.message_id, REPLY_KEYBOARD); return res.status(200).json({ ok: true }); }
      var when = null;
      var rel = swhen.match(/^\+(\d+)\s*([mhd])$/i);
      if (rel) {
        var n = parseInt(rel[1], 10); var unit = rel[2].toLowerCase();
        var msAdd = unit === 'm' ? n * 60000 : unit === 'h' ? n * 3600000 : n * 86400000;
        when = new Date(Date.now() + msAdd).toISOString();
      } else {
        var d = new Date(swhen); if (!isNaN(d.getTime())) when = d.toISOString();
      }
      if (!when) { await sendTelegram(chatId, infoCard('⚠️ <b>BAD TIME</b>', ['Could not parse “' + esc(swhen) + '”.', 'Use +2h, +30m, +1d, or an ISO time.']), message.message_id, REPLY_KEYBOARD); return res.status(200).json({ ok: true }); }
      try {
        var q = await getQuestion(sid);
        if (!q) { await sendTelegram(chatId, infoCard('⚠️ <b>NOT FOUND</b>', ['No question <code>' + esc(sid) + '</code>.']), message.message_id, REPLY_KEYBOARD); return res.status(200).json({ ok: true }); }
        var draftText = q.draftAnswer || q.answer;
        if (!draftText) { await sendTelegram(chatId, infoCard('⚠️ <b>NO DRAFT</b>', ['Save an answer as a draft first,', 'then schedule it.']), message.message_id, REPLY_KEYBOARD); return res.status(200).json({ ok: true }); }
        await saveDraftAnswer(sid, draftText, when);
        await sendTelegram(chatId, infoCard('⏰ <b>SCHEDULED</b>', ['Will publish at:', '<b>' + esc(formatTime(when)) + '</b> IST', '', '🆔 <code>' + esc(sid) + '</code>', 'Cancel by editing/publishing before then.']), message.message_id, REPLY_KEYBOARD);
      } catch (e) {
        await sendTelegram(chatId, infoCard('⚠️ <b>SCHEDULE FAILED</b>', [esc(clipText(e.message || 'error', 100))]), message.message_id, REPLY_KEYBOARD);
      }
      return res.status(200).json({ ok: true });
    }

    if (command === '/top') {
      var loadingId = await sendLoadingCard(chatId, '🏆 <b>TOP ANSWERS…</b>', 'Ranking by votes and reactions…', message.message_id);
      var all = await listAllQuestions();
      var answered = all.filter(function (q) { return questionState(q) === 'ANSWERED'; });
      var score = function (q) { var r = 0; Object.keys(q.reactions || {}).forEach(function (k) { r += q.reactions[k] || 0; }); return (q.votes || 0) + r; };
      answered.sort(function (a, b) { return score(b) - score(a); });
      var topN = answered.slice(0, 10).filter(function (q) { return score(q) > 0; });
      if (!topN.length) { await respondTelegram(chatId, infoCard('🏆 <b>TOP ANSWERS</b>', ['No votes or reactions yet.']), message.message_id, REPLY_KEYBOARD, loadingId); return res.status(200).json({ ok: true }); }
      var medals = ['🥇', '🥈', '🥉'];
      var lines = [];
      topN.forEach(function (q, i) {
        var r = 0; Object.keys(q.reactions || {}).forEach(function (k) { r += q.reactions[k] || 0; });
        lines.push((medals[i] || (i + 1) + '.') + ' ▲' + (q.votes || 0) + ' · ' + r + ' reactions');
        lines.push('“' + esc(clipText(q.question, 70)) + '”');
        lines.push('');
      });
      await respondTelegram(chatId, infoCard('🏆 <b>TOP ANSWERS</b>', lines), message.message_id, REPLY_KEYBOARD, loadingId);
      return res.status(200).json({ ok: true });
    }

    if (command === '/trends') {
      var loadingId = await sendLoadingCard(chatId, '📈 <b>TRENDS…</b>', 'Crunching activity & response times…', message.message_id);
      var all = await listAllQuestions();
      var answered = all.filter(function (q) { return questionState(q) === 'ANSWERED'; });
      var rts = answered.filter(function (q) { return q.createdAt && q.answeredAt; }).map(function (q) { return new Date(q.answeredAt).getTime() - new Date(q.createdAt).getTime(); }).filter(function (m) { return m >= 0; });
      var avg = rts.length ? rts.reduce(function (a, b) { return a + b; }, 0) / rts.length : 0;
      var fastest = rts.length ? Math.min.apply(null, rts) : 0;
      var slowest = rts.length ? Math.max.apply(null, rts) : 0;
      var now = Date.now(), day = 86400000;
      var last7 = 0, prev7 = 0;
      all.forEach(function (q) {
        if (!q.createdAt) return; var age = now - new Date(q.createdAt).getTime();
        if (age <= 7 * day) last7++; else if (age <= 14 * day) prev7++;
      });
      var trend = prev7 === 0 ? (last7 > 0 ? '📈 new activity' : 'flat') : (last7 > prev7 ? '📈 +' + (last7 - prev7) + ' vs prior week' : last7 < prev7 ? '📉 -' + (prev7 - last7) + ' vs prior week' : 'flat vs prior week');
      var lines = [
        '📥 Total: <b>' + all.length + '</b> · Answered: <b>' + answered.length + '</b>',
        '🗓 Last 7 days: <b>' + last7 + '</b> (' + trend + ')',
        '',
        '⏱ <b>Response time</b>',
        '  avg ' + formatDuration(avg),
        '  fastest ' + formatDuration(fastest) + ' · slowest ' + formatDuration(slowest),
        '  answered w/ timing: ' + rts.length
      ];
      await respondTelegram(chatId, infoCard('📈 <b>TRENDS</b>', lines), message.message_id, REPLY_KEYBOARD, loadingId);
      return res.status(200).json({ ok: true });
    }

    if (command === '/templates') {
      var tpls = await listTemplates();
      var lines = tpls.length ? [] : ['No templates yet.'];
      tpls.forEach(function (t) { lines.push('🏷 <code>' + esc(t.name) + '</code>'); lines.push('  ' + esc(clipText(t.text, 80))); lines.push(''); });
      lines.push('/addtemplate &lt;name&gt; | &lt;text&gt;');
      lines.push('/usetemplate &lt;name&gt; &lt;id&gt; · /deltemplate &lt;name&gt;');
      await sendTelegram(chatId, infoCard('🏷 <b>REPLY TEMPLATES</b>', lines), message.message_id, REPLY_KEYBOARD);
      return res.status(200).json({ ok: true });
    }
    if (command === '/addtemplate') {
      var rest = text.slice(command.length).trim();
      var bar = rest.indexOf('|');
      if (bar < 0) { await sendTelegram(chatId, infoCard('🏷 <b>ADD TEMPLATE</b>', ['Usage:', '<code>/addtemplate name | template text</code>']), message.message_id, REPLY_KEYBOARD); return res.status(200).json({ ok: true }); }
      var tName = rest.slice(0, bar).trim(), tText = rest.slice(bar + 1).trim();
      if (!tName || !tText) { await sendTelegram(chatId, infoCard('⚠️ <b>MISSING PARTS</b>', ['Need both a name and text.']), message.message_id, REPLY_KEYBOARD); return res.status(200).json({ ok: true }); }
      try { var key = await saveTemplate(tName, tText); await sendTelegram(chatId, infoCard('✅ <b>TEMPLATE SAVED</b>', ['🏷 <code>' + esc(key) + '</code>', 'Use it: /usetemplate ' + esc(key) + ' &lt;id&gt;']), message.message_id, REPLY_KEYBOARD); }
      catch (e) { await sendTelegram(chatId, infoCard('⚠️ <b>FAILED</b>', ['Could not save template.']), message.message_id, REPLY_KEYBOARD); }
      return res.status(200).json({ ok: true });
    }
    if (command === '/deltemplate') {
      var dName = text.split(/\s+/)[1];
      if (!dName) { await sendTelegram(chatId, infoCard('🏷 <b>DELETE TEMPLATE</b>', ['Usage: <code>/deltemplate &lt;name&gt;</code>']), message.message_id, REPLY_KEYBOARD); return res.status(200).json({ ok: true }); }
      await deleteTemplate(dName);
      await sendTelegram(chatId, infoCard('✅ <b>TEMPLATE REMOVED</b>', ['🏷 <code>' + esc(templateKey(dName)) + '</code>']), message.message_id, REPLY_KEYBOARD);
      return res.status(200).json({ ok: true });
    }
    if (command === '/usetemplate') {
      var uparts = text.split(/\s+/); var uName = uparts[1], uId = uparts[2];
      if (!uName || !uId) { await sendTelegram(chatId, infoCard('🏷 <b>USE TEMPLATE</b>', ['Usage: <code>/usetemplate &lt;name&gt; &lt;id&gt;</code>', 'Loads the template as a preview to publish.']), message.message_id, REPLY_KEYBOARD); return res.status(200).json({ ok: true }); }
      var tplText = await getTemplate(uName);
      if (!tplText) { await sendTelegram(chatId, infoCard('⚠️ <b>NO SUCH TEMPLATE</b>', ['🏷 <code>' + esc(templateKey(uName)) + '</code> not found.', 'See /templates.']), message.message_id, REPLY_KEYBOARD); return res.status(200).json({ ok: true }); }
      var q = await getQuestion(uId);
      if (!q) { await sendTelegram(chatId, infoCard('⚠️ <b>NOT FOUND</b>', ['No question <code>' + esc(uId) + '</code>.']), message.message_id, REPLY_KEYBOARD); return res.status(200).json({ ok: true }); }
      await clearAnswerSession(chatId); await clearEditSession(chatId);
      await savePreviewSession(chatId, uId, tplText);
      await sendTelegram(chatId, answerPreviewCard(q, tplText, uId), message.message_id, previewButtons());
      return res.status(200).json({ ok: true });
    }

    /* 53. Inline / bulk answering — each pending question as its own actionable card. */
    if (command === '/queue' || command === '/answerall') {
      var loadingId = await sendLoadingCard(chatId, '📥 <b>ANSWER QUEUE…</b>', 'Loading pending questions…', message.message_id);
      var all = await listAllQuestions();
      var items = all.filter(function (q) { return questionState(q) === 'UNANSWERED'; })
        .sort(function (a, b) { return new Date(a.createdAt || 0) - new Date(b.createdAt || 0); });
      if (!items.length) {
        await respondTelegram(chatId, infoCard('✅ <b>ALL CAUGHT UP</b>', ['No pending questions to answer.']), message.message_id, REPLY_KEYBOARD, loadingId);
        return res.status(200).json({ ok: true });
      }
      var shown = items.slice(0, 8);
      await respondTelegram(chatId, infoCard('📥 <b>ANSWER QUEUE</b>', ['<b>' + items.length + '</b> pending — showing ' + shown.length + '.', 'Answer or draft each inline below.']), message.message_id, REPLY_KEYBOARD, loadingId);
      for (var qi = 0; qi < shown.length; qi++) {
        var q = shown[qi];
        var card = infoCard('⏳ <b>PENDING #' + (qi + 1) + '</b>', [
          'Visitor — <b>' + esc(visitorName(q.name)) + '</b>' + (timeAgo(q.createdAt) ? ' · ' + esc(timeAgo(q.createdAt)) : ''),
          'ID — <code>' + esc(q.id) + '</code>',
          '',
          '“' + esc(clipText(q.question, 200)) + '”'
        ]);
        var rows = [[{ text: '💬 Answer', callback_data: 'answer:' + q.id }, { text: '🙈 Dismiss', callback_data: 'dismiss:' + q.id }]];
        if (ai.aiConfigured()) rows.push([{ text: '🤖 AI draft', callback_data: 'aidraft:' + q.id }]);
        await sendTelegram(chatId, card, undefined, { inline_keyboard: rows });
      }
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