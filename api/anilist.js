/* ============================================================
 api/anilist.js - Vercel serverless function
 Simple AniList GraphQL proxy. No fallback APIs, no caching.
 When AniList is down, returns 502 so the frontend can show
 a clean "API is down" message.

 Every request hits AniList directly — instant freshness.

 Usage:
   /api/anilist?type=ANIME
   /api/anilist?type=MANGA
   /api/anilist?meta=1
 ============================================================ */

var ANILIST_API = 'https://graphql.anilist.co';
var ANILIST_USER = process.env.ANILIST_USER || 'YatinSharma1303';

function buildListQuery(type) {
  var pf = type === 'MANGA' ? 'chapters volumes' : 'episodes duration';
  return 'query{user:MediaListCollection(userName:"' + ANILIST_USER + '",type:' + type + '){lists{name status entries{media{id title{romaji english}coverImage{extraLarge large medium}' + pf + ' meanScore genres format description(asHtml:false) startDate{year month day} endDate{year month day}}score progress updatedAt startedAt{year month day} completedAt{year month day}}}}}';
}

var userQuery = 'query{User(name:"' + ANILIST_USER + '"){avatar{large}favourites{anime{nodes{id}}manga{nodes{id}}}statistics{anime{count episodesWatched minutesWatched meanScore genres{genre count}}manga{count chaptersRead volumesRead meanScore genres{genre count}}}}}';

async function fetchAnilist(query) {
  try {
    var response = await fetch(ANILIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: query })
    });
    if (!response.ok) return { ok: false, error: 'AniList HTTP ' + response.status };
    var data = await response.json();
    if (data.errors) return { ok: false, error: data.errors[0].message };
    return { body: data, source: 'anilist' };
  } catch (e) { return { ok: false, error: e.message || 'timeout' }; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store'); // never cache at any level

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  /* meta=1 → user avatar, favourites, statistics */
  if (req.query.meta === '1') {
    var result = await fetchAnilist(userQuery);
    if (result.body) return res.status(200).json(result.body);
    return res.status(502).json({ ok: false, error: result.error || 'AniList unavailable' });
  }

  /* type=ANIME|MANGA */
  var type = (req.query.type || 'ANIME').toUpperCase();
  if (type !== 'ANIME' && type !== 'MANGA') {
    return res.status(400).json({ ok: false, error: 'Invalid type. Use ANIME or MANGA.' });
  }

  var query = buildListQuery(type);
  var result = await fetchAnilist(query);

  if (result.body) return res.status(200).json(result.body);
  return res.status(502).json({ ok: false, error: result.error || 'AniList unavailable' });
};
