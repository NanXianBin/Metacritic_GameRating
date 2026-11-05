/* Ported from dsh-metacritic-games/scraper.js (browser build, exports stripped). */
/**
 * Metacritic scraper: fetches the per-year browse pages and parses the game
 * cards out of the server-rendered Nuxt HTML.
 *
 * A "year page" is https://www.metacritic.com/browse/game/all/all/<year>/ and
 * paginates with ?page=N (24 cards per page, ordered by metascore).
 */

const BASE = 'https://www.metacritic.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const FIRST_YEAR = 1995;
/** Automatically follows the calendar year, so new releases need no code change. */
const LAST_YEAR = Math.max(2026, new Date().getFullYear());
/** Metacritic has no game scores before 1995, so the panel starts there. */
const DATA_FIRST_YEAR = 1995;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decodeEntities(text) {
  return String(text)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' '));
}

const PLATFORM_NAMES = {
  pc: 'PC',
  ps5: 'PlayStation 5',
  ps4: 'PlayStation 4',
  ps3: 'PlayStation 3',
  ps2: 'PlayStation 2',
  ps1: 'PlayStation',
  psvita: 'PlayStation Vita',
  psp: 'PlayStation Portable',
  'xbox-series-x': 'Xbox Series X/S',
  xboxone: 'Xbox One',
  'xbox-360': 'Xbox 360',
  xbox: 'Xbox',
  'nintendo-switch-2': 'Switch 2',
  'nintendo-switch': 'Switch',
  'wii-u': 'Wii U',
  wii: 'Wii',
  'gamecube': 'GameCube',
  n64: 'Nintendo 64',
  snes: 'SNES',
  nes: 'NES',
  '3ds': 'Nintendo 3DS',
  ds: 'Nintendo DS',
  gba: 'Game Boy Advance',
  'game-boy': 'Game Boy',
  'game-boy-color': 'Game Boy Color',
  ios: 'iOS',
  android: 'Android',
  stadia: 'Stadia',
  dreamcast: 'Dreamcast',
  'sega-saturn': 'Saturn',
  'sega-genesis': 'Genesis',
  'meta-quest-2': 'Meta Quest 2',
  vr: 'VR',
};

function platformName(slug, title) {
  if (title) return decodeEntities(title);
  return PLATFORM_NAMES[slug] ?? slug.replace(/-/g, ' ');
}

/**
 * Fetch one HTML page with retries, polite headers and a hard timeout.
 * @param url - absolute URL.
 * @param signal - optional external abort signal.
 */
async function fetchPage(url, signal) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const timeout = AbortSignal.timeout(25000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetch(url, {
        signal: combined,
        redirect: 'follow',
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          referer: `${BASE}/browse/game/`,
          'cache-control': 'no-cache',
        },
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      if (attempt < 2) await sleep(600 * (attempt + 1) + Math.random() * 400);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Extract the last pagination number from a browse page.
 * @param html - page HTML.
 * @param rowCount - number of parsed cards, used when no pager is present.
 */
function parseLastPage(html, rowCount) {
  const start = html.indexOf('data-testid="navigation-pagination"');
  if (start < 0) return rowCount > 0 ? 1 : 0;
  const end = html.indexOf('</nav>', start);
  const block = html.slice(start, end < 0 ? start + 20000 : end);
  let max = 0;
  for (const match of block.matchAll(/>\s*(\d+)\s*<\/span>/g)) {
    const value = Number(match[1]);
    if (value > max && value < 5000) max = value;
  }
  return max || (rowCount > 0 ? 1 : 0);
}

/**
 * Parse every game card of one browse page.
 * @param html - page HTML.
 * @param fallbackYear - year of the browse page, used when no date is present.
 */
function parseGames(html, fallbackYear) {
  const games = [];
  const seen = new Set();
  const anchor = /<a[^>]+href="(\/game\/[^"?#]+)"[^>]*>/g;
  let match;
  while ((match = anchor.exec(html)) !== null) {
    const close = html.indexOf('</a>', anchor.lastIndex);
    if (close < 0) break;
    const block = html.slice(match.index, close + 4);
    if (!block.includes('data-testid="product-title"')) continue;

    const url = `${BASE}${match[1]}`;
    if (seen.has(url)) continue;
    seen.add(url);

    const rawTitle = block.match(/data-title="([^"]*)"/)?.[1];
    if (!rawTitle) continue;
    let title = decodeEntities(rawTitle);
    let year = null;
    const yearSuffix = title.match(/\s*\((\d{4})\)$/);
    if (yearSuffix) {
      year = Number(yearSuffix[1]);
      title = title.replace(/\s*\(\d{4}\)$/, '').trim();
    }

    const dateText = block.match(/<span>([A-Z][a-z]{2} \d{1,2}, \d{4})<\/span>/)?.[1] ?? null;
    if (dateText) {
      const parsed = Date.parse(dateText);
      if (Number.isFinite(parsed)) {
        year = new Date(parsed).getUTCFullYear();
      }
    }

    const score = Number(block.match(/Metascore (\d{1,3}) out of 100/)?.[1] ?? NaN);
    const userScore = Number(block.match(/User score ([0-9.]+)/)?.[1] ?? NaN);

    const platforms = [];
    for (const platform of block.matchAll(
      /class="iconify i-mc-platform:([a-z0-9-]+)[^"]*"[^>]*title="([^"]+)"/g,
    )) {
      const name = platformName(platform[1], platform[2]);
      if (name && !platforms.includes(name)) platforms.push(name);
    }
    if (platforms.length === 0) {
      for (const platform of block.matchAll(/i-mc-platform:([a-z0-9-]+)/g)) {
        const name = platformName(platform[1], null);
        if (name && !platforms.includes(name)) platforms.push(name);
      }
    }
    if (platforms.length === 0) {
      // Single-platform cards print the platform as text instead of an icon.
      const foot = block.slice(Math.max(0, block.indexOf('Metascore')));
      for (const text of foot.matchAll(/<span class="truncate font-bold">([^<]+)<\/span>/g)) {
        const name = decodeEntities(text[1]);
        if (name && !platforms.includes(name)) platforms.push(name);
      }
    }

    const summaryHtml = block.match(
      /<div class="[^"]*line-clamp-2[^"]*">\s*<span>([\s\S]*?)<\/span>/,
    )?.[1];
    const summary = summaryHtml ? stripTags(summaryHtml).slice(0, 400) : null;

    // Cover art: prefer the 2x srcset URL (192x288), fall back to src.
    let cover = null;
    const imageTag = block.match(/data-testid="product-image"[\s\S]{0,1600}?<img[^>]*>/)?.[0];
    if (imageTag) {
      const srcset = imageTag.match(/srcset="([^"]+)"/)?.[1];
      if (srcset) {
        const entries = srcset.split(',').map((entry) => entry.trim()).filter(Boolean);
        const best = entries[entries.length - 1]?.split(/\s+/)[0];
        if (best) cover = best;
      }
      if (!cover) cover = imageTag.match(/src="([^"]+)"/)?.[1] ?? null;
      if (cover) {
        cover = decodeEntities(cover);
        if (!/^https?:\/\//.test(cover)) cover = `${BASE}${cover}`;
      }
    }

    const badge = block.match(/badge\/(must-play|generally-favorable|mixed|negative)\.svg/)?.[1] ?? null;

    games.push({
      url,
      slug: match[1].replace(/^\/game\/|\/$/g, ''),
      title,
      year: year ?? fallbackYear ?? null,
      releaseDate: dateText,
      score: Number.isFinite(score) && score >= 0 && score <= 100 ? score : null,
      userScore: Number.isFinite(userScore) ? Math.round(userScore * 10) / 10 : null,
      platform: platforms.join(', ') || null,
      platforms,
      summary,
      cover,
      badge,
    });
  }
  return games;
}

const yearUrl = (year, page) =>
  page <= 1
    ? `${BASE}/browse/game/all/all/${year}/`
    : `${BASE}/browse/game/all/all/${year}/?page=${page}`;

/**
 * Bounded-concurrency map. Results keep input order.
 * @param items - work items.
 * @param limit - maximum in-flight calls.
 * @param worker - async worker.
 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Crawl every year page for the configured range.
 *
 * @param options.store - mutable store facade ({games, years, setYear, ...}).
 * @param options.years - years to crawl.
 * @param options.concurrency - parallel requests.
 * @param options.onProgress - receives a progress snapshot.
 * @param options.onCheckpoint - receives the partial collection every N pages.
 * @param options.signal - abort signal.
 */
async function crawlYears({
  store,
  years,
  concurrency = 5,
  onProgress,
  onCheckpoint,
  signal,
}) {
  const startedAt = Date.now();
  const progress = {
    phase: 'discovering',
    done: 0,
    total: years.length,
    year: null,
    page: null,
    games: 0,
    startedAt,
    finishedAt: null,
    error: null,
  };
  const report = () => onProgress?.({ ...progress });

  // Phase 1: first page of every year — rows plus the pagination length.
  const firstPages = await mapLimit(years, concurrency, async (year) => {
    if (signal?.aborted) throw new Error('aborted');
    const html = await fetchPage(yearUrl(year, 1), signal);
    const games = html ? parseGames(html, year) : [];
    const lastPage = html ? parseLastPage(html, games.length) : 0;
    progress.done += 1;
    progress.year = year;
    progress.page = 1;
    progress.games += games.length;
    report();
    return { year, games, lastPage };
  });

  const tasks = [];
  let totalPages = 0;
  for (const entry of firstPages) {
    totalPages += entry.lastPage;
    for (let page = 2; page <= entry.lastPage; page++) {
      tasks.push({ year: entry.year, page });
    }
  }
  progress.phase = 'fetching';
  progress.total = Math.max(totalPages, years.length);
  progress.done = 0;
  report();

  const collected = new Map();
  const currentYear = new Date().getFullYear();
  const addGames = (year, games) => {
    for (const game of games) {
      const key = game.slug || game.url;
      if (!collected.has(key)) {
        if (game.year == null) game.year = year;
        collected.set(key, game);
      }
    }
  };

  for (const entry of firstPages) {
    addGames(entry.year, entry.games);
    if (entry.lastPage <= 1) {
      progress.done += Math.max(1, entry.lastPage);
      progress.year = entry.year;
      report();
    }
    store.setYear(entry.year, {
      pages: entry.lastPage,
      count: entry.games.length,
      fetchedAt: Date.now(),
    });
  }

  // Phase 2: the remaining pages, oldest years first is not important; keep
  // newest years ahead so a fresh release shows up early.
  tasks.sort((a, b) => b.year - a.year || a.page - b.page);
  await mapLimit(tasks, concurrency, async (task) => {
    if (signal?.aborted) throw new Error('aborted');
    const html = await fetchPage(yearUrl(task.year, task.page), signal);
    if (html) {
      const games = parseGames(html, task.year);
      addGames(task.year, games);
      progress.games += games.length;
    }
    progress.done += 1;
    progress.year = task.year;
    progress.page = task.page;
    report();
    if (progress.done % 60 === 0) {
      onCheckpoint?.([...collected.values()]);
    }
  });

  const games = [...collected.values()].sort((a, b) => {
    const scoreA = a.score ?? -1;
    const scoreB = b.score ?? -1;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (b.year ?? 0) - (a.year ?? 0);
  });

  progress.phase = 'idle';
  progress.finishedAt = Date.now();
  progress.total = Math.max(progress.done, 1);
  progress.done = progress.total;
  progress.year = currentYear;
  report();

  return games;
}

/* ------------------------------------------------------------------------- */
/* Game detail pages                                                          */
/* ------------------------------------------------------------------------- */

function extractNuxtData(html) {
  const match = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function extractJsonLd(html) {
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(match[1]);
      if (data && (data['@type'] === 'VideoGame' || data.gamePlatform)) return data;
    } catch {
      /* ignore malformed blocks */
    }
  }
  return null;
}

/** Resolve the devalue-encoded Nuxt payload into plain values. */
function createPayloadReader(array) {
  const seen = new Map();
  const readElement = (raw, depth) => {
    if (raw === null || typeof raw !== 'object') return raw;
    if (depth > 24) return null;
    if (Array.isArray(raw)) return raw.map((value) => readValue(value, depth + 1));
    const out = {};
    for (const key of Object.keys(raw)) out[key] = readValue(raw[key], depth + 1);
    return out;
  };
  const readValue = (value, depth = 0) => {
    if (typeof value === 'number') {
      if (seen.has(value)) return seen.get(value);
      const resolved = readElement(array[value], depth);
      seen.set(value, resolved);
      return resolved;
    }
    return readElement(value, depth);
  };
  return { readElement, readValue };
}

function findGameItem(array) {
  for (let index = 0; index < array.length; index += 1) {
    const entry = array[index];
    if (
      entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      'platforms' in entry &&
      'production' in entry &&
      'title' in entry
    ) {
      return index;
    }
  }
  return -1;
}

function scoredReviewCount(summary) {
  if (!summary) return null;
  const parts = [summary.positiveCount, summary.neutralCount, summary.negativeCount];
  if (parts.every((value) => value == null)) {
    return Number.isFinite(summary.reviewCount) ? summary.reviewCount : null;
  }
  return parts.reduce((total, value) => total + (Number(value) || 0), 0);
}

function parseUserScore(html) {
  const marker = html.indexOf('>User score<');
  if (marker < 0) return { value: null, count: null, sentiment: null };
  const scope = html.slice(marker, marker + 12000);
  const rawValue = scope.match(/data-testid="global-score-value">([\d.]+)</)?.[1];
  const rawCount = scope.match(/Based on ([\d,]+) User Ratings/)?.[1];
  const sentiment = scope.match(/data-testid="global-score-sentiment">([^<]+)</)?.[1] ?? null;
  const value = Number(rawValue);
  const count = Number(String(rawCount ?? '').replace(/,/g, ''));
  return {
    value: Number.isFinite(value) ? value : null,
    count: Number.isFinite(count) && rawCount ? count : null,
    sentiment,
  };
}

function firstMatch(html, pattern) {
  return html.match(pattern)?.[1]?.trim() ?? null;
}

/**
 * Parse a Metacritic game page into the detail model shown by the panel.
 * The Nuxt payload carries every platform's own metascore and review counts;
 * the user score lives in the rendered HTML.
 * @param html - game page HTML.
 * @param slug - game slug, used for links and as identity.
 */
function parseGameDetail(html, slug) {
  const jsonLd = extractJsonLd(html);
  const payload = extractNuxtData(html);
  const reader = payload ? createPayloadReader(payload) : null;
  const itemIndex = payload ? findGameItem(payload) : -1;
  const item = reader && itemIndex >= 0 ? reader.readElement(payload[itemIndex]) : null;

  const user = parseUserScore(html);

  let title = item?.title ?? jsonLd?.name ?? null;
  let description = item?.description ?? jsonLd?.description ?? null;
  if (!description) {
    description = firstMatch(html, /<meta name="description" content="([^"]*)"/);
  }
  description = description ? decodeEntities(description).replace(/\s+\n/g, '\n').trim() : null;

  let releaseDate = item?.releaseDate ?? item?.releaseDateText ?? jsonLd?.datePublished ?? null;
  if (releaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
    const parsed = Date.parse(releaseDate);
    if (Number.isFinite(parsed)) releaseDate = new Date(parsed).toISOString().slice(0, 10);
  }

  const companies = Array.isArray(item?.production?.companies) ? item.production.companies : [];
  const developer = [...new Set(
    companies.filter((company) => company?.typeName === 'Developer').map((company) => company.name).filter(Boolean),
  )];
  const publisher = [...new Set(
    companies.filter((company) => company?.typeName === 'Publisher').map((company) => company.name).filter(Boolean),
  )];

  let platforms = [];
  if (Array.isArray(item?.platforms) && item.platforms.length > 0) {
    platforms = item.platforms.map((platform) => ({
      name: platform?.name ?? platform?.slug ?? '未知平台',
      slug: platform?.slug ?? null,
      score: Number.isFinite(platform?.criticScoreSummary?.score) ? platform.criticScoreSummary.score : null,
      reviews: scoredReviewCount(platform?.criticScoreSummary),
      sentiment: platform?.criticScoreSummary?.sentiment ?? null,
      lead: Boolean(platform?.isLeadPlatform),
      releaseDate: platform?.releaseDate ?? null,
    }));
  } else if (Array.isArray(jsonLd?.gamePlatform)) {
    platforms = jsonLd.gamePlatform.map((name) => ({
      name,
      slug: null,
      score: null,
      reviews: null,
      sentiment: null,
      lead: false,
      releaseDate: null,
    }));
  }

  const deduped = [];
  const platformNames = new Set();
  for (const platform of platforms) {
    const key = platform.name.toLowerCase();
    if (platformNames.has(key)) continue;
    platformNames.add(key);
    deduped.push(platform);
  }
  deduped.sort(
    (a, b) =>
      Number(b.lead) - Number(a.lead) ||
      (b.score ?? -1) - (a.score ?? -1) ||
      a.name.localeCompare(b.name),
  );

  const genres = Array.isArray(item?.genres)
    ? [...new Set(item.genres.map((genre) => (typeof genre === 'string' ? genre : genre?.name)).filter(Boolean))]
    : jsonLd?.genre
      ? [jsonLd.genre].flat().filter(Boolean)
      : [];

  const metascore = Number.isFinite(item?.criticScoreSummary?.score) ? item.criticScoreSummary.score : null;
  const criticCount = scoredReviewCount(item?.criticScoreSummary);

  if (!title) title = firstMatch(html, /data-testid="hero-title"[^>]*>\s*<h1[^>]*>([^<]+)<\/h1>/);

  return {
    slug,
    url: `${BASE}/game/${slug}/`,
    title: title ?? slug,
    description,
    releaseDate,
    premiereYear: item?.premiereYear ?? (releaseDate ? Number(releaseDate.slice(0, 4)) : null),
    rating: item?.rating ?? jsonLd?.contentRating ?? null,
    genres,
    developer,
    publisher,
    metascore,
    criticCount,
    platforms: deduped,
    userScore: user.value,
    userRatingCount: user.count,
    userSentiment: user.sentiment,
    fetchedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------------- */
/* Critic review score distribution                                          */
/* ------------------------------------------------------------------------- */

const REVIEWS_API = 'https://backend.metacritic.com/reviews/metacritic/critic/games';
const REVIEW_PAGE_SIZE = 10;
const REVIEW_MAX = 300;

const DISTRIBUTION_VERSION = 3;

const DISTRIBUTION_BUCKETS = [
  { id: '0-49', label: '0–49', test: (score) => score < 50 },
  { id: '50-79', label: '50–79', test: (score) => score >= 50 && score < 80 },
  { id: '80-99', label: '80–99', test: (score) => score >= 80 && score <= 99 },
  { id: '100', label: '100 分', test: (score) => score === 100 },
];

/**
 * Bucket review scores into the panel's four bands.
 * @param scores - numeric critic scores (0-100).
 */
function buildDistribution(scores) {
  const counts = DISTRIBUTION_BUCKETS.map(() => 0);
  let total = 0;
  for (const score of scores) {
    if (typeof score !== 'number' || score < 0 || score > 100) continue;
    total += 1;
    for (let index = 0; index < DISTRIBUTION_BUCKETS.length; index += 1) {
      if (DISTRIBUTION_BUCKETS[index].test(score)) {
        counts[index] += 1;
        break;
      }
    }
  }
  return {
    total,
    buckets: DISTRIBUTION_BUCKETS.map((bucket, index) => ({
      id: bucket.id,
      label: bucket.label,
      count: counts[index],
      percent: total > 0 ? Math.round((counts[index] / total) * 1000) / 10 : 0,
    })),
  };
}

async function fetchReviewPage(url, signal) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const timeout = AbortSignal.timeout(20000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetch(url, {
        signal: combined,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'application/json',
          referer: `${BASE}/`,
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const items = Array.isArray(data?.data?.items) ? data.data.items : [];
      return {
        total: Number(data?.data?.totalResults) || items.length,
        scores: items.map((item) => item?.score).filter((score) => typeof score === 'number'),
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (attempt === 1) return { total: 0, scores: [] };
      await sleep(400);
    }
  }
  return { total: 0, scores: [] };
}

/**
 * Read every critic review score for one platform (at most REVIEW_MAX).
 * @param slug - game slug.
 * @param platformSlug - Metacritic platform slug, e.g. "playstation-5".
 * @param signal - abort signal.
 */
async function fetchCriticReviewScores(slug, platformSlug, signal) {
  const url = (offset) => `${REVIEWS_API}/${slug}/platform/${platformSlug}/web?offset=${offset}`;
  const first = await fetchReviewPage(url(0), signal);
  const scores = [...first.scores];
  const total = Math.min(first.total, REVIEW_MAX);
  const offsets = [];
  for (let offset = REVIEW_PAGE_SIZE; offset < total; offset += REVIEW_PAGE_SIZE) {
    offsets.push(offset);
  }
  const rest = await mapLimit(offsets, 4, (offset) => fetchReviewPage(url(offset), signal));
  for (const page of rest) scores.push(...page.scores);
  return scores;
}



window.MCScraper = {
  FIRST_YEAR: FIRST_YEAR,
  LAST_YEAR: LAST_YEAR,
  DATA_FIRST_YEAR: DATA_FIRST_YEAR,
  fetchPage: fetchPage,
  parseGames: parseGames,
  parseLastPage: parseLastPage,
  parseGameDetail: parseGameDetail,
  buildDistribution: buildDistribution,
  fetchCriticReviewScores: fetchCriticReviewScores,
  crawlYears: crawlYears,
  mapLimit: mapLimit,
  DISTRIBUTION_BUCKETS: DISTRIBUTION_BUCKETS,
};
