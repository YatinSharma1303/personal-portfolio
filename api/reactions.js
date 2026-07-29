/* ============================================================
   api/reactions.js — Toggle an emoji reaction on a question.
   Uses a Firestore commit transform to atomically increment the
   per-emoji count (race-safe — no read-modify-write).
   ============================================================ */
const { firestore, docPath, increment, fieldPathSegment } = require('./_firestore');
const COLLECTION = 'amaQuestions';

// The exact reactions the UI offers. Whitelisting keeps arbitrary (possibly
// HTML-breaking) strings out of the reactions map, which is later rendered into
// the admin bot's HTML Telegram messages.
const ALLOWED_EMOJI = ['👍', '🔥', '👏', '🤩'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = String(body.id || '').trim().slice(0, 120);
    const emoji = String(body.emoji || '').trim().slice(0, 10);
    const delta = Number(body.delta) === 1 ? 1 : -1;
    if (!id || !emoji) return res.status(400).json({ error: 'id and emoji required' });
    if (ALLOWED_EMOJI.indexOf(emoji) === -1) return res.status(400).json({ error: 'unsupported emoji' });

    // Guard against decrementing below zero (the increment transform has no floor).
    if (delta === -1) {
      const doc = await firestore('GET', docPath(COLLECTION, id)).catch(() => null);
      const map = doc && doc.fields && doc.fields.reactions && doc.fields.reactions.mapValue && doc.fields.reactions.mapValue.fields;
      const cur = map && map[emoji] ? Number(map[emoji].integerValue || map[emoji].doubleValue || 0) : 0;
      if (cur <= 0) return res.status(200).json({ ok: true, id, emoji, newCount: 0 });
    }

    // Atomic, race-safe increment of reactions.`<emoji>` on the question doc.
    const raw = await increment(COLLECTION, id, 'reactions.' + fieldPathSegment(emoji), delta);
    const newCount = Math.max(0, Number(raw == null ? 0 : raw));

    return res.status(200).json({ ok: true, id, emoji, newCount });
  } catch (e) {
    console.error('Reaction error:', e.message);
    return res.status(500).json({ error: e.message || 'Failed to toggle reaction' });
  }
};
