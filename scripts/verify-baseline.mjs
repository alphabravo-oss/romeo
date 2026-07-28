import { spawnSync } from "node:child_process";

const commands = [
  ["pnpm", ["test"]],
  ["pnpm", ["evidence:anthropic:controlled-live"]],
  ["pnpm", ["evidence:web-search:controlled-live"]],
  ["pnpm", ["check"]],
  ["pnpm", ["build"]],
  ["pnpm", ["check:openapi-route-coverage"]],
  ["pnpm", ["check:sdk-drift"]],
  ["pnpm", ["check:bundle-budget"]],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
