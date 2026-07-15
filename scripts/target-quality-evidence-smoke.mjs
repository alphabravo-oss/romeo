import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  collectTargetQualityEvidence,
  normalizeVectorRouteMode,
  plannedTargetQualityEvidence,
  positiveInteger,
  repeatedArgValues,
} from "./lib/target-quality-evidence.mjs";

const outputPath = argValue("--output");
const dryRun = process.argv.includes("--dry-run");
const explicitAgentIds = repeatedArgValues("--agent-id");
const config = {
  agentIds:
    explicitAgentIds.length > 0
      ? explicitAgentIds
      : splitCsv(
          argValue("--agent-ids") ??
            process.env.TARGET_QUALITY_AGENT_IDS ??
            "agent_default",
        ),
  apiKey: argValue("--api-key") ?? process.env.ROMEO_API_KEY,
  baseUrl: argValue("--base-url") ?? process.env.ROMEO_BASE_URL,
  forbiddenStrings: [
    ...splitCsv(process.env.TARGET_QUALITY_FORBIDDEN_STRINGS ?? ""),
    ...repeatedArgValues("--forbidden-string"),
  ],
  replayFile:
    argValue("--replay-file") ?? process.env.TARGET_QUALITY_REPLAY_FILE,
  requireEvalPassed:
    process.argv.includes("--require-eval-passed") ||
    process.env.TARGET_QUALITY_REQUIRE_EVAL_PASSED === "true",
  requireVectorComparison:
    process.argv.includes("--require-vector-comparison") ||
    process.env.TARGET_QUALITY_REQUIRE_VECTOR_COMPARISON === "true",
  baselineVectorRouteMode: normalizeVectorRouteMode(
    argValue("--baseline-vector-route-mode") ??
      argValue("--baseline-vector-route") ??
      process.env.TARGET_QUALITY_BASELINE_VECTOR_ROUTE_MODE,
    "pgvector",
    "--baseline-vector-route-mode",
  ),
  candidateVectorRouteMode: normalizeVectorRouteMode(
    argValue("--candidate-vector-route-mode") ??
      argValue("--candidate-vector-route") ??
      process.env.TARGET_QUALITY_CANDIDATE_VECTOR_ROUTE_MODE,
    "external_vector",
    "--candidate-vector-route-mode",
  ),
  timeoutMs: positiveInteger(argValue("--timeout-ms"), 10_000, "--timeout-ms"),
};

const evidence = dryRun
  ? plannedTargetQualityEvidence(config)
  : await collectTargetQualityEvidence(config);

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
  console.log(`Wrote target quality evidence to ${resolved}`);
}

function splitCsv(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
