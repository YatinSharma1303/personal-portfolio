/* ============================================================
   YATIN SHARMA — PORTFOLIO · script.js
   Vanilla JS · YouTube music · GitHub · Last.fm · AniList ·
   AMA (Firestore+Telegram+voting) · time · parallax · counters ·
   typewriter · scroll progress · active nav · back-to-top · copy email
   ============================================================ */
(function () {
  'use strict';

  /* ── CONFIG ─────────────────────────────────────────── */
  const CONFIG = {
    githubUser: 'YatinSharma1303',
    lastfmUser: 'YATINSHARMA',
    anilistUser: 'YatinSharma1303',
    /* Last.fm API key is no longer exposed here — calls go through
       /api/lastfm proxy which injects the key server-side.
       Set LASTFM_API_KEY in Vercel environment variables. */
    lastfmKey: '',
    ytVideoId: 'XtwqzajH_8A', // legacy single-track fallback
    // YouTube Music playlist — the player loads this whole list and pulls
    // each track's title/artist/artwork from YouTube automatically.
    ytPlaylistId: 'OLAK5uy_mjNB8hu_s5goDncwoopQoSRXjmRjEPq54',
    playlist: [
      { id: 'XtwqzajH_8A', title: 'YouTube Music', artist: 'Playlist' }
    ],
    amaLimit: 20,
    firebase: {
      apiKey: 'AIzaSyBA2du9aSIi7xoDttbICzmEd-nq0W39zrU',
      projectId: 'portfolio-yatin'
    },
    amaCollection: 'amaQuestions',
    timezone: 'Asia/Kolkata'
  };

  /* ── EMAIL (not in HTML to avoid Cloudflare obfuscation) ── */
  const EMAIL = ['yatinsharma1303','gmail.com'].join('@');

  const $ = (id) => document.getElementById(id);
  const esc = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ── 62. Shared search-input + filter-pill widgets (dedupes AMA / AniList / future) ── */
  const Widgets = {
    // Wire a search input (+ optional clear button). onChange(trimmedValue) fires on input, Escape and clear.
    bindSearch(opts) {
      const input = opts.input, clear = opts.clear, onChange = opts.onChange || function () {};
      if (!input) return { reset() {} };
      const sync = (v) => { if (clear) clear.hidden = !v; };
      input.addEventListener('input', () => { const v = input.value.trim(); sync(v); onChange(v); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { input.value = ''; sync(''); onChange(''); } });
      if (clear) clear.addEventListener('click', () => { input.value = ''; sync(''); onChange(''); input.focus(); });
      return { reset() { input.value = ''; sync(''); } };
    },
    // Delegated single-select pill group. onSelect(dataValue, btn) fires on click; manages the .active class.
    bindPills(opts) {
      const container = opts.container; if (!container) return;
      const sel = opts.selector || 'button';
      const attr = opts.attr || 'value';
      const onSelect = opts.onSelect || function () {};
      container.addEventListener('click', (e) => {
        const t = e.target.closest(sel); if (!t || !container.contains(t)) return;
        container.querySelectorAll(sel).forEach(b => b.classList.remove('active'));
        t.classList.add('active');
        onSelect(t.dataset[attr], t);
      });
    }
  };

  // === Last.fm helpers (defined early so the intro can safely call fetchLastfm) ===
  /* All Last.fm calls now go through /api/lastfm proxy — the API key is
     injected server-side and never exposed to the browser. */
  const lfmAPI = '/api/lastfm';
  // Format play counts: 1423 → "1.4k", 23456 → "23.5k"
  function formatPlays(n) {
    n = parseInt(n, 10) || 0;
    if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return n.toLocaleString();
  }
  // Relative time from unix timestamp
  function timeAgo(uts) {
    if (!uts) return '';
    const diff = Math.floor(Date.now() / 1000) - parseInt(uts, 10);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return Math.floor(diff / 604800) + 'w ago';
  }

  // Build a {size: url} map of Last.fm images, dropping default placeholder art.
  function lfmImgMap(images) {
    const map = {};
    if (!images || !images.length) return map;
    // Last.fm's default missing-art image hashes (solid white/grey placeholders)
    const defaultHashes = ['2a96cbd8b46e442fc41c2b86b821562f', 'c6f59c1e5e7240a4c0d427abd71f3dbb', '4128a6eb29f94943c9d206c08e025042'];
    images.forEach(function (im) {
      const url = (im && (im['#text'] || im['text'])) || '';
      if (url && !defaultHashes.some(h => url.includes(h))) map[im.size] = url;
    });
    return map;
  }
  function lfmImg(images) {
    const map = lfmImgMap(images);
    const sizes = ['mega', 'extralarge', 'large', 'medium', 'small'];
    for (let i = 0; i < sizes.length; i++) { if (map[sizes[i]]) return map[sizes[i]]; }
    return '';
  }
  // Only accept large+ sizes (skip low-res medium/small) — used to tell whether
  // Last.fm art is sharp enough to prefer over the iTunes fallback.
  function lfmImgHighRes(images) {
    const map = lfmImgMap(images);
    const sizes = ['mega', 'extralarge', 'large'];
    for (let i = 0; i < sizes.length; i++) { if (map[sizes[i]]) return map[sizes[i]]; }
    return '';
  }

  /* ============================================================
     1. INTRO / PRELOADER
     ============================================================ */
  /* ============================================================
     1. INTRO OVERLAY — Glitch Name Reveal
     Scrambled characters lock in one by one, progress bar fills,
     user dismisses → whoosh sound + name shatters → site revealed.
     ============================================================ */
  window.__introDone = false;
  (function intro() {
    const overlay = $('intro-overlay');
    if (!overlay) return;
    let done = false, dismissed = false;
    const percentEl = $('intro-percent');
    const fillEl = $('intro-progress-fill');
    const designedEl = $('intro-designed');
    const statusText = $('intro-status-text');
    const timeEl = $('intro-time');
    const chars = overlay.querySelectorAll('.intro-char');
    const TARGET = ['Y','A','T','I','N'];
    const SCRAMBLE = '!@#$%&*?/\\\|0123456789\u2593\u2592\u2591\u2588\u2584\u2580\u25A0\u25A1\u25C7\u25C6'.split('');
    const STATUS_MSGS = [
      { at: 0, text: 'compiling portfolio' },
      { at: 25, text: 'loading assets' },
      { at: 50, text: 'initializing modules' },
      { at: 75, text: 'rendering interface' },
      { at: 95, text: 'system ready' }
    ];
    const DURATION = 1800;
    const HARD = 5000;
    const startTime = performance.now();
    let fontsReady = false, rafId = null, scrambleId = null;
    let lastStatusIdx = -1;

    // Live clock in top-right
    function updateClock() {
      if (timeEl) timeEl.textContent = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    updateClock();
    const clockId = setInterval(updateClock, 1000);

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { fontsReady = true; }).catch(() => { fontsReady = true; });
    } else { fontsReady = true; }

    // Scramble all unlocked chars every 60ms
    function startScramble() {
      scrambleId = setInterval(() => {
        chars.forEach((ch, i) => {
          if (ch.classList.contains('locked')) return;
          ch.textContent = SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)];
          ch.classList.add('scrambling');
        });
      }, 60);
    }

    // Lock a single char at index
    function lockChar(i) {
      if (i >= chars.length) return;
      const ch = chars[i];
      ch.textContent = TARGET[i];
      ch.classList.remove('scrambling');
      ch.classList.add('locked');
    }

    function updateProgress(now) {
      if (done) return;
      const elapsed = now - startTime;
      const timePct = Math.min(100, (elapsed / DURATION) * 100);
      const canFinish = fontsReady || elapsed >= HARD;
      const pct = canFinish ? timePct : Math.min(99, timePct);
      if (percentEl) percentEl.textContent = Math.floor(pct) + '%';
      if (fillEl) fillEl.style.width = Math.floor(pct) + '%';
      // Update status text based on progress (only forward)
      const floorPct = Math.floor(pct);
      for (let i = STATUS_MSGS.length - 1; i >= 0; i--) {
        if (floorPct >= STATUS_MSGS[i].at && lastStatusIdx < i) {
          if (statusText) statusText.textContent = STATUS_MSGS[i].text;
          lastStatusIdx = i;
          break;
        }
      }
      if (pct >= 100 && canFinish) { ready(); return; }
      rafId = requestAnimationFrame(updateProgress);
    }

    function ready() {
      if (done) return;
      done = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (percentEl) percentEl.textContent = '100%';
      if (fillEl) fillEl.style.width = '100%';
      if (statusText) statusText.textContent = 'system ready';

      // Lock remaining chars in sequence
      if (scrambleId) clearInterval(scrambleId);
      const alreadyLocked = overlay.querySelectorAll('.intro-char.locked').length;
      let next = alreadyLocked;
      function lockNext() {
        if (next >= chars.length) {
          // All locked — show designed-by text
          if (designedEl) designedEl.classList.add('visible');
          overlay.classList.add('hint-ready');
          return;
        }
        lockChar(next);
        next++;
        setTimeout(lockNext, 280);
      }
      lockNext();
    }

    // Whoosh sound via Web Audio
    function playWhoosh() {
      try {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        // White noise burst
        const len = ac.sampleRate * 0.2; // 200ms
        const buf = ac.createBuffer(1, len, ac.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len); // fade out
        const src = ac.createBufferSource();
        src.buffer = buf;
        // Bandpass filter for whoosh character
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.7;
        const gain = ac.createGain();
        gain.gain.setValueAtTime(0.25, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.2);
        src.connect(bp); bp.connect(gain); gain.connect(ac.destination);
        src.start(); src.stop(ac.currentTime + 0.25);
      } catch (e) {}
    }

    // Shatter animation
    function shatter() {
      chars.forEach((ch, i) => {
        const tx = (Math.random() - 0.5) * 600;
        const ty = -(Math.random() * 400 + 100);
        const rot = (Math.random() - 0.5) * 720;
        ch.style.transform = `translate(${tx}px, ${ty}px) rotate(${rot}deg)`;
        ch.classList.add('shattered');
      });
    }

    function dismiss() {
      if (dismissed || !done) return;
      dismissed = true;
      clearInterval(clockId);
      playWhoosh();
      shatter();
      // Delay the slide-up slightly so shatter is visible
      setTimeout(() => {
        overlay.classList.add('hidden');
        setTimeout(() => { overlay.style.display = 'none'; }, 600);
      }, 200);
      window.__introDone = true;
      // Auto-play music on enter
      try { doPlay(); } catch (e) {}
      // Fetch heavy API data
      try { fetchGitHub().catch(() => {}); } catch (e) {}
      try { fetchLastfm().catch(() => {}); } catch (e) {}
    }

    // Start scramble immediately
    startScramble();

    // Start progress
    rafId = requestAnimationFrame(updateProgress);

    // Dismiss listeners — same as before
    overlay.addEventListener('click', () => { dismiss(); });
    overlay.addEventListener('pointerup', () => { dismiss(); });
    const enterKeys = ['ArrowDown', 'Space', 'Enter', 'PageDown', 'Escape'];
    window.addEventListener('keydown', (e) => { if (enterKeys.includes(e.code)) dismiss(); }, { once: true });
    window.addEventListener('wheel', (e) => { if (e.deltaY > 30) dismiss(); }, { once: true, passive: true });
    let sy = 0;
    overlay.addEventListener('touchstart', (e) => { sy = e.touches[0].clientY; }, { passive: true });
    overlay.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (sy - e.changedTouches[0].clientY > 40) dismiss();
    });
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
    const MODES = ['auto', 'light', 'dark'];
    const root = document.documentElement;
    let mode = localStorage.getItem('theme');
    if (MODES.indexOf(mode) === -1) mode = 'auto';
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    function isLight(m) { if (m === 'light') return true; if (m === 'dark') return false; return mq.matches; }
    function apply(m) {
      mode = m;
      root.classList.toggle('light', isLight(m));
      if (btn) { btn.classList.remove('mode-auto', 'mode-light', 'mode-dark'); btn.classList.add('mode-' + m); btn.title = 'Theme: ' + m + ' (click to switch)'; }
    }
    apply(mode);
    if (mq.addEventListener) mq.addEventListener('change', function () { if (mode === 'auto') apply('auto'); });
    else if (mq.addListener) mq.addListener(function () { if (mode === 'auto') apply('auto'); });
    if (btn) btn.addEventListener('click', function () {
      const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      localStorage.setItem('theme', next);
      apply(next);
      if (window.unlockAchievement) window.unlockAchievement('theme', 'Stylish!', 'Theme: ' + next + '.');
    });
  })();

  /* ============================================================
     3b. ACCENT COLOR PICKER (persisted to localStorage)
     ============================================================ */
  (function accentPicker() {
    const btn = $('accent-btn'), pop = $('accent-popover');
    const root = document.documentElement;
    // name, --accent, --accent2, solid swatch
    const ACCENTS = [
      { id: 'cyan',   name: 'Cyan',   accent: 'rgba(0,200,255,0.6)',  accent2: 'rgba(120,90,255,0.5)', swatch: '#00c8ff' },
      { id: 'violet', name: 'Violet', accent: 'rgba(139,92,246,0.6)', accent2: 'rgba(217,70,239,0.5)', swatch: '#8b5cf6' },
      { id: 'emerald',name: 'Emerald',accent: 'rgba(16,185,129,0.6)', accent2: 'rgba(5,150,105,0.5)',  swatch: '#10b981' },
      { id: 'rose',   name: 'Rose',   accent: 'rgba(244,63,94,0.6)',  accent2: 'rgba(251,113,133,0.5)',swatch: '#f43f5e' },
      { id: 'amber',  name: 'Amber',  accent: 'rgba(245,158,11,0.6)', accent2: 'rgba(234,88,12,0.5)',  swatch: '#f59e0b' },
      { id: 'blue',   name: 'Blue',   accent: 'rgba(59,130,246,0.6)', accent2: 'rgba(37,99,235,0.5)',  swatch: '#3b82f6' },
      { id: 'teal',   name: 'Teal',   accent: 'rgba(20,184,166,0.6)', accent2: 'rgba(13,148,136,0.5)', swatch: '#14b8a6' },
      { id: 'orange', name: 'Orange', accent: 'rgba(249,115,22,0.6)', accent2: 'rgba(234,88,12,0.5)',  swatch: '#f97316' },
      { id: 'pink',   name: 'Pink',   accent: 'rgba(236,72,153,0.6)', accent2: 'rgba(219,39,119,0.5)', swatch: '#ec4899' },
      { id: 'lime',   name: 'Lime',   accent: 'rgba(132,204,22,0.6)', accent2: 'rgba(101,163,13,0.5)', swatch: '#84cc16' },
      { id: 'indigo', name: 'Indigo', accent: 'rgba(99,102,241,0.6)', accent2: 'rgba(79,70,229,0.5)',  swatch: '#6366f1' },
      { id: 'red',    name: 'Red',    accent: 'rgba(239,68,68,0.6)',  accent2: 'rgba(220,38,38,0.5)',  swatch: '#ef4444' },
      { id: 'fuchsia',name: 'Fuchsia',accent: 'rgba(217,70,239,0.6)', accent2: 'rgba(162,28,175,0.5)', swatch: '#d946ef' },
      { id: 'yellow', name: 'Yellow', accent: 'rgba(234,179,8,0.6)',  accent2: 'rgba(217,119,6,0.5)',  swatch: '#eab308' },
      { id: 'green',  name: 'Green',  accent: 'rgba(34,197,94,0.6)',  accent2: 'rgba(22,163,74,0.5)',  swatch: '#22c55e' },
      { id: 'sky',    name: 'Sky',    accent: 'rgba(14,165,233,0.6)', accent2: 'rgba(2,132,199,0.5)',  swatch: '#0ea5e9' },
      { id: 'purple', name: 'Purple', accent: 'rgba(168,85,247,0.6)', accent2: 'rgba(124,58,237,0.5)', swatch: '#a855f7' },
      { id: 'crimson',name: 'Crimson',accent: 'rgba(190,18,60,0.6)',  accent2: 'rgba(225,29,72,0.5)',  swatch: '#be123c' },
      { id: 'mint',   name: 'Mint',   accent: 'rgba(45,212,191,0.6)', accent2: 'rgba(13,148,136,0.5)', swatch: '#2dd4bf' },
      { id: 'slate',  name: 'Slate',  accent: 'rgba(100,116,139,0.6)',accent2: 'rgba(71,85,105,0.5)',  swatch: '#64748b' },
      { id: 'coral',    name: 'Coral',    accent: 'rgba(255,111,97,0.6)', accent2: 'rgba(229,83,61,0.5)',  swatch: '#ff6f61' },
      { id: 'gold',     name: 'Gold',     accent: 'rgba(212,175,55,0.6)', accent2: 'rgba(184,134,11,0.5)', swatch: '#d4af37' },
      { id: 'turquoise',name: 'Turquoise',accent: 'rgba(20,224,200,0.6)', accent2: 'rgba(8,145,178,0.5)',  swatch: '#14e0c8' },
      { id: 'plum',     name: 'Plum',     accent: 'rgba(162,28,175,0.6)', accent2: 'rgba(112,26,117,0.5)', swatch: '#a21caf' },
      { id: 'sand',     name: 'Sand',     accent: 'rgba(200,161,101,0.6)',accent2: 'rgba(166,124,82,0.5)', swatch: '#c8a165' }
    ];
    let activeId = localStorage.getItem('accent') || 'cyan';
    if (!ACCENTS.some(a => a.id === activeId)) activeId = 'cyan';

    function apply(id) {
      const a = ACCENTS.find(x => x.id === id) || ACCENTS[0];
      // Default (cyan) uses the stylesheet values — clear overrides so themes stay intact.
      if (a.id === 'cyan') { root.style.removeProperty('--accent'); root.style.removeProperty('--accent2'); }
      else { root.style.setProperty('--accent', a.accent); root.style.setProperty('--accent2', a.accent2); }
      // Solid accent (no alpha) drives the contribution heatmap + legend.
      root.style.setProperty('--accent-solid', a.swatch);
      activeId = a.id;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', a.swatch);
    }
    apply(activeId);

    if (!btn || !pop) return;
    pop.innerHTML = ACCENTS.map(a =>
      '<button class="accent-swatch' + (a.id === activeId ? ' active' : '') + '" role="menuitemradio" data-id="' + a.id + '" title="' + a.name + '" aria-label="' + a.name + '" aria-checked="' + (a.id === activeId) + '" style="--sw:' + a.swatch + '"><span></span></button>'
    ).join('');

    function setOpen(open) {
      pop.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      pop.classList.toggle('open', open);
    }
    function positionPop() {
      const r = btn.getBoundingClientRect();
      pop.style.top = (r.bottom + 10) + 'px';
      pop.style.right = Math.max(12, window.innerWidth - r.right) + 'px';
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = pop.hidden;
      if (willOpen) positionPop();
      setOpen(willOpen);
    });
    pop.addEventListener('click', (e) => {
      const s = e.target.closest('.accent-swatch'); if (!s) return;
      apply(s.dataset.id);
      localStorage.setItem('accent', activeId);
      pop.querySelectorAll('.accent-swatch').forEach(x => {
        const on = x.dataset.id === activeId;
        x.classList.toggle('active', on); x.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      setOpen(false);
      if (window.unlockAchievement) window.unlockAchievement('accent', 'True Colors', 'Changed the accent color.');
    });
    document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) setOpen(false); });
    window.addEventListener('resize', () => { if (!pop.hidden) positionPop(); });
  })();

  /* ============================================================
     4. MUSIC PLAYER (YouTube IFrame API — bulletproof edition)
     ============================================================ */
  let ytPlayer = null, ytReady = false, ytError = false, wantPlay = false, isPlaying = false;
  const miniPlayer = $('mini-player');
  const musicWidget = $('topbar-music-icon');
  const YT_PLAYLIST_ID = CONFIG.ytPlaylistId || '';

  function setVisuals(playing) {
    isPlaying = playing;
    if (miniPlayer) miniPlayer.classList.toggle('playing', playing);
    [$('tb-eq-bars'), $('mp-eq'), $('mp-play')].forEach(function (el) { if (el) el.classList.toggle('playing', playing); });
    const tip = $('tb-music-tooltip'); if (tip) tip.textContent = playing ? 'Now playing' : 'Tap to play';
  }

  // Pull the current track's title / artist / artwork straight from YouTube.
  function syncMeta() {
    if (!ytReady) return;
    let d = null; try { d = ytPlayer.getVideoData(); } catch (e) {}
    if (!d || !d.video_id) return;
    const title = d.title || 'Now Playing';
    const artist = d.author ? d.author.replace(/ - Topic$/, '') : '';
    const id = d.video_id;
    const art = 'https://img.youtube.com/vi/' + id + '/maxresdefault.jpg';
    ['mp-thumb', 'mp-big-art', 'mp-backdrop'].forEach(function (x) { const el = $(x); if (el) el.style.backgroundImage = "url('" + art + "')"; });
    const set = function (x, t) { const el = $(x); if (el) el.textContent = t; };
    set('mp-title', title); set('mp-artist', artist); set('mp-big-title', title); set('mp-big-artist', artist);
    const yt = $('mp-yt'); if (yt) yt.href = 'https://youtu.be/' + id;
  }

  window.onYouTubeIframeAPIReady = function () {
    if (typeof YT === 'undefined' || !YT.Player) { ytError = true; return; }
    try {
      ytPlayer = new YT.Player('yt-music-iframe', {
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1, rel: 0, iv_load_policy: 3, listType: 'playlist', list: YT_PLAYLIST_ID },
        events: {
          onReady: function () {
            ytReady = true;
            const vol = $('mp-vol');
            try { ytPlayer.setVolume(vol ? Number(vol.value) : 70); } catch (e) {}
            applyRepeat();     // apply the current repeat mode (default: repeat all)
            setTimeout(syncMeta, 400);
            if (wantPlay) { try { ytPlayer.playVideo(); } catch (e) {} }
          },
          onStateChange: function (e) {
            if (e.data === 1) { setVisuals(true); progressLoop(); syncMeta(); }        // playing
            else if (e.data === 2) { setVisuals(false); }                              // paused
            else if (e.data === 3 || e.data === 5) { syncMeta(); }                     // buffering / cued -> refresh meta
            else if (e.data === 0) {                                                   // ended
              if (repeatMode === 'one') { try { ytPlayer.seekTo(0); ytPlayer.playVideo(); } catch (er) {} }  // loop this song
              else { setVisuals(false); }                                              // 'all' loops the list via setLoop; 'off' stops
            }
          },
          onError: function (e) { ytError = true; setVisuals(false); console.warn('YouTube player error:', e.data); }
        }
      });
    } catch (err) { ytError = true; console.warn('YT.Player init failed:', err); }
  };
  const tag = document.createElement('script'); tag.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(tag);
  setTimeout(function () { if (!ytReady && !ytError) { ytError = true; } }, 8000);

  function doPlay() { if (ytError) return; wantPlay = true; if (!ytReady) { setVisuals(true); return; } try { ytPlayer.playVideo(); } catch (e) {} }
  function doPause() { wantPlay = false; if (!ytReady) { setVisuals(false); return; } try { ytPlayer.pauseVideo(); } catch (e) {} }
  function togglePlay() { if (isPlaying) doPause(); else doPlay(); }
  function setVolume(v) { if (ytReady) { try { ytPlayer.setVolume(v); } catch (e) {} } }
  function fmt(t) { t = Math.max(0, Math.floor(t || 0)); const m = Math.floor(t / 60); const s = t % 60; return m + ':' + (s < 10 ? '0' : '') + s; }

  // seeking flag lets the drag own the seek bar without the rAF loop fighting it.
  let seeking = false, seekRatio = 0, loopId = null;
  function progressLoop() {
    cancelAnimationFrame(loopId);
    (function step() {
      if (!ytReady || !isPlaying) return;
      if (!seeking) {
        let cur = 0, dur = 0;
        try { cur = ytPlayer.getCurrentTime() || 0; dur = ytPlayer.getDuration() || 0; } catch (e) {}
        const ct = $('mp-cur'), dt = $('mp-dur'), fl = $('mp-seek-fill');
        if (ct) ct.textContent = fmt(cur); if (dt) dt.textContent = fmt(dur);
        if (fl) fl.style.width = (dur ? (cur / dur * 100) : 0) + '%';
      }
      loopId = requestAnimationFrame(step);
    })();
  }

  function openPlayer() {
    if (miniPlayer) { miniPlayer.classList.add('open'); miniPlayer.setAttribute('aria-hidden', 'false'); }
    // No auto-play on open (prevents incidental external scrobbles) — play starts on explicit press.
  }
  function closePlayer() { if (miniPlayer) { miniPlayer.classList.remove('open', 'expanded'); miniPlayer.setAttribute('aria-hidden', 'true'); } }
  if (musicWidget) musicWidget.addEventListener('click', openPlayer);
  // Tap anywhere outside the player (and not on the topbar music button that
  // opens it) closes it — easy dismiss. Playback keeps going; only the panel hides.
  document.addEventListener('click', function (e) {
    if (!miniPlayer || !miniPlayer.classList.contains('open')) return;
    if (e.target.closest('#mini-player') || e.target.closest('#topbar-music-icon')) return;
    closePlayer();
  });
  const mpClose = $('mp-close'); if (mpClose) mpClose.addEventListener('click', closePlayer);
  const mpPlay = $('mp-play'); if (mpPlay) mpPlay.addEventListener('click', togglePlay);
  const mpExpand = $('mp-expand'); if (mpExpand) mpExpand.addEventListener('click', function () { if (miniPlayer) miniPlayer.classList.toggle('expanded'); });

  // Volume — native range (smooth), with an accent fill that follows the thumb.
  const mpVol = $('mp-vol'), mpVolIcon = $('mp-vol-icon');
  function updateVolIcon(v) { var n = Number(v); if (mpVolIcon) mpVolIcon.textContent = (n === 0) ? 'volume_off' : (n < 50 ? 'volume_down' : 'volume_up'); }
  // The filled track is now rendered natively (accent-color), so input only
  // updates the icon (cheap) and throttles the YouTube setVolume() call — each
  // call is a postMessage to the iframe, so we cap them at ~1 per 90ms during a
  // drag and always apply the final value on release (`change`).
  if (mpVol) {
    let lastVolTs = 0;
    mpVol.addEventListener('input', function (e) {
      var v = e.target.value;
      updateVolIcon(v);
      var now = (window.performance && performance.now) ? performance.now() : Date.now();
      if (now - lastVolTs >= 90) { lastVolTs = now; setVolume(v); }
    });
    mpVol.addEventListener('change', function (e) { setVolume(e.target.value); });
  }

  // Prev / Next — navigate the YouTube playlist natively.
  const mpPrev = $('mp-prev'), mpNext = $('mp-next');
  if (mpPrev) mpPrev.addEventListener('click', function () { wantPlay = true; try { ytPlayer.previousVideo(); } catch (e) {} });
  if (mpNext) mpNext.addEventListener('click', function () { wantPlay = true; try { ytPlayer.nextVideo(); } catch (e) {} });

  // Shuffle.
  let shuffleOn = false;
  const mpShuffle = $('mp-shuffle');
  if (mpShuffle) mpShuffle.addEventListener('click', function () { shuffleOn = !shuffleOn; try { ytPlayer.setShuffle(shuffleOn); } catch (e) {} mpShuffle.classList.toggle('active', shuffleOn); });

  // Repeat — three-state cycle: all (loop playlist) -> one (loop this song) -> off.
  // YouTube has no native "loop one" for playlists, so 'one' is handled in the
  // ENDED handler above by replaying the current track.
  let repeatMode = 'all';
  const mpRepeat = $('mp-repeat');
  const mpRepeatIcon = mpRepeat ? mpRepeat.querySelector('.material-symbols-outlined') : null;
  function applyRepeat() {
    try { ytPlayer.setLoop(repeatMode === 'all'); } catch (e) {}
    if (mpRepeat) {
      mpRepeat.classList.toggle('active', repeatMode !== 'off');
      mpRepeat.title = repeatMode === 'one' ? 'Repeat one' : repeatMode === 'all' ? 'Repeat all' : 'Repeat off';
      mpRepeat.setAttribute('aria-label', mpRepeat.title);
    }
    if (mpRepeatIcon) mpRepeatIcon.textContent = repeatMode === 'one' ? 'repeat_one' : 'repeat';
  }
  applyRepeat();
  if (mpRepeat) mpRepeat.addEventListener('click', function () {
    repeatMode = repeatMode === 'all' ? 'one' : (repeatMode === 'one' ? 'off' : 'all');
    applyRepeat();
  });

  // Seek bar — smooth: only repaint while dragging, seek ONCE on release
  // (calling seekTo on every pointermove made YouTube re-buffer and stutter).
  const seekBar = $('mp-seek-bar');
  if (seekBar) {
    const fl = $('mp-seek-fill');
    function seekPct(clientX) { const r = seekBar.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - r.left) / r.width)); }
    function paintSeek(ratio) {
      if (fl) fl.style.width = (ratio * 100) + '%';
      const ct = $('mp-cur'); if (ct && ytReady) { let dur = 0; try { dur = ytPlayer.getDuration() || 0; } catch (e) {} ct.textContent = fmt(ratio * dur); }
    }
    seekBar.addEventListener('pointerdown', function (e) { seeking = true; try { seekBar.setPointerCapture(e.pointerId); } catch (_) {} seekRatio = seekPct(e.clientX); paintSeek(seekRatio); e.preventDefault(); });
    seekBar.addEventListener('pointermove', function (e) { if (!seeking) return; seekRatio = seekPct(e.clientX); paintSeek(seekRatio); });
    function endSeek() { if (!seeking) return; seeking = false; if (ytReady) { try { ytPlayer.seekTo(seekRatio * (ytPlayer.getDuration() || 0), true); } catch (e) {} } }
    seekBar.addEventListener('pointerup', endSeek);
    seekBar.addEventListener('pointercancel', endSeek);
  }

  // Drag the mini player anywhere on screen (persists position in localStorage).
  // Clicks on controls (buttons, inputs, links, the seek bar) are not treated as drags.
  if (miniPlayer) {
    try {
      var saved = JSON.parse(localStorage.getItem('mp_pos') || 'null');
      if (saved && typeof saved.l === 'number' && typeof saved.t === 'number') {
        miniPlayer.style.left = saved.l + 'px'; miniPlayer.style.top = saved.t + 'px';
        miniPlayer.style.right = 'auto'; miniPlayer.style.bottom = 'auto';
      }
    } catch (e) {}
    var drag = null;
    miniPlayer.addEventListener('pointerdown', function (e) {
      if (!miniPlayer.classList.contains('open')) return;
      if (e.target.closest('button, input, a, .mp-seek-bar')) return;
      var r = miniPlayer.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      miniPlayer.classList.add('dragging');
    });
    window.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var w = miniPlayer.offsetWidth, h = miniPlayer.offsetHeight;
      var x = Math.max(8, Math.min(window.innerWidth - w - 8, e.clientX - drag.dx));
      var y = Math.max(8, Math.min(window.innerHeight - h - 8, e.clientY - drag.dy));
      miniPlayer.style.left = x + 'px'; miniPlayer.style.top = y + 'px';
      miniPlayer.style.right = 'auto'; miniPlayer.style.bottom = 'auto';
    });
    window.addEventListener('pointerup', function () {
      if (!drag) return;
      drag = null;
      miniPlayer.classList.remove('dragging');
      var r = miniPlayer.getBoundingClientRect();
      try { localStorage.setItem('mp_pos', JSON.stringify({ l: Math.round(r.left), t: Math.round(r.top) })); } catch (e) {}
    });
  }

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
    const toggleBtn = $('skill-toggle');
    function render(cat) {
      const items = cat === 'ALL' ? SKILLS : SKILLS.filter(s => s.cat === cat);
      $('skill-count').textContent = items.length + ' skills';
      list.innerHTML = items.map(s => `<div class="skill-item"><div class="skill-item-head"><span class="skill-item-icon material-symbols-outlined">${s.icon}</span><span class="skill-item-name">${s.name}</span><span class="skill-item-cat">${s.cat}</span></div><div class="skill-item-desc">${s.desc}</div></div>`).join('');
    }
    render('ALL');
    if (tabs) tabs.addEventListener('click', (e) => { const t = e.target.closest('.skill-tab'); if (!t) return; tabs.querySelectorAll('.skill-tab').forEach(b => b.classList.remove('active')); t.classList.add('active'); render(t.dataset.cat); });
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        var isOpen = list.classList.contains('open');
        list.classList.toggle('open', !isOpen);
        toggleBtn.classList.toggle('open', !isOpen);
        toggleBtn.querySelector('.skill-toggle-text').textContent = isOpen ? 'Show All Skills' : 'Hide Skills';
      });
    }
  })();

  /* ============================================================
     6. PROJECTS (with generated thumbnails)
     ============================================================ */
  const PROJECTS = [
    {
      cat: 'AI Healthcare Platform · Python · Streamlit',
      name: 'SmartHealthCare AI',
      desc: 'A full-stack AI healthcare platform with four modules — Disease Prediction (Random Forest, 41 diseases), Drug Recommendation (cosine similarity over 9,720 medicines), Heart Risk Assessment (BRFSS 2022 models with PDF export), and MediBot, a RAG chatbot using FAISS + Groq LLM with voice input.',
      tags: ['Python', 'ML', 'Streamlit', 'RAG', 'FAISS'],
      repo: 'https://github.com/YatinSharma1303/SmartHealthCare-For-Early-Diagnosis-Using-Artificial-Intelligence',
      live: null,
      img: 'assets/smarthealthcare.jpg'
    },
    {
      cat: 'AI Chat App · JavaScript · Live on Vercel',
      name: 'YatiniGPT',
      desc: 'A custom GPT-style conversational AI web app with a clean, fast chat interface. Built with modern JavaScript and deployed on Vercel — type a prompt, get a streamed answer, all wrapped in a minimal UI.',
      tags: ['JavaScript', 'AI', 'Vercel'],
      repo: 'https://github.com/YatinSharma1303/YatiniGPT',
      live: 'https://yatini-gpt.vercel.app/',
      img: 'assets/yatinigpt.jpg'
    }
  ];
  (function projects() {
    const grid = $('projects-grid'); if (!grid) return;
    grid.innerHTML = PROJECTS.map(p => {
      const thumb = p.img
        ? '<img class="project-thumb-img" src="' + p.img + '" alt="' + esc(p.name) + '" loading="lazy">'
        : '<div class="project-thumb"></div>';
      const preview = p.img ? '<div class="project-preview"><img src="' + p.img + '" alt="' + esc(p.name) + ' preview"></div>' : '';
      return '<article class="project-card">' + preview + thumb +
        '<div class="project-body">' +
        '<div class="project-cat"><span class="material-symbols-outlined">category</span>' + p.cat + '</div>' +
        '<div class="project-name">' + p.name + '</div>' +
        '<div class="project-desc">' + p.desc + '</div>' +
        '<div class="project-tags">' + p.tags.map(t => '<span>' + t + '</span>').join('') + '</div>' +
        '<div class="project-actions">' +
        '<a class="project-dl-btn" href="' + p.repo + '" target="_blank" rel="noopener"><span class="material-symbols-outlined">code</span>Source</a>' +
        (p.live ? '<a class="project-live-btn" href="' + p.live + '" target="_blank" rel="noopener"><span class="material-symbols-outlined">open_in_new</span>Live Demo</a>' : '') +
        '</div></div></article>';
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
      fetch(`https://api.github.com/users/${user}/repos?per_page=100`).then(r => r.json()).then(repos => {
        if (!Array.isArray(repos)) return;
        
        // 1. Render Top 6 Repos
        const wrap = $('gh-repos-list'); if (wrap) {
          const LANG_COLOR = { JavaScript: '#f1e05a', Python: '#3572A5', TypeScript: '#3178c6', HTML: '#e34c26', CSS: '#563d7c', 'Jupyter Notebook': '#DA5B0B' };
          wrap.innerHTML = repos.slice(0, 6).map(r => `<a class="gh-repo" href="${r.html_url}" target="_blank" rel="noopener" style="--lang-color:${LANG_COLOR[r.language]||'#888'}"><div class="gh-repo-name">${r.name}</div><div class="gh-repo-desc">${esc((r.description||'—').slice(0,90))}</div><div class="gh-repo-meta">${r.language ? `<span class="gh-repo-lang">${r.language}</span>` : ''}<span>★ ${r.stargazers_count}</span></div></a>`).join('');
        }

        // 2. Calculate Languages for Donut Chart
        const langCounts = {};
        repos.forEach(r => { if (r.language) langCounts[r.language] = (langCounts[r.language] || 0) + 1; });
        const sortedLangs = Object.entries(langCounts).sort((a, b) => b[1] - a[1]);
        const topLangs = sortedLangs.slice(0, 5);
        const totalRepos = sortedLangs.reduce((s, [, c]) => s + c, 0);
        
        const LANG_COLOR = { JavaScript: '#f1e05a', Python: '#3572A5', TypeScript: '#3178c6', HTML: '#e34c26', CSS: '#563d7c', 'Jupyter Notebook': '#DA5B0B' };
        
        // Build Conic Gradient
        let cumulativePercent = 0;
        const gradientStops = topLangs.map(([lang, count]) => {
          const percent = (count / totalRepos) * 100;
          const start = cumulativePercent;
          cumulativePercent += percent;
          const color = LANG_COLOR[lang] || '#888888';
          return `${color} ${start}% ${cumulativePercent}%`;
        }).join(', ');
        
        const chartEl = $('gh-lang-chart');
        if (chartEl) chartEl.style.background = `conic-gradient(${gradientStops})`;
        
        // Build Legend
        const legendEl = $('gh-lang-legend');
        if (legendEl) {
          legendEl.innerHTML = topLangs.map(([lang, count]) => {
            const color = LANG_COLOR[lang] || '#888888';
            const percent = Math.round((count / totalRepos) * 100);
            return `<div class="gh-lang-pill"><span class="gh-lang-dot" style="background:${color}"></span> ${esc(lang)} (${percent}%)</div>`;
          }).join('');
        }
      })
    );
  }

  /* ============================================================
     8. LAST.FM
     ============================================================ */

  function fetchLastfm() {
    if (window.__lastfmLoading) return Promise.resolve();
    window.__lastfmLoading = true;
    const u = CONFIG.lastfmUser;
    let nowPlayingTimer = window.__lastfmTimer || null;

    // -- Feature 1 & 5: NP progress bar state + art carousel --
    let npProgressTimer = null;
    let npStartUts = null;
    let npTrackKey = null;
    let npArtUrls = [];
    let npArtIdx = 0;
    let npArtCrossfaded = false;

    // -- Feature 3: Genre cloud state --
    let genreCounts = new Map();

    function artDiv(className, url, fallbackText) {
      if (url) return '<div class="' + className + '" style="background:#141414 url(\'' + url + '\') center/cover no-repeat"></div>';
      return '<div class="' + className + ' lfm-noart" style="background:#141414 !important">' + (fallbackText || '♪') + '</div>';
    }

    function artistFallback(name, idx) {
      const gradients = [
        'linear-gradient(135deg, rgba(0, 200, 255, 0.5), rgba(120, 80, 255, 0.5))',
        'linear-gradient(135deg, rgba(0, 240, 180, 0.5), rgba(0, 200, 255, 0.5))',
        'linear-gradient(135deg, rgba(120, 80, 255, 0.5), rgba(0, 240, 180, 0.5))',
        'linear-gradient(135deg, rgba(0, 200, 255, 0.5), rgba(0, 240, 180, 0.5))',
        'linear-gradient(135deg, rgba(0, 240, 180, 0.5), rgba(120, 80, 255, 0.5))'
      ];
      return '<div class="lfm-artist-img lfm-noart lfm-artist-gradient" style="background:' + gradients[idx % gradients.length] + '; color:#ffffff !important;">' + esc((name || '?').charAt(0).toUpperCase()) + '</div>';
    }

    /* Cover art for Top Tracks / Top Artists is resolved server-side inside the
       /api/lastfm bundle (each item carries an `artUrl`). Last.fm's top endpoints
       return no real art, and resolving it client-side fired too many calls and
       rate-limited the key (slowness). See enrichArt() in api/lastfm.js. */

    // Loved tracks cache — set of "artist::track" (lowercase)
    let lovedTrackKeys = new Set();
    function isLovedTrack(trackName, artistName) {
      if (!lovedTrackKeys.size) return false;
      return lovedTrackKeys.has(((artistName || '').toLowerCase() + '::' + (trackName || '').toLowerCase()));
    }
    function fetchLovedTracks() {
      fetchWithTimeout(lfmAPI + '?method=user.getlovedtracks&user=' + encodeURIComponent(u) + '&limit=200', 5000)
        .then(r => r.json())
        .then(d => {
          const tracks = (d.lovedtracks && d.lovedtracks.track) || [];
          lovedTrackKeys = new Set();
          tracks.forEach(tr => {
            const a = (tr.artist && (tr.artist.name || tr.artist['#text'])) || '';
            const n = tr.name || '';
            if (a && n) lovedTrackKeys.add(a.toLowerCase() + '::' + n.toLowerCase());
          });
          // Re-render if data available
          const cached = cachedBundle();
          if (cached) { renderRecent(cached.recenttracks); renderTopSection(cached); }
        })
        .catch(() => {});
    }

    // Genre tags — fetched async, non-blocking.
    // Primary: track.getTopTags (per-track). Fallback: artist.getTopTags (per-artist).
    var artistTagFetchDone = false;
    function fetchTrackTags(tracks) {
      var fetchedCount = 0;
      var totalTracks = tracks.length;
      tracks.forEach((tr, idx) => {
        const artistName = tr.artist ? (tr.artist.name || tr.artist['#text'] || '') : '';
        const trackName = tr.name || '';
        if (!artistName || !trackName) return;
        const cacheKey = 'lfm_tags_' + artistName.toLowerCase() + '::' + trackName.toLowerCase();
        try {
          const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
          if (cached && Date.now() - cached.ts < 24 * 60 * 60 * 1000) {
            renderTrackTags(idx, cached.tags);
            fetchedCount++;
            return;
          }
        } catch (e) {}
        fetchWithTimeout(lfmAPI + '?method=track.getTopTags&artist=' + encodeURIComponent(artistName) + '&track=' + encodeURIComponent(trackName) + '&autocorrect=1', 3000)
          .then(r => r.json())
          .then(d => {
            const tags = ((d.toptags && d.toptags.tag) || []).slice(0, 2).map(t => t.name);
            if (tags.length) {
              try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), tags: tags })); } catch (e) {}
              renderTrackTags(idx, tags);
            }
          })
          .catch(() => {});
      });
      // After a delay, check if genre cloud is still empty — if so, fallback to artist tags
      setTimeout(function() {
        if (genreCounts.size > 0 || artistTagFetchDone) return;
        fetchArtistTagsForCloud(tracks);
      }, 4000);
    }
    // Fallback: pull genre tags from the artists of the top tracks
    function fetchArtistTagsForCloud(tracks) {
      artistTagFetchDone = true;
      var seenArtists = new Set();
      var artistNames = [];
      tracks.forEach(function(tr) {
        var a = tr.artist ? (tr.artist.name || tr.artist['#text'] || '') : '';
        if (a && !seenArtists.has(a.toLowerCase())) {
          seenArtists.add(a.toLowerCase());
          artistNames.push(a);
        }
      });
      var tagPromises = artistNames.slice(0, 5).map(function(artistName) {
        var cacheKey = 'lfm_atags_' + artistName.toLowerCase();
        try {
          var cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
          if (cached && Date.now() - cached.ts < 24 * 60 * 60 * 1000) {
            return Promise.resolve(cached.tags);
          }
        } catch (e) {}
        return fetchWithTimeout(lfmAPI + '?method=artist.getTopTags&artist=' + encodeURIComponent(artistName) + '&autocorrect=1', 3000)
          .then(function(r) { return r.json(); })
          .then(function(d) {
            var tags = ((d.toptags && d.toptags.tag) || []).slice(0, 3).map(function(t) { return t.name; });
            if (tags.length) {
              try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), tags: tags })); } catch (e) {}
            }
            return tags;
          })
          .catch(function() { return []; });
      });
      Promise.all(tagPromises).then(function(allArtistTags) {
        allArtistTags.forEach(function(tags) {
          tags.forEach(function(t) {
            var key = t.toLowerCase();
            genreCounts.set(key, (genreCounts.get(key) || 0) + 1);
          });
        });
        updateGenreCloud();
      });
    }
    function renderTrackTags(idx, tags) {
      const allTagEls = document.querySelectorAll('.lfm-track-tags');
      if (allTagEls[idx]) {
        allTagEls[idx].innerHTML = tags.map(t => '<span class="lfm-track-tag">' + esc(t) + '</span>').join('');
      }
      // Feature 3: collect tags for genre cloud
      tags.forEach(t => {
        const key = t.toLowerCase();
        genreCounts.set(key, (genreCounts.get(key) || 0) + 1);
      });
      updateGenreCloud();
    }

    // Feature 4: Genre cloud rendering
    // Filter out overly generic tags that aren't useful as genre indicators
    var BAD_GENRE_TAGS = ['seen live','favorites','favorite','love','loved','amazing','awesome','beautiful','chill','cool','good','great','best','amazing','perfect','epic','nice','guilty pleasure','overplayed','songs','music','default','unknown','other','to listen','check out'];
    function updateGenreCloud() {
      const cloudEl = $('lfm-genre-cloud');
      if (!cloudEl) return;
      // Filter bad tags
      var filtered = new Map();
      genreCounts.forEach(function(count, tag) {
        if (BAD_GENRE_TAGS.indexOf(tag.toLowerCase()) === -1) {
          filtered.set(tag, count);
        }
      });
      const sorted = [...filtered.entries()].sort((a, b) => b[1] - a[1]);
      const top5 = sorted.slice(0, 5);
      if (top5.length === 0) { cloudEl.style.display = 'none'; return; }
      cloudEl.style.display = 'flex';
      cloudEl.innerHTML = '<span class="lfm-genre-cloud-label">YOUR VIBE</span>' + top5.map(function(entry) {
        return '<span class="lfm-genre-pill">' + esc(entry[0]) + '</span>';
      }).join('');
    }

    // Feature 4 & 7: Build track HTML with play count bar and tooltip
    function buildTrackHtml(tr, idx, tracks) {
      const url = tr.artUrl || lfmImg(tr.image);
      const art = url
        ? '<div class="lfm-track-img" style="background:#141414 url(\'' + url + '\') center/cover no-repeat"></div>'
        : '<div class="lfm-track-img lfm-noart" style="background:#141414 !important">♪</div>';
      const artistName = tr.artist ? (tr.artist.name || tr.artist['#text'] || '') : '';
      const loved = isLovedTrack(tr.name, artistName);
      const lovedHtml = loved ? '<span class="lfm-loved">♥</span>' : '';
      const albumName = (tr.album && (tr.album['#text'] || tr.album.name)) || '';
      const pc = parseInt(tr.playcount, 10) || 0;
      const maxPc = tracks.reduce(function(m, t) { return Math.max(m, parseInt(t.playcount, 10) || 0); }, 1);
      const barPct = Math.round((pc / maxPc) * 100);
      const playsBarHtml = '<div class="lfm-track-plays-bar"><div class="lfm-track-plays-bar-fill" style="width:' + barPct + '%"></div></div>';
      // Tooltip content
      var tipParts = [];
      if (albumName) tipParts.push('Album: ' + esc(albumName));
      tipParts.push('Plays: ' + pc.toLocaleString());
      if (loved) tipParts.push('<span class="lfm-track-tip-loved">♥ Loved</span>');
      const tipHtml = '<div class="lfm-track-tip">' + tipParts.join(' · ') + '</div>';
      return '<div class="lfm-track" data-album="' + esc(albumName) + '" data-plays="' + pc + '" data-loved="' + (loved ? '1' : '0') + '">' + tipHtml + '<span class="lfm-track-rank">' + (idx+1) + '</span>' + art + '<div class="lfm-track-info"><div class="lfm-track-name">' + esc(tr.name) + lovedHtml + '</div><div class="lfm-track-artist">' + esc(artistName) + '</div><div class="lfm-track-tags" data-artist="' + esc(artistName) + '" data-track="' + esc(tr.name) + '"></div></div><span class="lfm-track-plays">' + formatPlays(tr.playcount) + playsBarHtml + '</span></div>';
    }

    // Feature 1 & 5: NP progress bar timer + album art carousel
    function updateNpProgress(isLive, track) {
      if (npProgressTimer) { clearInterval(npProgressTimer); npProgressTimer = null; }
      const bar = $('lfm-np-progress-bar');
      if (!bar) return;
      npArtCrossfaded = false;
      if (!isLive) { bar.style.width = '0'; return; }
      // Determine start time
      var uts = (track && track.date && parseInt(track.date.uts, 10)) || 0;
      var key = ((track && track.artist && (track.artist['#text'] || track.artist.name)) || '') + '::' + (track.name || '');
      if (key !== npTrackKey) {
        npTrackKey = key;
        npStartUts = uts || Math.floor(Date.now() / 1000);
      }
      function tick() {
        var now = Math.floor(Date.now() / 1000);
        var elapsed = now - npStartUts;
        var progress = Math.min(Math.max(elapsed / 210, 0), 1);
        bar.style.width = (progress * 100) + '%';
        // Feature 5: crossfade NP background art at ~90%
        if (progress >= 0.9 && !npArtCrossfaded && npArtUrls.length > 1) {
          npArtCrossfaded = true;
          npArtIdx = (npArtIdx + 1) % npArtUrls.length;
          var bg = $('lfm-np-bg');
          var ghost = $('lfm-np-bg-ghost');
          if (bg && npArtUrls[npArtIdx]) {
            bg.style.opacity = '0';
            if (ghost) ghost.style.opacity = '0';
            setTimeout(function() {
              bg.style.backgroundImage = 'url(\'' + npArtUrls[npArtIdx] + '\')';
              bg.style.opacity = '';
              if (ghost) {
                ghost.style.backgroundImage = 'url(\'' + npArtUrls[npArtIdx] + '\')';
                ghost.style.opacity = '';
              }
            }, 400);
          }
        }
      }
      tick();
      npProgressTimer = setInterval(tick, 2000);
    }

    // Period tab switching
    window.__lfmPeriod = '1month';
    function renderTopSection(d) {
      const tracksWrap = $('lfm-tracks');
      const tracks = (d.toptracks && d.toptracks.track) || [];
      if (tracksWrap && tracks.length) {
        // Reset genre cloud for new period
        genreCounts = new Map();
        tracksWrap.innerHTML = tracks.map((tr, idx) => buildTrackHtml(tr, idx, tracks)).join('');
        fetchTrackTags(tracks);
      }
      const artistsWrap = $('lfm-artists');
      const artists = (d.topartists && d.topartists.artist) || [];
      if (artistsWrap && artists.length) {
        artistsWrap.innerHTML = artists.map((ar, idx) => {
          const url = ar.artUrl || lfmImg(ar.image);
          const art = url ? '<div class="lfm-artist-img" style="background:#141414 url(\'' + url + '\') center/cover no-repeat"></div>' : artistFallback(ar.name, idx);
          return '<div class="lfm-artist"><span class="lfm-artist-rank">' + (idx+1) + '</span>' + art + '<span class="lfm-artist-name">' + esc(ar.name) + '</span><span class="lfm-artist-plays">' + formatPlays(ar.playcount) + '</span></div>';
        }).join('');
      }
    }
    function setupPeriodTabs() {
      const tabsWrap = $('lfm-period-tabs');
      if (!tabsWrap) return;
      tabsWrap.addEventListener('click', function(e) {
        const btn = e.target.closest('.lfm-period-tab');
        if (!btn) return;
        const period = btn.dataset.period;
        if (!period || period === window.__lfmPeriod) return;
        window.__lfmPeriod = period;
        tabsWrap.querySelectorAll('.lfm-period-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Show skeletons
        const tracksWrap = $('lfm-tracks');
        const artistsWrap = $('lfm-artists');
        if (tracksWrap) tracksWrap.innerHTML = '<div class="lfm-track"><div class="skeleton" style="width:40px;height:40px;border-radius:8px;flex-shrink:0"></div><div style="flex:1"><div class="skeleton" style="width:80%;height:12px;margin-bottom:4px"></div><div class="skeleton" style="width:50%;height:10px"></div></div></div>'.repeat(3);
        if (artistsWrap) artistsWrap.innerHTML = '<div class="lfm-artist"><div class="skeleton" style="width:40px;height:40px;border-radius:50%;flex-shrink:0"></div><div class="skeleton" style="flex:1;height:12px"></div></div>'.repeat(3);
        // Fetch via bundle endpoint (includes server-side art enrichment)
        fetchWithTimeout(lfmAPI + '?bundle=1&user=' + encodeURIComponent(u) + '&period=' + period, 6000)
          .then(r => r.json())
          .then(d => { renderTopSection({ toptracks: d.toptracks, topartists: d.topartists }); })
          .catch(() => {});
      });
    }

    function renderBundle(d) {
      if (!d) return;
      const user = d.user;
      if (user) {
        const av = $('lfm-avatar');
        if (av) { const url = lfmImg(user.image); if (url) av.src = url; }
        const sc = $('lfm-sc'), ac = $('lfm-ac'), alc = $('lfm-alc');
        if (sc) sc.textContent = (user.playcount||0).toLocaleString();
        if (ac) ac.textContent = (user.artist_count||0).toLocaleString();
        if (alc) alc.textContent = (user.album_count||0).toLocaleString();
      }

      const tracksWrap = $('lfm-tracks');
      const tracks = (d.toptracks && d.toptracks.track) || [];
      if (tracksWrap && tracks.length) {
        // Reset genre cloud for new data
        genreCounts = new Map();
        tracksWrap.innerHTML = tracks.map((tr, idx) => buildTrackHtml(tr, idx, tracks)).join('');
        // Fetch genre tags asynchronously
        fetchTrackTags(tracks);
      }

      const artistsWrap = $('lfm-artists');
      const artists = (d.topartists && d.topartists.artist) || [];
      if (artistsWrap && artists.length) {
        artistsWrap.innerHTML = artists.map((ar, idx) => {
          const url = ar.artUrl || lfmImg(ar.image);
          const art = url ? '<div class="lfm-artist-img" style="background:#141414 url(\'' + url + '\') center/cover no-repeat"></div>' : artistFallback(ar.name, idx);
          return '<div class="lfm-artist"><span class="lfm-artist-rank">' + (idx+1) + '</span>' + art + '<span class="lfm-artist-name">' + esc(ar.name) + '</span><span class="lfm-artist-plays">' + formatPlays(ar.playcount) + '</span></div>';
        }).join('');
      }

      renderRecent(d.recenttracks);
    }


    // Resolve crisp cover art for a recent / now-playing track. Prefers the
    // server-enriched iTunes art (from the bundle), caches it so the 12s live
    // poll stays sharp without another server call, then falls back to Last.fm.
    // Cover-art priority for Now Playing / Recently Played:
    // 1) Last.fm high-res art if present (always correct + sharp),
    // 2) iTunes (validated) when Last.fm has no high-res art,
    // 3) Last.fm low-res art as a last resort (correct, even if soft),
    // 4) '' -> placeholder.
    // Cover-art priority for Now Playing / Recently Played — favor the SHARPEST
    // correct cover. iTunes is validated server-side (correct artist) AND 600px,
    // so it goes first; Last.fm (always correct but maxes ~300px, often 174px) is
    // the fallback only when iTunes has no confident match. Then placeholder.
    function recentTrackArt(tr) {
      if (!tr) return '';
      const a = (tr.artist && (tr.artist['#text'] || tr.artist.name)) || '';
      const n = tr.name || '';
      if (tr.artUrl) { try { localStorage.setItem('lfm_track_art_' + a + '::' + n, tr.artUrl); } catch (e) {} return tr.artUrl; }
      try { const c = localStorage.getItem('lfm_track_art_' + a + '::' + n); if (c) return c; } catch (e) {}
      return lfmImg(tr.image);
    }

    function buildStreakHtml(todayTracks) {
      if (!todayTracks || todayTracks.length === 0) return '';
      // Use the actual Last.fm live now-playing state, not a timestamp guess
      var isLive = window.__lfmIsLiveNow === true;
      var nowUts = Math.floor(Date.now() / 1000);
      var lastUts = parseInt(todayTracks[todayTracks.length - 1].date.uts);
      var lastScrobbleWasRecent = (nowUts - lastUts) < 600;
      if (isLive && lastScrobbleWasRecent) {
        return '<div class="lfm-streak"><span class="lfm-streak-dot"></span>Listening now</div>';
      }
      // Not listening now — show longest continuous listening streak today
      var bestStart = 0, bestLen = 1, curStart = 0, curLen = 1;
      for (var si = 1; si < todayTracks.length; si++) {
        var gap = parseInt(todayTracks[si].date.uts) - parseInt(todayTracks[si-1].date.uts);
        if (gap < 600) { curLen++; }
        else { if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; } curStart = si; curLen = 1; }
      }
      if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
      if (bestLen < 2 && !lastScrobbleWasRecent) {
        // Only scattered plays today, not a streak — show last play time instead
        var agoStr = timeAgo(lastUts);
        return '<div class="lfm-streak"><span class="lfm-streak-dot idle"></span>Last played ' + agoStr + '</div>';
      }
      var streakFirstUts = parseInt(todayTracks[bestStart].date.uts);
      var streakLastUts = parseInt(todayTracks[bestStart + bestLen - 1].date.uts);
      var durationSec = (streakLastUts - streakFirstUts) + 210;
      var durationMin = Math.round(durationSec / 60);
      var sh = Math.floor(durationMin / 60);
      var sm = durationMin % 60;
      var sTimeStr = sh > 0 ? sh + 'h ' + sm + 'm' : sm + 'm';
      return '<div class="lfm-streak"><span class="lfm-streak-dot idle"></span>' + sTimeStr + ' listening today</div>';
    }

    // Re-render only the streak part when live state changes (called by renderRecent)
    function refreshStreak() {
      var meta = document.querySelector('.lfm-activity-meta');
      if (!meta) return;
      var streakEl = meta.querySelector('.lfm-streak');
      if (!streakEl) return;
      // If todayTracks not yet loaded, toggle class on existing element
      if (!window.__lfmTodayTracks) {
        var dot = streakEl.querySelector('.lfm-streak-dot');
        if (dot) dot.classList.toggle('idle', !window.__lfmIsLiveNow);
        return;
      }
      var newStreak = buildStreakHtml(window.__lfmTodayTracks);
      var temp = document.createElement('div');
      temp.innerHTML = newStreak;
      streakEl.replaceWith(temp.firstElementChild);
    }

    function renderActivityChart(tracks) {
      const wrap = $('lfm-activity');
      if (!wrap) return;
      const days = [];
      const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      function localDateKey(date) {
        return date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0');
      }
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const key = localDateKey(d);
        days.push({ label: dayNames[d.getDay()], date: key, count: 0 });
      }
      tracks.forEach(tr => {
        const uts = (tr.date && tr.date.uts) || '';
        if (!uts) return;
        const d = new Date(parseInt(uts, 10) * 1000);
        const key = localDateKey(d);
        const day = days.find(dd => dd.date === key);
        if (day) day.count++;
      });
      const maxCount = Math.max(...days.map(d => d.count), 1);
      const total = days.reduce((s, d) => s + d.count, 0);
      if (total === 0) { wrap.innerHTML = ''; return; }

      // Feature 3: Listening streak — uses actual live now-playing state, not guesswork
      var today = new Date();
      var todayKey = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
      var todayTracks = tracks.filter(function(tr) {
        var uts = (tr.date && tr.date.uts) || '';
        if (!uts) return false;
        var d = new Date(parseInt(uts, 10) * 1000);
        var k = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        return k === todayKey;
      }).sort(function(a, b) { return parseInt(a.date.uts) - parseInt(b.date.uts); });
      // Store today tracks so streak can be re-rendered on live state change
      window.__lfmTodayTracks = todayTracks;
      // Ensure live state is current before building streak HTML
      var npCard = document.querySelector('.lfm-nowplaying');
      if (npCard) window.__lfmIsLiveNow = npCard.classList.contains('live');
      var streakHtml = buildStreakHtml(todayTracks);

      // Feature 7: Listening time this week (tracks × 3.5 min)
      var ltMinutes = Math.round(total * 3.5);
      var ltH = Math.floor(ltMinutes / 60);
      var ltM = ltMinutes % 60;
      var ltStr = ltH > 0 ? '≈ ' + ltH + 'h ' + ltM + 'm' : '≈ ' + ltM + 'm';
      var listeningTimeHtml = '<div class="lfm-activity-label">' + ltStr + ' this week</div>';

      wrap.innerHTML = '<div class="lfm-activity-meta"><div class="lfm-activity-label"><b>' + total + '</b> tracks this week</div>' + listeningTimeHtml + streakHtml + '</div><div class="lfm-activity-bars">' + days.map(d => {
        const h = Math.max(3, (d.count / maxCount) * 80);
        const opacity = d.count > 0 ? (0.3 + (d.count / maxCount) * 0.7) : 0.15;
        return '<div class="lfm-activity-day"><div class="lfm-activity-bar" style="height:' + h + 'px;opacity:' + opacity.toFixed(2) + '"></div><div class="lfm-activity-day-label">' + d.label + '</div></div>';
      }).join('') + '</div>';
    }

    function loadWeeklyTracks() {
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7); weekAgo.setHours(0,0,0,0);
      const from = Math.floor(weekAgo.getTime() / 1000);
      return fetchWithTimeout(`${lfmAPI}?method=user.getrecenttracks&user=${encodeURIComponent(u)}&limit=200&from=${from}&extended=0`, 6000)
        .then(r => r.json())
        .then(d => {
          const tracks = (d.recenttracks && d.recenttracks.track) || [];
          renderActivityChart(tracks);
          return tracks;
        })
        .catch(() => {});
    }

    function renderRecent(recenttracks) {
      const tracks = (recenttracks && recenttracks.track) || [];
      if (!tracks.length) return;
      const first = tracks[0];
      const isLive = first['@attr'] && first['@attr'].nowplaying === 'true';
      const npArtEl = $('lfm-np-art');
      const npBgEl = $('lfm-np-bg');
      if (npArtEl) {
        const url = recentTrackArt(first);
        if (url) { npArtEl.style.cssText = 'background:#141414 url(\'' + url + '\') center/cover no-repeat'; npArtEl.classList.remove('lfm-noart'); npArtEl.textContent = ''; }
        else { npArtEl.style.cssText = 'background:#141414'; npArtEl.classList.add('lfm-noart'); npArtEl.textContent = '\u266A'; }
        npArtEl.style.visibility = 'visible';
        if (npBgEl) {
          if (url && isLive) { npBgEl.style.backgroundImage = 'url(\'' + url + '\')'; }
          else { npBgEl.style.backgroundImage = ''; }
        }
        var npBgGhost = $('lfm-np-bg-ghost');
        if (npBgGhost) {
          if (url && isLive) { npBgGhost.style.backgroundImage = 'url(\'' + url + '\')'; }
          else { npBgGhost.style.backgroundImage = ''; }
        }
      }
      const npTrack = $('lfm-np-track'); if (npTrack && first.name) npTrack.textContent = first.name;
      const npArtist = $('lfm-np-artist'); if (npArtist) { const a = (first.artist && (first.artist['#text'] || first.artist.name)) || ''; if (a) npArtist.textContent = a; }
      const npAlbum = $('lfm-np-album'); if (npAlbum) {
        const albumName = (first.album && first.album['#text']) || '';
        const artistName = (first.artist && (first.artist['#text'] || first.artist.name)) || '';
        const show = albumName && albumName.toLowerCase() !== artistName.toLowerCase();
        npAlbum.textContent = show ? albumName : '';
        npAlbum.style.display = show ? '' : 'none';
      }
      const npCard = $('lfm-nowplaying'); if (npCard) npCard.classList.toggle('live', !!isLive);
      const npLabel = $('lfm-np-label'); if (npLabel) npLabel.textContent = isLive ? 'NOW PLAYING' : 'LAST PLAYED';

      // Track live state for accurate streak indicator
      var wasLive = window.__lfmIsLiveNow;
      window.__lfmIsLiveNow = !!isLive;
      // Always refresh streak to keep it synced with NP card
      try { refreshStreak(); } catch(e) {}

      // Feature 1 & 5: Update progress bar and collect art URLs for carousel
      updateNpProgress(isLive, first);
      npArtUrls = [];
      npArtIdx = 0;
      tracks.forEach(function(tr) {
        var artUrl = recentTrackArt(tr);
        if (artUrl) npArtUrls.push(artUrl);
      });

      const recentWrap = $('lfm-recent');
      if (recentWrap) {
        const tickerTracks = isLive ? tracks.slice(1, 9) : tracks.slice(0, 9);
        recentWrap.innerHTML = tickerTracks.map(tr => {
          const artistName = (tr.artist && (tr.artist['#text'] || tr.artist.name)) || '';
          const lovedHtml = isLovedTrack(tr.name, artistName) ? ' <span class="lfm-loved">♥</span>' : '';
          const nameHtml = esc(tr.name || '—') + lovedHtml;
          const uts = (tr.date && tr.date.uts) || '';
          const ago = timeAgo(uts);
          const timeHtml = ago ? '<div class="lfm-recent-time">' + ago + '</div>' : '';
          return '<div class="lfm-recent-item">' + artDiv('lfm-recent-img', recentTrackArt(tr), '♪') + '<div class="lfm-recent-info"><div class="lfm-recent-name">' + nameHtml + '</div><div class="lfm-recent-artist">' + esc(artistName) + '</div>' + timeHtml + '</div></div>';
        }).join('');
      }
    }


    function cachedBundle() {
      try {
        const cached = JSON.parse(localStorage.getItem('lastfm_bundle_cache') || 'null');
        if (cached && cached.data && Date.now() - cached.ts < 10 * 60 * 1000) return cached.data;
      } catch (e) {}
      return null;
    }

    function saveBundleCache(data) {
      try { if (data && (data.user || data.toptracks || data.topartists || data.recenttracks)) localStorage.setItem('lastfm_bundle_cache', JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
    }

    function fetchWithTimeout(url, timeoutMs) {
      timeoutMs = timeoutMs || 4500;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    }

    function loadBundle() {
      const cached = cachedBundle();
      if (cached) renderBundle(cached);
      return fetchWithTimeout(`${lfmAPI}?bundle=1&user=${encodeURIComponent(u)}`, 5000)
        .then(r => r.json())
        .then(d => { saveBundleCache(d); renderBundle(d); })
        .then(() => { fetchLovedTracks(); setupPeriodTabs(); loadWeeklyTracks(); })
        .catch(err => {
          console.warn('Last.fm bundle failed:', err);
          if (!cached) {
            const tracksWrap = $('lfm-tracks'); if (tracksWrap) tracksWrap.innerHTML = '<div class="lfm-track">Last.fm is waking up. Music stats will appear shortly.</div>';
          }
        });
    }

    function updateNowPlaying() {
      fetchWithTimeout(`${lfmAPI}?method=user.getrecenttracks&user=${encodeURIComponent(u)}&limit=10&_=${Date.now()}`, 4500)
        .then(r => r.json())
        .then(d => renderRecent(d.recenttracks))
        .catch(() => {});
    }

    if (nowPlayingTimer) clearInterval(nowPlayingTimer);
    return loadBundle().then(() => {
      updateNowPlaying();
      window.__lastfmTimer = setInterval(updateNowPlaying, 12000);
    }).finally(() => { window.__lastfmLoading = false; });
  }


  // Start Last.fm after initial page load too, not only after intro dismiss.
  window.addEventListener('load', () => {
    setTimeout(() => { try { fetchLastfm(); } catch (e) {} }, 1200);
  }, { once: true });

  /* ============================================================
     9. ANILIST (summary + pagination)
     ============================================================ */
  (function anilist() {
    const list = $('al-list'), tabs = $('al-tabs'); if (!list) return;
    // 36. MANGA TAB — two datasets keyed by media type; manga lazy-loaded on first switch.
    const datasets = { ANIME: [], MANGA: [] };
    const loaded = { ANIME: false, MANGA: false };
    const loading = { ANIME: false, MANGA: false };
    let activeMedia = 'ANIME';
    let allEntries = [], activeStatus = 'ALL', page = 1;
    let activeSort = 'updated', activeGenre = '', activeSearch = '';
    let showMeanScore = false;
    let listView = false;
    let PER_PAGE = 6;
    const favSets = { ANIME: new Set(), MANGA: new Set() };
    const statsByMedia = { ANIME: null, MANGA: null };
    let favSet = favSets.ANIME, statsData = null;
    const card = list.parentElement;
    let statsPanel = null, controlsBar = null, genreBar = null, pagerEl = null, mediaBar = null;
    let bannerTimer = null, bannerIdx = 0;

    // Per-media label maps (anime uses episodes/watching, manga uses chapters/reading).
    const STATUS_TABS = [
      { status: 'ALL',       ANIME: 'ALL',           MANGA: 'ALL' },
      { status: 'CURRENT',   ANIME: 'WATCHING',      MANGA: 'READING' },
      { status: 'COMPLETED', ANIME: 'COMPLETED',     MANGA: 'COMPLETED' },
      { status: 'REPEATING', ANIME: 'REWATCHING',    MANGA: 'REREADING' },
      { status: 'PLANNING',  ANIME: 'PLAN TO WATCH', MANGA: 'PLAN TO READ' },
      { status: 'PAUSED',    ANIME: 'ON HOLD',       MANGA: 'ON HOLD' },
      { status: 'DROPPED',   ANIME: 'DROPPED',       MANGA: 'DROPPED' }
    ];
    const isManga = () => activeMedia === 'MANGA';
    const unitLong = () => isManga() ? 'chapters' : 'episodes';
    const unitShort = () => isManga() ? 'ch' : 'EP';
    const verbPast = () => isManga() ? 'read' : 'watched';

    function entryTitle(e) {
      return (e.media && e.media.title && (e.media.title.romaji || e.media.title.english)) || '';
    }
    // Total units for an entry's media (episodes for anime, chapters for manga).
    function totalUnits(m) { return (m && (isManga() ? m.chapters : m.episodes)) || 0; }
    function scoreClass(mean) {
      if (!mean) return '';
      if (mean >= 75) return 'al-score-high';
      if (mean >= 60) return 'al-score-mid';
      return 'al-score-low';
    }
    function highlightMatch(text, query) {
      if (!query) return text;
      var i = text.toLowerCase().indexOf(query.toLowerCase());
      if (i === -1) return text;
      return text.slice(0, i) + '<mark class="al-hl">' + text.slice(i, i + query.length) + '</mark>' + text.slice(i + query.length);
    }

    // 36. Wire the Anime/Manga switcher and keep status-tab labels in sync.
    function updateTabLabels() {
      if (!tabs) return;
      tabs.querySelectorAll('.al-tab').forEach(btn => {
        const row = STATUS_TABS.find(s => s.status === btn.dataset.status);
        if (!row) return;
        let c = btn.querySelector('.al-tab-count');
        btn.textContent = row[activeMedia] + ' ';
        if (c) btn.appendChild(c);
      });
    }
    function ensureMediaBar() {
      if (mediaBar) return;
      mediaBar = $('al-media');
      if (!mediaBar) return;
      mediaBar.addEventListener('click', (e) => {
        const b = e.target.closest('.al-media-btn'); if (!b) return;
        const m = b.dataset.media; if (m === activeMedia) return;
        mediaBar.querySelectorAll('.al-media-btn').forEach(x => {
          const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        switchMedia(m);
      });
      mediaBar.addEventListener('keydown', function (e) { var bs = Array.from(mediaBar.querySelectorAll('.al-media-btn')); var i = bs.indexOf(document.activeElement); if (i === -1) return; if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); var n = e.key === 'ArrowRight' ? (i+1)%bs.length : (i-1+bs.length)%bs.length; bs[n].focus(); bs[n].click(); } });
    }

    function ensureChrome() {
      ensureMediaBar();
      if (!statsPanel) {
        statsPanel = document.createElement('div');
        statsPanel.className = 'al-stats';
        tabs.parentNode.insertBefore(statsPanel, tabs);
      }
      if (!controlsBar) {
        controlsBar = document.createElement('div');
        controlsBar.className = 'al-controls';
        controlsBar.innerHTML =
          '<div class="al-search-wrap"><span class="material-symbols-outlined al-search-icon">search</span>' +
          '<input type="text" class="al-search-input" id="al-search" maxlength="60" placeholder="Search anime…" autocomplete="off" aria-label="Search titles">' +
          '<button class="al-search-clear" id="al-search-clear" hidden title="Clear" aria-label="Clear search"><span class="material-symbols-outlined">close</span></button></div>' +
          '<div class="al-sort" id="al-sort">' +
            '<button class="al-sort-btn active" data-sort="updated">Updated</button>' +
            '<button class="al-sort-btn" data-sort="score">Score</button>' +
            '<button class="al-sort-btn" data-sort="title">Title</button>' +
            '<button class="al-sort-btn" data-sort="progress">Progress</button>' +
          '</div>' +
          '<button class="al-score-toggle" id="al-score-toggle" title="Toggle score"><span class="material-symbols-outlined">swap_horiz</span>Score</button>' +
          '<div class="al-view-toggle" id="al-view-toggle"><button class="al-view-btn active" data-view="grid" title="Grid"><span class="material-symbols-outlined">grid_view</span></button><button class="al-view-btn" data-view="list" title="List"><span class="material-symbols-outlined">view_list</span></button></div>' +
          '<div class="al-perpage" id="al-perpage"><span class="al-perpage-label">Per page</span><button class="al-perpage-btn active" data-pp="6">6</button><button class="al-perpage-btn" data-pp="12">12</button><button class="al-perpage-btn" data-pp="24">24</button><button class="al-perpage-btn" data-pp="48">48</button></div>';
        list.parentNode.insertBefore(controlsBar, list);
        const si = controlsBar.querySelector('#al-search'), sc = controlsBar.querySelector('#al-search-clear');
        var searchTimer = null;
        Widgets.bindSearch({ input: si, clear: sc, onChange: (v) => { clearTimeout(searchTimer); searchTimer = setTimeout(function () { activeSearch = v; page = 1; render(); }, 250); } });
        Widgets.bindPills({ container: controlsBar.querySelector('#al-sort'), selector: '.al-sort-btn', attr: 'sort', onSelect: (v) => { activeSort = v; page = 1; render(); } });
        var scoreTgl = controlsBar.querySelector('#al-score-toggle'); if (scoreTgl) scoreTgl.addEventListener('click', function () { showMeanScore = !showMeanScore; this.classList.toggle('active', showMeanScore); render(); });
        var viewTgl = controlsBar.querySelector('#al-view-toggle'); if (viewTgl) viewTgl.addEventListener('click', function (ev) { var b = ev.target.closest('.al-view-btn'); if (!b) return; listView = b.dataset.view === 'list'; list.classList.toggle('list-view', listView); viewTgl.querySelectorAll('.al-view-btn').forEach(function(x){x.classList.toggle('active',x===b);}); });
        var ppC = controlsBar.querySelector('#al-perpage'); if (ppC) ppC.addEventListener('click', function (ev) { var b = ev.target.closest('.al-perpage-btn'); if (!b) return; PER_PAGE = parseInt(b.dataset.pp) || 12; page = 1; ppC.querySelectorAll('.al-perpage-btn').forEach(function(x){x.classList.toggle('active',x===b);}); render(); });
      }
      if (!genreBar) {
        genreBar = document.createElement('div');
        genreBar.className = 'al-genres';
        list.parentNode.insertBefore(genreBar, list);
        // Delegated so it keeps working as renderGenres() rebuilds the pills.
        Widgets.bindPills({ container: genreBar, selector: '.al-genre-pill', attr: 'genre', onSelect: (v) => { activeGenre = v || ''; page = 1; renderGenres(); render(); } });
      }
      if (!pagerEl) { pagerEl = document.createElement('div'); pagerEl.className = 'al-pagination'; card.appendChild(pagerEl); }
    }
    /* When AniList API is down, show a clean message and hide the list body */

    function showApiDown(type) {
      var banner = $('al-banner'); if (banner) banner.style.display = 'none';
      if (statsPanel) statsPanel.style.display = 'none';
      if (genreBar) genreBar.style.display = 'none';
      if (controlsBar) controlsBar.style.display = 'none';
      if (pagerEl) pagerEl.style.display = 'none';
      /* Keep tabs and media switcher visible */
      list.innerHTML = '<div class="al-api-down"><span class="material-symbols-outlined" style="font-size:48px;display:block;margin-bottom:16px;opacity:.6">cloud_off</span><div style="font-size:18px;font-weight:600;margin-bottom:8px">AniList API is currently down</div><div style="opacity:.6;font-size:14px;max-width:320px;margin:0 auto">Your ' + (type === 'MANGA' ? 'manga' : 'anime') + ' list will be back once the API is available again.</div><button id="al-retry-btn" style="margin-top:20px;padding:10px 24px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font-size:14px">Retry</button></div>';
      var retryBtn = document.getElementById('al-retry-btn');
      if (retryBtn) retryBtn.addEventListener('click', function() { retryAnilist(type); });
    }

    function retryAnilist(type) {
      /* Unhide everything so loadMedia/refreshAll can populate it */
      if (statsPanel) statsPanel.style.display = '';
      if (genreBar) genreBar.style.display = '';
      if (controlsBar) controlsBar.style.display = '';
      if (pagerEl) pagerEl.style.display = '';
      list.innerHTML = '<div class="al-empty">Retrying ' + (type === 'MANGA' ? 'manga' : 'anime') + '…</div>';
      loading[type] = false;
      loaded[type] = false;
      loadMedia(type);
      loadUserMeta();
    }

    function buildListQuery(type) {
      const progressFields = type === 'MANGA' ? 'chapters volumes' : 'episodes duration';
      return `query{user:MediaListCollection(userName:"${CONFIG.anilistUser}",type:${type}){lists{name status entries{media{id title{romaji english}coverImage{extraLarge large medium}${progressFields} meanScore genres format description(asHtml:false) startDate{year month day} endDate{year month day}}score progress updatedAt startedAt{year month day} completedAt{year month day}}}}}`;
    }
    // Fetch a media list (anime or manga) on demand. Anime falls back to a local list on failure.
    function loadMedia(type) {
      if (loaded[type] || loading[type]) return;
      loading[type] = true;
      fetch('/api/anilist?type=' + type + '&_=' + Date.now())
        .then(r => { if (!r.ok) throw new Error('AniList proxy HTTP ' + r.status); return r.json(); }).then(d => {
          if (d.errors) throw new Error(d.errors[0]?.message || 'AniList GraphQL error');
          if (d.ok === false) throw new Error(d.error || 'AniList proxy error');
          const lists = (d.data && d.data.user && d.data.user.lists) || [];
          const entries = [];
          lists.forEach(l => (l.entries || []).forEach(e => { if (e && e.media) { e._status = l.status; entries.push(e); } }));
          if (!entries.length) throw new Error('AniList list empty');
          datasets[type] = entries; loaded[type] = true; loading[type] = false;
          /* Restore hidden elements if they were hidden by showApiDown */
          if (statsPanel) statsPanel.style.display = '';
          if (genreBar) genreBar.style.display = '';
          if (controlsBar) controlsBar.style.display = '';
          if (pagerEl) pagerEl.style.display = '';
          if (activeMedia === type) { allEntries = datasets[type]; }
          /* Don't render yet — stopRefreshSpinner will render + hide overlay together */
          stopRefreshSpinner(true);
        }).catch((err) => {
          loading[type] = false;
          loaded[type] = false; // allow retry
          console.warn('AniList ' + type + ' load failed:', err);
          stopRefreshSpinner(false);
          showApiDown(type);
        });
    }

    function refreshAll() { renderStats(); renderGenres(); updateTabCounts(); render(); renderBanner(); }

    // Switch between Anime and Manga: reset filters, lazy-load if needed.
    function switchMedia(type) {
      activeMedia = type;
      allEntries = datasets[type];
      favSet = favSets[type];
      statsData = statsByMedia[type];
      activeStatus = 'ALL'; activeGenre = ''; activeSearch = ''; page = 1;
      if (tabs) { tabs.querySelectorAll('.al-tab').forEach(b => b.classList.toggle('active', b.dataset.status === 'ALL')); }
      updateTabLabels();
      const sub = $('al-sub'); if (sub) sub.innerHTML = '<span class=\"material-symbols-outlined\">' + (isManga() ? 'menu_book' : 'movie') + '</span> ' + (isManga() ? 'Manga library & reading list' : 'Anime collection & watchlist');
      const si = $('al-search'); if (si) { si.value = ''; si.placeholder = isManga() ? 'Search manga…' : 'Search anime…'; }
      const sc = $('al-search-clear'); if (sc) sc.hidden = true;
      stopBannerRotation();
      if (!loaded[type]) {
        list.innerHTML = '<div class="al-empty">Loading ' + (isManga() ? 'manga' : 'anime') + '…</div>';
        if (statsPanel) statsPanel.innerHTML = ''; if (genreBar) genreBar.innerHTML = '';
        const banner = $('al-banner'); if (banner) banner.style.display = 'none';
        updateTabCounts();
        loadMedia(type);
      } else {
        refreshAll();
      }
    }

    loadMedia('ANIME');

    // Fetch user avatar, favourites and statistics for both media types (separate request)
    const userQuery = `query{User(name:"${CONFIG.anilistUser}"){avatar{large}favourites{anime{nodes{id}}manga{nodes{id}}}statistics{anime{count episodesWatched minutesWatched meanScore genres{genre count}}manga{count chaptersRead volumesRead meanScore genres{genre count}}}}}`;
    function loadUserMeta() {
      return fetch('/api/anilist?meta=1&_=' + Date.now())
        .then(r => r.json()).then(d => {
          const u = d && d.data && d.data.User; if (!u) return;
          const av = $('al-avatar'); if (av && u.avatar && u.avatar.large) av.src = u.avatar.large;
          const fav = u.favourites || {};
          favSets.ANIME = new Set(((fav.anime && fav.anime.nodes) || []).map(n => n && n.id).filter(Boolean));
          favSets.MANGA = new Set(((fav.manga && fav.manga.nodes) || []).map(n => n && n.id).filter(Boolean));
          statsByMedia.ANIME = (u.statistics && u.statistics.anime) || null;
          statsByMedia.MANGA = (u.statistics && u.statistics.manga) || null;
          favSet = favSets[activeMedia]; statsData = statsByMedia[activeMedia];
          renderStats(); if (loaded[activeMedia]) render();
        }).catch(() => {});
    }
    loadUserMeta();

    // Manual refresh — re-fetch the active media list + user meta without a full page reload.
    let refreshing = false;
    function showRefreshOverlay() {
      /* Add a loading overlay on top of existing content — no layout jump */
      var overlay = document.getElementById('al-refresh-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'al-refresh-overlay';
        overlay.className = 'al-refresh-overlay';
        card.appendChild(overlay);
      }
      overlay.offsetHeight; // force reflow
      overlay.classList.add('visible');
    }
    function hideRefreshOverlay() {
      var overlay = document.getElementById('al-refresh-overlay');
      if (overlay) {
        overlay.classList.remove('visible');
        setTimeout(function() { overlay.remove(); }, 300);
      }
    }
    function refresh() {
      if (refreshing) return;
      refreshing = true;
      const btn = $('al-refresh');
      if (btn) btn.classList.add('ama-refresh-spin');
      refreshStart = Date.now();
      showRefreshOverlay();
      const type = activeMedia;
      loaded[type] = false; loading[type] = false;
      loadMedia(type);
      loadUserMeta();
    }
    /* Stop refresh spinner — ensures at least 1 full rotation before stopping.
       On success: renders new data AND fades overlay simultaneously so no visible shift. */
    var refreshStart = 0;
    function stopRefreshSpinner(success) {
      var elapsed = Date.now() - refreshStart;
      var delay = Math.max(0, 600 - elapsed); // ensure at least 600ms of spin
      setTimeout(function() {
        refreshing = false;
        const btn = $('al-refresh');
        if (btn) btn.classList.remove('ama-refresh-spin');
        if (success) refreshAll(); // render new data exactly when overlay fades
        hideRefreshOverlay();
      }, delay);
    }
    const alRefreshBtn = $('al-refresh');
    if (alRefreshBtn) alRefreshBtn.addEventListener('click', refresh);
    function renderStats() {
      ensureChrome();
      let count, mean, genres, numbers;
      if (isManga()) {
        let chapters, volumes;
        if (statsData && (statsData.count || statsData.chaptersRead)) {
          count = statsData.count || 0; chapters = statsData.chaptersRead || 0;
          volumes = statsData.volumesRead || 0; mean = statsData.meanScore || 0;
          genres = (statsData.genres || []).slice();
        } else {
          count = allEntries.length;
          chapters = allEntries.reduce((s, e) => s + (Number(e.progress) || 0), 0);
          volumes = 0; mean = 0;
          const gc = {}; allEntries.forEach(e => ((e.media && e.media.genres) || []).forEach(g => gc[g] = (gc[g] || 0) + 1));
          genres = Object.keys(gc).map(g => ({ genre: g, count: gc[g] }));
        }
        if (!count && !allEntries.length) { statsPanel.innerHTML = ''; return; }
        numbers = '<div class="al-stat-cards">' +
          '<div class="al-stat-card"><span class="al-sc-val">' + count.toLocaleString() + '</span><span class="al-sc-label">Manga</span></div>' +
          '<div class="al-stat-card"><span class="al-sc-val">' + chapters.toLocaleString() + '</span><span class="al-sc-label">Chapters</span></div>' +
          (volumes ? '<div class="al-stat-card"><span class="al-sc-val">' + volumes.toLocaleString() + '</span><span class="al-sc-label">Volumes</span></div>' : '') +
          (mean ? '<div class="al-stat-card"><span class="al-sc-val">' + (mean / 10).toFixed(1) + '</span><span class="al-sc-label">Mean &#9733;</span></div>' : '') +
        '</div>';
      } else {
        let eps, mins;
        if (statsData && (statsData.count || statsData.episodesWatched)) {
          count = statsData.count || 0; eps = statsData.episodesWatched || 0;
          mins = statsData.minutesWatched || 0; mean = statsData.meanScore || 0;
          genres = (statsData.genres || []).slice();
        } else {
          count = allEntries.length;
          eps = allEntries.reduce((s, e) => s + (Number(e.progress) || 0), 0);
          mins = allEntries.reduce((s, e) => s + (Number(e.progress) || 0) * ((e.media && e.media.duration) || 24), 0);
          mean = 0;
          const gc = {}; allEntries.forEach(e => ((e.media && e.media.genres) || []).forEach(g => gc[g] = (gc[g] || 0) + 1));
          genres = Object.keys(gc).map(g => ({ genre: g, count: gc[g] }));
        }
        if (!count && !allEntries.length) { statsPanel.innerHTML = ''; return; }
        const days = (mins / 1440).toFixed(1);
        numbers = '<div class="al-stat-cards">' +
          '<div class="al-stat-card"><span class="al-sc-val">' + count.toLocaleString() + '</span><span class="al-sc-label">Anime</span></div>' +
          '<div class="al-stat-card"><span class="al-sc-val">' + eps.toLocaleString() + '</span><span class="al-sc-label">Episodes</span></div>' +
          '<div class="al-stat-card"><span class="al-sc-val">' + days + '</span><span class="al-sc-label">Days watched</span></div>' +
          (mean ? '<div class="al-stat-card"><span class="al-sc-val">' + (mean / 10).toFixed(1) + '</span><span class="al-sc-label">Mean &#9733;</span></div>' : '') +
        '</div>';
      }
      const topG = genres.slice().sort((a, b) => b.count - a.count).slice(0, 8);
      const totalAnime = count;
      const bars = topG.length ? '<div class="al-genre-tags">' + topG.map(g =>
        '<div class="al-genre-tag" style="--fill:' + Math.max(8, Math.round(g.count / totalAnime * 100)) + '%"><span class="al-gt-name">' + esc(g.genre) + '</span><span class="al-gt-count">' + g.count + '</span></div>').join('') + '</div>' : '';
      statsPanel.innerHTML = numbers + bars;
    }
    function renderGenres() {
      ensureChrome();
      const counts = {};
      allEntries.forEach(e => ((e.media && e.media.genres) || []).forEach(g => counts[g] = (counts[g] || 0) + 1));
      const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 12);
      if (!top.length) { genreBar.innerHTML = ''; return; }
      // Click handling is delegated once in ensureChrome() via Widgets.bindPills.
      genreBar.innerHTML =
        '<button class="al-genre-pill ' + (activeGenre === '' ? 'active' : '') + '" data-genre="">All</button>' +
        top.map(g => '<button class="al-genre-pill ' + (activeGenre === g ? 'active' : '') + '" data-genre="' + esc(g) + '">' + esc(g) + '</button>').join('');
    }
    function updateTabCounts() {
      if (!tabs) return;
      tabs.querySelectorAll('.al-tab').forEach(btn => {
        const st = btn.dataset.status;
        const n = st === 'ALL' ? allEntries.length : allEntries.filter(e => String(e._status || '').toUpperCase() === st).length;
        let c = btn.querySelector('.al-tab-count');
        if (!c) { c = document.createElement('span'); c.className = 'al-tab-count'; btn.appendChild(c); }
        c.textContent = n;
      });
    }
    function stopBannerRotation() { if (bannerTimer) { clearInterval(bannerTimer); bannerTimer = null; } }
    function bannerHTML(item) {
      const t = (item.media.title && (item.media.title.romaji || item.media.title.english)) || '\u2014';
      const img = (item.media.coverImage && (item.media.coverImage.extraLarge || item.media.coverImage.large || item.media.coverImage.medium)) || '';
      const statusRaw = (item._status || '').toUpperCase();
      const manga = isManga();
      const STATUS_LABELS = manga ? {
        CURRENT: 'CURRENTLY READING', WATCHING: 'CURRENTLY READING',
        COMPLETED: 'COMPLETED', REPEATING: 'REREADING', REWATCHING: 'REREADING',
        PLANNING: 'PLAN TO READ', PAUSED: 'ON HOLD', DROPPED: 'DROPPED'
      } : {
        CURRENT: 'CURRENTLY WATCHING', WATCHING: 'CURRENTLY WATCHING',
        COMPLETED: 'COMPLETED', REPEATING: 'REWATCHING', REWATCHING: 'REWATCHING',
        PLANNING: 'PLAN TO WATCH', PAUSED: 'ON HOLD', DROPPED: 'DROPPED'
      };
      const label = STATUS_LABELS[statusRaw] || 'LATEST UPDATE';
      const isOngoing = statusRaw === 'CURRENT' || statusRaw === 'WATCHING' || statusRaw === 'REPEATING' || statusRaw === 'REWATCHING';
      const total = totalUnits(item.media);
      const progress = item.progress ? item.progress + (total ? '/' + total : '') + ' ' + unitShort() + (isOngoing ? ' ' + verbPast() : '') : (statusRaw === 'COMPLETED' ? 'completed' : '');
      const score = item.score ? ' · ★ ' + item.score : '';
      var prog = item.progress || 0;
      var bPct = (total && prog) ? Math.min(100, Math.round(prog / total * 100)) : (statusRaw === 'COMPLETED' ? 100 : 0);
      var bBar = (bPct > 0 && bPct < 100) ? '<div class="al-banner-progress-bar"><div class="al-banner-progress-fill" style="width:' + bPct + '%"></div></div>' : '';
      return (img ? '<img class="al-banner-img" alt="' + esc(t) + '" src="' + img + '">' : '') + '<div class="al-banner-info"><div class="al-banner-label" data-status="' + statusRaw.toLowerCase() + '">' + label + '</div><div class="al-banner-title">' + esc(t) + '</div><div class="al-banner-progress">' + esc(progress + score) + '</div>' + bBar + '</div>';
    }
    function bannerDots(rotation, activeI) {
      if (rotation.length <= 1) return '';
      return '<div class="al-banner-dots">' + rotation.map((_, di) => '<span class="' + (di === activeI ? 'on' : '') + '"></span>').join('') + '</div>';
    }
    // 39. Banner rotation — cycle through everything currently being watched/read;
    // fall back to the single most-recently-updated entry if nothing is ongoing.
    function renderBanner() {
      const banner = $('al-banner'); if (!banner) return;
      stopBannerRotation();
      const entries = allEntries;
      if (!entries.length) { banner.style.display = 'none'; return; }
      const ongoing = entries
        .filter(e => { const s = (e._status || '').toUpperCase(); return (s === 'CURRENT' || s === 'REPEATING') && e.media; })
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      let rotation = ongoing;
      if (!rotation.length) {
        const latest = entries.slice().filter(e => e.media).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
        rotation = latest ? [latest] : [];
      }
      if (!rotation.length) { banner.style.display = 'none'; return; }
      bannerIdx = 0;
      const paint = (i) => {
        const item = rotation[i % rotation.length];
        if (!item || !item.media) return;
        banner.innerHTML = bannerHTML(item) + bannerDots(rotation, i % rotation.length);
      };
      paint(0);
      banner.style.display = 'flex';
      if (rotation.length > 1) {
        bannerTimer = setInterval(() => {
          bannerIdx = (bannerIdx + 1) % rotation.length;
          banner.classList.add('al-banner-fading');
          setTimeout(() => { paint(bannerIdx); banner.classList.remove('al-banner-fading'); }, 200);
        }, 5000);
      }
    }
    function sortEntries(arr) {
      const a = arr.slice();
      if (activeSort === 'score') a.sort((x, y) => (y.score || 0) - (x.score || 0) || ((y.media && y.media.meanScore) || 0) - ((x.media && x.media.meanScore) || 0));
      else if (activeSort === 'title') a.sort((x, y) => entryTitle(x).localeCompare(entryTitle(y)));
      else if (activeSort === 'progress') a.sort((x, y) => (y.progress || 0) - (x.progress || 0));
      else a.sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
      return a;
    }
    let isFirstRender = true;
    function render() {
      ensureChrome();
      list.classList.toggle('list-view', listView);
      let arr = allEntries.slice();
      if (activeStatus !== 'ALL') arr = arr.filter(e => String(e._status || '').toUpperCase() === activeStatus);
      if (activeGenre) arr = arr.filter(e => ((e.media && e.media.genres) || []).indexOf(activeGenre) >= 0);
      if (activeSearch) {
        const s = activeSearch.toLowerCase();
        arr = arr.filter(e => {
          const ti = e.media && e.media.title;
          return (ti && ti.romaji && ti.romaji.toLowerCase().includes(s)) ||
                 (ti && ti.english && ti.english.toLowerCase().includes(s));
        });
      }
      arr = sortEntries(arr);
      const pages = Math.max(1, Math.ceil(arr.length / PER_PAGE));
      if (page > pages) page = pages;
      const slice = arr.slice((page - 1) * PER_PAGE, page * PER_PAGE);
      if (!slice.length) {
        list.innerHTML = '<div class="al-empty"><span class="al-empty-icon material-symbols-outlined">' + (activeSearch ? 'search' : activeStatus === 'DROPPED' ? 'sentiment_satisfied' : 'movie') + '</span><div class="al-empty-text">' + (activeSearch ? 'No results found' : activeStatus === 'DROPPED' ? 'Nothing dropped yet!' : 'Nothing here yet') + '</div></div>';
        renderPager(pages);
        return;
      }
      list.innerHTML = slice.map((e, idx) => {
        try {
        const m = e.media || {};
        const t = (m.title && (m.title.romaji || m.title.english)) || '—';
        const img = (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large || m.coverImage.medium)) || '';
        const st = String(e._status || '').toUpperCase();
        const eps = totalUnits(m);
        const prog = e.progress || 0;
        const progText = prog ? '<b>' + prog + (eps ? '/' + eps : '') + '</b> ' + unitShort() : (st === 'COMPLETED' ? '<b>done</b>' : '');
        const userScore = e.score ? '★ ' + e.score : '';
        const mean = m.meanScore || 0;
        const meanText = mean ? 'avg ' + (mean / 10).toFixed(1) : '';
        var displayScore = showMeanScore ? (mean ? 'avg ★ ' + (mean / 10).toFixed(1) : '') : userScore;
        const scoreLine = [progText, displayScore].filter(Boolean).join(' · ');
        const pct = eps ? Math.min(100, Math.round(prog / eps * 100)) : (st === 'COMPLETED' ? 100 : 0);
        const showBar = (eps && prog) || st === 'COMPLETED';
        const isFav = favSet.has(m.id);
        const genres = (m.genres || []).slice(0, 3);
        const desc = m.description ? esc(String(m.description).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 180) : '';
        const fmt = m.format ? String(m.format).replace(/_/g, ' ') : '';
        const sd = m.startDate, ed = m.endDate;
        const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        function fmtD(d) { try { if (!d || !d.year) return ''; if (d.month && d.day) return MONTHS[(d.month-1)] + ' ' + d.day + ', ' + d.year; if (d.month) return MONTHS[(d.month-1)] + ' ' + d.year; return '' + d.year; } catch(err) { return ''; } }
        const airStr = (function() { try { const s = fmtD(sd), ee = fmtD(ed); if (s && ee && s !== ee) return s + ' \u2192 ' + ee; return s || ''; } catch(err) { return ''; } })();
        const wdS = fmtD(e.startedAt), wdE = fmtD(e.completedAt);
        const hasCustomDates = e.startedAt && e.startedAt.year;
        const watchStr = hasCustomDates ? (function() { try { if (wdS && wdE && wdS !== wdE) return wdS + ' \u2192 ' + wdE; return wdS || ''; } catch(err) { return ''; } })() : '';
        var dateInfo = '';
        if (airStr) dateInfo += '<div class="al-item-date"><span class="material-symbols-outlined">tv</span><span>' + esc(airStr) + '</span></div>';
        if (watchStr) dateInfo += '<div class="al-item-date"><span class="material-symbols-outlined">schedule</span><span>' + esc(watchStr) + '</span></div>';
        const overlay = (genres.length || desc || fmt) ?
          '<div class="al-item-overlay">' +
            (fmt ? '<div class="al-ov-fmt">' + esc(fmt) + '</div>' : '') +
            (genres.length ? '<div class="al-ov-genres">' + genres.map(g => '<span>' + esc(g) + '</span>').join('') + '</div>' : '') +
            (desc ? '<div class="al-ov-desc">' + desc + '…</div>' : '') +
          '</div>' : '';
        var scoreBadge = '';
        if (mean) { var sc = mean >= 75 ? 'high' : mean >= 60 ? 'mid' : 'low'; var sv = showMeanScore ? (mean / 10).toFixed(1) : (e.score || (mean / 10).toFixed(1)); scoreBadge = '<span class="al-cover-score ' + sc + '">★ ' + sv + '</span>'; }
        var fmtChip = fmt ? '<span class="al-cover-fmt">' + esc(fmt) + '</span>' : '';
        var stAttr = ' data-status="' + st + '"';
        var nameHtml = activeSearch ? highlightMatch(esc(t), activeSearch) : esc(t);
        var delay = Math.min(idx * 0.03, 0.36); // cap stagger at ~360ms total
        var anim = isFirstRender ? ' style=\"animation-delay:' + delay + 's\"' : ' style=\"animation:none\"';
        return '<div class="al-item"' + stAttr + anim + '>' +
          '<div class="al-item-cover">' +
            (img ? '<img src="' + img + '" alt="' + esc(t) + '" loading="lazy" decoding="async">' : '') +
            scoreBadge + fmtChip +
            (isFav ? '<span class="al-fav" title="Favourite">♥</span>' : '') +
            overlay +
          '</div>' +
          '<div class="al-item-info">' +
            '<div class="al-item-name">' + nameHtml + '</div>' +
            '<div class="al-item-score ' + scoreClass(mean) + '">' + scoreLine + '</div>' +
            dateInfo +
            (showBar ? '<div class="al-item-bar"><i style="width:' + pct + '%"></i></div>' : '') +
          '</div>' +
        '</div>';
        } catch(err) { console.warn('AniList item render error:', err); return ''; }
      }).filter(Boolean).join('');
      renderPager(pages);
      isFirstRender = false;
    }
    function renderPager(pages) {
      if (!pagerEl) return;
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
    if (tabs) tabs.addEventListener('keydown', function (e) { var bs = Array.from(tabs.querySelectorAll('.al-tab')); var i = bs.indexOf(document.activeElement); if (i === -1) return; if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); var n = e.key === 'ArrowRight' ? (i+1)%bs.length : (i-1+bs.length)%bs.length; bs[n].focus(); bs[n].click(); } });
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
    let i = 0; const swap = $('quote-swap'), quoteBody = document.querySelector('.quote-body');
    if (swap) swap.addEventListener('click', () => {
      i = (i + 1) % QUOTES.length;
      // Remove spin, wait a frame, then re-add to guarantee animation restarts
      swap.classList.remove('qs-spin');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          swap.classList.add('qs-spin');
        });
      });
      if (quoteBody) {
        quoteBody.classList.add('qs-out');
        setTimeout(() => {
          $('quote-text').textContent = QUOTES[i][0];
          $('quote-author').textContent = '— ' + QUOTES[i][1];
          quoteBody.classList.remove('qs-out');
          quoteBody.classList.add('qs-in');
          setTimeout(() => quoteBody.classList.remove('qs-in'), 350);
        }, 220);
      }
    });
  })();

  /* ============================================================
     11. PRESENCE LINKS (Material Symbols icons; YatiniGPT removed)
     ============================================================ */
  (function presence() {
    const grid = $('presence-grid'); if (!grid) return;
    const LINKS = [
      { icon: 'code', name: 'GitHub', url: 'https://github.com/YatinSharma1303' },
      { icon: 'mail', name: 'Email', url: 'mailto:' + EMAIL },
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
    const opt = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
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
     13. SCROLL: parallax + progress bar + back-to-top
     ============================================================ */
  (function scrollFX() {
    const orb = document.querySelector('.hero-gradient-orb');
    const hero = $('hero');
    const prog = $('scroll-progress');
    const btt = $('back-to-top');
    let ticking = false;
    function update() {
      const y = window.scrollY;
      const docH = document.documentElement.scrollHeight - window.innerHeight;
      if (orb) orb.style.transform = `translate(0, ${y * 0.15}px)`;
      if (hero) hero.style.transform = `translateY(${y * 0.25}px)`;
      if (prog) prog.style.width = (docH > 0 ? (y / docH * 100) : 0) + '%';
      if (btt) btt.classList.toggle('visible', y > 600);
      ticking = false;
    }
    window.addEventListener('scroll', () => { if (!ticking) { requestAnimationFrame(update); ticking = true; } }, { passive: true });
    if (btt) btt.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  })();

  /* ============================================================
     14. ANIMATED COUNTERS
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
     15. (Removed Changelogs)
     ============================================================ */

  /* ============================================================
     16. HERO TERMINAL (typing effect)
     ============================================================ */
  (function terminal() {
    const el = $('term-line'); if (!el) return;
    const LINES = [
      { cmd: 'whoami', out: 'yatin - full-stack developer' },
      { cmd: 'cat stack.txt', out: 'react . python . firebase . ai/ml' },
      { cmd: 'status --current', out: 'building cool stuff' }
    ];
    let li = 0, phase = 'cmd', ci = 0;
    let isVisible = false;
    let typingTimer = null;

    function typeClick() {}
    
    function tick() {
      // If the terminal is scrolled out of view, stop looping and wait until it's visible again
      if (!isVisible) { typingTimer = null; return; }
      
      const item = LINES[li];
      if (phase === 'cmd') {
        ci++;
        typeClick();
        el.innerHTML = '<span class="term-cmd">$ ' + esc(item.cmd.slice(0, ci)) + '</span>';
        if (ci >= item.cmd.length) { phase = 'pause1'; typingTimer = setTimeout(tick, 400); return; }
        typingTimer = setTimeout(tick, 70);
      } else if (phase === 'pause1') {
        phase = 'out'; ci = 0; typingTimer = setTimeout(tick, 200);
      } else if (phase === 'out') {
        ci++;
        typeClick();
        el.innerHTML = '<span class="term-cmd">$ ' + item.cmd + '</span><br>' + esc('> ' + item.out.slice(0, ci));
        if (ci >= item.out.length) { phase = 'pause2'; typingTimer = setTimeout(tick, 1800); return; }
        typingTimer = setTimeout(tick, 35);
      } else {
        li = (li + 1) % LINES.length; phase = 'cmd'; ci = 0; typingTimer = setTimeout(tick, 300);
      }
    }

    // Start/Stop typing based on scroll visibility
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const wasVisible = isVisible;
        isVisible = entry.isIntersecting;
        
        // If it just became visible and the loop isn't running, start it
        if (isVisible && !wasVisible && !typingTimer) {
          typingTimer = setTimeout(tick, 0);
        } 
        // If it just scrolled out of view, clear the timer to pause sound/typing
        else if (!isVisible && wasVisible && typingTimer) {
          clearTimeout(typingTimer);
          typingTimer = null;
        }
      });
    }, { threshold: 0.2 }); // Trigger when 20% visible

    // Observe the parent terminal container
    const termBox = el.closest('.hero-terminal');
    if (termBox) obs.observe(termBox);
  })();

  /* ============================================================
     16b. HERO PARTICLES (neural-network style)
     ============================================================ */
  (function particles() {
    const canvas = $('hero-particles'); if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let dots = [], w, h, heroVisible = true;
    // Pause animation when hero is not visible
    const heroObs = new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; }, { threshold: 0 });
    const heroEl = canvas.closest('.hero') || canvas.parentElement;
    if (heroEl) heroObs.observe(heroEl);
    function init() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      const count = Math.min(80, Math.floor(w * h / 18000));
      dots = [];
      for (let i = 0; i < count; i++) dots.push({ x: Math.random()*w, y: Math.random()*h, vx: (Math.random()-0.5)*0.3, vy: (Math.random()-0.5)*0.3 });
    }
    // Resize WITHOUT recreating dots — keeps them smooth across viewport changes.
    function resize() {
      const newW = window.innerWidth, newH = window.innerHeight;
      w = canvas.width = newW;
      h = canvas.height = newH;
      // keep existing dots, just nudge any that are now off-screen back into bounds
      dots.forEach(d => {
        if (d.x > newW) d.x = Math.random() * newW;
        if (d.y > newH) d.y = Math.random() * newH;
      });
    }
    // Debounce resize so mobile URL-bar toggling doesn't thrash.
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 200);
    });
    // Particle colour follows the palette accent (--accent-solid), parsed + cached.
    let pAccent = { hex: '', rgb: '0,200,255' };
    function accentRGB() {
      const hex = (getComputedStyle(document.documentElement).getPropertyValue('--accent-solid') || '').trim();
      if (hex && hex !== pAccent.hex) {
        const m = hex.replace('#', '');
        if (m.length === 6) pAccent = { hex: hex, rgb: parseInt(m.slice(0,2),16) + ',' + parseInt(m.slice(2,4),16) + ',' + parseInt(m.slice(4,6),16) };
        else if (m.length === 3) pAccent = { hex: hex, rgb: parseInt(m[0]+m[0],16) + ',' + parseInt(m[1]+m[1],16) + ',' + parseInt(m[2]+m[2],16) };
      }
      return pAccent.rgb;
    }
    function draw() {
      if (!heroVisible) { requestAnimationFrame(draw); return; }
      ctx.clearRect(0, 0, w, h);
      dots.forEach(d => { d.x += d.vx; d.y += d.vy; if (d.x<0||d.x>w) d.vx*=-1; if (d.y<0||d.y>h) d.vy*=-1; });
      // Light mode keeps a higher opacity so the accent particles stay visible on the light bg.
      const isLight = document.documentElement.classList.contains('light');
      const rgb = accentRGB();
      const lineOpacity = isLight ? 0.3 : 0.15;
      const dotColor = 'rgba(' + rgb + ',' + (isLight ? 0.75 : 0.6) + ')';
      for (let i = 0; i < dots.length; i++) {
        for (let j = i+1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x, dy = dots[i].y - dots[j].y;
          const distSq = dx*dx + dy*dy;
          if (distSq < 14400) { const dist = Math.sqrt(distSq); ctx.strokeStyle = 'rgba(' + rgb + ',' + (lineOpacity * (1 - dist/120)) + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(dots[i].x, dots[i].y); ctx.lineTo(dots[j].x, dots[j].y); ctx.stroke(); }
        }
      }
      ctx.fillStyle = dotColor;
      dots.forEach(d => { ctx.beginPath(); ctx.arc(d.x, d.y, 1.5, 0, 7); ctx.fill(); });
      requestAnimationFrame(draw);
    }
    init(); draw();
  })();

  /* ============================================================
     16c. TECH ORBIT (populate ring with icons)
     ============================================================ */
  (function orbit() {
    const ring = $('orbit-ring'); if (!ring) return;
    const TECH = ['R','Py','FB','AI','JS','TS','Git','ML'];
    const radius = 115;
    TECH.forEach((label, i) => {
      const angle = (i / TECH.length) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const item = document.createElement('div');
      item.className = 'orbit-item';
      item.textContent = label;
      // Position using top/left so it doesn't conflict with the CSS transform animation
      item.style.left = `calc(50% + ${x}px)`;
      item.style.top = `calc(50% + ${y}px)`;
      ring.appendChild(item);
    });
  })();

  /* ============================================================
     16d. 3D CARD TILT (project + interest cards)
     ============================================================ */
  (function tilt() {
    if (window.matchMedia('(hover: none)').matches) return;
    document.querySelectorAll('.project-card, .interest-card').forEach(card => {
      card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        const cx = e.clientX - r.left, cy = e.clientY - r.top;
        const rx = ((cy / r.height) - 0.5) * -10;
        const ry = ((cx / r.width) - 0.5) * 10;
        card.style.transform = 'perspective(800px) rotateX(' + rx + 'deg) rotateY(' + ry + 'deg)';
      });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    });
  })();
  /* ============================================================
     17. ACTIVE NAV HIGHLIGHT (sync with scroll position)
     ============================================================ */
  (function activeNav() {
    const navLinks = document.querySelectorAll('.topbar-nav-icons .tb-icon-btn');
    if (!navLinks.length) return;
    const sections = [];
    navLinks.forEach(a => { const id = a.getAttribute('href').slice(1); const sec = document.getElementById(id); if (sec) sections.push({ sec, a }); });
    if (!sections.length) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          navLinks.forEach(a => a.classList.remove('active'));
          const match = sections.find(s => s.sec === e.target);
          if (match) match.a.classList.add('active');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(s => obs.observe(s.sec));
  })();

  /* ============================================================
     18. EMAIL — inject into DOM (not in HTML to dodge Cloudflare obfuscation)
     ============================================================ */
  (function setupEmail() {
    // Populate bio card email text
    const emailDisplay = $('email-display');
    if (emailDisplay) emailDisplay.textContent = EMAIL;

    // Wire footer mailto link
    const footerLink = $('footer-email-link');
    if (footerLink) footerLink.href = 'mailto:' + EMAIL;

    // Copy button
    function wireCopyButton(btn) {
      if (!btn) return;
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(EMAIL);
          btn.classList.add('copied');
          const orig = btn.textContent;
          btn.textContent = 'check';
          setTimeout(() => { btn.classList.remove('copied'); btn.textContent = orig; }, 1800);
        } catch (e) {
          // Fallback
          const t = document.createElement('textarea'); t.value = EMAIL;
          document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (er) {} document.body.removeChild(t);
          btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 1800);
        }
      });
    }
    wireCopyButton($('copy-email'));
  })();


  /* ============================================================
     19. AMA — Firestore + Telegram + voting + sort + pagination
     ============================================================ */
  (function ama() {
    const input = $('ama-input'), send = $('ama-send'), status = $('ama-status'),
          countEl = $('ama-count'), listWrap = $('ama-list-wrap'),
          list = $('ama-list'), sortWrap = $('ama-sort'), pager = $('ama-pager'), featured = $('ama-featured'),
          searchInput = $('ama-search'), searchClear = $('ama-search-clear');
    if (!input) return;
    if (send) send.disabled = true;

    const LIMIT_KEY = 'yatin_ama_submits';
    const today = new Date().toDateString();
    let todayCount = 0;
    try { const stored = JSON.parse(localStorage.getItem(LIMIT_KEY) || '{}'); todayCount = stored.date === today ? stored.count : 0; } catch (e) {}
    countEl.textContent = todayCount;

    const nameInput = $('ama-name-input');
    let nameTouched = false;
    try { localStorage.removeItem('yatin_ama_name'); } catch (e) {}
    if (nameInput) {
      nameInput.value = '';
      nameInput.setAttribute('autocomplete', 'off');
      nameInput.addEventListener('input', () => { nameTouched = true; });
    }

    const counterFill = $('ama-counter-fill');

    // Character counter & send button state — set up immediately
    const MAX_CHARS = 280;
    function updateCharCount() {
      const len = input.value.length;
      const charSpan = document.querySelector('#ama .ama-char-count');
      if (charSpan) {
        charSpan.classList.remove('warn', 'limit');
        if (len > 250) charSpan.classList.add(len >= MAX_CHARS ? 'limit' : 'warn');
      }
      const numSpan = document.getElementById('ama-char-count');
      if (numSpan) numSpan.textContent = len;
      if (send) send.disabled = len === 0;
      // Update counter bar
      if (counterFill) {
        const pct = Math.min(100, (todayCount / 20) * 100);
        counterFill.style.width = pct + '%';
        counterFill.classList.toggle('warn', pct >= 75);
      }
    }
    input.addEventListener('input', updateCharCount);
    input.addEventListener('keydown', updateCharCount);
    updateCharCount();

    const fb = CONFIG.firebase;
    const FIREBASE_READY = fb && fb.apiKey && fb.projectId &&
      fb.apiKey !== 'YOUR_FIREBASE_WEB_API_KEY' && fb.projectId !== 'YOUR_FIREBASE_PROJECT_ID';
    const COL = CONFIG.amaCollection;
    const base = () => `https://firestore.googleapis.com/v1/projects/${fb.projectId}/databases/(default)/documents`;
    const queryUrl = () => `${base()}:runQuery?key=${encodeURIComponent(fb.apiKey)}`;
    const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ('q_' + Date.now() + '_' + Math.random().toString(16).slice(2)));
    const PER_PAGE = 4;

    let votedSet = new Set();
    try { votedSet = new Set(JSON.parse(localStorage.getItem('yatin_ama_votes') || '[]')); } catch (e) {}
    let reactedSet = new Set();
    try { reactedSet = new Set(JSON.parse(localStorage.getItem('yatin_ama_reactions') || '[]')); } catch (e) {}

    let answeredDocs = [], activeSort = 'top', page = 1, activeSearch = '';

    function matchesSearch(q) {
      if (!activeSearch) return true;
      const s = activeSearch.toLowerCase();
      return (q.question || '').toLowerCase().includes(s)
        || (q.answer || '').toLowerCase().includes(s)
        || (q.topic || '').toLowerCase().includes(s)
        || (q.name || '').toLowerCase().includes(s);
    }

    function formatAmaTime(iso) {
      if (!iso) return '';
      try {
        return new Date(iso).toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
          hour: '2-digit', minute: '2-digit', hour12: true
        });
      } catch (e) { return ''; }
    }
    function titleTopicClient(value) {
      const keep = { ai:'AI', ml:'ML', rag:'RAG', llm:'LLM', api:'API', css:'CSS', html:'HTML', js:'JS', ui:'UI', ux:'UX' };
      return String(value || '').trim().split(/\s+/).filter(Boolean).map(w => {
        const l = w.toLowerCase();
        if (keep[l]) return keep[l];
        if (l === 'react') return 'React';
        if (l === 'firebase') return 'Firebase';
        if (l === 'firestore') return 'Firestore';
        if (l === 'github') return 'GitHub';
        return l.charAt(0).toUpperCase() + l.slice(1);
      }).join(' ').slice(0, 40) || 'General';
    }
    function autoTopicForQuestionClient(question, answer) {
      const text = ((question || '') + ' ' + (answer || '')).toLowerCase();
      const phrases = [
        ['smarthealthcare', 'SmartHealthCare'], ['smart healthcare', 'SmartHealthCare'],
        ['disease prediction', 'Disease Prediction'], ['drug recommendation', 'Drug Recommendation'], ['heart risk', 'Heart Risk'],
        ['machine learning', 'Machine Learning'], ['deep learning', 'Deep Learning'], ['data science', 'Data Science'], ['random forest', 'Random Forest'],
        ['rag chatbot', 'RAG Chatbot'], ['telegram bot', 'Telegram Bot'], ['firebase firestore', 'Firestore'], ['firestore rules', 'Firestore Rules'],
        ['react hooks', 'React Hooks'], ['portfolio website', 'Portfolio'], ['full stack', 'Full Stack'], ['resume tips', 'Resume'],
        ['career roadmap', 'Career Roadmap'], ['anime list', 'Anime List'], ['last fm', 'Last.fm'], ['last.fm', 'Last.fm']
      ];
      for (const [phrase, topic] of phrases) if (text.includes(phrase)) return topic;
      const important = ['smarthealthcare','yatini','react','firebase','firestore','telegram','wakatime','lastfm','anilist','github','portfolio','resume','internship','roadmap','career','anime','naruto','gaara','bleach','pokemon','healthcare','prediction','medicine','disease','model','rag','llm','api','database','frontend','backend','python','javascript','typescript','tailwind','vercel','streamlit','faiss','groq'];
      for (const w of important) if (new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i').test(text)) return titleTopicClient(w);
      const stop = new Set(['what','why','how','can','you','your','the','and','for','with','about','please','tell','this','that','from','have','want','need','question','answer','anything','best','good','like','using','make','made','build','built','start','learn','explain']);
      const counts = {};
      text.replace(/[^a-z0-9+#.\s-]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !stop.has(w)).forEach(w => counts[w] = (counts[w] || 0) + 1);
      const best = Object.keys(counts).sort((a,b) => (counts[b] * 10 + b.length) - (counts[a] * 10 + a.length))[0];
      return best ? titleTopicClient(best) : 'General';
    }

    function fromDoc(doc) {
      const f = doc.fields || {};
      const reactions = {};
      if (f.reactions && f.reactions.mapValue && f.reactions.mapValue.fields) {
        Object.keys(f.reactions.mapValue.fields).forEach(emoji => {
          reactions[emoji] = Number(f.reactions.mapValue.fields[emoji].integerValue || f.reactions.mapValue.fields[emoji].doubleValue || 0);
        });
      }
      return {
        id: f.id?.stringValue || (doc.name ? doc.name.split('/').pop() : ''),
        name: f.name?.stringValue || 'Anonymous',
        question: f.question?.stringValue || '',
        answer: f.answer?.stringValue || '',
        createdAt: f.createdAt?.stringValue || '',
        answeredAt: f.answeredAt?.stringValue || '',
        editedAt: f.editedAt?.stringValue || '',
        votes: Number(f.votes?.integerValue || f.votes?.doubleValue || 0),
        reactions: reactions,
        pinned: !!f.pinned?.booleanValue,
        spotlight: !!f.spotlight?.booleanValue,
        spotlightAt: f.spotlightAt?.stringValue || '',
        topic: f.topic?.stringValue || autoTopicForQuestionClient(f.question?.stringValue || '', f.answer?.stringValue || ''),
        topicManual: !!f.topicManual?.booleanValue,
        topicAt: f.topicAt?.stringValue || '',
        dismissed: !!(f.dismissed && f.dismissed.booleanValue)
      };
    }
    function sorted() {
      const arr = answeredDocs.slice();
      // Pinned questions always float to the top
      if (activeSort === 'top') arr.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (b.votes - a.votes) || (new Date(b.answeredAt||0) - new Date(a.answeredAt||0));
      });
      else if (activeSort === 'recent') arr.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.answeredAt||0) - new Date(a.answeredAt||0);
      });
      else arr.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(a.answeredAt||0) - new Date(b.answeredAt||0);
      });
      return arr;
    }
    function amaQuestionCard(q, opts = {}) {
      const up = votedSet.has(q.id);
      const REACTION_EMOJIS = ['👍', '🔥', '👏', '🤩'];
      const reactionHTML = REACTION_EMOJIS.map(emoji => {
        const count = (q.reactions && q.reactions[emoji]) || 0;
        const reacted = reactedSet.has(q.id + ':' + emoji);
        return '<button class="ama-react-btn ' + (reacted ? 'react-active' : '') + '" data-id="' + q.id + '" data-emoji="' + emoji + '">' + emoji + '<span>' + count + '</span></button>';
      }).join('');
      const activeSpotlight = !!opts.activeSpotlight;
      const spotlightBadge = activeSpotlight ? '<span class="ama-spotlight-badge"><span class="material-symbols-outlined ama-spotlight-icon">hotel_class</span>Featured</span>' : '';
      const pinBadge = q.pinned ? '<span class="ama-pin-badge"><span class="material-symbols-outlined ama-pin-icon">push_pin</span>Pinned</span>' : '';
      const topicBadge = q.topic ? '<span class="ama-topic-badge" title="' + (q.topicManual ? 'Manual topic' : 'Auto topic') + '"><span class="material-symbols-outlined ama-topic-icon">sell</span>' + esc(q.topic) + '</span>' : '';
      const badgeRow = (activeSpotlight || q.pinned || q.topic) ? '<div class="ama-badge-row">' + (activeSpotlight ? spotlightBadge : (q.pinned ? pinBadge : '')) + (activeSpotlight && q.pinned ? pinBadge : '') + topicBadge + '</div>' : '';
      const reactionEntries = Object.entries(q.reactions || {}).filter(([, v]) => v > 0);
      const reactionSummary = reactionEntries.length ? '<div class="ama-reaction-summary">' + reactionEntries.map(([e, c]) => '<span>' + e + ' ' + c + '</span>').join(' ') + '</div>' : '';
      return '<div class="ama-q' + (q.pinned ? ' ama-q-pinned' : '') + (activeSpotlight ? ' ama-q-spotlight' : '') + (opts.featured ? ' ama-q-featured-card' : '') + '">' +
        badgeRow +
        '<div class="ama-q-text">' + esc(q.question) + '</div>' +
        '<div class="ama-q-ans">' + esc(q.answer) + '</div>' +
        '<div class="ama-q-meta">' +
          '<span class="ama-q-meta-name"><span class="material-symbols-outlined ama-q-meta-icon">person</span>' + esc(q.name || 'Anonymous') + '</span>' +
          '<span class="ama-q-meta-time"><span class="material-symbols-outlined ama-q-meta-icon">schedule</span>Asked ' + esc(formatAmaTime(q.createdAt)) + '</span>' +
          '<span class="ama-q-meta-time ama-q-meta-answered"><span class="material-symbols-outlined ama-q-meta-icon">check_circle</span>Answered ' + esc(formatAmaTime(q.answeredAt)) + '</span>' +
          (activeSpotlight && q.spotlightAt ? '<span class="ama-q-meta-time ama-q-meta-spotlight"><span class="material-symbols-outlined ama-q-meta-icon">hotel_class</span>Featured ' + esc(formatAmaTime(q.spotlightAt)) + '</span>' : '') +
          (q.editedAt ? '<span class="ama-q-meta-time ama-q-meta-edited"><span class="material-symbols-outlined ama-q-meta-icon">edit</span>Edited ' + esc(formatAmaTime(q.editedAt)) + '</span>' : '') +
        '</div>' +
        '<div class="ama-q-vote">' +
        '<button class="ama-vote-btn ' + (up ? 'voted' : '') + '" data-id="' + q.id + '" data-dir="1" title="Helpful">\u25B2</button>' +
        '<span class="ama-vote-count" data-count="' + q.id + '">' + q.votes + '</span>' +
        '<button class="ama-vote-btn ' + (up ? 'voted' : '') + '" data-id="' + q.id + '" data-dir="-1" title="Undo">\u25BC</button>' +
        '</div>' +
        '<div class="ama-q-reactions">' + reactionHTML +
          '<button class="ama-share-btn" data-share="' + q.id + '" title="Share this answer" aria-label="Share this answer"><span class="material-symbols-outlined">ios_share</span></button>' +
        '</div>' +
        reactionSummary +
        '</div>';
    }

    function findAmaDoc(id) {
      return answeredDocs.find(d => d.id === id) || null;
    }

    function wireAmaActions(root) {
      if (!root) return;
      root.querySelectorAll('.ama-vote-btn').forEach(b => b.addEventListener('click', () => vote(b.dataset.id, +b.dataset.dir)));
      root.querySelectorAll('.ama-react-btn').forEach(b => b.addEventListener('click', () => toggleReaction(b.dataset.id, b.dataset.emoji)));
      root.querySelectorAll('.ama-share-btn').forEach(b => b.addEventListener('click', () => { const d = findAmaDoc(b.dataset.share); if (d) openShareCard(d); }));
    }

    /* ── 33. SHAREABLE AMA ANSWER CARDS (canvas-generated OG image) ── */
    // Accent hex mirrors the accent picker so shared cards match the site theme.
    const SHARE_ACCENTS = { cyan: '#00c8ff', violet: '#8b5cf6', emerald: '#10b981', rose: '#f43f5e', amber: '#f59e0b', blue: '#3b82f6' };
    let shareModal = null;

    function wrapCanvasText(ctx, text, maxWidth, maxLines) {
      const words = String(text || '').split(/\s+/);
      const lines = [];
      let line = '';
      for (let i = 0; i < words.length; i++) {
        const test = line ? line + ' ' + words[i] : words[i];
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line); line = words[i];
          if (lines.length === maxLines - 1) break;
        } else { line = test; }
      }
      if (lines.length < maxLines) lines.push(line);
      // Ellipsis if truncated.
      const used = lines.join(' ').split(/\s+/).length;
      if (used < words.length) lines[lines.length - 1] = (lines[lines.length - 1] || '').replace(/\s*\S*$/, '') + '…';
      return lines.filter(Boolean);
    }

    function drawShareCanvas(q) {
      const W = 1200, H = 630, dpr = 2;
      const canvas = document.createElement('canvas');
      canvas.width = W * dpr; canvas.height = H * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      const accentId = localStorage.getItem('accent') || 'cyan';
      const accent = SHARE_ACCENTS[accentId] || SHARE_ACCENTS.cyan;

      // Background
      ctx.fillStyle = '#05050a'; ctx.fillRect(0, 0, W, H);
      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, 'rgba(0,200,255,0.10)'); grad.addColorStop(1, 'rgba(120,90,255,0.06)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
      // Accent bar
      ctx.fillStyle = accent; ctx.fillRect(0, 0, 12, H);
      // Border
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, H - 2);

      const PAD = 70;
      // Label
      ctx.fillStyle = accent;
      ctx.font = '600 22px "JetBrains Mono", monospace';
      ctx.fillText('ASK  ME  ANYTHING', PAD, 84);

      // Question
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 46px Inter, sans-serif';
      const qLines = wrapCanvasText(ctx, q.question, W - PAD * 2, 3);
      let y = 150;
      qLines.forEach(l => { ctx.fillText(l, PAD, y); y += 58; });

      // Divider
      y += 6;
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
      y += 46;

      // Answer
      ctx.fillStyle = 'rgba(255,255,255,0.86)';
      ctx.font = '400 30px Inter, sans-serif';
      const aLines = wrapCanvasText(ctx, q.answer, W - PAD * 2, 6);
      aLines.forEach(l => { ctx.fillText(l, PAD, y); y += 42; });

      // Footer
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '500 24px Inter, sans-serif';
      ctx.fillText('— Yatin Sharma', PAD, H - 54);
      ctx.textAlign = 'right';
      ctx.fillStyle = accent;
      ctx.font = '600 22px "JetBrains Mono", monospace';
      ctx.fillText('portfolio.yatinsharma.me', W - PAD, H - 54);
      ctx.textAlign = 'left';
      return canvas;
    }

    function ensureShareModal() {
      if (shareModal) return shareModal;
      shareModal = document.createElement('div');
      shareModal.className = 'ama-share-modal';
      shareModal.hidden = true;
      shareModal.innerHTML =
        '<div class="ama-share-backdrop"></div>' +
        '<div class="ama-share-dialog" role="dialog" aria-modal="true" aria-label="Share answer">' +
          '<button class="ama-share-x" aria-label="Close">✕</button>' +
          '<div class="ama-share-preview" id="ama-share-preview"></div>' +
          '<div class="ama-share-actions">' +
            '<button class="ama-share-action" data-act="download"><span class="material-symbols-outlined">download</span>Download</button>' +
            '<button class="ama-share-action" data-act="share" hidden><span class="material-symbols-outlined">share</span>Share</button>' +
            '<button class="ama-share-action" data-act="copylink"><span class="material-symbols-outlined">link</span>Copy link</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(shareModal);
      const close = () => { shareModal.hidden = true; document.body.style.overflow = ''; };
      shareModal.querySelector('.ama-share-x').addEventListener('click', close);
      shareModal.querySelector('.ama-share-backdrop').addEventListener('click', close);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !shareModal.hidden) close(); });
      return shareModal;
    }

    function openShareCard(q) {
      const modal = ensureShareModal();
      const canvas = drawShareCanvas(q);
      const preview = modal.querySelector('#ama-share-preview');
      preview.innerHTML = '';
      canvas.className = 'ama-share-canvas';
      canvas.style.width = '100%'; canvas.style.height = 'auto';
      preview.appendChild(canvas);

      const link = 'https://portfolio.yatinsharma.me/#ama';
      const fileName = 'ama-' + (q.id || 'answer') + '.png';
      const shareBtn = modal.querySelector('[data-act="share"]');
      const dlBtn = modal.querySelector('[data-act="download"]');
      const copyBtn = modal.querySelector('[data-act="copylink"]');

      const toBlob = () => new Promise(res => canvas.toBlob(res, 'image/png'));

      dlBtn.onclick = async () => {
        const blob = await toBlob(); if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = fileName; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };

      // Web Share API (with image file) where supported.
      const canShareFiles = !!(navigator.canShare && navigator.share);
      shareBtn.hidden = !canShareFiles;
      if (canShareFiles) shareBtn.onclick = async () => {
        const blob = await toBlob(); if (!blob) return;
        const file = new File([blob], fileName, { type: 'image/png' });
        try {
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'AMA — Yatin Sharma', text: q.question, url: link });
          } else {
            await navigator.share({ title: 'AMA — Yatin Sharma', text: q.question, url: link });
          }
        } catch (e) {}
      };

      copyBtn.onclick = async () => {
        try { await navigator.clipboard.writeText(link); copyBtn.classList.add('copied'); const span = copyBtn.querySelector('span:last-child') || copyBtn; setTimeout(() => copyBtn.classList.remove('copied'), 1500); }
        catch (e) {}
      };

      modal.hidden = false;
      document.body.style.overflow = 'hidden';
    }

    function render() {
      if (!answeredDocs.length) {
        if (listWrap) listWrap.hidden = true;
        if (featured) { featured.hidden = true; featured.innerHTML = ''; }
        return;
      }
      if (listWrap) listWrap.hidden = false;
      const spotlightCandidates = answeredDocs
        .filter(q => q.spotlight && !q.dismissed)
        .sort((a, b) => new Date(b.spotlightAt || b.answeredAt || 0) - new Date(a.spotlightAt || a.answeredAt || 0));
      const spotlightDoc = spotlightCandidates[0] || null;
      const activeSpotlightId = spotlightDoc ? spotlightDoc.id : '';
      const searching = !!activeSearch;
      if (featured) {
        // While searching, fold the featured card into the searchable list so
        // matches aren't hidden above the results.
        if (spotlightDoc && !searching) {
          featured.hidden = false;
          featured.innerHTML = '<div style="animation-delay:0s">' + amaQuestionCard(spotlightDoc, { featured: true, activeSpotlight: true }) + '</div>';
          wireAmaActions(featured);
        } else {
          featured.hidden = true;
          featured.innerHTML = '';
        }
      }
      const arr = sorted().filter(q =>
        searching ? matchesSearch(q) : !(featured && q.id === activeSpotlightId)
      );
      const pages = Math.max(1, Math.ceil(arr.length / PER_PAGE));
      if (page > pages) page = pages;
      const slice = arr.slice((page - 1) * PER_PAGE, page * PER_PAGE);
      list.innerHTML = slice.length
        ? slice.map((q, i) => '<div style="animation-delay:' + (i * 0.06) + 's">' + amaQuestionCard(q, { activeSpotlight: q.id === activeSpotlightId && (searching || !featured) }) + '</div>').join('')
        : (searching
            ? '<div class="ama-empty-note">No answered questions match “' + esc(activeSearch) + '”.</div>'
            : (spotlightDoc ? '<div class="ama-empty-note">No more answered questions yet.</div>' : ''));
      renderPager(arr.length ? pages : 1);
      wireAmaActions(list);
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
    function toggleReaction(id, emoji) {
      const key = id + ':' + emoji;
      // Check if already reacted (via Set or UI state as fallback)
      const btn = document.querySelector('.ama-react-btn[data-id="' + id + '"][data-emoji="' + emoji + '"]');
      const isReacted = reactedSet.has(key) || (btn && btn.classList.contains('react-active'));
      
      const delta = isReacted ? -1 : 1;
      
      if (isReacted) {
        reactedSet.delete(key);
      } else {
        reactedSet.add(key);
      }
      
      // Safely save to localStorage
      try { localStorage.setItem('yatin_ama_reactions', JSON.stringify([...reactedSet])); } catch (e) {}
      
      // Update local state
      const doc = answeredDocs.find(q => q.id === id);
      if (doc) { 
        if (!doc.reactions) doc.reactions = {}; 
        doc.reactions[emoji] = Math.max(0, (doc.reactions[emoji] || 0) + delta); 
      }
      
      render(); // Re-render to update UI
      fetch('/api/reactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, emoji, delta }) }).catch(() => {});
    }
    function loadAnswered() {
      if (!FIREBASE_READY) return;
      fetch(queryUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: {
          from: [{ collectionId: COL }],
          where: { fieldFilter: { field: { fieldPath: 'answered' }, op: 'EQUAL', value: { booleanValue: true } } },
          limit: 200
        } })
      }).then(r => r.json()).then(data => {
        if (data && data.length && data[0].error) {
          console.error('Firestore query error:', data[0].error.message);
          if (listWrap) { listWrap.hidden = false; list.innerHTML = '<div style="color:#ff6b6b;padding:12px;font-family:monospace;font-size:12px;">Error: ' + esc(data[0].error.message) + '</div>'; }
          return;
        }
        /* Parse docs and filter out dismissed questions.
           Dismissed questions have answered=false (bot sets it on dismiss)
           but the Firestore query returns answered==true docs only,
           so dismissed answered Qs are already excluded by the query.
           This .filter is an extra safety net for any edge case. */
        answeredDocs = (data || []).filter(d => d.document).map(d => fromDoc(d.document)).filter(q => !q.dismissed);
        answeredDocs.sort((a, b) => new Date(b.answeredAt || 0) - new Date(a.answeredAt || 0));
        // Publish trimmed answered Q&A so the "Ask my portfolio" chatbot (57) can ground its replies.
        window.__amaContext = answeredDocs.filter(q => q.answer).map(q => ({ question: q.question, answer: q.answer }));
        render();
      }).catch((err) => { console.warn('AMA load failed:', err); });
    }
    function submit() {
      const text = input.value.trim();
      if (!text) { status.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">error</span> Please type a question first.'; status.className = 'ama-status err'; return; }
      if (todayCount >= CONFIG.amaLimit) { status.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">block</span> Daily limit reached.'; status.className = 'ama-status err'; return; }
      const typedName = (nameTouched && nameInput) ? nameInput.value.trim() : '';
      // Empty/untouched name should always be anonymous. We intentionally do
      // not reuse localStorage or browser-autofilled values here.
      const name = (typedName || 'Anonymous').slice(0, 60);
      const id = uuid(), createdAt = new Date().toISOString();
      const autoTopic = autoTopicForQuestionClient(text, '');
      const question = {
        id: { stringValue: id }, name: { stringValue: name }, question: { stringValue: text },
        answer: { stringValue: '' }, answered: { booleanValue: false },
        createdAt: { stringValue: createdAt }, answeredAt: { nullValue: null }, votes: { integerValue: 0 },
        pinned: { booleanValue: false }, dismissed: { booleanValue: false },
        topic: { stringValue: autoTopic }, topicManual: { booleanValue: false }, topicAt: { stringValue: createdAt }
      };
      status.innerHTML = '<span class="ama-send-spinner"></span> Sending…'; status.className = 'ama-status';
      if (send) { send.disabled = true; send.querySelector('.ama-send-text').textContent = 'Sending…'; send.querySelector('.ama-send-icon').hidden = true; send.querySelector('.ama-send-spinner').hidden = false; }
      const notify = () => fetch('/api/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, question: text, id, createdAt, topic: autoTopic }) }).catch(() => {});
      const afterSubmit = (ok) => {
        todayCount++; localStorage.setItem(LIMIT_KEY, JSON.stringify({ date: today, count: todayCount })); countEl.textContent = todayCount; input.value = '';
        updateCharCount();
        if (nameInput) nameInput.value = '';
        nameTouched = false;
        try { localStorage.removeItem('yatin_ama_name'); } catch (e) {}
        if (ok) {
          status.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">check_circle</span> Sent! Yatin will reply soon — check back here.';
          if (window.unlockAchievement) window.unlockAchievement('asked', 'Inquisitive Mind', 'Asked a question!');
        } else {
          status.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">error</span> Could not send. Try again later.';
        }
        status.className = ok ? 'ama-status ok' : 'ama-status err';
        if (send) { send.querySelector('.ama-send-text').textContent = 'Send'; send.querySelector('.ama-send-icon').hidden = false; send.querySelector('.ama-send-spinner').hidden = true; }
        updateCharCount();
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
    // Sort pills + search box share the same widgets as the AniList section (see Widgets, item 62).
    Widgets.bindPills({ container: sortWrap, selector: '.ama-sort-btn', attr: 'sort', onSelect: (v) => { activeSort = v; page = 1; render(); } });
    /* Search box — filter answered questions by question, answer, topic or name */
    Widgets.bindSearch({ input: searchInput, clear: searchClear, onChange: (v) => { activeSearch = v; page = 1; render(); } });

    /* Refresh button — manual reload of answered questions */
    const refreshBtn = $('ama-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', () => {
      refreshBtn.classList.add('ama-refresh-spin');
      var amaCard = document.querySelector('.ama-card');
      if (amaCard) {
        var ov = amaCard.querySelector('.ama-refresh-overlay');
        if (!ov) { ov = document.createElement('div'); ov.className = 'ama-refresh-overlay'; amaCard.style.position = 'relative'; amaCard.appendChild(ov); }
        ov.offsetHeight; ov.classList.add('visible');
      }
      loadAnswered();
      setTimeout(function() {
        refreshBtn.classList.remove('ama-refresh-spin');
        var ov2 = document.querySelector('.ama-refresh-overlay');
        if (ov2) { ov2.classList.remove('visible'); setTimeout(function() { ov2.remove(); }, 300); }
      }, 600);
    });

    /* Auto-refresh every 60s when AMA section is visible.
       Uses IntersectionObserver to pause when off-screen (saves API calls). */
    let amaVisible = false;
    const amaSection = document.getElementById('ama');
    if (amaSection) {
      const amaObs = new IntersectionObserver((entries) => {
        amaVisible = entries[0].isIntersecting;
      }, { threshold: 0 });
      amaObs.observe(amaSection);
    }
    setInterval(() => {
      if (amaVisible) loadAnswered();
    }, 60000);

    loadAnswered();
  })();

  /* ============================================================
     20. FADE-IN OBSERVER + YEAR
     ============================================================ */
  (function reveal() {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
    }, { threshold: 0.1 });
    document.querySelectorAll('.fade-in').forEach(el => obs.observe(el));
    const y = $('year'); if (y) y.textContent = new Date().getFullYear();
  })();

  /* ============================================================
     21. HERO STAGGERED ENTRANCE
     Fires once the intro overlay dismisses.
     ============================================================ */
  (function heroEntrance() {
    const hero = document.querySelector('.hero');
    if (!hero) return;
    function fire() { hero.classList.add('revealed'); }
    setTimeout(fire, 400);
    if (!document.getElementById('intro-overlay')) fire();
  })();

  /* ============================================================
     22. MAGNETIC BUTTONS
     Desktop-only: buttons drift toward the cursor on hover.
     ============================================================ */
  (function magnetic() {
    if (window.matchMedia('(hover: none)').matches) return;
    document.querySelectorAll('.magnetic').forEach(btn => {
      const strength = 0.3;
      btn.addEventListener('mousemove', (e) => {
        const r = btn.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        btn.style.transform = 'translate(' + (x * strength) + 'px, ' + (y * strength) + 'px)';
      });
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    });
  })();

  /* ============================================================
     23. HAPTIC FEEDBACK + BLUR-UP IMAGES + SOUND FX
     ============================================================ */
  window.haptic = function (ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) {} };
  
  // Sound effects
  window.sfx = (function () {
    let ctx = null, muted = false;
    try { muted = localStorage.getItem('pg_muted') === '1'; } catch (e) {}
    function play(freq, dur, type) {
      if (muted) return;
      try {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = type || 'square'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (dur || 0.1));
        osc.start(); osc.stop(ctx.currentTime + (dur || 0.1));
      } catch (e) {}
    }
    return { play: play, blip: function () { play(660, 0.05, 'square'); }, crash: function () { play(120, 0.3, 'sawtooth'); }, win: function () { play(523, 0.1); setTimeout(() => play(659, 0.1), 100); setTimeout(() => play(784, 0.2), 200); }, toggle: function () { muted = !muted; try { localStorage.setItem('pg_muted', muted ? '1' : '0'); } catch (e) {} return muted; }, isMuted: function () { return muted; } };
  })();

  // N. Touch Ripple Effect
  (function rippleEffect() {
    document.querySelectorAll('a, button, .project-card, .interest-card, .pg-card').forEach(el => {
      el.addEventListener('pointerdown', function(e) {
        if (e.pointerType === 'mouse') return; // Only for touch
        const rect = el.getBoundingClientRect();
        const ripple = document.createElement('span');
        ripple.className = 'ripple';
        const size = Math.max(rect.width, rect.height);
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
        ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
        el.style.overflow = 'hidden'; // ensure ripple stays inside
        el.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      });
    });
  })();

  // E. Card Cursor Tracking Glow (throttled to ~1 update per 16ms to prevent scroll jank)
  (function cardGlow() {
    document.querySelectorAll('.glass-card').forEach(card => {
      let rafId = 0;
      card.addEventListener('mousemove', (e) => {
        if (rafId) return; // skip if a frame is already pending
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          const rect = card.getBoundingClientRect();
          card.style.setProperty('--mouse-x', (e.clientX - rect.left) + 'px');
          card.style.setProperty('--mouse-y', (e.clientY - rect.top) + 'px');
        });
      });
    });
  })();

  (function blurUp() {
    document.querySelectorAll('img.blur-up').forEach(img => {
      if (img.complete) img.classList.add('loaded');
      else img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
    });
  })();

  /* ============================================================
     M. KEYBOARD SHORTCUTS OVERLAY
     ============================================================ */
  (function shortcuts() {
    const overlay = $('shortcut-overlay');
    const closeBtn = $('shortcut-close');
    if (!overlay || !closeBtn) return;
    const toggle = () => overlay.classList.toggle('open');
    closeBtn.addEventListener('click', toggle);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) toggle(); });
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      const key = e.key.toLowerCase();
      if (key === '?') { e.preventDefault(); toggle(); }
      else if (key === 't') { document.getElementById('theme-toggle-btn')?.click(); }
      else if (key === 'm') { document.getElementById('topbar-music-icon')?.click(); }
      else if (key === 'g') { document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' }); }
      else if (key === 'p') { document.getElementById('projects')?.scrollIntoView({ behavior: 'smooth' }); }
      else if (key === 'a') { document.getElementById('ama')?.scrollIntoView({ behavior: 'smooth' }); }
      else if (key === 'escape' && overlay.classList.contains('open')) { toggle(); }
    });
  })();

  /* ============================================================
     23b. L. ACHIEVEMENTS & Q. AMBIENT SOUNDS
     ============================================================ */
  const achievementSystem = {
    unlocked: new Set(JSON.parse(localStorage.getItem('yatin_achievements') || '[]')),
    toastTimeout: null,
    unlock: function(id, title, desc) {
      if (this.unlocked.has(id)) return;
      this.unlocked.add(id);
      localStorage.setItem('yatin_achievements', JSON.stringify([...this.unlocked]));
      
      const toast = document.getElementById('achievement-toast');
      const titleEl = document.getElementById('toast-title');
      const descEl = document.getElementById('toast-desc');
      if (!toast || !titleEl || !descEl) return;
      
      titleEl.textContent = title;
      descEl.textContent = desc;
      toast.classList.add('show');
      
      if (this.toastTimeout) clearTimeout(this.toastTimeout);
      this.toastTimeout = setTimeout(() => toast.classList.remove('show'), 4000);
    }
  };
  // Q. Ambient hover sounds (very subtle)
  (function ambientSounds() {
    let hoverEnabled = false;
    // Enable only after first interaction (browser autoplay policy)
    document.addEventListener('click', () => { hoverEnabled = true; }, { once: true });
    document.querySelectorAll('.tb-icon-btn, .pg-card, .presence-link').forEach(el => {
      el.addEventListener('mouseenter', () => {
        if (hoverEnabled && window.sfx && !window.sfx.isMuted()) {
          window.sfx.play(800, 0.03, 'sine'); // High, quiet blip
        }
      });
    });
  })();
  window.unlockAchievement = achievementSystem.unlock.bind(achievementSystem);
  // Unlock intro achievement
  setTimeout(() => { window.unlockAchievement('visitor', 'Welcome!', 'You explored the portfolio.'); }, 5000);

  /* ============================================================
     57. "ASK MY PORTFOLIO" AI CHATBOT (RAG over profile + AMA)
     ============================================================ */
  (function portfolioChat() {
    const fab = $('pchat-fab'), panel = $('pchat-panel'), closeBtn = $('pchat-close');
    const log = $('pchat-log'), form = $('pchat-form'), inputEl = $('pchat-input'), sendBtn = $('pchat-send');
    const clearBtn = $('pchat-clear');
    const badge = $('pchat-fab-badge');
    const scrollBtn = $('pchat-scroll-btn');
    const charCount = $('pchat-char-count');
    const suggestionsEl = $('pchat-suggestions');
    if (!fab || !panel || !form) return;

    const history = [];
    let busy = false, greeted = false, unreadCount = 0;

    /* --- Helpers --- */
    function timeNow() {
      var d = new Date();
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function linkify(text) {
      return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    }

    function formatText(text) {
      var html = linkify(text);
      html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/\n/g, '<br>');
      return html;
    }

    function playBlip() {
      try { if (window.sfx && !window.sfx.isMuted()) window.sfx.play(660, 0.05, 'square'); } catch (e) {}
    }

    /* --- Character counter --- */
    function updateCharCount() {
      var len = inputEl.value.length;
      var max = parseInt(inputEl.getAttribute('maxlength')) || 1000;
      charCount.textContent = len + '/' + max;
      charCount.classList.remove('warn', 'limit');
      if (len >= max) charCount.classList.add('limit');
      else if (len >= max * 0.8) charCount.classList.add('warn');
      charCount.classList.toggle('visible', len > 0);
    }
    inputEl.addEventListener('input', updateCharCount);
    updateCharCount();

    /* --- Scroll-to-bottom button --- */
    function checkScroll() {
      var atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
      scrollBtn.hidden = atBottom;
    }
    log.addEventListener('scroll', checkScroll);
    scrollBtn.addEventListener('click', function () { log.scrollTop = log.scrollHeight; });

    /* --- User message --- */
    function addUserBubble(text) {
      var el = document.createElement('div');
      el.className = 'pchat-msg pchat-user';
      el.innerHTML = formatText(text);
      var meta = document.createElement('div');
      meta.className = 'pchat-msg-meta';
      meta.innerHTML = '<span class="pchat-msg-time">' + timeNow() + '</span>';
      el.appendChild(meta);
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      checkScroll();
    }

    /* --- Bot message (avatar + timestamp + copy) --- */
    function addBotBubble(text, isError) {
      var wrap = document.createElement('div');
      wrap.className = 'pchat-bot-wrap' + (isError ? ' pchat-msg-error' : '');

      var avatar = document.createElement('div');
      avatar.className = 'pchat-bot-avatar';
      avatar.innerHTML = '<span class="material-symbols-outlined">smart_toy</span>';
      wrap.appendChild(avatar);

      var bubble = document.createElement('div');
      bubble.className = 'pchat-bot-bubble';
      bubble.innerHTML = formatText(text);
      wrap.appendChild(bubble);

      var meta = document.createElement('div');
      meta.className = 'pchat-msg-meta';
      meta.innerHTML = '<span class="pchat-msg-time">' + timeNow() + '</span>' +
        '<button class="pchat-copy-btn" title="Copy" aria-label="Copy message"><span class="material-symbols-outlined">content_copy</span></button>';
      wrap.appendChild(meta);

      meta.querySelector('.pchat-copy-btn').addEventListener('click', function () {
        var btn = this;
        navigator.clipboard.writeText(text).then(function () {
          btn.querySelector('.material-symbols-outlined').textContent = 'check';
          setTimeout(function () { btn.querySelector('.material-symbols-outlined').textContent = 'content_copy'; }, 1500);
        }).catch(function () {});
      });

      if (isError) {
        var retryBtn = document.createElement('button');
        retryBtn.className = 'pchat-retry-btn';
        retryBtn.innerHTML = '<span class="material-symbols-outlined">refresh</span> Retry';
        retryBtn.addEventListener('click', function () { wrap.remove(); ask(text, true); });
        bubble.appendChild(retryBtn);
      }

      log.appendChild(wrap);
      log.scrollTop = log.scrollHeight;
      checkScroll();
    }

    /* --- Typing indicator --- */
    function addTypingBubble() {
      var wrap = document.createElement('div');
      wrap.className = 'pchat-typing-wrap';

      var avatar = document.createElement('div');
      avatar.className = 'pchat-bot-avatar';
      avatar.innerHTML = '<span class="material-symbols-outlined">smart_toy</span>';
      wrap.appendChild(avatar);

      var bubble = document.createElement('div');
      bubble.className = 'pchat-typing-bubble';
      bubble.innerHTML = '<span class="pchat-typing-text">Thinking</span><span class="pchat-typing-dots"><span></span><span></span><span></span></span>';
      wrap.appendChild(bubble);

      log.appendChild(wrap);
      log.scrollTop = log.scrollHeight;
      checkScroll();
      return wrap;
    }

    /* --- Open / Close --- */
    function open() {
      panel.hidden = false;
      requestAnimationFrame(function () { panel.classList.add('open'); });
      fab.classList.add('hidden');
      unreadCount = 0;
      badge.hidden = true;
      badge.textContent = '';
      if (!greeted) {
        greeted = true;
        addBotBubble('Hi! I can answer questions about Yatin \u2014 his projects, skills, and background. What would you like to know?', false);
      }
      setTimeout(function () { inputEl.focus(); }, 120);
    }
    function close() {
      panel.classList.remove('open');
      fab.classList.remove('hidden');
      setTimeout(function () { panel.hidden = true; }, 220);
    }
    fab.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) close(); });

    /* --- Clear chat --- */
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        var msgs = log.querySelectorAll('.pchat-msg, .pchat-bot-wrap, .pchat-typing-wrap');
        msgs.forEach(function (m) { m.remove(); });
        history.length = 0;
        greeted = false;
        if (suggestionsEl) suggestionsEl.hidden = false;
        addBotBubble('Chat cleared! Ask me anything about Yatin.', false);
      });
    }

    /* --- Suggestion chips --- */
    if (suggestionsEl) {
      suggestionsEl.querySelectorAll('.pchat-suggest-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          var q = this.getAttribute('data-q') || this.textContent.trim();
          inputEl.value = q;
          updateCharCount();
          suggestionsEl.hidden = true;
          form.dispatchEvent(new Event('submit'));
        });
      });
    }

    function hideSuggestions() {
      if (suggestionsEl) suggestionsEl.hidden = true;
    }

    /* --- Unread badge --- */
    function addUnread() {
      if (!panel.hidden) return;
      unreadCount++;
      badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
      badge.hidden = false;
    }

    /* --- Ask AI --- */
    async function ask(message, isRetry) {
      if (busy) return;
      busy = true; sendBtn.disabled = true;
      hideSuggestions();

      if (!isRetry) {
        addUserBubble(message);
        history.push({ role: 'user', content: message });
      }

      var typing = addTypingBubble();
      try {
        var res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: message, history: history.slice(0, -1), ama: window.__amaContext || [] })
        });
        var data = await res.json().catch(function () { return {}; });
        typing.remove();
        var reply = (data && data.reply) || "Sorry, I couldn't answer that right now.";
        addBotBubble(reply, false);
        history.push({ role: 'assistant', content: reply });
        playBlip();
        addUnread();
      } catch (e) {
        typing.remove();
        addBotBubble("Couldn't reach the assistant. Please try again in a moment.", true);
        addUnread();
      } finally {
        busy = false; sendBtn.disabled = false; inputEl.focus();
        charCount.textContent = '0/' + (parseInt(inputEl.getAttribute('maxlength')) || 1000);
        charCount.classList.remove('visible', 'warn', 'limit');
      }
    }

    /* --- Form submit --- */
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = inputEl.value.trim();
      if (!msg || busy) return;
      inputEl.value = '';
      updateCharCount();
      ask(msg);
    });

    /* --- Achievement --- */
    if (window.unlockAchievement) fab.addEventListener('click', function () { window.unlockAchievement('askbot', 'Curious', 'Opened the portfolio assistant.'); }, { once: true });
  })();

  /* ============================================================
     61. KONAMI CODE EASTER EGG (↑↑↓↓←→←→ B A → confetti + party mode)
     ============================================================ */
  (function konami() {
    const SEQ = ['arrowup','arrowup','arrowdown','arrowdown','arrowleft','arrowright','arrowleft','arrowright','b','a'];
    let pos = 0;
    document.addEventListener('keydown', (e) => {
      // Ignore while typing in inputs/textareas.
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
      if (k === SEQ[pos]) {
        pos++;
        if (pos === SEQ.length) { pos = 0; trigger(); }
      } else {
        pos = (k === SEQ[0]) ? 1 : 0;
      }
    });
    function trigger() {
      window.unlockAchievement('konami', 'Konami Code!', 'You found the secret. Party mode engaged.');
      try { if (window.sfx && !window.sfx.isMuted() && window.sfx.win) window.sfx.win(); } catch (e) {}
      confetti();
      const root = document.documentElement;
      root.classList.add('konami-party');
      setTimeout(() => root.classList.remove('konami-party'), 6000);
    }
    function confetti() {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const colors = ['#00c8ff', '#8b5cf6', '#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#ec4899'];
      const layer = document.createElement('div'); layer.className = 'konami-confetti';
      document.body.appendChild(layer);
      for (let i = 0; i < 120; i++) {
        const p = document.createElement('i');
        p.style.left = (Math.random() * 100) + 'vw';
        p.style.background = colors[i % colors.length];
        p.style.animationDelay = (Math.random() * 0.6) + 's';
        p.style.animationDuration = (2.4 + Math.random() * 1.8) + 's';
        p.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
        p.style.setProperty('--drift', (Math.random() * 220 - 110) + 'px');
        if (Math.random() > 0.5) p.style.borderRadius = '50%';
        layer.appendChild(p);
      }
      setTimeout(() => layer.remove(), 5400);
    }
  })();

  /* ============================================================
     24. CURSOR GLOW + TRAIL
     ============================================================ */
  (function cursorFX() {
    if (window.matchMedia('(hover: none)').matches) return;
    const glow = $('cursor-glow');
    const canvas = $('cursor-trail'); if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let dots = [], mx = 0, my = 0;
    // Trail colour follows the palette accent (--accent-solid), parsed + cached.
    let accentCache = { hex: '', rgb: '0,200,255' };
    function accentRGB() {
      const hex = (getComputedStyle(document.documentElement).getPropertyValue('--accent-solid') || '').trim();
      if (hex && hex !== accentCache.hex) {
        const m = hex.replace('#', '');
        if (m.length === 6) accentCache = { hex: hex, rgb: parseInt(m.slice(0, 2), 16) + ',' + parseInt(m.slice(2, 4), 16) + ',' + parseInt(m.slice(4, 6), 16) };
        else if (m.length === 3) accentCache = { hex: hex, rgb: parseInt(m[0] + m[0], 16) + ',' + parseInt(m[1] + m[1], 16) + ',' + parseInt(m[2] + m[2], 16) };
      }
      return accentCache.rgb;
    }
    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    resize(); window.addEventListener('resize', resize);
    window.addEventListener('mousemove', (e) => {
      mx = e.clientX; my = e.clientY;
      if (glow) { glow.style.transform = 'translate(' + mx + 'px,' + my + 'px) translate(-50%,-50%)'; }
      dots.push({ x: mx, y: my, life: 1 });
      if (dots.length > 25) dots.shift();
    });
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const rgb = accentRGB();
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i]; d.life -= 0.04;
        if (d.life <= 0) continue;
        ctx.fillStyle = 'rgba(' + rgb + ',' + (d.life * 0.5) + ')';
        ctx.beginPath(); ctx.arc(d.x, d.y, d.life * 4, 0, 7); ctx.fill();
      }
      dots = dots.filter(d => d.life > 0);
      requestAnimationFrame(draw);
    }
    draw();
  })();

  /* ============================================================
     25. SECTION DIVIDERS (disabled — section headings have numbering)
     ============================================================ */

  /* ============================================================
     26. GITHUB CONTRIBUTION GRAPH
     ============================================================ */
  (function contributions() {
    const grid = $('contrib-grid'); if (!grid) return;
    const totalEl = $('contrib-total');
    const streakEl = $('contrib-streak');
    const summaryEl = $('contrib-summary');
    const monthsEl = $('contrib-months');
    const tip = $('contrib-tip');
    const scrollEl = $('contrib-scroll');
    const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // Build skeleton grid (14 weeks x 7 days)
    const sk = $('contrib-skeleton');
    if (sk) sk.innerHTML = Array.from({length:14}, () => '<div class="sk-week">' + Array.from({length:7}, () => '<div class="sk-day skeleton"></div>').join('') + '</div>').join('');

    function showTip(e) {
      const day = e.target.closest('.contrib-day');
      if (!day || !tip) return;
      const date = day.dataset.date;
      const count = parseInt(day.dataset.count || '0');
      const dt = new Date(date + 'T00:00:00');
      const dayName = DAY_NAMES[dt.getDay()];
      const formatted = MONTH_NAMES[dt.getMonth()] + ' ' + dt.getDate() + ', ' + dt.getFullYear();
      const countText = count === 0 ? 'No contributions' : count + ' contribution' + (count === 1 ? '' : 's');
      tip.innerHTML = '<span class="contrib-tip-date">' + formatted + '  <span class="contrib-tip-day">' + dayName + '</span></span><span class="contrib-tip-count">' + countText + '</span>';
      tip.classList.add('visible');
      positionTip(e);
    }
    function moveTip(e) { positionTip(e); }
    function hideTip() { if (tip) tip.classList.remove('visible'); }
    function positionTip(e) {
      if (!tip) return;
      const x = e.clientX, y = e.clientY;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      const gap = 10;
      const below = y + gap + th < window.innerHeight;
      const tipX = Math.min(Math.max(gap, x - tw / 2), window.innerWidth - tw - gap);
      const tipY = below ? y + gap + 14 : Math.max(gap, y - th - gap);
      tip.style.left = tipX + 'px';
      tip.style.top = tipY + 'px';
    }

    fetch('/api/contributions?user=' + CONFIG.githubUser)
      .then(r => r.json())
      .then(d => {
        if (d.error || !d.days) { grid.innerHTML = '<div class="contrib-loading">Could not load (GitHub may be rate-limited).</div>'; return; }

        // Total
        if (totalEl) totalEl.textContent = (d.total || 0).toLocaleString();

        // Streak badge
        if (streakEl && d.streaks) {
          const s = d.streaks;
          streakEl.innerHTML = '<span class="material-symbols-outlined contrib-streak-fire" style="font-size:14px;color:var(--accent)">local_fire_department</span> <span class="contrib-streak-num">' + s.current + '</span><span class="contrib-streak-slash">/</span>' + s.longest + ' day streak';
        }

        // Summary stats
        if (summaryEl) {
          const bestDayText = d.bestDay ? esc(d.bestDay.text) + ' · ' + d.bestDay.count : '—';
          summaryEl.innerHTML =
            '<div class="contrib-stat"><span class="contrib-stat-value">' + (d.thisMonth || 0).toLocaleString() + '</span><span class="contrib-stat-label">this month</span></div>' +
            '<div class="contrib-stat"><span class="contrib-stat-value">' + (d.thisWeek || 0).toLocaleString() + '</span><span class="contrib-stat-label">this week</span></div>' +
            '<div class="contrib-stat"><span class="contrib-stat-value" style="font-size:13px">' + bestDayText + '</span><span class="contrib-stat-label">best day</span></div>' +
            '<div class="contrib-stat"><span class="contrib-stat-value" style="font-size:13px">' + esc(d.busiestMonth || '—') + '</span><span class="contrib-stat-label">busiest month</span></div>';
        }

        // Find best day date for highlight
        const bestDayDate = d.bestDay ? d.bestDay.date : null;

        // Group days into weeks (columns)
        const weeks = [];
        let week = [];
        d.days.forEach(day => { week.push(day); if (week.length === 7) { weeks.push(week); week = []; } });
        if (week.length) weeks.push(week);

        grid.innerHTML = weeks.map(w => '<div class="contrib-week">' + w.map(day => {
          const cls = 'contrib-day' + (day.date === bestDayDate ? ' busiest' : '');
          return '<div class="' + cls + '" data-level="' + day.level + '" data-date="' + day.date + '" data-count="' + (day.count || 0) + '"></div>';
        }).join('') + '</div>').join('');

        // Month labels + set widths on scroll container
        if (monthsEl && d.monthLabels) {
          const colW = 14;
          monthsEl.innerHTML = d.monthLabels.map(ml => {
            const weekIdx = Math.floor(ml.index / 7);
            const left = weekIdx * colW;
            return '<span class="contrib-month-label" style="left:' + left + 'px">' + esc(ml.month) + '</span>';
          }).join('');
          const totalWeeks = weeks.length;
          const totalW = totalWeeks * colW;
          grid.style.minWidth = totalW + 'px';
          monthsEl.style.minWidth = totalW + 'px';
        }

        // Wire custom tooltip
        grid.querySelectorAll('.contrib-day').forEach(day => {
          day.addEventListener('mouseenter', showTip);
          day.addEventListener('mousemove', moveTip);
          day.addEventListener('mouseleave', hideTip);
        });
      })
      .catch(() => { grid.innerHTML = '<div class="contrib-loading">Contribution data unavailable.</div>'; });
  })();

  /* ============================================================
     27. VISITOR COUNTER
     ============================================================ */
  (function visitorCount() {
    const alreadyVisited = localStorage.getItem('yatin_visited');
    const method = alreadyVisited ? 'GET' : 'POST';
    fetch('/api/visitor', { method })
      .then(r => r.json())
      .then(d => {
        if (!alreadyVisited) localStorage.setItem('yatin_visited', '1');
        let badge = document.querySelector('.visitor-badge');
        if (!badge) { badge = document.createElement('div'); badge.className = 'visitor-badge'; document.body.appendChild(badge); }
        badge.textContent = (d.total || 0).toLocaleString() + ' visits';
      })
      .catch(() => {});
  })();

  /* ============================================================
     27b. WAKATIME CODING STATS
     ============================================================ */
  (function wakatime() {
    const langsEl = $('wt-languages'); if (!langsEl) return;
    const totalEl = $('wt-total');
    const dailyEl = $('wt-daily');
    const editorsEl = $('wt-editors');
    const projectsEl = $('wt-projects');
    const heatmapEl = $('wt-heatmap');
    const heatmapDaysEl = $('wt-heatmap-days');
    const streakEl = $('wt-streak');
    const rangeLabelEl = $('wt-range-label');
    const rangeSelector = $('wt-range-selector');
    const FALLBACK = ['#00c8ff','#7850ff','#00f0b4','#f59e0b','#ef4444','#a855f7','#ec4899','#06b6d4'];
    let currentRange = '7d';

    const RANGE_LABELS = { '7d': 'last 7 days', '30d': 'last 30 days', '1y': 'last year' };
    const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    function loadWakaTime(range) {
      currentRange = range || '7d';
      const url = '/api/wakatime' + (currentRange !== '7d' ? '?range=' + currentRange : '');

      // Reset to skeleton states
      if (totalEl) totalEl.innerHTML = '<span class="skeleton" style="width:80px;height:22px;display:inline-block;border-radius:4px"></span>';
      if (dailyEl) dailyEl.innerHTML = '<span class="skeleton" style="width:60px;height:12px;display:inline-block;border-radius:4px"></span>';
      if (streakEl) streakEl.innerHTML = '<span class="skeleton" style="width:120px;height:14px;display:inline-block;border-radius:4px"></span>';
      if (heatmapEl) heatmapEl.innerHTML = Array.from({length:7}, () => '<div class="wt-heatmap-bar"><div class="skeleton" style="width:100%;height:100%;border-radius:4px"></div></div>').join('');
      if (langsEl) langsEl.innerHTML = Array.from({length:4}, () => '<div class="wt-lang"><div class="skeleton" style="width:90px;height:13px;border-radius:4px;flex-shrink:0"></div><div style="flex:1"><div class="skeleton" style="width:80%;height:8px;border-radius:4px;margin-bottom:6px"></div></div><div class="skeleton" style="width:50px;height:11px;border-radius:4px;flex-shrink:0"></div></div>').join('');
      if (editorsEl) editorsEl.innerHTML = Array.from({length:2}, () => '<div class="wt-editor"><div class="skeleton" style="width:70px;height:12px;border-radius:4px;flex-shrink:0"></div><div class="skeleton" style="flex:1;height:6px;border-radius:3px"></div><div class="skeleton" style="width:40px;height:12px;border-radius:4px;flex-shrink:0"></div></div>').join('');
      if (projectsEl) projectsEl.innerHTML = Array.from({length:3}, () => '<div class="wt-project"><div class="skeleton" style="width:120px;height:12px;border-radius:4px;flex-shrink:0"></div><div class="skeleton" style="flex:1;height:6px;border-radius:3px"></div><div class="skeleton" style="width:50px;height:11px;border-radius:4px;flex-shrink:0"></div></div>').join('');

      const wtTimeout = range === '1y' ? 12000 : 10000;
      const wtController = new AbortController();
      const wtTimer = setTimeout(() => wtController.abort(), wtTimeout);
      fetch(url, { signal: wtController.signal }).then(r => r.json()).then(d => {
        clearTimeout(wtTimer);
        if (d.error) {
          langsEl.innerHTML = '<div class="wt-loading">' + esc(d.error) + '</div>';
          return;
        }

        // Header
        if (totalEl) totalEl.textContent = d.total || '—';
        if (dailyEl) dailyEl.textContent = 'avg ' + (d.daily || '') + '/day';
        if (rangeLabelEl) rangeLabelEl.textContent = RANGE_LABELS[d.range] || RANGE_LABELS['7d'];

        // Streak / days active
        if (streakEl && d.daysActive) {
          streakEl.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;color:var(--accent)">local_fire_department</span> <span class="wt-streak-count">' + d.daysActive.active + '</span><span class="wt-streak-slash">/</span>' + d.daysActive.total + ' days active';
        }

        // Daily heatmap
        if (heatmapEl && d.dailyData && d.dailyData.length) {
          const maxSec = Math.max(...d.dailyData.map(x => x.seconds), 1);
          let dayLabels = '';
          heatmapEl.innerHTML = d.dailyData.map((day, i) => {
            const pct = Math.max(Math.round((day.seconds / maxSec) * 100), 3);
            let label = '---';
            if (day.date) {
              const dt = new Date(day.date);
              const dayNum = dt.getDay();
              label = (dayNum >= 0 && dayNum <= 6) ? DAY_NAMES[dayNum] : '---';
            }
            dayLabels += '<span>' + label + '</span>';
            return '<div class="wt-heatmap-bar"><div class="wt-heatmap-fill" style="height:' + pct + '%"></div><div class="wt-heatmap-tooltip">' + esc(day.text || label) + ' &middot; ' + esc(day.label || '0m') + '</div></div>';
          }).join('');
          if (heatmapDaysEl) heatmapDaysEl.innerHTML = dayLabels;
        }

        // Languages with dots, % labels, official colors
        if (d.languages && d.languages.length) {
          const maxPct = d.languages[0].percent || 100;
          langsEl.innerHTML = d.languages.map((l, i) => {
            const w = (l.percent / maxPct * 100);
            const c = l.color || FALLBACK[i % FALLBACK.length];
            return '<div class="wt-lang"><span class="wt-lang-name"><span class="wt-lang-dot" style="background:' + c + '"></span>' + esc(l.name) + '</span><div class="wt-lang-bar"><div class="wt-lang-fill" style="width:' + w + '%;background:' + c + '"></div></div><span class="wt-lang-pct">' + l.percent + '%</span><span class="wt-lang-time">' + esc(l.time) + '</span></div>';
          }).join('');
        } else {
          langsEl.innerHTML = '<div class="wt-loading">No coding activity in this period.</div>';
        }

        // Editors with progress bars
        if (editorsEl && d.editors && d.editors.length) {
          const maxEPct = d.editors[0].percent || 100;
          editorsEl.innerHTML = d.editors.map(e => {
            const w = (e.percent / maxEPct * 100);
            return '<div class="wt-editor"><span class="wt-editor-name">' + esc(e.name) + '</span><div class="wt-editor-bar"><div class="wt-editor-fill" style="width:' + w + '%"></div></div><span class="wt-editor-pct">' + e.percent + '%</span></div>';
          }).join('');
        } else if (editorsEl) {
          editorsEl.innerHTML = '';
        }

        // Top projects
        if (projectsEl && d.projects && d.projects.length) {
          const maxPPct = d.projects[0].percent || 100;
          projectsEl.innerHTML = d.projects.map(p => {
            const w = (p.percent / maxPPct * 100);
            return '<div class="wt-project"><span class="wt-project-name" title="' + esc(p.name) + '">' + esc(p.name) + '</span><div class="wt-project-bar"><div class="wt-project-fill" style="width:' + w + '%"></div></div><span class="wt-project-time">' + esc(p.time) + '</span></div>';
          }).join('');
        } else if (projectsEl) {
          projectsEl.innerHTML = '';
        }

      }).catch((err) => {
        clearTimeout(wtTimer);
        langsEl.innerHTML = '<div class="wt-loading">Could not load stats. Try a shorter range.</div>';
      });
    }

    // Range selector buttons
    if (rangeSelector) {
      rangeSelector.addEventListener('click', function(e) {
        const btn = e.target.closest('.wt-range-btn');
        if (!btn) return;
        const range = btn.dataset.range;
        rangeSelector.querySelectorAll('.wt-range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loadWakaTime(range);
      });
    }

    // Initial load
    loadWakaTime('7d');
  })();

  /* ============================================================
     29. COMMAND PALETTE (Cmd+K / Ctrl+K)
     ============================================================ */
  (function commandPalette() {
    const overlay = $('cmd-overlay');
    const input = $('cmd-input');
    const results = $('cmd-results');
    const searchToggle = $('cmd-search-toggle');
    const inputBar = $('cmd-input-bar');
    const inputWrap = $('cmd-input-wrap');
    const submitBtn = $('cmd-submit-btn');
    if (!overlay || !input || !results) return;

    let searchExpanded = false;

    function expandSearch() {
      if (searchExpanded) return;
      searchExpanded = true;
      if (inputWrap) inputWrap.classList.add('expanded');
      if (inputBar) inputBar.classList.add('expanded');
      setTimeout(() => input.focus(), 300);
    }

    function collapseSearch() {
      searchExpanded = false;
      if (inputWrap) inputWrap.classList.remove('expanded');
      if (inputBar) inputBar.classList.remove('expanded');
      input.value = '';
    }

    const COMMANDS = [
      { icon: 'home', label: 'Go to Home', hint: 'G', action: () => document.getElementById('hero')?.scrollIntoView({ behavior: 'smooth' }) },
      { icon: 'person', label: 'Go to About', hint: 'A', action: () => document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' }) },
      { icon: 'bolt', label: 'Go to Skills', hint: 'S', action: () => document.getElementById('skills')?.scrollIntoView({ behavior: 'smooth' }) },
      { icon: 'bar_chart', label: 'Go to Contributions', hint: '', action: () => document.getElementById('contributions')?.scrollIntoView({ behavior: 'smooth' }) },
      { icon: 'timer', label: 'Go to Coding Stats', hint: '', action: () => document.getElementById('wakatime')?.scrollIntoView({ behavior: 'smooth' }) },
      { icon: 'folder', label: 'Go to Projects', hint: 'P', action: () => document.getElementById('projects')?.scrollIntoView({ behavior: 'smooth' }) },
      { icon: 'library_music', label: 'Go to Music', hint: '', action: () => document.getElementById('music')?.scrollIntoView({ behavior: 'smooth' }) },
      { icon: 'live_tv', label: 'Go to Anime', hint: '', action: () => document.getElementById('anime')?.scrollIntoView({ behavior: 'smooth' }) },
      { icon: 'interests', label: 'Go to Interests', hint: '', action: () => document.getElementById('interests')?.scrollIntoView({ behavior: 'smooth' }) },
      { icon: 'question_answer', label: 'Go to Ask Me Anything', hint: '', action: () => document.getElementById('ama')?.scrollIntoView({ behavior: 'smooth' }) },
      { icon: 'sports_esports', label: 'Go to Playground', hint: '', action: () => document.getElementById('playground')?.scrollIntoView({ behavior: 'smooth' }) },
      { icon: 'public', label: 'Go to Presence', hint: '', action: () => document.getElementById('presence')?.scrollIntoView({ behavior: 'smooth' }) },
      { icon: 'dark_mode', label: 'Toggle Theme', hint: 'T', action: () => document.getElementById('theme-toggle-btn')?.click() },
      { icon: 'play_arrow', label: 'Play / Pause Music', hint: 'M', action: () => document.getElementById('topbar-music-icon')?.click() },
      { icon: 'arrow_upward', label: 'Scroll to Top', hint: '', action: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
      { icon: 'open_in_new', label: 'Open GitHub Profile', hint: '', action: () => window.open('https://github.com/YatinSharma1303', '_blank') },
      { icon: 'content_copy', label: 'Copy Email Address', hint: '', action: () => document.getElementById('copy-email')?.click() },
      { icon: 'replay', label: 'Toggle Intro Overlay', hint: '', action: () => { const o = document.getElementById('intro-overlay'); if (o) { o.style.display = ''; o.classList.remove('hidden'); } } },
    ];

    let selectedIndex = 0;
    let filtered = COMMANDS.slice();

    function open() {
      overlay.classList.add('open');
      filtered = COMMANDS.slice();
      selectedIndex = 0;
      render();
      // Start collapsed — user clicks search icon to expand
      searchExpanded = false;
      if (inputWrap) inputWrap.classList.remove('expanded');
      if (inputBar) inputBar.classList.remove('expanded');
      input.value = '';
    }
    function close() {
      overlay.classList.remove('open');
      collapseSearch();
    }

    function render() {
      results.innerHTML = filtered.map((cmd, i) => 
        '<div class="cmd-item ' + (i === selectedIndex ? 'selected' : '') + '" data-index="' + i + '">' +
        '<span class="cmd-item-icon material-symbols-outlined">' + cmd.icon + '</span>' +
        '<span class="cmd-item-label">' + highlightMatch(cmd.label, input.value) + '</span>' +
        (cmd.hint ? '<span class="cmd-item-hint">' + cmd.hint + '</span>' : '') +
        '</div>'
      ).join('');
      
      results.querySelectorAll('.cmd-item').forEach(el => {
        el.addEventListener('click', () => { execute(+el.dataset.index); });
        el.addEventListener('mouseenter', () => { selectedIndex = +el.dataset.index; updateSelected(); });
      });
    }

    function highlightMatch(text, query) {
      if (!query) return esc(text);
      const idx = text.toLowerCase().indexOf(query.toLowerCase());
      if (idx === -1) return esc(text);
      return esc(text.slice(0, idx)) + '<mark>' + esc(text.slice(idx, idx + query.length)) + '</mark>' + esc(text.slice(idx + query.length));
    }

    function updateSelected() {
      results.querySelectorAll('.cmd-item').forEach((el, i) => {
        el.classList.toggle('selected', i === selectedIndex);
      });
      const sel = results.querySelector('.cmd-item.selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    }

    function execute(idx) {
      const cmd = filtered[idx];
      if (!cmd) return;
      close();
      setTimeout(() => cmd.action(), 100);
    }

    // Keyboard listeners
    document.addEventListener('keydown', (e) => {
      // Cmd+K / Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (overlay.classList.contains('open')) { close(); } else { open(); }
        return;
      }
      if (!overlay.classList.contains('open')) return;
      
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex = Math.min(filtered.length - 1, selectedIndex + 1); updateSelected(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex = Math.max(0, selectedIndex - 1); updateSelected(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (!searchExpanded) { expandSearch(); return; }
        execute(selectedIndex);
      }
      else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Printable char while collapsed → expand + let input handle it
        if (!searchExpanded) expandSearch();
      }
    });

    // Search filter — auto-expand on first keystroke
    input.addEventListener('input', () => {
      if (!searchExpanded) expandSearch();
      const q = input.value.toLowerCase().trim();
      filtered = q ? COMMANDS.filter(c => c.label.toLowerCase().includes(q)) : COMMANDS.slice();
      selectedIndex = 0;
      render();
    });

    // Click outside to close
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Search toggle: click icon to expand search bar
    if (searchToggle) searchToggle.addEventListener('click', expandSearch);

    // Submit button: trigger search and focus first result
    if (submitBtn) submitBtn.addEventListener('click', () => {
      const q = input.value.toLowerCase().trim();
      filtered = q ? COMMANDS.filter(c => c.label.toLowerCase().includes(q)) : COMMANDS.slice();
      selectedIndex = 0;
      render();
      // Focus the results area so keyboard navigation works
      if (filtered.length) results.querySelector('.cmd-item')?.focus();
    });
  })();



  /* ============================================================
     29. SERVICE WORKER REGISTRATION
     ============================================================ */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

})();
