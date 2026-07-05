/* ============================================================
   api/wakatime.js — Proxy for WakaTime weekly coding stats.
   Keeps your API key server-side.
   ============================================================ */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  const apiKey = process.env.WAKATIME_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ error: 'WakaTime not configured' });
  }

  try {
    const auth = Buffer.from(apiKey).toString('base64');
    const response = await fetch('https://wakatime.com/api/v1/users/current/stats/last_7_days', {
      headers: { Authorization: 'Basic ' + auth }
    });
    const data = await response.json();

    if (!data || !data.data) {
      return res.status(200).json({ error: 'No WakaTime data available' });
    }

    const d = data.data;
    res.status(200).json({
      total: d.human_readable_total || '—',
      daily: d.human_readable_daily_average || '—',
      languages: (d.languages || []).slice(0, 6).map(function (l) {
        return { name: l.name, time: l.digital || l.text || '—', percent: l.percent || 0 };
      }),
      editors: (d.editors || []).slice(0, 3).map(function (e) { return e.name; }),
      os: (d.operating_systems || []).slice(0, 1).map(function (o) { return o.name; })
    });
  } catch (e) {
    res.status(200).json({ error: 'Failed to fetch WakaTime stats' });
  }
};
