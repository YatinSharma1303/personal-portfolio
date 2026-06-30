import { useEffect, useRef, useState } from 'react';

const W = 320, H = 320;
export default function Dodge() {
  const ref = useRef(null);
  const [time, setTime] = useState(0);
  const [over, setOver] = useState(false);
  const [best, setBest] = useState(() => Number(localStorage.getItem('dodge_best') || 0));
  const g = useRef(null);

  const reset = () => { g.current = { x: W / 2, y: H / 2, foes: [], t: 0 }; setTime(0); setOver(false); };
  useEffect(() => { reset(); }, []);

  const move = (cx, cy) => {
    const s = g.current; if (!s) return;
    const rect = ref.current.getBoundingClientRect();
    s.x = (cx - rect.left) * (W / rect.width);
    s.y = (cy - rect.top) * (H / rect.height);
  };

  useEffect(() => {
    const ctx = ref.current.getContext('2d');
    const iv = setInterval(() => {
      const s = g.current; if (!s || over) return;
      s.t++;
      if (s.t % 2 === 0) setTime((t) => +(t + 0.06).toFixed(2));
      // spawn foes from edges
      if (s.t % 22 === 0) {
        const edge = Math.random();
        s.foes.push({
          x: edge < 0.5 ? 0 : W, y: Math.random() * H,
          vx: (Math.random() * 2 + 1) * (edge < 0.5 ? 1 : -1),
          vy: (Math.random() - 0.5) * 3,
        });
      }
      s.foes.forEach((f) => { f.x += f.vx; f.y += f.vy; });
      s.foes = s.foes.filter((f) => f.x > -20 && f.x < W + 20 && f.y > -20 && f.y < H + 20);
      for (const f of s.foes) {
        if (Math.hypot(f.x - s.x, f.y - s.y) < 12) {
          setOver(true);
          const final = +(time).toFixed(2);
          if (final > best) { setBest(final); localStorage.setItem('dodge_best', final); }
        }
      }
      ctx.fillStyle = '#0c0c0c'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ff5577';
      s.foes.forEach((f) => ctx.fillRect(f.x - 5, f.y - 5, 10, 10));
      ctx.fillStyle = '#4ad9ff'; ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, 7); ctx.fill();
    }, 24);
    return () => clearInterval(iv);
  }, [over, time, best]);

  return (
    <div className="text-center">
      <div className="font-mono text-sm mb-3" style={{ color: 'var(--muted)' }}>Time: {time.toFixed(1)}s · Best: {best || '—'}s · move to survive</div>
      <canvas ref={ref} width={W} height={H}
              onMouseMove={(e) => move(e.clientX, e.clientY)}
              onTouchMove={(e) => move(e.touches[0].clientX, e.touches[0].clientY)}
              style={{ borderRadius: 12, border: '1px solid var(--line)', maxWidth: '100%', touchAction: 'none' }} />
      {over && <div className="mt-3"><span style={{ color: 'var(--accent)' }}>💥 Hit! Survived {time.toFixed(1)}s</span> <button onClick={reset} className="tag ml-2">Retry</button></div>}
    </div>
  );
}
