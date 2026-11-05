(function () {
  'use strict';

  var app = document.getElementById('app');
  var GITHUB_URL = 'https://github.com/NanXianBin/Metacritic_GameRating';
  var APP_VERSION = (function () {
    try {
      if (window.Android && window.Android.getVersionName) {
        return String(window.Android.getVersionName() || '2.0');
      }
    } catch (error) { /* ignore */ }
    return '2.0';
  })();
  var hasAndroid = !!(window.Android && window.Android.httpGet);
  var hasTranslate = !!(window.Android && window.Android.translate);
  var hasStorage = !!(window.Android && window.Android.loadState && window.Android.saveState);

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function tone(score) {
    if (score == null) return 'n';
    if (score >= 95) return 'gold';
    if (score >= 80) return 'g';
    if (score >= 50) return 'm';
    return 'r';
  }
  function userTone(score) {
    if (score == null) return 'n';
    if (score >= 7.5) return 'g';
    if (score >= 5) return 'm';
    return 'r';
  }
  function fmtDate(value) {
    return /^\d{4}-\d{2}-\d{2}/.test(value || '') ? String(value).slice(0, 10) : '';
  }
  function toast(message) {
    var node = document.createElement('div');
    node.className = 'toast';
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(function () { node.classList.add('show'); }, 10);
    setTimeout(function () { node.classList.remove('show'); setTimeout(function () { node.remove(); }, 300); }, 2600);
  }

  // ------------------------------------------------------------------
  // native HTTP bridge (bypasses WebView CORS for Metacritic / Bing)
  // ------------------------------------------------------------------
  var httpSeq = 0;
  var httpPending = {};
  function nativeFetch(url) {
    return new Promise(function (resolve, reject) {
      if (!hasAndroid) { reject(new Error('native http unavailable')); return; }
      var id = 'h' + (++httpSeq);
      var timer = setTimeout(function () {
        if (httpPending[id]) { delete httpPending[id]; reject(new Error('请求超时')); }
      }, 35000);
      httpPending[id] = { resolve: resolve, reject: reject, timer: timer };
      try { window.Android.httpGet(String(url), id); } catch (error) { clearTimeout(timer); delete httpPending[id]; reject(error); }
    });
  }
  window.__onHttp = function (id, status) {
    var pending = httpPending[id];
    if (!pending) return;
    delete httpPending[id];
    clearTimeout(pending.timer);
    var body = '';
    try { body = window.Android.takeHttp(id) || ''; } catch (error) { body = ''; }
    pending.resolve({
      ok: status >= 200 && status < 300,
      status: status,
      text: function () { return Promise.resolve(body); },
      json: function () { return Promise.resolve(JSON.parse(body)); },
    });
  };
  if (hasAndroid) window.fetch = nativeFetch;
  if (typeof AbortSignal !== 'undefined') {
    if (!AbortSignal.timeout) {
      AbortSignal.timeout = function (ms) {
        var controller = new AbortController();
        setTimeout(function () { controller.abort(); }, ms);
        return controller.signal;
      };
    }
    if (!AbortSignal.any) {
      AbortSignal.any = function (signals) {
        var controller = new AbortController();
        signals.forEach(function (signal) {
          if (!signal) return;
          if (signal.aborted) controller.abort();
          else signal.addEventListener('abort', function () { controller.abort(); });
        });
        return controller.signal;
      };
    }
  }

  // ------------------------------------------------------------------
  // translation bridge (Bing only)
  // ------------------------------------------------------------------
  var trSeq = 0;
  var trPending = {};
  function nativeTranslate(text) {
    return new Promise(function (resolve) {
      if (!hasTranslate) { resolve(null); return; }
      var id = 't' + (++trSeq);
      var timer = setTimeout(function () { if (trPending[id]) { delete trPending[id]; resolve(null); } }, 40000);
      trPending[id] = { resolve: resolve, timer: timer };
      try { window.Android.translate(String(text), 'text', id); } catch (error) { clearTimeout(timer); delete trPending[id]; resolve(null); }
    });
  }
  window.__nativeTranslate = function (id, text) {
    var pending = trPending[id];
    if (!pending) return;
    delete trPending[id];
    clearTimeout(pending.timer);
    pending.resolve(text || null);
  };

  // ------------------------------------------------------------------
  // persistence + store
  // ------------------------------------------------------------------
  var stored = null;
  try {
    if (hasStorage) {
      var raw = window.Android.loadState();
      if (raw) stored = JSON.parse(raw);
    }
  } catch (error) { stored = null; }

  var BUNDLE = Array.isArray(window.__GAMES__) ? window.__GAMES__ : [];
  var PLATFORM_INDEX = window.__PLATFORM_INDEX__ || null;
  function fromBundle(row) {
    return {
      title: row.t,
      slug: row.uu,
      url: row.uu ? 'https://www.metacritic.com/game/' + row.uu + '/' : '',
      year: row.y || null,
      releaseDate: row.d || null,
      score: row.s == null ? null : row.s,
      userScore: row.u == null ? null : row.u,
      platform: row.p || null,
      platforms: Array.isArray(row.pl) ? row.pl : [],
      cover: row.cv || null,
      summary: row.sm || null,
      badge: row.b || null,
      titleCn: row.c || null,
    };
  }

  var initialGames = stored && Array.isArray(stored.games) && stored.games.length
    ? stored.games
    : BUNDLE.map(fromBundle);
  var bundleBadges = {};
  BUNDLE.forEach(function (row) {
    if (row.b) bundleBadges[row.uu] = row.b;
  });
  initialGames.forEach(function (game) {
    if (!game.badge && bundleBadges[game.slug]) game.badge = bundleBadges[game.slug];
  });
  var translations = (stored && stored.translations) || {};
  var details = (stored && stored.details) || {};
  var yearsInfo = (stored && stored.years) || {};
  BUNDLE.forEach(function (row) {
    if (row.c && !translations[row.t]) translations[row.t] = row.c;
  });

  var gameMap = new Map();
  initialGames.forEach(function (game) {
    if (game && (game.slug || game.url)) gameMap.set(game.slug || game.url, game);
  });
  // Seed the per-year crawl record from the bundled snapshot so the first
  // "实时抓取" only refreshes recent years instead of re-crawling everything.
  if (!stored) {
    initialGames.forEach(function (game) {
      if (game.year) yearsInfo[game.year] = yearsInfo[game.year] || { count: 0 };
    });
  }
  var gamesCache = null;
  function allGames() {
    if (!gamesCache) gamesCache = Array.from(gameMap.values());
    return gamesCache;
  }
  function mergeGames(list) {
    var added = 0;
    var updated = 0;
    (list || []).forEach(function (game) {
      if (!game) return;
      var key = game.slug || game.url;
      if (!key) return;
      var current = gameMap.get(key);
      if (current) { Object.assign(current, game); updated += 1; }
      else { gameMap.set(key, game); added += 1; }
    });
    gamesCache = null;
    return { added: added, updated: updated };
  }

  var saveTimer = null;
  var saving = false;
  function saveSoon() {
    if (!hasStorage) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1200);
  }
  function saveNow() {
    if (!hasStorage || saving) return;
    saving = true;
    try {
      window.Android.saveState(JSON.stringify({
        v: 1,
        games: allGames(),
        translations: translations,
        details: details,
        years: yearsInfo,
        updatedAt: Date.now(),
      }));
    } catch (error) { /* ignore write errors */ }
    saving = false;
  }

  function tr(title) { return translations[title] || ''; }

  // ------------------------------------------------------------------
  // state + facets
  // ------------------------------------------------------------------
  var state = {
    q: '',
    from: null,
    to: null,
    selectedPlatforms: [],
    sort: 'score',
    mustPlay: false,
    limit: 60,
    detail: null,
    theme: localStorage.getItem('mcg.theme') || 'light',
    busy: null,
    progress: null,
    bulk: null,
  };

  var FILTER_KEY = 'mcg.filters';
  function saveFilters() {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify({
        q: state.q,
        from: state.from,
        to: state.to,
        platforms: state.selectedPlatforms,
        sort: state.sort,
        mustPlay: state.mustPlay,
      }));
    } catch (error) {
      /* storage may be unavailable */
    }
  }
  function restoreFilters() {
    var data = null;
    try {
      var raw = localStorage.getItem(FILTER_KEY);
      if (raw) data = JSON.parse(raw);
    } catch (error) {
      data = null;
    }
    if (!data || typeof data !== 'object') return;
    if (typeof data.q === 'string') state.q = data.q;
    if (['score', 'score_asc', 'name'].indexOf(data.sort) !== -1) state.sort = data.sort;
    if (typeof data.mustPlay === 'boolean') state.mustPlay = data.mustPlay;
    if (Array.isArray(data.platforms)) {
      state.selectedPlatforms = data.platforms.filter(function (name) {
        return platforms.indexOf(name) !== -1;
      });
    }
    if (years.length && Number.isFinite(data.from) && Number.isFinite(data.to)) {
      var min = years[years.length - 1];
      var max = years[0];
      var from = Math.max(min, Math.min(max, data.from));
      var to = Math.max(min, Math.min(max, data.to));
      if (from <= to) {
        state.from = from;
        state.to = to;
      }
    }
  }

  var years = [];
  var platforms = [];
  function rebuildFacets() {
    var yearSet = {};
    var platformSet = {};
    allGames().forEach(function (game) {
      if (game.year) yearSet[game.year] = true;
      var list = game.platforms && game.platforms.length ? game.platforms : game.platform ? [game.platform] : [];
      list.forEach(function (name) { platformSet[name] = true; });
    });
    years = Object.keys(yearSet).map(Number).sort(function (a, b) { return b - a; });
    platforms = Object.keys(platformSet).sort(function (a, b) { return a.localeCompare(b, 'en'); });
    if (!state.from && years.length) state.from = years[years.length - 1];
    if (!state.to && years.length) state.to = years[0];
  }

  function applyTheme() {
    if (state.theme === 'neon') document.body.classList.add('neon');
    else document.body.classList.remove('neon');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', state.theme === 'neon' ? '#0b0618' : '#f4f5f7');
    if (window.Android && window.Android.setTheme) {
      try { window.Android.setTheme(state.theme !== 'neon'); } catch (error) { /* ignore */ }
    }
  }

  window.__dynamicColors = function (colors) {
    if (!colors || !colors.accent) return;
    document.documentElement.style.setProperty('--accent', colors.accent);
  };

  function filtered() {
    var needle = state.q.trim().toLowerCase();
    var rows = [];
    var hasPlatforms = state.selectedPlatforms.length > 0;
    allGames().forEach(function (game) {
      if (!hasPlatforms) {
        if (game.year && (game.year < state.from || game.year > state.to)) return;
      } else {
        var entry = PLATFORM_INDEX ? PLATFORM_INDEX[game.slug] : null;
        if (entry && !Array.isArray(entry)) {
          var hit = state.selectedPlatforms.some(function (name) {
            var yearsList = entry[name];
            if (!yearsList) {
              Object.keys(entry).forEach(function (key) {
                if (key.toLowerCase() === name.toLowerCase()) yearsList = entry[key];
              });
            }
            if (!yearsList || !yearsList.length) return false;
            return yearsList.some(function (year) { return year >= state.from && year <= state.to; });
          });
          if (!hit) return;
        } else {
          var list = Array.isArray(entry) && entry.length
            ? entry
            : game.platforms && game.platforms.length
              ? game.platforms
              : game.platform
                ? [game.platform]
                : [];
          var matched = false;
          for (var i = 0; i < list.length; i += 1) {
            if (state.selectedPlatforms.indexOf(list[i]) !== -1) { matched = true; break; }
          }
          if (!matched) return;
          if (game.year && (game.year < state.from || game.year > state.to)) return;
        }
      }
      if (state.mustPlay && game.badge !== 'must-play') return;
      if (needle) {
        var hay = (game.title + ' ' + tr(game.title) + ' ' + (game.summary || '')).toLowerCase();
        if (hay.indexOf(needle) === -1) return;
      }
      rows.push(game);
    });
    rows.sort(function (a, b) {
      if (state.sort === 'score_asc') return (a.score == null ? -1 : a.score) - (b.score == null ? -1 : b.score);
      if (state.sort === 'year') return (b.year || 0) - (a.year || 0) || (b.score || 0) - (a.score || 0);
      if (state.sort === 'year_asc') return (a.year || 0) - (b.year || 0) || (b.score || 0) - (a.score || 0);
      if (state.sort === 'name') return (tr(a.title) || a.title).localeCompare(tr(b.title) || b.title, 'zh-CN');
      return (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score);
    });
    return rows;
  }

  // ------------------------------------------------------------------
  // crawl
  // ------------------------------------------------------------------
  function chooseYears(full) {
    var last = MCScraper && typeof MCScraper.LAST_YEAR === 'number' ? MCScraper.LAST_YEAR : Math.max(2026, new Date().getFullYear());
    var first = MCScraper ? MCScraper.FIRST_YEAR : 1995;
    if (full) {
      var all = [];
      for (var y = first; y <= last; y += 1) all.push(y);
      return all;
    }
    var set = {};
    set[last] = true;
    set[last - 1] = true;
    for (var year = first; year <= last; year += 1) {
      if (!yearsInfo[year]) set[year] = true;
    }
    return Object.keys(set).map(Number).sort(function (a, b) { return b - a; });
  }

  function startCrawl(full) {
    if (state.busy) return;
    if (!hasAndroid) { toast('抓取功能需在 App 内运行'); return; }
    state.busy = full ? 'full' : 'inc';
    state.progress = { phase: 'discovering', done: 0, total: 0, games: 0 };
    render();
    var targetYears = chooseYears(full);
    var facade = {
      setYear: function (year, info) { yearsInfo[year] = info; saveSoon(); },
    };
    MCScraper.crawlYears({
      store: facade,
      years: targetYears,
      concurrency: 4,
      onProgress: function (progress) {
        if (!state.busy) return;
        state.progress = progress;
        updateProgressBar();
      },
      onCheckpoint: function (partial) {
        if (!state.busy) return;
        mergeGames(partial);
        saveSoon();
      },
    }).then(function (games) {
      if (!state.busy) return;
      var result = mergeGames(games);
      saveSoon();
      rebuildFacets();
      state.busy = null;
      state.progress = null;
      render();
      toast('抓取完成：新增 ' + result.added + '，更新 ' + result.updated);
      var fresh = [];
      games.forEach(function (game) {
        if (game.title && !translations[game.title]) fresh.push(game.title);
      });
      if (fresh.length) translateTitles(fresh);
    }).catch(function (error) {
      state.busy = null;
      state.progress = null;
      render();
      toast('抓取失败：' + (error && error.message ? error.message : error));
    });
  }

  function updateProgressBar() {
    var box = document.getElementById('progress');
    if (!box || !state.progress) return;
    var progress = state.progress;
    var percent = progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
    box.innerHTML =
      '<div class="prow"><span>' + (progress.phase === 'discovering' ? '扫描年份' : '抓取页面') + '</span>' +
      '<span>' + (progress.done || 0) + ' / ' + (progress.total || 0) + '</span></div>' +
      '<div class="pbar"><i style="width:' + percent + '%"></i></div>';
  }

  // ------------------------------------------------------------------
  // title translation (Bing, batched)
  // ------------------------------------------------------------------
  var translating = false;
  function translateTitles(titles) {
    if (translating) return;
    var unique = [];
    var seen = {};
    (titles || []).forEach(function (title) {
      if (!title || translations[title] || seen[title]) return;
      seen[title] = true;
      unique.push(title);
    });
    if (!unique.length) { toast('没有需要翻译的游戏名'); return; }
    if (!hasTranslate) { toast('翻译功能需在 App 内运行'); return; }
    translating = true;
    state.bulk = { done: 0, total: unique.length };
    render();

    async function run() {
      for (var index = 0; index < unique.length; index += 10) {
        var chunk = unique.slice(index, index + 10);
        var out = await nativeTranslate(chunk.join('\n'));
        if (out) {
          var lines = String(out).split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
          if (lines.length === chunk.length) {
            chunk.forEach(function (title, i) {
              if (lines[i] && lines[i] !== title) translations[title] = lines[i];
            });
          } else {
            for (var i = 0; i < chunk.length; i += 1) {
              var single = await nativeTranslate(chunk[i]);
              if (single && single !== chunk[i]) translations[chunk[i]] = single;
            }
          }
        }
        state.bulk.done = Math.min(unique.length, index + chunk.length);
        saveSoon();
        updateBulkBar();
      }
      translating = false;
      state.bulk = null;
      saveSoon();
      render();
      toast('翻译完成');
    }
    run();
  }

  function updateBulkBar() {
    var box = document.getElementById('bulkbar');
    if (!box || !state.bulk) return;
    box.innerHTML =
      '<div class="prow"><span>Bing 翻译</span><span>' + state.bulk.done + ' / ' + state.bulk.total + '</span></div>' +
      '<div class="pbar"><i style="width:' + Math.round((state.bulk.done / state.bulk.total) * 100) + '%"></i></div>';
  }

  // ------------------------------------------------------------------
  // list
  // ------------------------------------------------------------------
  function yearOptions(selected) {
    return years.map(function (year) {
      return '<option value="' + year + '"' + (year === selected ? ' selected' : '') + '>' + year + '</option>';
    }).join('');
  }
  function platformOptions() {
    return '<option value="">全部平台</option>' + platforms.map(function (name) {
      return '<option value="' + esc(name) + '"' + (name === state.platform ? ' selected' : '') + '>' + esc(name) + '</option>';
    }).join('');
  }
  function sortLabel(value) {
    if (value === 'score_asc') return '评分最低';
    if (value === 'name') return '名称排序';
    return '评分最高';
  }

  function sortOptions() {
    var options = [['score', '评分最高'], ['score_asc', '评分最低'], ['name', '名称排序']];
    return options.map(function (pair) {
      return '<option value="' + pair[0] + '"' + (pair[0] === state.sort ? ' selected' : '') + '>' + pair[1] + '</option>';
    }).join('');
  }

  var sheetNodes = null;
  function closeSheet() {
    if (!sheetNodes) return;
    var nodes = sheetNodes;
    sheetNodes = null;
    nodes.scrim.classList.remove('show');
    nodes.sheet.classList.remove('show');
    setTimeout(function () {
      if (nodes.scrim.parentNode) nodes.scrim.parentNode.removeChild(nodes.scrim);
      if (nodes.sheet.parentNode) nodes.sheet.parentNode.removeChild(nodes.sheet);
    }, 240);
  }
  function showSheet(html) {
    closeSheet();
    var scrim = document.createElement('div');
    scrim.className = 'scrim';
    var sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = html;
    document.body.appendChild(scrim);
    document.body.appendChild(sheet);
    scrim.addEventListener('click', closeSheet);
    sheetNodes = { scrim: scrim, sheet: sheet };
    requestAnimationFrame(function () {
      scrim.classList.add('show');
      sheet.classList.add('show');
    });
  }

  function yearColumnItems(draft, key) {
    return years.map(function (year) {
      return '<button type="button" class="year-item' + (draft[key] === year ? ' on' : '') + '" data-year="' + year + '">' + year + '</button>';
    }).join('');
  }

  function openYearSheet() {
    if (!years.length) return;
    var draft = { from: state.from, to: state.to };
    var last = years[0];
    var first = years[years.length - 1];
    var presets = [
      ['全部年份', first, last],
      ['最近 5 年', Math.max(first, last - 4), last],
      ['2020 年代', Math.max(first, 2020), last],
      ['2010 年代', Math.max(first, 2010), Math.min(last, 2019)],
    ];
    showSheet(
      '<div class="sheet-handle"></div>' +
      '<div class="sheet-title">年份范围</div>' +
      '<div class="year-draft" id="yearDraftLabel">' + esc(draft.from) + ' – ' + esc(draft.to) + '</div>' +
      '<div class="sheet-year-cols">' +
        '<div class="ycol"><div class="ycol-h">开始年份</div><div class="ylist" id="yearFromList">' + yearColumnItems(draft, 'from') + '</div></div>' +
        '<div class="ycol"><div class="ycol-h">结束年份</div><div class="ylist" id="yearToList">' + yearColumnItems(draft, 'to') + '</div></div>' +
      '</div>' +
      '<div class="chiprow">' + presets.map(function (preset) {
        return '<button class="chipbtn" type="button" data-from="' + preset[1] + '" data-to="' + preset[2] + '">' + preset[0] + '</button>';
      }).join('') + '</div>' +
      '<div class="sheet-actions"><button class="btn-text" id="sheetCancel" type="button">取消</button><button class="btn-filled" id="sheetApply" type="button">应用</button></div>'
    );
    var fromList = document.getElementById('yearFromList');
    var toList = document.getElementById('yearToList');
    var label = document.getElementById('yearDraftLabel');

    function scrollToSelected(listEl) {
      var target = listEl.querySelector('.year-item.on');
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center' });
    }
    function bindColumns() {
      fromList.querySelectorAll('.year-item').forEach(function (button) {
        button.addEventListener('click', function () {
          draft.from = Number(button.getAttribute('data-year'));
          if (draft.to < draft.from) draft.to = draft.from;
          refresh();
        });
      });
      toList.querySelectorAll('.year-item').forEach(function (button) {
        button.addEventListener('click', function () {
          draft.to = Number(button.getAttribute('data-year'));
          if (draft.from > draft.to) draft.from = draft.to;
          refresh();
        });
      });
    }
    function refresh() {
      label.textContent = draft.from + ' – ' + draft.to;
      fromList.innerHTML = yearColumnItems(draft, 'from');
      toList.innerHTML = yearColumnItems(draft, 'to');
      bindColumns();
      scrollToSelected(fromList);
      scrollToSelected(toList);
    }
    bindColumns();
    scrollToSelected(fromList);
    scrollToSelected(toList);
    document.getElementById('sheetCancel').addEventListener('click', closeSheet);
    sheetNodes.sheet.querySelectorAll('.chipbtn').forEach(function (button) {
      button.addEventListener('click', function () {
        draft.from = Number(button.getAttribute('data-from'));
        draft.to = Number(button.getAttribute('data-to'));
        refresh();
      });
    });
    document.getElementById('sheetApply').addEventListener('click', function () {
      state.from = Math.min(draft.from, draft.to);
      state.to = Math.max(draft.from, draft.to);
      state.limit = 60;
      saveFilters();
      closeSheet();
      shell();
      renderList();
    });
  }

  function openSortSheet() {
    var options = [['score', '评分最高'], ['score_asc', '评分最低'], ['name', '名称排序']];
    showSheet(
      '<div class="sheet-handle"></div>' +
      '<div class="sheet-title">排序方式</div>' +
      '<div class="checklist">' + options.map(function (pair) {
        return '<div class="checkrow" data-sort="' + pair[0] + '"><span>' + pair[1] + '</span><span class="checkbox' + (state.sort === pair[0] ? ' on' : '') + '">✓</span></div>';
      }).join('') + '</div>' +
      '<div class="sheet-actions"><button class="btn-text" id="sheetCancel" type="button">取消</button></div>'
    );
    sheetNodes.sheet.querySelectorAll('.checkrow').forEach(function (row) {
      row.addEventListener('click', function () {
        state.sort = row.getAttribute('data-sort');
        state.limit = 60;
        saveFilters();
        closeSheet();
        shell();
        renderList();
      });
    });
    document.getElementById('sheetCancel').addEventListener('click', closeSheet);
  }

  function openPlatformSheet() {
    var picked = state.selectedPlatforms.slice();
    showSheet(
      '<div class="sheet-handle"></div>' +
      '<div class="sheet-title">平台筛选（可多选）</div>' +
      '<div class="checklist" id="sheetPlatforms">' +
        platforms.map(function (name) {
          var on = picked.indexOf(name) !== -1;
          return '<div class="checkrow" data-name="' + esc(name) + '"><span>' + esc(name) + '</span><span class="checkbox' + (on ? ' on' : '') + '">✓</span></div>';
        }).join('') +
      '</div>' +
      '<div class="sheet-actions">' +
        '<button class="btn-text" id="sheetCancel" type="button">取消</button>' +
        '<button class="btn-text" id="sheetClear" type="button">清空</button>' +
        '<button class="btn-filled" id="sheetApply" type="button">应用</button>' +
      '</div>'
    );
    var rows = sheetNodes.sheet.querySelectorAll('.checkrow');
    rows.forEach(function (row) {
      row.addEventListener('click', function () {
        var name = row.getAttribute('data-name');
        var index = picked.indexOf(name);
        if (index === -1) picked.push(name);
        else picked.splice(index, 1);
        var box = row.querySelector('.checkbox');
        if (box) box.classList.toggle('on', picked.indexOf(name) !== -1);
      });
    });
    document.getElementById('sheetCancel').addEventListener('click', closeSheet);
    document.getElementById('sheetClear').addEventListener('click', function () {
      picked = [];
      rows.forEach(function (row) {
        var box = row.querySelector('.checkbox');
        if (box) box.classList.remove('on');
      });
    });
    document.getElementById('sheetApply').addEventListener('click', function () {
      state.selectedPlatforms = picked.slice();
      state.limit = 60;
      saveFilters();
      closeSheet();
      shell();
      renderList();
    });
  }

  var dialogNodes = null;

  function closeDialog() {
    if (!dialogNodes) return;
    var nodes = dialogNodes;
    dialogNodes = null;
    nodes.scrim.classList.remove('show');
    nodes.dialog.classList.remove('show');
    setTimeout(function () {
      if (nodes.scrim.parentNode) nodes.scrim.parentNode.removeChild(nodes.scrim);
      if (nodes.dialog.parentNode) nodes.dialog.parentNode.removeChild(nodes.dialog);
    }, 200);
  }

  function openMoreDialog() {
    closeDialog();
    var scrim = document.createElement('div');
    scrim.className = 'scrim';
    var dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.innerHTML =
      '<div class="dialog-title">更多</div>' +
      '<button class="tool" id="dialogUpdate" type="button">检查更新</button>' +
      '<button class="tool" id="dialogGithub" type="button">GitHub 仓库 ↗</button>' +
      '<button class="btn-text" id="dialogCancel" type="button">取消</button>';
    document.body.appendChild(scrim);
    document.body.appendChild(dialog);
    scrim.addEventListener('click', closeDialog);
    dialogNodes = { scrim: scrim, dialog: dialog };
    requestAnimationFrame(function () {
      scrim.classList.add('show');
      dialog.classList.add('show');
    });
    document.getElementById('dialogUpdate').addEventListener('click', function () {
      closeDialog();
      checkUpdate();
    });
    document.getElementById('dialogGithub').addEventListener('click', function () {
      closeDialog();
      if (window.Android && window.Android.openUrl) window.Android.openUrl(GITHUB_URL);
      else window.open(GITHUB_URL, '_blank');
    });
    document.getElementById('dialogCancel').addEventListener('click', closeDialog);
  }

  function versionParts(value) {
    return String(value || '').replace(/^v/i, '').split('.').map(function (part) {
      var number = parseInt(part, 10);
      return Number.isFinite(number) ? number : 0;
    });
  }

  function isNewerVersion(latest, current) {
    var a = versionParts(latest);
    var b = versionParts(current);
    var length = Math.max(a.length, b.length);
    for (var index = 0; index < length; index += 1) {
      var left = a[index] || 0;
      var right = b[index] || 0;
      if (left > right) return true;
      if (left < right) return false;
    }
    return false;
  }

  var updateChecking = false;

  function showUpdateSheet(tag, name, body, url) {
    var notes = String(body || '').replace(/[#*`>]/g, '').trim();
    if (notes.length > 500) notes = notes.slice(0, 500) + '…';
    showSheet(
      '<div class="sheet-handle"></div>' +
      '<div class="sheet-title">发现新版本 ' + esc(tag) + '</div>' +
      '<div class="update-name">' + esc(name) + '</div>' +
      '<div class="update-notes">' + esc(notes) + '</div>' +
      '<div class="sheet-actions">' +
        '<button class="btn-text" id="updateLater" type="button">稍后</button>' +
        '<button class="btn-filled" id="updateGo" type="button">前往下载</button>' +
      '</div>'
    );
    document.getElementById('updateLater').addEventListener('click', closeSheet);
    document.getElementById('updateGo').addEventListener('click', function () {
      closeSheet();
      if (window.Android && window.Android.openUrl) window.Android.openUrl(url);
      else window.open(url, '_blank');
    });
  }

  function checkUpdate() {
    if (updateChecking) return;
    updateChecking = true;
    var button = document.getElementById('checkUpdateBtn');
    if (button) { button.disabled = true; button.textContent = '检查中…'; }
    fetch('https://api.github.com/repos/NanXianBin/Metacritic_GameRating/releases/latest')
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        var latest = data.tag_name || '';
        if (isNewerVersion(latest, APP_VERSION)) {
          showUpdateSheet(
            latest,
            data.name || latest,
            data.body || '',
            data.html_url || GITHUB_URL + '/releases',
          );
        } else {
          toast('已是最新版本 v' + APP_VERSION);
        }
      })
      .catch(function () {
        toast('无法连接 GitHub，已打开 Releases 页面');
        if (window.Android && window.Android.openUrl) window.Android.openUrl(GITHUB_URL + '/releases');
        else window.open(GITHUB_URL + '/releases', '_blank');
      })
      .finally(function () {
        updateChecking = false;
        if (button) { button.disabled = false; button.textContent = '检查更新'; }
      });
  }

  function shell() {
    var translated = 0;
    allGames().forEach(function (game) { if (tr(game.title)) translated += 1; });
    app.innerHTML =
      '<header class="head">' +
        '<div class="head-top">' +
          '<div class="brand"><div class="logo">M</div>' +
            '<div><h1>Metacritic 游戏评分</h1><p class="sub">开发者：南仙 · 数据来自 Metacritic</p></div>' +
          '</div>' +
          '<div class="head-actions">' +
            '<button class="icon-btn" id="themeBtn" aria-label="切换主题">' + (state.theme === 'neon' ? '☀' : '✦') + '</button>' +
            '<button class="icon-btn" id="moreBtn" aria-label="更多">⋯</button>' +
          '</div>' +
        '</div>' +
        '<div class="tools">' +
          '<button class="tool" id="incBtn"' + (state.busy ? ' disabled' : '') + '>实时抓取</button>' +
          '<button class="tool" id="fullBtn"' + (state.busy ? ' disabled' : '') + '>全量重建</button>' +
          '<button class="tool" id="bulkBtn"' + (state.busy || translating ? ' disabled' : '') + '>批量翻译</button>' +
        '</div>' +
        (state.busy ? '<div class="progress" id="progress"></div>' : '') +
        (state.bulk ? '<div class="progress" id="bulkbar"></div>' : '') +
      '</header>' +
      '<div class="filters">' +
        '<div class="search"><input id="q" type="search" placeholder="搜索游戏（中英文均可）" value="' + esc(state.q) + '" /><span class="mag">⌕</span></div>' +
        '<div class="selects">' +
          '<button class="field" id="yearBtn" type="button"><span class="fl">年份</span><span class="fv">' + esc(state.from) + ' – ' + esc(state.to) + '</span></button>' +
          '<button class="field" id="platformBtn" type="button"><span class="fl">平台</span><span class="fv">' + (state.selectedPlatforms.length ? '已选 ' + state.selectedPlatforms.length + ' 个' : '全部平台') + '</span></button>' +
          '<button class="field" id="sortBtn" type="button"><span class="fl">排序</span><span class="fv">' + sortLabel(state.sort) + '</span></button>' +
        '</div>' +
        '<label class="switch-row"><span>只显示 Metacritic Must Play</span><span class="switch"><input type="checkbox" id="mustPlayToggle"' + (state.mustPlay ? ' checked' : '') + ' /><i></i></span></label>' +
      '</div>' +
      '<div class="stats" id="stats"></div>' +
      '<div class="list" id="list"></div>' +
      '<div id="more"></div>' +
      '<div class="foot">数据来自 Metacritic · 翻译由 Bing 提供 · 共 ' + allGames().length.toLocaleString('zh-CN') + ' 款（已译 ' + translated.toLocaleString('zh-CN') + '）<br /><b>开发者：南仙</b></div>';

    document.getElementById('themeBtn').addEventListener('click', function () {
      state.theme = state.theme === 'neon' ? 'light' : 'neon';
      localStorage.setItem('mcg.theme', state.theme);
      applyTheme();
      shell();
      renderList();
    });
    document.getElementById('incBtn').addEventListener('click', function () { startCrawl(false); });
    document.getElementById('fullBtn').addEventListener('click', function () { startCrawl(true); });
    document.getElementById('bulkBtn').addEventListener('click', function () {
      var rows = filtered();
      var pending = [];
      rows.forEach(function (game) { if (!translations[game.title]) pending.push(game.title); });
      translateTitles(pending.slice(0, 3000));
    });

    var search = document.getElementById('q');
    var timer = null;
    search.addEventListener('input', function () {
      clearTimeout(timer);
      var value = search.value;
      timer = setTimeout(function () { state.q = value; state.limit = 60; saveFilters(); renderList(); }, 220);
    });
    document.getElementById('yearBtn').addEventListener('click', openYearSheet);
    document.getElementById('platformBtn').addEventListener('click', openPlatformSheet);
    document.getElementById('sortBtn').addEventListener('click', openSortSheet);
    document.getElementById('moreBtn').addEventListener('click', openMoreDialog);
    document.getElementById('mustPlayToggle').addEventListener('change', function (event) {
      state.mustPlay = event.target.checked;
      state.limit = 60;
      saveFilters();
      renderList();
    });
    if (state.busy && state.progress) updateProgressBar();
    if (state.bulk) updateBulkBar();
  }

  var currentRows = [];
  function renderList() {
    var list = document.getElementById('list');
    if (!list) return;
    currentRows = filtered();
    var stats = document.getElementById('stats');
    var more = document.getElementById('more');
    var shown = currentRows.slice(0, state.limit);

    if (!currentRows.length) {
      list.innerHTML = '<div class="empty">没有匹配的游戏</div>';
      stats.textContent = '';
      more.innerHTML = '';
      return;
    }

    list.innerHTML = shown.map(function (game, index) {
      var primary = tr(game.title) || game.title;
      var secondary = tr(game.title) ? game.title : '';
      var line2 = [fmtDate(game.releaseDate) || (game.year ? String(game.year) : ''), game.platform || '']
        .filter(Boolean).join(' · ');
      var cover = game.cover
        ? '<img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="' + esc(game.cover) + '" alt="" onerror="this.remove()" />'
        : '▦';
      return '<div class="row" data-index="' + index + '">' +
        '<div class="thumb">' + cover + '</div>' +
        '<div class="mid"><div class="name">' + esc(primary) + '</div>' +
        (secondary ? '<div class="en">' + esc(secondary) + '</div>' : '') +
        '<div class="line2">' + esc(line2) + '</div></div>' +
        '<div class="sc ' + tone(game.score) + '">' + (game.score == null ? '—' : game.score) + '</div>' +
        '</div>';
    }).join('');

    stats.textContent = '共 ' + allGames().length.toLocaleString('zh-CN') + ' 款 · 当前筛选 ' + currentRows.length.toLocaleString('zh-CN') + ' 款';
    more.innerHTML = currentRows.length > state.limit
      ? '<button class="loadmore" id="loadMore">加载更多（剩余 ' + (currentRows.length - state.limit).toLocaleString('zh-CN') + '）</button>'
      : '';
    var loadMore = document.getElementById('loadMore');
    if (loadMore) {
      loadMore.addEventListener('click', function () { state.limit += 60; renderList(); });
    }
    list.querySelectorAll('.row').forEach(function (node) {
      node.addEventListener('click', function () {
        var game = shown[Number(node.getAttribute('data-index'))];
        if (game) openDetail(game);
      });
    });
  }

  // ------------------------------------------------------------------
  // detail
  // ------------------------------------------------------------------
  function loadDetail(game, force) {
    state.detail = { game: game, extra: null, loading: true, error: null, distribution: {}, summary: null, summaryBusy: false, summaryError: null };
    render();
    if (force) delete details[game.slug];
    var cached = force ? null : details[game.slug];
    if (cached && Date.now() - (cached.fetchedAt || 0) < 7 * 24 * 3600 * 1000) {
      state.detail.extra = cached;
      state.detail.loading = false;
      render();
      autoLeadDistribution();
      return;
    }
    if (!hasAndroid) { state.detail.loading = false; render(); return; }
    MCScraper.fetchPage('https://www.metacritic.com/game/' + game.slug + '/').then(function (html) {
      if (!state.detail) return;
      if (!html) throw new Error('页面为空');
      var detail = MCScraper.parseGameDetail(html, game.slug);
      details[game.slug] = detail;
      saveSoon();
      state.detail.extra = detail;
      state.detail.loading = false;
      render();
      autoLeadDistribution();
    }).catch(function (error) {
      if (!state.detail) return;
      state.detail.loading = false;
      state.detail.error = error && error.message ? error.message : '详情加载失败';
      render();
    });
  }

  function openDetail(game) {
    loadDetail(game, false);
    window.scrollTo(0, 0);
  }

  function refreshDetail() {
    if (!state.detail || state.detail.loading) return;
    loadDetail(state.detail.game, true);
    window.scrollTo(0, 0);
  }

  function autoLeadDistribution() {
    var detail = state.detail;
    if (!detail || !detail.extra || detail.distributionsLoading) return;
    detail.distributionsLoading = true;
    var platforms = (detail.extra.platforms || []).slice();
    (async function () {
      for (var index = 0; index < platforms.length; index += 1) {
        if (!state.detail) break;
        var platform = platforms[index];
        if (!platform.slug || !platform.reviews) continue;
        var cached = state.detail.distribution[platform.slug];
        if (cached && cached.dist) continue;
        await loadDistribution(platform);
      }
      if (state.detail) state.detail.distributionsLoading = false;
    })();
  }

  function loadDistribution(platform) {
    var detail = state.detail;
    if (!detail || !platform || !platform.slug) return Promise.resolve();
    if (detail.distribution[platform.slug] && (detail.distribution[platform.slug].dist || detail.distribution[platform.slug].loading)) return Promise.resolve();
    detail.distribution[platform.slug] = { loading: true };
    render();
    return MCScraper.fetchCriticReviewScores(detail.game.slug, platform.slug).then(function (scores) {
      if (!state.detail) return;
      state.detail.distribution[platform.slug] = { dist: MCScraper.buildDistribution(scores) };
      render();
    }).catch(function () {
      if (!state.detail) return;
      state.detail.distribution[platform.slug] = { error: true };
      render();
    });
  }

  function distHtml(dist) {
    if (!dist) return '';
    var classes = ['r', 'm', 'g', 'gold'];
    var bar = dist.buckets.map(function (bucket, index) {
      return '<i class="seg ' + classes[index] + '" style="width:' + bucket.percent + '%"></i>';
    }).join('');
    var legend = dist.buckets.map(function (bucket, index) {
      return '<span><em class="dot ' + classes[index] + '"></em>' + esc(bucket.label) + ' ' + bucket.percent + '%（' + bucket.count + '）</span>';
    }).join('');
    return '<div class="dist"><div class="dbar">' + bar + '</div><div class="dlegend">' + legend + '</div></div>';
  }

  function translateSummary() {
    var detail = state.detail;
    if (!detail) return;
    var description = (detail.extra && detail.extra.description) || detail.game.summary || '';
    if (!description || detail.summaryBusy) return;
    detail.summaryBusy = true;
    detail.summaryError = null;
    render();
    nativeTranslate(description).then(function (zh) {
      if (!state.detail) return;
      state.detail.summaryBusy = false;
      if (zh) state.detail.summary = zh;
      else state.detail.summaryError = '翻译失败，请检查网络';
      render();
    });
  }

  function renderDetail() {
    var detail = state.detail;
    if (!detail) return;
    var game = detail.game;
    var extra = detail.extra || {};
    var primary = tr(game.title) || game.title;
    var secondary = tr(game.title) ? game.title : '';
    var description = (extra.description || game.summary || '').trim();
    var platforms = (extra.platforms && extra.platforms.length ? extra.platforms : (game.platforms || []).map(function (name) {
      return { name: name, slug: null, score: null, reviews: null, lead: false };
    }));
    var metaChips = [];
    if (extra.releaseDate || game.releaseDate) metaChips.push('<span class="chip">发行 ' + esc(fmtDate(extra.releaseDate || game.releaseDate)) + '</span>');
    if (extra.rating) metaChips.push('<span class="chip">' + esc(extra.rating) + '</span>');
    if (extra.genres && extra.genres.length) metaChips.push('<span class="chip">' + esc(extra.genres.join(' / ')) + '</span>');
    if (extra.publisher && extra.publisher.length) metaChips.push('<span class="chip">发行商 ' + esc(extra.publisher.join('、')) + '</span>');

    var platformHtml = platforms.map(function (platform, index) {
      var dist = detail.distribution[platform.slug];
      var distBlock = '';
      if (dist && dist.dist) distBlock = distHtml(dist.dist);
      else if (dist && dist.error) distBlock = '<div class="dist-tip">分布加载失败</div>';
      else distBlock = '<div class="dist-tip">评分分布统计中…</div>';
      return '<div class="platblock">' +
        '<div class="plat">' +
          '<span class="nm">' + esc(platform.name) + (platform.lead ? ' <em class="lead">主平台</em>' : '') + '</span>' +
          '<span class="sc ' + tone(platform.score) + '">' + (platform.score == null ? '—' : platform.score) + '</span>' +
          '<span class="rv">' + (platform.reviews == null ? '' : platform.reviews + ' 媒体') + '</span>' +
        '</div>' +
        distBlock +
        '</div>';
    }).join('');

    app.innerHTML =
      '<div class="detail">' +
        '<button class="d-back" id="backBtn">← 返回列表</button>' +
        '<button class="d-back d-refresh" id="refreshDetailBtn"' + (detail.loading ? ' disabled' : '') + '>' + (detail.loading ? '刷新中…' : '刷新数据') + '</button>' +
        '<div class="hero">' +
          '<div class="poster">' + (game.cover ? '<img src="' + esc(game.cover) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()" />' : '▦') + '</div>' +
          '<div class="info">' +
            '<h2>' + esc(primary) + '</h2>' +
            (secondary ? '<p class="en">' + esc(secondary) + '</p>' : '') +
            (((extra.badge || game.badge) === 'must-play') ? '<div class="mustplay-badge">★ Metacritic Must Play</div>' : '') +
            (metaChips.length ? '<div class="meta">' + metaChips.join('') + '</div>' : '') +
            '<div class="scores">' +
              '<div class="scorebox"><div class="k">Metascore</div><div class="v ' + tone(extra.metascore != null ? extra.metascore : game.score) + '">' + (extra.metascore != null ? extra.metascore : game.score == null ? '—' : game.score) + '</div></div>' +
              '<div class="scorebox"><div class="k">用户评分</div><div class="v ' + userTone(extra.userScore != null ? extra.userScore : game.userScore) + '">' + (extra.userScore != null ? extra.userScore : game.userScore == null ? '—' : game.userScore) + '</div></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        (detail.loading ? '<div class="card"><div class="dist-tip">正在加载详情…</div></div>' : '') +
        (detail.error ? '<div class="card"><div class="dist-tip">' + esc(detail.error) + '</div></div>' : '') +
        (extra.developer && extra.developer.length ? '<div class="card"><h3>开发商</h3><div class="desc">' + esc(extra.developer.join('、')) + '</div></div>' : '') +
        '<div class="card"><h3>游戏简介</h3>' +
          (description
            ? '<div class="desc">' + esc(description) + '</div>' +
              '<button class="trans-btn" id="transBtn"' + (detail.summaryBusy ? ' disabled' : '') + '>' + (detail.summaryBusy ? '翻译中…' : detail.summary ? '重新翻译（Bing）' : '翻译简介（Bing）') + '</button>' +
              (detail.summary ? '<div class="trans-result"><div class="tag">Bing 翻译</div><div class="txt">' + esc(detail.summary) + '</div></div>' : '') +
              (detail.summaryError ? '<div class="trans-error">' + esc(detail.summaryError) + '</div>' : '')
            : '<div class="desc">暂无简介</div>') +
        '</div>' +
        '<div class="card"><h3>上架平台 <em class="cnt">' + platforms.length + ' 个</em></h3>' +
          (platformHtml || '<div class="desc">暂无平台信息</div>') +
        '</div>' +
        '<a class="link-mc" href="' + esc(game.url || ('https://www.metacritic.com/game/' + game.slug + '/')) + '" target="_blank" rel="noreferrer noopener">在 Metacritic 查看 ↗</a>' +
        '<div class="foot">数据来自 Metacritic · 翻译由 Bing 提供<br /><b>开发者：南仙</b></div>' +
      '</div>';

    document.getElementById('backBtn').addEventListener('click', function () {
      state.detail = null;
      render();
    });
    document.getElementById('refreshDetailBtn').addEventListener('click', refreshDetail);
    var transBtn = document.getElementById('transBtn');
    if (transBtn) transBtn.addEventListener('click', translateSummary);
    var link = app.querySelector('.link-mc');
    if (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        if (window.Android && window.Android.openUrl) window.Android.openUrl(link.getAttribute('href'));
        else window.open(link.getAttribute('href'), '_blank');
      });
    }
  }

  // ------------------------------------------------------------------
  // boot
  // ------------------------------------------------------------------
  function render() {
    if (state.detail) { renderDetail(); return; }
    shell();
    renderList();
  }

  window.__appBack = function () {
    if (dialogNodes) { closeDialog(); return true; }
    if (sheetNodes) { closeSheet(); return true; }
    if (state.detail) { state.detail = null; render(); return true; }
    return false;
  };

  applyTheme();
  rebuildFacets();
  restoreFilters();
  render();

  window.__openGame = function (index) {
    var game = allGames()[index];
    if (game) openDetail(game);
  };

  window.__debugState = function () {
    return {
      games: allGames().length,
      translated: Object.keys(translations).length,
      busy: state.busy,
      progress: state.progress,
      bulk: state.bulk,
      years: Object.keys(yearsInfo).length,
      detail: state.detail ? { loading: state.detail.loading, hasExtra: !!state.detail.extra } : null,
    };
  };
})();
