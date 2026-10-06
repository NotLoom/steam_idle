import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  filterGames,
  formatDuration,
  gameTypeAllowed,
  guardPrompt,
  sortGames,
  truncate,
  windowRange,
} from '../src/helpers.js';

test('formatDuration renders HH:MM:SS', () => {
  assert.equal(formatDuration(0), '00:00:00');
  assert.equal(formatDuration(1000), '00:00:01');
  assert.equal(formatDuration(61_000), '00:01:01');
  assert.equal(formatDuration(3_600_000 + 120_000), '01:02:00');
  assert.equal(formatDuration(null), '00:00:00');
  assert.equal(formatDuration(-5), '00:00:00');
});

test('filterGames matches name or appid, case-insensitive', () => {
  const games = [
    {appid: 440, name: 'Team Fortress 2'},
    {appid: 730, name: 'Counter-Strike 2'},
    {appid: 570, name: 'Dota 2'},
  ];
  assert.equal(filterGames(games, '').length, 3);
  assert.deepEqual(filterGames(games, 'fortress'), [games[0]]);
  assert.deepEqual(filterGames(games, '730'), [games[1]]);
  assert.deepEqual(filterGames(games, 'DOTA'), [games[2]]);
  assert.equal(filterGames(games, 'zzz').length, 0);
});

test('gameTypeAllowed filters tools unless enabled', () => {
  assert.equal(gameTypeAllowed('game', false), true);
  assert.equal(gameTypeAllowed('Game', false), true, 'Steam casing varies');
  assert.equal(gameTypeAllowed(null, false), true);
  assert.equal(gameTypeAllowed(undefined, false), true);
  assert.equal(gameTypeAllowed('', false), true);
  assert.equal(gameTypeAllowed('GameDemo', false), true);
  assert.equal(gameTypeAllowed('application', false), true);
  assert.equal(gameTypeAllowed('Application', false), true);
  assert.equal(gameTypeAllowed('tool', false), false);
  assert.equal(gameTypeAllowed('Tool', false), false);
  assert.equal(gameTypeAllowed('music', false), false);
  assert.equal(gameTypeAllowed('DLC', false), false);
  assert.equal(gameTypeAllowed('Config', false), false);
  assert.equal(gameTypeAllowed('Demo', false), false);
  assert.equal(gameTypeAllowed('tool', true), true);
  assert.equal(gameTypeAllowed('DLC', true), true);
  assert.equal(gameTypeAllowed('game', true), true);
});

test('windowRange keeps the cursor centered', () => {
  assert.deepEqual(windowRange(3, 1, 10), {start: 0, end: 3});
  assert.deepEqual(windowRange(100, 0, 10), {start: 0, end: 10});
  assert.deepEqual(windowRange(100, 99, 10), {start: 90, end: 100});
  assert.deepEqual(windowRange(100, 50, 10), {start: 45, end: 55});
  assert.deepEqual(windowRange(0, 0, 10), {start: 0, end: 0});
});

test('guardPrompt picks the right instruction', () => {
  const authenticator = guardPrompt([3, 4]);
  assert.equal(authenticator.codeNeeded, true);
  assert.match(authenticator.instruction, /authenticator/);
  assert.equal(authenticator.alts.length, 1);

  const email = guardPrompt([2]);
  assert.equal(email.codeNeeded, true);
  assert.match(email.instruction, /email/);

  const confirmOnly = guardPrompt([4, 5]);
  assert.equal(confirmOnly.codeNeeded, false);
  assert.equal(confirmOnly.instruction, null);
  assert.equal(confirmOnly.alts.length, 2);
});

test('sortGames is case-insensitive with appid tiebreak', () => {
  const sorted = sortGames([
    {appid: 2, name: 'beta'},
    {appid: 10, name: 'Alpha'},
    {appid: 1, name: 'alpha'},
  ]);
  assert.deepEqual(sorted.map((g) => g.appid), [1, 10, 2]);
});

test('truncate and clamp', () => {
  assert.equal(truncate('hello', 10), 'hello');
  assert.equal(truncate('hello world', 8), 'hello w…');
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-5, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
});
