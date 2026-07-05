/* ============================================================
   api/contributions.js — Fetches GitHub contribution calendar
   Scrapes github.com/USERNAME and extracts the contribution data.
   No auth token required.
   ============================================================ */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  const user = (req.query.user || 'YatinSharma1303').replace(/[^a-zA-Z0-9-]/g, '');

  try {
    const response = await fetch(`https://github.com/${user}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!response.ok) return res.status(502).json({ error: 'GitHub fetch failed' });

    const html = await response.text();
    // Extract contribution days from the HTML: data-date and data-level attributes
    const regex = /data-date="(\d{4}-\d{2}-\d{2})"[^>]*data-level="(\d)"/g;
    const days = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      days.push({ date: match[1], level: parseInt(match[2], 10) });
    }

    // Extract total contributions count
    let total = 0;
    const totalMatch = html.match(/(\d[\d,]*)\s+contributions?\s+in\s+the\s+last\s+year/i);
    if (totalMatch) total = parseInt(totalMatch[1].replace(/,/g, ''), 10);

    if (!days.length) return res.status(404).json({ error: 'No contribution data found' });

    res.status(200).json({ total, days });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch contributions' });
  }
};
