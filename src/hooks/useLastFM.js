import { useEffect, useState } from 'react';

// Last.fm needs a free API key. Put it in .env as VITE_LASTFM_API_KEY.
export default function useLastFM(username) {
  const [data, setData] = useState(null);
  const key = import.meta.env.VITE_LASTFM_API_KEY;
  useEffect(() => {
    if (!username || !key) return;
    const base = `https://ws.audioscrobbler.com/2.0/?api_key=${key}&format=json&user=${username}`;
    Promise.all([
      fetch(`${base}&method=user.getinfo`).then((r) => r.json()),
      fetch(`${base}&method=user.gettopartists&limit=1`).then((r) => r.json()),
      fetch(`${base}&method=user.gettoptracks&limit=1`).then((r) => r.json()),
      fetch(`${base}&method=user.gettopalbums&limit=1`).then((r) => r.json()),
    ])
      .then(([info, artists, tracks, albums]) => {
        setData({
          scrobbles: info?.user?.playcount,
          avatar: info?.user?.image?.slice(-1)[0]?.['#text'],
          artists: artists?.topartists?.['@attr']?.total,
          tracks: tracks?.toptracks?.['@attr']?.total,
          albums: albums?.topalbums?.['@attr']?.total,
        });
      })
      .catch(() => {});
  }, [username, key]);
  return { data, enabled: Boolean(key) };
}
