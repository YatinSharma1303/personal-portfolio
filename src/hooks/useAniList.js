import { useEffect, useState } from 'react';

const QUERY = `
query ($name: String) {
  User(name: $name) { avatar { large } statistics { anime { count episodesWatched minutesWatched } } }
  MediaListCollection(userName: $name, type: ANIME, status_in: [CURRENT, COMPLETED, PLANNING], sort: UPDATED_TIME_DESC) {
    lists { entries { status progress score(format: POINT_10) media { title { romaji english } coverImage { medium } siteUrl episodes } } }
  }
}`;

export default function useAniList(username) {
  const [state, setState] = useState({ avatar: null, count: 0, episodes: 0, mins: 0, entries: [], loading: true });
  useEffect(() => {
    if (!username) return;
    fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { name: username } }),
    })
      .then((r) => r.json())
      .then((j) => {
        const d = j?.data;
        if (!d) return setState((s) => ({ ...s, loading: false }));
        const entries = (d.MediaListCollection?.lists || []).flatMap((l) => l.entries || []);
        const seen = new Set();
        const unique = entries.filter((e) => {
          const id = e.media?.siteUrl;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        const st = d.User?.statistics?.anime || {};
        setState({
          avatar: d.User?.avatar?.large,
          count: st.count || 0,
          episodes: st.episodesWatched || 0,
          mins: st.minutesWatched || 0,
          entries: unique,
          loading: false,
        });
      })
      .catch(() => setState((s) => ({ ...s, loading: false })));
  }, [username]);
  return state;
}
