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
    ytVideoId: 'XtwqzajH_8A', // legacy single-track id (fallback)
    playlist: [
      { id: 'XtwqzajH_8A', title: 'FMA Brotherhood OST', artist: 'Akira Senju' }
      // add more tracks here, e.g. { id: '<youtubeVideoId>', title: 'Title', artist: 'Artist' }
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
      { id: 'red',    name: 'Red',    accent: 'rgba(239,68,68,0.6)',  accent2: 'rgba(220,38,38,0.5)',  swatch: '#ef4444' }
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
  const PLAYLIST = (CONFIG.playlist && CONFIG.playlist.length) ? CONFIG.playlist : [{ id: CONFIG.ytVideoId, title: 'FMA Brotherhood OST', artist: 'Anime OST' }];
  let currentTrack = 0;
  function applyTrackMeta(i) {
    const t = PLAYLIST[i] || PLAYLIST[0];
    const art = 'https://img.youtube.com/vi/' + t.id + '/maxresdefault.jpg';
    ['mp-thumb', 'mp-big-art', 'mp-backdrop', 'tb-art'].forEach(function (id) { const el = $(id); if (el) el.style.backgroundImage = "url('" + art + "')"; });
    const set = function (id, txt) { const el = $(id); if (el) el.textContent = txt; };
    set('mp-title', t.title); set('mp-artist', t.artist); set('mp-big-title', t.title); set('mp-big-artist', t.artist);
    const yt = $('mp-yt'); if (yt) yt.href = 'https://youtu.be/' + t.id;
  }
  applyTrackMeta(0);
  function loadTrack(i) {
    currentTrack = ((i % PLAYLIST.length) + PLAYLIST.length) % PLAYLIST.length;
    applyTrackMeta(currentTrack);
    wantPlay = true;
    if (ytReady) { try { ytPlayer.loadVideoById(PLAYLIST[currentTrack].id); } catch (e) {} }
  }

  function setVisuals(playing) {
    isPlaying = playing;
    if (miniPlayer) miniPlayer.classList.toggle('playing', playing);
    [$('tb-eq-bars'), $('mp-eq'), $('mp-play')].forEach(function (el) { if (el) el.classList.toggle('playing', playing); });
    const tip = $('tb-music-tooltip'); if (tip) tip.textContent = playing ? 'Now playing' : 'Tap to play';
  }

  window.onYouTubeIframeAPIReady = function () {
    if (typeof YT === 'undefined' || !YT.Player) { ytError = true; return; }
    try {
      ytPlayer = new YT.Player('yt-music-iframe', {
        videoId: PLAYLIST[currentTrack].id,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1, rel: 0, iv_load_policy: 3 },
        events: {
          onReady: function () {
            ytReady = true;
            try { ytPlayer.setVolume(70); } catch (e) {}
            if (wantPlay) { try { ytPlayer.playVideo(); } catch (e) {} }
          },
          onStateChange: function (e) {
            if (e.data === 1) { setVisuals(true); progressLoop(); }
            else if (e.data === 2) { setVisuals(false); }
            else if (e.data === 0) {
              if (wantPlay) {
                if (PLAYLIST.length > 1) { loadTrack(currentTrack + 1); }
                else { try { ytPlayer.seekTo(0); ytPlayer.playVideo(); } catch (er) {} }
              }
              else setVisuals(false);
            }
          },
          onError: function (e) { ytError = true; setVisuals(false); console.warn('YouTube player error:', e.data); }
        }
      });
    } catch (err) { ytError = true; console.warn('YT.Player init failed:', err); }
  };
  const tag = document.createElement('script'); tag.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(tag);
  setTimeout(function () { if (!ytReady && !ytError) { ytError = true; } }, 8000);

  function doPlay() {
    if (ytError) return;
    wantPlay = true;
    if (!ytReady) { setVisuals(true); return; }
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
      const ct = $('mp-cur'), dt = $('mp-dur'), fl = $('mp-seek-fill');
      if (ct) ct.textContent = fmt(cur); if (dt) dt.textContent = fmt(dur);
      if (fl) fl.style.width = (dur ? (cur / dur * 100) : 0) + '%';
      loopId = requestAnimationFrame(step);
    })();
  }

  function openPlayer() {
    if (miniPlayer) { miniPlayer.classList.add('open'); miniPlayer.setAttribute('aria-hidden', 'false'); }
    // Do NOT auto-play on open — playback should only start when the user
    // explicitly presses play. Auto-playing here caused the YouTube video to
    // start just from opening the widget, which external Last.fm scrobblers
    // (browser extensions / YouTube links) would then pick up and scrobble.
  }
  function closePlayer() {
    if (miniPlayer) { miniPlayer.classList.remove('open', 'expanded'); miniPlayer.setAttribute('aria-hidden', 'true'); }
  }
  if (musicWidget) musicWidget.addEventListener('click', openPlayer);
  const mpClose = $('mp-close'); if (mpClose) mpClose.addEventListener('click', closePlayer);
  const mpPlay = $('mp-play'); if (mpPlay) mpPlay.addEventListener('click', togglePlay);
  const mpVol = $('mp-vol'), mpVolIcon = $('mp-vol-icon');
  function updateVolIcon(v) { var n = Number(v); if (mpVolIcon) mpVolIcon.textContent = (n === 0) ? 'volume_off' : (n < 50 ? 'volume_down' : 'volume_up'); }
  if (mpVol) mpVol.addEventListener('input', function (e) { var v = e.target.value; setVolume(v); updateVolIcon(v); });
  const mpExpand = $('mp-expand'); if (mpExpand) mpExpand.addEventListener('click', function () { if (miniPlayer) miniPlayer.classList.toggle('expanded'); });
  const mpPrev = $('mp-prev'), mpNext = $('mp-next');
  if (mpPrev) mpPrev.addEventListener('click', function () { loadTrack(currentTrack - 1); });
  if (mpNext) mpNext.addEventListener('click', function () { loadTrack(currentTrack + 1); });
  if (PLAYLIST.length < 2) { if (mpPrev) mpPrev.style.display = 'none'; if (mpNext) mpNext.style.display = 'none'; }
  // Seek bar (click + drag).
  const seekBar = $('mp-seek-bar');
  if (seekBar) {
    let dragging = false;
    function seekTo(clientX) {
      if (!ytReady) return;
      const r = seekBar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      try { ytPlayer.seekTo(ratio * (ytPlayer.getDuration() || 0), true); } catch (e) {}
      const fl = $('mp-seek-fill'); if (fl) fl.style.width = (ratio * 100) + '%';
    }
    seekBar.addEventListener('mousedown', function (e) { dragging = true; seekTo(e.clientX); });
    window.addEventListener('mousemove', function (e) { if (dragging) seekTo(e.clientX); });
    window.addEventListener('mouseup', function () { dragging = false; });
    seekBar.addEventListener('touchstart', function (e) { seekTo(e.touches[0].clientX); }, { passive: true });
    seekBar.addEventListener('touchmove', function (e) { seekTo(e.touches[0].clientX); }, { passive: true });
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
    function render(cat) {
      const items = cat === 'ALL' ? SKILLS : SKILLS.filter(s => s.cat === cat);
      $('skill-count').textContent = items.length + ' skills';
      list.innerHTML = items.map(s => `<div class="skill-item"><div class="skill-item-head"><span class="skill-item-icon material-symbols-outlined">${s.icon}</span><span class="skill-item-name">${s.name}</span><span class="skill-item-cat">${s.cat}</span></div><div class="skill-item-desc">${s.desc}</div></div>`).join('');
    }
    render('ALL');
    if (tabs) tabs.addEventListener('click', (e) => { const t = e.target.closest('.skill-tab'); if (!t) return; tabs.querySelectorAll('.skill-tab').forEach(b => b.classList.remove('active')); t.classList.add('active'); render(t.dataset.cat); });
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
        '<div class="project-cat">' + p.cat + '</div>' +
        '<div class="project-name">' + p.name + '</div>' +
        '<div class="project-desc">' + p.desc + '</div>' +
        '<div class="project-tags">' + p.tags.map(t => '<span>' + t + '</span>').join('') + '</div>' +
        '<div class="project-actions">' +
        '<a class="project-dl-btn" href="' + p.repo + '" target="_blank" rel="noopener">Source</a>' +
        (p.live ? '<a class="project-live-btn" href="' + p.live + '" target="_blank" rel="noopener">Live Demo</a>' : '') +
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

    function renderBundle(d) {
      if (!d) return;
      const user = d.user;
      if (user) {
        const av = $('lfm-avatar');
        if (av) { const url = lfmImg(user.image); if (url) av.src = url; }
        const strip = $('lfm-statstrip');
        if (strip) strip.textContent = `${(user.playcount||0).toLocaleString()} scrobbles · ${(user.artist_count||0).toLocaleString()} artists · ${(user.album_count||0).toLocaleString()} albums`;
      }

      const tracksWrap = $('lfm-tracks');
      const tracks = (d.toptracks && d.toptracks.track) || [];
      if (tracksWrap && tracks.length) {
        tracksWrap.innerHTML = tracks.map((tr, idx) => {
          const url = tr.artUrl || lfmImg(tr.image);
          const art = url
            ? '<div class="lfm-track-img" style="background:#141414 url(\'' + url + '\') center/cover no-repeat"></div>'
            : '<div class="lfm-track-img lfm-noart" style="background:#141414 !important">♪</div>';
          return '<div class="lfm-track"><span class="lfm-track-rank">' + (idx+1) + '</span>' + art + '<div class="lfm-track-info"><div class="lfm-track-name">' + esc(tr.name) + '</div><div class="lfm-track-artist">' + (tr.artist ? esc(tr.artist.name || tr.artist['#text'] || '') : '') + '</div></div><span class="lfm-track-plays">' + (tr.playcount||0) + 'x</span></div>';
        }).join('');
      }

      const artistsWrap = $('lfm-artists');
      const artists = (d.topartists && d.topartists.artist) || [];
      if (artistsWrap && artists.length) {
        artistsWrap.innerHTML = artists.map((ar, idx) => {
          const url = ar.artUrl || lfmImg(ar.image);
          const art = url ? '<div class="lfm-artist-img" style="background:#141414 url(\'' + url + '\') center/cover no-repeat"></div>' : artistFallback(ar.name, idx);
          return '<div class="lfm-artist">' + art + '<span class="lfm-artist-name">' + esc(ar.name) + '</span><span class="lfm-artist-plays">' + (ar.playcount||0) + 'x</span></div>';
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

    function renderRecent(recenttracks) {
      const tracks = (recenttracks && recenttracks.track) || [];
      if (!tracks.length) return;
      const first = tracks[0];
      const isLive = first['@attr'] && first['@attr'].nowplaying === 'true';
      const npArtEl = $('lfm-np-art');
      if (npArtEl) {
        const url = recentTrackArt(first);
        if (url) { npArtEl.style.cssText = 'background:#141414 url(\'' + url + '\') center/cover no-repeat'; npArtEl.classList.remove('lfm-noart'); npArtEl.textContent = ''; }
        else { npArtEl.style.cssText = 'background:#141414'; npArtEl.classList.add('lfm-noart'); npArtEl.textContent = '♪'; }
        npArtEl.style.visibility = 'visible';
      }
      const npTrack = $('lfm-np-track'); if (npTrack) npTrack.textContent = first.name || '—';
      const npArtist = $('lfm-np-artist'); if (npArtist) npArtist.textContent = (first.artist && (first.artist['#text'] || first.artist.name)) || '—';
      const npCard = $('lfm-nowplaying'); if (npCard) npCard.classList.toggle('live', !!isLive);
      const npLabel = $('lfm-np-label'); if (npLabel) npLabel.textContent = isLive ? 'NOW PLAYING' : 'LAST PLAYED';
      const recentWrap = $('lfm-recent');
      if (recentWrap) {
        const tickerTracks = isLive ? tracks.slice(1, 9) : tracks.slice(0, 9);
        recentWrap.innerHTML = tickerTracks.map(tr => {
          const name = esc(tr.name || '—');
          const artist = esc((tr.artist && (tr.artist['#text'] || tr.artist.name)) || '');
          return '<div class="lfm-recent-item">' + artDiv('lfm-recent-img', recentTrackArt(tr), '♪') + '<div class="lfm-recent-info"><div class="lfm-recent-name">' + name + '</div><div class="lfm-recent-artist">' + artist + '</div></div></div>';
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
    const favSets = { ANIME: new Set(), MANGA: new Set() };
    const statsByMedia = { ANIME: null, MANGA: null };
    let favSet = favSets.ANIME, statsData = null;
    const PER_PAGE = 6;
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
    const unitShort = () => isManga() ? 'ch' : 'eps';
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
          '</div>';
        list.parentNode.insertBefore(controlsBar, list);
        const si = controlsBar.querySelector('#al-search'), sc = controlsBar.querySelector('#al-search-clear');
        Widgets.bindSearch({ input: si, clear: sc, onChange: (v) => { activeSearch = v; page = 1; render(); } });
        Widgets.bindPills({ container: controlsBar.querySelector('#al-sort'), selector: '.al-sort-btn', attr: 'sort', onSelect: (v) => { activeSort = v; page = 1; render(); } });
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
    function loadFallbackAnime() {
      datasets.ANIME = [
        { _status: 'CURRENT', progress: 52, score: 0, updatedAt: Date.now()/1000, media: { title: { romaji: 'NARUTO', english: 'Naruto' }, coverImage: { large: '' }, episodes: 220, duration: 23, genres: ['Action', 'Adventure'], format: 'TV' } },
        { _status: 'COMPLETED', progress: 64, score: 0, updatedAt: Date.now()/1000 - 10, media: { title: { romaji: 'Hagane no Renkinjutsushi: FULLMETAL ALCHEMIST', english: 'Fullmetal Alchemist: Brotherhood' }, coverImage: { large: '' }, episodes: 64, duration: 25, genres: ['Action', 'Adventure', 'Drama'], format: 'TV' } },
        { _status: 'COMPLETED', progress: 37, score: 0, updatedAt: Date.now()/1000 - 20, media: { title: { romaji: 'DEATH NOTE', english: 'Death Note' }, coverImage: { large: '' }, episodes: 37, duration: 23, genres: ['Mystery', 'Psychological', 'Thriller'], format: 'TV' } }
      ];
      loaded.ANIME = true;
      if (activeMedia === 'ANIME') { allEntries = datasets.ANIME; refreshAll(); }
    }

    function buildListQuery(type) {
      const progressFields = type === 'MANGA' ? 'chapters volumes' : 'episodes duration';
      return `query{user:MediaListCollection(userName:"${CONFIG.anilistUser}",type:${type}){lists{name status entries{media{id title{romaji english}coverImage{extraLarge large medium}${progressFields} meanScore genres format description(asHtml:false)}score progress updatedAt}}}}`;
    }
    // Fetch a media list (anime or manga) on demand. Anime falls back to a local list on failure.
    function loadMedia(type) {
      if (loaded[type] || loading[type]) return;
      loading[type] = true;
      fetch('https://graphql.anilist.co?_=' + Date.now(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: buildListQuery(type) }) })
        .then(r => { if (!r.ok) throw new Error('AniList HTTP ' + r.status); return r.json(); }).then(d => {
          if (d.errors) throw new Error(d.errors[0]?.message || 'AniList GraphQL error');
          const lists = (d.data && d.data.user && d.data.user.lists) || [];
          const entries = [];
          lists.forEach(l => (l.entries || []).forEach(e => { if (e && e.media) { e._status = l.status; entries.push(e); } }));
          if (!entries.length) throw new Error('AniList list empty');
          datasets[type] = entries; loaded[type] = true; loading[type] = false;
          if (activeMedia === type) { allEntries = datasets[type]; refreshAll(); }
        }).catch((err) => {
          loading[type] = false;
          console.warn('AniList ' + type + ' load failed:', err);
          if (type === 'ANIME') loadFallbackAnime();
          else if (activeMedia === 'MANGA') { list.innerHTML = '<div class="al-empty">Couldn’t load manga list right now.</div>'; }
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
      const sub = $('al-sub'); if (sub) sub.textContent = 'AniList · ' + (isManga() ? 'manga list' : 'anime list');
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
      return fetch('https://graphql.anilist.co?_=' + Date.now(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: userQuery }) })
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
    function refresh() {
      if (refreshing) return;
      refreshing = true;
      const btn = $('al-refresh');
      if (btn) btn.classList.add('ama-refresh-spin');
      const type = activeMedia;
      loaded[type] = false; loading[type] = false;
      loadMedia(type);   // re-fetches the active list; refreshAll() runs on success
      loadUserMeta();    // refresh avatar / favourites / stats
      setTimeout(() => { if (btn) btn.classList.remove('ama-refresh-spin'); refreshing = false; }, 700);
    }
    const alRefreshBtn = $('al-refresh');
    if (alRefreshBtn) alRefreshBtn.addEventListener('click', refresh);
    function renderStats() {
      ensureChrome();
      let count, mean, genres, numbers;
      if (isManga()) {
        let chapters, volumes;
        if (statsData) {
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
        if (!count) { statsPanel.innerHTML = ''; return; }
        numbers = '<div class="al-stat-nums">' +
          '<span><b>' + count.toLocaleString() + '</b> manga</span>' +
          '<span><b>' + chapters.toLocaleString() + '</b> chapters</span>' +
          (volumes ? '<span><b>' + volumes.toLocaleString() + '</b> volumes</span>' : '') +
          (mean ? '<span><b>' + (mean / 10).toFixed(1) + '</b> mean score</span>' : '') +
        '</div>';
      } else {
        let eps, mins;
        if (statsData) {
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
        if (!count) { statsPanel.innerHTML = ''; return; }
        const days = (mins / 1440).toFixed(1);
        numbers = '<div class="al-stat-nums">' +
          '<span><b>' + count.toLocaleString() + '</b> anime</span>' +
          '<span><b>' + eps.toLocaleString() + '</b> episodes</span>' +
          '<span><b>' + days + '</b> days watched</span>' +
          (mean ? '<span><b>' + (mean / 10).toFixed(1) + '</b> mean score</span>' : '') +
        '</div>';
      }
      const topG = genres.slice().sort((a, b) => b.count - a.count).slice(0, 5);
      const maxC = topG.length ? topG[0].count : 1;
      const bars = topG.length ? '<div class="al-stat-genres">' + topG.map(g =>
        '<div class="al-stat-genre"><span class="al-sg-name">' + esc(g.genre) + '</span>' +
        '<div class="al-sg-bar"><i style="width:' + Math.max(6, Math.round(g.count / maxC * 100)) + '%"></i></div>' +
        '<span class="al-sg-count">' + g.count + '</span></div>').join('') + '</div>' : '';
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
      return (img ? '<img class="al-banner-img" alt="' + esc(t) + '" src="' + img + '">' : '') + '<div class="al-banner-info"><div class="al-banner-label" data-status="' + statusRaw.toLowerCase() + '">' + label + '</div><div class="al-banner-title">' + esc(t) + '</div><div class="al-banner-progress">' + esc(progress + score) + '</div></div>';
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
    function render() {
      ensureChrome();
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
        list.innerHTML = '<div class="al-empty">No ' + (isManga() ? 'manga' : 'anime') + ' found' + (activeSearch ? ' for “' + esc(activeSearch) + '”' : '') + '.</div>';
        renderPager(pages);
        return;
      }
      list.innerHTML = slice.map(e => {
        const m = e.media || {};
        const t = (m.title && (m.title.romaji || m.title.english)) || '—';
        const img = (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large || m.coverImage.medium)) || '';
        const st = String(e._status || '').toUpperCase();
        const eps = totalUnits(m);
        const prog = e.progress || 0;
        const progText = prog ? prog + (eps ? '/' + eps : '') + ' ' + unitShort() : (st === 'COMPLETED' ? 'completed' : '');
        const userScore = e.score ? '★ ' + e.score : '';
        const mean = m.meanScore || 0;
        const meanText = mean ? 'avg ' + (mean / 10).toFixed(1) : '';
        const scoreLine = [progText, userScore, meanText].filter(Boolean).join(' · ');
        const pct = eps ? Math.min(100, Math.round(prog / eps * 100)) : (st === 'COMPLETED' ? 100 : 0);
        const showBar = (eps && prog) || st === 'COMPLETED';
        const isFav = favSet.has(m.id);
        const genres = (m.genres || []).slice(0, 3);
        const desc = m.description ? esc(String(m.description).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 180) : '';
        const fmt = m.format ? String(m.format).replace(/_/g, ' ') : '';
        const overlay = (genres.length || desc || fmt) ?
          '<div class="al-item-overlay">' +
            (fmt ? '<div class="al-ov-fmt">' + esc(fmt) + '</div>' : '') +
            (genres.length ? '<div class="al-ov-genres">' + genres.map(g => '<span>' + esc(g) + '</span>').join('') + '</div>' : '') +
            (desc ? '<div class="al-ov-desc">' + desc + '…</div>' : '') +
          '</div>' : '';
        return '<div class="al-item">' +
          '<div class="al-item-cover">' +
            (img ? '<img src="' + img + '" alt="' + esc(t) + '" loading="lazy">' : '') +
            (isFav ? '<span class="al-fav" title="Favourite">♥</span>' : '') +
            overlay +
          '</div>' +
          '<div class="al-item-info">' +
            '<div class="al-item-name">' + esc(t) + '</div>' +
            '<div class="al-item-score ' + scoreClass(mean) + '">' + esc(scoreLine) + '</div>' +
            (showBar ? '<div class="al-item-bar"><i style="width:' + pct + '%"></i></div>' : '') +
          '</div>' +
        '</div>';
      }).join('');
      renderPager(pages);
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
    let dots = [], w, h;
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
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < 120) { ctx.strokeStyle = 'rgba(' + rgb + ',' + (lineOpacity * (1 - dist/120)) + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(dots[i].x, dots[i].y); ctx.lineTo(dots[j].x, dots[j].y); ctx.stroke(); }
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

    const nameInput = $('ama-name-input');
    let nameTouched = false;
    try { localStorage.removeItem('yatin_ama_name'); } catch (e) {}
    if (nameInput) {
      nameInput.value = '';
      nameInput.setAttribute('autocomplete', 'off');
      nameInput.addEventListener('input', () => { nameTouched = true; });
    }

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
          featured.innerHTML = amaQuestionCard(spotlightDoc, { featured: true, activeSpotlight: true });
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
        ? slice.map(q => amaQuestionCard(q, { activeSpotlight: q.id === activeSpotlightId && (searching || !featured) })).join('')
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
      if (!text) { status.textContent = 'Please type a question first.'; status.className = 'ama-status err'; return; }
      if (todayCount >= CONFIG.amaLimit) { status.textContent = 'Daily limit reached.'; status.className = 'ama-status err'; return; }
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
      status.textContent = 'Sending…'; status.className = 'ama-status';
      const notify = () => fetch('/api/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, question: text, id, createdAt, topic: autoTopic }) }).catch(() => {});
      const afterSubmit = (ok) => {
        todayCount++; localStorage.setItem(LIMIT_KEY, JSON.stringify({ date: today, count: todayCount })); countEl.textContent = todayCount; input.value = '';
        if (nameInput) nameInput.value = '';
        nameTouched = false;
        try { localStorage.removeItem('yatin_ama_name'); } catch (e) {}
        if (ok) {
          status.textContent = '✅ Sent! Yatin will reply soon — check back here.';
          if (window.unlockAchievement) window.unlockAchievement('asked', 'Inquisitive Mind', 'Asked a question!');
        } else {
          status.textContent = 'Could not send. Try again later.';
        }
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
    // Sort pills + search box share the same widgets as the AniList section (see Widgets, item 62).
    Widgets.bindPills({ container: sortWrap, selector: '.ama-sort-btn', attr: 'sort', onSelect: (v) => { activeSort = v; page = 1; render(); } });
    /* Search box — filter answered questions by question, answer, topic or name */
    Widgets.bindSearch({ input: searchInput, clear: searchClear, onChange: (v) => { activeSearch = v; page = 1; render(); } });

    /* Refresh button — manual reload of answered questions */
    const refreshBtn = $('ama-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', () => {
      refreshBtn.classList.add('ama-refresh-spin');
      loadAnswered();
      setTimeout(() => refreshBtn.classList.remove('ama-refresh-spin'), 600);
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

  // E. Card Cursor Tracking Glow
  (function cardGlow() {
    document.querySelectorAll('.glass-card').forEach(card => {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        card.style.setProperty('--card-glow', 'color-mix(in srgb, var(--accent-solid) 10%, transparent)');
        card.style.setProperty('--mouse-x', x + 'px');
        card.style.setProperty('--mouse-y', y + 'px');
        // Update the radial gradient position dynamically
        card.querySelector('::before'); // force style recalc
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
    if (!fab || !panel || !form) return;
    const history = [];
    let busy = false, greeted = false;

    function bubble(role, text) {
      const el = document.createElement('div');
      el.className = 'pchat-msg pchat-' + role;
      el.textContent = text;
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      return el;
    }
    function typingBubble() {
      const el = document.createElement('div');
      el.className = 'pchat-msg pchat-bot pchat-typing';
      el.innerHTML = '<span></span><span></span><span></span>';
      log.appendChild(el); log.scrollTop = log.scrollHeight;
      return el;
    }
    function open() {
      panel.hidden = false;
      requestAnimationFrame(() => panel.classList.add('open'));
      fab.classList.add('hidden');
      if (!greeted) {
        greeted = true;
        bubble('bot', 'Hi! I can answer questions about Yatin — his projects, skills, and background. What would you like to know?');
      }
      setTimeout(() => inputEl.focus(), 120);
    }
    function close() {
      panel.classList.remove('open');
      fab.classList.remove('hidden');
      setTimeout(() => { panel.hidden = true; }, 220);
    }
    fab.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });

    async function ask(message) {
      if (busy) return;
      busy = true; sendBtn.disabled = true;
      bubble('user', message);
      history.push({ role: 'user', content: message });
      const typing = typingBubble();
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, history: history.slice(0, -1), ama: window.__amaContext || [] })
        });
        const data = await res.json().catch(() => ({}));
        typing.remove();
        const reply = (data && data.reply) || 'Sorry, I couldn’t answer that right now.';
        bubble('bot', reply);
        history.push({ role: 'assistant', content: reply });
      } catch (e) {
        typing.remove();
        bubble('bot', 'Couldn’t reach the assistant. Please try again in a moment.');
      } finally {
        busy = false; sendBtn.disabled = false; inputEl.focus();
      }
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const msg = inputEl.value.trim();
      if (!msg || busy) return;
      inputEl.value = '';
      ask(msg);
    });
    if (window.unlockAchievement) fab.addEventListener('click', () => window.unlockAchievement('askbot', 'Curious', 'Opened the portfolio assistant.'), { once: true });
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
      if (glow) { glow.style.left = mx + 'px'; glow.style.top = my + 'px'; }
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
     25. SECTION DIVIDERS
     ============================================================ */
  (function sectionDividers() {
    const sections = document.querySelectorAll('.section, .hero');
    const labels = { hero: '00', about: '01', skills: '02', contributions: '03', coding: '04', projects: '05', music: '06', anime: '07', interests: '08', ama: '09', playground: '10', presence: '11' };
    for (let i = 1; i < sections.length; i++) {
      const prev = sections[i - 1]; const cur = sections[i];
      const lbl = labels[cur.id];
      if (!lbl) continue;
      const div = document.createElement('div');
      div.className = 'section-divider fade-in';
      div.innerHTML = '<div class="section-divider-line"></div><span class="section-divider-label">' + lbl + ' / ' + (cur.querySelector('.section-title')?.textContent || cur.id) + '</span><div class="section-divider-line"></div>';
      cur.parentNode.insertBefore(div, cur);
    }
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
    }, { threshold: 0.3 });
    document.querySelectorAll('.section-divider').forEach(d => obs.observe(d));
  })();

  /* ============================================================
     26. GITHUB CONTRIBUTION GRAPH
     ============================================================ */
  (function contributions() {
    const grid = $('contrib-grid'); if (!grid) return;
    const totalEl = $('contrib-total');
    const tip = $('contrib-tip');

    // Custom tooltip handlers
    function showTip(e) {
      const day = e.target.closest('.contrib-day');
      if (!day || !tip) return;
      const date = day.dataset.date;
      const level = day.dataset.level;
      const count = level === '0' ? 'No' : level;
      tip.innerHTML = '<span class="contrib-tip-date">' + esc(date) + '</span> · <span class="contrib-tip-count">' + count + ' contribution' + (level === '1' ? '' : 's') + '</span>';
      tip.classList.add('visible');
      positionTip(e);
    }
    function moveTip(e) {
      positionTip(e);
    }
    function hideTip() {
      if (tip) tip.classList.remove('visible');
    }
    function positionTip(e) {
      if (!tip) return;
      const x = e.clientX;
      const y = e.clientY;
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      const left = Math.min(x + 12, window.innerWidth - tw - 12);
      const top = y - th - 12;
      tip.style.left = left + 'px';
      tip.style.top = Math.max(4, top) + 'px';
    }

    fetch('/api/contributions?user=' + CONFIG.githubUser)
      .then(r => r.json())
      .then(d => {
        if (d.error || !d.days) { grid.innerHTML = '<div class="contrib-loading">Could not load (GitHub may be rate-limited).</div>'; return; }
        if (totalEl) totalEl.textContent = (d.total || d.days.filter(x => x.level > 0).length).toLocaleString();
        // Group days into weeks (columns).
        const weeks = [];
        let week = [];
        d.days.forEach(day => { week.push(day); if (week.length === 7) { weeks.push(week); week = []; } });
        if (week.length) weeks.push(week);
        grid.innerHTML = weeks.map(w => '<div class="contrib-week">' + w.map(day => '<div class="contrib-day" data-level="' + day.level + '" data-date="' + day.date + '"></div>').join('') + '</div>').join('');
        // Wire custom tooltip (no native title)
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
    const COLORS = ['#00c8ff','#7850ff','#00f0b4','#f59e0b','#ef4444','#a855f7'];
    fetch('/api/wakatime').then(r => r.json()).then(d => {
      if (d.error) { 
        langsEl.innerHTML = '<div class="wt-loading">' + esc(d.error) + '</div>';
        return; 
      }
      if (totalEl) totalEl.textContent = d.total || '—';
      if (dailyEl) dailyEl.textContent = 'avg ' + (d.daily || '') + '/day';
      if (d.languages && d.languages.length) {
        const maxPct = d.languages[0].percent || 100;
        langsEl.innerHTML = d.languages.map((l, i) => {
          const w = (l.percent / maxPct * 100);
          const c = COLORS[i % COLORS.length];
          return '<div class="wt-lang"><span class="wt-lang-name">' + esc(l.name) + '</span><div class="wt-lang-bar"><div class="wt-lang-fill" style="width:' + w + '%;background:' + c + '"></div></div><span class="wt-lang-time">' + esc(l.time) + '</span></div>';
        }).join('');
      } else {
        // Clear the "setup api key" text if the API is working but there's no data yet
        langsEl.innerHTML = '<div class="wt-loading">No coding activity in the last 7 days. Start coding!</div>';
      }
      if (editorsEl && d.editors && d.editors.length) {
        editorsEl.innerHTML = d.editors.map(e => '<span class="wt-editor-pill">' + esc(e) + '</span>').join('');
      } else {
        editorsEl.innerHTML = ''; // clear empty editors
      }
    }).catch(() => { langsEl.innerHTML = '<div class="wt-loading">Could not load stats.</div>'; });
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
