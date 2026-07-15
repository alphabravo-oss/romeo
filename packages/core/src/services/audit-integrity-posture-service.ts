import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const auditIntegrityEvidenceSchema = "romeo.audit-integrity-evidence.v1";

const requiredChecks = [
  "audit_export_configured",
  "siem_delivery_readback",
  "immutable_storage_reviewed",
  "retention_policy_reviewed",
  "time_sync_reviewed",
  "checksum_chain_verified",
  "audit_evidence_redaction_flags",
] as const;

const redactionFields = [
  "rawAuditMetadataReturned",
  "rawActorIdentifiersReturned",
  "rawDestinationReturned",
  "rawSiemPayloadsReturned",
  "rawEvidencePathsReturned",
  "secretValuesReturned",
] as const;

type AuditIntegrityInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

type AuditDeliveryStatus = "failed" | "passed" | "unknown";

export type AuditIntegrityPostureWarning =
  | "audit_integrity_chain_missing"
  | "audit_integrity_delivery_missing"
  | "audit_integrity_deployment_invalid"
  | "audit_integrity_evidence_failed"
  | "audit_integrity_evidence_invalid"
  | "audit_integrity_evidence_not_configured"
  | "audit_integrity_evidence_not_live"
  | "audit_integrity_export_missing"
  | "audit_integrity_failure_codes_present"
  | "audit_integrity_immutability_missing"
  | "audit_integrity_redaction_missing"
  | "audit_integrity_required_checks_missing"
  | "audit_integrity_retention_missing"
  | "audit_integrity_time_sync_missing";

export interface AuditIntegrityPostureReport {
  schema: "romeo.audit-integrity-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: typeof auditIntegrityEvidenceSchema;
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: AuditIntegrityInvalidReason;
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<(typeof requiredChecks)[number]>;
  };
  export: {
    enabled: boolean;
    destinationType: "both" | "none" | "object_store" | "siem" | "unknown";
    successfulDeliveryCount: number;
    failedDeliveryCount: number;
    lastDeliveryStatus: AuditDeliveryStatus;
  };
  immutability: {
    wormStorageConfigured: boolean;
    retentionLockConfigured: boolean;
    immutableWindowDays?: number;
    deleteProtectionReviewed: boolean;
  };
  retention: {
    auditLogRetentionDays?: number;
    exportRetentionDays?: number;
    policyReviewed: boolean;
  };
  timeSync: {
    sourceConfigured: boolean;
    checkedHostCount: number;
    maxClockSkewMs?: number;
    driftWithinThreshold: boolean;
  };
  checksumChain: {
    checked: boolean;
    status: AuditDeliveryStatus;
    verifiedRecordCount: number;
    brokenLinkCount: number;
  };
  redaction: {
    evidenceFileBodyReturned: false;
    rawActorIdentifiersReturned: false;
    rawAuditMetadataReturned: false;
    rawDestinationReturned: false;
    rawEvidencePathsReturned: false;
    rawSiemPayloadsReturned: false;
    secretValuesReturned: false;
  };
  warnings: AuditIntegrityPostureWarning[];
}

export class AuditIntegrityPostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<AuditIntegrityPostureReport> {
    assertScope(subject, "admin:read");
    const generatedAt = new Date().toISOString();
    const evidence = await readEvidence(this.env.AUDIT_INTEGRITY_EVIDENCE_PATH);

    if (evidence.status === "not_configured") {
      return emptyReport({
        generatedAt,
        orgId: subject.orgId,
        warnings: ["audit_integrity_evidence_not_configured"],
      });
    }
    if (evidence.status === "invalid") {
      return emptyReport({
        generatedAt,
        invalidReason: evidence.invalidReason,
        orgId: subject.orgId,
        warnings: ["audit_integrity_evidence_invalid"],
      });
    }

    const summary = summarizeEvidence(evidence.data);
    return {
      schema: "romeo.audit-integrity-posture.v1",
      generatedAt,
      orgId: subject.orgId,
      status: summary.warnings.length === 0 ? "ready" : "attention_required",
      ...summary,
    };
  }
}

type ReadEvidenceResult =
  | { status: "not_configured" }
  | { status: "invalid"; invalidReason: AuditIntegrityInvalidReason }
  | { status: "valid"; data: Record<string, unknown> };

async function readEvidence(evidencePath: string): Promise<ReadEvidenceResult> {
  const configuredPath = evidencePath.trim();
  if (configuredPath.length === 0) return { status: "not_configured" };

  let raw: string;
  try {
    raw = await readFile(configuredPath, "utf8");
  } catch {
    return { status: "invalid", invalidReason: "read_failed" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", invalidReason: "invalid_json" };
  }

  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== auditIntegrityEvidenceSchema
  ) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }

  return { status: "valid", data: parsed };
}

function emptyReport(input: {
  generatedAt: string;
  invalidReason?: AuditIntegrityInvalidReason;
  orgId: string;
  warnings: AuditIntegrityPostureReport["warnings"];
}): AuditIntegrityPostureReport {
  return {
    schema: "romeo.audit-integrity-posture.v1",
    generatedAt: input.generatedAt,
    orgId: input.orgId,
    status: "attention_required",
    evidence: {
      configured: input.invalidReason !== undefined,
      source:
        input.invalidReason === undefined
          ? "not_configured"
          : "configured_file",
      status: input.invalidReason === undefined ? "not_configured" : "invalid",
      ...(input.invalidReason === undefined
        ? {}
        : { invalidReason: input.invalidReason }),
      failureCodes:
        input.invalidReason === undefined ? [] : [input.invalidReason],
    },
    checks: {
      total: 0,
      requiredTotal: requiredChecks.length,
      requiredPresent: 0,
      missingRequired: [...requiredChecks],
    },
    export: {
      enabled: false,
      destinationType: "none",
      successfulDeliveryCount: 0,
      failedDeliveryCount: 0,
      lastDeliveryStatus: "unknown",
    },
    immutability: {
      wormStorageConfigured: false,
      retentionLockConfigured: false,
      deleteProtectionReviewed: false,
    },
    retention: {
      policyReviewed: false,
    },
    timeSync: {
      sourceConfigured: false,
      checkedHostCount: 0,
      driftWithinThreshold: false,
    },
    checksumChain: {
      checked: false,
      status: "unknown",
      verifiedRecordCount: 0,
      brokenLinkCount: 0,
    },
    redaction: postureRedaction(),
    warnings: input.warnings,
  };
}

function summarizeEvidence(
  data: Record<string, unknown>,
): Omit<
  AuditIntegrityPostureReport,
  "generatedAt" | "orgId" | "schema" | "status"
> {
  const checks = summarizeChecks(data.checks);
  const exportPosture = summarizeExport(data.export);
  const immutability = summarizeImmutability(data.immutability);
  const retention = summarizeRetention(data.retention);
  const timeSync = summarizeTimeSync(data.timeSync);
  const checksumChain = summarizeChecksumChain(data.checksumChain);
  const redactionPassed = allRedactionFlagsFalse(data.redaction);
  const evidenceStatus = statusValue(data.status);
  const mode = modeValue(data.mode);
  const deployment = deploymentValue(data.deployment);
  const generatedAt = stringValue(data.generatedAt);
  const hasEvidenceFailureCodes = asArray(data.failures).some(
    (failure) => typeof failure === "string" && failure.length > 0,
  );
  const failureCodes = Array.from(
    new Set([
      ...failureCodesForEvidence({
        checks,
        checksumChain,
        deployment,
        evidenceStatus,
        exportPosture,
        hasEvidenceFailureCodes,
        immutability,
        mode,
        redactionPassed,
        retention,
        timeSync,
      }),
    ]),
  );
  const warnings = warningsForFailureCodes(failureCodes, {
    evidenceStatus,
    mode,
    redactionPassed,
  });
  const postureStatus =
    evidenceStatus === "planned" || mode === "dry-run"
      ? "planned"
      : failureCodes.length > 0
        ? "failed"
        : "satisfied";

  return {
    evidence: {
      configured: true,
      source: "configured_file",
      status: postureStatus,
      schemaVersion: auditIntegrityEvidenceSchema,
      ...(generatedAt === undefined ? {} : { generatedAt }),
      evidenceStatus,
      mode,
      deployment,
      failureCodes,
    },
    checks,
    export: exportPosture,
    immutability,
    retention,
    timeSync,
    checksumChain,
    redaction: postureRedaction(),
    warnings,
  };
}

function summarizeChecks(
  value: unknown,
): AuditIntegrityPostureReport["checks"] {
  const present = new Set(
    asArray(value).filter((item): item is string => typeof item === "string"),
  );
  const missingRequired = requiredChecks.filter((check) => !present.has(check));
  return {
    total: present.size,
    requiredTotal: requiredChecks.length,
    requiredPresent: requiredChecks.length - missingRequired.length,
    missingRequired,
  };
}

function summarizeExport(
  value: unknown,
): AuditIntegrityPostureReport["export"] {
  if (!isRecord(value)) {
    return {
      enabled: false,
      destinationType: "none",
      successfulDeliveryCount: 0,
      failedDeliveryCount: 0,
      lastDeliveryStatus: "unknown",
    };
  }
  return {
    enabled: value.enabled === true,
    destinationType: destinationTypeValue(value.destinationType),
    successfulDeliveryCount: nonNegativeNumber(value.successfulDeliveryCount),
    failedDeliveryCount: nonNegativeNumber(value.failedDeliveryCount),
    lastDeliveryStatus: deliveryStatusValue(value.lastDeliveryStatus),
  };
}

function summarizeImmutability(
  value: unknown,
): AuditIntegrityPostureReport["immutability"] {
  const record = isRecord(value) ? value : {};
  return {
    wormStorageConfigured: record.wormStorageConfigured === true,
    retentionLockConfigured: record.retentionLockConfigured === true,
    ...(typeof record.immutableWindowDays === "number" &&
    Number.isFinite(record.immutableWindowDays) &&
    record.immutableWindowDays >= 0
      ? { immutableWindowDays: record.immutableWindowDays }
      : {}),
    deleteProtectionReviewed: record.deleteProtectionReviewed === true,
  };
}

function summarizeRetention(
  value: unknown,
): AuditIntegrityPostureReport["retention"] {
  const record = isRecord(value) ? value : {};
  return {
    ...(typeof record.auditLogRetentionDays === "number" &&
    Number.isFinite(record.auditLogRetentionDays) &&
    record.auditLogRetentionDays >= 0
      ? { auditLogRetentionDays: record.auditLogRetentionDays }
      : {}),
    ...(typeof record.exportRetentionDays === "number" &&
    Number.isFinite(record.exportRetentionDays) &&
    record.exportRetentionDays >= 0
      ? { exportRetentionDays: record.exportRetentionDays }
      : {}),
    policyReviewed: record.policyReviewed === true,
  };
}

function summarizeTimeSync(
  value: unknown,
): AuditIntegrityPostureReport["timeSync"] {
  const record = isRecord(value) ? value : {};
  return {
    sourceConfigured: record.sourceConfigured === true,
    checkedHostCount: nonNegativeNumber(record.checkedHostCount),
    ...(typeof record.maxClockSkewMs === "number" &&
    Number.isFinite(record.maxClockSkewMs) &&
    record.maxClockSkewMs >= 0
      ? { maxClockSkewMs: record.maxClockSkewMs }
      : {}),
    driftWithinThreshold: record.driftWithinThreshold === true,
  };
}

function summarizeChecksumChain(
  value: unknown,
): AuditIntegrityPostureReport["checksumChain"] {
  const record = isRecord(value) ? value : {};
  return {
    checked: record.checked === true,
    status: deliveryStatusValue(record.status),
    verifiedRecordCount: nonNegativeNumber(record.verifiedRecordCount),
    brokenLinkCount: nonNegativeNumber(record.brokenLinkCount),
  };
}

function failureCodesForEvidence(input: {
  checks: AuditIntegrityPostureReport["checks"];
  checksumChain: AuditIntegrityPostureReport["checksumChain"];
  deployment: AuditIntegrityPostureReport["evidence"]["deployment"];
  evidenceStatus: AuditIntegrityPostureReport["evidence"]["evidenceStatus"];
  exportPosture: AuditIntegrityPostureReport["export"];
  hasEvidenceFailureCodes: boolean;
  immutability: AuditIntegrityPostureReport["immutability"];
  mode: AuditIntegrityPostureReport["evidence"]["mode"];
  redactionPassed: boolean;
  retention: AuditIntegrityPostureReport["retention"];
  timeSync: AuditIntegrityPostureReport["timeSync"];
}): string[] {
  const failures: string[] = [];
  const maxClockSkewMs = input.timeSync.maxClockSkewMs;
  if (input.evidenceStatus !== "passed") {
    failures.push("audit_integrity_not_passed");
  }
  if (input.mode !== "live") failures.push("audit_integrity_not_live");
  if (
    input.deployment !== "compose" &&
    input.deployment !== "kubernetes" &&
    input.deployment !== "target"
  ) {
    failures.push("audit_integrity_deployment_invalid");
  }
  for (const check of input.checks.missingRequired) {
    failures.push(`audit_integrity_missing_check:${check}`);
  }
  if (
    !input.exportPosture.enabled ||
    !["both", "object_store", "siem"].includes(
      input.exportPosture.destinationType,
    )
  ) {
    failures.push("audit_integrity_export_missing");
  }
  if (
    !positiveInteger(input.exportPosture.successfulDeliveryCount) ||
    !Number.isInteger(input.exportPosture.failedDeliveryCount) ||
    input.exportPosture.failedDeliveryCount < 0 ||
    input.exportPosture.successfulDeliveryCount <= 0 ||
    input.exportPosture.lastDeliveryStatus !== "passed"
  ) {
    failures.push("audit_integrity_delivery_missing");
  }
  if (
    !input.immutability.wormStorageConfigured ||
    !input.immutability.retentionLockConfigured ||
    !input.immutability.deleteProtectionReviewed ||
    !positiveInteger(input.immutability.immutableWindowDays)
  ) {
    failures.push("audit_integrity_immutability_missing");
  }
  if (
    !input.retention.policyReviewed ||
    !positiveInteger(input.retention.auditLogRetentionDays) ||
    !positiveInteger(input.retention.exportRetentionDays)
  ) {
    failures.push("audit_integrity_retention_missing");
  }
  if (
    !input.timeSync.sourceConfigured ||
    !positiveInteger(input.timeSync.checkedHostCount) ||
    !Number.isInteger(maxClockSkewMs) ||
    typeof maxClockSkewMs !== "number" ||
    maxClockSkewMs < 0 ||
    !input.timeSync.driftWithinThreshold
  ) {
    failures.push("audit_integrity_time_sync_missing");
  }
  if (
    !input.checksumChain.checked ||
    input.checksumChain.status !== "passed" ||
    !positiveInteger(input.checksumChain.verifiedRecordCount) ||
    input.checksumChain.brokenLinkCount !== 0
  ) {
    failures.push("audit_integrity_checksum_chain_missing");
  }
  if (input.hasEvidenceFailureCodes) {
    failures.push("audit_integrity_failure_codes_present");
  }
  if (!input.redactionPassed) {
    failures.push("audit_integrity_redaction_missing");
  }
  return [...new Set(failures)];
}

function warningsForFailureCodes(
  failureCodes: string[],
  input: {
    evidenceStatus: AuditIntegrityPostureReport["evidence"]["evidenceStatus"];
    mode: AuditIntegrityPostureReport["evidence"]["mode"];
    redactionPassed: boolean;
  },
): AuditIntegrityPostureReport["warnings"] {
  const warnings = new Set<AuditIntegrityPostureWarning>();
  if (input.mode !== "live") warnings.add("audit_integrity_evidence_not_live");
  if (input.evidenceStatus !== "passed") {
    warnings.add("audit_integrity_evidence_failed");
  }
  if (failureCodes.includes("audit_integrity_deployment_invalid")) {
    warnings.add("audit_integrity_deployment_invalid");
  }
  if (
    failureCodes.some((code) =>
      code.startsWith("audit_integrity_missing_check:"),
    )
  ) {
    warnings.add("audit_integrity_required_checks_missing");
  }
  if (failureCodes.includes("audit_integrity_export_missing")) {
    warnings.add("audit_integrity_export_missing");
  }
  if (failureCodes.includes("audit_integrity_delivery_missing")) {
    warnings.add("audit_integrity_delivery_missing");
  }
  if (failureCodes.includes("audit_integrity_immutability_missing")) {
    warnings.add("audit_integrity_immutability_missing");
  }
  if (failureCodes.includes("audit_integrity_retention_missing")) {
    warnings.add("audit_integrity_retention_missing");
  }
  if (failureCodes.includes("audit_integrity_time_sync_missing")) {
    warnings.add("audit_integrity_time_sync_missing");
  }
  if (failureCodes.includes("audit_integrity_checksum_chain_missing")) {
    warnings.add("audit_integrity_chain_missing");
  }
  if (failureCodes.includes("audit_integrity_failure_codes_present")) {
    warnings.add("audit_integrity_failure_codes_present");
  }
  if (!input.redactionPassed) warnings.add("audit_integrity_redaction_missing");
  return [...warnings].sort();
}

function allRedactionFlagsFalse(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return redactionFields.every((field) => value[field] === false);
}

function postureRedaction(): AuditIntegrityPostureReport["redaction"] {
  return {
    evidenceFileBodyReturned: false,
    rawActorIdentifiersReturned: false,
    rawAuditMetadataReturned: false,
    rawDestinationReturned: false,
    rawEvidencePathsReturned: false,
    rawSiemPayloadsReturned: false,
    secretValuesReturned: false,
  };
}

function statusValue(
  value: unknown,
): "failed" | "passed" | "planned" | "unknown" {
  if (value === "failed" || value === "passed" || value === "planned") {
    return value;
  }
  return "unknown";
}

function modeValue(value: unknown): "dry-run" | "live" | "unknown" {
  if (value === "dry-run" || value === "live") return value;
  return "unknown";
}

function deploymentValue(
  value: unknown,
): "compose" | "kubernetes" | "target" | "unknown" {
  if (value === "compose" || value === "kubernetes" || value === "target") {
    return value;
  }
  return "unknown";
}

function deliveryStatusValue(value: unknown): AuditDeliveryStatus {
  return value === "failed" || value === "passed" ? value : "unknown";
}

function destinationTypeValue(
  value: unknown,
): AuditIntegrityPostureReport["export"]["destinationType"] {
  if (
    value === "both" ||
    value === "none" ||
    value === "object_store" ||
    value === "siem"
  ) {
    return value;
  }
  return "unknown";
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function positiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
