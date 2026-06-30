import site from '../config/siteConfig';
import Section from './Section';
import Icon from './Icon';
import useLastFM from '../hooks/useLastFM';

const Stat = ({ value, label }) => (
  <div className="card p-5 text-center" style={{ background: 'var(--surface2)' }}>
    <div className="text-3xl font-extrabold" style={{ color: 'var(--ink)' }}>{value ?? '—'}</div>
    <div className="font-mono text-[11px] tracking-wide mt-1" style={{ color: 'var(--dim)' }}>{label}</div>
  </div>
);

export default function LastFM() {
  const { data, enabled } = useLastFM(site.widgets.lastfm);
  return (
    <Section id="lastfm" kicker="Music" title="On repeat.">
      <div className="reveal flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full grid place-items-center" style={{ background: 'var(--surface2)', border: '1px solid var(--line)', color: 'var(--accent)' }}><Icon name="music_note" size={20} fill /></div>
          <div>
            <div className="font-bold" style={{ color: 'var(--ink)' }}>{site.widgets.lastfm}</div>
            <div className="font-mono text-xs" style={{ color: 'var(--dim)' }}>Last.fm · scrobbler</div>
          </div>
        </div>
        <a href={`https://www.last.fm/user/${site.widgets.lastfm}`} target="_blank" rel="noopener" className="tag">View Profile ↗</a>
      </div>
      <div className="reveal grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat value={data?.scrobbles} label="SCROBBLES" />
        <Stat value={data?.artists} label="ARTISTS" />
        <Stat value={data?.tracks} label="TRACKS" />
        <Stat value={data?.albums} label="ALBUMS" />
      </div>
      {!enabled && (
        <p className="reveal font-mono text-xs mt-4" style={{ color: 'var(--dim)' }}>
          Add VITE_LASTFM_API_KEY in .env to show live stats.
        </p>
      )}
    </Section>
  );
}
