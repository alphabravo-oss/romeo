import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  defaultTargetPlanPath,
  executeGaTargetPlan,
} from "./lib/ga-target-execution.mjs";

const outputPath = argValue("--output") ?? "dist/ci/ga-target-execution.json";
const report = executeGaTargetPlan({
  planPath: argValue("--plan") ?? defaultTargetPlanPath,
  confirm:
    process.argv.includes("--confirm-run-ready-gates") ||
    process.env.GA_TARGET_EXECUTE_CONFIRM === "run-ready-gates",
  continueOnFailure: process.argv.includes("--continue-on-failure"),
  envFilePath: argValue("--env-file"),
  gateIds: argValues("--gate"),
  timeoutMs: argValue("--timeout-ms"),
});

writeEvidence(report);
if (report.summary.failed > 0) process.exit(1);
if (report.summary.confirmationRequired > 0) process.exit(2);

function writeEvidence(value) {
  const resolved = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.log(`Wrote GA target execution evidence to ${resolved}`);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1] !== undefined) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}
