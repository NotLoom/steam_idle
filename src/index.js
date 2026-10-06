#!/usr/bin/env node
import process from 'node:process';

import { render } from 'ink';

import { Config } from './config.js';
import { SteamService } from './steam.js';
import { App } from './ui/app.js';
import { html } from './ui/jsx.js';

const VERSION = '0.1.0';
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

if (has('--help') || has('-h')) {
  console.log(`steam-hour-idler ${VERSION}

A clean and simple terminal Steam hour idler.

Usage:
  steam-hour-idler [options]

Options:
  --reset     Forget the saved login and selection
  --big-qr    Render the login QR code in the larger (non-half-block) style
  --debug     Verbose Steam logs, no alternate screen
  -h, --help  Show this help
  -v, --version

Keys:
  login     p: password login · r: new QR code · esc: cancel · q: quit
  library   ↑/↓ move · space: idle game · a: select all · c: clear
            s: pause/resume · p: cycle status · t: tools · f: shared
            /: search · l: logout · q: quit

Config is stored in ~/.config/steam-hour-idler/ (never your password).
`);
  process.exit(0);
}

if (has('--version') || has('-v')) {
  console.log(VERSION);
  process.exit(0);
}

const debug = has('--debug');
const bigQr = has('--big-qr');
const config = new Config();

if (has('--reset')) {
  config.clearLogin();
  config.patch({ selection: [] });
  config.save();
  console.log('Saved login cleared.');
  process.exit(0);
}

const service = new SteamService(config, { debug, bigQr });

process.on('unhandledRejection', (err) => {
  if (debug) console.error('[unhandled rejection]', err);
});

service.start();

const instance = render(html`<${App} service=${service} />`, {
  alternateScreen: process.stdout.isTTY === true && !debug,
  patchConsole: !debug,
  exitOnCtrlC: true,
});

const shutdown = () => {
  service.shutdown();
  try {
    instance.unmount();
  } catch {}
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await instance.waitUntilExit();
service.shutdown();
// Give the logOff/gamesPlayed([]) messages a moment to flush to Steam.
setTimeout(() => process.exit(0), 300).unref?.();

