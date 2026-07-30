/* ============================================================
   api/contributions.js — Fetches GitHub contribution calendar
   Returns enriched data: streaks, best day, busiest month,
   this week/month counts, month labels, and per-day counts.
   ============================================================ */
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  const user = (req.query.user || 'YatinSharma1303').replace(/[^a-zA-Z0-9-]/g, '');

  try {
    const response = await fetch(`https://github-contributions-api.jogruber.de/v4/${user}`);
    const data = await response.json();

    if (!data || !data.contributions) {
      return res.status(404).json({ error: 'No contribution data found' });
    }

    // Map days with count included
    const days = data.contributions.map(d => ({
      date: d.date,
      level: d.level,
      count: d.count || 0
    }));

    // --- Total: last 365 days (not just calendar year) ---
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const cutoff = oneYearAgo.toISOString().slice(0, 10);
    const lastYear = days.filter(d => d.date >= cutoff);
    const total = lastYear.reduce((s, d) => s + d.count, 0);

    // --- Streaks ---
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    // Walk from end (today) backwards for current streak
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].count > 0) currentStreak++;
      else break;
    }
    // Walk all days for longest streak
    for (let i = 0; i < days.length; i++) {
      if (days[i].count > 0) {
        tempStreak++;
        if (tempStreak > longestStreak) longestStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    }

    // --- Best day ---
    let bestDay = { date: '', count: 0 };
    lastYear.forEach(d => {
      if (d.count > bestDay.count) bestDay = { date: d.date, count: d.count };
    });
    const bestDayFormatted = bestDay.count > 0
      ? { date: bestDay.date, text: formatDate(bestDay.date), dayName: DAY_NAMES[new Date(bestDay.date + 'T00:00:00').getDay()], count: bestDay.count }
      : null;

    // --- Busiest month ---
    const monthMap = {};
    lastYear.forEach(d => {
      const m = d.date.slice(0, 7); // "2026-07"
      if (!monthMap[m]) monthMap[m] = 0;
      monthMap[m] += d.count;
    });
    let busiestMonth = { key: '', count: 0 };
    Object.entries(monthMap).forEach(([k, v]) => {
      if (v > busiestMonth.count) busiestMonth = { key: k, count: v };
    });
    const busiestMonthFormatted = busiestMonth.count > 0
      ? MONTH_NAMES[parseInt(busiestMonth.key.slice(5, 7)) - 1] + ' ' + busiestMonth.key.slice(0, 4)
      : '—';

    // --- This week / This month ---
    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);
    // ISO week: Monday start
    const dayOfWeek = (now.getDay() + 6) % 7; // 0=Mon, 6=Sun
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - dayOfWeek);
    const weekStartStr = weekStart.toISOString().slice(0, 10);

    const thisMonthCount = lastYear.filter(d => d.date.startsWith(thisMonth)).reduce((s, d) => s + d.count, 0);
    const thisWeekCount = lastYear.filter(d => d.date >= weekStartStr).reduce((s, d) => s + d.count, 0);

    // --- Month labels for grid ---
    // Find the first day of each month in the days array, record its index
    const monthLabels = [];
    let lastMonth = '';
    days.forEach((d, i) => {
      const m = d.date.slice(0, 7);
      if (m !== lastMonth) {
        monthLabels.push({ month: MONTH_NAMES[parseInt(m.slice(5, 7)) - 1], index: i });
        lastMonth = m;
      }
    });

    res.status(200).json({
      total,
      days,
      streaks: { current: currentStreak, longest: longestStreak },
      bestDay: bestDayFormatted,
      busiestMonth: busiestMonthFormatted,
      thisMonth: thisMonthCount,
      thisWeek: thisWeekCount,
      monthLabels
    });

  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch contributions' });
  }
};

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return MONTH_NAMES[d.getMonth()] + ' ' + d.getDate();
}
