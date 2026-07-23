/* ============================================================
 api/lastfm.js - Vercel serverless function
 Proxies Last.fm API calls so the API key stays server-side.
 Called by the frontend instead of hitting Last.fm directly.

 Usage from frontend:
   /api/lastfm?method=user.getinfo&user=YATINSHARMA
   /api/lastfm?method=user.gettoptracks&user=YATINSHARMA&period=1month&limit=5
   /api/lastfm?method=track.getInfo&artist=...&track=...
   /api/lastfm?method=artist.getInfo&artist=...
   /api/lastfm?method=user.getrecenttracks&user=YATINSHARMA&limit=1

 The api_key parameter is injected server-side; never exposed to the client.
 ============================================================ */

var LFM_API = 'https://ws.audioscrobbler.com/2.0/';

/* Simple in-memory response cache (per cold-start invocation).
   Last.fm data doesn't change fast — cache for 60 seconds. */
var _lfmCache = {};
var LFM_CACHE_TTL = 60 * 1000;


async function fetchLastfmJson(params, timeoutMs) {
  timeoutMs = timeoutMs || 3500;
  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = controller ? setTimeout(function() { controller.abort(); }, timeoutMs) : null;
  try {
    var response = await fetch(LFM_API + '?' + params.toString(), controller ? { signal: controller.signal } : undefined);
    if (timer) clearTimeout(timer);
    if (!response.ok) return { ok: false, status: response.status };
    return response.json().catch(function() { return {}; });
  } catch (e) {
    if (timer) clearTimeout(timer);
    return { ok: false, error: e.message || 'timeout' };
  }
}

/* Resolve cover art from iTunes (keyless, server-side so no CORS issues,
   and reliable for anime/OST tracks that Last.fm has no art for).
   Returns a higher-res URL (400x400) or '' if nothing found. */
async function fetchItunesArt(term) {
  if (!term) return '';
  try {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 3500) : null;
    var res = await fetch('https://itunes.apple.com/search?term=' + encodeURIComponent(term) + '&entity=song&limit=1', controller ? { signal: controller.signal } : undefined);
    if (timer) clearTimeout(timer);
    if (!res.ok) return '';
    var j = await res.json();
    var hit = j && j.results && j.results[0];
    var art = hit && hit.artworkUrl100;
    return art ? art.replace('100x100bb', '400x400bb') : '';
  } catch (e) { return ''; }
}

/* user.gettoptracks / user.gettopartists return NO real cover art (only the
   Last.fm placeholder). Attach an `artUrl` to each item via iTunes, in parallel.
   Items that already have artUrl (from a cached bundle) are skipped. */
async function enrichArt(toptracks, topartists) {
  var tracks = (toptracks && toptracks.track) || [];
  var artists = (topartists && topartists.artist) || [];
  var items = [];
  tracks.forEach(function (tr) {
    if (tr.artUrl) return;
    var a = tr.artist ? (tr.artist.name || tr.artist['#text'] || '') : '';
    var term = (a + ' ' + (tr.name || '')).trim();
    if (term) items.push({ obj: tr, term: term });
  });
  artists.forEach(function (ar) {
    if (ar.artUrl) return;
    var term = (ar.name || '').trim();
    if (term) items.push({ obj: ar, term: term });
  });
  if (!items.length) return;
  await Promise.all(items.map(function (it) {
    return fetchItunesArt(it.term).then(function (url) { if (url) it.obj.artUrl = url; });
  }));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  var apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: 'Last.fm API key not configured. Set LASTFM_API_KEY env var.' });
  }

  if (req.query.bundle === '1') {
    var user = req.query.user || 'YATINSHARMA';
    var bundleKey = 'bundle:' + user;
    var cachedBundle = _lfmCache[bundleKey];
    if (cachedBundle && Date.now() - cachedBundle.ts < LFM_CACHE_TTL) {
      res.setHeader('X-LastFM-Cache', 'HIT');
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      return res.status(200).json(cachedBundle.body);
    }
    function baseParams(methodName, extra) {
      var p = new URLSearchParams();
      p.set('method', methodName);
      p.set('api_key', apiKey);
      p.set('format', 'json');
      p.set('user', user);
      Object.keys(extra || {}).forEach(function(k) { p.set(k, extra[k]); });
      return p;
    }
    try {
      var settled = await Promise.allSettled([
        fetchLastfmJson(baseParams('user.getinfo'), 3200),
        fetchLastfmJson(baseParams('user.gettoptracks', { period: '1month', limit: '5' }), 3200),
        fetchLastfmJson(baseParams('user.gettopartists', { period: '1month', limit: '5' }), 3200),
        fetchLastfmJson(baseParams('user.getrecenttracks', { limit: '10' }), 3200)
      ]);
      var results = settled.map(function(x) { return x.status === 'fulfilled' ? (x.value || {}) : {}; });
      var toptracks = results[1].toptracks || (cachedBundle && cachedBundle.body && cachedBundle.body.toptracks) || null;
      var topartists = results[2].topartists || (cachedBundle && cachedBundle.body && cachedBundle.body.topartists) || null;
      // Resolve cover art for top tracks/artists (their Last.fm endpoints ship no art).
      // Wrapped so a slow/failing iTunes call never breaks the bundle.
      try { await enrichArt(toptracks, topartists); } catch (e) {}
      var body = {
        user: results[0].user || (cachedBundle && cachedBundle.body && cachedBundle.body.user) || null,
        toptracks: toptracks,
        topartists: topartists,
        recenttracks: results[3].recenttracks || (cachedBundle && cachedBundle.body && cachedBundle.body.recenttracks) || null,
        bundledAt: Date.now(),
        partial: settled.some(function(x) { return x.status !== 'fulfilled' || (x.value && x.value.ok === false); })
      };
      if (body.user || body.toptracks || body.topartists || body.recenttracks) {
        _lfmCache[bundleKey] = { body: body, ts: Date.now() };
        res.setHeader('X-LastFM-Cache', 'MISS');
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
        return res.status(200).json(body);
      }
      if (cachedBundle && cachedBundle.body) {
        res.setHeader('X-LastFM-Cache', 'STALE');
        return res.status(200).json(cachedBundle.body);
      }
      return res.status(200).json({ ok: false, partial: true, error: 'Last.fm temporarily unavailable' });
    } catch (error) {
      console.error('Last.fm bundle error:', error);
      if (cachedBundle && cachedBundle.body) return res.status(200).json(cachedBundle.body);
      return res.status(200).json({ ok: false, error: 'Failed to build Last.fm bundle' });
    }
  }

  var method = req.query.method;
  if (!method) {
    return res.status(400).json({ ok: false, error: 'Missing "method" query parameter. Example: /api/lastfm?method=user.getinfo&user=YATINSHARMA' });
  }

  /* Only allow safe read-only methods */
  var allowedMethods = [
    'user.getinfo', 'user.gettoptracks', 'user.gettopartists',
    'user.getrecenttracks', 'user.getlovedtracks',
    'track.getInfo', 'track.getSimilar', 'track.getTopTags',
    'artist.getInfo', 'artist.getSimilar', 'artist.getTopTracks', 'artist.getTopAlbums',
    'album.getInfo', 'chart.getTopTracks', 'chart.getTopArtists'
  ];
  if (allowedMethods.indexOf(method) === -1) {
    return res.status(400).json({ ok: false, error: 'Method not allowed: ' + method });
  }

  /* Build the Last.fm URL — inject api_key + format, forward other params */
  var params = new URLSearchParams();
  params.set('method', method);
  params.set('api_key', apiKey);
  params.set('format', 'json');

  /* Forward all other query params except method (already set) and api_key/format (controlled server-side) */
  var forwardKeys = ['user', 'artist', 'track', 'album', 'period', 'limit', 'page', 'autocorrect', 'username', 'mbid', 'country', 'location', 'lang', 'from', 'to'];
  for (var i = 0; i < forwardKeys.length; i++) {
    var val = req.query[forwardKeys[i]];
    if (val) params.set(forwardKeys[i], val);
  }

  var cacheKey = params.toString();
  var isRealtimeMethod = method === 'user.getrecenttracks';

  /* Check cache. Real-time recent tracks must bypass cache so now-playing updates quickly. */
  if (!isRealtimeMethod) {
    var cached = _lfmCache[cacheKey];
    if (cached && Date.now() - cached.ts < LFM_CACHE_TTL) {
      res.setHeader('X-LastFM-Cache', 'HIT');
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(cached.body);
    }
  }

  var lfmUrl = LFM_API + '?' + params.toString();

  try {
    var response = await fetch(lfmUrl);
    var body = await response.text();

    if (!response.ok) {
      /* Don't cache errors */
      return res.status(response.status).json({ ok: false, error: 'Last.fm API error', status: response.status });
    }

    if (!isRealtimeMethod) {
      /* Cache the successful response */
      _lfmCache[cacheKey] = { body: body, ts: Date.now() };

      /* Purge stale entries (simple sweep — keeps cache from growing unbounded) */
      var keys = Object.keys(_lfmCache);
      for (var ki = 0; ki < keys.length; ki++) {
        if (Date.now() - _lfmCache[keys[ki]].ts > LFM_CACHE_TTL * 2) {
          delete _lfmCache[keys[ki]];
        }
      }
      res.setHeader('X-LastFM-Cache', 'MISS');
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    } else {
      res.setHeader('X-LastFM-Cache', 'BYPASS');
      res.setHeader('Cache-Control', 'no-store, max-age=0');
    }
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(body);
  } catch (error) {
    console.error('Last.fm proxy error:', error);
    return res.status(502).json({ ok: false, error: 'Failed to reach Last.fm API' });
  }
};
