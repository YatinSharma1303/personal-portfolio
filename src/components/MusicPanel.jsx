import site from '../config/siteConfig';
import Icon from './Icon';

export default function MusicPanel({ open, onClose, player, setPlayer, progress, volume, setVolume, onSeek }) {
  const ytUrl = `https://www.youtube.com/watch?v=${site.music.videoId}`;
  const art = `https://i.ytimg.com/vi/${site.music.videoId}/hqdefault.jpg`;
  const fmt = (s) => {
    if (!s || Number.isNaN(s)) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };
  const pct = progress.duration ? (progress.current / progress.duration) * 100 : 0;

  const seek = (e) => {
    if (!onSeek || !progress.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - rect.left) / rect.width) * progress.duration);
  };

  return (
    <div className={`slide-player-panel ${open ? 'open' : ''}`}>
      <div className="sp-header">
        <div className="sp-brand"><span className="sp-brand-dot" /><span>PLAYER CONTROLS</span></div>
        <button className="sp-close-btn" onClick={onClose} title="Close">×</button>
      </div>

      <div className="sp-art-wrap">
        <div className={`sp-vinyl ${player.playing ? 'animate-spinSlow' : ''}`} style={{ backgroundImage: `url('${art}')` }} />
      </div>

      <div className="sp-title">{player.title}</div>
      <div className="sp-artist">{player.artist} • YT Music</div>

      <div className="sp-progress-box">
        <div className="sp-progress-bar" onClick={seek}>
          <div className="sp-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="sp-time-row">
          <span>{fmt(progress.current)}</span>
          <span>{fmt(progress.duration)}</span>
        </div>
      </div>

      <div className="sp-controls">
        <button className="sp-btn" onClick={() => onSeek && onSeek(Math.max(0, progress.current - 10))} title="Back 10s">
          <Icon name="replay_10" size={22} />
        </button>
        <button className="sp-btn sp-play-btn" onClick={() => setPlayer((p) => ({ ...p, playing: !p.playing }))} title="Play / pause">
          <Icon name={player.playing ? 'pause' : 'play_arrow'} size={26} fill weight={600} />
        </button>
        <a className="sp-btn" href={ytUrl} target="_blank" rel="noopener" title="Open on YouTube">
          <Icon name="open_in_new" size={20} />
        </a>
        <button className="sp-btn" onClick={() => onSeek && onSeek(progress.current + 10)} title="Forward 10s">
          <Icon name="forward_10" size={22} />
        </button>
      </div>

      <div className="sp-volume-row">
        <Icon name={volume === 0 ? 'volume_off' : volume < 50 ? 'volume_down' : 'volume_up'} size={20} />
        <input className="sp-vol-slider" type="range" min="0" max="100" value={volume}
               onChange={(e) => setVolume(Number(e.target.value))} />
        <span className="font-mono" style={{ fontSize: 11, color: 'var(--dim)', minWidth: 30 }}>{volume}%</span>
      </div>
    </div>
  );
}
