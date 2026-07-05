/* ============================================================
   api/reactions.js — Toggle an emoji reaction on a question.
   Reads the whole map, updates it, and saves it back to avoid URL encoding bugs with emojis.
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
  const unsigned = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(payload));
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig }) });
  const d = await r.json();
  return d.access_token;
}

async function firestore(method, path, body) {
  const token = await getToken();
  const url = 'https://firestore.googleapis.com/v1/projects/' + projectId() + '/databases/(default)/documents/' + path;
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

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

    const docPath = COLLECTION + '/' + encodeURIComponent(id);

    // 1. Read the current document
    const doc = await firestore('GET', docPath).catch(() => null);
    let reactionMap = {};
    
    if (doc && doc.fields && doc.fields.reactions && doc.fields.reactions.mapValue && doc.fields.reactions.mapValue.fields) {
      reactionMap = doc.fields.reactions.mapValue.fields;
    }

    // 2. Get current count for this specific emoji
    let currentCount = 0;
    if (reactionMap[emoji]) {
      currentCount = Number(reactionMap[emoji].integerValue || reactionMap[emoji].doubleValue || 0);
    }

    // 3. Calculate new count and update the map locally
    const newCount = Math.max(0, currentCount + delta);
    reactionMap[emoji] = { integerValue: String(newCount) };

    // 4. Send the ENTIRE updated map back (using mask "reactions" avoids emoji URL bugs)
    const updateBody = {
      fields: {
        reactions: {
          mapValue: {
            fields: reactionMap
          }
        }
      }
    };

    const updateUrl = docPath + '?updateMask.fieldPaths=reactions';
    await firestore('PATCH', updateUrl, updateBody);

    return res.status(200).json({ ok: true, id: id, emoji: emoji, newCount: newCount });
  } catch (e) {
    console.error('Reaction error:', e.message);
    return res.status(500).json({ error: e.message || 'Failed to toggle reaction' });
  }
};
