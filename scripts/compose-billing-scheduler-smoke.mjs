import { randomBytes } from "node:crypto";

import {
  apiJson,
  argValue,
  assertComposeLogsRedacted,
  assertReadinessReady,
  cleanupComposeHarness,
  compose,
  composeOutput,
  createAdminApiKey,
  createComposeHarness,
  expectUnauthorizedMe,
  parsePositiveInteger,
  randomProjectName,
  waitForHealth,
  writeComposeEnv,
  writeJsonEvidence,
} from "./lib/compose-smoke-support.mjs";

const keep = process.argv.includes("--keep");
const projectName =
  argValue("--project-name") ?? randomProjectName("romeo_billing_smoke");
const timeoutMs = parsePositiveInteger("--timeout-ms", 180000);
const billingIntervalMs = parsePositiveInteger("--interval-ms", 1000);
const billingRawSentinel = `billing_raw_payload_${randomBytes(16).toString("hex")}`;

const harness = await createComposeHarness({ projectName, timeoutMs });
let adminToken;

try {
  writeComposeEnv(harness, { devSeededLogin: true });
  compose(harness, ["up", "-d", "--build", "app"]);
  await waitForHealth(harness);
  compose(harness, [
    "run",
    "--rm",
    "migrate",
    "pnpm",
    "seed:postgres",
    "--",
    "--confirm-development-seed",
  ]);

  adminToken = await createAdminApiKey(harness);
  writeComposeEnv(harness, {
    billingEntitlementReconcileIntervalMs: billingIntervalMs,
    billingLifecycleEnforceIntervalMs: billingIntervalMs,
    devSeededLogin: false,
    romeoApiKey: adminToken,
  });
  compose(harness, ["up", "-d", "--force-recreate", "app"]);
  await waitForHealth(harness);
  await expectUnauthorizedMe(harness);
  await assertReadinessReady(harness, adminToken);

  const entitlement = await runEntitlementSchedulerProof();
  const lifecycle = await runLifecycleSchedulerProof();

  assertComposeLogsRedacted(
    harness,
    [
      adminToken,
      harness.postgresPassword,
      harness.s3Secret,
      harness.sessionSecret,
      harness.webhookSigningKey,
      billingRawSentinel,
    ],
    "Compose billing scheduler logs",
  );

  writeJsonEvidence({
    schemaVersion: "romeo.compose-billing-scheduler-smoke.v1",
    generatedAt: new Date().toISOString(),
    projectName,
    status: "passed",
    mode: "live",
    target: {
      deployment: "compose",
      workersProfile: "workers",
      billingEntitlementReconcileIntervalMs: billingIntervalMs,
      billingLifecycleEnforceIntervalMs: billingIntervalMs,
    },
    checks: [
      "compose_build_and_start",
      "migration_service",
      "explicit_development_seed",
      "secure_recreate_with_seeded_login_disabled",
      "admin_readiness_ready",
      "billing_entitlement_drift_created",
      "billing_entitlement_reconcile_worker_service_repaired_drift",
      "billing_lifecycle_deadline_created",
      "billing_lifecycle_enforce_worker_service_changed_status",
      "billing_worker_logs_redacted",
      "compose_logs_redacted",
    ],
    entitlement,
    lifecycle,
    logRedaction: {
      status: "passed",
      scanned: ["billing_worker_logs", "compose_logs"],
      forbiddenValues: 6,
    },
  });
} finally {
  compose(
    harness,
    [
      "--profile",
      "workers",
      "stop",
      "billing-entitlement-reconcile-worker",
      "billing-lifecycle-enforce-worker",
    ],
    { allowFailure: true },
  );
  if (!keep) {
    cleanupComposeHarness(harness);
  } else {
    process.stderr.write(
      `Keeping Compose project ${projectName} and env file ${harness.envPath} for inspection.\n`,
    );
  }
}

async function runEntitlementSchedulerProof() {
  const targetPlan = {
    code: "smoke_enterprise",
    name: "Smoke Enterprise",
    status: "active",
    source: "manual",
    externalCustomerId: "cus_smoke",
    externalSubscriptionId: "sub_smoke",
    quotaTemplates: [
      { metric: "tool.call", limit: 7, resetInterval: "monthly" },
      { metric: "run.started", limit: 11, resetInterval: "monthly" },
    ],
    metadata: {
      smoke: true,
      rawPayload: billingRawSentinel,
    },
  };
  await apiJson(harness, "/api/v1/billing/plan", {
    method: "POST",
    token: adminToken,
    body: targetPlan,
  });

  const quotas = await apiJson(harness, "/api/v1/quotas", {
    token: adminToken,
  });
  const toolQuota = quotas.data?.find((quota) => quota.metric === "tool.call");
  if (toolQuota === undefined) {
    throw new Error(
      "Billing plan did not create the expected tool.call quota.",
    );
  }
  await apiJson(harness, `/api/v1/quotas/${toolQuota.id}`, {
    method: "PATCH",
    token: adminToken,
    body: {
      limit: 1,
      resetInterval: "none",
      resetUsage: true,
    },
  });

  const before = await apiJson(harness, "/api/v1/billing/entitlements", {
    token: adminToken,
  });
  const beforeTool = entitlementQuota(before.data, "tool.call");
  if (
    before.data.status !== "attention_required" ||
    beforeTool.status !== "limit_and_reset_interval_mismatch"
  ) {
    throw new Error(
      `Expected quota drift before worker repair: ${JSON.stringify(before.data)}`,
    );
  }

  compose(harness, [
    "--profile",
    "workers",
    "up",
    "-d",
    "billing-entitlement-reconcile-worker",
  ]);
  const after = await waitForEntitlementRepair();
  const iterations = await waitForServiceIterations(
    "billing-entitlement-reconcile-worker",
    1,
  );
  compose(harness, [
    "--profile",
    "workers",
    "stop",
    "billing-entitlement-reconcile-worker",
  ]);
  assertWorkerLogsRedacted("billing-entitlement-reconcile-worker");

  const afterTool = entitlementQuota(after, "tool.call");
  return {
    worker: "billing-entitlement-reconcile-worker",
    iterations,
    before: {
      status: before.data.status,
      warnings: before.data.warnings,
      toolCallQuota: {
        expectedLimit: beforeTool.expectedLimit,
        actualLimit: beforeTool.actualLimit,
        expectedResetInterval: beforeTool.expectedResetInterval,
        actualResetInterval: beforeTool.actualResetInterval,
        status: beforeTool.status,
      },
    },
    after: {
      status: after.status,
      warnings: after.warnings,
      toolCallQuota: {
        expectedLimit: afterTool.expectedLimit,
        actualLimit: afterTool.actualLimit,
        expectedResetInterval: afterTool.expectedResetInterval,
        actualResetInterval: afterTool.actualResetInterval,
        status: afterTool.status,
      },
    },
  };
}

async function runLifecycleSchedulerProof() {
  const expiredTrialEndsAt = "2020-01-01T00:00:00.000Z";
  await apiJson(harness, "/api/v1/billing/plan", {
    method: "POST",
    token: adminToken,
    body: {
      code: "smoke_trial",
      name: "Smoke Trial",
      status: "trialing",
      source: "manual",
      externalCustomerId: "cus_smoke",
      externalSubscriptionId: "sub_smoke",
      quotaTemplates: [
        { metric: "tool.call", limit: 7, resetInterval: "monthly" },
        { metric: "run.started", limit: 11, resetInterval: "monthly" },
      ],
      metadata: {
        smoke: true,
        rawPayload: billingRawSentinel,
      },
      lifecycle: {
        trialEndsAt: expiredTrialEndsAt,
      },
    },
  });

  const before = await apiJson(harness, "/api/v1/billing/lifecycle", {
    token: adminToken,
  });
  if (
    before.data.recommendedAction !== "mark_past_due" ||
    before.data.billingPlan?.status !== "trialing"
  ) {
    throw new Error(
      `Expected expired trial before lifecycle worker: ${JSON.stringify(before.data)}`,
    );
  }

  compose(harness, [
    "--profile",
    "workers",
    "up",
    "-d",
    "billing-lifecycle-enforce-worker",
  ]);
  const after = await waitForLifecycleEnforcement();
  const iterations = await waitForServiceIterations(
    "billing-lifecycle-enforce-worker",
    1,
  );
  compose(harness, [
    "--profile",
    "workers",
    "stop",
    "billing-lifecycle-enforce-worker",
  ]);
  assertWorkerLogsRedacted("billing-lifecycle-enforce-worker");

  return {
    worker: "billing-lifecycle-enforce-worker",
    iterations,
    before: {
      status: before.data.status,
      recommendedAction: before.data.recommendedAction,
      warnings: before.data.warnings,
      billingStatus: before.data.billingPlan?.status,
    },
    after: {
      status: after.status,
      recommendedAction: after.recommendedAction,
      warnings: after.warnings,
      billingStatus: after.billingPlan?.status,
    },
  };
}

async function waitForEntitlementRepair() {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const report = await apiJson(harness, "/api/v1/billing/entitlements", {
      token: adminToken,
    });
    last = report.data;
    const toolQuota = entitlementQuota(last, "tool.call");
    if (
      last.status === "healthy" &&
      toolQuota.status === "matched" &&
      toolQuota.actualLimit === 7 &&
      toolQuota.actualResetInterval === "monthly"
    ) {
      return last;
    }
    await sleep(1000);
  }
  throw new Error(
    `Timed out waiting for billing entitlement worker repair: ${JSON.stringify(last)}`,
  );
}

async function waitForLifecycleEnforcement() {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const report = await apiJson(harness, "/api/v1/billing/lifecycle", {
      token: adminToken,
    });
    last = report.data;
    if (
      last.billingPlan?.status === "past_due" &&
      last.recommendedAction === "none"
    ) {
      return last;
    }
    await sleep(1000);
  }
  throw new Error(
    `Timed out waiting for billing lifecycle worker enforcement: ${JSON.stringify(last)}`,
  );
}

async function waitForServiceIterations(service, minimumCount) {
  const deadline = Date.now() + timeoutMs;
  let count = 0;
  while (Date.now() < deadline) {
    const logs = composeOutput(harness, ["logs", "--no-color", service], {
      allowFailure: true,
    });
    count = countOccurrences(`${logs.stdout}\n${logs.stderr}`, '"iteration"');
    if (count >= minimumCount) return count;
    await sleep(1000);
  }
  throw new Error(`${service} did not emit ${minimumCount} iteration logs.`);
}

function entitlementQuota(report, metric) {
  const quota = report.quotas?.find((item) => item.metric === metric);
  if (quota === undefined) {
    throw new Error(`Missing billing entitlement quota report for ${metric}.`);
  }
  return quota;
}

function assertWorkerLogsRedacted(service) {
  const logs = composeOutput(harness, ["logs", "--no-color", service], {
    allowFailure: true,
  });
  const text = `${logs.stdout}\n${logs.stderr}`;
  for (const value of [
    adminToken,
    harness.postgresPassword,
    harness.s3Secret,
    harness.sessionSecret,
    harness.webhookSigningKey,
    billingRawSentinel,
  ]) {
    if (typeof value === "string" && value.length > 0 && text.includes(value)) {
      throw new Error(`${service} logs leaked a generated secret or sentinel.`);
    }
  }
}

function countOccurrences(text, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
