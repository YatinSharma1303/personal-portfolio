import { useEffect, useRef, useState } from 'react';

const W = 300, H = 380, GAP = 120;
export default function Flappy() {
  const ref = useRef(null);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const g = useRef(null);

  const reset = () => { g.current = { y: H / 2, v: 0, pipes: [{ x: W, h: 120 }], t: 0 }; setScore(0); setOver(false); };
  useEffect(() => { reset(); }, []);

  const flap = () => { if (over) return reset(); if (g.current) g.current.v = -5.5; };
  useEffect(() => {
    const k = (e) => { if (e.code === 'Space') { e.preventDefault(); flap(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [over]);

  useEffect(() => {
    const ctx = ref.current.getContext('2d');
    const iv = setInterval(() => {
      const s = g.current; if (!s || over) return;
      s.v += 0.32; s.y += s.v; s.t++;
      s.pipes.forEach((p) => (p.x -= 2.2));
      if (s.pipes[s.pipes.length - 1].x < W - 160) s.pipes.push({ x: W, h: 60 + Math.random() * (H - GAP - 120) });
      s.pipes = s.pipes.filter((p) => p.x > -60);
      for (const p of s.pipes) {
        if (p.x < 60 && p.x > 20 && (s.y < p.h || s.y > p.h + GAP)) setOver(true);
        if (p.x === 38 | 0 && Math.abs(p.x - 38) < 2) setScore((v) => v + 1);
      }
      if (s.y > H || s.y < 0) setOver(true);

      ctx.fillStyle = '#0c0c0c'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#7c6cff';
      s.pipes.forEach((p) => { ctx.fillRect(p.x, 0, 38, p.h); ctx.fillRect(p.x, p.h + GAP, 38, H); });
      ctx.fillStyle = '#4ad9ff';
      ctx.beginPath(); ctx.arc(40, s.y, 10, 0, 7); ctx.fill();
    }, 22);
    return () => clearInterval(iv);
  }, [over]);

  return (
    <div className="text-center">
      <div className="font-mono text-sm mb-3" style={{ color: 'var(--muted)' }}>Score: {score} · space / tap to flap</div>
      <canvas ref={ref} onClick={flap} width={W} height={H} style={{ borderRadius: 12, border: '1px solid var(--line)', maxWidth: '100%', cursor: 'pointer' }} />
      {over && <div className="mt-3"><span style={{ color: 'var(--accent)' }}>Crashed!</span> <button onClick={reset} className="tag ml-2">Restart</button></div>}
    </div>
  );
}
