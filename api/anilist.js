/* ============================================================
 api/anilist.js - Vercel serverless function
 Proxies AniList GraphQL API calls server-side.
 When AniList is down, dynamically fetches from Shikimori API
 (popular anime) + Jikan for cover images.
 No hardcoded data — always fresh from real APIs.

 Chain: AniList → Shikimori (data) + Jikan (images) → hardcoded JS fallback

 Usage from frontend:
   /api/anilist?type=ANIME
   /api/anilist?type=MANGA
   /api/anilist?meta=1
 ============================================================ */

var ANILIST_API = 'https://graphql.anilist.co';
var SHIKIMORI_API = 'https://shikimori.one/api';
var JIKAN_API = 'https://api.jikan.moe/v4';
var ANILIST_USER = process.env.ANILIST_USER || 'YatinSharma1303';

var _cache = {};
var CACHE_TTL = 2 * 60 * 1000;
var FALLBACK_CACHE_TTL = 10 * 60 * 1000;

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
function purgeCache() {
  var now = Date.now(), keys = Object.keys(_cache);
  for (var i = 0; i < keys.length; i++) {
    if (now - _cache[keys[i]].ts > FALLBACK_CACHE_TTL * 3) delete _cache[keys[i]];
  }
}

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

/* ---------- AniList ---------- */

async function fetchAnilist(query, cacheKey) {
  var cached = getCached(cacheKey, CACHE_TTL);
  if (cached) return { body: cached, source: 'anilist-cache' };
  try {
    var response = await fetchWithTimeout(ANILIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: query })
    }, 8000);
    if (!response.ok) return { ok: false, error: 'AniList HTTP ' + response.status };
    var data = await response.json();
    if (data.errors) return { ok: false, error: data.errors[0].message };
    setCache(cacheKey, data);
    return { body: data, source: 'anilist' };
  } catch (e) { return { ok: false, error: e.message || 'timeout' }; }
}

/* ---------- Jikan image enrichment (MAL CDN URLs) ---------- */

async function enrichWithJikanImages(items) {
  var batchSize = 5;
  for (var i = 0; i < items.length; i += batchSize) {
    var batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(async function(item) {
      try {
        var malId = item.mal_id || item.id;
        var res = await fetchWithTimeout(
          JIKAN_API + '/anime/' + malId,
          { headers: { 'User-Agent': 'YatinPortfolio/1.0' } },
          2000
        );
        if (res.ok) {
          var data = await res.json();
          var imgs = data && data.data && data.data.images && data.data.images.jpg;
          if (imgs && imgs.large_image_url) {
            item.coverUrl = imgs.large_image_url;
            item.coverUrlSmall = imgs.image_url || item.coverUrl;
          }
        }
      } catch (e) { /* Shikimori URL stays as fallback */ }
    }));
    if (i + batchSize < items.length) {
      await new Promise(function(r) { setTimeout(r, 350); });
    }
  }
}

/* ---------- Shikimori fallback ---------- */

async function fetchShikimoriList(type) {
  var cacheKey = 'shikimori:list:' + type;
  var cached = getCached(cacheKey, FALLBACK_CACHE_TTL);
  if (cached) return { body: cached, source: 'shikimori-cache' };

  try {
    var kind = type === 'MANGA' ? 'manga' : 'tv';
    var url = SHIKIMORI_API + '/animes?limit=25&order=popularity&kind=' + kind;

    var response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'YatinPortfolio/1.0', 'Accept': 'application/json' }
    }, 6000);

    if (!response.ok) return { ok: false, error: 'Shikimori HTTP ' + response.status };

    var items = await response.json();
    if (!Array.isArray(items) || !items.length) return { ok: false, error: 'Shikimori empty' };

    /* Set Shikimori image URLs as baseline (browser handles DDoS guard) */
    var shikimoriCdn = 'https://shikimori.one';
    items.forEach(function(item) {
      var img = item.image || {};
      var original = img.original || img.preview || '';
      item.coverUrl = original && original.indexOf('http') !== 0
        ? shikimoriCdn + original : (original || '');
      var preview = img.preview || img.x96 || '';
      item.coverUrlSmall = preview && preview.indexOf('http') !== 0
        ? shikimoriCdn + preview : (preview || item.coverUrl);
    });

    /* Enrich with MAL CDN images via Jikan (blocking, replaces Shikimori URLs) */
    try { await enrichWithJikanImages(items); } catch (e) { /* Shikimori URLs stay */ }

    /* Map to AniList format */
    var entries = items.map(function(item) {
      var genres = (item.genres || []).map(function(g) {
        return (typeof g === 'string') ? g : (g.name || g.russian || '');
      }).filter(Boolean);

      return {
        _status: 'COMPLETED',
        score: Math.round((item.score || 0) * 10),
        progress: type === 'MANGA' ? (item.chapters || 0) : (item.episodes || 0),
        media: {
          id: item.mal_id || item.id || 0,
          title: {
            romaji: item.name || '',
            english: item.english || item.name || ''
          },
          coverImage: {
            extraLarge: item.coverUrl || '',
            large: item.coverUrl || '',
            medium: item.coverUrlSmall || item.coverUrl || ''
          },
          episodes: type === 'MANGA' ? null : (item.episodes || null),
          chapters: type === 'MANGA' ? (item.chapters || null) : null,
          volumes: type === 'MANGA' ? (item.volumes || null) : null,
          duration: type === 'MANGA' ? null : 24,
          meanScore: Math.round((item.score || 0) * 10),
          genres: genres,
          format: mapShikimoriKind(item.kind),
          description: '',
          startDate: item.aired_on ? parseShikimoriDate(item.aired_on) : null,
          endDate: item.released_on ? parseShikimoriDate(item.released_on) : null
        },
        updatedAt: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 864000),
        startedAt: { year: null },
        completedAt: { year: null }
      };
    });

    var anilistFormat = {
      data: {
        user: {
          lists: [{ name: type, status: 'COMPLETED', entries: entries }]
        }
      },
      _fallback: true,
      _source: 'shikimori'
    };

    setCache(cacheKey, anilistFormat);
    return { body: anilistFormat, source: 'shikimori' };
  } catch (e) {
    return { ok: false, error: e.message || 'Shikimori timeout' };
  }
}

function parseShikimoriDate(dateStr) {
  if (!dateStr) return null;
  var parts = String(dateStr).split('-');
  if (parts.length >= 1) {
    return { year: parseInt(parts[0]) || null, month: parts[1] ? parseInt(parts[1]) : null, day: parts[2] ? parseInt(parts[2]) : null };
  }
  return null;
}

function mapShikimoriKind(kind) {
  if (!kind) return 'TV';
  var map = {
    'tv': 'TV', 'tv_special': 'TV_SPECIAL', 'ova': 'OVA', 'ona': 'ONA',
    'movie': 'MOVIE', 'music': 'MUSIC', 'special': 'SPECIAL',
    'web': 'ONA', 'cm': 'SPECIAL', 'pv': 'SPECIAL',
    'manga': 'MANGA', 'manhwa': 'MANGA', 'manhua': 'MANGA',
    'novel': 'NOVEL', 'one_shot': 'ONE_SHOT'
  };
  return map[String(kind).toLowerCase()] || 'TV';
}

/* ---------- Meta fallback ---------- */

async function fetchMetaFallback() {
  var cacheKey = 'fallback:meta';
  var cached = getCached(cacheKey, FALLBACK_CACHE_TTL);
  if (cached) return { body: cached, source: 'fallback-cache' };
  var result = { data: { User: null }, _fallback: true };
  setCache(cacheKey, result);
  return { body: result, source: 'fallback' };
}

/* ---------- Handler ---------- */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  if (req.query.meta === '1') {
    var result = await fetchAnilist(userQuery, 'anilist:meta');
    if (!result.body || result.ok === false) result = await fetchMetaFallback();
    purgeCache();
    if (result.body) {
      res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
      return res.status(200).json(result.body);
    }
    return res.status(502).json({ ok: false, error: result.error || 'All sources failed' });
  }

  var type = (req.query.type || 'ANIME').toUpperCase();
  if (type !== 'ANIME' && type !== 'MANGA') {
    return res.status(400).json({ ok: false, error: 'Invalid type. Use ANIME or MANGA.' });
  }

  var query = buildListQuery(type);
  var result = await fetchAnilist(query, 'anilist:list:' + type);

  if (!result.body || result.ok === false) {
    console.log('AniList ' + type + ' failed (' + (result.error || '?') + '), trying Shikimori');
    result = await fetchShikimoriList(type);
  }

  purgeCache();

  if (result.body) {
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.setHeader('X-Anime-Source', result.source || 'unknown');
    return res.status(200).json(result.body);
  }

  return res.status(502).json({ ok: false, error: result.error || 'All sources failed' });
};
