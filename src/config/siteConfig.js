// ============================================================================
//  SITE CONFIG — edit everything about your site from this one file.
//  (API keys live in the .env file, NOT here.)
// ============================================================================

export const site = {
  // ── 1. IDENTITY ──────────────────────────────────────────────────────────
  name: 'Yatin Sharma',
  handle: 'yatin',
  initial: 'y',                 // shown in the intro animation + logo
  title: 'Full-Stack Web Developer',
  tagline: ['Building software', 'end to end.'],   // two lines of the hero headline
  subtitle: 'AI apps. Web platforms. Bots.',
  heroLine:
    'Shipping full-stack web experiences — from clean front-ends to the models and APIs behind them.',
  bio: [
    "I'm Yatin Sharma — a full-stack web developer who likes owning a product from the database to the pixel. I build AI-powered apps, web platforms, and automation bots, and I care about things that actually ship and work.",
    'Lately I work across React and modern JavaScript on the front end, with Python, machine learning, and Streamlit driving the intelligence underneath. From a 41-disease diagnosis platform to a custom GPT app, I like turning ambitious ideas into things people can use.',
    "Off the keyboard I'm usually watching movies and anime, cooking something, or chasing the next thing I haven't tried yet.",
  ],

  email: 'yatinsharma1303@gmail.com',
  copyrightName: 'Yatin Sharma',
  footerTagline: 'Full-stack. End to end. No shortcuts.',

  // ── BIO CARD (About widgets) ──────────────────────────────────────────────
  profile: {
    country: 'India',
    countryFlag: '🇮🇳',
    city: 'Agra',
    interests:
      'Full-stack tinkering, AI experiments, and shipping side projects. Off-screen: movies and anime, cooking something new, and chasing whatever idea I haven’t tried yet.',
    nowStatus: 'building · shipping · breaking things',
    dailyStack: ['VS Code', 'React', 'Python', 'Git & GitHub', 'Vercel', 'ChatGPT', 'Streamlit', 'Firebase'],
  },

  // Your timezone for the dual clock (IANA name + label)
  clock: { tz: 'Asia/Kolkata', label: 'India · IST', gmt: 'GMT+5:30' },

  // Rotating quotes (anime + dev mix)
  quotes: [
    { text: 'Hard work is worthless for those that don’t believe in themselves.', by: 'Naruto' },
    { text: 'Talk is cheap. Show me the code.', by: 'Linus Torvalds' },
    { text: 'A lesson without pain is meaningless.', by: 'Edward Elric' },
    { text: 'First, solve the problem. Then, write the code.', by: 'John Johnson' },
    { text: 'The world isn’t perfect. But it’s there for us, doing the best it can.', by: 'Roy Mustang' },
    { text: 'Code is like humor. When you have to explain it, it’s bad.', by: 'Cory House' },
  ],

  // ── 2. SOCIAL LINKS (empty string = hidden) ──────────────────────────────
  socials: {
    github: 'https://github.com/YatinSharma1303',
    telegram: 'https://t.me/YatinSharma1303',
    instagram: '',
    discord: '',
    youtube: '',
    twitter: '',
    linkedin: '',
    linktree: '',
  },

  // ── 3. SKILLS (tabs) ─────────────────────────────────────────────────────
  skillTabs: ['ALL', 'FRONTEND', 'BACKEND', 'AI/ML', 'TOOLS'],
  skills: [
    { name: 'React',            cat: 'FRONTEND', icon: 'deployed_code', desc: 'Components, hooks, state, and clean SPA architecture.' },
    { name: 'JavaScript',       cat: 'FRONTEND', icon: 'javascript', desc: 'ES6+, async/await, DOM, and modern tooling.' },
    { name: 'TypeScript',       cat: 'FRONTEND', icon: 'data_object', desc: 'Typed JS for safer, scalable codebases.' },
    { name: 'HTML & CSS',       cat: 'FRONTEND', icon: 'palette', desc: 'Semantic markup, responsive layouts, animations.' },
    { name: 'Tailwind CSS',     cat: 'FRONTEND', icon: 'styler', desc: 'Utility-first styling for fast, consistent UIs.' },
    { name: 'Vite',             cat: 'FRONTEND', icon: 'bolt', desc: 'Lightning-fast dev server and optimized builds.' },
    { name: 'Python',           cat: 'BACKEND',  icon: 'terminal', desc: 'Backends, scripting, data, and ML pipelines.' },
    { name: 'Node.js',          cat: 'BACKEND',  icon: 'dns', desc: 'Server-side JS, APIs, and tooling.' },
    { name: 'REST APIs',        cat: 'BACKEND',  icon: 'api', desc: 'Designing and consuming clean HTTP APIs.' },
    { name: 'Firebase',         cat: 'BACKEND',  icon: 'local_fire_department', desc: 'Auth, Firestore, and rules-based security.' },
    { name: 'Machine Learning', cat: 'AI/ML',    icon: 'neurology', desc: 'Training, evaluating and shipping models.' },
    { name: 'Random Forest',    cat: 'AI/ML',    icon: 'forest', desc: 'Classification across 41 diseases in production.' },
    { name: 'RAG / LLMs',       cat: 'AI/ML',    icon: 'smart_toy', desc: 'Retrieval-augmented chatbots with real context.' },
    { name: 'FAISS',            cat: 'AI/ML',    icon: 'travel_explore', desc: 'Vector similarity search at scale.' },
    { name: 'Streamlit',        cat: 'AI/ML',    icon: 'monitoring', desc: 'Rapid data & ML app interfaces.' },
    { name: 'Groq LLM',         cat: 'AI/ML',    icon: 'settings_suggest', desc: 'Fast LLM inference for chat features.' },
    { name: 'Git & GitHub',     cat: 'TOOLS',    icon: 'commit', desc: 'Version control, branching, collaboration.' },
    { name: 'Vercel',           cat: 'TOOLS',    icon: 'change_history', desc: 'CI/CD deploys with env-var management.' },
    { name: 'Telegram Bot API', cat: 'TOOLS',    icon: 'send', desc: 'Automation bots and file/utility tools.' },
    { name: 'Jupyter',          cat: 'TOOLS',    icon: 'menu_book', desc: 'Notebooks for ML prototyping and analysis.' },
  ],

  // ── 4. PROJECTS ──────────────────────────────────────────────────────────
  projects: [
    {
      name: 'SmartHealthCare AI',
      meta: 'AI Healthcare Platform · Python · Streamlit',
      desc:
        'A full-stack AI healthcare platform with four modules — Disease Prediction (Random Forest, 41 diseases), Drug Recommendation (cosine similarity over 9,720 medicines), Heart Risk Assessment (BRFSS 2022 models with PDF export), and MediBot, a RAG chatbot using FAISS + Groq LLM with voice input.',
      tags: ['Python', 'ML', 'Streamlit', 'RAG', 'FAISS'],
      link: 'https://github.com/YatinSharma1303/SmartHealthCare-For-Early-Diagnosis-Using-Artificial-Intelligence',
      image: '/projects/smarthealthcare.png',
    },
    {
      name: 'YatiniGPT',
      meta: 'AI Chat App · JavaScript · Live on Vercel',
      desc:
        'A custom GPT-style conversational AI web app with a clean, fast chat interface. Built with modern JavaScript and deployed on Vercel — type a prompt, get a streamed answer, all wrapped in a minimal UI.',
      tags: ['JavaScript', 'AI', 'Vercel'],
      link: 'https://yatini-gpt.vercel.app',
      image: '/projects/yatinigpt.png',
    },
  ],

  // ── 5. LIVE WIDGETS (username, or null to hide) ──────────────────────────
  widgets: {
    lastfm: 'YATINSHARMA',
    anilist: 'YatinSharma1303',
    github: 'YatinSharma1303',
  },

  // ── 6. MUSIC PLAYER ──────────────────────────────────────────────────────
  // Soothing, lyric-free instrumental. Swap videoId anytime.
  music: {
    videoId: 'y5PW7rqXUhk',          // Tsuisou — Michiru Oshima
    title: 'Tsuisou',
    artist: 'Michiru Oshima',
    defaultVolume: 70,
  },

  // ── 7. INTERESTS ─────────────────────────────────────────────────────────
  interests: [
    { icon: 'movie', name: 'Movies & Anime', line: 'Great stories and great pacing — the same craft that makes good software makes good cinema.' },
    { icon: 'skillet', name: 'Cooking', line: 'Following a recipe is just debugging with better rewards. I like making something real with my hands.' },
    { icon: 'explore', name: 'Exploring New Things', line: 'Endless curiosity — picking up new tools, ideas and hobbies is half the fun of building.' },
  ],

  // ── 8. ASK ME ANYTHING ───────────────────────────────────────────────────
  ama: {
    mode: 'full',                   // 'full' (Firebase) | 'formspree' | 'off'
    dailyLimit: 20,                 // questions a single visitor can send per day
    collection: 'amaQuestions',
  },

  // ── 9. GAMES ─────────────────────────────────────────────────────────────
  games: [
    { id: 'snake',       name: 'Snake',         glyph: 'gesture',       desc: 'Classic game. High chance of self-sabotage.' },
    { id: 'pong',        name: 'Ping Pong',     glyph: 'sports_tennis', desc: 'You vs an AI paddle. First to 5 wins.' },
    { id: 'quiz',        name: 'Tech Quiz',     glyph: 'quiz',          desc: 'Trivia that quietly judges your stack.' },
    { id: 'flappy',      name: 'Flappy',        glyph: 'flutter',       desc: 'Infuriating physics. Avoid the pipes.' },
    { id: 'minesweeper', name: 'Minesweeper',   glyph: 'flag',          desc: 'Classic logic. Avoid the mines.' },
    { id: 'reaction',    name: 'Reaction Test', glyph: 'bolt',          desc: 'Click when it turns green. Exposes slow reflexes.' },
    { id: 'dodge',       name: 'Dodge',         glyph: 'shapes',        desc: 'Survive against angry geometry.' },
  ],
};

export default site;
