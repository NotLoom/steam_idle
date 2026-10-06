import test from 'node:test';
import assert from 'node:assert/strict';

import { Config } from '../src/config.js';
import { SteamService } from '../src/steam.js';

/**
 * Builds a SteamService with a stubbed client/builder so the library-loading
 * retry logic can be exercised without talking to Steam.
 */
function makeService({ picsReadyAfter = 0 } = {}) {
  const config = new Config('/tmp/steam-hour-idler-test');
  const service = new SteamService(config);
  let checks = 0;
  const state = { picsCache: { ownershipModified: null }, steamID: { type: 1 } };
  Object.defineProperty(service, '_client', {
    value: {
      get picsCache() {
        return state.picsCache;
      },
      get steamID() {
        return state.steamID;
      },
      setOption() {},
    },
    writable: true,
  });
  // Stub the actual builder: succeed with a fixed list.
  service._buildLibrary = async function () {
    this._library = [
      { appid: 440, name: 'Team Fortress 2', type: 'game' },
      { appid: 730, name: 'Counter-Strike 2', type: 'game' },
    ];
    this._sharedAppIds = new Set();
    this._ownedAppIds = new Set([440, 730]);
    this._emitGames();
  };
  // Count readiness polls; flip the cache ready after N polls.
  const realReady = service._picsReady.bind(service);
  service._picsReady = () => {
    checks += 1;
    if (checks > picsReadyAfter) {
      state.picsCache.ownershipModified = Date.now();
    }
    return realReady();
  };
  return service;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('library loads once the PICS cache becomes ready', async () => {
  // Not ready for the first 3 polls, then ready.
  const service = makeService({ picsReadyAfter: 3 });
  service._loadLibrary();
  await wait(3000);
  assert.equal(service.state.games.length, 2, 'games should load after retries');
  assert.equal(service.state.gamesLoaded, true);
  assert.equal(service.state.games[0].name, 'Team Fortress 2');
  service.shutdown();
});

test('library loads immediately when the cache is already ready', async () => {
  const service = makeService({ picsReadyAfter: 0 });
  service._client.picsCache.ownershipModified = Date.now();
  service._loadLibrary();
  await wait(50);
  assert.equal(service.state.games.length, 2);
  service.shutdown();
});

test('gives up with a clear message if the cache never arrives', async () => {
  const service = makeService({ picsReadyAfter: Number.MAX_SAFE_INTEGER });
  // Compress the 60s give-up window so the test stays fast.
  service._libraryRetryStarted = Date.now() - 59_900;
  service._loadLibrary();
  await wait(200);
  // Let the next retry tick cross the deadline.
  service._libraryRetryStarted = Date.now() - 60_100;
  await wait(1200);
  assert.equal(service.state.gamesLoaded, true, 'should stop showing the loading spinner');
  assert.match(service.state.notice, /did not return your game list/);
  service.shutdown();
});
