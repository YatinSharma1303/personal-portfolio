/* ============================================================
   YATIN SHARMA — PORTFOLIO · games.js
   Playground: 6 playable mini-games in a full-screen overlay.
   Loaded after script.js. Exposes window.YatinPlayground.
   ============================================================ */
(function () {
  'use strict';

  const GAMES = [
    { id: 'snake',        icon: '♞', name: 'Snake',        desc: 'Classic game. High chance of self-sabotage.' },
    { id: 'pong',         icon: '◉', name: 'Ping Pong',    desc: 'You vs an AI paddle. First to 5 wins.' },
    { id: 'flappy',       icon: '⌁', name: 'Flappy',       desc: 'Infuriating physics. Avoid the pipes.' },
    { id: 'mines',        icon: '⚑', name: 'Minesweeper',  desc: 'Classic logic. Avoid the mines.' },
    { id: 'reaction',     icon: '◌', name: 'Reaction Test',desc: 'Click when it turns green.' },
    { id: 'dodge',        icon: '⌖', name: 'Dodge',        desc: 'Survive against angry geometry.' }
  ];

  /* ── DOM shell ── */
  let overlay = null, host = null, current = null, rafId = null;

  function ensureShell() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'pg-overlay';
    overlay.innerHTML = `
      <div class="pg-topbar">
        <button class="pg-close" id="pg-close" aria-label="Close">✕</button>
        <button class="sound-toggle" id="pg-sound-toggle" title="Toggle sound">🔊</button>
        <div class="pg-title" id="pg-title">playground</div>
        <div class="pg-score" id="pg-score"></div>
      </div>
      <div class="pg-host" id="pg-host"></div>
    `;
    document.body.appendChild(overlay);
    host = overlay.querySelector('#pg-host');
    overlay.querySelector('#pg-close').addEventListener('click', close);
    const soundBtn = overlay.querySelector('#pg-sound-toggle');
    if (soundBtn) {
      try { if (window.sfx && window.sfx.isMuted()) soundBtn.classList.add('muted'); soundBtn.textContent = (window.sfx && window.sfx.isMuted()) ? '🔇' : '🔊'; } catch (e) {}
      soundBtn.addEventListener('click', function () {
        try { const m = window.sfx.toggle(); soundBtn.classList.toggle('muted', m); soundBtn.textContent = m ? '🔇' : '🔊'; } catch (e) {}
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) {
        // J. GAME PAUSE ON ESCAPE
        if (current && stopLoop) {
          // If game is running, pause it instead of closing
          if (!overlay.classList.contains('paused')) {
            overlay.classList.add('paused');
            stopLoop();
            // Show pause overlay
            if (!document.getElementById('pg-pause-screen')) {
              const pauseScreen = document.createElement('div');
              pauseScreen.id = 'pg-pause-screen';
              pauseScreen.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;z-index:100;';
              pauseScreen.innerHTML = '<h2 style="font-size:32px;font-weight:800;">Paused</h2><p style="font-family:monospace;font-size:12px;color:var(--gray);">Press ESC to resume</p>';
              host.appendChild(pauseScreen);
            } else {
              document.getElementById('pg-pause-screen').style.display = 'flex';
            }
          } else {
            // Resume
            overlay.classList.remove('paused');
            const ps = document.getElementById('pg-pause-screen');
            if (ps) ps.style.display = 'none';
            // Restart loop for the current game
            const runner = RUNNERS[current];
            if (runner) runner(host, overlay); // Re-run to restart loop
          }
        } else {
          close();
        }
      }
    });
  }

  let currentDifficulty = 'Medium';

  function getDifficulty() {
    const activeBtn = document.querySelector('.diff-btn.active');
    if (activeBtn) currentDifficulty = activeBtn.dataset.diff;
    return currentDifficulty;
  }

  function open(gameId) {
    ensureShell();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    const g = GAMES.find(x => x.id === gameId) || GAMES[0];
    overlay.querySelector('#pg-title').textContent = g.name;
    overlay.querySelector('#pg-score').textContent = '';
    host.innerHTML = '';
    stopLoop();
    current = g.id;
    
    // K. Difficulty selector for supported games
    if (['snake', 'dodge'].includes(current)) {
      const diffWrap = document.createElement('div');
      diffWrap.className = 'diff-selector';
      ['Easy', 'Medium', 'Hard'].forEach(d => {
        const btn = document.createElement('button');
        btn.className = 'diff-btn ' + (d === 'Medium' ? 'active' : '');
        btn.textContent = d;
        btn.dataset.diff = d;
        btn.addEventListener('click', () => {
          diffWrap.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
        diffWrap.appendChild(btn);
      });
      host.appendChild(diffWrap);
    }

    if (window.unlockAchievement) window.unlockAchievement('gamer', 'Let\'s Play!', 'Opened the playground.');
    const runner = RUNNERS[g.id];
    if (runner) runner(host, overlay);
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    stopLoop();
    host.innerHTML = '';
    current = null;
  }

  function stopLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
  function loop(fn) {
    stopLoop();
    let last = performance.now();
    function step(t) {
      const dt = Math.min(50, t - last); last = t;
      if (overlay && overlay.classList.contains('open') && current) { fn(dt, t); rafId = requestAnimationFrame(step); }
      else stopLoop();
    }
    rafId = requestAnimationFrame(step);
  }
  function setScore(s) { const el = overlay.querySelector('#pg-score'); if (el) el.textContent = s; }
  function canvasHost(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h; c.className = 'pg-canvas';
    host.appendChild(c);
    return c;
  }
  function button(label, onClick) {
    const b = document.createElement('button');
    b.className = 'pg-btn'; b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }
  const rand = (a, b) => Math.random() * (b - a) + a;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // High-score persistence (localStorage). Keyed per-game.
  function bestScore(gameId) { return parseInt(localStorage.getItem('pg_best_' + gameId) || '0', 10) || 0; }
  function saveBest(gameId, val) {
    const cur = bestScore(gameId);
    if (val > cur) { localStorage.setItem('pg_best_' + gameId, String(val)); return true; }
    return false;
  }

  /* ============================================================
     1. SNAKE  (keyboard + swipe + on-screen D-pad; no 180 reversal)
     ============================================================ */
  function snake(host) {
    const COLS = 22, ROWS = 22, CELL = 24;
    const W = COLS * CELL, H = ROWS * CELL;
    const c = canvasHost(W, H); const ctx = c.getContext('2d');
    let snake, dir, nextDir, food, score, alive, tick, acc = 0, dirLocked = false;

    function reset() {
      snake = [{x:10,y:10},{x:9,y:10},{x:8,y:10}];
      const diff = getDifficulty();
      const speedMap = { Easy: 160, Medium: 120, Hard: 80 };
      dir = {x:1,y:0}; nextDir = {x:1,y:0}; score = 0; alive = true; tick = speedMap[diff] || 120; acc = 0; dirLocked = false;
      placeFood(); setScore('Score: 0  Best: ' + bestScore('snake'));
    }
    function placeFood() {
      let p;
      do { p = {x:Math.floor(rand(0,COLS)), y:Math.floor(rand(0,ROWS))}; }
      while (snake.some(s => s.x===p.x && s.y===p.y));
      food = p;
    }
    // Single direction handler used by keyboard, swipe AND d-pad.
    function setDir(nx, ny) {
      if (dirLocked || !alive) return;
      if (nx === -dir.x && ny === -dir.y) return; // reject 180 reversal
      nextDir = { x: nx, y: ny }; dirLocked = true;
    }
    function step() {
      dir = nextDir; dirLocked = false;
      const head = { x: snake[0].x+dir.x, y: snake[0].y+dir.y };
      if (head.x<0 || head.y<0 || head.x>=COLS || head.y>=ROWS || snake.some(s => s.x===head.x && s.y===head.y)) {
        alive = false; return;
      }
      snake.unshift(head);
      if (head.x===food.x && head.y===food.y) {
        score++; try{window.sfx.blip();}catch(e){} setScore('Score: '+score+'  Best: '+bestScore('snake')); placeFood();
        if (tick > 65) tick -= 4;
      } else { snake.pop(); }
    }
    function draw() {
      ctx.fillStyle = '#0a0a0e'; ctx.fillRect(0,0,W,H);
      ctx.fillStyle = '#34d399';
      ctx.beginPath(); ctx.arc(food.x*CELL+CELL/2, food.y*CELL+CELL/2, CELL/2.6, 0, 7); ctx.fill();
      snake.forEach((s,i) => {
        ctx.fillStyle = i===0 ? '#fff' : 'rgba(255,255,255,'+Math.max(0.3, 0.9-i*0.04)+')';
        ctx.fillRect(s.x*CELL+2, s.y*CELL+2, CELL-4, CELL-4);
      });
      if (!alive) { try{window.haptic(40);}catch(e){} saveBest('snake', score);
        ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0,0,W,H);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        ctx.font = 'bold 30px Inter, sans-serif'; ctx.fillText('Game Over', W/2, H/2-10);
        ctx.font = '15px JetBrains Mono, monospace'; ctx.fillText('Score: '+score+'  Best: ' + bestScore('snake'), W/2, H/2+22);
      }
    }
    reset(); draw();
    host.appendChild(button('Restart', reset));

    // Hint text.
    const hint = document.createElement('div');
    hint.style.cssText = 'font-family:JetBrains Mono,monospace;font-size:12px;color:#71717a;text-align:center;margin-top:4px;';
    hint.textContent = 'Arrow keys - swipe - or use the pad';
    host.appendChild(hint);

    // On-screen D-pad (works on touch and mouse).
    const pad = document.createElement('div');
    pad.className = 'pg-dpad';
    const mkBtn = (label, cls, dx, dy) => {
      const b = document.createElement('button');
      b.className = 'pg-dpad-btn ' + cls; b.textContent = label;
      b.addEventListener('click', (e) => { e.preventDefault(); setDir(dx, dy); });
      return b;
    };
    pad.appendChild(mkBtn('\u25B2', 'up', 0, -1));
    pad.appendChild(mkBtn('\u25C0', 'left', -1, 0));
    pad.appendChild(mkBtn('\u25B6', 'right', 1, 0));
    pad.appendChild(mkBtn('\u25BC', 'down', 0, 1));
    host.appendChild(pad);

    // Keyboard.
    const kd = (e) => {
      if (!alive) return;
      const k = e.key.toLowerCase();
      if (k==='arrowup' || k==='w') { setDir(0,-1); e.preventDefault(); }
      else if (k==='arrowdown' || k==='s') { setDir(0,1); e.preventDefault(); }
      else if (k==='arrowleft' || k==='a') { setDir(-1,0); e.preventDefault(); }
      else if (k==='arrowright' || k==='d') { setDir(1,0); e.preventDefault(); }
    };
    window.addEventListener('keydown', kd);

    // Swipe on the canvas.
    let tsx = 0, tsy = 0;
    const ts = (e) => { tsx = e.touches[0].clientX; tsy = e.touches[0].clientY; };
    const te = (e) => {
      const dx = e.changedTouches[0].clientX - tsx;
      const dy = e.changedTouches[0].clientY - tsy;
      if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;
      if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 1 : -1, 0);
      else setDir(0, dy > 0 ? 1 : -1);
    };
    c.addEventListener('touchstart', ts, { passive: true });
    c.addEventListener('touchend', te, { passive: true });

    loop((dt) => { acc += dt; if (alive && acc >= tick) { acc = 0; step(); } draw(); });
    const obs = new MutationObserver(() => {
      if (!host.contains(c)) {
        window.removeEventListener('keydown', kd);
        c.removeEventListener('touchstart', ts);
        c.removeEventListener('touchend', te);
        obs.disconnect(); stopLoop();
      }
    });
    obs.observe(host, { childList: true });
  }

  /* ============================================================
     2. PING PONG  (no tunneling, serve delay, fair AI)
     ============================================================ */
  function pong(host) {
    const W = 600, H = 400;
    const c = canvasHost(W, H); const ctx = c.getContext('2d');
    const PH = 80, PW = 12;
    const P = { y: H/2 - PH/2, score: 0 };
    const AI = { y: H/2 - PH/2, score: 0 };
    let ball = { x: W/2, y: H/2, vx: 0, vy: 0 };
    let state = 'idle';
    let serveTimer = 0;
    let serveDir = 1;

    function resetBall(dir) {
      ball.x = W/2; ball.y = H/2;
      const speed = 5.5;
      ball.vx = dir * speed;
      ball.vy = rand(-2.5, 2.5);
      if (Math.abs(ball.vy) < 1) ball.vy = ball.vy < 0 ? -1.5 : 1.5;
    }
    function serve() {
      P.score = 0; AI.score = 0;
      state = 'serving'; serveTimer = 60; serveDir = Math.random() < 0.5 ? 1 : -1;
      setScore('You 0 - 0 AI  Best: ' + bestScore('pong'));
    }
    function nextServe(dir) { state = 'serving'; serveTimer = 50; serveDir = dir; }

    function step() {
      if (state === 'serving') {
        serveTimer--;
        if (serveTimer <= 0) { resetBall(serveDir); state = 'playing'; }
        return;
      }
      if (state !== 'playing') return;
      ball.x += ball.vx; ball.y += ball.vy;
      if (ball.y < 8) { ball.y = 8; ball.vy = Math.abs(ball.vy); }
      if (ball.y > H - 8) { ball.y = H - 8; ball.vy = -Math.abs(ball.vy); }
      const aiTarget = ball.y - PH/2;
      const aiDiff = aiTarget - AI.y;
      AI.y += clamp(aiDiff, -3.8, 3.8);
      AI.y = clamp(AI.y, 0, H - PH);
      if (ball.vx < 0 && ball.x < PW + 10 && ball.x > 0) {
        if (ball.y > P.y && ball.y < P.y + PH) {
          ball.x = PW + 10;
          ball.vx = Math.abs(ball.vx) * 1.06;
          try{window.sfx.blip();}catch(e){}
          ball.vy += (ball.y - (P.y + PH/2)) * 0.10;
          if (Math.abs(ball.vy) < 1.5) ball.vy = ball.vy < 0 ? -1.5 : 1.5;
        }
      }
      if (ball.vx > 0 && ball.x > W - PW - 10 && ball.x < W) {
        if (ball.y > AI.y && ball.y < AI.y + PH) {
          ball.x = W - PW - 10;
          ball.vx = -Math.abs(ball.vx) * 1.06;
          ball.vy += (ball.y - (AI.y + PH/2)) * 0.10;
          if (Math.abs(ball.vy) < 1.5) ball.vy = ball.vy < 0 ? -1.5 : 1.5;
        }
      }
      ball.vx = clamp(ball.vx, -10, 10);
      ball.vy = clamp(ball.vy, -8, 8);
      if (ball.x < -10) {
        AI.score++;
        setScore('You ' + P.score + ' - ' + AI.score + ' AI');
        if (AI.score >= 5) { state = 'over'; } else { nextServe(1); }
      }
      if (ball.x > W + 10) {
        P.score++;
        setScore('You ' + P.score + ' - ' + AI.score + ' AI');
        if (P.score >= 5) { state = 'over'; } else { nextServe(-1); }
      }
    }
    function drawOverlay(title, sub) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.font = 'bold 28px Inter, sans-serif'; ctx.fillText(title, W/2, H/2 - 8);
      ctx.font = '14px JetBrains Mono, monospace'; ctx.fillText(sub, W/2, H/2 + 22);
    }
    function draw() {
      ctx.fillStyle = '#0a0a0e'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.setLineDash([6, 8]);
      ctx.beginPath(); ctx.moveTo(W/2, 0); ctx.lineTo(W/2, H); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, P.y, PW, PH);
      ctx.fillRect(W - PW, AI.y, PW, PH);
      if (state === 'playing' || state === 'serving') {
        ctx.beginPath(); ctx.arc(ball.x, ball.y, 7, 0, 7); ctx.fill();
      }
      if (state === 'idle') { drawOverlay('Ping Pong', 'Move mouse to control - First to 5'); }
      else if (state === 'serving') {
        const dots = '.'.repeat(Math.floor(serveTimer / 18) + 1);
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.textAlign = 'center';
        ctx.font = '20px JetBrains Mono, monospace'; ctx.fillText('Get ready' + dots, W/2, H/2);
      } else if (state === 'over') {
        saveBest('pong', P.score); const msg = P.score >= 5 ? 'You win!' : 'AI wins';
        drawOverlay(msg, 'Score: ' + P.score + ' - ' + AI.score + ' - press Start');
      }
    }
    const move = (clientY) => {
      const r = c.getBoundingClientRect();
      const scale = H / r.height;
      P.y = clamp((clientY - r.top) * scale - PH/2, 0, H - PH);
    };
    const mm = (e) => move(e.clientY);
    const tm = (e) => { move(e.touches[0].clientY); e.preventDefault(); };
    c.addEventListener('mousemove', mm);
    c.addEventListener('touchmove', tm, { passive: false });
    host.appendChild(button('Start', serve));
    draw(); loop(() => { step(); draw(); });
    const obs = new MutationObserver(() => {
      if (!host.contains(c)) { c.removeEventListener('mousemove', mm); c.removeEventListener('touchmove', tm); obs.disconnect(); stopLoop(); }
    });
    obs.observe(host, { childList: true });
  }

  /* ============================================================
     4. FLAPPY
     ============================================================ */
  function flappy(host){
    const W=420,H=560; const c=canvasHost(W,H); const ctx=c.getContext('2d');
    let bird,vy,pipes,score,running,started, GAP=150, acc=0, PIPE_EVERY=1500;
    function reset(){bird={x:90,y:H/2,r:12};vy=0;pipes=[];score=0;running=true;started=false;acc=0;setScore('Best: '+bestScore('flappy'));}
    function addPipe(){ const top=rand(60,H-GAP-80); pipes.push({x:W, top, bot:top+GAP, passed:false}); }
    function flap(){ if(!running)return; if(!started)started=true; vy=-7.5; }
    function step(dt){
      if(!running||!started)return;
      vy+=0.42; bird.y+=vy;
      acc+=dt; if(acc>=PIPE_EVERY){acc=0;addPipe();}
      pipes.forEach(p=>{ p.x-=2.6; if(!p.passed && p.x+40<bird.x){p.passed=true;score++;try{window.sfx.blip();}catch(e){}setScore('Score: '+score);} });
      pipes=pipes.filter(p=>p.x>-50);
      if(bird.y<bird.r||bird.y>H-bird.r) running=false;
      if(pipes.some(p=>bird.x+bird.r>p.x&&bird.x-bird.r<p.x+40&&(bird.y-bird.r<p.top||bird.y+bird.r>p.bot))) running=false;
      if(!running){ try{window.haptic(40);}catch(e){} saveBest('flappy', score); setScore('Final: '+score+'  Best: '+bestScore('flappy')); }
    }
    function draw(){
      ctx.fillStyle='#0a0a0e'; ctx.fillRect(0,0,W,H);
      pipes.forEach(p=>{ ctx.fillStyle='rgba(0,200,255,0.85)'; ctx.fillRect(p.x,0,40,p.top); ctx.fillRect(p.x,p.bot,40,H-p.bot); });
      ctx.fillStyle='#34d399'; ctx.beginPath(); ctx.arc(bird.x,bird.y,bird.r,0,7); ctx.fill();
      if(!started){ ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.font='18px Inter'; ctx.fillText('Tap / Space to flap',W/2,H/2-60); }
      if(!running){ ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillRect(0,0,W,H); ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.font='24px Inter'; ctx.fillText('Splat.',W/2,H/2); ctx.font='14px JetBrains Mono'; ctx.fillText('Score: '+score,W/2,H/2+26); }
    }
    reset();draw();
    const kp=(e)=>{if(e.code==='Space'){e.preventDefault();flap();}};
    c.addEventListener('click',flap); c.addEventListener('touchstart',(e)=>{e.preventDefault();flap();},{passive:false});
    window.addEventListener('keydown',kp);
    host.appendChild(button('Restart',reset));
    loop((dt)=>{step(dt);draw();});
    const obs=new MutationObserver(()=>{if(!host.contains(c)){window.removeEventListener('keydown',kp);obs.disconnect();stopLoop();}}); obs.observe(host,{childList:true});
  }

  /* ============================================================
     5. MINESWEEPER
     ============================================================ */
  function mines(host){
    const COLS=10,ROWS=10,MINES=15; const cell=34; const grid=[];
    let revealed=0, over=false, started=false;
    const wrap=document.createElement('div'); wrap.className='pg-mines';
    wrap.style.gridTemplateColumns='repeat('+COLS+','+cell+'px)';
    host.appendChild(wrap);
    function build(){
      grid.length=0; for(let y=0;y<ROWS;y++){grid.push([]);for(let x=0;x<COLS;x++)grid[y].push({mine:false,n:0,rev:false,flag:false});}
    }
    function place(sx,sy){
      let placed=0;
      while(placed<MINES){ const x=Math.floor(rand(0,COLS)),y=Math.floor(rand(0,ROWS)); if(grid[y][x].mine||(Math.abs(x-sx)<=1&&Math.abs(y-sy)<=1))continue; grid[y][x].mine=true;placed++; }
      for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){ if(grid[y][x].mine)continue; let n=0; for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const ny=y+dy,nx=x+dx;if(ny>=0&&nx>=0&&ny<ROWS&&nx<COLS&&grid[ny][nx].mine)n++;} grid[y][x].n=n; }
    }
    const NUM=['', '#58a6ff','#34d399','#f87171','#a78bfa','#fbbf24','#22d3ee','#f472b6','#fff'];
    function render(){
      wrap.innerHTML='';
      for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
        const c=document.createElement('div'); const g=grid[y][x]; c.className='pg-cell'+(g.rev?' rev':'');
        if(g.rev){ if(g.mine) c.textContent='💣'; else if(g.n>0){ c.textContent=g.n; c.style.color=NUM[g.n]; } }
        else if(g.flag&&over===false) c.textContent='🚩';
        if(over&&g.mine){c.classList.add('mine');c.textContent='💣';}
        c.addEventListener('click',()=>revealCell(x,y));
        c.addEventListener('contextmenu',(e)=>{e.preventDefault();if(!g.rev&&!over){g.flag=!g.flag;render();}});
        wrap.appendChild(c);
      }
      if(over){ setScore(revealed===ROWS*COLS-MINES?'Cleared!':'Boom!'); }
      else setScore('Flagged: '+grid.flat().filter(g=>g.flag).length+' / '+MINES);
    }
    function revealCell(x,y){
      if(over) return; const g=grid[y][x]; if(g.rev||g.flag) return;
      if(!started){started=true;place(x,y);}
      flood(x,y); render();
      if(g.mine){ over=true; render(); }
      else if(revealed===ROWS*COLS-MINES){ over=true; render(); }
    }
    function flood(x,y){
      if(x<0||y<0||x>=COLS||y>=ROWS) return; const g=grid[y][x]; if(g.rev||g.flag||g.mine) return;
      g.rev=true; revealed++;
      if(g.n===0){ for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){ if(dx||dy) flood(x+dx,y+dy); } }
    }
    build();render(); host.appendChild(button('New Game',()=>{build();revealed=0;over=false;started=false;render();}));
  }

  /* ============================================================
     6. REACTION TEST
     ============================================================ */
  function reaction(host){
    const box=document.createElement('div'); box.className='pg-react'; host.appendChild(box);
    let phase='idle', t0=0, timer=null, best=parseFloat(localStorage.getItem('pg_reaction_best'))||null;
    function set(text,cls){ box.className='pg-react '+(cls||''); box.textContent=text; if(best!=null){ const sc=document.createElement('div'); sc.className='pg-react-best'; sc.textContent='Best: '+best+'ms'; box.appendChild(sc);} }
    function goWait(){ phase='wait'; set('Wait for green...','red'); const wait=rand(1200,3500); timer=setTimeout(()=>{ phase='go'; t0=performance.now(); set('CLICK!','green'); },wait); }
    box.addEventListener('click',()=>{
      if(phase==='idle'||phase==='result'){ goWait(); }
      else if(phase==='wait'){ clearTimeout(timer); phase='result'; set('Too soon! Wait for green. Click to retry.','red'); }
      else if(phase==='go'){ const ms=Math.round(performance.now()-t0); if(best==null||ms<best){best=ms;localStorage.setItem('pg_reaction_best',best);} phase='result'; set(ms+' ms - click to retry','done'); }
    });
    set('Click to start','idle');
  }

  /* ============================================================
     7. DODGE  (smooth pointer tracking, clear start state)
     ============================================================ */
  function dodge(host){
    const W=480, H=560;
    const c = canvasHost(W, H); const ctx = c.getContext('2d');
    let player, blocks, score, running, started, spawnAcc, spawnEvery, frameCount;
    let dodgeSettings = { spawn: 850, minVy: 2.5, maxVy: 4.5, decay: 380 };
    function reset() {
      const diff = getDifficulty();
      const diffSettings = {
        Easy: { spawn: 1100, minVy: 2, maxVy: 3.5, decay: 380 },
        Medium: { spawn: 850, minVy: 2.5, maxVy: 4.5, decay: 380 },
        Hard: { spawn: 500, minVy: 3.5, maxVy: 6, decay: 280 }
      };
      dodgeSettings = diffSettings[diff] || diffSettings.Medium;
      player = { x: W/2, y: H-60, r: 11 };
      blocks = []; score = 0; running = true; started = false;
      spawnAcc = 0; spawnEvery = dodgeSettings.spawn; frameCount = 0;
      setScore('');
    }
    function spawn() {
      const s = rand(14, 30);
      blocks.push({ x: rand(0, W-s), y: -s, s: s, vy: rand(dodgeSettings.minVy, dodgeSettings.maxVy) });
    }
    function step(dt) {
      frameCount++;
      if (!running || !started) return;
      spawnAcc += dt;
      if (spawnAcc >= spawnEvery) { spawnAcc = 0; spawn(); if (spawnEvery > dodgeSettings.decay) spawnEvery -= 7; }
      blocks.forEach(b => { b.y += b.vy; });
      blocks = blocks.filter(b => b.y < H + 40);
      score++;
      if (score % 60 === 0) setScore('Survived: ' + Math.round(score/60) + 's');
      for (const b of blocks) {
        const cx = clamp(player.x, b.x, b.x + b.s);
        const cy = clamp(player.y, b.y, b.y + b.s);
        const dx = player.x - cx, dy = player.y - cy;
        if (dx*dx + dy*dy < player.r * player.r) {
          running = false;
          try{window.haptic(40);}catch(e){}
          saveBest('dodge', Math.round(score/60));
          setScore('Survived: ' + Math.round(score/60) + 's  Best: ' + bestScore('dodge'));
          break;
        }
      }
    }
    function draw() {
      ctx.fillStyle = '#0a0a0e'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ff6b6b';
      blocks.forEach(b => ctx.fillRect(b.x, b.y, b.s, b.s));
      ctx.fillStyle = '#34d399';
      ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, 7); ctx.fill();
      if (!started) {
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        ctx.font = '18px Inter, sans-serif';
        ctx.fillText('Move mouse / drag to control', W/2, H/2 - 10);
        ctx.font = '14px JetBrains Mono, monospace';
        ctx.fillText('Click or tap to start - avoid the red', W/2, H/2 + 18);
      }
      if (!running && started) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        ctx.font = 'bold 24px Inter, sans-serif'; ctx.fillText('Squished.', W/2, H/2);
        ctx.font = '14px JetBrains Mono, monospace';
        ctx.fillText('Survived: ' + Math.round(score/60) + 's - press Restart', W/2, H/2 + 28);
      }
    }
    const moveTo = (clientX) => {
      const r = c.getBoundingClientRect();
      const sx = W / r.width;
      player.x = clamp((clientX - r.left) * sx, player.r, W - player.r);
    };
    const mm = (e) => { moveTo(e.clientX); };
    const tm = (e) => { moveTo(e.touches[0].clientX); e.preventDefault(); };
    c.addEventListener('mousemove', mm);
    c.addEventListener('touchmove', tm, { passive: false });
    c.addEventListener('click', () => { if (!started && running) started = true; });
    c.addEventListener('touchstart', (e) => { if (!started && running) started = true; e.preventDefault(); }, { passive: false });
    reset(); draw();
    host.appendChild(button('Restart', reset));
    loop((dt) => { step(dt); draw(); });
    const obs = new MutationObserver(() => {
      if (!host.contains(c)) { c.removeEventListener('mousemove', mm); c.removeEventListener('touchmove', tm); obs.disconnect(); stopLoop(); }
    });
    obs.observe(host, { childList: true });
  }

  const RUNNERS = { snake, pong, flappy, mines, reaction, dodge };

  /* ── public API ── */
  window.YatinPlayground = { GAMES, open, close };

  /* ── render the playground cards into the section ── */
  function renderCards() {
    const grid = document.getElementById('pg-cards');
    if (!grid) return;
    grid.innerHTML = GAMES.map(g => `
      <button class="pg-card" data-id="${g.id}">
        <span class="pg-card-icon">${g.icon}</span>
        <span class="pg-card-name">${g.name}</span>
        <span class="pg-card-desc">${g.desc}</span>
        <span class="pg-card-play">Play →</span>
      </button>`).join('');
    grid.querySelectorAll('.pg-card').forEach(card =>
      card.addEventListener('click', () => open(card.dataset.id)));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderCards);
  else renderCards();
})();
