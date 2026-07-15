import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  collectGaTargetPreflight,
  defaultChecklistPath,
} from "./lib/ga-target-preflight.mjs";
import {
  loadGaTargetEnvFile,
  withGaTargetProcessEnv,
} from "./lib/ga-target-env-file.mjs";

const outputPath = argValue("--output");
const envFile = loadGaTargetEnvFile(argValue("--env-file"));
const evidence = withGaTargetProcessEnv(envFile.env, () =>
  collectGaTargetPreflight({
    baseUrl: argValue("--base-url"),
    checklistPath: argValue("--checklist") ?? defaultChecklistPath,
    prometheusUrl: argValue("--prometheus-url"),
  }),
);
evidence.envFile = envFile.evidence;
evidence.redaction = {
  ...evidence.redaction,
  rawEnvFileValuesReturned: false,
  rawEnvFileBodyReturned: false,
};

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
  console.log(`Wrote GA target preflight evidence to ${resolved}`);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
