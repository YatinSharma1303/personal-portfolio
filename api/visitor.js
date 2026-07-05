/* ============================================================
   api/visitor.js — Increment & return total unique visitors.
   Uses Firestore. Creates the doc on first run.
   ============================================================ */
const crypto = require('crypto');
const COLLECTION = 'siteStats';
const DOC = 'visitors';

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  try {
    const token = await getToken();
    const docUrl = 'https://firestore.googleapis.com/v1/projects/' + projectId() + '/databases/(default)/documents/' + COLLECTION + '/' + DOC;

    // Try to read the current count.
    const readRes = await fetch(docUrl, { headers: { Authorization: 'Bearer ' + token } });

    if (readRes.status === 404) {
      // First visitor ever — create the document with total: 1.
      await fetch(docUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ fields: { total: { integerValue: '1' } } })
      });
      return res.status(200).json({ ok: true, total: 1 });
    }

    const doc = await readRes.json().catch(() => null);
    const current = doc && doc.fields ? Number(doc.fields.total && (doc.fields.total.integerValue || doc.fields.total.doubleValue) || 0) : 0;
    const next = current + 1;

    // Write back the incremented value.
    await fetch(docUrl + '?updateMask.fieldPaths=total', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ fields: { total: { integerValue: String(next) } } })
    });

    return res.status(200).json({ ok: true, total: next });
  } catch (e) {
    return res.status(200).json({ ok: true, total: 0 });
  }
};
