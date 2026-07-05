/* ============================================================
   api/telegram.js  —  Vercel serverless function
   Called by the website when a visitor submits a question.
   Sends a beautifully formatted notification with blockquote
   cards and a 3-row button hierarchy.
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

    // 1. BLOCKQUOTE QUESTION CARD — visually separates the question from metadata
    const text = [
      `📩 <b>New Question</b>`,
      ``,
      `👤 <b>${escapeHtml(name)}</b> asks:`,
      `<blockquote>${escapeHtml(question)}</blockquote>`,
      `🕐 ${escapeHtml(timeStr)} IST · 🆔 <code>${escapeHtml(questionId)}</code>`
    ].join('\n');

    // 3. BUTTON LAYOUT REDESIGN — 3-row hierarchy
    // Row 1: Answer (primary, alone)
    // Row 2: Edit Answer (secondary, alone)
    // Row 3: Dismiss + Delete (danger zone, grouped)
    const replyMarkup = {
      inline_keyboard: [
        [{ text: '💬  Answer', callback_data: `answer:${questionId}` }],
        [{ text: '✏️  Edit Answer', callback_data: `edit:${questionId}` }],
        [
          { text: '🙈  Dismiss', callback_data: `dismiss:${questionId}` },
          { text: '🗑  Delete', callback_data: `delete:${questionId}` }
        ]
      ]
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
