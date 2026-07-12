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

  /* Check cache */
  var cached = _lfmCache[cacheKey];
  if (cached && Date.now() - cached.ts < LFM_CACHE_TTL) {
    res.setHeader('X-LastFM-Cache', 'HIT');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(cached.body);
  }

  var lfmUrl = LFM_API + '?' + params.toString();

  try {
    var response = await fetch(lfmUrl);
    var body = await response.text();

    if (!response.ok) {
      /* Don't cache errors */
      return res.status(response.status).json({ ok: false, error: 'Last.fm API error', status: response.status });
    }

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
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(body);
  } catch (error) {
    console.error('Last.fm proxy error:', error);
    return res.status(502).json({ ok: false, error: 'Failed to reach Last.fm API' });
  }
};
