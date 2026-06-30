import { useState } from 'react';
import site from '../config/siteConfig';
import Section from './Section';
import Icon from './Icon';

export default function Skills() {
  const [tab, setTab] = useState('ALL');
  const list = site.skills.filter((s) => tab === 'ALL' || s.cat === tab);

  return (
    <Section id="skills" kicker="Skills" title="What I build with.">
      <div className="reveal flex items-center gap-4 mb-7">
        <div className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: 'var(--surface2)', border: '1px solid var(--line)', color: 'var(--accent)' }}><Icon name="build" size={24} /></div>
        <div>
          <div className="font-bold text-lg" style={{ color: 'var(--ink)' }}>Skill Set</div>
          <div className="font-mono text-xs" style={{ color: 'var(--dim)' }}>{site.handle} · full-stack &amp; ai</div>
        </div>
      </div>

      <div className="reveal flex flex-wrap gap-2.5 mb-9">
        {site.skillTabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className="font-mono text-xs px-4 py-2.5 rounded-full transition"
            style={{ border: '1px solid var(--line)', background: tab === t ? 'var(--ink)' : 'transparent', color: tab === t ? 'var(--bg)' : 'var(--muted)' }}>
            {t}
          </button>
        ))}
      </div>

      <div className="reveal grid sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
        {list.map((s) => (
          <div key={s.name} className="card widget-panel p-6 md:p-7 min-h-[220px]" style={{ background: 'var(--surface2)' }}>
            <div className="flex items-start justify-between mb-5">
              <span style={{ color: 'var(--accent)' }}><Icon name={s.icon} size={30} /></span>
              <span className="font-mono text-[10px] px-2.5 py-1 rounded-full inline-flex items-center gap-1" style={{ border: '1px solid var(--line)', color: 'var(--accent)' }}><Icon name="hexagon" size={11} fill /> {s.cat}</span>
            </div>
            <h3 className="font-bold text-[20px] mb-2" style={{ color: 'var(--ink)' }}>{s.name}</h3>
            <p className="text-[15px] leading-7" style={{ color: 'var(--muted)' }}>{s.desc}</p>
          </div>
        ))}
      </div>

      <div className="reveal font-mono text-xs mt-7" style={{ color: 'var(--dim)' }}>
        {list.length} skills{tab !== 'ALL' ? ` in ${tab}` : ' total'}
      </div>
    </Section>
  );
}
