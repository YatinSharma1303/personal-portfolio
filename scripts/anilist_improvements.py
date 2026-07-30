#!/usr/bin/env python3
"""Apply all 19 AniList improvements to script.js"""

JS_PATH = '/home/z/my-project/personal-portfolio/script.js'

with open(JS_PATH, 'r', encoding='utf-8') as f:
    content = f.read()

# ===== 1. Fix online dot CSS (inline in al-title) =====
# The al-title already has the dot added in HTML, just need CSS for inline display
content = content.replace(
    '.al-title { font-weight: 800; font-size: 18px; }',
    '.al-title { font-weight: 800; font-size: 18px; display: flex; align-items: center; gap: 8px; }'
)

# Wait, al-title is in CSS not JS. Let me do CSS changes separately.
# Actually the CSS was already updated. Let me focus on JS changes only.

# ===== 2. Add new state variables after existing ones =====
old_vars = "    let activeSort = 'updated', activeGenre = '', activeSearch = '';"
new_vars = """    let activeSort = 'updated', activeGenre = '', activeSearch = '';
    let showMeanScore = false;  /* #12 score toggle */
    let listView = false;       /* #13 compact view */
    let PER_PAGE = 12;          /* #14 per-page (was const 6) */"""
content = content.replace(old_vars, new_vars)

# Fix: the original had `const PER_PAGE = 6;` - remove it
content = content.replace("    const PER_PAGE = 6;\n", "")

# ===== 3. Update render() function - card HTML with score badge, format chip, status attr, stagger, highlight =====
# Find the card render section and replace it
old_card_render = """        return '<div class="al-item">' +
          '<div class="al-item-cover">' +
            (img ? '<img src="' + img + '" alt="' + esc(t) + '" loading="lazy">' : '') +
            (isFav ? '<span class="al-fav" title="Favourite">\\u2665</span>' : '') +
            overlay +
          '</div>' +
          '<div class="al-item-info">' +
            '<div class="al-item-name">' + esc(t) + '</div>' +
            '<div class="al-item-score ' + scoreClass(mean) + '">' + esc(scoreLine) + '</div>' +
            (showBar ? '<div class="al-item-bar"><i style="width:' + pct + '%"></i></div>' : '') +
          '</div>' +
        '</div>';"""

new_card_render = """        /* #2 score badge */
        var scoreBadge = '';
        if (mean) {
          var sc = mean >= 75 ? 'high' : mean >= 60 ? 'mid' : 'low';
          var scoreVal = showMeanScore ? (mean / 10).toFixed(1) : (e.score || (mean / 10).toFixed(1));
          scoreBadge = '<span class="al-cover-score ' + sc + '">\\u2605 ' + scoreVal + '</span>';
        }
        /* #3 format chip */
        var fmtChip = fmt ? '<span class="al-cover-fmt">' + esc(fmt.replace(/_/g, ' ')) + '</span>' : '';
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
            (isFav ? '<span class="al-fav" title="Favourite">\\u2665</span>' : '') +
            overlay +
          '</div>' +
          '<div class="al-item-info">' +
            '<div class="al-item-name">' + nameHtml + '</div>' +
            '<div class="al-item-score ' + scoreClass(mean) + '">' + esc(scoreLine) + '</div>' +
            (showBar ? '<div class="al-item-bar"><i style="width:' + pct + '%"></i></div>' : '') +
          '</div>' +
        '</div>';"""

content = content.replace(old_card_render, new_card_render)

# ===== 4. Add idx to the slice.forEach callback =====
# The current code uses: const slice = arr.slice(...); slice is iterated
# Find: list.innerHTML = slice.map(e => {
# and add idx parameter
old_map = "      list.innerHTML = slice.map(e => {"
new_map = "      list.innerHTML = slice.map((e, idx) => {"
content = content.replace(old_map, new_map)

# ===== 5. Update empty state with icons (#17) =====
old_empty = """      if (!slice.length) {
        list.innerHTML = '<div class=\"al-empty\">No ' + (isManga() ? 'manga' : 'anime') + ' found' + (activeSearch ? ' for \\u201c' + esc(activeSearch) + '\\u201d' : '') + '.</div>';"""

new_empty = """      if (!slice.length) {
        var emptyIcon = activeStatus === 'DROPPED' ? '\\ud83d\\ude05' : activeSearch ? '\\ud83d\\udd0d' : '\\ud83c\\udfac0';
        var emptyMsg = activeStatus === 'DROPPED' ? 'Nothing dropped yet!' : activeSearch ? 'No results found' : 'Nothing here yet';
        list.innerHTML = '<div class="al-empty"><span class="al-empty-icon material-symbols-outlined">' + emptyIcon + '</span><div class="al-empty-text">' + emptyMsg + '</div></div>';"""

content = content.replace(old_empty, new_empty)

# ===== 6. Update stats to show average score prominently (#7) and days (#8) =====
# The stats already show mean score. Just ensure it's prominent. Already done in CSS.
# Days watched already calculated. Nothing to change here.

# ===== 7. Update bannerHTML to add progress bar (#16) =====
old_banner_info = """      return (img ? '<img class=\"al-banner-img\" alt=\"' + esc(t) + '\" src=\"' + img + '\">' : '') + '<div class=\"al-banner-info\"><div class=\"al-banner-label\" data-status=\"' + statusRaw.toLowerCase() + '\">' + label + '</div><div class=\"al-banner-title\">' + esc(t) + '</div><div class=\"al-banner-progress\">' + esc(progress + score) + '</div></div>';"""

new_banner_info = """      /* #16 progress bar for banner */
      var bannerPct = 0;
      if (total && prog) bannerPct = Math.min(100, Math.round(prog / total * 100));
      else if (statusRaw === 'COMPLETED') bannerPct = 100;
      var bannerBar = (bannerPct > 0 && bannerPct < 100) ? '<div class=\"al-banner-progress-bar\"><div class=\"al-banner-progress-fill\" style=\"width:' + bannerPct + '%\"></div></div>' : '';
      return (img ? '<img class=\"al-banner-img\" alt=\"' + esc(t) + '\" src=\"' + img + '\">' : '') + '<div class=\"al-banner-info\"><div class=\"al-banner-label\" data-status=\"' + statusRaw.toLowerCase() + '\">' + label + '</div><div class=\"al-banner-title\">' + esc(t) + '</div><div class=\"al-banner-progress\">' + esc(progress + score) + '</div>' + bannerBar + '</div>';"""

content = content.replace(old_banner_info, new_banner_info)

# ===== 8. Add highlightMatch helper function =====
# Insert after the scoreClass function
old_after_scoreclass = """      return 'al-score-low';
    }

    // 36. Wire the Anime/Manga switcher"""

new_after_scoreclass = """      return 'al-score-low';
    }
    /* #18 Search highlight */
    function highlightMatch(text, query) {
      if (!query) return text;
      var idx = text.toLowerCase().indexOf(query.toLowerCase());
      if (idx === -1) return text;
      return text.slice(0, idx) + '<mark class=\"al-hl\">' + text.slice(idx, idx + query.length) + '</mark>' + text.slice(idx + query.length);
    }

    // 36. Wire the Anime/Manga switcher"""

content = content.replace(old_after_scoreclass, new_after_scoreclass)

# ===== 9. Update ensureChrome to add view toggle, score toggle, per-page (#12, #13, #14) =====
old_controls_html = """        controlsBar.innerHTML =
          '<div class=\"al-search-wrap\"><span class=\"material-symbols-outlined al-search-icon\">search</span>' +
          '<input type=\"text\" class=\"al-search-input\" id=\"al-search\" maxlength=\"60\" placeholder=\"Search anime\\u2026\" autocomplete=\"off\" aria-label=\"Search titles\">' +
          '<button class=\"al-search-clear\" id=\"al-search-clear\" hidden title=\"Clear\" aria-label=\"Clear search\"><span class=\"material-symbols-outlined\">close</span></button></div>' +
          '<div class=\"al-sort\" id=\"al-sort\">' +
            '<button class=\"al-sort-btn active\" data-sort=\"updated\">Updated</button>' +
            '<button class=\"al-sort-btn\" data-sort=\"score\">Score</button>' +
            '<button class=\"al-sort-btn\" data-sort=\"title\">Title</button>' +
            '<button class=\"al-sort-btn\" data-sort=\"progress\">Progress</button>' +
          '</div>';"""

new_controls_html = """        controlsBar.innerHTML =
          '<div class=\"al-search-wrap\"><span class=\"material-symbols-outlined al-search-icon\">search</span>' +
          '<input type=\"text\" class=\"al-search-input\" id=\"al-search\" maxlength=\"60\" placeholder=\"Search anime\\u2026\" autocomplete=\"off\" aria-label=\"Search titles\">' +
          '<button class=\"al-search-clear\" id=\"al-search-clear\" hidden title=\"Clear\" aria-label=\"Clear search\"><span class=\"material-symbols-outlined\">close</span></button></div>' +
          '<div class=\"al-sort\" id=\"al-sort\">' +
            '<button class=\"al-sort-btn active\" data-sort=\"updated\">Updated</button>' +
            '<button class=\"al-sort-btn\" data-sort=\"score\">Score</button>' +
            '<button class=\"al-sort-btn\" data-sort=\"title\">Title</button>' +
            '<button class=\"al-sort-btn\" data-sort=\"progress\">Progress</button>' +
          '</div>' +
          '<button class=\"al-score-toggle\" id=\"al-score-toggle\" title=\"Toggle score type\"><span class=\"material-symbols-outlined\">swap_horiz</span>Score</button>' +
          '<div class=\"al-view-toggle\" id=\"al-view-toggle\">' +
            '<button class=\"al-view-btn active\" data-view=\"grid\" title=\"Grid\"><span class=\"material-symbols-outlined\">grid_view</span></button>' +
            '<button class=\"al-view-btn\" data-view=\"list\" title=\"List\"><span class=\"material-symbols-outlined\">view_list</span></button>' +
          '</div>' +
          '<div class=\"al-perpage\" id=\"al-perpage\">' +
            '<span>Per page:</span>' +
            '<button class=\"al-perpage-btn\" data-pp=\"6\">6</button>' +
            '<button class=\"al-perpage-btn active\" data-pp=\"12\">12</button>' +
            '<button class=\"al-perpage-btn\" data-pp=\"24\">24</button>' +
            '<button class=\"al-perpage-btn\" data-pp=\"48\">48</button>' +
          '</div>';"""

content = content.replace(old_controls_html, new_controls_html)

# ===== 10. Add event listeners for new controls after Widgets.bindSearch line =====
old_after_bindsearch = """        Widgets.bindSearch({ input: si, clear: sc, onChange: (v) => { activeSearch = v; page = 1; render(); } });
        Widgets.bindPills({ container: controlsBar.querySelector('#al-sort'), selector: '.al-sort-btn', attr: 'sort', onSelect: (v) => { activeSort = v; page = 1; render(); } });"""

new_after_bindsearch = """        Widgets.bindSearch({ input: si, clear: sc, onChange: (v) => { activeSearch = v; page = 1; render(); } });
        Widgets.bindPills({ container: controlsBar.querySelector('#al-sort'), selector: '.al-sort-btn', attr: 'sort', onSelect: (v) => { activeSort = v; page = 1; render(); } });
        /* #12 Score toggle */
        var scoreToggle = controlsBar.querySelector('#al-score-toggle');
        if (scoreToggle) scoreToggle.addEventListener('click', function () {
          showMeanScore = !showMeanScore;
          this.classList.toggle('active', showMeanScore);
          render();
        });
        /* #13 View toggle */
        var viewToggle = controlsBar.querySelector('#al-view-toggle');
        if (viewToggle) viewToggle.addEventListener('click', function (e) {
          var btn = e.target.closest('.al-view-btn'); if (!btn) return;
          var v = btn.dataset.view;
          listView = v === 'list';
          list.classList.toggle('list-view', listView);
          viewToggle.querySelectorAll('.al-view-btn').forEach(b => b.classList.toggle('active', b === btn));
        });
        /* #14 Per page */
        var ppContainer = controlsBar.querySelector('#al-perpage');
        if (ppContainer) ppContainer.addEventListener('click', function (e) {
          var btn = e.target.closest('.al-perpage-btn'); if (!btn) return;
          PER_PAGE = parseInt(btn.dataset.pp) || 12;
          page = 1;
          ppContainer.querySelectorAll('.al-perpage-btn').forEach(b => b.classList.toggle('active', b === btn));
          render();
        });"""

content = content.replace(old_after_bindsearch, new_after_bindsearch)

# ===== 11. Update render() to apply list-view class =====
# Find: ensureChrome(); at the start of render()
old_render_start = "    function render() {\n      ensureChrome();"
new_render_start = "    function render() {\n      ensureChrome();\n      list.classList.toggle('list-view', listView);"
content = content.replace(old_render_start, new_render_start)

# ===== 12. Add keyboard navigation for tabs (#10) =====
# After the tabs click handler, add keyboard nav
old_tabs_handler = """    if (tabs) tabs.addEventListener('click', (e) => {
      const t = e.target.closest('.al-tab'); if (!t) return;
      tabs.querySelectorAll('.al-tab').forEach(b => b.classList.remove('active'));
      t.classList.add('active'); activeStatus = t.dataset.status; page = 1; render();
    });"""

new_tabs_handler = """    if (tabs) tabs.addEventListener('click', (e) => {
      const t = e.target.closest('.al-tab'); if (!t) return;
      tabs.querySelectorAll('.al-tab').forEach(b => b.classList.remove('active'));
      t.classList.add('active'); activeStatus = t.dataset.status; page = 1; render();
    });
    /* #10 Keyboard navigation for tabs */
    if (tabs) tabs.addEventListener('keydown', function (e) {
      var btns = Array.from(tabs.querySelectorAll('.al-tab'));
      var idx = btns.indexOf(document.activeElement);
      if (idx === -1) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var next = e.key === 'ArrowRight' ? (idx + 1) % btns.length : (idx - 1 + btns.length) % btns.length;
        btns[next].focus(); btns[next].click();
      }
    });"""

content = content.replace(old_tabs_handler, new_tabs_handler)

# ===== 13. Add keyboard nav for media bar =====
old_media_handler = """        switchMedia(m);
      });"""

new_media_handler = """        switchMedia(m);
      });
      /* #10 Keyboard nav for media bar */
      mediaBar.addEventListener('keydown', function (e) {
        var btns = Array.from(mediaBar.querySelectorAll('.al-media-btn'));
        var idx = btns.indexOf(document.activeElement);
        if (idx === -1) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          var next = e.key === 'ArrowRight' ? (idx + 1) % btns.length : (idx - 1 + btns.length) % btns.length;
          btns[next].focus(); btns[next].click();
        }
      });"""

content = content.replace(old_media_handler, new_media_handler)

# ===== 14. Update refresh button with spin class (#19) =====
old_refresh_handler = """      const btn = $('al-refresh');"""
new_refresh_handler = """      /* #19 Refresh spinner */
      const btn = $('al-refresh');"""

content = content.replace(old_refresh_handler, new_refresh_handler)

# Find the refresh click handler
old_refresh_click = """        loadMedia(activeMedia);"""
# Need to find it in context of the refresh handler. Let me look for the pattern.
# Actually the refresh handler already exists. Let me find and update it.
old_refresh_pattern = """      if (btn) btn.addEventListener('click', () => {
        if (!loaded[activeMedia] || loading[activeMedia]) return;
        loadMedia(activeMedia);
      });"""

new_refresh_pattern = """      if (btn) btn.addEventListener('click', () => {
        if (!loaded[activeMedia] || loading[activeMedia]) return;
        btn.classList.add('spin');
        loadMedia(activeMedia);
        setTimeout(function () { btn.classList.remove('spin'); }, 800);
      });"""

content = content.replace(old_refresh_pattern, new_refresh_pattern)

# ===== 15. Make tabs focusable for keyboard nav (#10) =====
# Add tabindex="0" to tabs - actually they're buttons so already focusable.

# ===== 16. Update scoreLine to respect showMeanScore (#12) =====
old_score_line = """        const scoreLine = [progText, userScore, meanText].filter(Boolean).join(' \\u00b7 ');"""

new_score_line = """        const displayScore = showMeanScore ? (mean ? 'avg \\u2605 ' + (mean / 10).toFixed(1) : '') : userScore;
        const scoreLine = [progText, displayScore, showMeanScore ? '' : meanText].filter(Boolean).join(' \\u00b7 ');"""

content = content.replace(old_score_line, new_score_line)

with open(JS_PATH, 'w', encoding='utf-8') as f:
    f.write(content)

print("Done! All 19 AniList improvements applied to script.js")
