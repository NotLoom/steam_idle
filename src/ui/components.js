import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';

import { html } from './jsx.js';

export function TitleBar({ left, right }) {
  return html`
    <${Box} borderStyle="round" borderColor="cyan" paddingX=${1} justifyContent="space-between">
      <${Text} bold color="cyan">${left}<//>
      ${right ?? null}
    <//>
  `;
}

export function SpinnerLine({ children }) {
  return html`
    <${Text}>
      <${Text} color="cyan"><${Spinner} type="dots" /><//> ${children}
    <//>
  `;
}

export function Field({ label, focus, mask, placeholder, value, onChange, onSubmit }) {
  return html`
    <${Box}>
      <${Box} width=${14}>
        <${Text} dimColor=${!focus} bold=${focus}>${label}<//>
      <//>
      <${TextInput}
        value=${value}
        placeholder=${placeholder}
        mask=${mask}
        focus=${focus}
        onChange=${onChange}
        onSubmit=${onSubmit}
      />
    <//>
  `;
}

export function CheckboxRow({ label, checked, focused }) {
  return html`
    <${Box} gap=${1}>
      <${Text}>${focused ? '›' : ' '}<//>
      <${Text} color=${checked ? 'green' : undefined}>[${checked ? '✓' : ' '}]<//>
      <${Text} dimColor=${!focused} bold=${focused}>${label}<//>
    <//>
  `;
}

export function ErrorText({ children }) {
  return children ? html`<${Text} color="red">✗ ${children}<//>` : null;
}

export function Hints({ items }) {
  return html`<${Text} dimColor>${items.join('  ·  ')}<//>`;
}
