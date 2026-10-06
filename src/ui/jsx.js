import React from 'react';
import htm from 'htm';

/**
 * Tagged-template JSX alternative so this app needs no build/transpile step.
 * Usage:  html`<${Box}><${Text} bold>hi<//><//>`
 */
export const html = htm.bind(React.createElement);
export { React };
