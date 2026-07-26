/* ============================================================
   api/health-cron.js — periodic AMA bot health check.
   Triggered by Vercel Cron (see vercel.json) or any external
   scheduler (cron-job.org / GitHub Actions) via ?secret=.

   Secured by CRON_SECRET:
     - Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`
     - external callers may use `?secret=<CRON_SECRET>`
   Posts a structured health line to your Telegram log/admin chat.
   ============================================================ */
var crypto = require('crypto');
var TELEGRAM_API = 'https://api.telegram.org/bot';
var COLLECTION = 'amaQuestions';

function serviceAccount() {
  var raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_KEY');
  var p = JSON.parse(raw);
  if (!p.client_email || !p.private_key) throw new Error('Invalid service account');
  return p;
}
function projectId() { return process.env.FIREBASE_PROJECT_ID || serviceAccount().project_id; }
function base64url(s) { return Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }

async function accessToken() {
  var sa = serviceAccount();
  var now = Math.floor(Date.now() / 1000);
  var h = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var p = base64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  var unsigned = h + '.' + p;
  var sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  var r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig }) });
  var d = await r.json();
  if (!d.access_token) throw new Error('Google token error');
  return d.access_token;
}

async function firestoreReachable() {
  try {
    var tok = await accessToken();
    var url = 'https://firestore.googleapis.com/v1/projects/' + projectId() + '/databases/(default)/documents:runQuery';
    var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: COLLECTION }], limit: 1 } }) });
    return r.ok;
  } catch (e) { return false; }
}

async function notify(overall, fields) {
  var botToken = process.env.TELEGRAM_BOT_TOKEN;
  var chatId = process.env.TELEGRAM_LOG_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;
  var text = (overall ? '\u2705' : '\u26A0\uFE0F') + ' <b>SCHEDULED HEALTH CHECK</b>\n' +
    Object.keys(fields).map(function (k) { return k + ': <b>' + fields[k] + '</b>'; }).join('\n');
  try {
    await fetch(TELEGRAM_API + botToken + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true }) });
  } catch (e) {}
}

module.exports = async function handler(req, res) {
  var secret = process.env.CRON_SECRET;
  var provided = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || (req.query && req.query.secret);
  if (!secret || provided !== secret) return res.status(401).json({ ok: false, error: 'unauthorized' });

  var tokenOk = !!process.env.TELEGRAM_BOT_TOKEN;
  var saOk = !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  var secretOk = !!process.env.TELEGRAM_WEBHOOK_SECRET;
  var chatIdOk = !!process.env.TELEGRAM_CHAT_ID;
  var okFirestore = await firestoreReachable();
  var overall = tokenOk && saOk && secretOk && chatIdOk && okFirestore;

  await notify(overall, {
    'Telegram token': tokenOk ? 'OK' : 'MISSING',
    'Service account': saOk ? 'OK' : 'MISSING',
    'Webhook secret': secretOk ? 'OK' : 'MISSING',
    'Admin chat ID': chatIdOk ? 'OK' : 'MISSING',
    'Firestore': okFirestore ? 'OK' : 'ERROR',
    'Status': overall ? 'Operational' : 'Issues detected',
    'Checked': new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST'
  });

  return res.status(200).json({ ok: true, operational: overall, telegram: tokenOk, serviceAccount: saOk, webhookSecret: secretOk, chatId: chatIdOk, firestore: okFirestore });
};
