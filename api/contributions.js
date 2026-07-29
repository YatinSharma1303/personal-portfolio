/* ============================================================
   api/contributions.js — Fetches GitHub contribution calendar
   Uses the reliable public API (jogruber.de) instead of HTML scraping.
   ============================================================ */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400'); // Cache for 1 hour

  const user = (req.query.user || 'YatinSharma1303').replace(/[^a-zA-Z0-9-]/g, '');

  try {
    const response = await fetch(`https://github-contributions-api.jogruber.de/v4/${user}`);
    const data = await response.json();

    if (!data || !data.contributions) {
      return res.status(404).json({ error: 'No contribution data found' });
    }

    // API returns an array of all days. We just need the fields we use.
    const days = data.contributions.map(d => ({
      date: d.date,
      level: d.level // 0-4
    }));

    // Calculate total from the current year
    const currentYear = new Date().getFullYear();
    const total = data.contributions
      .filter(d => d.date.startsWith(String(currentYear)))
      .reduce((sum, d) => sum + d.count, 0);

    res.status(200).json({ total, days });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch contributions' });
  }
};
