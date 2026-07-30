#!/usr/bin/env python3
"""Fix renderStats to handle statsData with all-zero values (private stats)."""

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

# Fix anime branch: when statsData.count is 0 but we have entries, fall back
rp(
    """      } else {
        let eps, mins;
        if (statsData) {
          count = statsData.count || 0; eps = statsData.episodesWatched || 0;
          mins = statsData.minutesWatched || 0; mean = statsData.meanScore || 0;
          genres = (statsData.genres || []).slice();
        } else {""",
    """      } else {
        let eps, mins;
        if (statsData && (statsData.count || statsData.episodesWatched)) {
          count = statsData.count || 0; eps = statsData.episodesWatched || 0;
          mins = statsData.minutesWatched || 0; mean = statsData.meanScore || 0;
          genres = (statsData.genres || []).slice();
        } else {""",
    "Anime statsData fallback when zeros"
)

# Fix manga branch: same issue
rp(
    """      if (isManga()) {
        let chapters, volumes;
        if (statsData) {
          count = statsData.count || 0; chapters = statsData.chaptersRead || 0;
          volumes = statsData.volumesRead || 0; mean = statsData.meanScore || 0;
          genres = (statsData.genres || []).slice();
        } else {""",
    """      if (isManga()) {
        let chapters, volumes;
        if (statsData && (statsData.count || statsData.chaptersRead)) {
          count = statsData.count || 0; chapters = statsData.chaptersRead || 0;
          volumes = statsData.volumesRead || 0; mean = statsData.meanScore || 0;
          genres = (statsData.genres || []).slice();
        } else {""",
    "Manga statsData fallback when zeros"
)

with open(JS_PATH, 'w', encoding='utf-8') as f:
    f.write(s)

for r in results:
    print(r)
