import { useState, useMemo } from 'react';
import site from '../config/siteConfig';
import Section from './Section';
import useAniList from '../hooks/useAniList';

const TABS = [
  { id: 'ALL', match: () => true },
  { id: 'WATCHING', match: (e) => e.status === 'CURRENT' },
  { id: 'COMPLETED', match: (e) => e.status === 'COMPLETED' },
  { id: 'PLANNING', match: (e) => e.status === 'PLANNING' },
];
const PER_PAGE = 12;

export default function AniList() {
  const { entries, avatar, count, episodes, mins, loading } = useAniList(site.widgets.anilist);
  const [tab, setTab] = useState('ALL');
  const [page, setPage] = useState(1);

  const filtered = useMemo(
    () => entries.filter(TABS.find((t) => t.id === tab).match),
    [entries, tab]
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const cur = Math.min(page, pages);
  const slice = filtered.slice((cur - 1) * PER_PAGE, cur * PER_PAGE);
  const setTabReset = (t) => { setTab(t); setPage(1); };

  return (
    <Section id="anilist" kicker="Anime" title="On my list.">
      <div className="reveal flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <img src={avatar || '/avatar.png'} alt="" className="w-11 h-11 rounded-full" style={{ border: '1px solid var(--line)' }} />
          <div>
            <div className="font-bold" style={{ color: 'var(--ink)' }}>{site.widgets.anilist}</div>
            <div className="font-mono text-xs" style={{ color: 'var(--dim)' }}>AniList · anime list</div>
          </div>
        </div>
        <a href={`https://anilist.co/user/${site.widgets.anilist}/`} target="_blank" rel="noopener" className="tag">View Profile ↗</a>
      </div>

      <div className="reveal flex flex-wrap gap-2 mb-6">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTabReset(t.id)} className="font-mono text-xs px-4 py-2 rounded-full"
            style={{ border: '1px solid var(--line)', background: tab === t.id ? 'var(--ink)' : 'transparent', color: tab === t.id ? 'var(--bg)' : 'var(--muted)' }}>
            {t.id}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="reveal font-mono text-sm" style={{ color: 'var(--dim)' }}>Loading anime…</div>
      ) : slice.length === 0 ? (
        <div className="reveal font-mono text-sm" style={{ color: 'var(--dim)' }}>No entries here yet.</div>
      ) : (
        <>
          <div className="reveal grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {slice.map((e, i) => (
              <a key={i} href={e.media.siteUrl} target="_blank" rel="noopener" className="card overflow-hidden group relative" style={{ background: 'var(--surface2)' }}>
                <div className="relative">
                  <img src={e.media.coverImage.medium} alt="" className="w-full transition-transform group-hover:scale-105" style={{ aspectRatio: '2/3', objectFit: 'cover' }} />
                  {e.score > 0 && (
                    <span className="absolute top-1 right-1 font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,0,0,0.7)', color: '#ffd24a' }}>
                      ★ {e.score}
                    </span>
                  )}
                </div>
                <div className="p-2">
                  <div className="text-[11px] font-medium line-clamp-2 mb-1" style={{ color: 'var(--ink)' }}>
                    {e.media.title.english || e.media.title.romaji}
                  </div>
                  <div className="font-mono text-[10px]" style={{ color: 'var(--dim)' }}>
                    {e.progress}{e.media.episodes ? `/${e.media.episodes}` : ''} eps
                  </div>
                </div>
              </a>
            ))}
          </div>

          {pages > 1 && (
            <div className="reveal flex items-center justify-center gap-2 mt-6 font-mono text-sm">
              <button onClick={() => setPage(Math.max(1, cur - 1))} disabled={cur === 1} className="tag" style={{ opacity: cur === 1 ? 0.4 : 1 }}>‹</button>
              <span style={{ color: 'var(--muted)' }}>{cur} / {pages}</span>
              <button onClick={() => setPage(Math.min(pages, cur + 1))} disabled={cur === pages} className="tag" style={{ opacity: cur === pages ? 0.4 : 1 }}>›</button>
            </div>
          )}
        </>
      )}

      {!loading && count > 0 && (
        <div className="reveal font-mono text-xs mt-6 text-center" style={{ color: 'var(--dim)' }}>
          {count} anime · {episodes.toLocaleString()} episodes · {Math.round(mins / 60).toLocaleString()} hrs watched
        </div>
      )}
    </Section>
  );
}
