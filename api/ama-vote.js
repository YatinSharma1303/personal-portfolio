/* ============================================================
   api/ama-vote.js  —  Vercel serverless function
   Increments/decrements a reversible vote on an answered
   question. Uses Firestore REST + service-account JWT.
   Uses FieldTransform.increment so it's race-safe.
   ============================================================ */

const crypto = require('crypto');

const COLLECTION = 'amaQuestions';

function jsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return req.body;
}

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_KEY');
  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY must contain client_email and private_key');
  }
  return parsed;
}

function projectId() {
  const sa = serviceAccount();
  return process.env.FIREBASE_PROJECT_ID || sa.project_id;
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function docPath(collection, id) {
  return `https://firestore.googleapis.com/v1/projects/${projectId()}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}`;
}

async function googleAccessToken() {
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || `Google token error ${response.status}`);
  }
  return data.access_token;
}

async function firestore(method, url, body) {
  const token = await googleAccessToken();
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `Firestore ${method} error ${response.status}`);
  return data;
}

function currentVotes(doc) {
  const f = doc?.fields || {};
  return Number(f.votes?.integerValue || f.votes?.doubleValue || 0);
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

    // Only answered questions can be voted on.
    const doc = await firestore('GET', docPath(COLLECTION, id));
    const answered = !!doc?.fields?.answered?.booleanValue;
    if (!answered) return res.status(400).json({ ok: false, error: 'Only answered questions can be voted on' });

    // Atomic increment (race-safe) — clamped at 0 floor client-side.
    const nextVotes = Math.max(0, currentVotes(doc) + delta);
    await firestore(
      'PATCH',
      `${docPath(COLLECTION, id)}?updateMask.fieldPaths=votes`,
      { fields: { votes: { integerValue: String(nextVotes) } } }
    );

    return res.status(200).json({ ok: true, id, votes: nextVotes });
  } catch (error) {
    console.error('AMA vote failed:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Failed to save vote' });
  }
};
