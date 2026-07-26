/* ============================================================
   api/ama-vote.js  —  Vercel serverless function
   Increments/decrements a reversible vote on an answered
   question. Uses a Firestore commit transform (increment) so
   concurrent votes are race-safe (no read-modify-write).
   ============================================================ */

const { firestore, docPath, increment } = require('./_firestore');

const COLLECTION = 'amaQuestions';
const TELEGRAM_API = 'https://api.telegram.org/bot';
const VOTE_MILESTONES = [10, 25, 50, 100, 250, 500];

function jsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return req.body;
}

function currentVotes(doc) {
  const f = (doc && doc.fields) || {};
  return Number((f.votes && (f.votes.integerValue || f.votes.doubleValue)) || 0);
}

function announcedMilestone(doc) {
  const f = (doc && doc.fields) || {};
  return Number((f.voteMilestone && (f.voteMilestone.integerValue || f.voteMilestone.doubleValue)) || 0);
}

// 49. Ping the admin when an answer's upvotes cross a milestone.
async function maybeVoteMilestone(id, doc, votes) {
  const already = announcedMilestone(doc);
  const due = VOTE_MILESTONES.filter((m) => votes >= m);
  const highest = due.length ? due[due.length - 1] : 0;
  if (!highest || highest <= already) return;
  try {
    await firestore('PATCH', `${docPath(COLLECTION, id)}?updateMask.fieldPaths=voteMilestone`, {
      fields: { voteMilestone: { integerValue: String(highest) } }
    });
  } catch (e) { return; }
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;
  const q = String((doc && doc.fields && doc.fields.question && doc.fields.question.stringValue) || '').replace(/[<>&]/g, '').slice(0, 80);
  const text = `🔥 <b>UPVOTE MILESTONE</b>\nAn answer just hit <b>${highest}</b> upvotes!\n\n🆔 <code>${id}</code>\n“${q}”`;
  try {
    await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
  } catch (e) {}
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const body = jsonBody(req);
    const id = String(body.id || '').trim().slice(0, 120);
    const delta = Number(body.delta);

    if (!id) return res.status(400).json({ ok: false, error: 'Question id is required' });
    if (![1, -1].includes(delta)) return res.status(400).json({ ok: false, error: 'delta must be 1 or -1' });

    // Only answered questions can be voted on (also confirms the doc exists,
    // which the increment transform below requires).
    const doc = await firestore('GET', docPath(COLLECTION, id));
    const answered = !!(doc && doc.fields && doc.fields.answered && doc.fields.answered.booleanValue);
    if (!answered) return res.status(400).json({ ok: false, error: 'Only answered questions can be voted on' });

    // Don't decrement below zero (increment has no floor of its own).
    if (delta === -1 && currentVotes(doc) <= 0) {
      return res.status(200).json({ ok: true, id, votes: 0 });
    }

    // Atomic, race-safe increment via a Firestore commit transform.
    const raw = await increment(COLLECTION, id, 'votes', delta);
    const votes = Math.max(0, Number(raw == null ? currentVotes(doc) + delta : raw));

    // 49. Best-effort upvote-milestone ping (never blocks the vote response).
    if (delta === 1) { try { await maybeVoteMilestone(id, doc, votes); } catch (e) {} }

    return res.status(200).json({ ok: true, id, votes });
  } catch (error) {
    console.error('AMA vote failed:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Failed to save vote' });
  }
};
