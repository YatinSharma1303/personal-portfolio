/* ============================================================
   api/visitor.js — Increment & return total unique visitors.
   Uses Firestore (same Firebase project as AMA).
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
    const baseUrl = 'https://firestore.googleapis.com/v1/projects/' + projectId() + '/databases/(default)/documents';
    const docUrl = baseUrl + '/' + COLLECTION + '/' + DOC;
    // Read current value
    const readRes = await fetch(docUrl, { headers: { Authorization: 'Bearer ' + token } });
    const doc = await readRes.json().catch(() => ({}));
    const current = doc.fields ? Number(doc.fields.total?.integerValue || doc.fields.total?.doubleValue || 0) : 0;
    // Atomic increment via commit + FieldTransform
    const commitBody = JSON.stringify({ writes: [{ transform: { document: docUrl, fieldTransforms: [{ fieldPath: 'total', increment: 1 }] } }] });
    await fetch(baseUrl + ':commit', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: commitBody });
    res.status(200).json({ ok: true, total: current + 1 });
  } catch (e) {
    res.status(200).json({ ok: true, total: 0, note: 'Visitor counting needs Firestore configured.' });
  }
};
