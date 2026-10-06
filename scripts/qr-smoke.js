#!/usr/bin/env node
/**
 * Smoke test: starts a real Steam QR login session and prints the QR code.
 * No account needed — proves Steam connectivity and the QR flow work.
 * Scan it with the Steam mobile app and approve to complete the flow.
 */
import { LoginSession, EAuthTokenPlatformType } from 'steam-session';
import QRCode from 'qrcode';

const big = process.argv.includes('--big');
const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
session.loginTimeout = 120_000;

console.error('Starting QR login session (platform: SteamClient)…');
const start = await session.startWithQR();
console.error(`Challenge URL: ${start.qrChallengeUrl}\n`);
console.log(await QRCode.toString(start.qrChallengeUrl, { type: 'terminal', small: !big }));
console.error('\nScan with the Steam mobile app, then approve the sign-in.');

session.on('remoteInteraction', () => {
  console.error('→ QR scanned! Now approve the sign-in in the app.');
});
session.on('timeout', () => {
  console.error('✗ Timed out. Run again for a fresh QR code.');
  process.exit(1);
});
session.on('error', (err) => {
  console.error(`✗ Error: ${err.message}`);
  process.exit(1);
});
session.on('authenticated', () => {
  console.error(`✓ Authenticated as ${session.accountName} (${session.steamID})`);
  console.error('  Refresh token received (kept secret — not printed).');
  process.exit(0);
});
