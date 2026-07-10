# Project structure

```
time-tracker/
├── deno.json                  # deno desktop config (app metadata, icons, backend) + tasks
├── package.json               # Next.js deps; Next's build runs under Node
├── next.config.mjs            # must stay .mjs (see CONTRIBUTING gotchas)
├── instrumentation.ts         # Next server-boot hook → starts the tray under deno desktop
│
├── app/                       # Next.js App Router (UI + API)
│   ├── layout.tsx             # fonts (Sora + Spline Sans Mono), global shell
│   ├── globals.css            # design tokens & all styling
│   ├── page.tsx               # dashboard: day nav, add task, task rows, edit mode, Copy CSV
│   ├── OptionPicker.tsx       # typeahead select whose list you can add to / remove from
│   ├── panel/page.tsx         # compact popover UI shown from the tray (mac/win)
│   └── api/
│       ├── tasks/route.ts     # GET ?day= list · POST create (start:true auto-starts)
│       ├── tasks/[id]/route.ts# PATCH name/project/category/totalMs · DELETE
│       ├── options/route.ts   # GET all · POST add · DELETE ?kind=&value=
│       ├── export/route.ts    # GET ?day= → the day's activity as CSV
│       └── timer/route.ts     # GET state · POST start/pause/resume/stop
│
├── lib/
│   ├── db.ts                  # node:sqlite; schema, queries, timer logic, time adjustment
│   ├── csv.ts                 # RFC 4180 CSV of a day's tasks; ms → hh:mm
│   └── time.ts                # format/parse durations, day arithmetic
│
├── extension/                 # Chrome MV3 extension — see extension/README.md
│   ├── popup.js               # name setup, CSV paste/parse/preview
│   └── background.js          # service worker: drives the Fillout timesheet form
│
├── desktop/                   # native-shell integration (runs inside deno desktop only)
│   ├── tray.ts                # entry: window lifecycle (hide-to-tray) + platform routing
│   ├── tray-linux.ts          # DBus StatusNotifierItem + dbusmenu (dbus-next);
│   │                          #   XAyatanaLabel = text timer in GNOME top bar
│   ├── single-instance.ts     # DBus well-known name; 2nd launch raises the 1st and exits
│   └── icon-text.ts           # pure-TS PNG encoder + bitmap font → tray icons (mac/win)
│
├── icons/
│   ├── repeat.png             # app icon source (512×512)
│   └── app.ico                # generated for Windows — node scripts/png2ico.mjs
├── scripts/
│   ├── png2ico.mjs            # regenerates icons/app.ico from icons/repeat.png
│   ├── deb-version.mjs        # stamps package.json's version into the .deb
│   │                          #   (deno desktop hardcodes 1.0.0)
│   └── win/installer.iss      # Inno Setup script — replaces deno's unusable .msi
│
└── .github/workflows/
    └── release.yml            # tag v* → build Setup.exe / .deb / mac .app zips → GitHub release
```

## Data model (SQLite)

```sql
tasks(id, name, day 'YYYY-MM-DD', project, category, created_at)
time_entries(id, task_id → tasks ON DELETE CASCADE, started_at, stopped_at NULL)
options(id, kind 'project'|'category', value, created_at, UNIQUE(kind, value))
meta(key, value)
```

- Running timer = the single entry with `stopped_at IS NULL`
- Task total = `SUM(COALESCE(stopped_at, now) - started_at)` over its entries
- Pause closes the entry; resume opens a new one
- Manual time edits insert a correction entry whose duration is the signed
  delta (`stopped_at` may be before `started_at`) — history is never rewritten
- A task's project/category are plain text copies, not foreign keys, so
  removing an option never touches tasks that already used it
- `options` is seeded with the timesheet form's projects/categories once,
  guarded by `meta['options_seeded']` so deleted ones stay deleted

## Timesheet handoff

`Copy CSV` → `GET /api/export?day=` → clipboard → the `extension/` popup →
autofilled Fillout form. CSV is the only contract between the two; the
extension never talks to the tracker's server.

## Runtime shape

One process: `deno desktop` runs the embedded Next.js server (port from
`DENO_SERVE_ADDRESS`), the native window (OS webview), and the tray. The tray
calls `lib/db.ts` directly — same process, no HTTP hop. UI polls
`/api/timer` / `/api/tasks` (1s tick render, 3–5s re-fetch).
