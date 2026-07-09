// Linux system tray via the DBus StatusNotifierItem protocol.
//
// The deno desktop backend (laufey 0.5.0) stubs out Deno.Tray on Linux, so we
// register a StatusNotifierItem + com.canonical.dbusmenu ourselves through
// dbus-next. GNOME's AppIndicator extension (default on Ubuntu) renders it in
// the top bar, including the XAyatanaLabel — which gives us a real text
// timer next to the icon. KDE and others render the icon + menu.

import dbus, { type MessageBus, Variant } from "dbus-next";
import { getTimerState, startTimer, stopTimer } from "../lib/db";
import { trayTimeText } from "./icon-text";
import { acquireSingleInstance } from "./single-instance";

const { Interface } = dbus.interface;

// Deno.exit tears down the native runtime; process.exit is the Node shim and is
// only here for `next dev` on plain Node.
function exitApp(bus: MessageBus): void {
  try {
    bus.disconnect();
  } catch { /* already gone */ }
  // deno-lint-ignore no-explicit-any
  const D = (globalThis as any).Deno;
  if (typeof D?.exit === "function") D.exit(0);
  else process.exit(0);
}

const MENU_OPEN = 1;
const MENU_TOGGLE = 2;
const MENU_QUIT = 3;

type MenuClickHandler = (id: number) => void;

// 22x22 ARGB32 pixmap (network byte order) as the SNI spec requires.
function idlePixmap(): [number, number, Buffer] {
  const size = 22;
  const rgba = rgbaFromIdleIcon(size);
  const argb = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    argb[i * 4] = rgba[i * 4 + 3]; // A
    argb[i * 4 + 1] = rgba[i * 4]; // R
    argb[i * 4 + 2] = rgba[i * 4 + 1]; // G
    argb[i * 4 + 3] = rgba[i * 4 + 2]; // B
  }
  return [size, size, argb];
}

// renderIdleIcon returns a PNG; we need raw pixels here. Re-draw the same
// simple clock face directly as RGBA.
function rgbaFromIdleIcon(size: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  const radius = size / 2 - 2;
  const set = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= size || yi >= size) return;
    const i = (yi * size + xi) * 4;
    rgba[i] = 235;
    rgba[i + 1] = 235;
    rgba[i + 2] = 235;
    rgba[i + 3] = 255;
  };
  for (let deg = 0; deg < 360; deg += 2) {
    const rad = (deg * Math.PI) / 180;
    set(c + radius * Math.cos(rad), c + radius * Math.sin(rad));
  }
  for (let t = 0; t <= radius - 3; t += 0.5) set(c, c - t);
  for (let t = 0; t <= radius - 5; t += 0.5) set(c + t, c);
  return rgba;
}

class StatusNotifierItem extends Interface {
  constructor() {
    super("org.kde.StatusNotifierItem");
  }

  Category = "ApplicationStatus";
  Id = "time-tracker";
  Title = "Time Tracker";
  Status = "Active";
  IconName = "";
  IconPixmap = [idlePixmap()];
  ToolTip: [string, [number, number, Buffer][], string, string] = [
    "",
    [],
    "Time Tracker",
    "No timer running",
  ];
  Menu = "/MenuBar";
  ItemIsMenu = false;
  XAyatanaLabel = "";
  XAyatanaLabelGuide = "8:88:88";

  // signal emitters (bodies are ignored; dbus-next emits on call)
  NewIcon(): void { }
  NewToolTip(): void { }
  NewStatus(status: string): string {
    return status;
  }
  XAyatanaNewLabel(label: string, guide: string): [string, string] {
    return [label, guide];
  }

  Activate(_x: number, _y: number): void {
    this.onActivate?.();
  }
  SecondaryActivate(_x: number, _y: number): void { }
  Scroll(_delta: number, _orientation: string): void { }

  onActivate: (() => void) | null = null;
}

StatusNotifierItem.configureMembers({
  properties: {
    Category: { signature: "s", access: "read" },
    Id: { signature: "s", access: "read" },
    Title: { signature: "s", access: "read" },
    Status: { signature: "s", access: "read" },
    IconName: { signature: "s", access: "read" },
    IconPixmap: { signature: "a(iiay)", access: "read" },
    ToolTip: { signature: "(sa(iiay)ss)", access: "read" },
    Menu: { signature: "o", access: "read" },
    ItemIsMenu: { signature: "b", access: "read" },
    XAyatanaLabel: { signature: "s", access: "read" },
    XAyatanaLabelGuide: { signature: "s", access: "read" },
  },
  methods: {
    Activate: { inSignature: "ii", outSignature: "" },
    SecondaryActivate: { inSignature: "ii", outSignature: "" },
    Scroll: { inSignature: "is", outSignature: "" },
  },
  signals: {
    NewIcon: { signature: "" },
    NewToolTip: { signature: "" },
    NewStatus: { signature: "s" },
    XAyatanaNewLabel: { signature: "ss" },
  },
});

class DBusMenu extends Interface {
  constructor() {
    super("com.canonical.dbusmenu");
  }

  Version = 3;
  Status = "normal";
  TextDirection = "ltr";
  IconThemePath: string[] = [];

  revision = 1;
  toggleLabel = "Resume last task";
  toggleEnabled = false;
  onClick: MenuClickHandler | null = null;

  private itemProps(id: number): Record<string, Variant> {
    switch (id) {
      case MENU_OPEN:
        return { label: new Variant("s", "Open Time Tracker") };
      case MENU_TOGGLE:
        return {
          label: new Variant("s", this.toggleLabel),
          enabled: new Variant("b", this.toggleEnabled),
        };
      case MENU_QUIT:
        return { label: new Variant("s", "Quit") };
      default:
        return { "children-display": new Variant("s", "submenu") };
    }
  }

  GetLayout(
    parentId: number,
    _recursionDepth: number,
    _propertyNames: string[],
  ): [number, [number, Record<string, Variant>, Variant[]]] {
    if (parentId !== 0) {
      return [this.revision, [parentId, this.itemProps(parentId), []]];
    }
    const children = [MENU_OPEN, MENU_TOGGLE, MENU_QUIT].map(
      (id) => new Variant("(ia{sv}av)", [id, this.itemProps(id), []]),
    );
    return [this.revision, [0, this.itemProps(0), children]];
  }

  GetGroupProperties(
    ids: number[],
    _propertyNames: string[],
  ): [number, Record<string, Variant>][] {
    const all = ids.length ? ids : [0, MENU_OPEN, MENU_TOGGLE, MENU_QUIT];
    return all.map((id) => [id, this.itemProps(id)]);
  }

  GetProperty(id: number, name: string): Variant {
    return this.itemProps(id)[name] ?? new Variant("s", "");
  }

  Event(id: number, eventId: string, _data: unknown, _timestamp: number): void {
    if (eventId === "clicked") this.onClick?.(id);
  }

  EventGroup(events: [number, string, unknown, number][]): number[] {
    for (const [id, eventId, data, ts] of events) this.Event(id, eventId, data, ts);
    return [];
  }

  AboutToShow(_id: number): boolean {
    return false;
  }

  AboutToShowGroup(_ids: number[]): [number[], number[]] {
    return [[], []];
  }

  LayoutUpdated(revision: number, parent: number): [number, number] {
    return [revision, parent];
  }

  ItemsPropertiesUpdated(
    updated: [number, Record<string, Variant>][],
    removed: [number, string[]][],
  ): [[number, Record<string, Variant>][], [number, string[]][]] {
    return [updated, removed];
  }

  bumpMenu(toggleLabel: string, toggleEnabled: boolean): void {
    if (this.toggleLabel === toggleLabel && this.toggleEnabled === toggleEnabled) return;
    this.toggleLabel = toggleLabel;
    this.toggleEnabled = toggleEnabled;
    this.revision++;
    this.LayoutUpdated(this.revision, 0);
  }
}

DBusMenu.configureMembers({
  properties: {
    Version: { signature: "u", access: "read" },
    Status: { signature: "s", access: "read" },
    TextDirection: { signature: "s", access: "read" },
    IconThemePath: { signature: "as", access: "read" },
  },
  methods: {
    GetLayout: { inSignature: "iias", outSignature: "u(ia{sv}av)" },
    GetGroupProperties: { inSignature: "aias", outSignature: "a(ia{sv})" },
    GetProperty: { inSignature: "is", outSignature: "v" },
    Event: { inSignature: "isvu", outSignature: "" },
    EventGroup: { inSignature: "a(isvu)", outSignature: "ai" },
    AboutToShow: { inSignature: "i", outSignature: "b" },
    AboutToShowGroup: { inSignature: "ai", outSignature: "aiai" },
  },
  signals: {
    LayoutUpdated: { signature: "ui" },
    ItemsPropertiesUpdated: { signature: "a(ia{sv})a(ias)" },
  },
});

export async function startLinuxTray(openWindow: () => void): Promise<void> {
  const bus = dbus.sessionBus();

  if (!(await acquireSingleInstance(bus, openWindow))) {
    console.log("[tray] another instance owns the app; raising it and exiting");
    exitApp(bus);
    return;
  }

  openWindow();

  const sni = new StatusNotifierItem();
  const menu = new DBusMenu();

  let lastTaskId: number | null = null;

  menu.onClick = (id) => {
    switch (id) {
      case MENU_OPEN:
        openWindow();
        break;
      case MENU_TOGGLE: {
        const state = getTimerState();
        if (state.running) stopTimer();
        else if (lastTaskId !== null) startTimer(lastTaskId);
        update();
        break;
      }
      case MENU_QUIT:
        // Let the dbusmenu Event reply reach the panel before the bus drops,
        // otherwise the menu reports the app as crashed.
        setTimeout(() => exitApp(bus), 50);
    }
  };
  sni.onActivate = openWindow;

  bus.export("/StatusNotifierItem", sni);
  bus.export("/MenuBar", menu);
  const busName = `org.kde.StatusNotifierItem-${process.pid}-1`;
  await bus.requestName(busName, 0);

  const watcherObj = await bus.getProxyObject(
    "org.kde.StatusNotifierWatcher",
    "/StatusNotifierWatcher",
  );
  const watcher = watcherObj.getInterface("org.kde.StatusNotifierWatcher");
  await watcher.RegisterStatusNotifierItem(busName);

  let lastLabel = "";
  function update() {
    const state = getTimerState();
    if (state.taskId) lastTaskId = state.taskId;

    const label = state.running ? ` ${trayTimeText(state.elapsedMs)}` : "";
    if (label !== lastLabel) {
      lastLabel = label;
      sni.XAyatanaLabel = label;
      sni.XAyatanaNewLabel(label, sni.XAyatanaLabelGuide);
      sni.ToolTip = [
        "",
        [],
        "Time Tracker",
        state.running ? `${state.taskName} — ${trayTimeText(state.elapsedMs)}` : "No timer running",
      ];
      sni.NewToolTip();
    }
    const truncate = (s: string | null, n = 15) => {
      if (!s) return "";
      return s.length > n ? `${s.slice(0, n)}...` : s;
    };

    menu.bumpMenu(
      state.running ? `Pause "${truncate(state.taskName)}"` : "Resume last task",
      state.running || lastTaskId !== null,
    );
  }

  update();
  setInterval(update, 1000);
  console.log("[tray] Linux StatusNotifierItem registered:", busName);
}
