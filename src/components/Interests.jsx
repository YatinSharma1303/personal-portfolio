import site from '../config/siteConfig';
import Section from './Section';
import Icon from './Icon';

export default function Interests() {
  return (
    <Section id="interests" kicker="Beyond the screen" title="Off the keyboard.">
      <div className="grid md:grid-cols-3 gap-5">
        {site.interests.map((it) => (
          <div key={it.name} className="reveal card p-7" style={{ background: 'var(--surface2)' }}>
            <div className="mb-4" style={{ color: 'var(--accent)' }}><Icon name={it.icon} size={32} /></div>
            <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--ink)' }}>{it.name}</h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{it.line}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
