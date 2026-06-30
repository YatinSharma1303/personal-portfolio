import { useState } from 'react';
import site from '../../config/siteConfig';
import Icon from '../Icon';
import Snake from './Snake';
import Pong from './Pong';
import Quiz from './Quiz';
import Flappy from './Flappy';
import Minesweeper from './Minesweeper';
import Reaction from './Reaction';
import Dodge from './Dodge';

const MAP = {
  snake: Snake, pong: Pong, quiz: Quiz, flappy: Flappy,
  minesweeper: Minesweeper, reaction: Reaction, dodge: Dodge,
};

export default function GamesOverlay({ onClose }) {
  const [active, setActive] = useState(null);
  const games = site.games;
  const cur = active ? games.find((g) => g.id === active) : null;
  const Active = cur ? MAP[cur.id] : null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: 'var(--bg)',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div className="grid-bg" />
      <div className="orb" style={{ top: '-10%', left: '-5%', width: 480, height: 480, background: 'var(--accent)' }} />
      <div className="orb" style={{ bottom: '0%', right: '-8%', width: 520, height: 520, background: 'var(--accent2)' }} />
      <div className="relative max-w-4xl mx-auto px-5 pb-10" style={{ paddingTop: 'calc(16px + 56px + 24px)' }}>
        <button onClick={active ? () => setActive(null) : onClose} className="btn-pill px-5 py-2 text-sm font-semibold mb-8 inline-flex items-center gap-1" style={{ color: 'var(--ink)' }}>
          <Icon name="arrow_back" size={18} /> Return
        </button>

        <h2 className="text-5xl font-extrabold mb-2" style={{ color: 'var(--ink)' }}>playground<span style={{ color: 'var(--accent)' }}>.</span></h2>
        <p className="font-mono text-sm mb-10" style={{ color: 'var(--dim)' }}>games. reflexes. questionable life choices.</p>

        {!active ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {games.map((g) => (
              <button key={g.id} onClick={() => setActive(g.id)} className="card p-6 text-left hover:scale-[1.02] transition group" style={{ background: 'var(--surface2)' }}>
                <div className="mb-3" style={{ color: 'var(--accent)' }}><Icon name={g.glyph} size={32} /></div>
                <h3 className="text-xl font-bold mb-1" style={{ color: 'var(--ink)' }}>{g.name}</h3>
                <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>{g.desc}</p>
                <span className="font-mono text-xs inline-flex items-center gap-1" style={{ color: 'var(--accent)' }}>Play <Icon name="arrow_forward" size={14} /></span>
              </button>
            ))}
          </div>
        ) : (
          <div className="card p-6 max-w-2xl mx-auto" style={{ background: 'var(--surface2)' }}>
            <div className="flex items-center gap-3 mb-5">
              <span style={{ color: 'var(--accent)' }}><Icon name={cur.glyph} size={26} /></span>
              <h3 className="text-2xl font-bold" style={{ color: 'var(--ink)' }}>{cur.name}</h3>
            </div>
            <Active />
          </div>
        )}
      </div>
    </div>
  );
}