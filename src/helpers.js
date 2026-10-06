/**
 * Pure helper functions and constants shared by the Steam service and the UI.
 * This module stays dependency-free so it is trivial to unit-test.
 */

/** Persona states we expose, in the order they cycle with the `p` key. */
export const PERSONAS = ['online', 'away', 'invisible'];

export const PERSONA_LABELS = {
  online: 'Online',
  away: 'Away',
  invisible: 'Invisible',
};

/** Steam reports at most this many games as "playing" at the same time. */
export const MAX_CONCURRENT_GAMES = 32;

/** EAuthSessionGuardType values we care about (from steam-session). */
export const GUARD = {
  EmailCode: 2,
  DeviceCode: 3,
  DeviceConfirmation: 4,
  EmailConfirmation: 5,
};

/**
 * Format a duration as HH:MM:SS.
 * @param {number|null} ms
 */
export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '00:00:00';
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/**
 * Filter a game list by a free-form query (matches name or AppID).
 * @param {{appid: number, name: string}[]} games
 * @param {string} query
 */
export function filterGames(games, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return games;
  return games.filter(
    (g) => g.name.toLowerCase().includes(q) || String(g.appid).includes(q),
  );
}

/**
 * Sort games alphabetically (case-insensitive, numeric-aware), AppID as tiebreak.
 * Returns a new sorted array; does not mutate the input.
 */
export function sortGames(games) {
  return [...games].sort((a, b) => {
    const cmp = a.name.localeCompare(b.name, undefined, {sensitivity: 'base', numeric: true});
    return cmp !== 0 ? cmp : a.appid - b.appid;
  });
}

/**
 * Whether an app of the given Steam store type should be shown.
 * With showTools=false only real games (and apps with an unknown type) are shown.
 * @param {string|null|undefined} type
 * @param {boolean} showTools
 */
export function gameTypeAllowed(type, showTools) {
  if (showTools) return true;
  return type == null || type === 'game';
}

/**
 * Compute the slice of a list that should be visible so that `cursor` stays
 * roughly centered inside a `viewport`-sized window.
 */
export function windowRange(len, cursor, viewport) {
  if (len <= 0 || viewport <= 0) return {start: 0, end: 0};
  const size = Math.min(viewport, len);
  const maxStart = len - size;
  const start = Math.min(Math.max(0, cursor - (size >> 1)), maxStart);
  return {start, end: start + size};
}

export function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

export function truncate(str, max) {
  if (str.length <= max) return str;
  return max > 1 ? str.slice(0, max - 1) + '…' : str.slice(0, max);
}

/**
 * Build the prompt shown on the Steam Guard step.
 * @param {number[]} types - EAuthSessionGuardType values offered by Steam
 * @returns {{codeNeeded: boolean, instruction: string|null, alts: string[]}}
 */
export function guardPrompt(types) {
  const has = (t) => types.includes(t);
  const result = {codeNeeded: false, instruction: null, alts: []};
  if (has(GUARD.DeviceCode)) {
    result.codeNeeded = true;
    result.instruction = 'Enter the code from your Steam mobile authenticator';
  } else if (has(GUARD.EmailCode)) {
    result.codeNeeded = true;
    result.instruction = 'Enter the code from the email Steam sent you';
  }
  if (has(GUARD.DeviceConfirmation)) {
    result.alts.push('or approve the sign-in in the Steam mobile app');
  }
  if (has(GUARD.EmailConfirmation)) {
    result.alts.push('or approve the sign-in from the confirmation email');
  }
  return result;
}
