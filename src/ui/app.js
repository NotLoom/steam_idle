import { Box, Text } from 'ink';

import { SpinnerLine } from './components.js';
import { html, React } from './jsx.js';
import GamesView from './games-view.js';
import LoginView from './login-view.js';

/**
 * Root component: routes between boot / login / games views and keeps a
 * snapshot of the SteamService state. Unmounting (quit) shuts the service
 * down cleanly (stops idling + logs off).
 */
export function App({ service }) {
  const [snap, setSnap] = React.useState(() => service.getState());

  React.useEffect(() => {
    const onState = (state) => setSnap(state);
    service.on('state', onState);
    return () => service.off('state', onState);
  }, [service]);

  React.useEffect(() => () => service.shutdown(), [service]);

  if (snap.view === 'games') {
    return html`<${GamesView} service=${service} snap=${snap} />`;
  }
  if (snap.view === 'login') {
    return html`<${LoginView} service=${service} snap=${snap} />`;
  }
  // boot
  return html`
    <${Box}
      height="100%"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      gap=${1}
    >
      <${Text} bold color="cyan">Steam Hour Idler<//>
      ${snap.status === 'error'
        ? html`<${Text} color="red">${snap.statusDetail ?? 'Something went wrong.'}<//>`
        : html`<${SpinnerLine}>${snap.statusDetail ?? 'Connecting to Steam…'}<//>`}
    <//>
  `;
}
