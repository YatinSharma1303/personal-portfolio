import site from '../config/siteConfig';
import Section from './Section';
import useGitHub from '../hooks/useGitHub';
import Icon from './Icon';

export default function Projects() {
  const { repos } = useGitHub(site.widgets.github);

  return (
    <Section id="projects" kicker="Projects" title="Things I've built.">
      <div className="grid md:grid-cols-2 gap-7">
        {site.projects.map((p) => (
          <a key={p.name} href={p.link} target="_blank" rel="noopener" className="reveal card widget-panel overflow-hidden group flex flex-col h-full" style={{ background: 'var(--surface2)' }}>
            <div style={{ aspectRatio: '16/9', background: 'linear-gradient(135deg,var(--surface),var(--surface2))', overflow: 'hidden', flexShrink: 0 }}>
              <img src={p.image} alt={p.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                   onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            </div>
            <div className="p-7 md:p-8 flex flex-col flex-1">
              <div className="font-mono text-xs mb-3" style={{ color: 'var(--accent)' }}>{p.meta}</div>
              <h3 className="text-[30px] leading-tight font-bold mb-4" style={{ color: 'var(--ink)' }}>{p.name}</h3>
              <p className="text-[15px] leading-7 mb-5" style={{ color: 'var(--muted)' }}>{p.desc}</p>
              <div className="flex flex-wrap gap-2.5 mb-5">
                {p.tags.map((t) => <span key={t} className="tag">{t}</span>)}
              </div>
              <div className="inline-flex items-center gap-1.5 font-mono text-xs mt-auto pt-1" style={{ color: 'var(--ink)' }}>
                Open project <Icon name="north_east" size={15} />
              </div>
            </div>
          </a>
        ))}
      </div>

      {repos.length > 0 && (
        <>
          <div className="reveal font-mono text-xs tracking-[0.2em] uppercase mt-16 mb-6" style={{ color: 'var(--dim)' }}>
            Live from GitHub
          </div>
          <div className="reveal grid sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
            {repos.map((r) => (
              <a key={r.id} href={r.html_url} target="_blank" rel="noopener" className="card widget-panel p-5 md:p-6 min-h-[180px] flex flex-col h-full" style={{ background: 'var(--surface2)' }}>
                <div className="font-semibold text-[15px] mb-2" style={{ color: 'var(--ink)' }}>{r.name}</div>
                <div className="text-[13px] leading-6 mb-4 line-clamp-3" style={{ color: 'var(--muted)' }}>{r.description || '—'}</div>
                <div className="flex items-center gap-3 font-mono text-[11px] mt-auto" style={{ color: 'var(--dim)' }}>
                  {r.language && <span>{r.language}</span>}
                  <span>★ {r.stargazers_count}</span>
                </div>
              </a>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}