/* ============================================================
   api/wakatime.js — Proxy for WakaTime weekly coding stats.
   Uses the real-time Summaries API to prevent cached "0 secs" errors.
   ============================================================ */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200'); // Cache for 10 mins

  const apiKey = process.env.WAKATIME_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ error: 'WakaTime not configured' });
  }

  try {
    const auth = Buffer.from(apiKey).toString('base64');
    // Use the summaries API which is real-time and accurate
    const response = await fetch('https://wakatime.com/api/v1/users/current/summaries?range=Last%207%20days', {
      headers: { Authorization: 'Basic ' + auth }
    });
    
    if (!response.ok) {
      return res.status(200).json({ error: 'WakaTime API error' });
    }

    const data = await response.json();
    if (!data || !data.data || data.data.length === 0) {
      return res.status(200).json({ error: 'No WakaTime data available' });
    }

    // 1. Calculate total time across the last 7 days
    let totalSeconds = 0;
    let totalDaysCoded = 0;
    
    // 2. Aggregate languages and editors
    const langMap = {};
    const editorMap = {};

    data.data.forEach(day => {
      if (day.grand_total && day.grand_total.total_seconds > 0) {
        totalSeconds += day.grand_total.total_seconds;
        totalDaysCoded++;
      }

      if (day.languages) {
        day.languages.forEach(l => {
          if (!langMap[l.name]) langMap[l.name] = 0;
          langMap[l.name] += l.total_seconds;
        });
      }

      if (day.editors) {
        day.editors.forEach(e => {
          if (!editorMap[e.name]) editorMap[e.name] = 0;
          editorMap[e.name] += e.total_seconds;
        });
      }
    });

    // Convert total seconds to human readable format (e.g., "12 hrs 30 mins")
    function formatTime(seconds) {
      if (seconds === 0) return "0 secs";
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      let result = "";
      if (hours > 0) result += hours + " hrs ";
      if (minutes > 0) result += minutes + " mins";
      if (hours === 0 && minutes === 0) result = Math.round(seconds) + " secs";
      return result.trim();
    }

    // Sort languages by time and get top 6
    const topLangs = Object.entries(langMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, seconds]) => {
        return {
          name: name,
          time: formatTime(seconds),
          percent: Math.round((seconds / totalSeconds) * 100)
        };
      });

    // Sort editors by time
    const topEditors = Object.entries(editorMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name);

    // Calculate daily average
    const avgSeconds = totalDaysCoded > 0 ? totalSeconds / 7 : 0; // Average over the whole week

    res.status(200).json({
      total: formatTime(totalSeconds),
      daily: formatTime(avgSeconds),
      languages: topLangs,
      editors: topEditors
    });

  } catch (e) {
    res.status(200).json({ error: 'Failed to fetch WakaTime stats' });
  }
};
