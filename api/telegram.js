/* ============================================================
 api/telegram.js - Vercel serverless function
 Called by the website when a visitor submits a question.
 Sends a clean, well-formatted notification card with
 clear action buttons. Card format matches webhook.
 ============================================================ */

var TELEGRAM_API = 'https://api.telegram.org/bot';

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
      BOX_V,
      BOX_V + ' \uD83D\uDCAC <b>Question</b>',
      BOX_V + ' “' + escapeHtml(question) + '”',
      BOX_V,
      BOX_V + ' Tap <b>Answer</b> or reply to this card.',
      BOX_V,
      cardBottom
    ].join('\n');

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

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Telegram notification failed:', error);
    return res.status(500).json({ ok: false, error: 'Failed to send Telegram notification' });
  }
};
