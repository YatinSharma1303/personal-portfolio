import { useState } from 'react';

const SIZE = 9, MINES = 10;
function build() {
  const cells = Array.from({ length: SIZE * SIZE }, (_, i) => ({ i, mine: false, open: false, flag: false, n: 0 }));
  let placed = 0;
  while (placed < MINES) { const r = (Math.random() * cells.length) | 0; if (!cells[r].mine) { cells[r].mine = true; placed++; } }
  const at = (x, y) => (x >= 0 && x < SIZE && y >= 0 && y < SIZE ? cells[y * SIZE + x] : null);
  cells.forEach((c) => {
    const x = c.i % SIZE, y = (c.i / SIZE) | 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const n = at(x + dx, y + dy); if (n && n.mine) c.n++; }
  });
  return cells;
}

export default function Minesweeper() {
  const [cells, setCells] = useState(build);
  const [done, setDone] = useState(null);

  const flood = (arr, i) => {
    const c = arr[i]; if (!c || c.open || c.flag) return;
    c.open = true;
    if (c.n === 0 && !c.mine) {
      const x = i % SIZE, y = (i / SIZE) | 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE) flood(arr, ny * SIZE + nx);
      }
    }
  };

  const click = (i) => {
    if (done) return;
    const arr = cells.map((c) => ({ ...c }));
    if (arr[i].flag) return;
    if (arr[i].mine) { arr.forEach((c) => (c.open = c.mine ? true : c.open)); setCells(arr); setDone('lose'); return; }
    flood(arr, i);
    setCells(arr);
    if (arr.filter((c) => !c.open).length === MINES) setDone('win');
  };
  const flag = (e, i) => { e.preventDefault(); if (done) return; const arr = cells.map((c) => ({ ...c })); if (!arr[i].open) arr[i].flag = !arr[i].flag; setCells(arr); };
  const reset = () => { setCells(build()); setDone(null); };

  return (
    <div className="text-center">
      <div className="font-mono text-sm mb-3" style={{ color: 'var(--muted)' }}>
        {done === 'win' ? '🎉 Cleared!' : done === 'lose' ? '💥 Boom!' : 'left-click open · right-click flag'}
      </div>
      <div style={{ display: 'inline-grid', gridTemplateColumns: `repeat(${SIZE},28px)`, gap: 3 }}>
        {cells.map((c) => (
          <button key={c.i} onClick={() => click(c.i)} onContextMenu={(e) => flag(e, c.i)}
            style={{ width: 28, height: 28, borderRadius: 6, fontSize: 13, fontWeight: 700, border: '1px solid var(--line)',
              background: c.open ? 'var(--surface)' : 'var(--surface2)',
              color: c.mine ? '#ff5577' : ['', '#4ad9ff', '#7c6cff', '#ffb84a', '#ff7ad9', '#fff'][c.n] || 'var(--ink)' }}>
            {c.flag ? '🚩' : c.open ? (c.mine ? '💣' : c.n || '') : ''}
          </button>
        ))}
      </div>
      <div className="mt-3"><button onClick={reset} className="tag">New game</button></div>
    </div>
  );
}
