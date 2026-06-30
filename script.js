/* ============================================================
   YATIN SHARMA — PORTFOLIO · script.js
   Vanilla JS · YouTube music · GitHub · Last.fm · AniList ·
   AMA (Firestore+Telegram+voting) · time · parallax · counters
   ============================================================ */
(function () {
  'use strict';

  /* ── CONFIG ─────────────────────────────────────────── */
  const CONFIG = {
    githubUser: 'YatinSharma1303',
    lastfmUser: 'YATINSHARMA',
    anilistUser: 'YatinSharma1303',
    lastfmKey: 'ff50164039e4af6c3662d01fcb66877d', // ⚠️ Replace with YOUR Last.fm key (last.fm/api/account/create)
    ytVideoId: 'y5PW7rqXUhk', // Tsuisou — Michiru Oshima (YouTube embed)
    amaLimit: 20,
    firebase: {
      apiKey: 'AIzaSyBA2du9aSIi7xoDttbICzmEd-nq0W39zrU',
      projectId: 'portfolio-yatin'
    },
    amaCollection: 'amaQuestions',
    timezone: 'Asia/Kolkata'
  };

  const $ = (id) => document.getElementById(id);
  const esc = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ============================================================
     1. INTRO / PRELOADER
     ============================================================ */
  (function intro() {
    const overlay = $('intro-overlay');
    if (!overlay) return;
    let done = false, dismissed = false;
    const TOTAL = 4; let finished = 0;
    const tick = () => { finished++; if (finished >= TOTAL || done) ready(); };
    const HARD = 5000;
    setTimeout(() => { if (!done) ready(); }, HARD);
    function ready() { if (done) return; done = true; overlay.classList.add('hint-ready'); }
    function dismiss() {
      if (dismissed || !done) return; dismissed = true;
      overlay.classList.add('hidden'); setTimeout(() => { overlay.style.display = 'none'; }, 600);
      // Autoplay music on user-initiated entry into the site.
      try { doPlay(); } catch (e) {}
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(tick).catch(tick); else tick();
    tick();
    fetchGitHub().then(tick).catch(tick);
    fetchLastfm().then(tick).catch(tick);
    setTimeout(() => { if (!dismissed) { ready(); dismiss(); } }, HARD + 3000);
    overlay.addEventListener('click', () => { ready(); dismiss(); });
    overlay.addEventListener('pointerup', () => { ready(); dismiss(); });
    const enterKeys = ['ArrowDown', 'Space', 'Enter', 'PageDown', 'Escape'];
    window.addEventListener('keydown', (e) => { if (enterKeys.includes(e.code)) { ready(); dismiss(); } }, { once: true });
    window.addEventListener('wheel', (e) => { if (e.deltaY > 30) { ready(); dismiss(); } }, { once: true, passive: true });
    let sy = 0;
    overlay.addEventListener('touchstart', (e) => { sy = e.touches[0].clientY; }, { passive: true });
    overlay.addEventListener('touchend', (e) => { if (sy - e.changedTouches[0].clientY > 40) { ready(); dismiss(); } }, { passive: true });
  })();

  /* ============================================================
     2. CLICK SPLASH
     ============================================================ */
  (function splash() {
    const s = $('click-splash'), si = $('click-splash-inner');
    if (!s || !si) return;
    document.addEventListener('click', (e) => {
      const t = e.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || t === 'A' || t === 'BUTTON') return;
      [s, si].forEach(el => { el.style.left = e.clientX + 'px'; el.style.top = e.clientY + 'px'; el.classList.remove('animating'); void el.offsetWidth; el.classList.add('animating'); });
    });
  })();

  /* ============================================================
     3. THEME TOGGLE
     ============================================================ */
  (function theme() {
    const btn = $('theme-toggle-btn');
    const saved = localStorage.getItem('theme');
    if (saved === 'light') document.documentElement.classList.add('light');
    if (btn) btn.addEventListener('click', () => {
      document.documentElement.classList.toggle('light');
      localStorage.setItem('theme', document.documentElement.classList.contains('light') ? 'light' : 'dark');
    });
  })();

  /* ============================================================
     4. MUSIC PLAYER (YouTube IFrame API — bulletproof edition)
     Handles: delayed API load, play-intent queuing, errors, state sync, loop.
     ============================================================ */
  let ytPlayer = null, ytReady = false, ytError = false, wantPlay = false, isPlaying = false;
  const playerPanel = $('slide-music-player');
  const musicWidget = $('topbar-music-icon');

  function setVisuals(playing) {
    isPlaying = playing;
    if (playerPanel) playerPanel.classList.toggle('playing', playing);
    const disc = $('tb-music-disc'); if (disc) disc.classList.toggle('playing', playing);
    const eq = $('tb-eq-bars'); if (eq) eq.classList.toggle('playing', playing);
    const vinyl = $('sp-vinyl'); if (vinyl) vinyl.classList.toggle('playing', playing);
  }

  window.onYouTubeIframeAPIReady = function () {
    if (typeof YT === 'undefined' || !YT.Player) { ytError = true; return; }
    try {
      ytPlayer = new YT.Player('yt-music-iframe', {
        videoId: CONFIG.ytVideoId,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1, rel: 0, iv_load_policy: 3 },
        events: {
          onReady: function () {
            ytReady = true;
            try { ytPlayer.setVolume(70); } catch (e) {}
            if (wantPlay) { try { ytPlayer.playVideo(); } catch (e) {} }
          },
          onStateChange: function (e) {
            if (e.data === 1) { setVisuals(true); progressLoop(); }          // playing
            else if (e.data === 2) { setVisuals(false); }                     // paused
            else if (e.data === 0) {                                          // ended — loop back to start
              if (wantPlay) { try { ytPlayer.seekTo(0); ytPlayer.playVideo(); } catch (er) {} }
              else setVisuals(false);
            }
          },
          onError: function (e) {
            ytError = true; setVisuals(false);
            console.warn('YouTube player error:', e.data);
          }
        }
      });
    } catch (err) { ytError = true; console.warn('YT.Player init failed:', err); }
  };

  // Load the IFrame API.
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
  // Safety net: if the API never calls back in 8s, flag error so UI doesn't hang.
  setTimeout(function () { if (!ytReady && !ytError) { ytError = true; } }, 8000);

  function doPlay() {
    if (ytError) return;
    wantPlay = true;
    if (!ytReady) { setVisuals(true); return; }  // queue intent
    try { ytPlayer.playVideo(); } catch (e) {}
  }
  function doPause() {
    wantPlay = false;
    if (!ytReady) { setVisuals(false); return; }
    try { ytPlayer.pauseVideo(); } catch (e) {}
  }
  function togglePlay() { if (isPlaying) doPause(); else doPlay(); }

  function setVolume(v) { if (ytReady) { try { ytPlayer.setVolume(v); } catch (e) {} } }

  function fmt(t) { t = Math.max(0, Math.floor(t || 0)); const m = Math.floor(t / 60); const s = t % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  let loopId = null;
  function progressLoop() {
    cancelAnimationFrame(loopId);
    (function step() {
      if (!ytReady || !isPlaying) return;
      let cur = 0, dur = 0;
      try { cur = ytPlayer.getCurrentTime() || 0; dur = ytPlayer.getDuration() || 0; } catch (e) {}
      const ct = $('sp-curr-time'), dt = $('sp-duration'), fl = $('sp-progress-fill');
      if (ct) ct.textContent = fmt(cur); if (dt) dt.textContent = fmt(dur);
      if (fl) fl.style.width = (dur ? (cur / dur * 100) : 0) + '%';
      loopId = requestAnimationFrame(step);
    })();
  }

  // Topbar music widget click → open panel + start playing.
  if (musicWidget) musicWidget.addEventListener('click', function () {
    if (playerPanel) playerPanel.classList.toggle('open');
    if (playerPanel && playerPanel.classList.contains('open') && !isPlaying) doPlay();
  });

  // Panel play/pause button.
  const playBtn = $('sp-play-btn');
  if (playBtn) playBtn.addEventListener('click', togglePlay);

  // Volume slider.
  const volSlider = $('sp-vol-slider');
  if (volSlider) volSlider.addEventListener('input', function (e) {
    const v = e.target.value; setVolume(v);
    const lbl = $('sp-vol-val'); if (lbl) lbl.textContent = v + '%';
  });

  // Seek bar.
  const pBar = $('sp-progress-bar');
  if (pBar) pBar.addEventListener('click', function (e) {
    if (!ytReady) return;
    const r = pBar.getBoundingClientRect();
    try { ytPlayer.seekTo(((e.clientX - r.left) / r.width) * (ytPlayer.getDuration() || 0), true); } catch (err) {}
  });

  /* ============================================================
     5. SKILLS
     ============================================================ */
  const SKILLS = [
    { cat: 'FRONTEND', icon: 'code', name: 'React', desc: 'Components, hooks, state, and clean SPA architecture.' },
    { cat: 'FRONTEND', icon: 'code_blocks', name: 'JavaScript', desc: 'ES6+, async/await, DOM, and modern tooling.' },
    { cat: 'FRONTEND', icon: 'data_object', name: 'TypeScript', desc: 'Typed JS for safer, scalable codebases.' },
    { cat: 'FRONTEND', icon: 'palette', name: 'HTML & CSS', desc: 'Semantic markup, responsive layouts, animations.' },
    { cat: 'FRONTEND', icon: 'style', name: 'Tailwind CSS', desc: 'Utility-first styling for fast, consistent UIs.' },
    { cat: 'FRONTEND', icon: 'bolt', name: 'Vite', desc: 'Lightning-fast dev server and optimized builds.' },
    { cat: 'BACKEND', icon: 'terminal', name: 'Python', desc: 'Backends, scripting, data, and ML pipelines.' },
    { cat: 'BACKEND', icon: 'dns', name: 'Node.js', desc: 'Server-side JS, APIs, and tooling.' },
    { cat: 'BACKEND', icon: 'api', name: 'REST APIs', desc: 'Designing and consuming clean HTTP APIs.' },
    { cat: 'BACKEND', icon: 'local_fire_department', name: 'Firebase', desc: 'Auth, Firestore, and rules-based security.' },
    { cat: 'AI/ML', icon: 'neurology', name: 'Machine Learning', desc: 'Training, evaluating and shipping models.' },
    { cat: 'AI/ML', icon: 'forest', name: 'Random Forest', desc: 'Classification across 41 diseases in production.' },
    { cat: 'AI/ML', icon: 'smart_toy', name: 'RAG / LLMs', desc: 'Retrieval-augmented chatbots with real context.' },
    { cat: 'AI/ML', icon: 'travel_explore', name: 'FAISS', desc: 'Vector similarity search at scale.' },
    { cat: 'AI/ML', icon: 'monitoring', name: 'Streamlit', desc: 'Rapid data & ML app interfaces.' },
    { cat: 'AI/ML', icon: 'settings_suggest', name: 'Groq LLM', desc: 'Fast LLM inference for chat features.' },
    { cat: 'TOOLS', icon: 'commit', name: 'Git & GitHub', desc: 'Version control, branching, collaboration.' },
    { cat: 'TOOLS', icon: 'change_history', name: 'Vercel', desc: 'CI/CD deploys with env-var management.' },
    { cat: 'TOOLS', icon: 'send', name: 'Telegram Bot API', desc: 'Automation bots and file/utility tools.' },
    { cat: 'TOOLS', icon: 'menu_book', name: 'Jupyter', desc: 'Notebooks for ML prototyping and analysis.' }
  ];
  (function skills() {
    const list = $('skill-list'), tabs = $('skill-tabs'); if (!list) return;
    function render(cat) {
      const items = cat === 'ALL' ? SKILLS : SKILLS.filter(s => s.cat === cat);
      $('skill-count').textContent = items.length + ' skills';
      list.innerHTML = items.map(s => `<div class="skill-item"><div class="skill-item-head"><span class="skill-item-icon material-symbols-outlined">${s.icon}</span><span class="skill-item-name">${s.name}</span><span class="skill-item-cat">${s.cat}</span></div><div class="skill-item-desc">${s.desc}</div></div>`).join('');
    }
    render('ALL');
    if (tabs) tabs.addEventListener('click', (e) => { const t = e.target.closest('.skill-tab'); if (!t) return; tabs.querySelectorAll('.skill-tab').forEach(b => b.classList.remove('active')); t.classList.add('active'); render(t.dataset.cat); });
  })();

  /* ============================================================
     6. PROJECTS (styled Source / Live buttons)
     ============================================================ */
  const PROJECTS = [
    {
      cat: 'AI Healthcare Platform · Python · Streamlit',
      name: 'SmartHealthCare AI',
      desc: 'A full-stack AI healthcare platform with four modules — Disease Prediction (Random Forest, 41 diseases), Drug Recommendation (cosine similarity over 9,720 medicines), Heart Risk Assessment (BRFSS 2022 models with PDF export), and MediBot, a RAG chatbot using FAISS + Groq LLM with voice input.',
      tags: ['Python', 'ML', 'Streamlit', 'RAG', 'FAISS'],
      repo: 'https://github.com/YatinSharma1303/SmartHealthCare-For-Early-Diagnosis-Using-Artificial-Intelligence',
      live: null,
      gradient: 'linear-gradient(135deg, #0ea5e9, #6366f1, #8b5cf6)'
    },
    {
      cat: 'AI Chat App · JavaScript · Live on Vercel',
      name: 'YatiniGPT',
      desc: 'A custom GPT-style conversational AI web app with a clean, fast chat interface. Built with modern JavaScript and deployed on Vercel — type a prompt, get a streamed answer, all wrapped in a minimal UI.',
      tags: ['JavaScript', 'AI', 'Vercel'],
      repo: 'https://github.com/YatinSharma1303/YatiniGPT',
      live: 'https://yatini-gpt.vercel.app/',
      gradient: 'linear-gradient(135deg, #10b981, #06b6d4, #3b82f6)'
    }
  ];
  (function projects() {
    const grid = $('projects-grid'); if (!grid) return;
    grid.innerHTML = PROJECTS.map(p => {
      const initials = p.name.split(' ').map(w => w[0]).join('');
      return `<article class="project-card">
        <div class="project-thumb" style="background:${p.gradient};display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;color:rgba(255,255,255,0.85);font-size:22px;font-weight:700;">${initials}</div>
        <div class="project-body">
          <div class="project-cat">${p.cat}</div>
          <div class="project-name">${p.name}</div>
          <div class="project-desc">${p.desc}</div>
          <div class="project-tags">${p.tags.map(t => `<span>${t}</span>`).join('')}</div>
          <div class="project-actions">
            <a class="project-dl-btn" href="${p.repo}" target="_blank" rel="noopener">↓ Source</a>
            ${p.live ? `<a class="project-live-btn" href="${p.live}" target="_blank" rel="noopener">↗ Live Demo</a>` : ''}
          </div>
        </div>
      </article>`;
    }).join('');
  })();

  /* ============================================================
     7. GITHUB (profile + repos)
     ============================================================ */
  function fetchGitHub() {
    const user = CONFIG.githubUser;
    return fetch(`https://api.github.com/users/${user}`).then(r => r.json()).then(d => {
      if (!d || d.message) return;
      const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      set('gh-name', d.name || user);
      animateCounter('gh-repos', d.public_repos ?? 0);
      animateCounter('gh-followers', d.followers ?? 0);
      animateCounter('gh-following', d.following ?? 0);
      const av = $('gh-avatar'); if (av && d.avatar_url) av.src = d.avatar_url;
    }).then(() =>
      fetch(`https://api.github.com/users/${user}/repos?per_page=6&sort=updated`).then(r => r.json()).then(repos => {
        const wrap = $('gh-repos-list'); if (!wrap || !Array.isArray(repos)) return;
        const LANG = { JavaScript: '#f1e05a', Python: '#3572A5', TypeScript: '#3178c6', HTML: '#e34c26', CSS: '#563d7c', 'Jupyter Notebook': '#DA5B0B' };
        wrap.innerHTML = repos.slice(0, 6).map(r => `<a class="gh-repo" href="${r.html_url}" target="_blank" rel="noopener" style="--lang-color:${LANG[r.language]||'#888'}"><div class="gh-repo-name">${r.name}</div><div class="gh-repo-desc">${esc((r.description||'—').slice(0,90))}</div><div class="gh-repo-meta">${r.language ? `<span class="gh-repo-lang">${r.language}</span>` : ''}<span>★ ${r.stargazers_count}</span></div></a>`).join('');
      })
    );
  }

  /* ============================================================
     8. LAST.FM
     ============================================================ */
  function fetchLastfm() {
    const u = CONFIG.lastfmUser, k = CONFIG.lastfmKey;
    const info = fetch(`https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=${u}&api_key=${k}&format=json`).then(r => r.json()).then(d => {
      const i = d && d.user; if (!i) return;
      animateCounter('lfm-scrobbles', i.playcount ?? 0);
      animateCounter('lfm-artists', i.artist_count ?? 0);
      animateCounter('lfm-tracks', i.track_count ?? 0);
      animateCounter('lfm-albums', i.album_count ?? 0);
    });
    const tracks = fetch(`https://ws.audioscrobbler.com/2.0/?method=user.gettoptracks&user=${u}&period=1month&limit=6&api_key=${k}&format=json`).then(r => r.json()).then(d => {
      const wrap = $('lfm-tracks'); if (!wrap || !d.toptracks) return;
      const t = d.toptracks.track || [];
      wrap.innerHTML = t.map((tr, idx) => {
        const img = (tr.image && (tr.image.find(i => i.size === 'medium') || {}).__text) || '';
        return `<div class="lfm-track"><span class="lfm-track-rank">${idx + 1}</span>${img ? `<img class="lfm-track-img" alt="" src="${img}">` : ''}<div class="lfm-track-info"><div class="lfm-track-name">${esc(tr.name)}</div><div class="lfm-track-artist">${tr.artist ? esc(tr.artist.name) : ''}</div></div></div>`;
      }).join('');
    });
    return Promise.allSettled([info, tracks]);
  }

  /* ============================================================
     9. ANILIST (summary + pagination)
     ============================================================ */
  (function anilist() {
    const list = $('al-list'), tabs = $('al-tabs'); if (!list) return;
    let allEntries = [], activeStatus = 'ALL', page = 1;
    const PER_PAGE = 18;
    const card = $('anilist-card');
    let summaryEl = null, pagerEl = null;
    function ensureChrome() {
      if (!summaryEl) { summaryEl = document.createElement('div'); summaryEl.className = 'al-summary'; card.insertBefore(summaryEl, list); }
      if (!pagerEl) { pagerEl = document.createElement('div'); pagerEl.className = 'al-pagination'; card.appendChild(pagerEl); }
    }
    const query = `query{user:MediaListCollection(userName:"${CONFIG.anilistUser}",type:ANIME){lists{name status entries{media{id title{romaji english}coverImage{medium}episodes meanScore}score progress}}}}`;
    fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
      .then(r => r.json()).then(d => {
        const lists = (d.data && d.data.user && d.data.user.lists) || [];
        lists.forEach(l => (l.entries || []).forEach(e => { e._status = l.status; allEntries.push(e); }));
        renderSummary(); render();
      }).catch(() => { list.innerHTML = '<div class="al-empty">Could not load anime list.</div>'; });
    function renderSummary() {
      ensureChrome();
      const total = allEntries.length;
      const eps = allEntries.reduce((s, e) => s + (Number(e.progress) || 0), 0);
      const hrs = Math.round(allEntries.reduce((s, e) => s + (Number(e.progress) || 0) * 24, 0) / 60);
      summaryEl.textContent = total ? `${total} anime · ${eps.toLocaleString()} episodes · ${hrs.toLocaleString()} hrs watched` : '';
    }
    function render() {
      ensureChrome();
      const items = activeStatus === 'ALL' ? allEntries : allEntries.filter(e => (e._status || '').toUpperCase().includes(activeStatus));
      const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
      if (page > pages) page = pages;
      const slice = items.slice((page - 1) * PER_PAGE, page * PER_PAGE);
      if (!items.length) { list.innerHTML = '<div class="al-empty">No entries here yet.</div>'; pagerEl.innerHTML = ''; return; }
      list.innerHTML = slice.map(e => {
        const t = (e.media && (e.media.title.romaji || e.media.title.english)) || '—';
        const img = (e.media && e.media.coverImage && e.media.coverImage.medium) || '';
        const score = e.score ? '★ ' + e.score : (e.progress ? e.progress + ' ep' : '');
        return `<div class="al-item"><img loading="lazy" alt="${esc(t)}" src="${img}" onerror="this.style.opacity=0"><div class="al-item-info"><div class="al-item-name">${esc(t)}</div><div class="al-item-score">${score}</div></div></div>`;
      }).join('');
      renderPager(pages);
    }
    function renderPager(pages) {
      if (pages <= 1) { pagerEl.innerHTML = ''; return; }
      let html = `<button class="al-page-btn" ${page===1?'disabled':''} data-page="${page-1}">‹</button>`;
      for (let p = 1; p <= pages; p++) {
        if (p === 1 || p === pages || Math.abs(p - page) <= 1) html += `<button class="al-page-btn ${p===page?'active':''}" data-page="${p}">${p}</button>`;
        else if (Math.abs(p - page) === 2) html += `<span class="al-page-dots">…</span>`;
      }
      html += `<button class="al-page-btn" ${page===pages?'disabled':''} data-page="${page+1}">›</button>`;
      pagerEl.innerHTML = html;
      pagerEl.querySelectorAll('.al-page-btn').forEach(b => b.addEventListener('click', () => { const p = +b.dataset.page; if (p>=1 && p<=pages) { page = p; render(); } }));
    }
    if (tabs) tabs.addEventListener('click', (e) => {
      const t = e.target.closest('.al-tab'); if (!t) return;
      tabs.querySelectorAll('.al-tab').forEach(b => b.classList.remove('active'));
      t.classList.add('active'); activeStatus = t.dataset.status; page = 1; render();
    });
  })();

  /* ============================================================
     10. QUOTE SWAP
     ============================================================ */
  (function quotes() {
    const QUOTES = [
      ['Talk is cheap. Show me the code.', 'Linus Torvalds'],
      ['First, solve the problem. Then, write the code.', 'John Johnson'],
      ['Simplicity is the soul of efficiency.', 'Austin Freeman'],
      ['The best error message is the one that never shows up.', 'Thomas Fuchs'],
      ['Programs must be written for people to read.', 'Harold Abelson'],
      ['Make it work, make it right, make it fast.', 'Kent Beck']
    ];
    let i = 0; const swap = $('quote-swap');
    if (swap) swap.addEventListener('click', () => { i = (i + 1) % QUOTES.length; $('quote-text').textContent = QUOTES[i][0]; $('quote-author').textContent = '— ' + QUOTES[i][1]; });
  })();

  /* ============================================================
     11. PRESENCE LINKS (Material Symbols icons; YatiniGPT removed)
     ============================================================ */
  (function presence() {
    const grid = $('presence-grid'); if (!grid) return;
    const LINKS = [
      { icon: 'code', name: 'GitHub', url: 'https://github.com/YatinSharma1303' },
      { icon: 'mail', name: 'Email', url: 'mailto:yatinsharma1303@gmail.com' },
      { icon: 'library_music', name: 'Last.fm', url: 'https://www.last.fm/user/YATINSHARMA' },
      { icon: 'live_tv', name: 'AniList', url: 'https://anilist.co/user/YatinSharma1303/' }
    ];
    grid.innerHTML = LINKS.map(l => `<a class="presence-link" href="${l.url}" target="_blank" rel="noopener"><span class="presence-icon material-symbols-outlined">${l.icon}</span><span class="presence-name">${l.name}</span></a>`).join('');
  })();

  /* ============================================================
     12. TIME WIDGET (India vs visitor, live)
     ============================================================ */
  (function timeWidget() {
    const india = $('time-india'), visitor = $('time-visitor'), sub = $('time-visitor-sub');
    if (!india) return;
    const opt = { hour: '2-digit', minute: '2-digit', hour12: true };
    function tick() {
      try { india.textContent = new Date().toLocaleTimeString('en-US', { ...opt, timeZone: CONFIG.timezone }); } catch (e) { india.textContent = '—'; }
      try {
        const vtz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        visitor.textContent = new Date().toLocaleTimeString('en-US', { ...opt, timeZone: vtz });
        sub.textContent = (vtz === CONFIG.timezone) ? 'same timezone' : 'your time';
      } catch (e) { visitor.textContent = '—'; }
    }
    tick(); setInterval(tick, 1000);
  })();

  /* ============================================================
     13. PARALLAX (subtle scroll on background orb + sections)
     ============================================================ */
  (function parallax() {
    const orb = document.querySelector('.hero-gradient-orb');
    const hero = $('hero');
    if (!orb && !hero) return;
    let ticking = false;
    function update() {
      const y = window.scrollY;
      if (orb) orb.style.transform = `translate(0, ${y * 0.15}px)`;
      if (hero) hero.style.transform = `translateY(${y * 0.25}px)`;
      ticking = false;
    }
    window.addEventListener('scroll', () => { if (!ticking) { requestAnimationFrame(update); ticking = true; } }, { passive: true });
  })();

  /* ============================================================
     14. ANIMATED COUNTERS (count up when scrolled into view)
     ============================================================ */
  function animateCounter(id, target) {
    const el = $(id); if (!el) return;
    const num = Number(target) || 0;
    if (el.dataset.counted) { el.textContent = num.toLocaleString(); return; }
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        el.dataset.counted = '1'; obs.disconnect();
        const dur = 900, start = performance.now();
        (function step(t) {
          const p = Math.min(1, (t - start) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(num * eased).toLocaleString();
          if (p < 1) requestAnimationFrame(step);
        })(start);
      });
    }, { threshold: 0.4 });
    obs.observe(el);
  }

  /* ============================================================
     15. CHANGELOGS PILL + MODAL
     ============================================================ */
  (function changelog() {
    const pill = $('changelog-pill'), modal = $('changelog-modal'), close = $('changelog-close'), body = $('changelog-body');
    if (!pill || !modal) return;
    const LOGS = [
      { date: '2026-07-01 · v1.0', items: ['Full portfolio launched — hero, about, skills, projects, music, anime.', 'Ask Me Anything with Firestore + Telegram reply-to-answer.', 'Added Playground: 7 playable mini-games.', 'Added voting + sort + pagination on answered questions.', 'Added time widget, parallax, animated counters.'] }
    ];
    body.innerHTML = LOGS.map(l => `<div class="changelog-entry"><div class="changelog-date">${l.date}</div><ul>${l.items.map(i => `<li>${i}</li>`).join('')}</ul></div>`).join('');
    pill.addEventListener('click', () => modal.classList.toggle('open'));
    close.addEventListener('click', () => modal.classList.remove('open'));
    document.addEventListener('click', (e) => { if (modal.classList.contains('open') && !modal.contains(e.target) && !pill.contains(e.target)) modal.classList.remove('open'); });
  })();

  /* ============================================================
     16. AMA — Firestore + Telegram + voting + sort + pagination
     ============================================================ */
  (function ama() {
    const input = $('ama-input'), send = $('ama-send'), status = $('ama-status'),
          countEl = $('ama-count'), listWrap = $('ama-list-wrap'),
          list = $('ama-list'), sortWrap = $('ama-sort'), pager = $('ama-pager');
    if (!input) return;

    const fb = CONFIG.firebase;
    const FIREBASE_READY = fb && fb.apiKey && fb.projectId &&
      fb.apiKey !== 'YOUR_FIREBASE_WEB_API_KEY' && fb.projectId !== 'YOUR_FIREBASE_PROJECT_ID';
    const COL = CONFIG.amaCollection;
    const base = () => `https://firestore.googleapis.com/v1/projects/${fb.projectId}/databases/(default)/documents`;
    const queryUrl = () => `${base()}:runQuery?key=${encodeURIComponent(fb.apiKey)}`;
    const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ('q_' + Date.now() + '_' + Math.random().toString(16).slice(2)));
    const PER_PAGE = 4;

    const LIMIT_KEY = 'yatin_ama_submits';
    const today = new Date().toDateString();
    let todayCount = 0;
    try { const stored = JSON.parse(localStorage.getItem(LIMIT_KEY) || '{}'); todayCount = stored.date === today ? stored.count : 0; } catch (e) {}
    countEl.textContent = todayCount;

    let votedSet = new Set();
    try { votedSet = new Set(JSON.parse(localStorage.getItem('yatin_ama_votes') || '[]')); } catch (e) {}

    let answeredDocs = [], activeSort = 'top', page = 1;

    function fromDoc(doc) {
      const f = doc.fields || {};
      return {
        id: f.id?.stringValue || (doc.name ? doc.name.split('/').pop() : ''),
        name: f.name?.stringValue || 'Anonymous',
        question: f.question?.stringValue || '',
        answer: f.answer?.stringValue || '',
        answeredAt: f.answeredAt?.stringValue || '',
        votes: Number(f.votes?.integerValue || f.votes?.doubleValue || 0)
      };
    }
    function sorted() {
      const arr = answeredDocs.slice();
      if (activeSort === 'top') arr.sort((a, b) => (b.votes - a.votes) || (new Date(b.answeredAt||0) - new Date(a.answeredAt||0)));
      else if (activeSort === 'recent') arr.sort((a, b) => new Date(b.answeredAt||0) - new Date(a.answeredAt||0));
      else arr.sort((a, b) => new Date(a.answeredAt||0) - new Date(b.answeredAt||0));
      return arr;
    }
    function render() {
      if (!answeredDocs.length) { if (listWrap) listWrap.hidden = true; return; }
      if (listWrap) listWrap.hidden = false;
      const arr = sorted();
      const pages = Math.max(1, Math.ceil(arr.length / PER_PAGE));
      if (page > pages) page = pages;
      const slice = arr.slice((page - 1) * PER_PAGE, page * PER_PAGE);
      list.innerHTML = slice.map(q => {
        const up = votedSet.has(q.id);
        return `<div class="ama-q">
          <div class="ama-q-text">${esc(q.question)}</div>
          <div class="ama-q-ans">${esc(q.answer)}</div>
          <div class="ama-q-meta">${esc(q.name || 'Anonymous')} · ${esc((q.answeredAt||'').slice(0,10))}</div>
          <div class="ama-q-vote">
            <button class="ama-vote-btn ${up ? 'voted' : ''}" data-id="${q.id}" data-dir="1" title="Helpful">▲</button>
            <span class="ama-vote-count" data-count="${q.id}">${q.votes}</span>
            <button class="ama-vote-btn ${up ? 'voted' : ''}" data-id="${q.id}" data-dir="-1" title="Undo">▼</button>
          </div>
        </div>`;
      }).join('');
      renderPager(pages);
      list.querySelectorAll('.ama-vote-btn').forEach(b => b.addEventListener('click', () => vote(b.dataset.id, +b.dataset.dir)));
    }
    function renderPager(pages) {
      if (pages <= 1) { pager.innerHTML = ''; return; }
      let html = '';
      for (let p = 1; p <= pages; p++) html += `<button class="ama-page ${p===page?'active':''}" data-page="${p}">${p}</button>`;
      pager.innerHTML = html;
      pager.querySelectorAll('.ama-page').forEach(b => b.addEventListener('click', () => { page = +b.dataset.page; render(); }));
    }
    function vote(id, dir) {
      const up = votedSet.has(id);
      let delta;
      if (dir === 1) { if (up) return; delta = 1; votedSet.add(id); }
      else { if (!up) return; delta = -1; votedSet.delete(id); }
      localStorage.setItem('yatin_ama_votes', JSON.stringify([...votedSet]));
      const doc = answeredDocs.find(q => q.id === id); if (doc) doc.votes = Math.max(0, doc.votes + delta);
      render();
      fetch('/api/ama-vote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, delta }) }).catch(() => {});
    }
    function loadAnswered() {
      if (!FIREBASE_READY) return;
      fetch(queryUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: {
          from: [{ collectionId: COL }],
          where: { fieldFilter: { field: { fieldPath: 'answered' }, op: 'EQUAL', value: { booleanValue: true } } },
          limit: 50
        } })
      }).then(r => r.json()).then(data => {
        answeredDocs = (data || []).filter(d => d.document).map(d => fromDoc(d.document));
        answeredDocs.sort((a, b) => new Date(b.answeredAt || 0) - new Date(a.answeredAt || 0));
        render();
      }).catch((err) => { console.warn('AMA load failed:', err); });
    }
    function submit() {
      const text = input.value.trim();
      if (!text) { status.textContent = 'Please type a question first.'; status.className = 'ama-status err'; return; }
      if (todayCount >= CONFIG.amaLimit) { status.textContent = 'Daily limit reached.'; status.className = 'ama-status err'; return; }
      const nameInput = $('ama-name-input');
      const name = ((nameInput && nameInput.value.trim()) || localStorage.getItem('yatin_ama_name') || 'Anonymous').slice(0, 60);
      if (nameInput && nameInput.value.trim()) localStorage.setItem('yatin_ama_name', nameInput.value.trim());
      const id = uuid(), createdAt = new Date().toISOString();
      const question = {
        id: { stringValue: id }, name: { stringValue: name }, question: { stringValue: text },
        answer: { stringValue: '' }, answered: { booleanValue: false },
        createdAt: { stringValue: createdAt }, answeredAt: { nullValue: null }, votes: { integerValue: 0 }
      };
      status.textContent = 'Sending…'; status.className = 'ama-status';
      const notify = () => fetch('/api/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, question: text, id, createdAt }) }).catch(() => {});
      const afterSubmit = (ok) => {
        todayCount++; localStorage.setItem(LIMIT_KEY, JSON.stringify({ date: today, count: todayCount })); countEl.textContent = todayCount; input.value = '';
        status.textContent = ok ? '✅ Sent! Yatin will reply soon — check back here.' : 'Could not send. Try again later.';
        status.className = ok ? 'ama-status ok' : 'ama-status err';
        setTimeout(() => { status.textContent = ''; status.className = 'ama-status'; }, 4500);
      };
      if (FIREBASE_READY) {
        const createUrl = `${base()}/${COL}?documentId=${encodeURIComponent(id)}&key=${encodeURIComponent(fb.apiKey)}`;
        fetch(createUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: question }) })
          .then(r => r.ok).then(ok => { notify(); afterSubmit(ok); }).catch(() => afterSubmit(false));
      } else { notify().then(() => afterSubmit(true)).catch(() => afterSubmit(false)); }
    }
    if (send) send.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); });
    if (sortWrap) sortWrap.addEventListener('click', (e) => {
      const t = e.target.closest('.ama-sort-btn'); if (!t) return;
      sortWrap.querySelectorAll('.ama-sort-btn').forEach(b => b.classList.remove('active'));
      t.classList.add('active'); activeSort = t.dataset.sort; page = 1; render();
    });
    loadAnswered();
  })();

  /* ============================================================
     17. FADE-IN OBSERVER + YEAR
     ============================================================ */
  (function reveal() {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
    }, { threshold: 0.1 });
    document.querySelectorAll('.fade-in').forEach(el => obs.observe(el));
    const y = $('year'); if (y) y.textContent = new Date().getFullYear();
  })();

})();
