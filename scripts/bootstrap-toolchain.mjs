import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const packageManager = manifest.packageManager;

if (typeof packageManager !== "string" || !packageManager.startsWith("pnpm@")) {
  throw new Error("package.json must pin an exact pnpm version.");
}

const pnpmPath = spawnSync("which", ["pnpm"], {
  encoding: "utf8",
}).stdout.trim();
if (pnpmPath.length > 0) {
  const enable = spawnSync(
    "corepack",
    ["enable", "--install-directory", dirname(pnpmPath), "pnpm"],
    { cwd: root, stdio: "inherit" },
  );
  if (enable.status !== 0) process.exit(enable.status ?? 1);
}

const prepare = spawnSync(
  "corepack",
  ["prepare", packageManager, "--activate"],
  { cwd: root, stdio: "inherit" },
);
if (prepare.status !== 0) process.exit(prepare.status ?? 1);

const verification = spawnSync("corepack", ["pnpm", "--version"], {
  cwd: root,
  encoding: "utf8",
});
if (verification.status !== 0) {
  process.stderr.write(verification.stderr);
  process.exit(verification.status ?? 1);
}

const expected = packageManager.slice("pnpm@".length);
const actual = verification.stdout.trim();
if (actual !== expected) {
  throw new Error(`Expected pnpm ${expected}, received ${actual}.`);
}

const directVerification = spawnSync("pnpm", ["--version"], {
  cwd: root,
  encoding: "utf8",
});
if (
  directVerification.status !== 0 ||
  directVerification.stdout.trim() !== expected
) {
  throw new Error(
    `The active pnpm command is not pinned to ${expected}. Run npm run bootstrap from a writable tool directory.`,
  );
}

console.log(
  `Romeo toolchain ready: Node ${process.versions.node}, pnpm ${actual}.`,
);
