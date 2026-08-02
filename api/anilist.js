/* ============================================================
 api/anilist.js - Vercel serverless function
 Proxies AniList GraphQL API calls server-side so the frontend
 doesn't call graphql.anilist.co directly from the browser.

 Usage from frontend:
   /api/anilist?type=ANIME
   /api/anilist?type=MANGA
   /api/anilist?meta=1            (user avatar, favourites, stats)
 ============================================================ */

var ANILIST_API = 'https://graphql.anilist.co';

/* Simple in-memory cache (per cold-start invocation).
   AniList data changes when user updates their list. */
var _cache = {};
var CACHE_TTL = 2 * 60 * 1000; // 2 minutes

function buildListQuery(type) {
  var progressFields = type === 'MANGA' ? 'chapters volumes' : 'episodes duration';
  return 'query{user:MediaListCollection(userName:"' + (process.env.ANILIST_USER || 'YatinSharma1303') + '",type:' + type + '){lists{name status entries{media{id title{romaji english}coverImage{extraLarge large medium}' + progressFields + ' meanScore genres format description(asHtml:false) startDate{year month day} endDate{year month day}}score progress updatedAt startedAt{year month day} completedAt{year month day}}}}}';
}

var userQuery = 'query{User(name:"' + (process.env.ANILIST_USER || 'YatinSharma1303') + '"){avatar{large}favourites{anime{nodes{id}}manga{nodes{id}}}statistics{anime{count episodesWatched minutesWatched meanScore genres{genre count}}manga{count chaptersRead volumesRead meanScore genres{genre count}}}}}';

async function fetchAnilist(query, cacheKey, cacheTtl) {
  cacheTtl = cacheTtl || CACHE_TTL;

  /* Check cache */
  if (cacheKey) {
    var cached = _cache[cacheKey];
    if (cached && Date.now() - cached.ts < cacheTtl) {
      return { body: cached.body, cached: true };
    }
  }

  try {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function() { controller.abort(); }, 8000) : null;

    var response = await fetch(ANILIST_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ query: query }),
      signal: controller ? controller.signal : undefined
    });

    if (timer) clearTimeout(timer);

    if (!response.ok) {
      return { ok: false, status: response.status, error: 'AniList HTTP ' + response.status };
    }

    var data = await response.json();

    /* Cache successful responses */
    if (cacheKey) {
      _cache[cacheKey] = { body: data, ts: Date.now() };
    }

    return { body: data, cached: false };
  } catch (e) {
    return { ok: false, error: e.message || 'timeout' };
  }
}

/* Purge stale cache entries */
function purgeCache() {
  var keys = Object.keys(_cache);
  for (var i = 0; i < keys.length; i++) {
    if (Date.now() - _cache[keys[i]].ts > CACHE_TTL * 3) {
      delete _cache[keys[i]];
    }
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  /* meta=1 → fetch user avatar, favourites, statistics */
  if (req.query.meta === '1') {
    var result = await fetchAnilist(userQuery, 'anilist:meta');
    purgeCache();

    if (result.body) {
      res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
      return res.status(200).json(result.body);
    }
    return res.status(502).json({ ok: false, error: result.error || 'Failed to reach AniList' });
  }

  /* type=ANIME|MANGA → fetch media list */
  var type = (req.query.type || 'ANIME').toUpperCase();
  if (type !== 'ANIME' && type !== 'MANGA') {
    return res.status(400).json({ ok: false, error: 'Invalid type. Use ANIME or MANGA.' });
  }

  var query = buildListQuery(type);
  var result = await fetchAnilist(query, 'anilist:list:' + type);
  purgeCache();

  if (result.body) {
    if (result.body.errors) {
      /* AniList returned a GraphQL error — pass it through so the frontend can handle it */
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(result.body);
    }
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    return res.status(200).json(result.body);
  }
  return res.status(502).json({ ok: false, error: result.error || 'Failed to reach AniList' });
};
