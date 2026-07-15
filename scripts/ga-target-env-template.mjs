import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  collectGaTargetEnvTemplate,
  defaultTargetPlanPath,
  formatGaTargetEnvExample,
} from "./lib/ga-target-env-template.mjs";

const outputPath =
  argValue("--output") ?? "dist/ci/ga-target-env-template.json";
const envOutputPath = argValue("--env-output");
const report = collectGaTargetEnvTemplate({
  planPath: argValue("--plan") ?? defaultTargetPlanPath,
});

writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
if (envOutputPath !== undefined) {
  writeFile(envOutputPath, formatGaTargetEnvExample(report));
}

function writeFile(path, content) {
  const resolved = resolve(process.cwd(), path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, content, "utf8");
  console.log(`Wrote GA target env template to ${resolved}`);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
