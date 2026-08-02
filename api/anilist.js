/* ============================================================
 api/anilist.js - Vercel serverless function
 Proxies AniList GraphQL API calls server-side.
 When AniList is down, returns 502 so the frontend uses its
 own fallback (hardcoded list with dynamic Jikan cover art).

 Usage from frontend:
   /api/anilist?type=ANIME
   /api/anilist?type=MANGA
   /api/anilist?meta=1
 ============================================================ */

var ANILIST_API = 'https://graphql.anilist.co';
var ANILIST_USER = process.env.ANILIST_USER || 'YatinSharma1303';

var _cache = {};
var CACHE_TTL = 2 * 60 * 1000;

function buildListQuery(type) {
  var pf = type === 'MANGA' ? 'chapters volumes' : 'episodes duration';
  return 'query{user:MediaListCollection(userName:"' + ANILIST_USER + '",type:' + type + '){lists{name status entries{media{id title{romaji english}coverImage{extraLarge large medium}' + pf + ' meanScore genres format description(asHtml:false) startDate{year month day} endDate{year month day}}score progress updatedAt startedAt{year month day} completedAt{year month day}}}}}';
}

var userQuery = 'query{User(name:"' + ANILIST_USER + '"){avatar{large}favourites{anime{nodes{id}}manga{nodes{id}}}statistics{anime{count episodesWatched minutesWatched meanScore genres{genre count}}manga{count chaptersRead volumesRead meanScore genres{genre count}}}}}';

function getCached(key) {
  var c = _cache[key];
  if (c && Date.now() - c.ts < CACHE_TTL) return c.body;
  return null;
}
function setCache(key, body) { _cache[key] = { body: body, ts: Date.now() }; }

async function fetchWithTimeout(url, options, timeoutMs) {
  timeoutMs = timeoutMs || 8000;
  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = controller ? setTimeout(function() { controller.abort(); }, timeoutMs) : null;
  try {
    var res = await fetch(url, Object.assign({}, options, controller ? { signal: controller.signal } : {}));
    if (timer) clearTimeout(timer);
    return res;
  } catch (e) { if (timer) clearTimeout(timer); throw e; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  /* meta=1 → user avatar, favourites, statistics */
  if (req.query.meta === '1') {
    var cached = getCached('anilist:meta');
    if (cached) {
      res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
      return res.status(200).json(cached);
    }
    try {
      var response = await fetchWithTimeout(ANILIST_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: userQuery })
      }, 8000);
      if (!response.ok) return res.status(502).json({ ok: false, error: 'AniList unavailable' });
      var data = await response.json();
      if (data.errors) return res.status(502).json({ ok: false, error: data.errors[0].message });
      setCache('anilist:meta', data);
      res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
      return res.status(200).json(data);
    } catch (e) {
      return res.status(502).json({ ok: false, error: e.message || 'timeout' });
    }
  }

  /* type=ANIME|MANGA → fetch media list */
  var type = (req.query.type || 'ANIME').toUpperCase();
  if (type !== 'ANIME' && type !== 'MANGA') {
    return res.status(400).json({ ok: false, error: 'Invalid type. Use ANIME or MANGA.' });
  }

  var cacheKey = 'anilist:list:' + type;
  var cached = getCached(cacheKey);
  if (cached) {
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    return res.status(200).json(cached);
  }

  try {
    var query = buildListQuery(type);
    var response = await fetchWithTimeout(ANILIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: query })
    }, 8000);

    if (!response.ok) return res.status(502).json({ ok: false, error: 'AniList unavailable' });

    var data = await response.json();
    if (data.errors) return res.status(502).json({ ok: false, error: data.errors[0].message });

    setCache(cacheKey, data);
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message || 'timeout' });
  }
};
