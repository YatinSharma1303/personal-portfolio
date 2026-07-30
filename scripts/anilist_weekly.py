#!/usr/bin/env python3
"""Add 'eps this week' stat to renderStats() in both anime and manga branches."""

JS_PATH = '/home/z/my-project/personal-portfolio/script.js'

with open(JS_PATH, 'r', encoding='utf-8') as f:
    s = f.read()

results = []

def rp(old, new, label):
    global s
    if old in s:
        s = s.replace(old, new, 1)
        results.append("OK: " + label)
    else:
        results.append("MISS: " + label)

# 1. Anime branch - add weekly eps stat
rp(
    "          '<span><b>' + days + '</b> days watched</span>' +\n          (mean ? '<span><b>' + (mean / 10).toFixed(1) + '</b> mean score</span>' : '') +\n        '</div>';",
    "          '<span><b>' + days + '</b> days watched</span>' +\n          (weekEps ? '<span class=\"al-stat-week\"><b>' + weekEps + '</b> eps this week</span>' : '') +\n          (mean ? '<span><b>' + (mean / 10).toFixed(1) + '</b> mean score</span>' : '') +\n        '</div>';",
    "Anime weekly eps"
)

# 2. Add weekAgo/weekEps calculation before the anime numbers string
rp(
    "        const days = (mins / 1440).toFixed(1);\n        numbers = '<div class=\"al-stat-nums\">' +",
    "        const days = (mins / 1440).toFixed(1);\n        /* #6 Episodes this week */\n        var weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;\n        var weekEps = allEntries.filter(e => (e.updatedAt || 0) >= weekAgo).reduce((s, e) => s + (Number(e.progress) || 0), 0);\n        numbers = '<div class=\"al-stat-nums\">' +",
    "Anime weekAgo calc"
)

# 3. Manga branch - add weekly chapters stat
rp(
    "          (volumes ? '<span><b>' + volumes.toLocaleString() + '</b> volumes</span>' : '') +\n          (mean ? '<span><b>' + (mean / 10).toFixed(1) + '</b> mean score</span>' : '') +\n        '</div>';",
    "          (volumes ? '<span><b>' + volumes.toLocaleString() + '</b> volumes</span>' : '') +\n          (weekEps ? '<span class=\"al-stat-week\"><b>' + weekEps + '</b> ch this week</span>' : '') +\n          (mean ? '<span><b>' + (mean / 10).toFixed(1) + '</b> mean score</span>' : '') +\n        '</div>';",
    "Manga weekly ch"
)

# 4. Add weekAgo/weekEps calculation before the manga numbers string
rp(
    "        if (!count) { statsPanel.innerHTML = ''; return; }\n        numbers = '<div class=\"al-stat-nums\">' +\n          '<span><b>' + count.toLocaleString() + '</b> manga</span>' +",
    "        if (!count) { statsPanel.innerHTML = ''; return; }\n        /* #6 Chapters this week */\n        var weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;\n        var weekEps = allEntries.filter(e => (e.updatedAt || 0) >= weekAgo).reduce((s, e) => s + (Number(e.progress) || 0), 0);\n        numbers = '<div class=\"al-stat-nums\">' +\n          '<span><b>' + count.toLocaleString() + '</b> manga</span>' +",
    "Manga weekAgo calc"
)

with open(JS_PATH, 'w', encoding='utf-8') as f:
    f.write(s)

for r in results:
    print(r)
print(f"\nTotal: {results.count('OK')}/{len(results)} applied")
