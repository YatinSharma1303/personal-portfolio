import { useEffect, useRef, useState } from 'react';

const W = 360, H = 240;
export default function Pong() {
  const ref = useRef(null);
  const [score, setScore] = useState({ you: 0, ai: 0 });
  const [over, setOver] = useState(null);
  const g = useRef(null);

  const reset = () => {
    g.current = { py: H / 2, ay: H / 2, bx: W / 2, by: H / 2, vx: 3.2, vy: 2, you: 0, ai: 0 };
    setScore({ you: 0, ai: 0 }); setOver(null);
  };
  useEffect(() => { reset(); }, []);

  const move = (clientY) => {
    const s = g.current; if (!s) return;
    const rect = ref.current.getBoundingClientRect();
    s.py = Math.max(24, Math.min(H - 24, (clientY - rect.top) * (H / rect.height)));
  };

  useEffect(() => {
    const ctx = ref.current.getContext('2d');
    const iv = setInterval(() => {
      const s = g.current; if (!s || over) return;
      s.bx += s.vx; s.by += s.vy;
      if (s.by < 6 || s.by > H - 6) s.vy *= -1;
      // AI follows
      s.ay += Math.max(-3, Math.min(3, (s.by - s.ay) * 0.08));
      // paddle collisions
      if (s.bx < 18 && Math.abs(s.by - s.py) < 28) { s.vx = Math.abs(s.vx); s.vx *= 1.03; }
      if (s.bx > W - 18 && Math.abs(s.by - s.ay) < 28) { s.vx = -Math.abs(s.vx); }
      // score
      if (s.bx < 0) { s.ai++; setScore({ you: s.you, ai: s.ai }); s.bx = W / 2; s.by = H / 2; s.vx = 3.2; }
      if (s.bx > W) { s.you++; setScore({ you: s.you, ai: s.ai }); s.bx = W / 2; s.by = H / 2; s.vx = -3.2; }
      if (s.you >= 5) setOver('win');
      if (s.ai >= 5) setOver('lose');

      ctx.fillStyle = '#0c0c0c'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#7c6cff'; ctx.fillRect(8, s.py - 24, 6, 48);
      ctx.fillStyle = '#4ad9ff'; ctx.fillRect(W - 14, s.ay - 24, 6, 48);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.bx, s.by, 5, 0, 7); ctx.fill();
    }, 18);
    return () => clearInterval(iv);
  }, [over]);

  return (
    <div className="text-center">
      <div className="font-mono text-sm mb-3" style={{ color: 'var(--muted)' }}>You {score.you} — {score.ai} AI · move mouse / drag</div>
      <canvas ref={ref} width={W} height={H}
              onMouseMove={(e) => move(e.clientY)}
              onTouchMove={(e) => move(e.touches[0].clientY)}
              style={{ borderRadius: 12, border: '1px solid var(--line)', maxWidth: '100%', touchAction: 'none' }} />
      {over && <div className="mt-3"><span style={{ color: 'var(--accent)' }}>{over === 'win' ? '🏆 You win!' : '😵 AI wins!'}</span> <button onClick={reset} className="tag ml-2">Rematch</button></div>}
    </div>
  );
}
