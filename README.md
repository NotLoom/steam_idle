# Steam Hour Idler

A clean and simple terminal-based Steam hour idler. Sign in with a QR code or
your account name + password (with Steam Guard support), pick the games you
want to idle from your library, and this app reports them as "playing" to
Steam so playtime accrues while it runs.

Built with [ink](https://github.com/vadimdemedes/ink) (terminal UI),
[node-steam-user](https://github.com/DoctorMcKay/node-steam-user) and
[node-steam-session](https://github.com/DoctorMcKay/node-steam-session).
No build step, no bundler — plain modern Node.js.

## Requirements

- Node.js ≥ 22
- A Steam account (yours — this tool is for idling your own library)

## Setup

```sh
npm install
npm start
```

On first launch you get a QR code — open the Steam mobile app and scan it,
then approve the sign-in. Or press `p` to log in with your account name and
password instead (email/authenticator Steam Guard codes are supported).

## Keys

**Login screen**

| Key | Action |
| --- | --- |
| `p` | Switch to password login |
| `r` | Generate a fresh QR code (it also auto-refreshes every ~2 min) |
| `esc` | Cancel the current login attempt |
| `↑/↓`, `enter`, `space` | Navigate the password form / toggle remember-me |
| `q` / `ctrl+c` | Quit (stops idling and logs off cleanly) |

**Library screen**

| Key | Action |
| --- | --- |
| `↑/↓` or `j/k`, `pgup/pgdn` | Move the cursor |
| `space` / `enter` | Check/uncheck the game under the cursor — checked games idle immediately |
| `a` / `c` | Select all (filtered) / clear selection |
| `s` | Pause / resume idling (selection is kept) |
| `r` | Reload your game list if it ever fails to load |
| `p` | Cycle your online status: Online → Away → Invisible |
| `t` | Toggle showing tools/software in addition to games |
| `f` | Toggle including family-shared games |
| `/` | Search by name or AppID (`enter` accepts, `esc` clears) |
| `l` | Log out (also forgets the saved login) |
| `q` / `ctrl+c` | Quit |

## Behaviour

- Your selection, status, filters and login session are remembered in
  `~/.config/steam-hour-idler/config.json`, so the next launch signs in
  automatically and (by default) resumes idling the selected games.
- Up to 32 games can be reported as playing at once (Steam's own limit);
  extra selections are ignored with a notice.
- Steam counts playtime only while this app is running — keep the terminal
  open (a detached `tmux`/`screen` session works well).
- If Steam shows a "playing elsewhere" conflict (e.g. you launch the real
  Steam client and play the same game), the app surfaces a notice.

## Security notes

- Your password is never written to disk or logged. After a successful login
  the app stores only a **refresh token** (a long-lived, revocable session
  token — the same mechanism the official Steam client uses) in the config
  file, which is written with `0600` permissions.
- Anyone who can read that file can sign in as you, so treat it like a
  password. You can revoke sessions at any time from Steam → Account
  Settings → sign out of all other devices, or simply use `--reset` /
  press `l` in the app to forget the saved login locally.
- Uncheck "Remember me" on the password form if you prefer not to persist a
  token at all.

## CLI options

```
--reset     Forget the saved login and selection
--big-qr    Render the login QR code in the larger (non-half-block) style
--debug     Verbose Steam logs, no alternate screen
-h, --help  Show help
-v, --version
```

The QR code is rendered with half-block characters, which fits standard
terminal fonts. If your phone struggles to scan it (unusual font aspect
ratio), run `npm start -- --big-qr` for the larger style.

## Development

```sh
npm test                      # unit tests for the pure helpers
npm run smoke                 # start a real QR session and print it (no account needed)
node --check src/steam.js     # syntax check
```

`npm run smoke` is handy for validating the Steam login path before touching
your own account: it prints a scannable QR code and waits for you to scan it.

## Project layout

```
src/
  index.js          entry point, CLI flags, clean shutdown
  config.js         on-disk config (~/.config/steam-hour-idler/config.json)
  steam.js          SteamService: auth, library, idling, persona, reconnects
  helpers.js        pure helpers (filtering, sorting, durations, guard prompts)
  ui/               ink components (app, login view, games view)
scripts/qr-smoke.js standalone QR login smoke test
test/               node:test unit tests
```

## Disclaimer

Idling games to accrue playtime is a widely used, tolerated practice (see
ArchiSteamFarm et al.), but it is not an officially endorsed use of Steam.
Use at your own risk.
