/* ============================================================
   api/wakatime.js — Proxy for WakaTime coding stats.
   7d/30d: summaries API (daily breakdown)
   1y: stats API (aggregated, fast) + last 7 days summaries for heatmap
   ============================================================ */

const RANGES = {
  '7d':  'Last%207%20days',
  '30d': 'Last%2030%20days',
  '1y':  'Last%2012%20months'
};

// Official-ish WakaTime language colors
const LANG_COLORS = {
  'JavaScript':       '#f1e05a',
  'TypeScript':       '#3178c6',
  'Python':           '#3572A5',
  'HTML':             '#e34c26',
  'CSS':              '#563d7c',
  'Java':             '#b07219',
  'Go':               '#00ADD8',
  'Rust':             '#dea584',
  'C':                '#555555',
  'C++':              '#f34b7d',
  'C#':               '#178600',
  'PHP':              '#4F5D95',
  'Ruby':             '#701516',
  'Swift':            '#F05138',
  'Kotlin':           '#A97BFF',
  'Dart':             '#00B4AB',
  'Shell':            '#89e051',
  'Bash':             '#89e051',
  'PowerShell':       '#012456',
  'Vue':              '#41b883',
  'Svelte':           '#ff3e00',
  'React':            '#61dafb',
  'Next.js':          '#ffffff',
  'Nuxt':             '#00dc82',
  'SCSS':             '#c6538c',
  'Sass':             '#a53b70',
  'Lua':              '#000080',
  'Zig':              '#ec915c',
  'Elixir':           '#6e4a7e',
  'Haskell':          '#5e5086',
  'Scala':            '#c22d40',
  'R':                '#198CE7',
  'SQL':              '#e38c00',
  'GraphQL':          '#e535ab',
  'JSON':             '#292929',
  'YAML':             '#cb171e',
  'Markdown':         '#083fa1',
  'TOML':             '#9c4221',
  'XML':              '#0060ac',
  'Dockerfile':       '#384d54',
  'Makefile':         '#427819',
  'Nix':              '#7e7eff',
  'Clojure':          '#db5855',
  'Erlang':           '#B83998',
  'OCaml':            '#3be133',
  'F#':               '#b845fc',
  'Perl':             '#0298c3',
  'Racket':           '#3c5caa',
  'Julia':            '#a270ba',
  'Lua':              '#000080',
  'TeX':              '#3D6117',
  'Vue.js':           '#41b883',
  'TSX':              '#3178c6',
  'JSX':              '#f1e05a'
};

const FALLBACK_PALETTE = ['#00c8ff','#7850ff','#00f0b4','#f59e0b','#ef4444','#a855f7','#ec4899','#06b6d4'];

function getLangColor(name) {
  return LANG_COLORS[name] || null;
}

function formatTime(seconds) {
  if (seconds === 0) return '0 secs';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  let result = '';
  if (hours > 0) result += hours + ' hrs ';
  if (minutes > 0) result += minutes + ' mins';
  if (hours === 0 && minutes === 0) result = Math.round(seconds) + ' secs';
  return result.trim();
}

function shortTime(seconds) {
  if (seconds === 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return h + 'h ' + m + 'm';
  if (h > 0) return h + 'h';
  return m + 'm';
}

function buildLangsFromStats(langArr) {
  let colorIdx = 0;
  return (langArr || [])
    .sort((a, b) => (b.total_seconds || 0) - (a.total_seconds || 0))
    .slice(0, 8)
    .map(l => {
      const color = getLangColor(l.name) || FALLBACK_PALETTE[colorIdx++ % FALLBACK_PALETTE.length];
      return { name: l.name, time: formatTime(l.total_seconds || 0), seconds: l.total_seconds || 0, percent: l.percent || Math.round(l.digital || 0), color };
    });
}

function buildEditorsFromStats(editorArr) {
  return (editorArr || [])
    .sort((a, b) => (b.total_seconds || 0) - (a.total_seconds || 0))
    .slice(0, 4)
    .map(e => ({ name: e.name, percent: e.percent || 0, time: formatTime(e.total_seconds || 0) }));
}

function buildProjectsFromStats(projectArr) {
  return (projectArr || [])
    .sort((a, b) => (b.total_seconds || 0) - (a.total_seconds || 0))
    .slice(0, 5)
    .map(p => ({ name: p.name, time: formatTime(p.total_seconds || 0), percent: p.percent || 0 }));
}

function buildLangs(langMap, totalSeconds) {
  let colorIdx = 0;
  return Object.entries(langMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, seconds]) => {
      const color = getLangColor(name) || FALLBACK_PALETTE[colorIdx++ % FALLBACK_PALETTE.length];
      return { name, time: formatTime(seconds), seconds, percent: Math.round((seconds / totalSeconds) * 100), color };
    });
}

function buildEditors(editorMap, totalSeconds) {
  return Object.entries(editorMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, seconds]) => ({ name, percent: Math.round((seconds / totalSeconds) * 100), time: formatTime(seconds) }));
}

function buildProjects(projectMap, totalSeconds) {
  return Object.entries(projectMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, seconds]) => ({ name, time: formatTime(seconds), percent: Math.round((seconds / totalSeconds) * 100) }));
}

async function fetchWithAuth(url, auth, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Authorization: 'Basic ' + auth },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');

  const apiKey = process.env.WAKATIME_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ error: 'WakaTime not configured' });
  }

  const rangeKey = (req.query.range && RANGES[req.query.range]) ? req.query.range : '7d';
  const rangeParam = RANGES[rangeKey];
  const auth = Buffer.from(apiKey).toString('base64');

  try {
    if (rangeKey === '1y') {
      // --- 1 YEAR: Use stats API (aggregated, fast) + 7d summaries for heatmap ---
      const [statsData, weekData] = await Promise.all([
        fetchWithAuth('https://wakatime.com/api/v1/users/current/stats?range=last_year', auth, 6000),
        fetchWithAuth('https://wakatime.com/api/v1/users/current/summaries?range=Last%207%20days', auth, 5000)
      ]);

      if (!statsData || !statsData.data) {
        return res.status(200).json({ error: 'No WakaTime data for this period' });
      }

      const sd = statsData.data;
      const totalSeconds = sd.total_seconds || 0;
      const totalDays = sd.days_including_holidays || 365;
      const daysActiveCoded = sd.days_with_more_than_0_seconds || 0;
      const dailyAvg = totalDays > 0 ? totalSeconds / totalDays : 0;

      // Use pre-computed percentages from stats API (avoids >100% rounding errors)
      const topLangs = buildLangsFromStats(sd.languages);
      const topEditors = buildEditorsFromStats(sd.editors);
      const topProjects = buildProjectsFromStats(sd.projects);

      // Heatmap from 7d summaries
      const heatmapDays = [];
      if (weekData && weekData.data) {
        weekData.data.forEach(day => {
          const daySeconds = (day.grand_total && day.grand_total.total_seconds) || 0;
          heatmapDays.push({
            date: day.range ? day.range.start : null,
            text: day.range ? day.range.text : '',
            seconds: daySeconds,
            label: shortTime(daySeconds)
          });
        });
      }

      res.status(200).json({
        range: rangeKey,
        total: formatTime(totalSeconds),
        daily: formatTime(dailyAvg),
        daysActive: { active: daysActiveCoded, total: daysActive },
        languages: topLangs,
        editors: topEditors,
        projects: topProjects,
        dailyData: heatmapDays
      });

    } else {
      // --- 7d / 30d: Use summaries API (daily breakdown) ---
      const data = await fetchWithAuth(
        'https://wakatime.com/api/v1/users/current/summaries?range=' + rangeParam, auth, 8000
      );

      if (!data || !data.data || data.data.length === 0) {
        return res.status(200).json({ error: 'No WakaTime data available' });
      }

      let totalSeconds = 0;
      let totalDaysCoded = 0;
      const langMap = {};
      const editorMap = {};
      const projectMap = {};
      const dailyData = [];

      data.data.forEach(day => {
        const daySeconds = (day.grand_total && day.grand_total.total_seconds) || 0;
        totalSeconds += daySeconds;
        if (daySeconds > 0) totalDaysCoded++;

        dailyData.push({
          date: day.range ? day.range.start : null,
          text: day.range ? day.range.text : '',
          seconds: daySeconds
        });

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

        if (day.projects) {
          day.projects.forEach(p => {
            if (!projectMap[p.name]) projectMap[p.name] = 0;
            projectMap[p.name] += p.total_seconds;
          });
        }
      });

      const heatmapDays = dailyData.slice(-7).map(d => ({
        ...d, label: shortTime(d.seconds)
      }));

      const avgSeconds = totalSeconds / data.data.length;
      const totalDays = data.data.length;

      res.status(200).json({
        range: rangeKey,
        total: formatTime(totalSeconds),
        daily: formatTime(avgSeconds),
        daysActive: { active: totalDaysCoded, total: totalDays },
        languages: buildLangs(langMap, totalSeconds),
        editors: buildEditors(editorMap, totalSeconds),
        projects: buildProjects(projectMap, totalSeconds),
        dailyData: heatmapDays
      });
    }

  } catch (e) {
    res.status(200).json({ error: 'Failed to fetch WakaTime stats' });
  }
};
