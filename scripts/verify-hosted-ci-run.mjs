import { relative } from "node:path";

import {
  collectCiRunVerification,
  plannedCiRunVerification,
} from "./lib/ci-run-verification.mjs";
import {
  argValue,
  hasFlag,
  repoPath,
  root,
  writeJsonOrStdout,
} from "./lib/release-artifacts.mjs";

const outputPath = repoPath(
  argValue("--output") ?? "dist/ci/hosted-ci-run-verification.json",
);
const dryRun = hasFlag("--dry-run");
const stdout = hasFlag("--stdout");
const strict = hasFlag("--strict");
const config = {
  apiUrl: argValue("--api-url") ?? "https://api.github.com",
  branch: argValue("--branch") ?? "main",
  event: argValue("--event") ?? "push",
  headSha: argValue("--head-sha"),
  planPath: argValue("--plan") ?? "dist/ci/branch-protection-plan.json",
  repository: argValue("--repo") ?? process.env.GITHUB_REPOSITORY,
  runId: argValue("--run-id"),
  timeoutMs: positiveInteger(argValue("--timeout-ms") ?? "30000"),
  token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
  workflowId: argValue("--workflow-id") ?? "ci.yml",
  workflowName: argValue("--workflow-name") ?? "Romeo CI",
};

const evidence = dryRun
  ? plannedCiRunVerification(config)
  : await collectCiRunVerification(config);

writeJsonOrStdout({ path: outputPath, value: evidence, stdout });
if (!stdout) {
  console.log(
    `Wrote Romeo hosted CI run verification to ${relative(root, outputPath)}`,
  );
}
if (strict && evidence.status !== "passed") process.exit(1);

function positiveInteger(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("--timeout-ms must be a positive integer.");
  }
  return value;
}
