#!/usr/bin/env node
/**
 * Diagnostic: drives the real SteamService with the saved token and reports
 * whether the library reaches the UI state. Prints no secrets.
 */
import { Config } from '../src/config.js';
import { SteamService } from '../src/steam.js';

const service = new SteamService(new Config(), { debug: process.argv.includes('--debug') });
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

service.on('state', (s) => {
  if (s.status === 'error') console.error(`[${at()}] STATE error:`, s.statusDetail);
});

service.start();
console.error(`[${at()}] started; view=login, connecting with saved token…`);

const poll = setInterval(() => {
  const s = service.getState();
  console.error(
    `[${at()}] view=${s.view} status=${s.status} loaded=${s.gamesLoaded} games=${s.games.length}`,
  );
}, 2000);

setTimeout(() => {
  clearInterval(poll);
  const s = service.getState();
  console.error(
    `\nRESULT: gamesLoaded=${s.gamesLoaded} games=${s.games.length} statusDetail=${s.statusDetail}`,
  );
  if (s.games.length) console.error('sample:', s.games.slice(0, 3).map((g) => g.name).join(' | '));
  service.shutdown();
  process.exit(0);
}, 20000);
