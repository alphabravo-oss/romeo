import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import YAML from "yaml";

import {
  argValue,
  repoPath,
  root,
  writeJsonOrStdout,
} from "./lib/release-artifacts.mjs";

const workflowPath = repoPath(
  argValue("--workflow") ?? ".github/workflows/ci.yml",
);
const outputPath = repoPath(
  argValue("--output") ?? "dist/ci/branch-protection-plan.json",
);
const generatedAt = argValue("--generated-at") ?? new Date().toISOString();
const stdout = process.argv.includes("--stdout");
const blockers = [];
const checks = [];
const expectedComposeSmokeMatrixNames = [
  "app-workflow",
  "auth",
  "external-postgres",
  "workers",
  "backup-restore",
  "billing-scheduler",
  "secret-rotation",
  "scale",
  "distributed-controls",
  "object-store-outage",
  "tiered-rag",
];
const requiredWorkflowCommands = [
  "pnpm check:sdk-drift",
  "pnpm check:openapi-route-coverage",
  "OPENWEBUI_COMPATIBILITY_ENABLED=true pnpm check:openapi-route-coverage",
  "pnpm check",
  "pnpm test",
  "pnpm build",
  "pnpm review:baseline",
  "pnpm review:repository-conformance",
  "pnpm fixtures:scale",
  "pnpm smoke:scale:load",
  "pnpm smoke:jobs:lag",
  "pnpm smoke:providers:resilience",
  "pnpm smoke:browser-automation:contract",
  "pnpm smoke:quality:contract",
  "pnpm smoke:analytics:authz-contract",
  "pnpm smoke:auth-providers:acceptance-contract",
  "pnpm smoke:directory-sync:contract",
  "pnpm smoke:scim:lifecycle-contract",
  "pnpm smoke:data-connectors:acceptance-contract",
  "pnpm smoke:tool-dispatch:acceptance-contract",
  "pnpm smoke:model-tools:orchestration-contract",
  "pnpm smoke:rag-vector:enterprise-contract",
  "pnpm smoke:voice:provider-acceptance-contract",
  "pnpm smoke:notifications:adapter-acceptance-contract",
  "pnpm smoke:native-client:api-contract",
  "pnpm validate:operational-monitoring",
  "pnpm smoke:alerts:contract",
  "pnpm smoke:edge:contract",
  "pnpm smoke:postgres:backup-upload-failure",
  "pnpm smoke:support-bundle-redaction",
  "pnpm smoke:data-rights-retention-contract",
  "pnpm smoke:compose:env-contract",
  "pnpm smoke:helm:env-schema-contract",
  "pnpm ci:branch-protection-plan",
  "pnpm smoke:tenant-isolation-negative",
  "pnpm smoke:ga:evidence-contract",
  "pnpm smoke:ga:target-plan-contract",
  "pnpm smoke:ga:target-env-template-contract",
  "pnpm smoke:ga:target-execution-contract",
  "pnpm smoke:kubernetes:networkpolicy",
  "pnpm ga:checklist",
  "pnpm ga:target-preflight",
  "pnpm ga:target-plan",
  "pnpm ga:target-env-template",
  "pnpm migrate:postgres",
  "pnpm validate:postgres",
  "pnpm review:postgres-query-plans",
  "pnpm review:pgvector-isolation",
  "pnpm test:postgres-conformance",
  "pnpm smoke:kubernetes:render",
  "pnpm release:pack",
  "pnpm sbom:generate",
  "pnpm release:channel",
  "pnpm containers:scan-plan",
  "pnpm release:security",
  "pnpm release:provenance",
  "pnpm release:approval",
  "pnpm release:upgrade-check",
  "pnpm release:publish-plan",
  "pnpm ga:bundle",
  "pnpm release:airgap-check",
  "pnpm release:readback-collect",
  "pnpm release:readback-check",
  "pnpm smoke:release:readback",
];

const workflowSource = existsSync(workflowPath)
  ? readFileSync(workflowPath, "utf8")
  : undefined;
if (workflowSource === undefined) {
  addBlocker("workflow_missing", "GitHub CI workflow is missing.");
}
const workflow =
  workflowSource === undefined ? undefined : YAML.parse(workflowSource);
const jobs = workflow?.jobs ?? {};
const jobEntries = Object.entries(jobs);
const composeMatrix = composeSmokeMatrix();
const requiredStatusChecks = [
  statusCheck("quality", "Quality Gates"),
  statusCheck("postgres", "Postgres Conformance"),
  statusCheck("kubernetes-render", "Helm And Kubernetes Render"),
  statusCheck("release-evidence", "Release Evidence Dry Run"),
  ...composeMatrix.map((item) =>
    statusCheck("compose-smoke", `Compose Smoke (${item.name})`),
  ),
];

validateWorkflowShape();
validateRequiredJobs();
validateRequiredCommands();
validateRedaction();

const plan = {
  schemaVersion: "romeo.branch-protection-plan.v1",
  generatedAt,
  status: blockers.length === 0 ? "passed" : "blocked",
  provider: "github",
  workflow: workflowSource
    ? {
        file: relative(root, workflowPath),
        name: workflow?.name,
        sha256: sha256Value(workflowSource),
        jobCount: jobEntries.length,
      }
    : {
        file: relative(root, workflowPath),
        jobCount: 0,
      },
  policy: {
    targetBranch: argValue("--target-branch") ?? "main",
    requirePullRequest: true,
    requireConversationResolution: true,
    requireLinearHistory: true,
    requireSignedCommits: true,
    requireUpToDateBeforeMerge: true,
    dismissStaleApprovals: true,
    requiredApprovingReviewCount: 2,
    restrictBypassToReleaseAdmins: true,
    requireCodeOwnerReviews: true,
  },
  requiredStatusChecks,
  checks,
  blockers,
  redaction: {
    workflowBodyIncluded: false,
    secretValuesIncluded: false,
    tokenValuesIncluded: false,
    environmentValuesIncluded: false,
  },
};

writeJsonOrStdout({ path: outputPath, value: plan, stdout });
if (!stdout) {
  console.log(
    `Wrote Romeo branch protection plan to ${relative(root, outputPath)}`,
  );
}
if (blockers.length > 0) process.exit(1);

function validateWorkflowShape() {
  check("workflow name is Romeo CI", workflow?.name === "Romeo CI", {
    code: "workflow_name_invalid",
  });
  check(
    "workflow runs on pull_request",
    workflow?.on?.pull_request !== undefined,
    {
      code: "pull_request_trigger_missing",
    },
  );
  const pushBranches = workflow?.on?.push?.branches;
  check(
    "workflow runs on main pushes",
    Array.isArray(pushBranches) && pushBranches.includes("main"),
    { code: "main_push_trigger_missing" },
  );
  check(
    "workflow has read-only contents permission",
    workflow?.permissions?.contents === "read",
    {
      code: "workflow_permissions_not_read_only",
    },
  );
  check(
    "workflow cancels superseded runs",
    workflow?.concurrency?.["cancel-in-progress"] === true,
    {
      code: "workflow_concurrency_missing",
    },
  );
}

function validateRequiredJobs() {
  for (const required of [
    "quality",
    "postgres",
    "kubernetes-render",
    "release-evidence",
    "compose-smoke",
  ]) {
    check(
      `required CI job exists: ${required}`,
      jobs?.[required] !== undefined,
      {
        code: "required_job_missing",
      },
    );
  }
  check(
    "compose smoke matrix is present",
    composeMatrix.length >= expectedComposeSmokeMatrixNames.length,
    {
      code: "compose_matrix_incomplete",
    },
  );
  for (const expected of expectedComposeSmokeMatrixNames) {
    check(
      `compose smoke matrix includes ${expected}`,
      composeMatrix.some((item) => item.name === expected),
      { code: "compose_matrix_entry_missing" },
    );
  }
}

function validateRequiredCommands() {
  const runs = jobEntries.flatMap(([, job]) =>
    Array.isArray(job?.steps)
      ? job.steps.map((step) => String(step?.run ?? "")).filter(Boolean)
      : [],
  );
  for (const command of requiredWorkflowCommands) {
    check(
      `workflow runs ${command}`,
      runs.some((run) => workflowRunContainsCommand(run, command)),
      {
        code: "required_command_missing",
      },
    );
  }
}

function workflowRunContainsCommand(run, command) {
  const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|\\s)${escapedCommand}(?=$|\\s)`, "u").test(run);
}

function validateRedaction() {
  const serialized = JSON.stringify({
    policy: planPreviewPolicy(),
    requiredStatusChecks,
    checks,
    blockers,
  });
  const forbidden = Object.entries(process.env)
    .filter(
      ([key, value]) =>
        /TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL/iu.test(key) &&
        typeof value === "string" &&
        value.length >= 8,
    )
    .map(([, value]) => value);
  for (const value of forbidden) {
    if (serialized.includes(value)) {
      addBlocker(
        "secret_redaction_failed",
        "Branch protection plan included a secret-like environment value.",
      );
    }
  }
  checks.push({
    name: "branch protection plan redaction self-check passed",
    status: blockers.some((item) => item.code === "secret_redaction_failed")
      ? "fail"
      : "pass",
  });
}

function composeSmokeMatrix() {
  const include = jobs?.["compose-smoke"]?.strategy?.matrix?.include;
  return Array.isArray(include)
    ? include
        .map((item) => ({
          name: typeof item?.name === "string" ? item.name : undefined,
          command: typeof item?.command === "string" ? item.command : undefined,
        }))
        .filter((item) => item.name !== undefined)
    : [];
}

function statusCheck(jobId, name) {
  return {
    workflow: workflow?.name ?? "Romeo CI",
    jobId,
    name,
    required: true,
  };
}

function check(name, passed, { code }) {
  checks.push({ name, status: passed ? "pass" : "fail" });
  if (!passed) addBlocker(code, name);
}

function addBlocker(code, message) {
  if (blockers.some((item) => item.code === code && item.message === message)) {
    return;
  }
  blockers.push({ code, message });
}

function planPreviewPolicy() {
  return {
    targetBranch: argValue("--target-branch") ?? "main",
    requiredStatusChecks,
  };
}

function sha256Value(value) {
  return createHash("sha256").update(value).digest("hex");
}
