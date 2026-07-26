/* ============================================================
 api/_firestore.js — Shared Firestore REST helper (service account).
 Underscore prefix => not routed by Vercel.

 Extracted so the site-submit endpoint (api/telegram.js) can
 read/write Firestore for AI auto-topic (43), spam flagging (55),
 and milestone pings (49) without duplicating the OAuth plumbing.
 ============================================================ */

var crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function serviceAccount() {
  var raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_KEY');
  var parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY must contain client_email and private_key');
  return parsed;
}

function projectId() {
  return process.env.FIREBASE_PROJECT_ID || serviceAccount().project_id;
}

function docPath(collection, id) {
  return 'https://firestore.googleapis.com/v1/projects/' + projectId() + '/databases/(default)/documents/' + collection + '/' + encodeURIComponent(id);
}

function collectionUrl(collection, pageSize) {
  return 'https://firestore.googleapis.com/v1/projects/' + projectId() + '/databases/(default)/documents/' + collection + '?pageSize=' + (pageSize || 200);
}

function mask(fields) {
  return fields.map(function (f) { return 'updateMask.fieldPaths=' + encodeURIComponent(f); }).join('&');
}

var _token = null, _tokenExp = 0;
async function accessToken() {
  if (_token && Date.now() < _tokenExp - 60000) return _token;
  var sa = serviceAccount();
  var now = Math.floor(Date.now() / 1000);
  var header = { alg: 'RS256', typ: 'JWT' };
  var payload = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  var unsigned = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(payload));
  var signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  var response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature })
  });
  var data = await response.json().catch(function () { return null; });
  if (!response.ok || !data || !data.access_token) throw new Error((data && data.error_description) || 'Google token error ' + response.status);
  _token = data.access_token;
  _tokenExp = Date.now() + ((data.expires_in || 3600) * 1000);
  return _token;
}

async function firestore(method, url, body) {
  var token = await accessToken();
  var response = await fetch(url, {
    method: method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined
  });
  var data = await response.json().catch(function () { return null; });
  if (!response.ok) throw new Error((data && data.error && data.error.message) || 'Firestore ' + method + ' error ' + response.status);
  return data;
}

/* Atomically increment a numeric field on an EXISTING document via a commit
   transform (race-safe — no read-modify-write). `fieldPath` may address a map
   subfield, e.g. reactions.`👍` (emoji segments must be backtick-quoted).
   Returns the new numeric value. Throws NOT_FOUND if the document is missing. */
async function increment(collection, id, fieldPath, delta) {
  var commitUrl = 'https://firestore.googleapis.com/v1/projects/' + projectId() + '/databases/(default)/documents:commit';
  var docName = 'projects/' + projectId() + '/databases/(default)/documents/' + collection + '/' + id;
  var body = { writes: [{ transform: { document: docName, fieldTransforms: [{ fieldPath: fieldPath, increment: { integerValue: String(delta) } }] } }] };
  var data = await firestore('POST', commitUrl, body);
  var tr = data && data.writeResults && data.writeResults[0] && data.writeResults[0].transformResults && data.writeResults[0].transformResults[0];
  return tr ? Number(tr.integerValue || tr.doubleValue || 0) : null;
}

/* Backtick-quote a Firestore field-path segment (for map keys like emoji). */
function fieldPathSegment(seg) {
  return '`' + String(seg).replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
}

module.exports = { firestore: firestore, docPath: docPath, collectionUrl: collectionUrl, mask: mask, projectId: projectId, increment: increment, fieldPathSegment: fieldPathSegment };
