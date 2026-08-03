/* ============================================================
 api/anilist.js - Vercel serverless function
 Simple AniList GraphQL proxy. No fallback APIs.
 When AniList is down, returns 502 so the frontend can show
 a clean "API is down" message.

 Usage:
   /api/anilist?type=ANIME
   /api/anilist?type=MANGA
   /api/anilist?meta=1
   /api/anilist?type=ANIME&nocache=1   (bypasses all caches)
 ============================================================ */

var ANILIST_API = 'https://graphql.anilist.co';
var ANILIST_USER = process.env.ANILIST_USER || 'YatinSharma1303';

var _cache = {};
var CACHE_TTL = 15 * 1000; // 15 sec — keeps data fresh for page loads

function buildListQuery(type) {
  var pf = type === 'MANGA' ? 'chapters volumes' : 'episodes duration';
  return 'query{user:MediaListCollection(userName:"' + ANILIST_USER + '",type:' + type + '){lists{name status entries{media{id title{romaji english}coverImage{extraLarge large medium}' + pf + ' meanScore genres format description(asHtml:false) startDate{year month day} endDate{year month day}}score progress updatedAt startedAt{year month day} completedAt{year month day}}}}}';
}

var userQuery = 'query{User(name:"' + ANILIST_USER + '"){avatar{large}favourites{anime{nodes{id}}manga{nodes{id}}}statistics{anime{count episodesWatched minutesWatched meanScore genres{genre count}}manga{count chaptersRead volumesRead meanScore genres{genre count}}}}}';

function getCached(key, maxAge) {
  var c = _cache[key];
  if (c && Date.now() - c.ts < maxAge) return c.body;
  return null;
}
function setCache(key, body) { _cache[key] = { body: body, ts: Date.now() }; }

async function fetchAnilist(query, cacheKey, skipCache) {
  if (!skipCache) {
    var cached = getCached(cacheKey, CACHE_TTL);
    if (cached) return { body: cached, source: 'anilist-cache' };
  }
  try {
    var response = await fetch(ANILIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: query })
    });
    if (!response.ok) return { ok: false, error: 'AniList HTTP ' + response.status };
    var data = await response.json();
    if (data.errors) return { ok: false, error: data.errors[0].message };
    setCache(cacheKey, data);
    return { body: data, source: 'anilist' };
  } catch (e) { return { ok: false, error: e.message || 'timeout' }; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  var skipCache = req.query.nocache === '1';

  /* meta=1 → user avatar, favourites, statistics */
  if (req.query.meta === '1') {
    var result = await fetchAnilist(userQuery, 'anilist:meta', skipCache);
    if (result.body) {
      res.setHeader('Cache-Control', skipCache ? 'no-store' : 's-maxage=15, stale-while-revalidate=60');
      return res.status(200).json(result.body);
    }
    return res.status(502).json({ ok: false, error: result.error || 'AniList unavailable' });
  }

  /* type=ANIME|MANGA */
  var type = (req.query.type || 'ANIME').toUpperCase();
  if (type !== 'ANIME' && type !== 'MANGA') {
    return res.status(400).json({ ok: false, error: 'Invalid type. Use ANIME or MANGA.' });
  }

  var query = buildListQuery(type);
  var result = await fetchAnilist(query, 'anilist:list:' + type, skipCache);

  if (result.body) {
    /* nocache=1 requests are never cached at Vercel edge */
    res.setHeader('Cache-Control', skipCache ? 'no-store' : 's-maxage=15, stale-while-revalidate=60');
    return res.status(200).json(result.body);
  }

  return res.status(502).json({ ok: false, error: result.error || 'AniList unavailable' });
};
