/* ============================================================
   api/health-cron.js — periodic AMA bot health check.
   Triggered by Vercel Cron (see vercel.json) or any external
   scheduler (cron-job.org / GitHub Actions) via ?secret=.

   Secured by CRON_SECRET:
     - Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`
     - external callers may use `?secret=<CRON_SECRET>`
   Posts a structured health line to your Telegram log/admin chat.
   ============================================================ */
var TELEGRAM_API = 'https://api.telegram.org/bot';
var COLLECTION = 'amaQuestions';
var store = require('./_firestore');

async function firestoreReachable() {
  try {
    var url = 'https://firestore.googleapis.com/v1/projects/' + store.projectId() + '/databases/(default)/documents:runQuery';
    await store.firestore('POST', url, { structuredQuery: { from: [{ collectionId: COLLECTION }], limit: 1 } });
    return true;
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
