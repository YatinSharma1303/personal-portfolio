#!/usr/bin/env python3
"""Fix ALL remaining issues in the ROOT-LEVEL script.js (not the submodule)."""

JS_PATH = '/home/z/my-project/script.js'

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

# ===== 1. CRITICAL FIX: Add `var prog` before it's used in bannerHTML =====
rp(
    "      const score = item.score ? ' \u00b7 \u2605 ' + item.score : '';\n      var bPct = (total && prog) ?",
    "      const score = item.score ? ' \u00b7 \u2605 ' + item.score : '';\n      var prog = item.progress || 0;\n      var bPct = (total && prog) ?",
    "prog fix in bannerHTML"
)

# ===== 2. Improve fallback data with real cover images =====
rp(
    "    function loadFallbackAnime() {\n      datasets.ANIME = [\n        { _status: 'CURRENT', progress: 52, score: 0, updatedAt: Date.now()/1000, media: { title: { romaji: 'NARUTO', english: 'Naruto' }, coverImage: { large: '' }, episodes: 220, duration: 23, genres: ['Action', 'Adventure'], format: 'TV' } },\n        { _status: 'COMPLETED', progress: 64, score: 0, updatedAt: Date.now()/1000 - 10, media: { title: { romaji: 'Hagane no Renkinjutsushi: FULLMETAL ALCHEMIST', english: 'Fullmetal Alchemist: Brotherhood' }, coverImage: { large: '' }, episodes: 64, duration: 25, genres: ['Action', 'Adventure', 'Drama'], format: 'TV' } },\n        { _status: 'COMPLETED', progress: 37, score: 0, updatedAt: Date.now()/1000 - 20, media: { title: { romaji: 'DEATH NOTE', english: 'Death Note' }, coverImage: { large: '' }, episodes: 37, duration: 23, genres: ['Mystery', 'Psychological', 'Thriller'], format: 'TV' } }\n      ];",
    """    function loadFallbackAnime() {
      datasets.ANIME = [
        { _status: 'CURRENT', progress: 52, score: 0, updatedAt: Date.now()/1000, media: { id: 20, title: { romaji: 'NARUTO', english: 'Naruto' }, coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx20-CXyit3VSQwF4.png' }, episodes: 220, duration: 23, meanScore: 79, genres: ['Action', 'Adventure'], format: 'TV' } },
        { _status: 'COMPLETED', progress: 64, score: 0, updatedAt: Date.now()/1000 - 10, media: { id: 5114, title: { romaji: 'FULLMETAL ALCHEMIST: BROTHERHOOD', english: 'Fullmetal Alchemist: Brotherhood' }, coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/nx5114-CXyit3VSQwF4.png' }, episodes: 64, duration: 25, meanScore: 92, genres: ['Action', 'Adventure', 'Drama'], format: 'TV' } },
        { _status: 'COMPLETED', progress: 37, score: 0, updatedAt: Date.now()/1000 - 20, media: { id: 1535, title: { romaji: 'DEATH NOTE', english: 'Death Note' }, coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/nx1535-CXyit3VSQwF4.png' }, episodes: 37, duration: 23, meanScore: 87, genres: ['Mystery', 'Psychological', 'Thriller'], format: 'TV' } },
        { _status: 'COMPLETED', progress: 75, score: 0, updatedAt: Date.now()/1000 - 30, media: { id: 16498, title: { romaji: 'SHINGEKI NO KYOJIN', english: 'Attack on Titan' }, coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx16498-CXyit3VSQwF4.png' }, episodes: 75, duration: 24, meanScore: 86, genres: ['Action', 'Drama'], format: 'TV' } },
        { _status: 'COMPLETED', progress: 26, score: 0, updatedAt: Date.now()/1000 - 40, media: { id: 21, title: { romaji: 'ONE PIECE', english: 'One Piece' }, coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21-CXyit3VSQwF4.png' }, episodes: 26, duration: 24, meanScore: 87, genres: ['Action', 'Adventure', 'Comedy'], format: 'TV' } },
        { _status: 'PLANNING', progress: 0, score: 0, updatedAt: Date.now()/1000 - 50, media: { id: 1, title: { romaji: 'COWBOY BEBOP', english: 'Cowboy Bebop' }, coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1-CXyit3VSQwF4.png' }, episodes: 26, duration: 24, meanScore: 88, genres: ['Action', 'Sci-Fi'], format: 'TV' } }
      ];""",
    "Fallback data with images"
)

# ===== 3. Add search debounce =====
rp(
    "        Widgets.bindSearch({ input: si, clear: sc, onChange: (v) => { activeSearch = v; page = 1; render(); } });",
    "        var searchTimer = null;\n        Widgets.bindSearch({ input: si, clear: sc, onChange: (v) => { clearTimeout(searchTimer); searchTimer = setTimeout(function () { activeSearch = v; page = 1; render(); }, 250); } });",
    "Search debounce"
)

# ===== 4. Add weekly eps stat to anime branch in renderStats =====
rp(
    "        const days = (mins / 1440).toFixed(1);\n        numbers = '<div class=\"al-stat-nums\">' +\n          '<span><b>' + count.toLocaleString() + '</b> anime</span>' +\n          '<span><b>' + eps.toLocaleString() + '</b> episodes</span>' +\n          '<span><b>' + days + '</b> days watched</span>' +\n          (mean ? '<span><b>' + (mean / 10).toFixed(1) + '</b> mean score</span>' : '') +\n        '</div>';",
    "        const days = (mins / 1440).toFixed(1);\n        /* #6 Episodes this week */\n        var weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;\n        var weekEps = allEntries.filter(e => (e.updatedAt || 0) >= weekAgo).reduce((s, e) => s + (Number(e.progress) || 0), 0);\n        numbers = '<div class=\"al-stat-nums\">' +\n          '<span><b>' + count.toLocaleString() + '</b> anime</span>' +\n          '<span><b>' + eps.toLocaleString() + '</b> episodes</span>' +\n          '<span><b>' + days + '</b> days watched</span>' +\n          (weekEps ? '<span class=\"al-stat-week\"><b>' + weekEps + '</b> eps this week</span>' : '') +\n          (mean ? '<span><b>' + (mean / 10).toFixed(1) + '</b> mean score</span>' : '') +\n        '</div>';",
    "Anime weekly eps stat"
)

# ===== 5. Add weekly ch stat to manga branch in renderStats =====
rp(
    "          (volumes ? '<span><b>' + volumes.toLocaleString() + '</b> volumes</span>' : '') +\n          (mean ? '<span><b>' + (mean / 10).toFixed(1) + '</b> mean score</span>' : '') +\n        '</div>';",
    "          (volumes ? '<span><b>' + volumes.toLocaleString() + '</b> volumes</span>' : '') +\n          (weekEps ? '<span class=\"al-stat-week\"><b>' + weekEps + '</b> ch this week</span>' : '') +\n          (mean ? '<span><b>' + (mean / 10).toFixed(1) + '</b> mean score</span>' : '') +\n        '</div>';",
    "Manga weekly ch stat"
)

# ===== 6. Add weekAgo/weekEps calculation before manga numbers =====
# Find the manga branch "if (!count)" line and add before numbers
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
