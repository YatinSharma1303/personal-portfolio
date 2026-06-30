import site from '../config/siteConfig';

const LABELS = {
  github: 'GitHub', telegram: 'Telegram', instagram: 'Instagram', discord: 'Discord',
  youtube: 'YouTube', twitter: 'Twitter / X', linkedin: 'LinkedIn', linktree: 'Linktree',
};

export default function Footer({ onGames }) {
  const links = Object.entries(site.socials).filter(([, v]) => v);
  const pretty = (url) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return (
    <footer className="relative z-10 border-t mt-10" style={{ borderColor: 'var(--line)' }}>
      <div className="max-w-5xl mx-auto px-5 py-14">
        <div className="font-mono text-xs tracking-[0.3em] uppercase mb-2" style={{ color: 'var(--accent)' }}>
          My Online Presence
        </div>
        <div className="text-4xl font-extrabold mb-8" style={{ color: 'var(--ink)' }}>{site.name}</div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-10">
          {links.map(([k, v]) => (
            <a key={k} href={v} target="_blank" rel="noopener"
               className="card px-4 py-3 flex items-center justify-between group" style={{ background: 'var(--surface2)' }}>
              <div className="min-w-0">
                <div className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{LABELS[k] || k}</div>
                <div className="font-mono text-[11px] truncate" style={{ color: 'var(--dim)' }}>{pretty(v)}</div>
              </div>
              <span style={{ color: 'var(--muted)', display:'inline-flex' }} className="material-symbols-rounded">arrow_forward</span>
            </a>
          ))}
          {/* Email + live widgets as presence entries */}
          <a href={`mailto:${site.email}`} className="card px-4 py-3 flex items-center justify-between" style={{ background: 'var(--surface2)' }}>
            <div className="min-w-0">
              <div className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Email</div>
              <div className="font-mono text-[11px] truncate" style={{ color: 'var(--dim)' }}>{site.email}</div>
            </div>
            <span style={{ color: 'var(--muted)', display:'inline-flex' }} className="material-symbols-rounded">arrow_forward</span>
          </a>
          {site.widgets.anilist && (
            <a href={`https://anilist.co/user/${site.widgets.anilist}/`} target="_blank" rel="noopener" className="card px-4 py-3 flex items-center justify-between" style={{ background: 'var(--surface2)' }}>
              <div className="min-w-0">
                <div className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>AniList</div>
                <div className="font-mono text-[11px] truncate" style={{ color: 'var(--dim)' }}>anilist.co/user/{site.widgets.anilist}</div>
              </div>
              <span style={{ color: 'var(--muted)', display:'inline-flex' }} className="material-symbols-rounded">arrow_forward</span>
            </a>
          )}
          {site.widgets.lastfm && (
            <a href={`https://www.last.fm/user/${site.widgets.lastfm}`} target="_blank" rel="noopener" className="card px-4 py-3 flex items-center justify-between" style={{ background: 'var(--surface2)' }}>
              <div className="min-w-0">
                <div className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Last.fm</div>
                <div className="font-mono text-[11px] truncate" style={{ color: 'var(--dim)' }}>last.fm/user/{site.widgets.lastfm}</div>
              </div>
              <span style={{ color: 'var(--muted)', display:'inline-flex' }} className="material-symbols-rounded">arrow_forward</span>
            </a>
          )}
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="font-mono text-xs" style={{ color: 'var(--dim)' }}>
            © {new Date().getFullYear()} {site.copyrightName} · {site.footerTagline}
          </div>
          <button onClick={onGames} className="tag">playground 🎮</button>
        </div>
      </div>
    </footer>
  );
}
