/* ============================================================
   YATIN SHARMA — PORTFOLIO · games.js
   Playground: 7 playable mini-games in a full-screen overlay.
   Loaded after script.js. Exposes window.YatinPlayground.
   ============================================================ */
(function () {
  'use strict';

  const GAMES = [
    { id: 'snake',      icon: '♞', name: 'Snake',        desc: 'Classic game. High chance of self-sabotage.' },
    { id: 'pong',       icon: '◉', name: 'Ping Pong',    desc: 'You vs an AI paddle. First to 5 wins.' },
    { id: 'roast',      icon: '▱', name: 'Roast Quiz',   desc: 'A personality test where every answer is a personal attack.' },
    { id: 'flappy',     icon: '⌁', name: 'Flappy',       desc: 'Infuriating physics. Avoid the pipes.' },
    { id: 'mines',      icon: '⚑', name: 'Minesweeper',  desc: 'Classic logic. Avoid the mines.' },
    { id: 'reaction',   icon: '◌', name: 'Reaction Test',desc: 'Click when it turns green.' },
    { id: 'dodge',      icon: '⌖', name: 'Dodge',        desc: 'Survive against angry geometry.' }
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
        <div class="pg-title" id="pg-title">playground</div>
        <div class="pg-score" id="pg-score"></div>
      </div>
      <div class="pg-host" id="pg-host"></div>
    `;
    document.body.appendChild(overlay);
    host = overlay.querySelector('#pg-host');
    overlay.querySelector('#pg-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) close(); });
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

  /* ============================================================
     1. SNAKE
     ============================================================ */
  function snake(host) {
    const COLS = 22, ROWS = 22, CELL = 24;
    const W = COLS * CELL, H = ROWS * CELL;
    const c = canvasHost(W, H); const ctx = c.getContext('2d');
    let snake, dir, nextDir, food, score, alive, tick, acc = 0;
    function reset() {
      snake = [{x:10,y:10},{x:9,y:10},{x:8,y:10}];
      dir = {x:1,y:0}; nextDir = dir; score = 0; alive = true; tick = 110;
      placeFood(); setScore('Score: 0');
    }
    function placeFood() { let p; do { p = {x:Math.floor(rand(0,COLS)),y:Math.floor(rand(0,ROWS))}; } while (snake.some(s=>s.x===p.x&&s.y===p.y)); food = p; }
    function step() {
      dir = nextDir;
      const head = {x: snake[0].x+dir.x, y: snake[0].y+dir.y};
      if (head.x<0||head.y<0||head.x>=COLS||head.y>=ROWS||snake.some(s=>s.x===head.x&&s.y===head.y)) { alive=false; return; }
      snake.unshift(head);
      if (head.x===food.x && head.y===food.y) { score++; setScore('Score: '+score); placeFood(); if (tick>60) tick-=3; }
      else snake.pop();
    }
    function draw() {
      ctx.fillStyle = '#0a0a0e'; ctx.fillRect(0,0,W,H);
      ctx.fillStyle = '#34d399'; ctx.beginPath(); ctx.arc(food.x*CELL+CELL/2, food.y*CELL+CELL/2, CELL/2.6, 0, 7); ctx.fill();
      snake.forEach((s,i)=>{ ctx.fillStyle = i===0 ? '#fff' : 'rgba(255,255,255,'+(0.95-i*0.03)+')'; ctx.fillRect(s.x*CELL+1.5, s.y*CELL+1.5, CELL-3, CELL-3); });
      if (!alive) { ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillRect(0,0,W,H); ctx.fillStyle='#fff'; ctx.font='28px Inter'; ctx.textAlign='center'; ctx.fillText('Game Over', W/2, H/2-10); ctx.font='14px JetBrains Mono'; ctx.fillText('Final: '+score, W/2, H/2+18); }
    }
    reset(); draw();
    host.appendChild(button('Restart', reset));
    const kd = (e) => {
      const k = e.key;
      if ((k==='ArrowUp'||k==='w')&&dir.y===0) nextDir={x:0,y:-1};
      else if ((k==='ArrowDown'||k==='s')&&dir.y===0) nextDir={x:0,y:1};
      else if ((k==='ArrowLeft'||k==='a')&&dir.x===0) nextDir={x:-1,y:0};
      else if ((k==='ArrowRight'||k==='d')&&dir.x===0) nextDir={x:1,y:0};
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(k)) e.preventDefault();
    };
    window.addEventListener('keydown', kd);
    loop((dt)=>{ acc+=dt; if(alive&&acc>=tick){acc=0;step();} draw(); });
    const obs = new MutationObserver(()=>{ if(!host.contains(c)){ window.removeEventListener('keydown',kd); obs.disconnect(); stopLoop(); } });
    obs.observe(host,{childList:true});
  }

  /* ============================================================
     2. PING PONG
     ============================================================ */
  function pong(host) {
    const W=600,H=400; const c=canvasHost(W,H); const ctx=c.getContext('2d');
    const P={y:H/2-40,h:80,w:10,score:0}; const AI={y:H/2-40,h:80,w:10,score:0};
    let ball={x:W/2,y:H/2,vx:5,vy:rand(-3,3)};
    let running=false;
    function reset(){ball={x:W/2,y:H/2,vx:Math.random()<.5?5:-5,vy:rand(-3,3)};}
    function serve(){ running=true; reset(); }
    function step(){
      if(!running) return;
      ball.x+=ball.vx; ball.y+=ball.vy;
      if(ball.y<6||ball.y>H-6) ball.vy*=-1;
      // ai follows
      AI.y = clamp(AI.y + clamp((ball.y-30)-AI.y, -4.5, 4.5), 0, H-AI.h);
      // player collision
      if(ball.x<P.x+P.w+6 && ball.y>P.y && ball.y<P.y+P.h && ball.vx<0){ ball.vx*=-1.06; ball.vy+= (ball.y-(P.y+P.h/2))*0.08; }
      if(ball.x>W-AI.w-6 && ball.y>AI.y && ball.y<AI.y+AI.h && ball.vx>0){ ball.vx*=-1.06; ball.vy+= (ball.y-(AI.y+AI.h/2))*0.08; }
      ball.vx=clamp(ball.vx,-9,9);
      // score
      if(ball.x<0){AI.score++; if(AI.score>=5){running=false;} else serve();}
      if(ball.x>W){P.score++; if(P.score>=5){running=false;} else serve();}
      setScore('You '+P.score+' — '+AI.score+' AI');
    }
    function draw(){
      ctx.fillStyle='#0a0a0e'; ctx.fillRect(0,0,W,H);
      ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.setLineDash([6,8]); ctx.beginPath(); ctx.moveTo(W/2,0); ctx.lineTo(W/2,H); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle='#fff'; ctx.fillRect(0,P.y,P.w,P.h); ctx.fillRect(W-AI.w,AI.y,AI.w,AI.h);
      ctx.beginPath(); ctx.arc(ball.x,ball.y,6,0,7); ctx.fill();
      if(!running){ ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.fillRect(0,0,W,H); ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.font='26px Inter';
        const msg = (P.score>=5)?'You win! 🎉':(AI.score>=5)?'AI wins 🤖':'Tap Start'; ctx.fillText(msg,W/2,H/2-6); ctx.font='13px JetBrains Mono'; ctx.fillText('First to 5 · move mouse',W/2,H/2+20); }
    }
    const move=(e)=>{ const r=c.getBoundingClientRect(); const scale=H/r.height; P.y=clamp((e.clientY-r.top)*scale-P.h/2,0,H-P.h); };
    const tm=(e)=>{ const r=c.getBoundingClientRect(); const scale=H/r.height; P.y=clamp((e.touches[0].clientY-r.top)*scale-P.h/2,0,H-P.h); };
    c.addEventListener('mousemove',move); c.addEventListener('touchmove',tm,{passive:true});
    host.appendChild(button('Start', serve));
    draw(); loop(()=>{step();draw();});
    const obs=new MutationObserver(()=>{if(!host.contains(c)){c.removeEventListener('mousemove',move);c.removeEventListener('touchmove',tm);obs.disconnect();stopLoop();}}); obs.observe(host,{childList:true});
  }

  /* ============================================================
     3. ROAST QUIZ
     ============================================================ */
  function roast(host) {
    const QS = [
      { q:'Pick a vibe', a:['3am chaos','sunshine robot','feral gremlin','overthinker supreme'], r:['Bold of you to admit you function on zero sleep AND zero direction.','You confuse "optimism" with "never having read the docs".','Iconic. Truly. Truly unhinged.','You overthink push buttons. Sit down.'] },
      { q:'Your debugging style?', a:['console.log everything','actually read errors','pray','Stack Overflow devotee'], r:['Ah yes, archaeology via log spam.','A functioning developer? In MY roast quiz? Unlikely.','Prayer: the leading version control system, statistically.','You and 4 million others copy the same accepted answer.'] },
      { q:'Code won\'t compile. You…', a:['blame the linter','add a semicolon','restart everything','cry, productively'], r:['The linter is the only thing protecting your coworkers.','A semicolon. Revolutionary. You fixed nothing, but proudly.','Have you tried turning your whole career off and on again?','Productive tears. The best kind. The only kind.'] },
      { q:'Last commit message?', a:['"fix"','detailed novel','"pls work"','forgotten'], r:['"fix" — illuminating. The historians will study this.','Nobody reads 12-paragraph commits. Nobody.','Manifesting via commit message. Respect the hustle.','You don\'t remember. The code doesn\'t either.'] }
    ];
    let idx=0, score=0; const wrap=document.createElement('div'); wrap.className='pg-quiz'; host.appendChild(wrap);
    function render(){
      if(idx>=QS.length){ wrap.innerHTML=`<div class="pg-quiz-result"><div class="pg-emoji">🔥</div><div class="pg-roast">You finished the quiz. Your reward? Knowing yourself a little too well. Score: ${score}/${QS.length}. The AI is judging you, quietly.</div></div>`; wrap.appendChild(button('Again',()=>{idx=0;score=0;render();})); return; }
      const item=QS[idx];
      wrap.innerHTML=`<div class="pg-q">${item.q}</div><div class="pg-opts">${item.a.map((o,i)=>`<button class="pg-opt" data-i="${i}">${o}</button>`).join('')}</div>`;
      wrap.querySelectorAll('.pg-opt').forEach(b=>b.addEventListener('click',()=>{
        const i=+b.dataset.i; const roast=item.r[i];
        wrap.innerHTML=`<div class="pg-roast-pop">"${roast}"</div>`;
        score++; idx++;
        setTimeout(render, 1400);
      }));
    }
    render();
  }

  /* ============================================================
     4. FLAPPY
     ============================================================ */
  function flappy(host){
    const W=420,H=560; const c=canvasHost(W,H); const ctx=c.getContext('2d');
    let bird,vy,pipes,score,running,started, GAP=150, acc=0, PIPE_EVERY=1500;
    function reset(){bird={x:90,y:H/2,r:12};vy=0;pipes=[];score=0;running=true;started=false;acc=0;setScore('');}
    function addPipe(){ const top=rand(60,H-GAP-80); pipes.push({x:W, top, bot:top+GAP, passed:false}); }
    function flap(){ if(!running)return; if(!started)started=true; vy=-7.5; }
    function step(dt){
      if(!running||!started)return;
      vy+=0.42; bird.y+=vy;
      acc+=dt; if(acc>=PIPE_EVERY){acc=0;addPipe();}
      pipes.forEach(p=>{ p.x-=2.6; if(!p.passed && p.x+40<bird.x){p.passed=true;score++;setScore('Score: '+score);} });
      pipes=pipes.filter(p=>p.x>-50);
      if(bird.y<bird.r||bird.y>H-bird.r) running=false;
      if(pipes.some(p=>bird.x+bird.r>p.x&&bird.x-bird.r<p.x+40&&(bird.y-bird.r<p.top||bird.y+bird.r>p.bot))) running=false;
      if(!running) setScore('Final: '+score);
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
    wrap.style.gridTemplateColumns=`repeat(${COLS},${cell}px)`;
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
      if(over){ setScore(revealed===ROWS*COLS-MINES?'Cleared! 🎉':'Boom!'); }
      else setScore(`Flagged: ${grid.flat().filter(g=>g.flag).length} / ${MINES}`);
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
    function goWait(){ phase='wait'; set('Wait for green…','red'); const wait=rand(1200,3500); timer=setTimeout(()=>{ phase='go'; t0=performance.now(); set('CLICK!','green'); },wait); }
    box.addEventListener('click',()=>{
      if(phase==='idle'||phase==='result'){ goWait(); }
      else if(phase==='wait'){ clearTimeout(timer); phase='result'; set('Too soon! Wait for green. Click to retry.','red'); }
      else if(phase==='go'){ const ms=Math.round(performance.now()-t0); if(best==null||ms<best){best=ms;localStorage.setItem('pg_reaction_best',best);} phase='result'; set(ms+' ms — click to retry','done'); }
    });
    set('Click to start','idle');
  }

  /* ============================================================
     7. DODGE
     ============================================================ */
  function dodge(host){
    const W=480,H=560; const c=canvasHost(W,H); const ctx=c.getContext('2d');
    let player, blocks, score, running, started, spawnAcc, spawnEvery;
    const reset=()=>{player={x:W/2,y:H-50,r:11};blocks=[];score=0;running=true;started=false;spawnAcc=0;spawnEvery=900;setScore('');};
    function spawn(){ const s=rand(10,26); blocks.push({x:rand(0,W-s),y:-s,s,vy:rand(2.5,5)}); }
    function step(dt){
      if(!running||!started)return;
      spawnAcc+=dt; if(spawnAcc>=spawnEvery){spawnAcc=0;spawn();if(spawnEvery>420)spawnEvery-=6;}
      blocks.forEach(b=>b.y+=b.vy); blocks=blocks.filter(b=>b.y<H+40);
      score++; if(score%60===0) setScore('Survived: '+Math.round(score/60)+'s');
      if(blocks.some(b=> player.x+player.r>b.x&&player.x-player.r<b.x+b.s&&player.y+player.r>b.y&&player.y-player.r<b.y+b.s)){running=false;setScore('Survived: '+Math.round(score/60)+'s');}
    }
    function draw(){
      ctx.fillStyle='#0a0a0e'; ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#ff6b6b'; blocks.forEach(b=>ctx.fillRect(b.x,b.y,b.s,b.s));
      ctx.fillStyle='#34d399'; ctx.beginPath(); ctx.arc(player.x,player.y,player.r,0,7); ctx.fill();
      if(!started){ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='18px Inter';ctx.fillText('Move mouse / drag — avoid red',W/2,H/2);}
      if(!running){ctx.fillStyle='rgba(0,0,0,0.7)';ctx.fillRect(0,0,W,H);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='22px Inter';ctx.fillText('Squished.',W/2,H/2);}
    }
    const move=(e)=>{const r=c.getBoundingClientRect();const sx=W/r.width;player.x=clamp((e.clientX-r.left)*sx,player.r,W-player.r);};
    const tm=(e)=>{const r=c.getBoundingClientRect();const sx=W/r.width;player.x=clamp((e.touches[0].clientX-r.left)*sx,player.r,W-player.r);e.preventDefault();};
    c.addEventListener('mousemove',move); c.addEventListener('touchmove',tm,{passive:false});
    c.addEventListener('click',()=>{started=true;}); c.addEventListener('touchstart',()=>{started=true;},{passive:true});
    reset();draw(); host.appendChild(button('Restart',reset));
    loop((dt)=>{step(dt);draw();});
    const obs=new MutationObserver(()=>{if(!host.contains(c)){c.removeEventListener('mousemove',move);c.removeEventListener('touchmove',tm);obs.disconnect();stopLoop();}}); obs.observe(host,{childList:true});
  }

  const RUNNERS = { snake, pong, roast, flappy, mines, reaction, dodge };

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
