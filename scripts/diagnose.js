#!/usr/bin/env node
/**
 * Diagnostic: logs in with the saved refresh token and reports exactly what
 * steam-user does with the PICS/ownership cache. Prints no secrets.
 */
import SteamUser from 'steam-user';
import { Config } from '../src/config.js';

const config = new Config();
const token = config.data.refreshToken;
if (!token) {
  console.error('No saved refresh token — log in through the app first.');
  process.exit(1);
}

const client = new SteamUser({ enablePicsCache: true, renewRefreshTokens: true });
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log = (...a) => console.error(`[${at()}]`, ...a);

client.on('debug', (msg) => {
  if (/license|product|pics|cache|Error/i.test(String(msg))) log('DEBUG:', msg);
});
client.on('loggedOn', () => {
  log('loggedOn — steamID:', String(client.steamID), 'type:', client.steamID?.type);
});
client.on('licenses', (licenses) => {
  log('licenses event — count:', licenses?.length);
});
client.on('ownershipCached', () => {
  log('ownershipCached FIRED — ownershipModified:', !!client.picsCache?.ownershipModified);
});
client.on('error', (err) => {
  log('ERROR:', err.message, 'eresult:', err.eresult);
});
client.on('disconnected', (r, m) => log('disconnected:', r, m));

log('logOn with saved refresh token…');
client.logOn({ refreshToken: token, machineName: 'steam-hour-idler-diag' });

// Poll the internals the way the app does.
const poll = setInterval(() => {
  log(
    'poll — licenses:', client.licenses?.length ?? 'none',
    '| ownershipModified:', !!client.picsCache?.ownershipModified,
    '| steamID:', String(client.steamID ?? 'none'),
  );
}, 2000);

setTimeout(() => {
  clearInterval(poll);
  let owned = null;
  try {
    owned = client.getOwnedApps();
  } catch (err) {
    owned = `THREW: ${err.message}`;
  }
  log('getOwnedApps():', Array.isArray(owned) ? `${owned.length} apps` : owned);
  if (Array.isArray(owned) && owned.length) {
    log('first 5:', owned.slice(0, 5).join(', '));
    const named = owned.filter((a) => client.picsCache?.apps?.[a]?.appinfo?.common?.name);
    log(`PICS names resolved for ${named.length}/${owned.length} owned apps`);
  }
  client.logOff();
  process.exit(0);
}, 20000);
