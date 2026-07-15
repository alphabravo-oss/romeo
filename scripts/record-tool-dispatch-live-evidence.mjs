import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const requiredChecks = [
  "worker_claim_execution_verified",
  "managed_payload_read_verified",
  "mcp_streamable_http_tools_call_verified",
  "worker_cni_egress_enforced",
  "dns_private_address_denied",
  "secret_resolution_verified",
  "worker_crash_retry_or_reclaim_verified",
  "response_schema_validation_verified",
  "worker_log_redaction",
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

const dispatchRequestCount = nonNegativeInteger(
  argValue("--dispatch-request-count"),
  { fallback: "1", label: "--dispatch-request-count" },
);
const completedDispatchCount = nonNegativeInteger(
  argValue("--completed-dispatch-count"),
  { fallback: "1", label: "--completed-dispatch-count" },
);
const failedDispatchCount = nonNegativeInteger(
  argValue("--failed-dispatch-count"),
  { fallback: "0", label: "--failed-dispatch-count" },
);
const managedPayloadReadCount = nonNegativeInteger(
  argValue("--managed-payload-read-count"),
  { fallback: "1", label: "--managed-payload-read-count" },
);
const externalPayloadCount = nonNegativeInteger(
  argValue("--external-payload-count"),
  { fallback: "0", label: "--external-payload-count" },
);
const workerClaimExecutionVerified = booleanArg(
  "--worker-claim-execution-verified",
  true,
);
const managedPayloadReadVerified = booleanArg(
  "--managed-payload-read-verified",
  true,
);
const mcpStreamableHttpToolsCallVerified = booleanArg(
  "--mcp-streamable-http-tools-call-verified",
  true,
);
const mcpProtocolHeadersVerified = booleanArg(
  "--mcp-protocol-headers-verified",
  true,
);
const mcpJsonRpcEnvelopeVerified = booleanArg(
  "--mcp-json-rpc-envelope-verified",
  true,
);
const mcpCallCount = nonNegativeInteger(argValue("--mcp-call-count"), {
  fallback: "1",
  label: "--mcp-call-count",
});
const mcpPayloadArgumentsRedacted = booleanArg(
  "--mcp-payload-arguments-redacted",
  true,
);
const mcpOutputRedacted = booleanArg("--mcp-output-redacted", true);
const workerCniOrNetworkPolicyEnforced = booleanArg(
  "--worker-cni-or-network-policy-enforced",
  true,
);
const privateNetworkDenied = booleanArg("--private-network-denied", true);
const dnsPrivateAddressDenied = booleanArg(
  "--dns-private-address-denied",
  true,
);
const deniedPrivateTargetCount = nonNegativeInteger(
  argValue("--denied-private-target-count"),
  { fallback: "1", label: "--denied-private-target-count" },
);
const redirectDenied = booleanArg("--redirect-denied", true);
const httpsOnly = booleanArg("--https-only", true);
const secretResolutionVerified = booleanArg(
  "--secret-resolution-verified",
  true,
);
const secretResolverBoundaryVerified = booleanArg(
  "--secret-resolver-boundary-verified",
  true,
);
const secretResolutionCount = nonNegativeInteger(
  argValue("--secret-resolution-count"),
  { fallback: "1", label: "--secret-resolution-count" },
);
const oauthTokenRedactionVerified = booleanArg(
  "--oauth-token-redaction-verified",
  true,
);
const workerCrashRetryOrReclaimVerified = booleanArg(
  "--worker-crash-retry-or-reclaim-verified",
  true,
);
const reclaimedDispatchCount = nonNegativeInteger(
  argValue("--reclaimed-dispatch-count"),
  { fallback: "1", label: "--reclaimed-dispatch-count" },
);
const completedAfterReclaim = booleanArg("--completed-after-reclaim", true);
const responseSchemaValidationVerified = booleanArg(
  "--response-schema-validation-verified",
  true,
);
const schemaValidationCount = nonNegativeInteger(
  argValue("--schema-validation-count"),
  { fallback: "1", label: "--schema-validation-count" },
);
const invalidResponseFailedClosed = booleanArg(
  "--invalid-response-failed-closed",
  true,
);
const workerLogRedactionVerified = booleanArg(
  "--worker-log-redaction-verified",
  true,
);
const podLogRedactionVerified = booleanArg(
  "--pod-log-redaction-verified",
  true,
);
const workerLogScanCount = nonNegativeInteger(
  argValue("--worker-log-scan-count"),
  { fallback: "1", label: "--worker-log-scan-count" },
);
const podLogScanCount = nonNegativeInteger(argValue("--pod-log-scan-count"), {
  fallback: "1",
  label: "--pod-log-scan-count",
});
const payloadSentinelHitCount = nonNegativeInteger(
  argValue("--payload-sentinel-hit-count"),
  { fallback: "0", label: "--payload-sentinel-hit-count" },
);
const responseSentinelHitCount = nonNegativeInteger(
  argValue("--response-sentinel-hit-count"),
  { fallback: "0", label: "--response-sentinel-hit-count" },
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
const dispatchReadbackVerified = booleanArg(
  "--dispatch-readback-verified",
  true,
);
const rawOperationHostsReturned = booleanArg(
  "--raw-operation-hosts-returned",
  false,
);
const rawPayloadValuesReturned = booleanArg(
  "--raw-payload-values-returned",
  false,
);
const rawResponseBodiesReturned = booleanArg(
  "--raw-response-bodies-returned",
  false,
);
const rawObjectStoreKeysReturned = booleanArg(
  "--raw-object-store-keys-returned",
  false,
);
const rawSecretRefsReturned = booleanArg("--raw-secret-refs-returned", false);
const rawEvidencePathsReturned = booleanArg(
  "--raw-evidence-paths-returned",
  false,
);
const rawLogLinesReturned = booleanArg("--raw-log-lines-returned", false);
const secretValuesReturned = booleanArg("--secret-values-returned", false);
const tokenValuesReturned = booleanArg("--token-values-returned", false);
const failureCodes = argValues("--failure-code");

const failures = validationFailures();
if (status === "passed" && failures.length > 0) {
  throw new Error(
    `Passed tool-dispatch live evidence is invalid: ${failures.join(", ")}`,
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
  schemaVersion: "romeo.tool-dispatch-live-evidence.v1",
  generatedAt: new Date().toISOString(),
  status,
  mode,
  deployment,
  checks,
  operations: {
    dispatchRequestCount,
    completedDispatchCount,
    failedDispatchCount,
    managedPayloadReadCount,
    externalPayloadCount,
    workerClaimExecutionVerified,
    managedPayloadReadVerified,
  },
  mcp: {
    streamableHttpToolsCallVerified: mcpStreamableHttpToolsCallVerified,
    protocolHeadersVerified: mcpProtocolHeadersVerified,
    jsonRpcEnvelopeVerified: mcpJsonRpcEnvelopeVerified,
    callCount: mcpCallCount,
    payloadArgumentsRedacted: mcpPayloadArgumentsRedacted,
    outputRedacted: mcpOutputRedacted,
  },
  egress: {
    workerCniOrNetworkPolicyEnforced,
    privateNetworkDenied,
    dnsPrivateAddressDenied,
    deniedPrivateTargetCount,
    redirectDenied,
    httpsOnly,
  },
  secrets: {
    secretResolutionVerified,
    secretResolverBoundaryVerified,
    secretResolutionCount,
    oauthTokenRedactionVerified,
    secretValuesReturned,
    tokenValuesReturned,
  },
  worker: {
    workerCrashRetryOrReclaimVerified,
    reclaimedDispatchCount,
    completedAfterReclaim,
  },
  responseValidation: {
    responseSchemaValidationVerified,
    schemaValidationCount,
    invalidResponseFailedClosed,
  },
  logRedaction: {
    workerLogRedactionVerified,
    podLogRedactionVerified,
    workerLogScanCount,
    podLogScanCount,
    payloadSentinelHitCount,
    responseSentinelHitCount,
    secretSentinelHitCount,
    tokenSentinelHitCount,
  },
  readback: {
    adminPostureReadbackVerified,
    dispatchReadbackVerified,
  },
  failures:
    status === "passed" ? [] : [...new Set([...failureCodes, ...failures])],
  redaction: {
    rawEvidencePathsReturned,
    rawLogLinesReturned,
    rawObjectStoreKeysReturned,
    rawOperationHostsReturned,
    rawPayloadValuesReturned,
    rawResponseBodiesReturned,
    rawSecretRefsReturned,
    secretValuesReturned,
    tokenValuesReturned,
  },
};

writeJson(resolve(process.cwd(), output), evidence);
console.log(`Wrote tool-dispatch live evidence to ${output}`);

function validationFailures() {
  const failures = [];
  if (mode !== "live") failures.push("live_mode_required");
  if (
    !workerClaimExecutionVerified ||
    dispatchRequestCount <= 0 ||
    completedDispatchCount <= 0
  ) {
    failures.push("worker_claim_execution_missing");
  }
  if (!managedPayloadReadVerified || managedPayloadReadCount <= 0) {
    failures.push("managed_payload_read_missing");
  }
  if (
    !mcpStreamableHttpToolsCallVerified ||
    !mcpProtocolHeadersVerified ||
    !mcpJsonRpcEnvelopeVerified ||
    mcpCallCount <= 0 ||
    !mcpPayloadArgumentsRedacted ||
    !mcpOutputRedacted
  ) {
    failures.push("mcp_streamable_http_tools_call_missing");
  }
  if (
    !workerCniOrNetworkPolicyEnforced ||
    !privateNetworkDenied ||
    !redirectDenied ||
    !httpsOnly ||
    deniedPrivateTargetCount <= 0
  ) {
    failures.push("worker_cni_egress_missing");
  }
  if (!dnsPrivateAddressDenied || deniedPrivateTargetCount <= 0) {
    failures.push("dns_private_address_denial_missing");
  }
  if (
    !secretResolutionVerified ||
    !secretResolverBoundaryVerified ||
    !oauthTokenRedactionVerified ||
    secretResolutionCount <= 0 ||
    secretValuesReturned ||
    tokenValuesReturned
  ) {
    failures.push("secret_resolution_missing");
  }
  if (
    !workerCrashRetryOrReclaimVerified ||
    reclaimedDispatchCount <= 0 ||
    !completedAfterReclaim
  ) {
    failures.push("worker_crash_retry_or_reclaim_missing");
  }
  if (
    !responseSchemaValidationVerified ||
    schemaValidationCount <= 0 ||
    !invalidResponseFailedClosed
  ) {
    failures.push("response_schema_validation_missing");
  }
  if (
    !workerLogRedactionVerified ||
    !podLogRedactionVerified ||
    workerLogScanCount <= 0 ||
    podLogScanCount <= 0 ||
    payloadSentinelHitCount > 0 ||
    responseSentinelHitCount > 0 ||
    secretSentinelHitCount > 0 ||
    tokenSentinelHitCount > 0
  ) {
    failures.push("worker_log_redaction_missing");
  }
  if (!adminPostureReadbackVerified || !dispatchReadbackVerified) {
    failures.push("sanitized_readback_missing");
  }
  if (
    rawEvidencePathsReturned ||
    rawLogLinesReturned ||
    rawObjectStoreKeysReturned ||
    rawOperationHostsReturned ||
    rawPayloadValuesReturned ||
    rawResponseBodiesReturned ||
    rawSecretRefsReturned ||
    secretValuesReturned ||
    tokenValuesReturned
  ) {
    failures.push("redaction_missing");
  }
  return failures;
}

function checkFailure(check) {
  return {
    dns_private_address_denied: "dns_private_address_denial_missing",
    managed_payload_read_verified: "managed_payload_read_missing",
    mcp_streamable_http_tools_call_verified:
      "mcp_streamable_http_tools_call_missing",
    response_schema_validation_verified: "response_schema_validation_missing",
    sanitized_readback_verified: "sanitized_readback_missing",
    secret_resolution_verified: "secret_resolution_missing",
    worker_claim_execution_verified: "worker_claim_execution_missing",
    worker_cni_egress_enforced: "worker_cni_egress_missing",
    worker_crash_retry_or_reclaim_verified:
      "worker_crash_retry_or_reclaim_missing",
    worker_log_redaction: "worker_log_redaction_missing",
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
