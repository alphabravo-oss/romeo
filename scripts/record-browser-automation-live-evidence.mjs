import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const requiredChecks = [
  "reviewed_runner_sandbox",
  "network_denial_enforced",
  "worker_crash_retry",
  "retention_worker_execution",
  "pod_log_redaction",
];

const output = argValue("--output");
if (output === undefined || output.length === 0) {
  throw new Error("--output is required.");
}

const status = enumArg("--status", ["passed", "failed", "planned"], "passed");
const mode = enumArg("--mode", ["live", "dry-run"], "live");
const deployment = enumArg(
  "--deployment",
  ["kubernetes", "target"],
  "kubernetes",
);
const reviewedRunnerSandbox = booleanArg("--reviewed-runner-sandbox", true);
const isolatedContextPerTask = booleanArg("--isolated-context-per-task", true);
const runnerProcessIsolated = booleanArg("--runner-process-isolated", true);
const targetOriginOnly = booleanArg("--target-origin-only", true);
const privateNetworkDenied = booleanArg("--private-network-denied", true);
const cniOrNetworkPolicyDenied = booleanArg(
  "--cni-or-network-policy-denied",
  true,
);
const dnsRebindingDenied = booleanArg("--dns-rebinding-denied", true);
const deniedNetworkCount = nonNegativeInteger(
  argValue("--denied-network-count"),
  { fallback: "1", label: "--denied-network-count" },
);
const blockedTargetCount = nonNegativeInteger(
  argValue("--blocked-target-count"),
  {
    fallback: "1",
    label: "--blocked-target-count",
  },
);
const workerCrashRetryVerified = booleanArg(
  "--worker-crash-retry-verified",
  true,
);
const reclaimedAttempt = nonNegativeInteger(argValue("--reclaimed-attempt"), {
  fallback: "2",
  label: "--reclaimed-attempt",
});
const completedAfterRetry = booleanArg("--completed-after-retry", true);
const retentionWorkerExecutionVerified = booleanArg(
  "--retention-worker-execution-verified",
  true,
);
const deletedArtifactCount = nonNegativeInteger(
  argValue("--deleted-artifact-count"),
  { fallback: "1", label: "--deleted-artifact-count" },
);
const cleanedJobCount = nonNegativeInteger(argValue("--cleaned-job-count"), {
  fallback: "1",
  label: "--cleaned-job-count",
});
const podLogRedactionVerified = booleanArg(
  "--pod-log-redaction-verified",
  true,
);
const workerLogRedactionVerified = booleanArg(
  "--worker-log-redaction-verified",
  true,
);
const podLogScanCount = nonNegativeInteger(argValue("--pod-log-scan-count"), {
  fallback: "1",
  label: "--pod-log-scan-count",
});
const workerLogScanCount = nonNegativeInteger(
  argValue("--worker-log-scan-count"),
  { fallback: "1", label: "--worker-log-scan-count" },
);
const rawTaskSentinelHitCount = nonNegativeInteger(
  argValue("--raw-task-sentinel-hit-count"),
  { fallback: "0", label: "--raw-task-sentinel-hit-count" },
);
const rawPageSentinelHitCount = nonNegativeInteger(
  argValue("--raw-page-sentinel-hit-count"),
  { fallback: "0", label: "--raw-page-sentinel-hit-count" },
);
const secretSentinelHitCount = nonNegativeInteger(
  argValue("--secret-sentinel-hit-count"),
  { fallback: "0", label: "--secret-sentinel-hit-count" },
);
const artifactBytesReturned = booleanArg("--artifact-bytes-returned", false);
const rawEvidencePathsReturned = booleanArg(
  "--raw-evidence-paths-returned",
  false,
);
const rawPageContentReturned = booleanArg("--raw-page-content-returned", false);
const rawRunnerUrlReturned = booleanArg("--raw-runner-url-returned", false);
const rawTaskTextReturned = booleanArg("--raw-task-text-returned", false);
const secretValuesReturned = booleanArg("--secret-values-returned", false);
const failureCodes = argValues("--failure-code");

const failures = validationFailures();
if (status === "passed" && failures.length > 0) {
  throw new Error(
    `Passed browser automation live evidence is invalid: ${failures.join(", ")}`,
  );
}
if (status === "passed" && failureCodes.length > 0) {
  throw new Error("--failure-code can only be supplied with failed/planned.");
}

const checks =
  status === "passed"
    ? [...requiredChecks]
    : requiredChecks.filter((check) => !failures.includes(checkFailure(check)));

const evidence = {
  schemaVersion: "romeo.browser-automation-live-evidence.v1",
  generatedAt: new Date().toISOString(),
  status,
  mode,
  deployment,
  checks,
  runnerSandbox: {
    reviewedRunnerSandbox,
    isolatedContextPerTask,
    runnerProcessIsolated,
    targetOriginOnly,
  },
  networkDenial: {
    privateNetworkDenied,
    cniOrNetworkPolicyDenied,
    dnsRebindingDenied,
    deniedNetworkCount,
    blockedTargetCount,
  },
  crashRetry: {
    workerCrashRetryVerified,
    reclaimedAttempt,
    completedAfterRetry,
  },
  retention: {
    workerExecutionVerified: retentionWorkerExecutionVerified,
    deletedArtifactCount,
    cleanedJobCount,
  },
  logRedaction: {
    podLogRedactionVerified,
    workerLogRedactionVerified,
    podLogScanCount,
    workerLogScanCount,
    rawTaskSentinelHitCount,
    rawPageSentinelHitCount,
    secretSentinelHitCount,
  },
  failures:
    status === "passed" ? [] : [...new Set([...failureCodes, ...failures])],
  redaction: {
    artifactBytesReturned,
    rawEvidencePathsReturned,
    rawPageContentReturned,
    rawRunnerUrlReturned,
    rawTaskTextReturned,
    secretValuesReturned,
  },
};

writeJson(resolve(process.cwd(), output), evidence);
console.log(`Wrote browser automation live evidence to ${output}`);

function validationFailures() {
  const failures = [];
  if (mode !== "live") failures.push("live_mode_required");
  if (
    !reviewedRunnerSandbox ||
    !isolatedContextPerTask ||
    !runnerProcessIsolated ||
    !targetOriginOnly
  ) {
    failures.push("runner_sandbox_missing");
  }
  if (
    !privateNetworkDenied ||
    !cniOrNetworkPolicyDenied ||
    !dnsRebindingDenied ||
    deniedNetworkCount <= 0 ||
    blockedTargetCount <= 0
  ) {
    failures.push("network_denial_missing");
  }
  if (
    !workerCrashRetryVerified ||
    reclaimedAttempt < 2 ||
    !completedAfterRetry
  ) {
    failures.push("worker_crash_retry_missing");
  }
  if (
    !retentionWorkerExecutionVerified ||
    deletedArtifactCount <= 0 ||
    cleanedJobCount <= 0
  ) {
    failures.push("retention_worker_missing");
  }
  if (
    !podLogRedactionVerified ||
    !workerLogRedactionVerified ||
    podLogScanCount <= 0 ||
    workerLogScanCount <= 0 ||
    rawTaskSentinelHitCount > 0 ||
    rawPageSentinelHitCount > 0 ||
    secretSentinelHitCount > 0
  ) {
    failures.push("pod_log_redaction_missing");
  }
  if (
    artifactBytesReturned ||
    rawEvidencePathsReturned ||
    rawPageContentReturned ||
    rawRunnerUrlReturned ||
    rawTaskTextReturned ||
    secretValuesReturned
  ) {
    failures.push("redaction_missing");
  }
  return failures;
}

function checkFailure(check) {
  return {
    network_denial_enforced: "network_denial_missing",
    pod_log_redaction: "pod_log_redaction_missing",
    retention_worker_execution: "retention_worker_missing",
    reviewed_runner_sandbox: "runner_sandbox_missing",
    worker_crash_retry: "worker_crash_retry_missing",
  }[check];
}

function enumArg(name, allowedValues, fallback) {
  const value = argValue(name) ?? fallback;
  if (value === undefined || !allowedValues.includes(value)) {
    throw new Error(`${name} must be one of: ${allowedValues.join(", ")}.`);
  }
  return value;
}

function booleanArg(name, fallback) {
  const value = argValue(name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function nonNegativeInteger(value, options) {
  const resolved = value ?? options.fallback;
  if (resolved === undefined) return undefined;
  const parsed = Number.parseInt(resolved, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${options.label} must be a non-negative integer.`);
  }
  return parsed;
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

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}
