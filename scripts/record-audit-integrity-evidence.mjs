import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const requiredChecks = [
  "audit_export_configured",
  "siem_delivery_readback",
  "immutable_storage_reviewed",
  "retention_policy_reviewed",
  "time_sync_reviewed",
  "checksum_chain_verified",
  "audit_evidence_redaction_flags",
];

const output = argValue("--output");
if (output === undefined || output.length === 0) {
  throw new Error("--output is required.");
}

const status = enumArg("--status", ["passed", "failed", "planned"], "passed");
const mode = enumArg("--mode", ["live", "dry-run"], "live");
const deployment = enumArg(
  "--deployment",
  ["compose", "kubernetes", "target"],
  "kubernetes",
);
const destinationType = enumArg(
  "--destination-type",
  ["siem", "object_store", "both", "none"],
  "siem",
);
const successfulDeliveryCount = nonNegativeInteger(
  argValue("--successful-delivery-count"),
  { fallback: "1", label: "--successful-delivery-count" },
);
const failedDeliveryCount = nonNegativeInteger(
  argValue("--failed-delivery-count"),
  { fallback: "0", label: "--failed-delivery-count" },
);
const lastDeliveryStatus = enumArg(
  "--last-delivery-status",
  ["passed", "failed"],
  "passed",
);
const wormStorageConfigured = booleanArg("--worm-storage-configured", true);
const retentionLockConfigured = booleanArg("--retention-lock-configured", true);
const immutableWindowDays = nonNegativeInteger(
  argValue("--immutable-window-days"),
  { fallback: "30", label: "--immutable-window-days" },
);
const deleteProtectionReviewed = booleanArg(
  "--delete-protection-reviewed",
  true,
);
const auditLogRetentionDays = nonNegativeInteger(
  argValue("--audit-log-retention-days"),
  { fallback: "365", label: "--audit-log-retention-days" },
);
const exportRetentionDays = nonNegativeInteger(
  argValue("--export-retention-days"),
  { fallback: "365", label: "--export-retention-days" },
);
const retentionPolicyReviewed = booleanArg("--retention-policy-reviewed", true);
const timeSyncSourceConfigured = booleanArg(
  "--time-sync-source-configured",
  true,
);
const checkedHostCount = nonNegativeInteger(argValue("--checked-host-count"), {
  fallback: "1",
  label: "--checked-host-count",
});
const maxClockSkewMs = nonNegativeInteger(argValue("--max-clock-skew-ms"), {
  fallback: "100",
  label: "--max-clock-skew-ms",
});
const driftWithinThreshold = booleanArg("--drift-within-threshold", true);
const checksumChainChecked = booleanArg("--checksum-chain-checked", true);
const checksumChainStatus = enumArg(
  "--checksum-chain-status",
  ["passed", "failed"],
  "passed",
);
const verifiedRecordCount = nonNegativeInteger(
  argValue("--verified-record-count"),
  { fallback: "1", label: "--verified-record-count" },
);
const brokenLinkCount = nonNegativeInteger(argValue("--broken-link-count"), {
  fallback: "0",
  label: "--broken-link-count",
});
const failureCodes = argValues("--failure-code");

const failures = validationFailures();
if (status === "passed" && failures.length > 0) {
  throw new Error(
    `Passed audit integrity evidence is invalid: ${failures.join(", ")}`,
  );
}
if (status === "passed" && failureCodes.length > 0) {
  throw new Error("--failure-code can only be supplied with failed/planned.");
}

const evidence = {
  schemaVersion: "romeo.audit-integrity-evidence.v1",
  generatedAt: new Date().toISOString(),
  status,
  mode,
  deployment,
  checks: [...requiredChecks],
  export: {
    enabled: destinationType !== "none",
    destinationType,
    successfulDeliveryCount,
    failedDeliveryCount,
    lastDeliveryStatus,
  },
  immutability: {
    wormStorageConfigured,
    retentionLockConfigured,
    immutableWindowDays,
    deleteProtectionReviewed,
  },
  retention: {
    auditLogRetentionDays,
    exportRetentionDays,
    policyReviewed: retentionPolicyReviewed,
  },
  timeSync: {
    sourceConfigured: timeSyncSourceConfigured,
    checkedHostCount,
    maxClockSkewMs,
    driftWithinThreshold,
  },
  checksumChain: {
    checked: checksumChainChecked,
    status: checksumChainStatus,
    verifiedRecordCount,
    brokenLinkCount,
  },
  failures:
    status === "passed" ? [] : [...new Set([...failureCodes, ...failures])],
  redaction: {
    rawAuditMetadataReturned: false,
    rawActorIdentifiersReturned: false,
    rawDestinationReturned: false,
    rawSiemPayloadsReturned: false,
    rawEvidencePathsReturned: false,
    secretValuesReturned: false,
  },
};

writeJson(resolve(process.cwd(), output), evidence);
console.log(`Wrote audit integrity evidence to ${output}`);

function validationFailures() {
  const failures = [];
  if (mode !== "live") failures.push("live_mode_required");
  if (destinationType === "none") failures.push("audit_export_missing");
  if (successfulDeliveryCount <= 0 || lastDeliveryStatus !== "passed") {
    failures.push("siem_delivery_readback_missing");
  }
  if (
    !wormStorageConfigured ||
    !retentionLockConfigured ||
    immutableWindowDays <= 0 ||
    !deleteProtectionReviewed
  ) {
    failures.push("immutable_storage_missing");
  }
  if (
    !retentionPolicyReviewed ||
    auditLogRetentionDays <= 0 ||
    exportRetentionDays <= 0
  ) {
    failures.push("retention_policy_missing");
  }
  if (
    !timeSyncSourceConfigured ||
    checkedHostCount <= 0 ||
    !driftWithinThreshold
  ) {
    failures.push("time_sync_missing");
  }
  if (
    !checksumChainChecked ||
    checksumChainStatus !== "passed" ||
    verifiedRecordCount <= 0 ||
    brokenLinkCount > 0
  ) {
    failures.push("checksum_chain_missing");
  }
  return failures;
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

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
