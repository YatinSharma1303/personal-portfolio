/* ============================================================
 api/digest-cron.js — scheduled AMA maintenance (items 47, 48, 56).
 Triggered by Vercel Cron (see vercel.json) or any external
 scheduler via ?secret=<CRON_SECRET>.

 On each run it:
   56. Publishes any draft whose publishAt time has passed.
   48. Warns about questions unanswered longer than AMA_STALE_HOURS.
   47. Sends a daily digest (at most once per calendar day, IST).

 Secured by CRON_SECRET (Bearer header or ?secret=), same as
 health-cron. Best-effort: individual failures are swallowed so
 one broken step never blocks the others.
 ============================================================ */

var fs = require('./_firestore');

var TELEGRAM_API = 'https://api.telegram.org/bot';
var QUESTIONS = 'amaQuestions';
var STATS = 'siteStats';
var DIGEST_STATE = 'amaDigestState';

function bool(f) { return !!(f && f.booleanValue); }
function str(f) { return (f && f.stringValue) || ''; }
function num(f) { return Number((f && (f.integerValue || f.doubleValue)) || 0); }

function parseDoc(doc) {
  var f = (doc && doc.fields) || {};
  var reactions = 0;
  if (f.reactions && f.reactions.mapValue && f.reactions.mapValue.fields) {
    var rf = f.reactions.mapValue.fields;
    Object.keys(rf).forEach(function (k) { reactions += Number(rf[k].integerValue || rf[k].doubleValue || 0); });
  }
  return {
    id: str(f.id) || (doc.name ? doc.name.split('/').pop() : ''),
    question: str(f.question),
    answer: str(f.answer),
    answered: bool(f.answered),
    dismissed: bool(f.dismissed),
    draft: bool(f.draft),
    draftAnswer: str(f.draftAnswer),
    publishAt: str(f.publishAt),
    flagged: bool(f.flagged),
    createdAt: str(f.createdAt),
    votes: num(f.votes),
    reactions: reactions
  };
}

async function listAll() {
  var out = [];
  var url = fs.collectionUrl(QUESTIONS, 300);
  while (url) {
    var data = await fs.firestore('GET', url);
    if (data.documents) out = out.concat(data.documents.map(parseDoc));
    url = data.nextPageToken ? (fs.collectionUrl(QUESTIONS, 300) + '&pageToken=' + data.nextPageToken) : null;
  }
  return out;
}

async function publishDue(q) {
  var text = q.draftAnswer || q.answer;
  if (!text) return false;
  await fs.firestore('PATCH', fs.docPath(QUESTIONS, q.id) + '?' + fs.mask(['answer', 'answered', 'answeredAt', 'dismissed', 'draft', 'draftAnswer', 'publishAt']), {
    fields: {
      answer: { stringValue: text.slice(0, 1000) },
      answered: { booleanValue: true },
      answeredAt: { stringValue: new Date().toISOString() },
      dismissed: { booleanValue: false },
      draft: { booleanValue: false },
      draftAnswer: { stringValue: '' },
      publishAt: { stringValue: '' }
    }
  });
  return true;
}

function state(q) {
  if (q.dismissed) return 'DISMISSED';
  if (q.answered || String(q.answer || '').trim()) return 'ANSWERED';
  return 'UNANSWERED';
}

async function send(text) {
  var botToken = process.env.TELEGRAM_BOT_TOKEN;
  var chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;
  try {
    await fetch(TELEGRAM_API + botToken + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
  } catch (e) {}
}

function istDate() {
  try { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); } catch (e) { return new Date().toISOString().slice(0, 10); }
}

module.exports = async function handler(req, res) {
  var secret = process.env.CRON_SECRET;
  var provided = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || (req.query && req.query.secret);
  if (!secret || provided !== secret) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) return res.status(500).json({ ok: false, error: 'no service account' });

  var result = { published: 0, staleWarned: 0, digestSent: false };
  var all;
  try { all = await listAll(); } catch (e) { return res.status(500).json({ ok: false, error: 'firestore read failed' }); }

  var now = Date.now();

  // 56. Publish drafts whose scheduled time has arrived.
  var due = all.filter(function (q) { return q.draft && q.publishAt && new Date(q.publishAt).getTime() <= now; });
  for (var i = 0; i < due.length; i++) {
    try { if (await publishDue(due[i])) result.published++; } catch (e) {}
  }
  if (result.published > 0) {
    await send('✅ <b>SCHEDULED PUBLISH</b>\nPublished <b>' + result.published + '</b> scheduled answer' + (result.published === 1 ? '' : 's') + ' to the site.');
  }

  // 48. Stale-question alert.
  var staleHours = Number(process.env.AMA_STALE_HOURS || 24);
  var staleMs = staleHours * 3600000;
  var stale = all.filter(function (q) { return state(q) === 'UNANSWERED' && q.createdAt && (now - new Date(q.createdAt).getTime()) > staleMs; });
  // Only warn once per day to avoid repeat pings on frequent crons.
  var stateDoc = null;
  try { stateDoc = await fs.firestore('GET', fs.docPath(STATS, DIGEST_STATE)); } catch (e) {}
  var today = istDate();
  var lastStale = stateDoc && str(stateDoc.fields && stateDoc.fields.lastStaleDate);
  if (stale.length && lastStale !== today) {
    result.staleWarned = stale.length;
    var oldest = stale.slice().sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); }).slice(0, 5);
    var lines = ['⏰ <b>STALE QUESTIONS</b>', '', '<b>' + stale.length + '</b> unanswered for over ' + staleHours + 'h:', ''];
    oldest.forEach(function (q) {
      var days = Math.floor((now - new Date(q.createdAt).getTime()) / 86400000);
      lines.push('🆔 <code>' + q.id + '</code> · ' + (days >= 1 ? days + 'd' : '<1d') + ' old');
      lines.push('“' + q.question.replace(/[<>&]/g, '').slice(0, 70) + '”');
    });
    lines.push('');
    lines.push('Answer them with /queue or /pending.');
    await send(lines.join('\n'));
  }

  // 47. Daily digest (at most once per IST day).
  var lastDigest = stateDoc && str(stateDoc.fields && stateDoc.fields.lastDigestDate);
  var forceDigest = req.query && req.query.digest === '1';
  if (lastDigest !== today || forceDigest) {
    var answered = all.filter(function (q) { return state(q) === 'ANSWERED'; }).length;
    var pending = all.filter(function (q) { return state(q) === 'UNANSWERED'; }).length;
    var drafts = all.filter(function (q) { return q.draft && (q.draftAnswer || q.answer); }).length;
    var flagged = all.filter(function (q) { return q.flagged && state(q) === 'UNANSWERED'; }).length;
    var last24 = all.filter(function (q) { return q.createdAt && (now - new Date(q.createdAt).getTime()) <= 86400000; }).length;
    var digest = [
      '🗞 <b>DAILY AMA DIGEST</b>',
      '',
      '📥 New (24h): <b>' + last24 + '</b>',
      '⏳ Pending: <b>' + pending + '</b>' + (stale.length ? ' (' + stale.length + ' stale)' : ''),
      '✅ Answered: <b>' + answered + '</b>',
      '📝 Drafts: <b>' + drafts + '</b>',
      flagged ? '⚠️ Flagged pending: <b>' + flagged + '</b>' : null,
      '',
      new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST'
    ].filter(function (l) { return l !== null; }).join('\n');
    await send(digest);
    result.digestSent = true;
  }

  // Persist per-day markers.
  try {
    var names = [], fields = {};
    if (result.digestSent) { fields.lastDigestDate = { stringValue: today }; names.push('lastDigestDate'); }
    if (result.staleWarned) { fields.lastStaleDate = { stringValue: today }; names.push('lastStaleDate'); }
    if (names.length) await fs.firestore('PATCH', fs.docPath(STATS, DIGEST_STATE) + '?' + fs.mask(names), { fields: fields });
  } catch (e) {}

  return res.status(200).json({ ok: true, result: result });
};
