import { EventEmitter } from 'node:events';
import SteamUser from 'steam-user';
import SteamID from 'steamid';
import { LoginSession, EAuthTokenPlatformType } from 'steam-session';
import QRCode from 'qrcode';

import {
  MAX_CONCURRENT_GAMES,
  PERSONAS,
  gameTypeAllowed,
  sortGames,
} from './helpers.js';

/** EPersonaState numbers used by steam-user. */
const PERSONA_MAP = { online: 1, away: 3, invisible: 7 };

/** Steam QR codes are valid for ~2 minutes; match that with our poll timeout. */
const QR_LOGIN_TIMEOUT_MS = 120_000;

/** Debounce for gamesPlayed() calls so checkbox toggles don't spam Steam. */
const APPLY_DEBOUNCE_MS = 250;

/** EResult names that mean "the saved refresh token is no longer usable". */
const TOKEN_ERROR_NAMES = new Set(['InvalidPassword', 'AccessDenied', 'Expired']);

const FRIENDLY_ERRORS = {
  InvalidPassword: 'Wrong account name or password.',
  RateLimitExceeded: 'Too many attempts — wait a few minutes and try again.',
  InvalidLoginAuthCode: 'That Steam Guard code is not right — check it and try again.',
  TwoFactorCodeMismatch: 'That code is not right — check it and try again.',
  AccessDenied: 'Steam denied the login — try again.',
  Expired: 'The login attempt expired — start again.',
};

function friendlyError(err) {
  if (!err) return 'Something went wrong.';
  const name = err.eresult != null ? (SteamUser.EResult?.[err.eresult] ?? null) : null;
  return (
    (name && FRIENDLY_ERRORS[name]) ||
    (err.message && FRIENDLY_ERRORS[err.message]) ||
    err.message ||
    'Something went wrong.'
  );
}

/**
 * Owns everything Steam: login (QR + credentials + Steam Guard), the game
 * library, idling, persona state and reconnection. The UI only talks to this
 * class — it reads `state` snapshots pushed via the `state` event and calls
 * the public methods below.
 */
export class SteamService extends EventEmitter {
  constructor(config, { debug = false, bigQr = false } = {}) {
    super();
    this._config = config;
    this._debug = debug;
    this._bigQr = bigQr;

    this._client = null; // active SteamUser
    this._session = null; // active LoginSession
    this._qrMode = false; // QR login loop is active
    this._library = []; // all owned apps with resolved names/types
    this._sharedAppIds = new Set();
    this._ownedAppIds = new Set();
    this._loadAttempts = 0; // library load attempts in flight
    this._libraryRetryTimer = null;
    this._libraryRetryStarted = null;
    this._selection = new Set(config.data.selection);
    this._lastSent = null; // appid array last sent to gamesPlayed()
    this._applyTimer = null;
    this._idlingActive = false;
    this._idlingPaused = false;
    this._idlingSince = null;
    this._shuttingDown = false;

    this.state = {
      view: 'boot', // boot | login | games
      status: 'offline', // offline | connecting | online | error
      statusDetail: null,
      accountName: config.data.accountName ?? null,
      steamId: config.data.steamId ?? null,
      login: {
        mode: null, // null | 'qr' | 'credentials'
        qr: null, // terminal-rendered QR string
        qrScanned: false,
        guardTypes: [], // EAuthSessionGuardType values offered by Steam
        guardPending: false,
        pending: false,
        error: null,
        remember: config.data.remember !== false,
      },
      games: [],
      gamesLoaded: false,
      selection: [...this._selection].sort((a, b) => a - b),
      idling: { active: false, paused: false, since: null, capped: false },
      persona: PERSONAS.includes(config.data.persona) ? config.data.persona : 'online',
      notice: null,
      noticeAt: 0,
    };
  }

  // --------------------------------------------------------------- state

  getState() {
    return this.state;
  }

  _patch(partial) {
    this.state = { ...this.state, ...partial };
    this.emit('state', this.state);
  }

  _patchLogin(partial) {
    this._patch({ login: { ...this.state.login, ...partial } });
  }

  notice(message) {
    this._patch({ notice: message, noticeAt: Date.now() });
  }

  // ------------------------------------------------------------ lifecycle

  async start() {
    if (this._shuttingDown) return;
    const token = this._config.data.refreshToken;
    if (token) {
      this._connect(token);
    } else {
      this._patch({ view: 'login', status: 'offline' });
      this.startQrLogin();
    }
  }

  /** Stop idling, log off and persist config. Idempotent; safe to call twice. */
  shutdown() {
    if (this._shuttingDown) return;
    this._shuttingDown = true;
    this._abortLogin();
    this._clearLibraryTimers();
    try {
      this._client?.gamesPlayed([]);
    } catch {}
    try {
      this._client?.logOff();
    } catch {}
    this._config.save();
  }

  // ----------------------------------------------------------------- auth

  _abortLogin() {
    this._qrMode = false;
    const session = this._session;
    this._session = null;
    if (session) {
      try {
        session.cancelLoginAttempt();
      } catch {}
    }
  }

  _newSession() {
    const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
    if (this._debug) session.on('debug', (...args) => console.error('[steam-session]', ...args));

    session.on('remoteInteraction', () => {
      if (this._session === session) this._patchLogin({ qrScanned: true });
    });

    session.on('steamGuardMachineToken', () => {
      if (this._session !== session) return;
      const token = session.steamGuardMachineToken;
      if (token && this.state.login.remember) {
        this._config.patch({ machineToken: token });
        this._config.save();
      }
    });

    session.on('authenticated', () => {
      if (this._session !== session) return;
      this._session = null; // done with this login session
      this._qrMode = false;
      this._onAuthenticated(session).catch((err) => {
        this._patchLogin({ mode: null, pending: false, error: err?.message ?? String(err) });
      });
    });

    session.on('timeout', () => {
      if (this._session !== session) return;
      this._session = null;
      if (this._qrMode) {
        // QR codes are only valid for ~2 minutes; show a fresh one.
        this._restartQr();
      } else {
        this._patchLogin({
          mode: null,
          pending: false,
          guardTypes: [],
          guardPending: false,
          error: 'Login timed out — start again.',
        });
      }
    });

    session.on('error', (err) => {
      if (this._session !== session) return;
      this._qrMode = false;
      this._session = null;
      this._patchLogin({ mode: null, pending: false, error: friendlyError(err) });
    });

    this._session = session;
    return session;
  }

  _restartQr() {
    const timer = setTimeout(() => {
      if (this._qrMode && !this._session && !this._shuttingDown) this.startQrLogin();
    }, 500);
    timer.unref?.();
  }

  async startQrLogin() {
    if (this._shuttingDown) return;
    this._abortLogin();
    this._qrMode = true;
    this._patch({ view: 'login' });
    this._patchLogin({
      mode: 'qr',
      qr: null,
      qrScanned: false,
      guardTypes: [],
      guardPending: false,
      pending: false,
      error: null,
    });
    try {
      const session = this._newSession();
      session.loginTimeout = QR_LOGIN_TIMEOUT_MS;
      const res = await session.startWithQR();
      if (this._session !== session) return; // aborted meanwhile
      const qr = await QRCode.toString(res.qrChallengeUrl, {
        type: 'terminal',
        small: !this._bigQr,
      });
      if (this._session !== session) return;
      this._patchLogin({ qr });
    } catch (err) {
      this._abortLogin();
      this._patchLogin({ mode: null, error: friendlyError(err) });
    }
  }

  showCredentialForm() {
    if (this._shuttingDown) return;
    this._abortLogin();
    this._patch({ view: 'login' });
    this._patchLogin({
      mode: 'credentials',
      qr: null,
      qrScanned: false,
      guardTypes: [],
      guardPending: false,
      pending: false,
      error: null,
    });
  }

  async startCredentialLogin(accountName, password) {
    if (this._shuttingDown) return;
    this._abortLogin();
    this._patch({ view: 'login' });
    this._patchLogin({
      mode: 'credentials',
      pending: true,
      error: null,
      qr: null,
      qrScanned: false,
    });
    try {
      const session = this._newSession();
      const details = { accountName, password };
      if (this._config.data.machineToken && this.state.login.remember) {
        details.steamGuardMachineToken = this._config.data.machineToken;
      }
      const res = await session.startWithCredentials(details);
      if (this._session !== session) return; // aborted meanwhile
      const guardTypes = (res?.validActions ?? []).map((a) => a.type);
      if (guardTypes.length === 0) {
        // No guard required — the `authenticated` event follows shortly.
        this._patchLogin({ pending: true });
      } else {
        this._patchLogin({ guardTypes, pending: false });
      }
    } catch (err) {
      this._abortLogin();
      this._patchLogin({ pending: false, error: friendlyError(err) });
    }
  }

  async submitGuardCode(code) {
    const session = this._session;
    if (!session || !code) return;
    this._patchLogin({ guardPending: true, error: null });
    try {
      await session.submitSteamGuardCode(String(code).trim());
      // On success the `authenticated` event takes over.
    } catch (err) {
      this._patchLogin({ guardPending: false, error: friendlyError(err) });
    }
  }

  cancelLogin() {
    this._abortLogin();
    this._patch({ view: 'login' });
    this._patchLogin({
      mode: null,
      pending: false,
      guardTypes: [],
      guardPending: false,
      qr: null,
      qrScanned: false,
      error: null,
    });
  }

  setRemember(remember) {
    this._patchLogin({ remember });
    this._config.patch({ remember });
    this._config.save();
  }

  async _onAuthenticated(session) {
    const refreshToken = session.refreshToken;
    const accountName = session.accountName ?? null;
    const steamId = session.steamID ? String(session.steamID) : null;
    const remember = this.state.login.remember;
    if (remember) {
      this._config.patch({ refreshToken, accountName, steamId });
      this._config.save();
    }
    this._patchLogin({
      mode: null,
      pending: false,
      guardTypes: [],
      guardPending: false,
      qr: null,
      qrScanned: false,
      error: null,
    });
    this._patch({ accountName, steamId: remember ? steamId : null });
    this._connect(refreshToken, { accountName });
  }

  // ---------------------------------------------------------------- client

  _connect(refreshToken, { accountName } = {}) {
    this._destroyClient();
    const client = new SteamUser({ enablePicsCache: true, renewRefreshTokens: true });
    this._client = client;
    if (this._debug) client.on('debug', (...args) => console.error('[steam-user]', ...args));

    client.on('loggedOn', () => this._onLoggedOn());
    client.on('error', (err) => this._onClientError(err));
    client.on('disconnected', (eresult, msg) => this._onDisconnected(eresult, msg));
    client.on('refreshToken', (token) => {
      if (this.state.login.remember && this._config.data.refreshToken) {
        this._config.patch({ refreshToken: token });
        this._config.save();
      }
    });
    client.on('ownershipCached', () => this._loadLibrary());
    client.on('playingState', (blocked) => {
      if (blocked) {
        this.notice('A game is being played on another session — idling may be blocked.');
      }
    });

    this._patch({ status: 'connecting', statusDetail: null });
    try {
      client.logOn({ refreshToken, machineName: 'Steam Hour Idler' });
    } catch (err) {
      this._onClientError(err);
    }
  }

  /**
   * Loads the game library, retrying until steam-user's license/PICS cache is
   * populated. `ownershipCached` is the normal trigger, but it is only emitted
   * when the license request succeeds (steam-user reports failures solely via
   * its `debug` event), so we also poll after logon as a safety net.
   */
  _loadLibrary({ retry = true } = {}) {
    const client = this._client;
    if (!client || this._library.length > 0 || this._loadAttempts > 0) return;

    if (!this._picsReady()) {
      if (retry) this._scheduleLibraryRetry();
      return;
    }

    this._loadAttempts += 1;
    Promise.resolve()
      .then(() => this._buildLibrary())
      .then(() => {
        this._loadAttempts = 0;
        // Loaded — clear the retry window so future reloads start fresh.
        this._libraryRetryStarted = null;
      })
      .catch((err) => {
        this._loadAttempts = 0;
        if (retry) {
          this._scheduleLibraryRetry();
        } else {
          this._patch({
            status: 'error',
            statusDetail: `Could not load your library: ${err.message}`,
          });
        }
      });
  }

  /** True once steam-user has cached our licenses and package data. */
  _picsReady() {
    const client = this._client;
    if (!client) return false;
    if (!client.picsCache?.ownershipModified) return false;
    // Anonymous accounts own no licenses, so there is nothing to load.
    if (!client.steamID || client.steamID.type === SteamID.Type.ANON_USER) return false;
    return true;
  }

  /** Poll until the cache is ready (steam-user takes a moment after logon). */
  _scheduleLibraryRetry() {
    if (this._libraryRetryTimer || this._shuttingDown) return;
    const started = this._libraryRetryStarted ?? Date.now();
    this._libraryRetryStarted = started;
    if (Date.now() - started > 60_000) {
      this._libraryRetryStarted = null;
      this._patch({ gamesLoaded: true });
      this.notice('Steam did not return your game list — press r to retry.');
      return;
    }
    this._libraryRetryTimer = setTimeout(() => {
      this._libraryRetryTimer = null;
      this._loadAttempts = 0;
      this._loadLibrary();
      if (this._library.length === 0 && !this._libraryRetryTimer) this._scheduleLibraryRetry();
    }, 700);
    this._libraryRetryTimer.unref?.();
  }

  /** Manual retry (bound to `r` in the library view). */
  reloadLibrary({ nudge = false } = {}) {
    this._clearLibraryTimers();
    this._loadAttempts = 0;
    this._libraryRetryStarted = null;
    this._patch({ gamesLoaded: this._library.length > 0 });
    // Only re-request license info when the cache is already populated —
    // calling setOption earlier makes steam-user crash on a null license list.
    if (nudge && this._picsReady()) {
      this.notice('Reloading your game list…');
      try {
        this._client?.setOption('enablePicsCache', true);
      } catch {}
    }
    this._loadLibrary({ retry: false });
    if (this._library.length === 0) this._scheduleLibraryRetry();
  }

  _clearLibraryTimers() {
    if (this._libraryRetryTimer) {
      clearTimeout(this._libraryRetryTimer);
      this._libraryRetryTimer = null;
    }
  }

  _destroyClient() {
    const client = this._client;
    this._client = null;
    this._clearLibraryTimers();
    this._loadAttempts = 0;
    this._libraryRetryStarted = null;
    if (!client) return;
    client.removeAllListeners();
    try {
      client.logOff();
    } catch {}
  }

  _onLoggedOn() {
    if (this._client) {
      try {
        this._client.setPersona(PERSONA_MAP[this.state.persona] ?? 1);
      } catch {}
    }
    this._patch({
      view: 'games',
      status: 'online',
      statusDetail: null,
      accountName: this._config.data.accountName ?? this.state.accountName,
      gamesLoaded: this._library.length > 0,
    });
    if (this._library.length > 0) {
      this._emitGames();
    } else {
      // Don't wait for `ownershipCached` alone — steam-user only emits it once
      // its license request succeeds, so poll until the cache is ready.
      this.reloadLibrary();
    }
    if (!this._idlingActive && this._config.data.autoResume && this._selection.size > 0) {
      this._idlingActive = true;
      this._idlingSince = Date.now();
    }
    this._applyGames(true);
  }

  _onClientError(err) {
    const name = err?.eresult != null ? (SteamUser.EResult?.[err.eresult] ?? null) : null;
    this._destroyClient();
    if (TOKEN_ERROR_NAMES.has(name)) {
      // The saved session is expired or invalid → ask for a fresh login.
      this._config.clearLogin();
      this._resetSessionState();
      this._patch({ view: 'login', status: 'offline' });
      this._patchLogin({ mode: null, error: 'Your saved login expired — sign in again.' });
      this.startQrLogin();
      return;
    }
    const message = friendlyError(err);
    this._patch({ status: 'error', statusDetail: message });
    this.notice(message);
  }

  _onDisconnected(eresult, msg) {
    if (this._shuttingDown) return;
    // steam-user reconnects automatically (autoRelogin); surface the state.
    this._patch({
      status: 'connecting',
      statusDetail: msg ? `Connection lost: ${msg}` : 'Connection lost — reconnecting…',
    });
  }

  // --------------------------------------------------------------- library

  async _buildLibrary() {
    const client = this._client;
    if (!client) return;

    const all = client.getOwnedApps();
    const ownedOnly = client.getOwnedApps({ excludeShared: true });
    this._sharedAppIds = new Set(all.filter((id) => !ownedOnly.includes(id)));
    this._ownedAppIds = new Set(all);

    const games = [];
    const missing = [];
    for (const appid of all) {
      const common = client.picsCache?.apps?.[appid]?.appinfo?.common;
      if (common?.name) {
        games.push({ appid, name: common.name, type: common.type ?? null });
      } else {
        missing.push(appid);
      }
    }

    // Resolve names the PICS cache lacks (rare) in small batches.
    for (let i = 0; i < missing.length; i += 200) {
      const batch = missing.slice(i, i + 200);
      try {
        const res = await client.getProductInfo(batch, [], true);
        for (const appid of batch) {
          const common = res.apps?.[appid]?.appinfo?.common;
          if (common?.name) {
            games.push({ appid, name: common.name, type: common.type ?? null });
          } else {
            games.push({ appid, name: `App ${appid}`, type: null });
          }
        }
      } catch {
        for (const appid of batch) games.push({ appid, name: `App ${appid}`, type: null });
      }
    }

    this._library = sortGames(games);
    this._pruneSelection();
    this._emitGames();
  }

  _emitGames() {
    const { includeShared, showTools } = this._config.data;
    const games = this._library.filter(
      (g) =>
        gameTypeAllowed(g.type, showTools) &&
        (includeShared || !this._sharedAppIds.has(g.appid)),
    );
    this._patch({ games, gamesLoaded: true });
  }

  _pruneSelection() {
    let pruned = false;
    for (const appid of [...this._selection]) {
      if (!this._ownedAppIds.has(appid)) {
        this._selection.delete(appid);
        pruned = true;
      }
    }
    if (pruned) this._persistSelection();
  }

  // ---------------------------------------------------------------- idling

  toggleGame(appid, on) {
    const has = this._selection.has(appid);
    if (on === has) return;
    if (on) this._selection.add(appid);
    else this._selection.delete(appid);
    this._persistSelection();
    this._maybeActivate();
    this._scheduleApply();
  }

  selectMany(appids) {
    let changed = false;
    for (const appid of appids) {
      if (!this._selection.has(appid)) {
        this._selection.add(appid);
        changed = true;
      }
    }
    if (!changed) return;
    this._persistSelection();
    this._maybeActivate();
    this._scheduleApply();
  }

  clearSelection() {
    if (this._selection.size === 0) return;
    this._selection.clear();
    this._persistSelection();
    this._scheduleApply();
  }

  togglePaused() {
    this._idlingPaused = !this._idlingPaused;
    this._maybeActivate();
    this._scheduleApply();
  }

  _maybeActivate() {
    if (!this._idlingPaused && !this._idlingActive && this._selection.size > 0) {
      this._idlingActive = true;
      this._idlingSince = Date.now();
    }
    if (this._idlingActive && this._selection.size === 0) {
      this._idlingActive = false;
      this._idlingSince = null;
    }
  }

  _persistSelection() {
    this._config.patch({ selection: [...this._selection].sort((a, b) => a - b) });
    this._config.save();
  }

  _scheduleApply() {
    if (this._applyTimer) return;
    this._applyTimer = setTimeout(() => {
      this._applyTimer = null;
      this._applyGames();
    }, APPLY_DEBOUNCE_MS);
    this._applyTimer.unref?.();
  }

  _applyGames(force = false) {
    const client = this._client;
    if (!client || this.state.status !== 'online') {
      this._syncIdling();
      return;
    }
    if (!this._idlingActive || this._idlingPaused || this._selection.size === 0) {
      if (force || (this._lastSent && this._lastSent.length > 0)) {
        try {
          client.gamesPlayed([]);
        } catch {}
        this._lastSent = [];
      }
      this._syncIdling();
      return;
    }
    const apps = [...this._selection].sort((a, b) => a - b).slice(0, MAX_CONCURRENT_GAMES);
    try {
      client.gamesPlayed(apps);
    } catch (err) {
      this.notice(`Could not update idling: ${err.message}`);
    }
    this._lastSent = apps;
    if (this._selection.size > MAX_CONCURRENT_GAMES) {
      this.notice(
        `Steam reports at most ${MAX_CONCURRENT_GAMES} games at once — extra selections are ignored.`,
      );
    }
    this._syncIdling();
  }

  _syncIdling() {
    this._patch({
      selection: [...this._selection].sort((a, b) => a - b),
      idling: {
        active: this._idlingActive,
        paused: this._idlingPaused,
        since: this._idlingActive && !this._idlingPaused ? this._idlingSince : null,
        capped: this._selection.size > MAX_CONCURRENT_GAMES,
      },
    });
  }

  // ------------------------------------------------------ persona/settings

  setPersona(persona) {
    if (!PERSONAS.includes(persona)) return;
    this._patch({ persona });
    this._config.patch({ persona });
    this._config.save();
    if (this._client && this.state.status === 'online') {
      try {
        this._client.setPersona(PERSONA_MAP[persona]);
      } catch {}
    }
  }

  cyclePersona() {
    const idx = PERSONAS.indexOf(this.state.persona);
    this.setPersona(PERSONAS[(idx + 1) % PERSONAS.length]);
  }

  toggleTools() {
    this._config.patch({ showTools: !this._config.data.showTools });
    this._config.save();
    this._emitGames();
  }

  toggleShared() {
    this._config.patch({ includeShared: !this._config.data.includeShared });
    this._config.save();
    this._emitGames();
  }

  // ---------------------------------------------------------------- logout

  async logout() {
    try {
      if (this._client) {
        this._client.gamesPlayed([]);
        await this._client.logOff();
      }
    } catch {}
    this._destroyClient();
    this._config.clearLogin();
    this._selection.clear();
    this._persistSelection();
    this._resetSessionState();
    this._patch({
      view: 'login',
      status: 'offline',
      statusDetail: null,
      accountName: null,
      steamId: null,
    });
    this._patchLogin({
      mode: null,
      pending: false,
      guardTypes: [],
      guardPending: false,
      qr: null,
      qrScanned: false,
      error: null,
    });
  }

  _resetSessionState() {
    this._clearLibraryTimers();
    this._loadAttempts = 0;
    this._libraryRetryStarted = null;
    this._idlingActive = false;
    this._idlingPaused = false;
    this._idlingSince = null;
    this._lastSent = null;
    this._library = [];
    this._ownedAppIds.clear();
    this._sharedAppIds.clear();
    this._patch({ games: [], gamesLoaded: false });
    this._syncIdling();
  }
}
