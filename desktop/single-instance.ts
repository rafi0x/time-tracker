// Single-instance guard (Linux / DBus).
//
// Launching from the desktop file spawns a fresh process every time. Without a
// guard each one registers its own tray icon and its own hidden window, so the
// app appears to duplicate itself and "Quit" only ever kills one of them.
//
// The first process to claim the well-known bus name owns the app. Later ones
// call Activate() on it — which raises the existing window — and then exit.

import dbus, { type MessageBus } from "dbus-next";

const APP_NAME = "com.rafi.timetracker";
const APP_PATH = "/com/rafi/timetracker";
const APP_IFACE = "com.rafi.timetracker.Instance";

const { Interface } = dbus.interface;

class InstanceInterface extends Interface {
  constructor() {
    super(APP_IFACE);
  }

  onActivate: (() => void) | null = null;

  Activate(): void {
    this.onActivate?.();
  }
}

InstanceInterface.configureMembers({
  methods: {
    Activate: { inSignature: "", outSignature: "" },
  },
});

/**
 * Returns true when this process owns the app. When it returns false another
 * instance is already running and has been asked to show its window; the
 * caller must exit.
 */
export async function acquireSingleInstance(
  bus: MessageBus,
  onActivate: () => void,
): Promise<boolean> {
  const iface = new InstanceInterface();
  iface.onActivate = onActivate;
  bus.export(APP_PATH, iface);

  const reply = await bus.requestName(APP_NAME, dbus.NameFlag.DO_NOT_QUEUE);
  if (
    reply === dbus.RequestNameReply.PRIMARY_OWNER ||
    reply === dbus.RequestNameReply.ALREADY_OWNER
  ) {
    return true;
  }

  try {
    const obj = await bus.getProxyObject(APP_NAME, APP_PATH);
    await obj.getInterface(APP_IFACE).Activate();
  } catch (err) {
    console.warn("[tray] could not activate the running instance:", err);
  }
  return false;
}
