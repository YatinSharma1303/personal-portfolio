import { useRef, useState } from 'react';

export default function Reaction() {
  const [state, setState] = useState('idle'); // idle | wait | go | result
  const [ms, setMs] = useState(0);
  const [best, setBest] = useState(() => Number(localStorage.getItem('reaction_best') || 0));
  const t = useRef(0), start = useRef(0);

  const begin = () => {
    setState('wait');
    t.current = setTimeout(() => { start.current = performance.now(); setState('go'); }, 900 + Math.random() * 2500);
  };
  const click = () => {
    if (state === 'idle' || state === 'result') return begin();
    if (state === 'wait') { clearTimeout(t.current); setState('idle'); return; }
    if (state === 'go') {
      const r = Math.round(performance.now() - start.current);
      setMs(r); setState('result');
      if (!best || r < best) { setBest(r); localStorage.setItem('reaction_best', r); }
    }
  };

  const bg = state === 'go' ? '#1d8f5e' : state === 'wait' ? '#8f3a3a' : 'var(--surface)';
  const txt = {
    idle: 'Click to start', wait: 'Wait for green…', go: 'CLICK NOW!', result: `${ms} ms`,
  }[state];

  return (
    <div className="text-center">
      <div className="font-mono text-sm mb-3" style={{ color: 'var(--muted)' }}>Best: {best || '—'} ms</div>
      <button onClick={click} style={{ width: '100%', height: 220, borderRadius: 16, border: '1px solid var(--line)', background: bg, color: '#fff', fontSize: 24, fontWeight: 800 }}>
        {txt}
      </button>
      {state === 'result' && <div className="mt-3 font-mono text-xs" style={{ color: 'var(--dim)' }}>click to try again</div>}
    </div>
  );
}
