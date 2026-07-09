// System tray integration. Runs only inside `deno desktop` (guarded by the
// caller in instrumentation.ts).
//
// - macOS / Windows: native Deno.Tray with the timer rendered into the icon
//   as text, plus a click popover panel and a context menu.
// - Linux: laufey (deno desktop's backend, v0.5.0) stubs Deno.Tray out, so we
//   register a DBus StatusNotifierItem ourselves (see tray-linux.ts). On
//   Ubuntu/GNOME this shows a ticking text timer in the top bar.

import { getTimerState, startTimer, stopTimer } from "../lib/db";
import { renderIdleIcon, renderTextIcon, trayTimeText } from "./icon-text";

// Deno desktop APIs are not in Next's TS types; access through globalThis.
const D = (globalThis as Record<string, any>).Deno;

function serverPort(): string {
  // deno desktop exposes the embedded server address as "tcp:127.0.0.1:<port>"
  const addr = D.env.get("DENO_SERVE_ADDRESS") ?? "";
  const port = addr.split(":").pop();
  return port || D.env.get("PORT") || "3000";
}

let keepAlive: any = null;
let mainWin: any = null;

// The runtime exits as soon as its last window is destroyed, and the titlebar
// close is not interceptable: the native closeRequested arrives as a
// non-cancelable "close" Event, so preventDefault() cannot save the window.
// Instead a second window is held open, hidden, for the life of the process.
//
// Order matters. deno desktop opens one window at startup that stays hidden
// until something navigates it, and the *first* BrowserWindow construction
// binds to that window instead of making a new one. So the main window has to
// be built first (it claims the startup window and navigating it is what puts
// the app on screen); the keepalive is built second and hidden straight away.
// Never navigating the keepalive means it never spawns a web process.
function ensureKeepAlive(): void {
  if (keepAlive) return;
  try {
    keepAlive = new D.BrowserWindow({ title: "Time Tracker", width: 1, height: 1 });
    keepAlive.hide();
  } catch (err) {
    keepAlive = null;
    console.warn("[tray] keepalive window unavailable; closing the window will quit:", err);
  }
}

function createWindow(): any {
  const win = new D.BrowserWindow({ title: "Time Tracker", width: 720, height: 640 });
  win.navigate(`http://127.0.0.1:${serverPort()}/`);

  // Closing destroys the window, so drop the handle and build a fresh one when
  // the tray asks for it again. The app itself lives on in the tray.
  win.addEventListener("close", () => {
    mainWin = null;
  });
  return win;
}

export function openMainWindow(): void {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mainWin ??= createWindow();
      mainWin.show();
      mainWin.focus();
      ensureKeepAlive(); // only ever after a real window exists
      return;
    } catch (err) {
      mainWin = null; // destroyed behind our back; rebuild once
      if (attempt > 0) console.warn("[tray] could not open window:", err);
    }
  }
}

export async function startTray(): Promise<void> {
  if (D.build.os === "linux") {
    // Claims the single-instance lock before opening a window, so a duplicate
    // launch never flashes one up.
    const { startLinuxTray } = await import("./tray-linux");
    await startLinuxTray(openMainWindow);
    return;
  }
  openMainWindow();
  startNativeTray();
}

function startNativeTray(): void {
  const tray = new D.Tray();
  const port = serverPort();
  let lastText = "";
  let lastTaskId: number | null = null;
  let menuRunning: boolean | null = null;

  const idleLight = renderIdleIcon({ color: [40, 40, 40] });
  const idleDark = renderIdleIcon({ color: [235, 235, 235] });

  function updateMenu(running: boolean, hasTask: boolean) {
    if (menuRunning === running) return;
    menuRunning = running;
    tray.setMenu([
      { item: { id: "open", label: "Open Time Tracker", enabled: true } },
      running
        ? { item: { id: "pause", label: "Pause timer", enabled: true } }
        : { item: { id: "resume", label: "Resume last task", enabled: hasTask } },
      { item: { id: "quit", label: "Quit", enabled: true } },
    ]);
  }

  function update() {
    const state = getTimerState();
    if (state.taskId) lastTaskId = state.taskId;

    if (state.running) {
      const text = trayTimeText(state.elapsedMs);
      if (text !== lastText) {
        lastText = text;
        // icon = for light bars, iconDark = variant shown on dark bars
        tray.setIcon(renderTextIcon(text, { color: [40, 40, 40] }));
        tray.setIconDark?.(renderTextIcon(text, { color: [235, 235, 235] }));
      }
      tray.setTooltip?.(`${state.taskName} — ${text}`);
    } else if (lastText !== "idle") {
      lastText = "idle";
      tray.setIcon(idleLight);
      tray.setIconDark?.(idleDark);
      tray.setTooltip?.("Time Tracker — no timer running");
    }
    updateMenu(state.running, lastTaskId !== null);
  }

  update();
  setInterval(update, 1000);

  // Left-click popover with timer + pause/resume controls.
  let panel: { toggle(): void } | null = null;
  try {
    panel = tray.attachPanel({
      url: `http://127.0.0.1:${port}/panel`,
      width: 260,
      height: 170,
    });
  } catch (err) {
    console.warn("[tray] panel unavailable, falling back to menu only:", err);
  }

  tray.addEventListener("menuclick", (e: { detail: { id: string } }) => {
    switch (e.detail.id) {
      case "open":
        openMainWindow();
        break;
      case "pause":
        stopTimer();
        update();
        break;
      case "resume":
        if (lastTaskId !== null) startTimer(lastTaskId);
        update();
        break;
      case "quit":
        D.exit(0);
        break;
    }
  });

  if (!panel) {
    tray.addEventListener("click", () => openMainWindow());
  }
}
