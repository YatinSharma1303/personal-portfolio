/* ============================================================
   api/telegram.js  —  Vercel serverless function
   Called by the website when a visitor submits a question.
   Sends a richly-formatted notification to the owner's Telegram
   with inline action buttons (Answer / Dismiss / Delete / Edit).
   ============================================================ */

const TELEGRAM_API = 'https://api.telegram.org/bot';

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return res.status(500).json({
      ok: false,
      error: 'Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.'
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const name = String(body.name || 'Anonymous').trim().slice(0, 60) || 'Anonymous';
    const question = String(body.question || '').trim().slice(0, 280);
    const questionId = String(body.id || '').trim().slice(0, 80);
    const createdAt = String(body.createdAt || new Date().toISOString()).trim().slice(0, 80);

    if (!question) return res.status(400).json({ ok: false, error: 'Question is required' });

    // Format the timestamp nicely (IST).
    let timeStr = createdAt;
    try {
      timeStr = new Date(createdAt).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit', hour12: true
      });
    } catch (e) {}

    const text = [
      `📩 <b>New Question</b>`,
      ``,
      `<b>👤 From:</b> ${escapeHtml(name)}`,
      `<b>💬 Question:</b>`,
      `<i>${escapeHtml(question)}</i>`,
      ``,
      `🕐 <i>${escapeHtml(timeStr)} IST</i>`,
      `🆔 <code>${escapeHtml(questionId)}</code>`,
      ``,
      `💡 <i>Reply to this message to answer, or use the buttons below.</i>`
    ].join('\n');

    // Inline keyboard — tap a button instead of typing a command.
    // callback_data format: "action:id"
    const replyMarkup = {
      inline_keyboard: [[
        { text: '💬 Answer', callback_data: `answer:${questionId}` },
        { text: '🙈 Dismiss', callback_data: `dismiss:${questionId}` }
      ], [
        { text: '🗑 Delete', callback_data: `delete:${questionId}` },
        { text: '✏️ Edit Answer', callback_data: `edit:${questionId}` }
      ]]
    };

    const tgRes = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: replyMarkup
      })
    });

    const data = await tgRes.json().catch(() => null);
    if (!tgRes.ok || !data?.ok) {
      return res.status(502).json({ ok: false, error: data?.description || `Telegram API error ${tgRes.status}` });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Telegram notification failed:', error);
    return res.status(500).json({ ok: false, error: 'Failed to send Telegram notification' });
  }
};
