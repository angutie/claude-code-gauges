# claude-code-gauges

A small desktop window that shows your Claude Code activity as it happens:

- **Live sessions**: which repos have Claude Code running right now, with status (busy / idle / `waiting: permission prompt`), title, and git branch
- **Model and effort** for each session (for example `Opus 5.5` · `max`)
- **Usage gauges**: the **Session (5h)** and **Weekly** limits as percentages with reset countdowns, plus Opus/Sonnet weekly bars when your plan reports them
- **Multiple accounts**: one tab for each linked Claude Code config directory

It is built with Electron, React, and TypeScript, and has been tested on Windows 11.

## Prerequisites

- **Node.js 22** (developed on v22.14.0) and npm 10+
- **Claude Code** installed, with each account signed in at least once (`claude` → `/login`)
- Windows or Linux. Both keep credentials in `<configDir>/.credentials.json`. macOS keeps them in the Keychain, and that is not supported yet (see [Caveats](#caveats)).

## Getting started

```sh
npm install        # install dependencies (downloads the Electron binary)
npm run dev        # start the app with hot reload (electron-vite dev)
```

### Scripts

| Command             | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `npm run dev`       | Starts Electron in dev mode with renderer HMR                       |
| `npm run build`     | Type-checks, then bundles main/preload/renderer into `out/`         |
| `npm run preview`   | Runs the built app from `out/`                                      |
| `npm test`          | Runs the Vitest suite once (`vitest run`)                           |
| `npm run test:watch`| Runs Vitest in watch mode                                           |
| `npm run typecheck` | Runs strict `tsc --noEmit` on the node (main/preload) and web (renderer) projects |

Packaging into an installer (electron-builder) isn't set up yet. Use `npm run build && npm run preview` to run a production bundle.

## Using the app

- **Account tabs** across the top list one tab per linked account. Each tab shows the custom label if one is set, otherwise the account's email.
- **Session picker**: pick **All sessions** (the default) or tick individual live sessions to watch. The choice is saved per account.
- **Settings**:
  - Show or hide each widget: sessions, model, effort, 5h gauge, weekly gauge, branch, status
  - Usage poll interval, limited to **60–600 s** (default 90 s)
  - **Always on top**
- Gauge colors: normal below 70%, warning from 70% to 90%, critical above 90%. When a value can't be fetched the gauge shows `unknown`, a stale marker, or `Token expired, run \`claude\` to refresh`.
- Usage refreshes on the poll timer and also when the window gains focus.

Settings, linked accounts, and window size and position are saved to `config.json` in Electron's `userData` folder (`%APPDATA%\claude-code-gauges\` on Windows). Writes are atomic. If the file is corrupt, the app starts with the defaults.

## Linking multiple accounts

Claude Code keeps each account in a **config directory**:

- **Default:** `~/.claude`. Its identity file is `~/.claude.json` (in your home folder, next to the directory).
- **Custom:** any folder chosen with the `CLAUDE_CONFIG_DIR` environment variable. In this case `.claude.json` sits **inside** the folder.

On first run the app links one account. It uses `CLAUDE_CONFIG_DIR` if that is set, and `~/.claude` if not.

To add a second account (for example a work account):

1. Create a config dir for it and sign in with Claude Code pointed at that dir:

   ```powershell
   # PowerShell
   $env:CLAUDE_CONFIG_DIR = "$HOME\.claude-work"; claude
   ```

   ```sh
   # bash / Git Bash
   CLAUDE_CONFIG_DIR=~/.claude-work claude
   ```

   Run `/login` and sign in with the other account. This creates `~/.claude-work/.credentials.json`.

2. In claude-code-gauges, click **Add account** and choose that folder. The app checks that the folder exists and contains a readable `.credentials.json`. If it doesn't, the app shows an error inline.

3. Always start Claude Code for that account with the same `CLAUDE_CONFIG_DIR`. That way its sessions are written to that folder, and they appear under that account's tab.

To remove an account, click its tab's remove button and confirm. Your Claude Code files are never touched.

## Data sources

Everything is read-only. The app never writes to a Claude Code config directory.

| Data                           | Source                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| Running sessions, status, title | `<configDir>/sessions/<pid>.json`, one file per running Claude Code process. Files whose PID is no longer alive are ignored, and `*.key` files are skipped. |
| Repo name                      | `basename(cwd)` from the session file                                                      |
| Model, effort, git branch      | The session transcript `<configDir>/projects/<encoded-cwd>/<sessionId>.jsonl`. The app tail-reads it from a saved byte offset and uses the last non-sidechain `assistant` line (`message.model`, `effort`/`perTurnEffort`, `gitBranch`). `custom-title`/`agent-name` lines supply the title. |
| Effort fallback                | `effortLevel` in `<configDir>/settings.json`, used when a session has no assistant turn yet |
| Account label                  | `oauthAccount` (email, organization, display name) in `.claude.json`                       |
| Access token, plan             | `claudeAiOauth` in `<configDir>/.credentials.json`                                         |
| 5h / weekly usage              | `GET https://api.anthropic.com/api/oauth/usage` (see caveats). Uses the `five_hour`, `seven_day`, `seven_day_opus`, and `seven_day_sonnet` windows, each `{ utilization, resets_at }`. |

## Architecture

```
 ┌────────────────────────── main process (Node) ───────────────────────────┐
 │  config-store ── AppConfig (userData/config.json)                        │
 │                                                                          │
 │  per account: AccountMonitor                                             │
 │    ├─ chokidar: sessions/*.json + watched transcripts (300 ms debounce)  │
 │    ├─ 5 s safety rescan (PID liveness)                                   │
 │    ├─ UsagePoller (poll interval + exponential backoff on 429/errors)    │
 │    └─ aggregator ← account-reader, sessions-registry,                    │
 │                    transcript-tail, usage-api                            │
 │             │ AccountSnapshot (no secrets)                               │
 └─────────────┼────────────────────────────────────────────────────────────┘
               │ IPC  (webContents.send / ipcMain.handle)
 ┌─────────────┼──────── preload (contextBridge) ───────────────────────────┐
 │  window.gauges: getConfig, setConfig, getSnapshots, addAccount,          │
 │                 removeAccount, setActiveAccount, refreshUsage,           │
 │                 onSnapshot, onConfigChanged                              │
 └─────────────┼────────────────────────────────────────────────────────────┘
 ┌─────────────▼──────── renderer (React, display only) ────────────────────┐
 │  store ─► App ─► AccountTabs · SessionPicker · SessionList ·             │
 │                  UsageGauge · SettingsPanel                              │
 └──────────────────────────────────────────────────────────────────────────┘
```

- **The main process owns all I/O**: file reads and watching, HTTP polling, and credentials. It pushes typed `AccountSnapshot`s to the renderer.
- The **renderer only displays data**. It runs with `contextIsolation: true` and `nodeIntegration: false`, and can reach main only through the `window.gauges` bridge.
- Types shared by all three layers live in `src/shared/types.ts`. IPC channel names live in one place, `src/shared/ipc-channels.ts`.
- Every source is fault-tolerant:
  - A malformed JSONL line is skipped.
  - A missing file means "no data".
  - An API failure sets a `stale`/`error`/`expired` status on the gauge instead of throwing.

```
src/
  main/       index.ts (window, lifecycle), ipc.ts, config-store.ts,
              account-monitor.ts, aggregator.ts
  main/sources/  account-reader.ts, sessions-registry.ts,
                 transcript-tail.ts, usage-api.ts
  preload/    index.ts (contextBridge API), index.d.ts
  renderer/   App.tsx, store.ts, api.ts, styles.css, theme.ts,
              components/, utils/
  shared/     types.ts, ipc-channels.ts
tests/        Vitest unit tests + sanitized fixtures (fake tokens only)
```

## Caveats

### Undocumented usage endpoint
- `/api/oauth/usage` is the **internal, undocumented** endpoint that Claude Code itself calls, with the `anthropic-beta: oauth-2025-04-20` header. Anthropic can change or remove it at any time without notice. The same goes for the on-disk formats under `~/.claude`, which change with Claude Code versions.
- The app keeps this endpoint behind an adapter (`src/main/sources/usage-api.ts`) and parses the response defensively. Fields it doesn't recognize show as `unknown`.
- Polling is deliberately gentle, at 60–600 s. The app backs off exponentially (up to 30 min) on 429 and network errors and honors `Retry-After`. Please don't lower these limits.

### Token handling
- The app **reuses the OAuth access token Claude Code already stored** in `.credentials.json`. It reads the file again before each poll, so it always has the token the CLI last refreshed.
- The app **never refreshes tokens itself**, because a refresh could invalidate the CLI's copy. When the token expires (or the API returns 401), the gauge shows *Token expired, run `claude` to refresh*. Starting any Claude Code session for that account fixes it.
- Tokens stay in the main process:
  - They never go into snapshots, IPC messages, the renderer, or `config.json`.
  - The token property is non-enumerable, so it can't leak into logs or serialized objects.
  - Request headers are never logged.
- Test fixtures use fake tokens only. Never commit a real `.credentials.json`.
- This is an unofficial tool, not affiliated with Anthropic. Use it at your own risk.
