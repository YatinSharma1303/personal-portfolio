import { useState, useEffect } from 'react';
import site from '../config/siteConfig';
import Section from './Section';
import useGitHubProfile from '../hooks/useGitHubProfile';
import Icon from './Icon';

function QuoteCard() {
  const [i, setI] = useState(() => Math.floor(Math.random() * site.quotes.length));
  const q = site.quotes[i];
  const next = () => setI((v) => (v + 1) % site.quotes.length);
  return (
    <div className="card widget-panel p-7 md:p-8 min-h-[260px]" style={{ background: 'var(--surface2)' }}>
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--dim)' }}>Random Quote</span>
        <button onClick={next} className="tag inline-flex items-center gap-1.5"><Icon name="autorenew" size={14} /> Swap</button>
      </div>
      <div className="text-[34px] leading-none mb-3" style={{ color: 'var(--accent)' }}>“</div>
      <p className="text-[20px] md:text-[22px] font-medium leading-snug" style={{ color: 'var(--ink)' }}>{q.text}</p>
      <div className="font-mono text-xs mt-4" style={{ color: 'var(--muted)' }}>— {q.by}</div>
    </div>
  );
}

function ClockCard() {
  const [now, setNow] = useState(new Date());
  const [h12, setH12] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const fmt = (tz) =>
    new Intl.DateTimeFormat('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: h12, timeZone: tz,
    }).format(now);
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const sameTz = localTz === site.clock.tz;

  return (
    <div className="card widget-panel p-7 md:p-8 min-h-[260px]" style={{ background: 'var(--surface2)' }}>
      <div className="flex items-center justify-between mb-5">
        <span className="font-mono text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--dim)' }}>Time Link</span>
        <button onClick={() => setH12((v) => !v)} className="tag">{h12 ? '12H' : '24H'}</button>
      </div>
      <div className="grid grid-cols-2 gap-5">
        <div className="rounded-[22px] p-5 flex flex-col" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
          <div className="font-mono text-[10px] tracking-[0.18em] uppercase" style={{ color: 'var(--dim)' }}>India</div>
          <div className="text-[28px] md:text-[32px] font-extrabold font-mono mt-4" style={{ color: 'var(--ink)' }}>{fmt(site.clock.tz)}</div>
          <div className="font-mono text-[11px] mt-2" style={{ color: 'var(--muted)' }}>{site.clock.gmt} · my time</div>
        </div>
        <div className="rounded-[22px] p-5 flex flex-col" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
          <div className="font-mono text-[10px] tracking-[0.18em] uppercase" style={{ color: 'var(--dim)' }}>Visitor</div>
          <div className="text-[28px] md:text-[32px] font-extrabold font-mono mt-4" style={{ color: sameTz ? 'var(--dim)' : 'var(--accent)' }}>
            {sameTz ? '—' : fmt(localTz)}
          </div>
          <div className="font-mono text-[11px] mt-2" style={{ color: 'var(--muted)' }}>
            {sameTz ? 'same timezone' : 'your time'}
          </div>
        </div>
      </div>
    </div>
  );
}

function BioCard() {
  const p = site.profile;
  return (
    <div className="card widget-panel p-7 md:p-8 min-h-[280px]" style={{ background: 'var(--surface2)' }}>
      <div className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4" style={{ color: 'var(--dim)' }}>
        {site.handle}’s bio
      </div>
      <div className="flex items-center gap-3 mb-5">
        <span className="text-lg">{p.countryFlag}</span>
        <span className="font-semibold text-lg" style={{ color: 'var(--ink)' }}>{p.city}, {p.country}</span>
      </div>

      <div className="font-mono text-[11px] tracking-wide uppercase mb-2" style={{ color: 'var(--accent)' }}>Interests</div>
      <p className="text-[15px] leading-7 mb-5" style={{ color: 'var(--muted)' }}>{p.interests}</p>

      <div className="font-mono text-[11px] tracking-wide uppercase mb-3" style={{ color: 'var(--accent)' }}>Daily Stack</div>
      <div className="flex flex-wrap gap-2.5">
        {p.dailyStack.map((t) => <span key={t} className="tag">{t}</span>)}
      </div>
    </div>
  );
}

function GitHubCard() {
  const g = useGitHubProfile(site.widgets.github);
  return (
    <div className="card widget-panel p-7 md:p-8 min-h-[280px]" style={{ background: 'var(--surface2)' }}>
      <div className="flex items-center gap-4 mb-4">
        <img src={g?.avatar_url || '/avatar.png'} alt="" className="w-14 h-14 rounded-full" style={{ border: '1px solid var(--line)' }} />
        <div>
          <div className="font-bold text-lg" style={{ color: 'var(--ink)' }}>{g?.name || site.name}</div>
          <div className="font-mono text-xs" style={{ color: 'var(--dim)' }}>@{site.widgets.github} · GitHub</div>
        </div>
      </div>
      {g?.bio && <p className="text-[15px] leading-7 mb-4" style={{ color: 'var(--muted)' }}>{g.bio}</p>}
      <div className="font-mono text-[11px] mb-5" style={{ color: 'var(--muted)' }}>
        {site.profile.city}, {site.profile.country} · React · Python · AI
      </div>
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[['Repos', g?.public_repos], ['Followers', g?.followers], ['Following', g?.following]].map(([l, v]) => (
          <div key={l} className="text-center rounded-[20px] py-4" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
            <div className="text-[24px] font-extrabold" style={{ color: 'var(--ink)' }}>{v ?? '—'}</div>
            <div className="font-mono text-[10px] mt-1" style={{ color: 'var(--dim)' }}>{l}</div>
          </div>
        ))}
      </div>
      <a href={`https://github.com/${site.widgets.github}`} target="_blank" rel="noopener" className="tag inline-flex items-center gap-1.5">Visit GitHub <Icon name="north_east" size={14} /></a>
    </div>
  );
}

export default function About() {
  return (
    <Section id="about" kicker="About" title="Owning the whole stack.">
      <div className="reveal space-y-5 max-w-3xl mb-14">
        {site.bio.map((para, i) => (
          <p key={i} className="text-lg leading-relaxed" style={{ color: 'var(--muted)' }}
             dangerouslySetInnerHTML={{ __html: para.replace(/(full-stack|React|Python|machine learning|AI)/gi, '<b style="color:var(--ink)">$1</b>') }} />
        ))}
      </div>

      <div className="reveal grid md:grid-cols-2 gap-6 md:gap-7 items-stretch">
        <QuoteCard />
        <ClockCard />
        <BioCard />
        <GitHubCard />
      </div>
    </Section>
  );
}