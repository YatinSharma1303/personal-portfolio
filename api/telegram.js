/* ============================================================
 api/telegram.js - Vercel serverless function
 Called by the website when a visitor submits a question.
 Sends a clean, well-formatted notification card with
 clear action buttons. Card format matches webhook.
 ============================================================ */

var TELEGRAM_API = 'https://api.telegram.org/bot';
var ai = require('./_ai');
var fs = require('./_firestore');

var QUESTIONS = 'amaQuestions';
var STATS = 'siteStats';
var MILESTONE_DOC = 'amaMilestones';
var MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

// 55. Lightweight profanity/spam heuristic — flags for review, never blocks.
var PROFANITY = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'pussy', 'slut', 'whore', 'nigger', 'faggot', 'retard'];
function classifySpam(name, question) {
  var q = String(question || '');
  var low = q.toLowerCase();
  var reasons = [];
  if (PROFANITY.some(function (w) { return new RegExp('\\b' + w, 'i').test(low); })) reasons.push('profanity');
  var links = (q.match(/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|ru|xyz|top|shop|info)\b/gi) || []).length;
  if (links >= 2) reasons.push('links');
  var letters = q.replace(/[^a-z]/gi, '');
  if (letters.length > 20) {
    var caps = (q.match(/[A-Z]/g) || []).length;
    if (caps / letters.length > 0.7) reasons.push('shouting');
  }
  if (/(.)\1{6,}/.test(low)) reasons.push('repetition');
  if (letters.length > 14) {
    var vowels = (letters.match(/[aeiou]/gi) || []).length;
    if (vowels / letters.length < 0.18) reasons.push('gibberish');
  }
  return { flagged: reasons.length > 0, reason: reasons.join(', ') };
}

// 43. AI-assisted topic — a short 1–3 word label. Falls back to the client topic.
async function aiTopic(question) {
  var system = 'You label AMA questions with a very short topic tag of 1–3 words in Title Case '
    + '(e.g. "React Hooks", "Career Advice", "SmartHealthCare"). Output ONLY the tag, no punctuation or quotes.';
  var t = await ai.claude({ system: system, prompt: 'Question: ' + question, maxTokens: 20 });
  return String(t || '').replace(/["'.\n]/g, '').trim().split(/\s+/).slice(0, 3).join(' ').slice(0, 40);
}

// 49. Count answered+pending questions (paginated) for milestone detection.
async function countQuestions() {
  var count = 0;
  var url = fs.collectionUrl(QUESTIONS, 300);
  while (url) {
    var data = await fs.firestore('GET', url);
    if (data.documents) count += data.documents.length;
    url = data.nextPageToken ? (fs.collectionUrl(QUESTIONS, 300) + '&pageToken=' + data.nextPageToken) : null;
  }
  return count;
}
async function checkMilestone(botToken, chatId, total) {
  var due = MILESTONES.filter(function (m) { return total >= m; });
  if (!due.length) return;
  var highest = due[due.length - 1];
  var doc = null;
  try { doc = await fs.firestore('GET', fs.docPath(STATS, MILESTONE_DOC)); } catch (e) {}
  var last = doc && doc.fields && doc.fields.lastFired && Number(doc.fields.lastFired.integerValue || doc.fields.lastFired.doubleValue || 0) || 0;
  if (highest <= last) return; // already announced
  await fs.firestore('PATCH', fs.docPath(STATS, MILESTONE_DOC) + '?' + fs.mask(['lastFired', 'firedAt']), {
    fields: { lastFired: { integerValue: String(highest) }, firedAt: { stringValue: new Date().toISOString() } }
  });
  var BOX_V = '│';
  var text = '┌─🎉 <b>MILESTONE</b>─────┐\n' + BOX_V + '\n'
    + BOX_V + ' Your AMA just reached <b>' + highest + '</b> questions!\n' + BOX_V + '\n'
    + BOX_V + ' 📈 Total submitted: <b>' + total + '</b>\n' + BOX_V + '\n'
    + '└───────────────┘';
  try {
    await fetch(TELEGRAM_API + botToken + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
  } catch (e) {}
}

function escapeHtml(value) {
  value = value || '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clip(value, max) {
  value = String(value || '').replace(/\s+/g, ' ').trim();
  max = max || 120;
  return value.length > max ? value.slice(0, max - 1) + '…' : value;
}

function inferLogCategory(title) {
  title = String(title || '').toUpperCase();
  if (title.indexOf('SITE ') === 0 || title.indexOf('SITE_') === 0) return title.indexOf('FAILED') !== -1 ? 'error' : 'site';
  if (title.indexOf('ERROR') !== -1 || title.indexOf('FAILED') !== -1) return 'error';
  return 'site';
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
  var labels = { site: '🌐 Site Activity Logs', error: '⚠️ Error Logs' };
  return labels[category] || '🧾 General Logs';
}

function humanLogTitle(title) {
  return String(title || 'LOG').toLowerCase().split(/[_\s]+/).map(function(w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : ''; }).join(' ');
}

function prettyFieldName(key) {
  var map = { ID: 'Question ID', id: 'Question ID', AutoTopic: 'Auto Topic' };
  return map[key] || String(key || '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function severityForLog(title, category) {
  var t = String(title || '').toUpperCase();
  if (category === 'error' || t.indexOf('FAILED') !== -1 || t.indexOf('ERROR') !== -1) return 'Warning';
  return 'Info';
}

function summaryForLog(title) {
  var t = String(title || '').toUpperCase();
  if (t === 'SITE QUESTION RECEIVED') return 'A visitor submitted a new AMA question.';
  if (t.indexOf('FAILED') !== -1) return 'A site-to-bot notification failed.';
  return 'A site log event was recorded.';
}

function isIdField(key) { return /(^id$|id$|question id)$/i.test(String(key || '')); }
function formatFieldValue(key, value) {
  var v = escapeHtml(clip(String(value), 180));
  return isIdField(key) ? '<code>' + v + '</code>' : v;
}

function buildLogMessage(title, fields, emoji, category) {
  fields = fields || {};
  emoji = emoji || '🧾';
  var eventCode = String(title || 'LOG').toUpperCase().replace(/\s+/g, '_');
  var severity = severityForLog(title, category);
  var env = process.env.VERCEL_ENV || process.env.NODE_ENV || 'production';
  var lines = [
    '┌─' + emoji + ' <b>' + escapeHtml(humanLogTitle(title)) + '</b>',
    '│',
    '│ <b>Summary</b>',
    '│ ' + escapeHtml(summaryForLog(title)),
    '│',
    '│ <b>Event</b>',
    '│ Code: <code>' + escapeHtml(eventCode) + '</code>',
    '│ Severity: <b>' + escapeHtml(severity) + '</b>',
    '│ Category: ' + escapeHtml(logCategoryLabel(category)),
    '│ Env: <code>' + escapeHtml(env) + '</code>'
  ];
  var preferred = ['ID','Visitor','Topic','Question','Time','Error'];
  var keys = [];
  preferred.forEach(function(k) { if (Object.prototype.hasOwnProperty.call(fields, k)) keys.push(k); });
  Object.keys(fields).forEach(function(k) { if (keys.indexOf(k) === -1) keys.push(k); });
  keys = keys.filter(function(k) { var v = fields[k]; return !(v === undefined || v === null || v === ''); });
  if (keys.length) {
    lines.push('│');
    lines.push('│ <b>Details</b>');
    keys.forEach(function(k) { lines.push('│ ' + escapeHtml(prettyFieldName(k)) + ': ' + formatFieldValue(k, fields[k])); });
  }
  lines.push('└─ portfolio-site');
  return lines.join('\n');
}

async function sendLog(botToken, title, fields, emoji, category) {
  var logChatId = process.env.TELEGRAM_LOG_CHAT_ID;
  if (!botToken || !logChatId) return;
  fields = fields || {};
  category = category || inferLogCategory(title);
  try {
    var payload = {
      chat_id: logChatId,
      text: buildLogMessage(title, fields, emoji, category),
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  var botToken = process.env.TELEGRAM_BOT_TOKEN;
  var chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return res.status(500).json({
      ok: false,
      error: 'Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.'
    });
  }

  try {
    var body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    var name = String(body.name || 'Anonymous').trim().slice(0, 60) || 'Anonymous';
    var question = String(body.question || '').trim().slice(0, 280);
    var questionId = String(body.id || '').trim().slice(0, 80);
    var createdAt = String(body.createdAt || new Date().toISOString()).trim().slice(0, 80);
    var topic = String(body.topic || '').trim().slice(0, 40);

    if (!question) return res.status(400).json({ ok: false, error: 'Question is required' });

    // 55 + 43: classify spam and (optionally) compute an AI topic, then persist
    // both onto the freshly-created Firestore doc. All best-effort — a failure
    // here must never stop the Telegram notification below.
    var flag = classifySpam(name, question);
    if (ai.aiConfigured()) {
      try { var t = await aiTopic(question); if (t) topic = t; } catch (e) {}
    }
    if (questionId) {
      try {
        var fields = {};
        var names = [];
        if (topic) { fields.topic = { stringValue: topic }; fields.topicManual = { booleanValue: false }; fields.topicAt = { stringValue: new Date().toISOString() }; names.push('topic', 'topicManual', 'topicAt'); }
        if (flag.flagged) { fields.flagged = { booleanValue: true }; fields.flagReason = { stringValue: flag.reason }; names.push('flagged', 'flagReason'); }
        if (names.length) await fs.firestore('PATCH', fs.docPath(QUESTIONS, questionId) + '?' + fs.mask(names), { fields: fields });
      } catch (e) { /* topic/flag persistence is optional */ }
    }

    // Format timestamp in IST
    var timeStr = createdAt;
    try {
      timeStr = new Date(createdAt).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit', hour12: true
      });
    } catch (e) {}

    // Card format matches webhook's cardTop/cardBottom helpers
    var BOX_TL = '\u250C', BOX_TR = '\u2510', BOX_BL = '\u2514', BOX_BR = '\u2518';
    var BOX_H = '\u2500', BOX_V = '\u2502';
    function cardTop(title) { return BOX_TL + BOX_H + title + BOX_H.repeat(5) + BOX_TR; }
    var cardBottom = BOX_BL + BOX_H.repeat(30) + BOX_BR;

    var visitor = (!name || String(name).toLowerCase() === 'anonymous') ? 'Anonymous visitor' : name;
    var text = [
      cardTop('\uD83D\uDCEC <b>NEW AMA QUESTION</b>'),
      BOX_V,
      BOX_V + ' Inbox received a new visitor question.',
      BOX_V,
      BOX_V + ' \uD83D\uDC64 Visitor \u2500 <b>' + escapeHtml(visitor) + '</b>',
      BOX_V + ' \uD83D\uDD50 Time \u2500 ' + escapeHtml(timeStr) + ' IST',
      BOX_V + ' \uD83C\uDD94 ID \u2500 <code>' + escapeHtml(questionId) + '</code>',
      topic ? BOX_V + ' \uD83C\uDFF7 Topic \u2500 <b>' + escapeHtml(topic) + '</b>' : BOX_V,
      flag.flagged ? BOX_V + ' \u26A0\uFE0F Auto-flagged \u2500 <b>' + escapeHtml(flag.reason) + '</b>' : null,
      BOX_V,
      BOX_V + ' \uD83D\uDCAC <b>Question</b>',
      BOX_V + ' “' + escapeHtml(question) + '”',
      BOX_V,
      BOX_V + ' Tap <b>Answer</b> or reply to this card.',
      BOX_V,
      cardBottom
    ].filter(function (l) { return l !== null && l !== undefined; }).join('\n');

    // Action buttons - matches buildCardForQuestion() UNANSWERED layout
    var replyMarkup = {
      inline_keyboard: [
        [{ text: '\uD83D\uDCAC Answer', callback_data: 'answer:' + questionId }],
        [{ text: '\uD83D\uDCCD Pin', callback_data: 'pin:' + questionId }],
        [
          { text: '\uD83D\uDE48 Dismiss', callback_data: 'dismiss:' + questionId },
          { text: '\uD83D\uDDD1 Delete', callback_data: 'delete:' + questionId }
        ]
      ]
    };

    var tgRes = await fetch(TELEGRAM_API + botToken + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: replyMarkup
      })
    });

    var data = await tgRes.json().catch(function() { return null; });
    if (!tgRes.ok || !data || !data.ok) {
      await sendLog(botToken, 'SITE TELEGRAM NOTIFY FAILED', { ID: questionId, Error: (data && data.description) || 'Telegram API error ' + tgRes.status }, '\u26A0\uFE0F');
      return res.status(502).json({ ok: false, error: (data && data.description) || 'Telegram API error ' + tgRes.status });
    }

    await sendLog(botToken, 'SITE QUESTION RECEIVED', {
      Visitor: visitor,
      ID: questionId,
      Topic: topic || '—',
      Question: clip(question, 120),
      Time: timeStr + ' IST'
    }, '\uD83C\uDF10');

    // 49. Milestone ping (best-effort, after the main notification).
    try { var total = await countQuestions(); await checkMilestone(botToken, chatId, total); } catch (e) {}

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Telegram notification failed:', error);
    return res.status(500).json({ ok: false, error: 'Failed to send Telegram notification' });
  }
};
