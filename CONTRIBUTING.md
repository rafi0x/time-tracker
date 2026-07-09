# Contributing

Thanks for helping out! This is a small app with an unusual stack
(Next.js served from inside a `deno desktop` binary), so please read the
gotchas below before changing build config.

## Setup

Requirements: **Deno ≥ 2.9**, **Node 22+**, npm.

```sh
git clone <repo>
cd time-tracker
npm install
deno task dev        # native window + tray, HMR
```

`npm run dev` also works for pure UI work in a browser — the tray code is
skipped automatically when not running under Deno.

## Making changes

- UI and API live in `app/`; shared logic in `lib/`; native-shell code in
  `desktop/`. See [STRUCTURE.md](STRUCTURE.md).
- Keep `lib/db.ts` the single owner of SQL. The tray imports it directly;
  the UI goes through the API routes.
- Time edits must never rewrite existing `time_entries` rows — insert
  correction entries instead (see `adjustTaskTime`).
- Before opening a PR, verify the packaged app still works:
  `deno task app`, create a task, restart, confirm persistence and tray.

## Gotchas (hard-won — don't "clean these up")

- **`next build` must run under Node**, not Deno: prerendering crashes with a
  `useContext` null error under the Deno runtime. That's why the `build` task
  is `node node_modules/next/dist/bin/next build`.
- **`deno.json` must keep `"nodeModulesDir": "manual"`** — letting Deno manage
  `node_modules` duplicates React and breaks the build even under Node
  afterwards (fix: `rm -rf node_modules && npm install`).
- **`next.config` must stay `.mjs`** — a `.ts` config makes `next start` load
  native SWC at runtime, which crashes inside the compiled binary.
- **`Deno.Tray` is a stub on Linux** in deno desktop's backend (laufey 0.5.0):
  `trayId` stays 0 and nothing registers on DBus. `desktop/tray-linux.ts`
  implements StatusNotifierItem + com.canonical.dbusmenu manually via
  `dbus-next`. Re-test before assuming a Deno upgrade fixed it.
- **Compile permissions are baked in** — every `deno desktop` task needs `-A`.
- **Don't add `--exclude-unused-npm`** — Next.js requires packages dynamically
  at runtime, invisible to Deno's module graph; the binary breaks.
- `dbus-next` must stay in `serverExternalPackages` in `next.config.mjs`
  (webpack bundling breaks its dynamic requires).

## Icons

App icon source is `icons/repeat.png` (512×512). After replacing it, regenerate
the Windows icon: `node scripts/png2ico.mjs`.

## Releases

Push a tag like `v0.2.0` — the [release workflow](.github/workflows/release.yml)
cross-compiles the Windows `.msi`, macOS `.app` zips (arm64 + x64), and Linux
`.deb`, and attaches them to a GitHub release.

## Commit style

Conventional Commits (`feat:`, `fix:`, `docs:`, …), subject ≤ 50 chars,
body only when the "why" isn't obvious.
