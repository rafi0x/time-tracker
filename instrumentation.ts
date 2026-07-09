// Next.js server-boot hook. When the server runs inside `deno desktop`,
// Deno.Tray exists and we start the system tray; under plain `next dev`
// on Node.js this is a no-op.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // deno-lint-ignore no-explicit-any
  const deno = (globalThis as any).Deno;
  if (!deno?.Tray) return;
  const { startTray } = await import("./desktop/tray");
  try {
    startTray();
  } catch (err) {
    console.warn("[tray] failed to start:", err);
  }
}
