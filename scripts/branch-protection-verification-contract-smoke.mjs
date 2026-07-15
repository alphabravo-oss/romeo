import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { collectBranchProtectionVerification } from "./lib/branch-protection-verification.mjs";

const outputPath = argValue("--output");
const tempDir = mkdtempSync(join(tmpdir(), "romeo-branch-protection-"));
const originalCwd = process.cwd();
const tokenSentinel = "SECRET_BRANCH_PROTECTION_TOKEN";
const repositorySentinel = "openai/private-romeo";

try {
  writeJson("dist/ci/branch-protection-plan.json", plan());
  process.chdir(tempDir);

  const positiveRequests = [];
  const positive = await collectBranchProtectionVerification({
    apiUrl: "https://api.github.example/api/v3?raw=query",
    branch: "main",
    fetchImpl: async (url, init) => {
      positiveRequests.push({
        authorization: init?.headers?.authorization,
        url,
      });
      return jsonResponse(protectionFixture());
    },
    planPath: "dist/ci/branch-protection-plan.json",
    repository: repositorySentinel,
    timeoutMs: 1000,
    token: tokenSentinel,
  });

  assertEqual(positive.status, "passed", "positive verification status");
  assertEqual(
    positiveRequests[0]?.authorization,
    `Bearer ${tokenSentinel}`,
    "GitHub bearer auth",
  );
  assertRedacted("positive verification", positive);

  const blocked = await collectBranchProtectionVerification({
    apiUrl: "https://api.github.example/api/v3",
    branch: "main",
    fetchImpl: async () =>
      jsonResponse({
        ...protectionFixture(),
        required_pull_request_reviews: {
          ...protectionFixture().required_pull_request_reviews,
          required_approving_review_count: 1,
        },
        required_status_checks: {
          contexts: ["Quality Gates"],
          strict: false,
        },
      }),
    planPath: "dist/ci/branch-protection-plan.json",
    repository: repositorySentinel,
    timeoutMs: 1000,
    token: tokenSentinel,
  });

  assertEqual(blocked.status, "blocked", "blocked verification status");
  assertIncludes(
    blocked.blockers.map((item) => item.code),
    "required_approval_count_too_low",
    "approval blocker",
  );
  assertIncludes(
    blocked.blockers.map((item) => item.code),
    "required_status_check_missing",
    "missing status check blocker",
  );
  assertRedacted("blocked verification", blocked);

  writeEvidence({
    schemaVersion: "romeo.branch-protection-verification-contract-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    checks: [
      "positive_branch_protection_verification_passes",
      "blocked_branch_protection_verification_reports_stable_codes",
      "github_bearer_auth_sent",
      "repository_slug_redacted",
      "token_redacted",
      "api_query_redacted_from_origin",
    ],
    positive: evidenceSummary(positive),
    blocked: evidenceSummary(blocked),
    redaction: {
      rawApiResponseReturned: false,
      rawEnvironmentValuesReturned: false,
      repositorySlugReturned: false,
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
    policy: {
      dismissStaleApprovals: true,
      requireCodeOwnerReviews: true,
      requireConversationResolution: true,
      requireLinearHistory: true,
      requireSignedCommits: true,
      requireUpToDateBeforeMerge: true,
      requiredApprovingReviewCount: 2,
    },
    requiredStatusChecks: [
      { name: "Quality Gates" },
      { name: "Postgres Conformance" },
      { name: "Helm And Kubernetes Render" },
      { name: "Release Evidence Dry Run" },
    ],
  };
}

function protectionFixture() {
  return {
    enforce_admins: { enabled: true },
    required_conversation_resolution: { enabled: true },
    required_linear_history: { enabled: true },
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: true,
      required_approving_review_count: 2,
    },
    required_signatures: { enabled: true },
    required_status_checks: {
      checks: [
        { context: "Helm And Kubernetes Render" },
        { context: "Release Evidence Dry Run" },
      ],
      contexts: ["Quality Gates", "Postgres Conformance"],
      strict: true,
    },
  };
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
  for (const forbidden of [tokenSentinel, repositorySentinel, "raw=query"]) {
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
  console.log(
    `Wrote branch protection verification contract smoke to ${resolved}`,
  );
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
