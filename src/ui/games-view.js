import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import TextInput from 'ink-text-input';

import {
  MAX_CONCURRENT_GAMES,
  PERSONA_LABELS,
  clamp,
  filterGames,
  formatDuration,
  truncate,
  windowRange,
} from '../helpers.js';
import { Hints, SpinnerLine } from './components.js';
import { html, React } from './jsx.js';

/** Rows used by the title bar, search line and footer outside the list. */
const CHROME_ROWS = 8;

/**
 * Main screen: searchable, scrollable checklist of the user's Steam library.
 * Checking a game starts (or extends) idling right away.
 */
export default function GamesView({ service, snap }) {
  const { exit } = useApp();
  const [query, setQuery] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);
  const [, setTick] = React.useState(0);
  const { rows = 24, columns = 80 } = useWindowSize();

  const games = React.useMemo(() => filterGames(snap.games, query), [snap.games, query]);
  const selected = React.useMemo(() => new Set(snap.selection), [snap.selection]);
  const viewport = Math.max(3, rows - CHROME_ROWS);
  const cur = clamp(cursor, 0, Math.max(0, games.length - 1));
  const { start } = windowRange(games.length, cur, viewport);
  const visible = games.slice(start, start + viewport);

  React.useEffect(() => {
    setCursor((c) => clamp(c, 0, Math.max(0, games.length - 1)));
  }, [games.length]);

  // Re-render once per second while idling so the elapsed time ticks.
  const idling = snap.idling;
  React.useEffect(() => {
    if (!idling.active || idling.paused) return undefined;
    const timer = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(timer);
  }, [idling.active, idling.paused]);

  const move = (delta) => setCursor((c) => clamp(c + delta, 0, games.length - 1));

  // Keys while navigating the list.
  useInput(
    (input, key) => {
      if (key.upArrow || input === 'k') move(-1);
      else if (key.downArrow || input === 'j') move(1);
      else if (key.pageUp) move(-viewport);
      else if (key.pageDown) move(viewport);
      else if (key.return || input === ' ') {
        if (games[cur]) service.toggleGame(games[cur].appid, !selected.has(games[cur].appid));
      } else if (input === 'a') service.selectMany(games.map((g) => g.appid));
      else if (input === 'c') service.clearSelection();
      else if (input === 'p') service.cyclePersona();
      else if (input === 't') service.toggleTools();
      else if (input === 'f') service.toggleShared();
      else if (input === 's') service.togglePaused();
      else if (input === 'r') service.reloadLibrary({ nudge: true });
      else if (input === 'l') service.logout();
      else if (input === '/') setSearching(true);
      else if (input === 'q') exit();
    },
    { isActive: !searching },
  );

  // Keys while the search field has focus.
  useInput(
    (input, key) => {
      if (key.escape) {
        setQuery('');
        setSearching(false);
      }
    },
    { isActive: searching },
  );

  // Transient notices fade after a few seconds.
  const [noticeShown, setNoticeShown] = React.useState(false);
  React.useEffect(() => {
    if (!snap.notice) return undefined;
    setNoticeShown(true);
    const timer = setTimeout(() => setNoticeShown(false), 6000);
    return () => clearTimeout(timer);
  }, [snap.noticeAt, snap.notice]);

  const connColor =
    snap.status === 'online' ? 'green' : snap.status === 'error' ? 'red' : 'yellow';
  const personaLabel = PERSONA_LABELS[snap.persona] ?? snap.persona;

  let statusText;
  if (idling.paused) {
    statusText = `⏸ paused — ${snap.selection.length} selected, s to resume`;
  } else if (idling.active && snap.selection.length > 0) {
    const count = Math.min(snap.selection.length, MAX_CONCURRENT_GAMES);
    const elapsed = formatDuration(idling.since ? Date.now() - idling.since : null);
    statusText = `▶ idling ${count} game${count === 1 ? '' : 's'} · ${elapsed}`;
  } else {
    statusText = 'idle — select games with space';
  }

  return html`
    <${Box} flexDirection="column" height="100%" gap=${1}>
      <${Box} justifyContent="space-between" paddingX=${1}>
        <${Text} bold color="cyan">Steam Hour Idler<//>
        <${Box} gap=${2}>
          ${snap.accountName ? html`<${Text}>${snap.accountName}<//>` : null}
          <${Text} color=${connColor}>●<//>
          <${Text} dimColor>${personaLabel}<//>
        <//>
      <//>

      ${noticeShown && snap.notice
        ? html`<${Text} color="yellow" paddingX=${1}>! ${snap.notice}<//>`
        : null}

      <${Box} gap=${1} paddingX=${1}>
        <${Text} dimColor>${searching ? 'search:' : '/'}<//>
        <${TextInput}
          value=${query}
          placeholder="press / to search"
          focus=${searching}
          onChange=${setQuery}
          onSubmit=${() => setSearching(false)}
        />
      <//>

      <${Box} flexDirection="column" paddingX=${1}>
        ${!snap.gamesLoaded
          ? html`<${SpinnerLine}>Loading your library…<//>`
          : games.length === 0
            ? html`<${Text} dimColor>No games found. (t toggles tools/software, / searches)<//>`
            : visible.map((game, i) => {
                const idx = start + i;
                const isCursor = idx === cur;
                const isSel = selected.has(game.appid);
                const name = truncate(game.name, Math.max(10, columns - 14));
                return html`
                  <${Box} key=${game.appid} gap=${1}>
                    <${Text} color="cyan" bold=${isCursor}>${isCursor ? '❯' : ' '}<//>
                    <${Text} color=${isSel ? 'green' : undefined}>${isSel ? '✓' : ' '}<//>
                    <${Text} dimColor=${!isCursor} bold=${isCursor}>${name}<//>
                    ${isCursor ? html`<${Text} dimColor>#${game.appid}<//>` : null}
                  <//>
                `;
              })}
      <//>

      <${Box} flexDirection="column" paddingX=${1}>
        <${Text}
          color=${idling.active && !idling.paused && snap.selection.length > 0 ? 'green' : 'dim'}
        >
          ${statusText}
        <//>
        <${Hints}
          items=${[
            '↑/↓ move',
            'space idle',
            'a all',
            'c clear',
            's pause',
            'r reload',
            'p status',
            't tools',
            'f shared',
            '/ search',
            'l logout',
            'q quit',
          ]}
        />
      <//>
    <//>
  `;
}
