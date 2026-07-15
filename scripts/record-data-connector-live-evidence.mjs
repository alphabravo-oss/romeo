import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const requiredChecks = [
  "managed_connector_sync_exercised",
  "worker_cni_egress_enforced",
  "dns_private_address_denied",
  "secret_ref_resolution_verified",
  "worker_crash_retry_or_requeue_verified",
  "sync_log_redaction",
  "sanitized_readback_verified",
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
const managedConnectorTypeCount = nonNegativeInteger(
  argValue("--managed-connector-type-count"),
  { fallback: "1", label: "--managed-connector-type-count" },
);
const syncAttemptCount = nonNegativeInteger(argValue("--sync-attempt-count"), {
  fallback: "1",
  label: "--sync-attempt-count",
});
const successfulSyncCount = nonNegativeInteger(
  argValue("--successful-sync-count"),
  { fallback: "1", label: "--successful-sync-count" },
);
const failedSyncCount = nonNegativeInteger(argValue("--failed-sync-count"), {
  fallback: "0",
  label: "--failed-sync-count",
});
const secretRefConnectorCount = nonNegativeInteger(
  argValue("--secret-ref-connector-count"),
  { fallback: "1", label: "--secret-ref-connector-count" },
);
const delegatedOAuthConnectorCount = nonNegativeInteger(
  argValue("--delegated-oauth-connector-count"),
  { fallback: "0", label: "--delegated-oauth-connector-count" },
);
const deniedPrivateTargetCount = nonNegativeInteger(
  argValue("--denied-private-target-count"),
  { fallback: "1", label: "--denied-private-target-count" },
);
const workerCniOrNetworkPolicyEnforced = booleanArg(
  "--worker-cni-or-network-policy-enforced",
  true,
);
const allowlistRequired = booleanArg("--allowlist-required", true);
const privateNetworkDenied = booleanArg("--private-network-denied", true);
const dnsRebindingDenied = booleanArg("--dns-rebinding-denied", true);
const deniedPrivateNetworkCount = nonNegativeInteger(
  argValue("--denied-private-network-count"),
  { fallback: "1", label: "--denied-private-network-count" },
);
const allowedExternalHostCount = nonNegativeInteger(
  argValue("--allowed-external-host-count"),
  { fallback: "1", label: "--allowed-external-host-count" },
);
const workerExecutionVerified = booleanArg(
  "--worker-execution-verified",
  true,
);
const crashRetryOrRequeueVerified = booleanArg(
  "--crash-retry-or-requeue-verified",
  true,
);
const requeuedSyncCount = nonNegativeInteger(argValue("--requeued-sync-count"), {
  fallback: "1",
  label: "--requeued-sync-count",
});
const completedAfterRetry = booleanArg("--completed-after-retry", true);
const secretRefResolutionVerified = booleanArg(
  "--secret-ref-resolution-verified",
  true,
);
const secretResolverBoundaryVerified = booleanArg(
  "--secret-resolver-boundary-verified",
  true,
);
const secretRawValuesReturned = booleanArg(
  "--secret-raw-values-returned",
  false,
);
const tokenValuesReturned = booleanArg("--token-values-returned", false);
const syncLogRedactionVerified = booleanArg(
  "--sync-log-redaction-verified",
  true,
);
const podLogRedactionVerified = booleanArg(
  "--pod-log-redaction-verified",
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
const connectorContentSentinelHitCount = nonNegativeInteger(
  argValue("--connector-content-sentinel-hit-count"),
  { fallback: "0", label: "--connector-content-sentinel-hit-count" },
);
const secretSentinelHitCount = nonNegativeInteger(
  argValue("--secret-sentinel-hit-count"),
  { fallback: "0", label: "--secret-sentinel-hit-count" },
);
const tokenSentinelHitCount = nonNegativeInteger(
  argValue("--token-sentinel-hit-count"),
  { fallback: "0", label: "--token-sentinel-hit-count" },
);
const adminPostureReadbackVerified = booleanArg(
  "--admin-posture-readback-verified",
  true,
);
const syncHistoryReadbackVerified = booleanArg(
  "--sync-history-readback-verified",
  true,
);
const rawAllowedHostsReturned = booleanArg("--raw-allowed-hosts-returned", false);
const rawConnectorConfigReturned = booleanArg(
  "--raw-connector-config-returned",
  false,
);
const rawConnectorContentReturned = booleanArg(
  "--raw-connector-content-returned",
  false,
);
const rawEndpointUrlsReturned = booleanArg(
  "--raw-endpoint-urls-returned",
  false,
);
const rawEvidencePathsReturned = booleanArg(
  "--raw-evidence-paths-returned",
  false,
);
const rawLogLinesReturned = booleanArg("--raw-log-lines-returned", false);
const rawSecretRefsReturned = booleanArg("--raw-secret-refs-returned", false);
const secretValuesReturned = booleanArg("--secret-values-returned", false);
const redactionTokenValuesReturned = booleanArg(
  "--redaction-token-values-returned",
  false,
);
const failureCodes = argValues("--failure-code");

const failures = validationFailures();
if (status === "passed" && failures.length > 0) {
  throw new Error(
    `Passed data connector live evidence is invalid: ${failures.join(", ")}`,
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
  schemaVersion: "romeo.data-connector-live-evidence.v1",
  generatedAt: new Date().toISOString(),
  status,
  mode,
  deployment,
  checks,
  connectors: {
    managedConnectorTypeCount,
    syncAttemptCount,
    successfulSyncCount,
    failedSyncCount,
    secretRefConnectorCount,
    delegatedOAuthConnectorCount,
    deniedPrivateTargetCount,
  },
  egress: {
    workerCniOrNetworkPolicyEnforced,
    allowlistRequired,
    privateNetworkDenied,
    dnsRebindingDenied,
    deniedPrivateNetworkCount,
    allowedExternalHostCount,
  },
  worker: {
    workerExecutionVerified,
    crashRetryOrRequeueVerified,
    requeuedSyncCount,
    completedAfterRetry,
  },
  secrets: {
    secretRefResolutionVerified,
    secretResolverBoundaryVerified,
    rawSecretValuesReturned: secretRawValuesReturned,
    tokenValuesReturned,
  },
  logRedaction: {
    syncLogRedactionVerified,
    podLogRedactionVerified,
    podLogScanCount,
    workerLogScanCount,
    connectorContentSentinelHitCount,
    secretSentinelHitCount,
    tokenSentinelHitCount,
  },
  readback: {
    adminPostureReadbackVerified,
    syncHistoryReadbackVerified,
  },
  failures:
    status === "passed" ? [] : [...new Set([...failureCodes, ...failures])],
  redaction: {
    rawAllowedHostsReturned,
    rawConnectorConfigReturned,
    rawConnectorContentReturned,
    rawEndpointUrlsReturned,
    rawEvidencePathsReturned,
    rawLogLinesReturned,
    rawSecretRefsReturned,
    secretValuesReturned,
    tokenValuesReturned: redactionTokenValuesReturned,
  },
};

writeJson(resolve(process.cwd(), output), evidence);
console.log(`Wrote data connector live evidence to ${output}`);

function validationFailures() {
  const failures = [];
  if (mode !== "live") failures.push("live_mode_required");
  if (
    managedConnectorTypeCount <= 0 ||
    syncAttemptCount <= 0 ||
    successfulSyncCount <= 0
  ) {
    failures.push("managed_connector_sync_missing");
  }
  if (
    !workerCniOrNetworkPolicyEnforced ||
    !allowlistRequired ||
    !privateNetworkDenied ||
    deniedPrivateNetworkCount <= 0 ||
    allowedExternalHostCount <= 0
  ) {
    failures.push("worker_cni_egress_missing");
  }
  if (!dnsRebindingDenied || deniedPrivateTargetCount <= 0) {
    failures.push("dns_private_address_denial_missing");
  }
  if (
    !secretRefResolutionVerified ||
    !secretResolverBoundaryVerified ||
    secretRefConnectorCount <= 0 ||
    secretRawValuesReturned ||
    tokenValuesReturned
  ) {
    failures.push("secret_ref_resolution_missing");
  }
  if (
    !workerExecutionVerified ||
    !crashRetryOrRequeueVerified ||
    requeuedSyncCount <= 0 ||
    !completedAfterRetry
  ) {
    failures.push("worker_crash_retry_or_requeue_missing");
  }
  if (
    !syncLogRedactionVerified ||
    !podLogRedactionVerified ||
    podLogScanCount <= 0 ||
    workerLogScanCount <= 0 ||
    connectorContentSentinelHitCount > 0 ||
    secretSentinelHitCount > 0 ||
    tokenSentinelHitCount > 0
  ) {
    failures.push("sync_log_redaction_missing");
  }
  if (!adminPostureReadbackVerified || !syncHistoryReadbackVerified) {
    failures.push("sanitized_readback_missing");
  }
  if (
    rawAllowedHostsReturned ||
    rawConnectorConfigReturned ||
    rawConnectorContentReturned ||
    rawEndpointUrlsReturned ||
    rawEvidencePathsReturned ||
    rawLogLinesReturned ||
    rawSecretRefsReturned ||
    secretValuesReturned ||
    redactionTokenValuesReturned
  ) {
    failures.push("redaction_missing");
  }
  return failures;
}

function checkFailure(check) {
  return {
    dns_private_address_denied: "dns_private_address_denial_missing",
    managed_connector_sync_exercised: "managed_connector_sync_missing",
    sanitized_readback_verified: "sanitized_readback_missing",
    secret_ref_resolution_verified: "secret_ref_resolution_missing",
    sync_log_redaction: "sync_log_redaction_missing",
    worker_cni_egress_enforced: "worker_cni_egress_missing",
    worker_crash_retry_or_requeue_verified:
      "worker_crash_retry_or_requeue_missing",
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
