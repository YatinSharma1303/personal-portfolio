/* ============================================================
 api/telegram.js - Vercel serverless function
 Called by the website when a visitor submits a question.
 Sends a clean, well-formatted notification card with
 clear action buttons.
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

    if (!question) return res.status(400).json({ ok: false, error: 'Question is required' });

    // Format timestamp in IST
    var timeStr = createdAt;
    try {
      timeStr = new Date(createdAt).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit', hour12: true
      });
    } catch (e) {}

    // Clean notification card
    var text = [
      '\u250C\u2500\uD83D\uDCD8 <b>NEW QUESTION</b>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510',
      '\u2502',
      '\u2502 \uD83D\uDC64 <b>' + escapeHtml(name) + '</b>',
      '\u2502',
      '\u2502 \uD83D\uDCAC\n> ' + escapeHtml(question) + '\n\u2502',
      '\u2502 \uD83D\uDD50 ' + escapeHtml(timeStr) + ' IST',
      '\u2502 \uD83C\uDD94 <code>' + escapeHtml(questionId) + '</code>',
      '\u2502',
      '\u2514\u2500\u26A1 <i>reply to answer</i>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518'
    ].join('\n');

    // Action buttons - clean 2-row layout
    var replyMarkup = {
      inline_keyboard: [
        [{ text: '\uD83D\uDCAC Answer', callback_data: 'answer:' + questionId }],
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
      return res.status(502).json({ ok: false, error: (data && data.description) || 'Telegram API error ' + tgRes.status });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Telegram notification failed:', error);
    return res.status(500).json({ ok: false, error: 'Failed to send Telegram notification' });
  }
};
