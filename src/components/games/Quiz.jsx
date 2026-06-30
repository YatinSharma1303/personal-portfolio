import { useState } from 'react';

const Q = [
  { q: 'Which hook runs side effects in React?', a: ['useEffect', 'useState', 'useMemo', 'useRef'], c: 0 },
  { q: 'What does Vite primarily improve?', a: ['SEO', 'Dev speed & build', 'Database', 'Auth'], c: 1 },
  { q: 'Which language powers SmartHealthCare AI?', a: ['Go', 'Rust', 'Python', 'PHP'], c: 2 },
  { q: 'FAISS is used for…', a: ['Styling', 'Vector search', 'Routing', 'Testing'], c: 1 },
  { q: 'Tailwind CSS is a…', a: ['Database', 'Utility-first CSS framework', 'Bundler', 'Linter'], c: 1 },
  { q: 'What does “RAG” stand for in AI?', a: ['Random Access Grid', 'Retrieval-Augmented Generation', 'Rapid App Gateway', 'Recursive AI Graph'], c: 1 },
  { q: 'Firestore security is enforced by…', a: ['The API key', 'Security Rules', 'CSS', 'The frontend'], c: 1 },
  { q: 'Which command starts a Vite dev server?', a: ['npm run dev', 'npm test', 'git push', 'npm publish'], c: 0 },
];

export default function Quiz() {
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState(null);

  if (i >= Q.length) {
    const verdict = score === Q.length ? '🏆 Flawless. Hire this person.'
      : score >= Q.length - 2 ? '🔥 Solid stack knowledge.'
      : score >= Q.length / 2 ? '🙂 Not bad — keep building.'
      : '📚 Time to revisit the docs.';
    return (
      <div className="text-center py-8">
        <div className="text-4xl mb-3">{score >= Q.length - 1 ? '🏆' : '🎯'}</div>
        <div className="text-xl font-bold mb-1" style={{ color: 'var(--ink)' }}>{score} / {Q.length}</div>
        <div className="text-sm mb-4" style={{ color: 'var(--muted)' }}>{verdict}</div>
        <button onClick={() => { setI(0); setScore(0); setPicked(null); }} className="tag">Play again</button>
      </div>
    );
  }

  const cur = Q[i];
  const choose = (idx) => {
    if (picked !== null) return;
    setPicked(idx);
    if (idx === cur.c) setScore((s) => s + 1);
    setTimeout(() => { setPicked(null); setI((v) => v + 1); }, 800);
  };

  return (
    <div>
      <div className="font-mono text-xs mb-2" style={{ color: 'var(--dim)' }}>Question {i + 1}/{Q.length} · score {score}</div>
      <div className="text-lg font-bold mb-5" style={{ color: 'var(--ink)' }}>{cur.q}</div>
      <div className="grid gap-2">
        {cur.a.map((opt, idx) => {
          let bg = 'var(--surface)';
          if (picked !== null) { if (idx === cur.c) bg = '#1d8f5e'; else if (idx === picked) bg = '#8f3a3a'; }
          return (
            <button key={idx} onClick={() => choose(idx)} className="text-left rounded-2xl px-4 py-3 text-sm"
              style={{ background: bg, border: '1px solid var(--line)', color: picked !== null && (idx === cur.c || idx === picked) ? '#fff' : 'var(--ink)' }}>
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
