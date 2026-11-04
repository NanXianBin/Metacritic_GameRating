import fs from 'node:fs';

const gamesFile = 'C:/Users/Administrator/.dsh/metacritic-games/games.json';
const transFile = 'C:/Users/Administrator/.dsh/metacritic-games/translations.json';
const platformFile = 'C:/Users/Administrator/.dsh/metacritic-games/platforms.json';
const outFile =
  'C:/Users/Administrator/Documents/deepseek-harness/default-workspace/metacritic-android/app/assets/www/data.js';

const games = JSON.parse(fs.readFileSync(gamesFile, 'utf8')).games ?? [];
const translations = JSON.parse(fs.readFileSync(transFile, 'utf8')).titles ?? {};
let platformGames = {};
try {
  platformGames = JSON.parse(fs.readFileSync(platformFile, 'utf8')).games ?? {};
} catch {
  platformGames = {};
}

const rows = [];
for (const game of games) {
  if (!game || !game.title) continue;
  const translated = translations[game.title];
  rows.push({
    t: game.title,
    c: translated && translated.zh ? translated.zh : '',
    y: game.year ?? null,
    d: game.releaseDate ?? '',
    s: game.score ?? null,
    u: game.userScore ?? null,
    p: game.platform ?? '',
    pl: Array.isArray(game.platforms) ? game.platforms : [],
    cv: game.cover ?? '',
    sm: game.summary ?? '',
    uu: game.slug ?? '',
  });
}
rows.sort((a, b) => (b.s ?? -1) - (a.s ?? -1) || b.y - a.y);

fs.mkdirSync(outFile.substring(0, outFile.lastIndexOf('/')), { recursive: true });
fs.writeFileSync(
  outFile,
  'window.__GAMES__=' + JSON.stringify(rows) + ';\n' +
    'window.__PLATFORM_INDEX__=' + JSON.stringify(platformGames) + ';',
);
const size = fs.statSync(outFile).size;
console.log(
  'rows', rows.length,
  'platform-index', Object.keys(platformGames).length,
  'size', (size / 1024 / 1024).toFixed(2) + 'MB',
  'translated', rows.filter((r) => r.c).length,
);
