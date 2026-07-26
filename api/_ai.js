/* ============================================================
 api/_ai.js — Shared Anthropic (Claude) helper.
 Underscore prefix => Vercel does NOT route this as an endpoint.

 Used by:
   - /api/telegram-webhook  (/draft, /improve, /shorten, /expand)
   - /api/telegram          (AI-assisted auto-topic, spam scoring)
   - /api/chat              ("Ask my portfolio" RAG chatbot)

 Requires env var ANTHROPIC_API_KEY. Optional ANTHROPIC_MODEL
 (defaults to claude-opus-5). Every helper degrades gracefully:
 aiConfigured() lets callers show a friendly "not set up" message
 instead of crashing when the key is absent.
 ============================================================ */

var ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
var DEFAULT_MODEL = 'claude-opus-5';

function aiConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function model() {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

// Defensively strip any leaked <thinking> tags (a known edge case when
// thinking is disabled on some models) so users never see internal markup.
function stripThinking(text) {
  return String(text || '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<\/?thinking>/gi, '')
    .trim();
}

/* Low-level call. Returns the concatenated text of the response.
   opts: { system, messages, maxTokens } — messages is the Claude
   messages array; if omitted, `prompt` (a string) is used as a single
   user turn. */
async function claude(opts) {
  opts = opts || {};
  if (!aiConfigured()) throw new Error('ANTHROPIC_API_KEY is not set');
  var messages = opts.messages || [{ role: 'user', content: String(opts.prompt || '') }];
  var body = {
    model: model(),
    max_tokens: opts.maxTokens || 1024,
    // Deterministic text tasks — keep it fast and avoid thinking/answer
    // sharing the token budget. Disabled is accepted at the default effort.
    thinking: { type: 'disabled' },
    messages: messages
  };
  if (opts.system) body.system = opts.system;

  var res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  var data = await res.json().catch(function () { return null; });
  if (!res.ok) {
    var msg = (data && data.error && data.error.message) || ('Anthropic HTTP ' + res.status);
    throw new Error(msg);
  }
  if (data && data.stop_reason === 'refusal') {
    throw new Error('The model declined to answer this request.');
  }
  var out = '';
  var blocks = (data && data.content) || [];
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i] && blocks[i].type === 'text') out += blocks[i].text;
  }
  return stripThinking(out);
}

module.exports = { aiConfigured: aiConfigured, model: model, claude: claude, stripThinking: stripThinking };
