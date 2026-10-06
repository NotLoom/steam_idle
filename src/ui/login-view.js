import { Box, Text, useApp, useInput } from 'ink';

import { guardPrompt } from '../helpers.js';
import { CheckboxRow, ErrorText, Field, Hints, SpinnerLine } from './components.js';
import { html, React } from './jsx.js';

/**
 * Login screen: QR code pane, username/password pane (with remember-me) and
 * the Steam Guard step. Which pane is shown follows the service's login state.
 */
export default function LoginView({ service, snap }) {
  const { exit } = useApp();
  const L = snap.login;
  const [account, setAccount] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [code, setCode] = React.useState('');
  const [focusIndex, setFocusIndex] = React.useState(0);

  // Start the QR flow when we land here with no attempt in progress
  // (first launch without a saved token, or after logout).
  React.useEffect(() => {
    if (!L.mode && !L.guardTypes.length && snap.status !== 'connecting') {
      service.startQrLogin();
    }
    // Run once on mount; the service drives everything afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onGuard = L.guardTypes.length > 0;

  // Keys on the QR pane.
  useInput(
    (input, key) => {
      if (input === 'p') service.showCredentialForm();
      else if (input === 'r') service.startQrLogin();
      else if (key.escape) service.cancelLogin();
      else if (input === 'q') exit();
    },
    { isActive: L.mode === 'qr' },
  );

  // Keys on the username/password pane (text inputs ignore ↑/↓/esc).
  useInput(
    (input, key) => {
      if (key.upArrow) setFocusIndex((i) => (i + 2) % 3);
      else if (key.downArrow) setFocusIndex((i) => (i + 1) % 3);
      else if (key.return) {
        if (focusIndex === 0) setFocusIndex(1);
        else if (focusIndex === 1) submitCredentials();
        else service.setRemember(!L.remember);
      } else if (input === ' ' && focusIndex === 2) {
        service.setRemember(!L.remember);
      } else if (key.escape) {
        service.startQrLogin();
      }
    },
    { isActive: L.mode === 'credentials' && !L.pending },
  );

  // Keys on the Steam Guard pane.
  useInput(
    (input, key) => {
      if (key.escape) service.cancelLogin();
    },
    { isActive: onGuard },
  );

  function submitCredentials() {
    if (!account.trim() || !password) return;
    service.startCredentialLogin(account.trim(), password);
  }

  const showConnecting = snap.status === 'connecting' && !L.mode && !onGuard;
  let pane;
  if (showConnecting) {
    pane = html`<${SpinnerLine}>Signing in…<//>`;
  } else if (L.mode === 'qr') {
    pane = html`
      <${Box} flexDirection="column" alignItems="center" gap=${1}>
        <${Text} bold>Scan with the Steam mobile app<//>
        ${L.qr ? html`<${Text}>${L.qr}<//>` : html`<${SpinnerLine}>Generating QR code…<//>`}
        ${L.qrScanned
          ? html`<${Text} color="green">✓ Scanned — approve the sign-in on your phone<//>`
          : html`<${Text} dimColor>Steam app → scan the QR code<//>`}
        <${Text} dimColor>refreshes automatically · r: new code · p: password login · esc: cancel<//>
      <//>
    `;
  } else if (onGuard) {
    const prompt = guardPrompt(L.guardTypes);
    pane = html`
      <${Box} flexDirection="column" gap=${1}>
        <${Text} bold>Steam Guard<//>
        ${prompt.instruction ? html`<${Text}>${prompt.instruction}<//>` : null}
        ${prompt.alts.map((alt) => html`<${Text} key=${alt} dimColor>${alt}<//>`)}
        ${L.guardPending
          ? html`<${SpinnerLine}>Verifying…<//>`
          : prompt.codeNeeded
            ? html`<${Field}
                label="Code"
                focus
                value=${code}
                placeholder="12345"
                onChange=${setCode}
                onSubmit=${() => service.submitGuardCode(code)}
              />`
            : html`<${SpinnerLine}>Waiting for approval…<//>`}
        <${ErrorText}>${L.error}<//>
        <${Hints} items=${['esc: cancel']} />
      <//>
    `;
  } else {
    pane = html`
      <${Box} flexDirection="column" gap=${1}>
        <${Text} bold>Sign in with account name and password<//>
        <${Field}
          label="Account"
          focus=${focusIndex === 0}
          value=${account}
          placeholder="account name"
          onChange=${setAccount}
          onSubmit=${() => setFocusIndex(1)}
        />
        <${Field}
          label="Password"
          focus=${focusIndex === 1}
          value=${password}
          mask="*"
          placeholder="password"
          onChange=${setPassword}
          onSubmit=${submitCredentials}
        />
        <${CheckboxRow}
          label="Remember me on this computer"
          checked=${L.remember}
          focused=${focusIndex === 2}
        />
        ${L.pending ? html`<${SpinnerLine}>Signing in…<//>` : null}
        <${ErrorText}>${L.error}<//>
        <${Hints}
          items=${['↑/↓ select', 'enter next/submit', 'space toggle', 'esc: QR login']}
        />
      <//>
    `;
  }

  return html`
    <${Box}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      width="100%"
      height="100%"
      gap=${1}
    >
      <${Text} bold color="cyan">Steam Hour Idler<//>
      <${Box} flexDirection="column" width=${66} paddingX=${2} paddingY=${1} borderStyle="round">
        ${pane}
      <//>
      <${Text} dimColor>qr login needs a terminal around 40 rows tall — enlarge the window if it is clipped<//>
    <//>
  `;
}
