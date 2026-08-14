import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const commands = [
  ["format:check"],
  ["lint"],
  ["audit:prod"],
  ["check:architecture"],
  ["check:dependencies"],
  ["check:dead-code"],
  ["check:test-contracts"],
  ["check:ui-form-contracts"],
  ["check:query-key-contracts"],
  ["check:query-option-contracts"],
  ["check:mutation-policy-contracts"],
  ["check:data-table-inventory"],
  ["check:data-inventory"],
  ["check:openapi-route-coverage"],
  ["contract:lint"],
  ["contract:breaking"],
  ["check:api-evolution-policy"],
  ["check:public-api-errors"],
  ["check:audit-taxonomy"],
  ["check:usage-taxonomy"],
  ["check:database-evolution-policy"],
  ["check:program-evidence-manifest"],
  ["check:enterprise-test-fixtures"],
  ["check:sdk-typescript-drift"],
  ["check:sdk-drift"],
  ["check"],
  ["test"],
  ["test:coverage"],
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
