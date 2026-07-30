#!/usr/bin/env python3
"""Apply remaining AniList JS improvements that need exact string matching."""

JS_PATH = '/home/z/my-project/personal-portfolio/script.js'

with open(JS_PATH, 'r', encoding='utf-8') as f:
    content = f.read()

# ===== A. Replace card render (exact match with actual unicode chars) =====
old_card = """        return '<div class="al-item">' +
          '<div class="al-item-cover">' +
            (img ? '<img src="' + img + '" alt="' + esc(t) + '" loading="lazy">' : '') +
            (isFav ? '<span class="al-fav" title="Favourite">\u2665</span>' : '') +
            overlay +
          '</div>' +
          '<div class="al-item-info">' +
            '<div class="al-item-name">' + esc(t) + '</div>' +
            '<div class="al-item-score ' + scoreClass(mean) + '">' + esc(scoreLine) + '</div>' +
            (showBar ? '<div class="al-item-bar"><i style="width:' + pct + '%"></i></div>' : '') +
          '</div>' +
        '</div>';"""

new_card = """        /* #2 score badge on cover */
        var scoreBadge = '';
        if (mean) {
          var sc = mean >= 75 ? 'high' : mean >= 60 ? 'mid' : 'low';
          var scoreVal = showMeanScore ? (mean / 10).toFixed(1) : (e.score || (mean / 10).toFixed(1));
          scoreBadge = '<span class="al-cover-score ' + sc + '">\u2605 ' + scoreVal + '</span>';
        }
        /* #3 format chip */
        var fmtChip = fmt ? '<span class="al-cover-fmt">' + esc(fmt) + '</span>' : '';
        /* #15 stagger delay */
        var delay = idx * 0.04;
        /* #4 status attr */
        var stAttr = ' data-status="' + st + '"';
        /* #18 search highlight */
        var nameHtml = activeSearch ? highlightMatch(esc(t), activeSearch) : esc(t);

        return '<div class="al-item"' + stAttr + ' style="animation-delay:' + delay + 's">' +
          '<div class="al-item-cover">' +
            (img ? '<img src="' + img + '" alt="' + esc(t) + '" loading="lazy">' : '') +
            scoreBadge + fmtChip +
            (isFav ? '<span class="al-fav" title="Favourite">\u2665</span>' : '') +
            overlay +
          '</div>' +
          '<div class="al-item-info">' +
            '<div class="al-item-name">' + nameHtml + '</div>' +
            '<div class="al-item-score ' + scoreClass(mean) + '">' + esc(scoreLine) + '</div>' +
            (showBar ? '<div class="al-item-bar"><i style="width:' + pct + '%"></i></div>' : '') +
          '</div>' +
        '</div>';"""

if old_card in content:
    content = content.replace(old_card, new_card)
    print("Card render replaced successfully")
else:
    print("WARNING: Card render not found! Trying character-by-character debug...")
    # Find the approximate location
    idx = content.find("return '<div class=\"al-item\">'")
    if idx >= 0:
        print(f"Found at index {idx}")
        # Show what's around it
        snippet = content[idx:idx+200]
        print(f"Snippet: {repr(snippet[:200])}")
    else:
        print("Could not find card render at all")

# ===== B. Replace scoreLine to respect showMeanScore (#12) =====
old_sl = """        const scoreLine = [progText, userScore, meanText].filter(Boolean).join(' \u00b7 ');"""
new_sl = """        const displayScore = showMeanScore ? (mean ? 'avg \u2605 ' + (mean / 10).toFixed(1) : '') : userScore;
        const scoreLine = [progText, displayScore, showMeanScore ? '' : meanText].filter(Boolean).join(' \u00b7 ');"""

if old_sl in content:
    content = content.replace(old_sl, new_sl)
    print("ScoreLine replaced successfully")
else:
    print("WARNING: scoreLine not found")
    idx = content.find("const scoreLine")
    if idx >= 0:
        print(f"Found at index {idx}")
        print(repr(content[idx:idx+120]))

# ===== C. Replace empty state (#17) =====
old_empty = """        list.innerHTML = '<div class=\"al-empty\">No ' + (isManga() ? 'manga' : 'anime') + ' found' + (activeSearch ? ' for \u201c' + esc(activeSearch) + '\u201d' : '') + '.</div>';"""
new_empty = """        var emptyIcon = activeSearch ? '\ud83d\udd0d' : activeStatus === 'DROPPED' ? '\ud83d\ude05' : '\ud83c\udfac';
        var emptyMsg = activeSearch ? 'No results found' : activeStatus === 'DROPPED' ? 'Nothing dropped yet!' : 'Nothing here yet';
        list.innerHTML = '<div class=\"al-empty\"><span class=\"al-empty-icon material-symbols-outlined\">' + emptyIcon + '</span><div class=\"al-empty-text\">' + emptyMsg + '</div></div>';"""

if old_empty in content:
    content = content.replace(old_empty, new_empty)
    print("Empty state replaced successfully")
else:
    print("WARNING: empty state not found")

# ===== D. Replace slice.map to add idx =====
old_map = "      list.innerHTML = slice.map(e => {"
new_map = "      list.innerHTML = slice.map((e, idx) => {"

if old_map in content:
    content = content.replace(old_map, new_map)
    print("slice.map replaced successfully")
else:
    print("WARNING: slice.map not found")

with open(JS_PATH, 'w', encoding='utf-8') as f:
    f.write(content)

print("\nAll done!")
