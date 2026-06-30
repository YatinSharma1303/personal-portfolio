import { useEffect, useRef, useState } from 'react';

const N = 17, CELL = 18;
export default function Snake() {
  const ref = useRef(null);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const game = useRef(null);

  const reset = () => {
    game.current = { snake: [{ x: 8, y: 8 }], dir: { x: 1, y: 0 }, food: { x: 12, y: 8 }, next: { x: 1, y: 0 } };
    setScore(0); setOver(false);
  };
  useEffect(() => { reset(); }, []);

  useEffect(() => {
    const key = (e) => {
      const g = game.current; if (!g) return;
      const m = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 } }[e.key];
      if (m && !(m.x === -g.dir.x && m.y === -g.dir.y)) { g.next = m; e.preventDefault(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    const ctx = ref.current.getContext('2d');
    const iv = setInterval(() => {
      const g = game.current; if (!g || over) return;
      g.dir = g.next;
      const head = { x: (g.snake[0].x + g.dir.x + N) % N, y: (g.snake[0].y + g.dir.y + N) % N };
      if (g.snake.some((s) => s.x === head.x && s.y === head.y)) { setOver(true); return; }
      g.snake.unshift(head);
      if (head.x === g.food.x && head.y === g.food.y) {
        setScore((s) => s + 1);
        g.food = { x: (Math.random() * N) | 0, y: (Math.random() * N) | 0 };
      } else g.snake.pop();

      ctx.fillStyle = '#0c0c0c'; ctx.fillRect(0, 0, N * CELL, N * CELL);
      ctx.fillStyle = '#7c6cff';
      g.snake.forEach((s) => ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2));
      ctx.fillStyle = '#4ad9ff';
      ctx.fillRect(g.food.x * CELL + 2, g.food.y * CELL + 2, CELL - 4, CELL - 4);
    }, 110);
    return () => clearInterval(iv);
  }, [over]);

  return (
    <div className="text-center">
      <div className="font-mono text-sm mb-3" style={{ color: 'var(--muted)' }}>Score: {score} · arrow keys</div>
      <canvas ref={ref} width={N * CELL} height={N * CELL} style={{ borderRadius: 12, border: '1px solid var(--line)', maxWidth: '100%' }} />
      {over && <div className="mt-3"><span style={{ color: 'var(--accent)' }}>Game over!</span> <button onClick={reset} className="tag ml-2">Restart</button></div>}
    </div>
  );
}
