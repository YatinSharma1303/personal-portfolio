#!/usr/bin/env python3
"""Apply ALL 19 AniList improvements to script.js."""

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

# 1. State variables
rp(
    "    const PER_PAGE = 6;\n",
    "",
    "Remove const PER_PAGE"
)
rp(
    "    let activeSort = 'updated', activeGenre = '', activeSearch = '';",
    "    let activeSort = 'updated', activeGenre = '', activeSearch = '';\n    let showMeanScore = false;\n    let listView = false;\n    let PER_PAGE = 12;",
    "Add state vars"
)

# 2. highlightMatch helper
rp(
    "      return 'al-score-low';\n    }\n\n    // 36. Wire",
    "      return 'al-score-low';\n    }\n    function highlightMatch(text, query) {\n      if (!query) return text;\n      var i = text.toLowerCase().indexOf(query.toLowerCase());\n      if (i === -1) return text;\n      return text.slice(0, i) + '<mark class=\"al-hl\">' + text.slice(i, i + query.length) + '</mark>' + text.slice(i + query.length);\n    }\n\n    // 36. Wire",
    "highlightMatch"
)

# 3. scoreLine
rp(
    "        const scoreLine = [progText, userScore, meanText].filter(Boolean).join(' \u00b7 ');",
    "        var displayScore = showMeanScore ? (mean ? 'avg \\u2605 ' + (mean / 10).toFixed(1) : '') : userScore;\n        const scoreLine = [progText, displayScore, showMeanScore ? '' : meanText].filter(Boolean).join(' \u00b7 ');",
    "scoreLine toggle"
)

# 4. Card render
rp(
    "        return '<div class=\"al-item\">' +\n          '<div class=\"al-item-cover\">' +\n            (img ? '<img src=\"' + img + '\" alt=\"' + esc(t) + '\" loading=\"lazy\">' : '') +\n            (isFav ? '<span class=\"al-fav\" title=\"Favourite\">\u2665</span>' : '') +\n            overlay +\n          '</div>' +\n          '<div class=\"al-item-info\">' +\n            '<div class=\"al-item-name\">' + esc(t) + '</div>' +\n            '<div class=\"al-item-score ' + scoreClass(mean) + '\">' + esc(scoreLine) + '</div>' +\n            (showBar ? '<div class=\"al-item-bar\"><i style=\"width:' + pct + '%\"></i></div>' : '') +\n          '</div>' +\n        '</div>';",
    "        var scoreBadge = '';\n        if (mean) { var sc = mean >= 75 ? 'high' : mean >= 60 ? 'mid' : 'low'; var sv = showMeanScore ? (mean / 10).toFixed(1) : (e.score || (mean / 10).toFixed(1)); scoreBadge = '<span class=\"al-cover-score ' + sc + '\">\\u2605 ' + sv + '</span>'; }\n        var fmtChip = fmt ? '<span class=\"al-cover-fmt\">' + esc(fmt) + '</span>' : '';\n        var stAttr = ' data-status=\"' + st + '\"';\n        var nameHtml = activeSearch ? highlightMatch(esc(t), activeSearch) : esc(t);\n        var delay = idx * 0.04;\n        return '<div class=\"al-item\"' + stAttr + ' style=\"animation-delay:' + delay + 's\">' +\n          '<div class=\"al-item-cover\">' +\n            (img ? '<img src=\"' + img + '\" alt=\"' + esc(t) + '\" loading=\"lazy\">' : '') +\n            scoreBadge + fmtChip +\n            (isFav ? '<span class=\"al-fav\" title=\"Favourite\">\\u2665</span>' : '') +\n            overlay +\n          '</div>' +\n          '<div class=\"al-item-info\">' +\n            '<div class=\"al-item-name\">' + nameHtml + '</div>' +\n            '<div class=\"al-item-score ' + scoreClass(mean) + '\">' + esc(scoreLine) + '</div>' +\n            (showBar ? '<div class=\"al-item-bar\"><i style=\"width:' + pct + '%\"></i></div>' : '') +\n          '</div>' +\n        '</div>';",
    "Card render"
)

# 5. slice.map idx
rp(
    "      list.innerHTML = slice.map(e => {",
    "      list.innerHTML = slice.map((e, idx) => {",
    "slice.map idx"
)

# 6. Empty state (use material-symbols instead of emoji to avoid surrogate issues)
rp(
    "        list.innerHTML = '<div class=\"al-empty\">No ' + (isManga() ? 'manga' : 'anime') + ' found' + (activeSearch ? ' for \u201c' + esc(activeSearch) + '\u201d' : '') + '.</div>';",
    "        list.innerHTML = '<div class=\"al-empty\"><span class=\"al-empty-icon material-symbols-outlined\">' + (activeSearch ? 'search' : activeStatus === 'DROPPED' ? 'sentiment_satisfied' : 'movie') + '</span><div class=\"al-empty-text\">' + (activeSearch ? 'No results found' : activeStatus === 'DROPPED' ? 'Nothing dropped yet!' : 'Nothing here yet') + '</div></div>';",
    "Empty state"
)

# 7. Banner progress
rp(
    "      return (img ? '<img class=\"al-banner-img\" alt=\"' + esc(t) + '\" src=\"' + img + '\">' : '') + '<div class=\"al-banner-info\"><div class=\"al-banner-label\" data-status=\"' + statusRaw.toLowerCase() + '\">' + label + '</div><div class=\"al-banner-title\">' + esc(t) + '</div><div class=\"al-banner-progress\">' + esc(progress + score) + '</div></div>';",
    "      var bPct = (total && prog) ? Math.min(100, Math.round(prog / total * 100)) : (statusRaw === 'COMPLETED' ? 100 : 0);\n      var bBar = (bPct > 0 && bPct < 100) ? '<div class=\"al-banner-progress-bar\"><div class=\"al-banner-progress-fill\" style=\"width:' + bPct + '%\"></div></div>' : '';\n      return (img ? '<img class=\"al-banner-img\" alt=\"' + esc(t) + '\" src=\"' + img + '\">' : '') + '<div class=\"al-banner-info\"><div class=\"al-banner-label\" data-status=\"' + statusRaw.toLowerCase() + '\">' + label + '</div><div class=\"al-banner-title\">' + esc(t) + '</div><div class=\"al-banner-progress\">' + esc(progress + score) + '</div>' + bBar + '</div>';",
    "Banner progress"
)

# 8. Extended controls
rp(
    "          '</div>';\n        list.parentNode.insertBefore(controlsBar, list);",
    "          '</div>' +\n          '<button class=\"al-score-toggle\" id=\"al-score-toggle\" title=\"Toggle score\"><span class=\"material-symbols-outlined\">swap_horiz</span>Score</button>' +\n          '<div class=\"al-view-toggle\" id=\"al-view-toggle\"><button class=\"al-view-btn active\" data-view=\"grid\" title=\"Grid\"><span class=\"material-symbols-outlined\">grid_view</span></button><button class=\"al-view-btn\" data-view=\"list\" title=\"List\"><span class=\"material-symbols-outlined\">view_list</span></button></div>' +\n          '<div class=\"al-perpage\" id=\"al-perpage\">Per page:<button class=\"al-perpage-btn\" data-pp=\"6\">6</button><button class=\"al-perpage-btn active\" data-pp=\"12\">12</button><button class=\"al-perpage-btn\" data-pp=\"24\">24</button><button class=\"al-perpage-btn\" data-pp=\"48\">48</button></div>';\n        list.parentNode.insertBefore(controlsBar, list);",
    "Extended controls"
)

# 9. Event listeners
rp(
    "        Widgets.bindPills({ container: controlsBar.querySelector('#al-sort'), selector: '.al-sort-btn', attr: 'sort', onSelect: (v) => { activeSort = v; page = 1; render(); } });",
    "        Widgets.bindPills({ container: controlsBar.querySelector('#al-sort'), selector: '.al-sort-btn', attr: 'sort', onSelect: (v) => { activeSort = v; page = 1; render(); } });\n        var scoreTgl = controlsBar.querySelector('#al-score-toggle'); if (scoreTgl) scoreTgl.addEventListener('click', function () { showMeanScore = !showMeanScore; this.classList.toggle('active', showMeanScore); render(); });\n        var viewTgl = controlsBar.querySelector('#al-view-toggle'); if (viewTgl) viewTgl.addEventListener('click', function (ev) { var b = ev.target.closest('.al-view-btn'); if (!b) return; listView = b.dataset.view === 'list'; list.classList.toggle('list-view', listView); viewTgl.querySelectorAll('.al-view-btn').forEach(function(x){x.classList.toggle('active',x===b);}); });\n        var ppC = controlsBar.querySelector('#al-perpage'); if (ppC) ppC.addEventListener('click', function (ev) { var b = ev.target.closest('.al-perpage-btn'); if (!b) return; PER_PAGE = parseInt(b.dataset.pp) || 12; page = 1; ppC.querySelectorAll('.al-perpage-btn').forEach(function(x){x.classList.toggle('active',x===b);}); render(); });",
    "Event listeners"
)

# 10. list-view in render
rp(
    "    function render() {\n      ensureChrome();",
    "    function render() {\n      ensureChrome();\n      list.classList.toggle('list-view', listView);",
    "list-view in render"
)

# 11. Keyboard nav tabs
rp(
    "      t.classList.add('active'); activeStatus = t.dataset.status; page = 1; render();\n    });\n  })();",
    "      t.classList.add('active'); activeStatus = t.dataset.status; page = 1; render();\n    });\n    if (tabs) tabs.addEventListener('keydown', function (e) { var bs = Array.from(tabs.querySelectorAll('.al-tab')); var i = bs.indexOf(document.activeElement); if (i === -1) return; if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); var n = e.key === 'ArrowRight' ? (i+1)%bs.length : (i-1+bs.length)%bs.length; bs[n].focus(); bs[n].click(); } });\n  })();",
    "KB nav tabs"
)

# 12. Keyboard nav media
rp(
    "        switchMedia(m);\n      });",
    "        switchMedia(m);\n      });\n      mediaBar.addEventListener('keydown', function (e) { var bs = Array.from(mediaBar.querySelectorAll('.al-media-btn')); var i = bs.indexOf(document.activeElement); if (i === -1) return; if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); var n = e.key === 'ArrowRight' ? (i+1)%bs.length : (i-1+bs.length)%bs.length; bs[n].focus(); bs[n].click(); } });",
    "KB nav media"
)

# 13. Refresh spinner
rp(
    "      if (btn) btn.addEventListener('click', () => {\n        if (!loaded[activeMedia] || loading[activeMedia]) return;\n        loadMedia(activeMedia);\n      });",
    "      if (btn) btn.addEventListener('click', () => {\n        if (!loaded[activeMedia] || loading[activeMedia]) return;\n        btn.classList.add('spin');\n        loadMedia(activeMedia);\n        setTimeout(function () { btn.classList.remove('spin'); }, 800);\n      });",
    "Refresh spinner"
)

with open(JS_PATH, 'w', encoding='utf-8') as f:
    f.write(s)

for r in results:
    print(r)
print(f"\nTotal: {results.count('OK')}/{len(results)} applied")
