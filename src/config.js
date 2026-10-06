import {chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Default on-disk config. Only non-sensitive state and the (long-lived but
 * revocable) Steam refresh token are stored here — never the password.
 */
export const DEFAULT_CONFIG = {
  refreshToken: null,
  accountName: null,
  steamId: null,
  machineToken: null,
  remember: true,
  persona: 'online',
  includeShared: false,
  showTools: false,
  autoResume: true,
  selection: [],
};

function defaultDir() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'steam-hour-idler');
}

export class Config {
  constructor(dirPath = defaultDir()) {
    this.dir = dirPath;
    this.file = path.join(dirPath, 'config.json');
    this.data = {...DEFAULT_CONFIG, selection: []};
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      this.data = {...DEFAULT_CONFIG, ...raw};
      if (!Array.isArray(this.data.selection)) this.data.selection = [];
    } catch {
      // First run or unreadable file: keep defaults.
    }
  }

  patch(obj) {
    this.data = {...this.data, ...obj};
  }

  save() {
    mkdirSync(this.dir, {recursive: true});
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n', {mode: 0o600});
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.file);
  }

  clearLogin() {
    this.patch({refreshToken: null, accountName: null, steamId: null, machineToken: null});
    this.save();
  }
}
