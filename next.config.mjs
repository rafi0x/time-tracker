// Plain-JS config: a .ts config makes `next start` load SWC at runtime,
// which fails inside the deno desktop compiled binary.
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A stray lockfile in $HOME makes Next mis-detect the workspace root.
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  // Loaded at runtime from node_modules (deno desktop embeds them); bundling
  // dbus-next with webpack breaks its dynamic requires.
  serverExternalPackages: ["dbus-next"],
};

export default nextConfig;
