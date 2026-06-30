import { useState, useEffect } from 'react';
import Icon from './Icon';

const navItems = [
  { id: 'hero', label: 'Home', icon: 'home' },
  { id: 'about', label: 'About', icon: 'person' },
  { id: 'skills', label: 'Skills', icon: 'auto_awesome' },
  { id: 'projects', label: 'Projects', icon: 'code' },
  { id: 'contact', label: 'Contact', icon: 'forum' },
];

export default function Topbar({ theme, toggleTheme, player, setPlayer, onGames, gamesOpen, closeGames, onOpenPanel }) {
  const [active, setActive] = useState('hero');

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: '-45% 0px -50% 0px' }
    );
    navItems.forEach((n) => { const el = document.getElementById(n.id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);

  const go = (e, id) => {
    e.preventDefault();
    e.currentTarget.blur();
    if (gamesOpen) {
      closeGames?.();
      // Wait a tick for the overlay to unmount / body scroll to unlock
      // before scrolling to the target section.
      requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
      });
    } else {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleGamesClick = (e) => {
    e.currentTarget.blur();
    onGames?.();
  };

  return (
    <header className="topbar-container">
      <nav className="topbar-pill">
        <div className="topbar-nav-icons">
          {navItems.map((n) => (
            <a key={n.id} href={`#${n.id}`} onClick={(e) => go(e, n.id)} title={n.label}
               className={`tb-icon-btn ${!gamesOpen && active === n.id ? 'active' : ''}`}>
              <Icon name={n.icon} size={20} fill={!gamesOpen && active === n.id} />
            </a>
          ))}
          <button type="button" onClick={handleGamesClick} title="Playground"
                  className={`tb-icon-btn ${gamesOpen ? 'active' : ''}`}>
            <Icon name="sports_esports" size={20} fill={gamesOpen} />
          </button>
        </div>

        <div className="topbar-divider" />

        <div className="topbar-music-widget">
          <div className={`tb-music-icon ${player.playing ? 'spinning' : ''}`}
               onClick={() => setPlayer((p) => ({ ...p, playing: !p.playing }))} title="Play / pause">
            <Icon name="music_note" size={16} fill />
          </div>
          <div className="tb-music-text" onClick={onOpenPanel} title="Player controls">
            <div className="tb-track-title">{player.title}</div>
            <div className="tb-track-artist">{player.artist}</div>
          </div>
          {player.playing ? (
            <div className="tb-eq-bars" onClick={onOpenPanel} title="Player controls">
              <span className="bar bar1" /><span className="bar bar2" /><span className="bar bar3" />
            </div>
          ) : (
            <div className="tb-three-dots" onClick={onOpenPanel} title="Player controls">
              <span /><span /><span />
            </div>
          )}
          <div style={{ width: 1, height: 16, background: 'var(--line)', flexShrink: 0 }} />
          <button onClick={toggleTheme} className="tb-theme-btn" title="Toggle theme">
            <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} size={16} />
          </button>
        </div>
      </nav>
    </header>
  );
}