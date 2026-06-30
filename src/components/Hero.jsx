import site from '../config/siteConfig';
import Icon from './Icon';

export default function Hero({ onGames }) {
  return (
    <section id="hero" className="relative min-h-screen flex items-center max-w-[1280px] mx-auto px-5 md:px-8 pt-32 pb-20">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-12 xl:gap-16 items-center w-full">
        <div className="reveal in">
          <span className="tag inline-block mb-7">{site.title}</span>
          <h1 className="font-extrabold leading-[0.92]" style={{ fontSize: 'clamp(46px,8vw,102px)', color: 'var(--ink)' }}>
            {site.tagline[0]}<br />
            <span style={{ background: 'linear-gradient(120deg,var(--accent),var(--accent2))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {site.tagline[1]}
            </span>
          </h1>
          <p className="mt-7 max-w-2xl text-[17px] md:text-[19px] leading-8" style={{ color: 'var(--muted)' }}>{site.heroLine}</p>

          <div className="mt-6 flex flex-wrap gap-2.5">
            {['AI Apps', 'Web Platforms', 'React', 'Python'].map((t) => (
              <span key={t} className="tag">{t}</span>
            ))}
          </div>

          <div className="mt-9 flex flex-wrap gap-3">
            <a href="#projects" className="btn-pill px-7 py-3.5 font-semibold text-sm" style={{ background: 'var(--ink)', color: 'var(--bg)' }}>
              View Projects
            </a>
            <a href={site.socials.github} target="_blank" rel="noopener" className="btn-pill px-7 py-3.5 font-semibold text-sm inline-flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
              GitHub <Icon name="north_east" size={16} />
            </a>
            <button onClick={onGames} className="btn-pill px-7 py-3.5 font-semibold text-sm inline-flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
              Play <Icon name="sports_esports" size={18} />
            </button>
          </div>
        </div>

        <div
          className="reveal card widget-panel p-7 md:p-8 hidden lg:block"
          style={{
            background: 'color-mix(in srgb, var(--surface2) 88%, transparent)',
            backdropFilter: 'blur(16px)',
            minHeight: 420,
          }}
        >
          <div className="flex items-center gap-4 mb-6">
            <img src="/avatar.png" alt={site.name} className="w-14 h-14 rounded-full" style={{ border: '1px solid var(--line)' }} />
            <div>
              <div className="font-mono text-[10px] tracking-[0.24em] uppercase" style={{ color: 'var(--dim)' }}>welcome</div>
              <div className="font-bold text-lg" style={{ color: 'var(--ink)' }}>{site.name}</div>
            </div>
          </div>

          <p className="text-[15px] leading-7 mb-5" style={{ color: 'var(--muted)' }}>
            Hi, I’m {site.name.split(' ')[0]} — I build AI apps, web platforms, and small experiments. Full-stack, end to end.
          </p>

          <div className="font-mono text-[11px] mb-5" style={{ color: 'var(--dim)' }}>{site.email}</div>

          <div className="flex items-center gap-2.5 mb-6 font-mono text-[11px]" style={{ color: 'var(--muted)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: '#1d8f5e', display: 'inline-block', boxShadow: '0 0 16px rgba(29,143,94,.55)' }} />
            now · <i style={{ color: 'var(--ink)', fontStyle: 'italic' }}>{site.profile.nowStatus}</i>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="rounded-[20px] p-4" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] mb-2" style={{ color: 'var(--dim)' }}>Location</div>
              <div className="font-semibold" style={{ color: 'var(--ink)' }}>{site.profile.city}, {site.profile.country}</div>
            </div>
            <div className="rounded-[20px] p-4" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] mb-2" style={{ color: 'var(--dim)' }}>Focus</div>
              <div className="font-semibold" style={{ color: 'var(--ink)' }}>Frontend + AI</div>
            </div>
          </div>

          <div className="flex gap-2.5 flex-wrap">
            <button onClick={onGames} className="tag inline-flex items-center gap-1.5"><Icon name="sports_esports" size={14} /> Games</button>
            <a href={site.socials.github} target="_blank" rel="noopener" className="tag inline-flex items-center gap-1.5"><Icon name="code" size={14} /> GitHub</a>
          </div>
        </div>
      </div>

      <a href="#about" className="absolute bottom-6 left-1/2 -translate-x-1/2 animate-floatY" style={{ color: 'var(--dim)' }}><Icon name="keyboard_arrow_down" size={28} /></a>
    </section>
  );
}
