import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { collectCiRunVerification } from "./lib/ci-run-verification.mjs";

const outputPath = argValue("--output");
const tempDir = mkdtempSync(join(tmpdir(), "romeo-hosted-ci-run-"));
const originalCwd = process.cwd();
const tokenSentinel = "SECRET_HOSTED_CI_TOKEN";
const repositorySentinel = "openai/private-romeo";
const runUrlSentinel =
  "https://github.example/openai/private-romeo/actions/runs/123";

try {
  writeJson("dist/ci/branch-protection-plan.json", plan());
  process.chdir(tempDir);

  const positiveRequests = [];
  const positive = await collectCiRunVerification({
    apiUrl: "https://api.github.example/api/v3?raw=query",
    branch: "main",
    event: "push",
    fetchImpl: async (url, init) => {
      positiveRequests.push({
        authorization: init?.headers?.authorization,
        url,
      });
      if (url.includes("/jobs"))
        return jsonResponse({ jobs: successfulJobs(), total_count: 4 });
      return jsonResponse({
        workflow_runs: [workflowRunFixture()],
        total_count: 1,
      });
    },
    planPath: "dist/ci/branch-protection-plan.json",
    repository: repositorySentinel,
    timeoutMs: 1000,
    token: tokenSentinel,
    workflowId: "ci.yml",
    workflowName: "Romeo CI",
  });

  assertEqual(positive.status, "passed", "positive CI verification status");
  assertEqual(
    positiveRequests[0]?.authorization,
    `Bearer ${tokenSentinel}`,
    "GitHub bearer auth",
  );
  assertRedacted("positive CI verification", positive);

  const blocked = await collectCiRunVerification({
    apiUrl: "https://api.github.example/api/v3",
    branch: "main",
    event: "push",
    fetchImpl: async (url) => {
      if (url.includes("/jobs")) {
        return jsonResponse({
          jobs: [
            { conclusion: "success", name: "Quality Gates" },
            { conclusion: "failure", name: "Postgres Conformance" },
          ],
          total_count: 2,
        });
      }
      return jsonResponse({
        workflow_runs: [workflowRunFixture()],
        total_count: 1,
      });
    },
    planPath: "dist/ci/branch-protection-plan.json",
    repository: repositorySentinel,
    timeoutMs: 1000,
    token: tokenSentinel,
    workflowId: "ci.yml",
    workflowName: "Romeo CI",
  });

  assertEqual(blocked.status, "blocked", "blocked CI verification status");
  assertIncludes(
    blocked.blockers.map((item) => item.code),
    "required_ci_job_missing",
    "missing CI job blocker",
  );
  assertIncludes(
    blocked.blockers.map((item) => item.code),
    "required_ci_job_not_successful",
    "failed CI job blocker",
  );
  assertRedacted("blocked CI verification", blocked);

  writeEvidence({
    schemaVersion: "romeo.hosted-ci-run-verification-contract-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    checks: [
      "positive_hosted_ci_run_verification_passes",
      "blocked_hosted_ci_run_reports_missing_and_failed_jobs",
      "github_bearer_auth_sent",
      "repository_slug_redacted",
      "run_url_redacted",
      "token_redacted",
      "api_query_redacted_from_origin",
    ],
    positive: evidenceSummary(positive),
    blocked: evidenceSummary(blocked),
    redaction: {
      rawApiResponseReturned: false,
      rawEnvironmentValuesReturned: false,
      rawJobLogsReturned: false,
      repositorySlugReturned: false,
      runUrlReturned: false,
      tokenValuesReturned: false,
    },
  });
} finally {
  process.chdir(originalCwd);
  rmSync(tempDir, { force: true, recursive: true });
}

function plan() {
  return {
    schemaVersion: "romeo.branch-protection-plan.v1",
    status: "passed",
    requiredStatusChecks: [
      { name: "Quality Gates" },
      { name: "Postgres Conformance" },
      { name: "Helm And Kubernetes Render" },
      { name: "Release Evidence Dry Run" },
    ],
  };
}

function workflowRunFixture() {
  return {
    conclusion: "success",
    event: "push",
    head_sha: "0123456789abcdef0123456789abcdef01234567",
    html_url: runUrlSentinel,
    id: 123,
    name: "Romeo CI",
    status: "completed",
  };
}

function successfulJobs() {
  return [
    { conclusion: "success", name: "Quality Gates" },
    { conclusion: "success", name: "Postgres Conformance" },
    { conclusion: "success", name: "Helm And Kubernetes Render" },
    { conclusion: "success", name: "Release Evidence Dry Run" },
  ];
}

function evidenceSummary(evidence) {
  return {
    status: evidence.status,
    blockerCodes: evidence.blockers.map((item) => item.code),
    checkCount: evidence.checks.length,
    redaction: evidence.redaction,
  };
}

function assertRedacted(label, value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    tokenSentinel,
    repositorySentinel,
    runUrlSentinel,
    "raw=query",
  ]) {
    if (serialized.includes(forbidden)) {
      throw new Error(`${label} leaked ${forbidden}.`);
    }
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected}, got ${actual}.`);
  }
}

function assertIncludes(values, expected, label) {
  if (!values.includes(expected)) {
    throw new Error(`${label} expected ${expected}.`);
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function writeJson(path, value) {
  const resolved = join(tempDir, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeEvidence(value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (outputPath === undefined) {
    process.stdout.write(body);
    return;
  }
  const resolved = resolve(originalCwd, outputPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, body, "utf8");
  console.log(`Wrote hosted CI run verification contract smoke to ${resolved}`);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
