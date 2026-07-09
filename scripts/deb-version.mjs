// Stamps a version into a .deb built by `deno desktop`, which hardcodes 1.0.0.
//
// Only the control.tar.gz ar member is rewritten; data.tar.gz is left byte-for-byte
// alone so the root ownership of the installed files survives repacking as a
// normal user.
//
//   node scripts/deb-version.mjs dist/TimeTracker.deb 1.0.1

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [deb, version] = process.argv.slice(2);
if (!deb || !version) {
  console.error("usage: node scripts/deb-version.mjs <file.deb> <version>");
  process.exit(1);
}
if (!/^\d[\w.+~-]*$/.test(version)) {
  console.error(`invalid debian version: ${version}`);
  process.exit(1);
}

const debPath = join(process.cwd(), deb);
const work = mkdtempSync(join(tmpdir(), "debver-"));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"] });

try {
  run("ar", ["x", debPath, "control.tar.gz"], work);
  run("tar", ["xzf", "control.tar.gz"], work);

  const controlPath = join(work, "control");
  const control = readFileSync(controlPath, "utf8");
  const stamped = control.replace(/^Version: .*$/m, `Version: ${version}`);
  if (stamped === control) throw new Error("no Version field found in control");
  writeFileSync(controlPath, stamped);

  // Reuse the member list the original control.tar.gz carried.
  const members = run("tar", ["tzf", "control.tar.gz"], work)
    .toString()
    .split("\n")
    .filter(Boolean);
  run("tar", ["czf", "control.tar.gz", ...members], work);

  // `ar r` replaces the member in place, leaving data.tar.gz untouched.
  run("ar", ["r", debPath, "control.tar.gz"], work);

  console.log(`${deb}: Version -> ${version}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
