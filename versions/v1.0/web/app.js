(function () {
  'use strict';

  var GAMES = Array.isArray(window.__GAMES__) ? window.__GAMES__ : [];
  var app = document.getElementById('app');

  var state = {
    q: '',
    from: null,
    to: null,
    platform: '',
    sort: 'score',
    limit: 60,
    detail: null,
    theme: localStorage.getItem('mcg.theme') || 'light',
  };

  var years = [];
  var platforms = [];
  (function buildFacets() {
    var yearSet = {};
    var platformSet = {};
    for (var i = 0; i < GAMES.length; i++) {
      var game = GAMES[i];
      if (game.y) yearSet[game.y] = true;
      var list = game.pl && game.pl.length ? game.pl : game.p ? [game.p] : [];
      for (var j = 0; j < list.length; j++) platformSet[list[j]] = true;
    }
    years = Object.keys(yearSet).map(Number).sort(function (a, b) { return b - a; });
    platforms = Object.keys(platformSet).sort(function (a, b) { return a.localeCompare(b, 'en'); });
    if (years.length) {
      state.from = years[years.length - 1];
      state.to = years[0];
    }
  })();

  var currentRows = [];

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
    return /^\d{4}-\d{2}-\d{2}/.test(value || '') ? value.slice(0, 10) : '';
  }

  function applyTheme() {
    if (state.theme === 'neon') document.body.classList.add('neon');
    else document.body.classList.remove('neon');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', state.theme === 'neon' ? '#0b0618' : '#f4f5f7');
  }

  function filtered() {
    var needle = state.q.trim().toLowerCase();
    var rows = [];
    for (var i = 0; i < GAMES.length; i++) {
      var game = GAMES[i];
      if (game.y && (game.y < state.from || game.y > state.to)) continue;
      if (state.platform) {
        var list = game.pl && game.pl.length ? game.pl : game.p ? [game.p] : [];
        if (list.indexOf(state.platform) === -1) continue;
      }
      if (needle) {
        var hay = (game.t + ' ' + (game.c || '') + ' ' + (game.sm || '')).toLowerCase();
        if (hay.indexOf(needle) === -1) continue;
      }
      rows.push(game);
    }
    var sort = state.sort;
    rows.sort(function (a, b) {
      if (sort === 'score_asc') return (a.s == null ? -1 : a.s) - (b.s == null ? -1 : b.s);
      if (sort === 'year') return (b.y || 0) - (a.y || 0) || (b.s || 0) - (a.s || 0);
      if (sort === 'year_asc') return (a.y || 0) - (b.y || 0) || (b.s || 0) - (a.s || 0);
      if (sort === 'name') return (a.c || a.t).localeCompare(b.c || b.t, 'zh-CN');
      return (b.s == null ? -1 : b.s) - (a.s == null ? -1 : a.s);
    });
    return rows;
  }

  function yearOptions(selected) {
    return years
      .map(function (year) {
        return '<option value="' + year + '"' + (year === selected ? ' selected' : '') + '>' + year + '</option>';
      })
      .join('');
  }

  function platformOptions() {
    return (
      '<option value="">全部平台</option>' +
      platforms
        .map(function (name) {
          return '<option value="' + esc(name) + '"' + (name === state.platform ? ' selected' : '') + '>' + esc(name) + '</option>';
        })
        .join('')
    );
  }

  function sortOptions() {
    var options = [
      ['score', '评分最高'],
      ['score_asc', '评分最低'],
      ['year', '发行最新'],
      ['year_asc', '发行最早'],
      ['name', '名称排序'],
    ];
    return options
      .map(function (pair) {
        return '<option value="' + pair[0] + '"' + (pair[0] === state.sort ? ' selected' : '') + '>' + pair[1] + '</option>';
      })
      .join('');
  }

  function shell() {
    app.innerHTML =
      '<header class="head">' +
        '<div class="head-top">' +
          '<div class="brand">' +
            '<div class="logo">M</div>' +
            '<div><h1>Metacritic 游戏评分</h1><p class="sub">开发者：南仙 · 数据来自 Metacritic</p></div>' +
          '</div>' +
          '<button class="icon-btn" id="themeBtn" aria-label="切换主题">' + (state.theme === 'neon' ? '☀' : '✦') + '</button>' +
        '</div>' +
      '</header>' +
      '<div class="filters">' +
        '<div class="search"><input id="q" type="search" placeholder="搜索游戏（中英文均可）" value="' + esc(state.q) + '" /><span class="mag">⌕</span></div>' +
        '<div class="selects">' +
          '<select id="from" aria-label="起始年份">' + yearOptions(state.from) + '</select>' +
          '<select id="to" aria-label="结束年份">' + yearOptions(state.to) + '</select>' +
          '<select id="platform" aria-label="平台">' + platformOptions() + '</select>' +
          '<select id="sort" aria-label="排序">' + sortOptions() + '</select>' +
        '</div>' +
      '</div>' +
      '<div class="stats" id="stats"></div>' +
      '<div class="list" id="list"></div>' +
      '<div id="more"></div>' +
      '<div class="foot">数据实时抓取自 Metacritic · 评分版权归 Metacritic 所有<br /><b>开发者：南仙</b></div>';

    document.getElementById('themeBtn').addEventListener('click', function () {
      state.theme = state.theme === 'neon' ? 'light' : 'neon';
      localStorage.setItem('mcg.theme', state.theme);
      applyTheme();
      shell();
      renderList();
    });

    var search = document.getElementById('q');
    var timer = null;
    search.addEventListener('input', function () {
      clearTimeout(timer);
      var value = search.value;
      timer = setTimeout(function () {
        state.q = value;
        state.limit = 60;
        renderList();
      }, 220);
    });

    document.getElementById('from').addEventListener('change', function (event) {
      state.from = Number(event.target.value);
      if (state.to < state.from) state.to = state.from;
      state.limit = 60;
      shell();
      renderList();
    });
    document.getElementById('to').addEventListener('change', function (event) {
      state.to = Number(event.target.value);
      if (state.from > state.to) state.from = state.to;
      state.limit = 60;
      shell();
      renderList();
    });
    document.getElementById('platform').addEventListener('change', function (event) {
      state.platform = event.target.value;
      state.limit = 60;
      renderList();
    });
    document.getElementById('sort').addEventListener('change', function (event) {
      state.sort = event.target.value;
      state.limit = 60;
      renderList();
    });
  }

  function renderList() {
    if (!app.querySelector('#list')) return;
    currentRows = filtered();
    var list = document.getElementById('list');
    var stats = document.getElementById('stats');
    var more = document.getElementById('more');
    var shown = currentRows.slice(0, state.limit);

    if (!currentRows.length) {
      list.innerHTML = '<div class="empty">没有匹配的游戏</div>';
      stats.textContent = '';
      more.innerHTML = '';
      return;
    }

    var html = shown
      .map(function (game, index) {
        var primary = game.c || game.t;
        var secondary = game.c ? game.t : '';
        var line2 = [fmtDate(game.d) || (game.y ? String(game.y) : ''), game.p || '']
          .filter(Boolean)
          .join(' · ');
        var cover = game.cv
          ? '<img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="' + esc(game.cv) + '" alt="" onerror="this.remove()" />'
          : '▦';
        return (
          '<div class="row" data-index="' + index + '">' +
            '<div class="thumb">' + cover + '</div>' +
            '<div class="mid">' +
              '<div class="name">' + esc(primary) + '</div>' +
              (secondary ? '<div class="en">' + esc(secondary) + '</div>' : '') +
              '<div class="line2">' + esc(line2) + '</div>' +
            '</div>' +
            '<div class="sc ' + tone(game.s) + '">' + (game.s == null ? '—' : game.s) + '</div>' +
          '</div>'
        );
      })
      .join('');

    list.innerHTML = html;
    stats.textContent = '共 ' + GAMES.length.toLocaleString('zh-CN') + ' 款 · 当前筛选 ' + currentRows.length.toLocaleString('zh-CN') + ' 款';

    more.innerHTML =
      currentRows.length > state.limit
        ? '<button class="loadmore" id="loadMore">加载更多（剩余 ' + (currentRows.length - state.limit).toLocaleString('zh-CN') + '）</button>'
        : '';

    var loadMore = document.getElementById('loadMore');
    if (loadMore) {
      loadMore.addEventListener('click', function () {
        state.limit += 60;
        renderList();
        window.scrollTo({ top: window.scrollY, behavior: 'instant' });
      });
    }

    list.querySelectorAll('.row').forEach(function (node) {
      node.addEventListener('click', function () {
        var index = Number(node.getAttribute('data-index'));
        var game = shown[index];
        if (game) openDetail(game);
      });
    });
  }

  // ------------------------------------------------------------------
  // detail
  // ------------------------------------------------------------------

  function openDetail(game) {
    state.detail = { game: game, extra: null, translation: null, translating: false, error: null };
    renderDetail();
    window.scrollTo(0, 0);
    if (window.Android && typeof window.Android.detail === 'function') {
      window.Android.detail(game.uu, 'd1');
    }
  }

  window.__nativeDetail = function (id, payload) {
    if (!state.detail || id !== 'd1') return;
    state.detail.extra = payload || null;
    renderDetail();
  };

  window.__nativeTranslate = function (id, text) {
    if (!state.detail) return;
    state.detail.translating = false;
    if (text) {
      state.detail.translation = text;
      state.detail.error = null;
    } else {
      state.detail.error = '翻译失败，请检查网络后重试';
    }
    renderDetail();
  };

  window.__appBack = function () {
    if (state.detail) {
      state.detail = null;
      shell();
      renderList();
      return true;
    }
    return false;
  };

  function scoreBox(label, value, kind) {
    var text = value == null ? '—' : value;
    var cls = value == null ? '' : kind === 'user' ? userTone(Number(value)) : tone(Number(value));
    return (
      '<div class="scorebox"><div class="k">' + esc(label) + '</div>' +
      '<div class="v ' + cls + '">' + esc(text) + '</div></div>'
    );
  }

  function renderDetail() {
    var detail = state.detail;
    if (!detail) return;
    var game = detail.game;
    var extra = detail.extra || {};
    var primary = game.c || game.t;
    var secondary = game.c ? game.t : '';
    var description = (extra.description || game.sm || '').trim();
    var developer = extra.developer || '';
    var publisher = extra.publisher || '';
    var genres = extra.genres || '';
    var releaseDate = extra.releaseDate || fmtDate(game.d);
    var platformList = (extra.platforms ? String(extra.platforms).split('、') : game.pl ? game.pl : game.p ? [game.p] : []).filter(Boolean);
    var url = game.uu ? 'https://www.metacritic.com/game/' + game.uu + '/' : 'https://www.metacritic.com/';

    var metaChips = [];
    if (releaseDate) metaChips.push('<span class="chip">发行 ' + esc(releaseDate) + '</span>');
    if (game.p) metaChips.push('<span class="chip">' + esc(game.p) + '</span>');
    if (genres) metaChips.push('<span class="chip">' + esc(genres) + '</span>');

    var platformsHtml = platformList.length
      ? platformList
          .map(function (name) {
            return '<div class="plat"><span class="nm">' + esc(name) + '</span></div>';
          })
          .join('')
      : '<div class="plat"><span class="nm">暂无平台信息</span></div>';

    var translation = detail.translation;
    var translateLabel = detail.translating ? '翻译中…' : translation ? '重新翻译（Bing）' : '翻译简介（Bing）';

    app.innerHTML =
      '<div class="detail">' +
        '<button class="d-back" id="backBtn">← 返回列表</button>' +
        '<div class="hero">' +
          '<div class="poster">' +
            (game.cv
              ? '<img src="' + esc(game.cv) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()" />'
              : '▦') +
          '</div>' +
          '<div class="info">' +
            '<h2>' + esc(primary) + '</h2>' +
            (secondary ? '<p class="en">' + esc(secondary) + '</p>' : '') +
            (metaChips.length ? '<div class="meta">' + metaChips.join('') + '</div>' : '') +
            '<div class="scores">' +
              scoreBox('Metascore', game.s, 'critic') +
              scoreBox('用户评分', game.u, 'user') +
            '</div>' +
          '</div>' +
        '</div>' +
        (developer
          ? '<div class="card"><h3>开发商</h3><div class="desc">' + esc(developer) + '</div></div>'
          : '') +
        '<div class="card">' +
          '<h3>游戏简介</h3>' +
          (description
            ? '<div class="desc">' + esc(description) + '</div>' +
              '<button class="trans-btn" id="transBtn"' + (detail.translating ? ' disabled' : '') + '>' + esc(translateLabel) + '</button>' +
              (translation
                ? '<div class="trans-result"><div class="tag">Bing 翻译</div><div class="txt">' + esc(translation) + '</div></div>'
                : '') +
              (detail.error ? '<div class="trans-error">' + esc(detail.error) + '</div>' : '')
            : '<div class="desc">暂无简介</div>') +
        '</div>' +
        '<div class="card"><h3>上架平台</h3><div class="plats">' + platformsHtml + '</div>' +
          (publisher ? '<div class="trans-result" style="margin-top:10px"><div class="tag">发行商</div><div class="txt">' + esc(publisher) + '</div></div>' : '') +
        '</div>' +
        '<a class="link-mc" href="' + esc(url) + '" target="_blank" rel="noreferrer noopener">在 Metacritic 查看 ↗</a>' +
        '<div class="foot">数据来自 Metacritic · 翻译由 Bing 提供<br /><b>开发者：南仙</b></div>' +
      '</div>';

    document.getElementById('backBtn').addEventListener('click', function () {
      state.detail = null;
      shell();
      renderList();
    });

    var transBtn = document.getElementById('transBtn');
    if (transBtn) {
      transBtn.addEventListener('click', function () {
        if (detail.translating) return;
        if (!window.Android || typeof window.Android.translate !== 'function') {
          detail.error = '翻译功能需在 App 内使用';
          renderDetail();
          return;
        }
        detail.translating = true;
        detail.error = null;
        renderDetail();
        window.Android.translate(description, 'text', 't1');
      });
    }

    var link = document.querySelector('.link-mc');
    if (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        if (window.Android && typeof window.Android.openUrl === 'function') {
          window.Android.openUrl(link.getAttribute('href'));
        } else {
          window.open(link.getAttribute('href'), '_blank');
        }
      });
    }
  }

  // ------------------------------------------------------------------
  // boot
  // ------------------------------------------------------------------

  applyTheme();
  if (!GAMES.length) {
    app.innerHTML = '<div class="empty">数据加载失败：assets/www/data.js 为空</div>';
  } else {
    shell();
    renderList();
  }

  // Deep-link / automation hook: window.__openGame(index)
  window.__openGame = function (index) {
    var game = GAMES[index];
    if (game) openDetail(game);
  };
})();
