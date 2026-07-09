# Time Tracker

Simple cross-platform desktop time tracker. Create tasks per day, run one timer
at a time, pause/resume, and browse day-wise totals. The running timer lives in
your system bar:

- **GNOME** — ticking text timer in the top bar with a Pause/Resume menu
- **macOS** — menu bar icon with the time rendered into it, click popover with controls
- **Windows** — tray icon with the time rendered into it, right-click menu

Built with **Next.js** (UI + API), **Deno `deno desktop`** (native shell,
single-binary cross-compilation), and **SQLite** (`node:sqlite`, zero native
dependencies).

## Features

- Tasks are grouped by day; navigate with ‹ / › or jump back to Today
- Adding a task today immediately starts its timer
- One running timer at a time — starting a task pauses the previous one
- Pause / resume / stop from the app, the tray menu, or the tray popover
- Edit any task's name and logged time (✎) — time edits insert a signed
  correction entry, so the original start/stop history is preserved
- Closing the window hides the app to the tray; it keeps tracking in the
  background. Reopen via the tray's "Open Time Tracker", exit via "Quit"
- Data persists in a local SQLite file:
  - Linux: `~/.local/share/time-tracker/time-tracker.db`
  - macOS: `~/Library/Application Support/time-tracker/time-tracker.db`
  - Windows: `%APPDATA%\time-tracker\time-tracker.db`

## Install

Grab the latest [release](../../releases): `TimeTracker.deb` (Linux),
`TimeTracker.msi` (Windows), or the macOS `.app` zip for your architecture.

```sh
# Linux
sudo apt install ./TimeTracker.deb
```

Linux needs a StatusNotifierItem host for the tray (Ubuntu GNOME's
AppIndicator extension is enabled by default; KDE works natively).

## Develop

Requires **Deno ≥ 2.9** and **Node 22+** (Next's build must run under Node —
see [CONTRIBUTING](CONTRIBUTING.md#gotchas)).

```sh
npm install
deno task dev        # deno desktop --hmr: native window + tray
npm run dev          # or plain Next.js dev in the browser (no tray)
```

## Build & package

```sh
deno task app              # build + bundle + run for this machine
deno task compile:deb      # dist/TimeTracker.deb
deno task compile:linux    # dist/TimeTracker.AppImage
deno task compile:win      # dist/TimeTracker.msi
deno task compile:mac      # dist/TimeTracker.app (Apple Silicon)
deno task compile:mac-intel
```

All targets cross-compile from any machine. Pushing a `v*` tag runs the
[release workflow](.github/workflows/release.yml), which builds the Windows,
macOS, and Linux packages and attaches them to a GitHub release.

See [STRUCTURE.md](STRUCTURE.md) for the codebase layout and
[CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

