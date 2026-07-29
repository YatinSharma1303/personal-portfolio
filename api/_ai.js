/* ============================================================
 api/_ai.js — Shared AI helper (Groq, OpenAI-compatible API).
 Underscore prefix => Vercel does NOT route this as an endpoint.

 Used by:
   - /api/telegram-webhook  (/draft, /improve, /shorten, /expand)
   - /api/telegram          (AI-assisted auto-topic)
   - /api/chat              ("Ask my portfolio" chatbot)

 Requires env var GROQ_API_KEY (free tier: https://console.groq.com).
 Optional GROQ_MODEL (defaults to llama-3.3-70b-versatile).
 Every helper degrades gracefully: aiConfigured() lets callers show a
 friendly "not set up" message instead of crashing when the key is absent.
 ============================================================ */

var GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
var DEFAULT_MODEL = 'llama-3.3-70b-versatile';

function aiConfigured() {
  return !!process.env.GROQ_API_KEY;
}

function model() {
  return process.env.GROQ_MODEL || DEFAULT_MODEL;
}

// Some open models emit <think>…</think> reasoning; strip it defensively
// so users never see internal markup (llama models don't, but this is cheap).
function stripThinking(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim();
}

/* Low-level call. Returns the response text.
   opts: { system, messages, prompt, maxTokens }
   - messages: an OpenAI-style [{role,content}] array (role: user|assistant)
   - or prompt: a single user string (used when messages is omitted)
   The system prompt is prepended as a system message. */
async function complete(opts) {
  opts = opts || {};
  if (!aiConfigured()) throw new Error('GROQ_API_KEY is not set');

  var messages = [];
  if (opts.system) messages.push({ role: 'system', content: String(opts.system) });
  if (opts.messages && opts.messages.length) {
    opts.messages.forEach(function (m) {
      if (m && (m.role === 'user' || m.role === 'assistant') && m.content != null) {
        messages.push({ role: m.role, content: String(m.content) });
      }
    });
  } else {
    messages.push({ role: 'user', content: String(opts.prompt || '') });
  }

  var body = {
    model: model(),
    messages: messages,
    max_tokens: opts.maxTokens || 1024,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.6
  };

  var res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer ' + process.env.GROQ_API_KEY
    },
    body: JSON.stringify(body)
  });
  var data = await res.json().catch(function () { return null; });
  if (!res.ok) {
    var msg = (data && data.error && (data.error.message || data.error)) || ('Groq HTTP ' + res.status);
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  var out = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  return stripThinking(out);
}

module.exports = {
  aiConfigured: aiConfigured,
  model: model,
  complete: complete,
  // Back-compat alias so existing callers using .claude keep working.
  claude: complete,
  stripThinking: stripThinking
};
