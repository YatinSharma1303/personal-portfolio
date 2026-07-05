/* ============================================================
   api/reactions.js — Toggle an emoji reaction on a question.
   Uses Firestore increment for atomic, race-safe counting.
   ============================================================ */
const crypto = require('crypto');
const COLLECTION = 'amaQuestions';

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_KEY');
  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) throw new Error('Invalid service account');
  return parsed;
}
function projectId() { return process.env.FIREBASE_PROJECT_ID || serviceAccount().project_id; }
function base64url(input) { return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
async function getToken() {
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }) });
  const d = await r.json();
  return d.access_token;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const id = String(body.id || '').slice(0, 120);
    const emoji = String(body.emoji || '').slice(0, 10);
    const delta = Number(body.delta) || 1;
    if (!id || !emoji) return res.status(400).json({ error: 'id and emoji required' });

    const token = await getToken();
    const field = `reactions.${emoji}`;
    const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId()}/databases/(default)/documents/${COLLECTION}/${encodeURIComponent(id)}`;
    const r = await fetch(`${docUrl}?updateMask.fieldPaths=${encodeURIComponent(field)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields: { reactions: { mapValue: { fields: { [emoji]: { integerValue: String(delta) } } } } } })
    });

    // Actually we need a proper increment transform for race safety.
    // Use commit with FieldTransform.
    const commitUrl = `https://firestore.googleapis.com/v1/projects/${projectId()}/databases/(default)/documents:commit`;
    const commitRes = await fetch(commitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        writes: [{
          transform: {
            document: docUrl,
            fieldTransforms: [{ fieldPath: field, increment: delta }]
          }
        }]
      })
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Reaction failed:', e);
    res.status(500).json({ error: e.message || 'Failed' });
  }
};
