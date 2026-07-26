/* ============================================================
 api/chat.js — "Ask my portfolio" AI chatbot (item 57).
 A grounded, RAG-lite assistant that answers questions about
 Yatin using a curated knowledge base (projects + skills + bio)
 plus answered AMA Q&A passed in from the client.

 POST body: { message: string, history?: [{role,content}...],
              ama?: [{question, answer}...] }
 Returns:   { reply: string }

 Requires GROQ_API_KEY (see api/_ai.js). Without it the
 endpoint responds 503 with a friendly message.
 ============================================================ */

var ai = require('./_ai');

// Curated, hand-maintained knowledge base — kept in sync with the site.
var PROFILE = [
  'You are "Portfolio Assistant", a helpful assistant embedded on Yatin Sharma\'s personal portfolio website.',
  'Answer visitor questions about Yatin — his work, projects, skills, and background — concisely and in a warm, professional first-personal-third voice (refer to him as "Yatin", never "I").',
  '',
  'ABOUT YATIN:',
  '- Yatin Sharma is a full-stack web developer based in Agra, Uttar Pradesh, India.',
  '- He builds AI applications and web platforms end to end — frontend, backend, and ML.',
  '- Off the keyboard he enjoys watching movies and anime, cooking, and trying new tech.',
  '- GitHub: https://github.com/YatinSharma1303 · Portfolio: https://portfolio.yatinsharma.me',
  '',
  'SKILLS:',
  '- Frontend: React, JavaScript (ES6+), TypeScript, HTML & CSS, Tailwind CSS, Vite.',
  '- Backend: Python, Node.js, REST APIs, Firebase (Auth, Firestore, security rules).',
  '- AI/ML: Machine Learning, Random Forest, RAG / LLMs, FAISS vector search, Streamlit, Groq LLM.',
  '- Tools: Git & GitHub, Vercel, Telegram Bot API, Jupyter.',
  '',
  'PROJECTS:',
  '1) SmartHealthCare AI — a full-stack AI healthcare platform with four modules: Disease Prediction (Random Forest across 41 diseases), Drug Recommendation (cosine similarity over 9,720 medicines), Heart Risk Assessment (BRFSS 2022 models with PDF export), and MediBot, a RAG chatbot using FAISS + Groq LLM with voice input. Built with Python & Streamlit. Repo: https://github.com/YatinSharma1303/SmartHealthCare-For-Early-Diagnosis-Using-Artificial-Intelligence',
  '2) YatiniGPT — a custom GPT-style conversational AI web app with a clean, fast chat interface. Built with modern JavaScript, deployed on Vercel. Live: https://yatini-gpt.vercel.app/ · Repo: https://github.com/YatinSharma1303/YatiniGPT',
  '',
  'THIS PORTFOLIO ITSELF: a framework-free site (vanilla HTML/CSS/JS) backed by Vercel serverless functions, Firebase Firestore, and a Telegram admin bot. Features live GitHub/Last.fm/AniList/WakaTime integrations, an Ask-Me-Anything system, and mini games.'
].join('\n');

var GUARDRAILS = [
  '',
  'RULES:',
  '- Only answer using the knowledge base above and the ANSWERED QUESTIONS provided. If something is not covered, say you are not sure and suggest asking Yatin directly via the Ask Me Anything section.',
  '- Keep answers short (1–4 sentences unless more detail is clearly wanted). Do not invent projects, jobs, dates, or contact details.',
  '- You are not Yatin; you are an assistant answering on his behalf. Be friendly and never make things up.'
].join('\n');

function clip(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!ai.aiConfigured()) {
    res.status(503).json({ error: 'not_configured', reply: 'The AI assistant isn’t set up yet. Try the Ask Me Anything section to reach Yatin directly.' });
    return;
  }

  var body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  var message = clip(body.message, 1000).trim();
  if (!message) { res.status(400).json({ error: 'empty' }); return; }

  // Build the grounding: profile + a trimmed slice of answered AMA Q&A.
  var amaBlock = '';
  if (Array.isArray(body.ama) && body.ama.length) {
    var lines = body.ama.slice(0, 30).map(function (q) {
      return '- Q: ' + clip(q && q.question, 200) + '\n  A: ' + clip(q && q.answer, 400);
    });
    amaBlock = '\n\nANSWERED QUESTIONS (from the site’s AMA):\n' + lines.join('\n');
  }
  var system = PROFILE + amaBlock + GUARDRAILS;

  // Prior turns (cap to keep requests small); only user/assistant text.
  var messages = [];
  if (Array.isArray(body.history)) {
    body.history.slice(-8).forEach(function (m) {
      if (m && (m.role === 'user' || m.role === 'assistant') && m.content) {
        messages.push({ role: m.role, content: clip(m.content, 1500) });
      }
    });
  }
  messages.push({ role: 'user', content: message });

  try {
    var reply = await ai.complete({ system: system, messages: messages, maxTokens: 700 });
    res.status(200).json({ reply: reply || 'Sorry, I couldn’t come up with an answer for that one.' });
  } catch (err) {
    console.error('chat error:', err && err.message);
    res.status(500).json({ error: 'ai_error', reply: 'Something went wrong reaching the assistant. Please try again in a moment.' });
  }
};
