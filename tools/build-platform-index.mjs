import fs from 'node:fs';
import vm from 'node:vm';

const PLATFORMS = [
  ['3DS', '3ds'],
  ['Dreamcast', 'dreamcast'],
  ['DS', 'nintendo-ds'],
  ['Game Boy Advance', 'game-boy-advance'],
  ['GameCube', 'gamecube'],
  ['Meta Quest', 'meta-quest'],
  ['Nintendo 64', 'nintendo-64'],
  ['Nintendo Switch', 'nintendo-switch'],
  ['Nintendo Switch 2', 'nintendo-switch-2'],
  ['PC', 'pc'],
  ['PlayStation', 'ps1'],
  ['PlayStation 2', 'ps2'],
  ['PlayStation 3', 'ps3'],
  ['PlayStation 4', 'ps4'],
  ['PlayStation 5', 'ps5'],
  ['PlayStation Vita', 'ps-vita'],
  ['PSP', 'psp'],
  ['Wii', 'wii'],
  ['Wii U', 'wii-u'],
  ['Xbox', 'xbox'],
  ['Xbox 360', 'xbox-360'],
  ['Xbox One', 'xbox-one'],
  ['Xbox Series X', 'xbox-series-x'],
];

const FIRST_YEAR = 1995;
const LAST_YEAR = Math.max(2026, new Date().getFullYear());
const OUT = 'C:/Users/Administrator/.dsh/metacritic-games/platforms.json';

const source = fs
  .readFileSync('C:/Users/Administrator/Documents/deepseek-harness/default-workspace/dsh-metacritic-games/scraper.js', 'utf8')
  .replace(/^export /gm, '');
const context = {
  console, setTimeout, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp,
  Error, Promise, Map, Set, URL, AbortController, AbortSignal, fetch: globalThis.fetch,
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);

const index = new Map();

function addGames(platformName, year, games) {
  for (const game of games) {
    const key = game.slug || game.url;
    if (!key) continue;
    let entry = index.get(key);
    if (!entry) {
      entry = {};
      index.set(key, entry);
    }
    let years = entry[platformName];
    if (!years) {
      years = [];
      entry[platformName] = years;
    }
    if (!years.includes(year)) years.push(year);
  }
}

function save() {
  const games = {};
  for (const [slug, entry] of index) games[slug] = entry;
  fs.writeFileSync(OUT, JSON.stringify({ version: 2, updatedAt: Date.now(), games }));
}

const started = Date.now();
let pageCount = 0;

async function main() {
  const pairs = [];
  for (const [name, slug] of PLATFORMS) {
    for (let year = FIRST_YEAR; year <= LAST_YEAR; year += 1) pairs.push({ name, slug, year });
  }
  console.log('platform-year pairs', pairs.length);

  const firstPages = await context.mapLimit(pairs, 8, async (pair) => {
    const url = `https://www.metacritic.com/browse/game/${pair.slug}/all/${pair.year}/`;
    try {
      const html = await context.fetchPage(url);
      if (!html) return null;
      const heading = String(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '').replace(/<[^>]+>/g, ' ');
      if (!/best games on/i.test(heading)) return null;
      const games = context.parseGames(html, pair.year);
      if (games.length === 0) return null;
      addGames(pair.name, pair.year, games);
      pageCount += 1;
      return { ...pair, lastPage: context.parseLastPage(html, games.length) };
    } catch (error) {
      return null;
    }
  });

  const tasks = [];
  for (const entry of firstPages) {
    if (!entry) continue;
    for (let page = 2; page <= entry.lastPage; page += 1) tasks.push({ ...entry, page });
  }
  console.log('first pages done', pageCount, 'more pages', tasks.length);

  await context.mapLimit(tasks, 8, async (task) => {
    const url = `https://www.metacritic.com/browse/game/${task.slug}/all/${task.year}/?page=${task.page}`;
    try {
      const html = await context.fetchPage(url);
      if (!html) return;
      addGames(task.name, task.year, context.parseGames(html, task.year));
      pageCount += 1;
      if (pageCount % 100 === 0) {
        save();
        console.log('pages', pageCount, 'games', index.size, `${Math.round((Date.now() - started) / 1000)}s`);
      }
    } catch (error) {
      /* skip */
    }
  });

  save();
  console.log('DONE pages', pageCount, 'games', index.size, `${Math.round((Date.now() - started) / 1000)}s`, fs.statSync(OUT).size);
}

main().catch((error) => {
  console.error('FAILED', error);
  process.exit(1);
});
