# claude-code-gauges

A small desktop window that shows your Claude Code activity as it happens:

- **Live sessions**: which repos have Claude Code running right now, with status (busy / idle / `waiting: permission prompt`), title, and git branch
- **Model and effort** for each session (for example `Opus 5.5` · `max`)
- **Usage gauges**: the **Session (5h)** and **Weekly** limits as percentages with reset countdowns, plus Opus/Sonnet weekly bars when your plan reports them
- **Multiple accounts**: one tab for each linked Claude Code config directory
- **Mini mode**: a small square window with a carousel of condensed screens, including a pixel-art Claude pet that eats folders while your sessions work

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
  - **Window: min / max**: switch between the full window and the [mini window](#mini-mode)
- Gauge colors: normal below 70%, warning from 70% to 90%, critical above 90%. When a value can't be fetched the gauge shows `unknown`, a stale marker, or `Token expired, run \`claude\` to refresh`.
- Usage refreshes on the poll timer and also when the window gains focus.
- **Help**: the [built-in help](#help) explains every setting and feature.
- **Scrollbars** (max window only): the main content area and the account tab strip use narrow (4px) scrollbars with a transparent track. The thumb is hidden until you hover over the area that scrolls. Scrolling with the wheel, trackpad, or keyboard works as usual. To change the look, edit the `--scrollbar-size` and `--scrollbar-thumb` tokens in `:root` in `src/renderer/styles.css`. Mini mode doesn't scroll, so it has no scrollbars.

### Help

The app has a built-in help reference with five topics:

- **Getting started**: adding and removing accounts, and choosing which tabs and sessions to track
- **Settings reference**: what each widget toggle, the poll interval, Always on top, and the min / max window setting do
- **Features**: the usage gauges, the sessions list, and the Playground, each with the settings that affect it
- **Mini vs max**: how the two window sizes differ, how to switch, and how to move around the mini carousel
- **Glossary**: short definitions of terms such as session, config dir, effort, 5h window, weekly window, stale, and expired

How to open it:

- **Max window:** click **Help** in the header, next to **Settings**. The Help button is there in every state, including while loading, after an error, and before any account is linked. Help opens above the content and scrolls with it. Click **Done** or **Help** again to close it. Help and Settings can't be open together: opening one closes the other.
- **Mini window:** go to the **Help** screen in the carousel, or click the **?** button in the drag strip at the top. The **?** button works in every mini state, including the error and "no accounts" messages. Click **Done** or **?** again to go back to where you were. Mini help starts with a list of topics. Pick one to read it one short card at a time with the **‹** / **›** buttons, and use **Back** to return to the list. These are buttons only, so **←** / **→** still move the carousel.

Help text is built from the same constants the app uses (widget labels, poll limits, gauge thresholds, spawn rate, mini screen order), so it stays in step with the code. Whether Help is open isn't saved.

Settings, linked accounts, window mode, and the window size and position for each mode are saved to `config.json` in Electron's `userData` folder (`%APPDATA%\claude-code-gauges\` on Windows). Writes are atomic. If the file is corrupt, the app starts with the defaults.

## Mini mode

Mini mode turns the app into a small square window. It shows one condensed screen at a time, so it can sit in a corner of the screen.

### Entering and leaving mini mode

- **Enter:** open **Settings** and choose **min** (▢) under **Window**.
- **Leave:** go to the **Settings** screen in the mini carousel and choose **max** (▣). If the mini window shows an error or "no accounts" message instead of the carousel, the same toggle appears in that message.

The setting is saved as `windowMode` (`"max"` by default), so the app reopens in the mode you last used.

### Window size

- The mini window keeps a **1:1 aspect ratio** while you resize it. It opens at **400 × 400** (content size) and can shrink to **260 × 260**.
- Each mode saves its own size and position: `windowBounds` for max and `miniWindowBounds` for mini. Switching modes puts the window back where that mode was last used. Saved bounds that are off-screen are ignored.
- The full window keeps its usual limits: it opens at 420 × 640 and can shrink to 320 × 400.
- Drag the strip at the top of the mini window to move it. The strip also shows the active account's name and a **?** button that opens [Help](#help). To switch accounts, go back to max.
- Text and gauges scale with the window size, and no mini screen scrolls.

### Carousel navigation

The screens come in this order: **Gauges → Sessions → Settings → Help → Playground**. The carousel loops, so moving forward from Playground goes back to Gauges, and moving back from Gauges goes to Playground.

- **Horizontal scroll:** swipe sideways on a trackpad, or hold **Shift** and turn the mouse wheel. Each gesture moves exactly **one** screen. Wheel movement has to pass a small threshold (60 px) before the screen changes. After that there is a short cooldown (450 ms), so one long swipe can't skip several screens.
- **Arrow keys:** when the carousel has focus, **←** and **→** move one screen. They are ignored while you are typing in a text field.
- **Pager dots:** the dots at the bottom show which screen you are on. Click a dot to jump straight to that screen.

Only the current screen is mounted. The playground simulation and the settings form never run twice. Opening Help with the **?** button replaces the carousel until you close it, and you return to the screen you left.

| Screen     | Contents                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------- |
| Gauges     | 5h and weekly gauges with reset times (Opus/Sonnet bars if enabled), plus a one-line notice when data is expired, stale, or failed to load |
| Sessions   | One line per session (repo · status · model · effort). Sessions that don't fit are summarized as `+N more` |
| Settings   | The same settings as the full window, in a compact two-column layout, including the min / max toggle |
| Help       | The [help](#help) topics as a list. Pick one to page through short cards with Back and ‹ / › buttons. The **?** button in the drag strip opens the same help from any state |
| Playground | The pet playground (mini mode only)                                                          |

### Pet playground

The **Playground** screen exists **only in mini mode**. The full window never shows it.

- A pixel-art Claude pet (in Claude orange) walks around a pixelated canvas. Folder icons appear at random spots, and the pet heads for the **nearest folder** and eats it when it reaches it. A counter shows how many folders it has eaten. When there are no folders, the pet wanders.
- At most **12 folders** can be on screen at once. When the cap is reached, no more spawn until the pet eats one.
- The animation runs only while the Playground screen is showing and the window is visible. It stops when you move to another screen and pauses when the window is hidden. If your OS has **reduced motion** turned on, the pet moves and animates more slowly.

**Spawn rate.** How often folders appear depends on how hard Claude is working:

- Only **active** sessions count. A session is active when its status is **`busy`**, meaning Claude is working on a turn. Idle, waiting (for input or a permission prompt), and unknown sessions don't count.
- Each active session adds weight based on its effort: `low` = 1, `medium` = 2, `high` = 3, `max` = 4. A missing or unrecognized effort counts as 2.
- The time between spawns is `12 s ÷ (total weight of busy sessions)`, kept between **1 s and 12 s**.
- With **no busy sessions, no folders spawn**.

For example, one busy `max` session spawns a folder every 3 s. Two busy `high` sessions plus one busy `low` session (total weight 7) spawn one about every 1.7 s.

The rule is implemented in `folderSpawnIntervalMs` in `src/renderer/mini/spawn-rate.ts`.

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
 │  store ─► App ─┬─ max:  AccountTabs · SessionPicker · SessionList ·      │
 │                │        UsageGauge · SettingsPanel · HelpPanel           │
 │                └─ mini: MiniApp ─► Carousel ─► compact UsagePanel ·      │
 │                         compact SessionList · compact SettingsPanel ·    │
 │                         compact HelpPanel · Playground (canvas)          │
 │                         (drag-strip "?" ─► compact HelpPanel)            │
 │  help-content.ts (topics as typed data) ─► HelpPanel                     │
 └──────────────────────────────────────────────────────────────────────────┘
```

- **The main process owns all I/O**: file reads and watching, HTTP polling, and credentials. It pushes typed `AccountSnapshot`s to the renderer.
- The **renderer only displays data**. It runs with `contextIsolation: true` and `nodeIntegration: false`, and can reach main only through the `window.gauges` bridge.
- **Window modes**: `App` renders `MiniApp` when `config.windowMode === 'mini'`, and the usual layout otherwise. Switching modes is an ordinary `setConfig({ windowMode })` call. In main, `applyWindowConfig` notices the mode change and applies that mode's geometry (aspect-ratio lock, minimum size, saved or default bounds). It uses `windowGeometryForMode` from `src/main/window-mode.ts`. Bounds are saved under `boundsKeyForMode(mode)`.
- **Mini logic is kept apart from the DOM**: carousel index and wheel math, the spawn rate, the pet simulation, and the sprites live in plain `.ts` modules with no DOM types. They are unit-tested in Vitest's node environment. Only `Carousel.tsx` and `Playground.tsx` touch the DOM (wheel listener, `requestAnimationFrame`, canvas, `ResizeObserver`).
- **Help is data plus one component**: `src/renderer/help-content.ts` holds the help topics (`HELP_TOPICS`) as typed data built from the app's own constants (`WIDGET_OPTIONS`, poll limits, `USAGE_THRESHOLDS`, spawn-rate values, `MINI_SCREEN_IDS`). `components/HelpPanel.tsx` renders all of it in max, or a topic index plus paged cards when `compact`. The paging logic lives in `help-paging.ts`. Open/closed state is local React state, so Help needs no config, IPC, or main-process changes.
- Types shared by all three layers live in `src/shared/types.ts`. IPC channel names live in one place, `src/shared/ipc-channels.ts`.
- Every source is fault-tolerant:
  - A malformed JSONL line is skipped.
  - A missing file means "no data".
  - An API failure sets a `stale`/`error`/`expired` status on the gauge instead of throwing.

```
src/
  main/       index.ts (window, lifecycle, mode switching), ipc.ts,
              config-store.ts, window-mode.ts (per-mode geometry/bounds key),
              account-monitor.ts, aggregator.ts
  main/sources/  account-reader.ts, sessions-registry.ts,
                 transcript-tail.ts, usage-api.ts
  preload/    index.ts (contextBridge API), index.d.ts
  renderer/   App.tsx (header Help / Settings buttons), store.ts, api.ts,
              styles.css, theme.ts, components/ (incl. HelpPanel.tsx), utils/
              help-content.ts    help topics as typed data (HELP_TOPICS)
              help-paging.ts     compact help: topic index + card paging
  renderer/mini/
              MiniApp.tsx        mini shell: drag strip ("?" help), state messages, screen list
              screen-ids.ts      MINI_SCREEN_IDS (carousel order)
              Carousel.tsx       infinite carousel: wheel, arrow keys, pager dots, ARIA
              carousel-logic.ts  nextIndex wrap, visibleSlots, wheel-gesture reducer
              Playground.tsx     canvas + rAF loop, resize, visibility/reduced-motion
              playground-sim.ts  pure pet/folder simulation (injectable rng)
              spawn-rate.ts      effortWeight, folderSpawnIntervalMs
              sprites.ts         pixel-art pet/folder sprites, drawSprite
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
