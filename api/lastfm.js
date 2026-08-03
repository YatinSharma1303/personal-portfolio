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
/* Normalize text for fuzzy matching: lowercase, drop bracketed extras and
   common noise words, keep alnum + CJK (for Japanese titles/artists). */
function normArt(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf\s]/g, ' ')
    .replace(/\b(official|lyric|lyrics|audio|video|full|hd|hq|original|ost|opening|end|ending|op|ed|theme|remaster|remastered|remix|feat|ft|version|extended|explicit|clean|mv|pv|short|tv|size|mono|stereo|sped|slowed|type)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
/* Overlap coefficient of token sets (1.0 = target tokens all present). */
function tokenOverlap(a, b) {
  var sa = normArt(a).split(' ').filter(Boolean);
  var sb = normArt(b).split(' ').filter(Boolean);
  if (!sa.length || !sb.length) return 0;
  var inter = 0;
  sa.forEach(function (w) { if (sb.indexOf(w) !== -1) inter++; });
  return inter / Math.min(sa.length, sb.length);
}

/* Raw iTunes search -> results array. */
async function itunesSearch(term, limit) {
  if (!term) return [];
  try {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 3500) : null;
    var res = await fetch('https://itunes.apple.com/search?term=' + encodeURIComponent(term) + '&entity=song&limit=' + (limit || 8), controller ? { signal: controller.signal } : undefined);
    if (timer) clearTimeout(timer);
    if (!res.ok) return [];
    var j = await res.json();
    return (j && j.results) || [];
  } catch (e) { return []; }
}

/* Pick high-res art from results ONLY when a result's artist genuinely matches
   the target (the dominant correctness signal). Artist match weighted 2x,
   track used as a tiebreaker. Returns '' on no confident match so we fall back
   to Last.fm art instead of showing wrong art. */
function pickValidArtwork(targetArtist, targetTrack, results) {
  if (!results || !results.length || !targetArtist) return '';
  var na = normArt(targetArtist);
  if (!na) return '';
  var best = null, bestScore = -1;
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var aOv = tokenOverlap(na, r.artistName);
    if (aOv < 0.6) continue; // artist must match
    var tOv = targetTrack ? tokenOverlap(targetTrack, r.trackName) : 0;
    var score = aOv * 2 + tOv;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  if (!best) return '';
  var art = best.artworkUrl100;
  return art ? art.replace('100x100bb', '600x600bb') : '';
}

async function fetchItunesTrackArt(artist, track) {
  return pickValidArtwork(artist, track, await itunesSearch((artist + ' ' + (track || '')).trim(), 8));
}
async function fetchItunesArtistArt(artist) {
  return pickValidArtwork(artist, '', await itunesSearch(artist, 5));
}

/* Persistent (warm-instance) cache of resolved cover art by artist+track.
   Lets the 12s live now-playing poll reuse art without re-hitting iTunes. */
var _lfmArtCache = {};
var ART_CACHE_TTL = 6 * 60 * 60 * 1000;

async function resolveTrackArtUrl(artist, name) {
  if (!artist || !name) return '';
  var key = artist + '::' + name;
  var cached = _lfmArtCache[key];
  if (cached && Date.now() - cached.ts < ART_CACHE_TTL) return cached.url;
  var url = await fetchItunesTrackArt(artist, name);
  if (url) _lfmArtCache[key] = { url: url, ts: Date.now() };
  return url;
}

/* Enrich the live user.getrecenttracks response with high-res `artUrl` per
   track, so Now Playing / Recently Played stay crisp on every 12s refresh. */
async function enrichRecentTracksBody(bodyText) {
  try {
    var parsed = JSON.parse(bodyText);
    var tracks = parsed && parsed.recenttracks && parsed.recenttracks.track;
    if (Array.isArray(tracks)) {
      await Promise.all(tracks.slice(0, 8).map(async function (tr) {
        if (!tr || tr.artUrl) return;
        var artist = (tr.artist && (tr.artist['#text'] || tr.artist.name)) || '';
        var url = await resolveTrackArtUrl(artist, tr.name || '');
        if (url) tr.artUrl = url;
      }));
      return JSON.stringify(parsed);
    }
  } catch (e) {}
  return bodyText;
}

/* user.gettoptracks / user.gettopartists (and the low-res recent / now-playing
   images) return poor cover art. Attach a high-res `artUrl` to each item via
   iTunes, in parallel. Items that already have artUrl are skipped. */
async function enrichArt(toptracks, topartists, recenttracks) {
  var trackItems = [], artistItems = [];
  function addTrack(tr) {
    if (!tr || tr.artUrl) return;
    var a = tr.artist ? (tr.artist.name || tr.artist['#text'] || '') : '';
    if (a && tr.name) trackItems.push({ obj: tr, artist: a, track: tr.name });
  }
  (toptracks && toptracks.track || []).forEach(addTrack);
  (recenttracks && recenttracks.track || []).slice(0, 8).forEach(addTrack);
  (topartists && topartists.artist || []).forEach(function (ar) {
    if (!ar || ar.artUrl) return;
    if (ar.name) artistItems.push({ obj: ar, artist: ar.name });
  });
  var tasks = trackItems.map(function (it) {
    return fetchItunesTrackArt(it.artist, it.track).then(function (url) { if (url) it.obj.artUrl = url; });
  }).concat(artistItems.map(function (it) {
    return fetchItunesArtistArt(it.artist).then(function (url) { if (url) it.obj.artUrl = url; });
  }));
  if (tasks.length) await Promise.all(tasks);
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
    var period = req.query.period || '1month';
    var bundleKey = 'bundle:' + user + ':' + period;
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
        fetchLastfmJson(baseParams('user.gettoptracks', { period: period, limit: '5' }), 3200),
        fetchLastfmJson(baseParams('user.gettopartists', { period: period, limit: '5' }), 3200),
        fetchLastfmJson(baseParams('user.getrecenttracks', { limit: '10' }), 3200)
      ]);
      var results = settled.map(function(x) { return x.status === 'fulfilled' ? (x.value || {}) : {}; });
      var toptracks = results[1].toptracks || (cachedBundle && cachedBundle.body && cachedBundle.body.toptracks) || null;
      var topartists = results[2].topartists || (cachedBundle && cachedBundle.body && cachedBundle.body.topartists) || null;
      // Resolve cover art for top tracks/artists (their Last.fm endpoints ship no art).
      // Wrapped so a slow/failing iTunes call never breaks the bundle.
      var recenttracks = results[3].recenttracks || (cachedBundle && cachedBundle.body && cachedBundle.body.recenttracks) || null;
      try { await enrichArt(toptracks, topartists, recenttracks); } catch (e) {}
      var body = {
        user: results[0].user || (cachedBundle && cachedBundle.body && cachedBundle.body.user) || null,
        toptracks: toptracks,
        topartists: topartists,
        recenttracks: recenttracks,
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
    'artist.getInfo', 'artist.getSimilar', 'artist.getTopTracks', 'artist.getTopAlbums', 'artist.getTopTags',
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

    /* Enrich live now-playing / recent art with high-res iTunes covers. */
    if (method === 'user.getrecenttracks') {
      body = await enrichRecentTracksBody(body);
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
