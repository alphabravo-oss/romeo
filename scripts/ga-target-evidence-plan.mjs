import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  collectGaTargetEvidencePlan,
  defaultTargetPreflightPath,
} from "./lib/ga-target-evidence-plan.mjs";

const outputPath = argValue("--output");
const evidence = collectGaTargetEvidencePlan({
  preflightPath: argValue("--preflight") ?? defaultTargetPreflightPath,
});

writeEvidence(evidence);

function writeEvidence(value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (outputPath === undefined) {
    process.stdout.write(body);
    return;
  }
  const resolved = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, body, "utf8");
  console.log(`Wrote GA target evidence plan to ${resolved}`);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
