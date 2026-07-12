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

    // Card format matches webhook's cardTop/cardBottom helpers
    var BOX_TL = '\u250C', BOX_TR = '\u2510', BOX_BL = '\u2514', BOX_BR = '\u2518';
    var BOX_H = '\u2500', BOX_V = '\u2502';
    function cardTop(title) { return BOX_TL + BOX_H + title + BOX_H.repeat(5) + BOX_TR; }
    var cardBottom = BOX_BL + BOX_H.repeat(30) + BOX_BR;

    var text = [
      cardTop('\uD83D\uDCD8 <b>NEW QUESTION</b>'),
      BOX_V,
      BOX_V + ' \uD83D\uDC64 <b>' + escapeHtml(name) + '</b>',
      BOX_V,
      BOX_V + ' \uD83D\uDCAC\n> ' + escapeHtml(question) + '\n' + BOX_V,
      BOX_V + ' \uD83D\uDD50 ' + escapeHtml(timeStr) + ' IST',
      BOX_V + ' \uD83C\uDD94 <code>' + escapeHtml(questionId) + '</code>',
      BOX_V,
      BOX_BL + BOX_H + '\u26A1 <i>tap Answer or reply</i>' + BOX_H.repeat(10) + BOX_BR
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
