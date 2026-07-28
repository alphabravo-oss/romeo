import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const commands = [
  ["format:check"],
  ["check:architecture"],
  ["check:dependencies"],
  ["check:ui-form-contracts"],
  ["check:openapi-route-coverage"],
  ["contract:lint"],
  ["contract:breaking"],
  ["check:sdk-typescript-drift"],
  ["check:sdk-drift"],
  ["check"],
  ["test"],
  ["build"],
  ["check:bundle-budget"],
  ["quality:browser"],
];

for (const args of commands) {
  const result = spawnSync("corepack", ["pnpm", ...args], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
