import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const tenantPurgeEvidenceSchema = "romeo.tenant-purge-evidence.v1";

const requiredChecks = [
  "app_database_purge_executed",
  "app_object_store_purge_executed",
  "external_vector_store_reviewed",
  "backup_retention_reviewed",
  "operational_log_retention_reviewed",
  "support_bundle_retention_reviewed",
  "external_secret_store_reviewed",
  "tenant_purge_redaction_reviewed",
] as const;

const redactionFields = [
  "backupLocationsReturned",
  "evidenceFileBodiesReturned",
  "objectStoreKeysReturned",
  "operationalLogBodiesReturned",
  "rawEvidencePathsReturned",
  "secretValuesReturned",
  "supportBundleBodiesReturned",
  "vectorValuesReturned",
] as const;

type TenantPurgeEvidenceInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export type TenantPurgeEvidencePostureWarning =
  | "tenant_purge_app_database_missing"
  | "tenant_purge_app_object_store_missing"
  | "tenant_purge_backup_retention_missing"
  | "tenant_purge_deployment_invalid"
  | "tenant_purge_evidence_failed"
  | "tenant_purge_evidence_invalid"
  | "tenant_purge_evidence_not_configured"
  | "tenant_purge_evidence_not_live"
  | "tenant_purge_evidence_not_passed"
  | "tenant_purge_external_secret_store_missing"
  | "tenant_purge_external_vector_missing"
  | "tenant_purge_failure_codes_present"
  | "tenant_purge_operational_log_retention_missing"
  | "tenant_purge_redaction_missing"
  | "tenant_purge_required_checks_missing"
  | "tenant_purge_retention_days_missing"
  | "tenant_purge_storage_review_missing"
  | "tenant_purge_support_bundle_retention_missing";

export interface TenantPurgeEvidencePostureReport {
  schema: "romeo.tenant-purge-evidence-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: typeof tenantPurgeEvidenceSchema;
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: TenantPurgeEvidenceInvalidReason;
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<(typeof requiredChecks)[number]>;
  };
  purge: {
    tenantCount: number;
    databasePurgedTenantCount: number;
    objectStorePurgedTenantCount: number;
    externalVectorReviewedTenantCount: number;
    backupRetentionReviewedTenantCount: number;
    operationalLogRetentionReviewedTenantCount: number;
    supportBundleReviewedTenantCount: number;
    externalSecretReviewedTenantCount: number;
  };
  storage: {
    postgresRecordCount: number;
    objectStoreObjectCount: number;
    externalVectorNamespaceCount: number;
    backupSystemCount: number;
    operationalLogSystemCount: number;
    supportBundleSystemCount: number;
    secretStoreCount: number;
  };
  retention: {
    backupRetentionDays?: number;
    operationalLogRetentionDays?: number;
    supportBundleRetentionDays?: number;
  };
  redaction: {
    backupLocationsReturned: false;
    evidenceFileBodiesReturned: false;
    objectStoreKeysReturned: false;
    operationalLogBodiesReturned: false;
    rawEvidencePathsReturned: false;
    secretValuesReturned: false;
    supportBundleBodiesReturned: false;
    vectorValuesReturned: false;
  };
  warnings: TenantPurgeEvidencePostureWarning[];
}

export class TenantPurgeEvidencePostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(
    subject: AuthSubject,
  ): Promise<TenantPurgeEvidencePostureReport> {
    assertScope(subject, "admin:read");
    const generatedAt = new Date().toISOString();
    const evidence = await readEvidence(this.env.TENANT_PURGE_EVIDENCE_PATH);

    if (evidence.status === "not_configured") {
      return emptyReport({
        generatedAt,
        orgId: subject.orgId,
        warnings: ["tenant_purge_evidence_not_configured"],
      });
    }
    if (evidence.status === "invalid") {
      return emptyReport({
        generatedAt,
        invalidReason: evidence.invalidReason,
        orgId: subject.orgId,
        warnings: ["tenant_purge_evidence_invalid"],
      });
    }

    const summary = summarizeEvidence(evidence.data);
    return {
      schema: "romeo.tenant-purge-evidence-posture.v1",
      generatedAt,
      orgId: subject.orgId,
      status: summary.warnings.length === 0 ? "ready" : "attention_required",
      ...summary,
    };
  }
}

type ReadEvidenceResult =
  | { status: "not_configured" }
  | { status: "invalid"; invalidReason: TenantPurgeEvidenceInvalidReason }
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

  if (!isRecord(parsed) || parsed.schemaVersion !== tenantPurgeEvidenceSchema) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }
  return { status: "valid", data: parsed };
}

function emptyReport(input: {
  generatedAt: string;
  invalidReason?: TenantPurgeEvidenceInvalidReason;
  orgId: string;
  warnings: TenantPurgeEvidencePostureReport["warnings"];
}): TenantPurgeEvidencePostureReport {
  return {
    schema: "romeo.tenant-purge-evidence-posture.v1",
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
    purge: {
      tenantCount: 0,
      databasePurgedTenantCount: 0,
      objectStorePurgedTenantCount: 0,
      externalVectorReviewedTenantCount: 0,
      backupRetentionReviewedTenantCount: 0,
      operationalLogRetentionReviewedTenantCount: 0,
      supportBundleReviewedTenantCount: 0,
      externalSecretReviewedTenantCount: 0,
    },
    storage: {
      postgresRecordCount: 0,
      objectStoreObjectCount: 0,
      externalVectorNamespaceCount: 0,
      backupSystemCount: 0,
      operationalLogSystemCount: 0,
      supportBundleSystemCount: 0,
      secretStoreCount: 0,
    },
    retention: {},
    redaction: postureRedaction(),
    warnings: input.warnings,
  };
}

function summarizeEvidence(
  data: Record<string, unknown>,
): Omit<
  TenantPurgeEvidencePostureReport,
  "generatedAt" | "orgId" | "schema" | "status"
> {
  const checks = summarizeChecks(data.checks);
  const purge = summarizePurge(data.purge);
  const storage = summarizeStorage(data.storage);
  const retention = summarizeRetention(data.retention);
  const evidenceStatus = statusValue(data.status);
  const mode = modeValue(data.mode);
  const deployment = deploymentValue(data.deployment);
  const generatedAt = stringValue(data.generatedAt);
  const redactionPassed = allRedactionFlagsFalse(data.redaction);
  const hasEvidenceFailureCodes = asArray(data.failures).some(
    (failure) => typeof failure === "string" && failure.length > 0,
  );
  const failureCodes = Array.from(
    new Set([
      ...failureCodesForEvidence({
        checks,
        deployment,
        evidenceStatus,
        hasEvidenceFailureCodes,
        mode,
        purge,
        redactionPassed,
        retention,
        storage,
      }),
    ]),
  );
  const warnings = warningsForFailureCodes(failureCodes, {
    evidenceStatus,
    mode,
  });

  return {
    evidence: {
      configured: true,
      source: "configured_file",
      status:
        evidenceStatus === "planned" || mode === "dry-run"
          ? "planned"
          : failureCodes.length > 0
            ? "failed"
            : "satisfied",
      schemaVersion: tenantPurgeEvidenceSchema,
      ...(generatedAt === undefined ? {} : { generatedAt }),
      evidenceStatus,
      mode,
      deployment,
      failureCodes,
    },
    checks,
    purge,
    storage,
    retention,
    redaction: postureRedaction(),
    warnings,
  };
}

function summarizeChecks(
  input: unknown,
): TenantPurgeEvidencePostureReport["checks"] {
  const checkIds = asArray(input)
    .map((check) => {
      if (typeof check === "string") return check;
      if (isRecord(check) && typeof check.id === "string") return check.id;
      return undefined;
    })
    .filter((check): check is string => check !== undefined);
  const present = new Set(checkIds);
  const missingRequired = requiredChecks.filter((check) => !present.has(check));
  return {
    total: checkIds.length,
    requiredTotal: requiredChecks.length,
    requiredPresent: requiredChecks.length - missingRequired.length,
    missingRequired,
  };
}

function summarizePurge(
  input: unknown,
): TenantPurgeEvidencePostureReport["purge"] {
  const value = recordValue(input);
  return {
    tenantCount: safeCount(value.tenantCount),
    databasePurgedTenantCount: safeCount(value.databasePurgedTenantCount),
    objectStorePurgedTenantCount: safeCount(value.objectStorePurgedTenantCount),
    externalVectorReviewedTenantCount: safeCount(
      value.externalVectorReviewedTenantCount,
    ),
    backupRetentionReviewedTenantCount: safeCount(
      value.backupRetentionReviewedTenantCount,
    ),
    operationalLogRetentionReviewedTenantCount: safeCount(
      value.operationalLogRetentionReviewedTenantCount,
    ),
    supportBundleReviewedTenantCount: safeCount(
      value.supportBundleReviewedTenantCount,
    ),
    externalSecretReviewedTenantCount: safeCount(
      value.externalSecretReviewedTenantCount,
    ),
  };
}

function summarizeStorage(
  input: unknown,
): TenantPurgeEvidencePostureReport["storage"] {
  const value = recordValue(input);
  return {
    postgresRecordCount: safeCount(value.postgresRecordCount),
    objectStoreObjectCount: safeCount(value.objectStoreObjectCount),
    externalVectorNamespaceCount: safeCount(value.externalVectorNamespaceCount),
    backupSystemCount: safeCount(value.backupSystemCount),
    operationalLogSystemCount: safeCount(value.operationalLogSystemCount),
    supportBundleSystemCount: safeCount(value.supportBundleSystemCount),
    secretStoreCount: safeCount(value.secretStoreCount),
  };
}

function summarizeRetention(
  input: unknown,
): TenantPurgeEvidencePostureReport["retention"] {
  const value = recordValue(input);
  const backupRetentionDays = optionalSafeNumber(value.backupRetentionDays);
  const operationalLogRetentionDays = optionalSafeNumber(
    value.operationalLogRetentionDays,
  );
  const supportBundleRetentionDays = optionalSafeNumber(
    value.supportBundleRetentionDays,
  );
  const retention: TenantPurgeEvidencePostureReport["retention"] = {};
  if (backupRetentionDays !== undefined) {
    retention.backupRetentionDays = backupRetentionDays;
  }
  if (operationalLogRetentionDays !== undefined) {
    retention.operationalLogRetentionDays = operationalLogRetentionDays;
  }
  if (supportBundleRetentionDays !== undefined) {
    retention.supportBundleRetentionDays = supportBundleRetentionDays;
  }
  return retention;
}

function failureCodesForEvidence(input: {
  checks: TenantPurgeEvidencePostureReport["checks"];
  deployment: TenantPurgeEvidencePostureReport["evidence"]["deployment"];
  evidenceStatus: "failed" | "passed" | "planned" | "unknown";
  hasEvidenceFailureCodes: boolean;
  mode: "dry-run" | "live" | "unknown";
  purge: TenantPurgeEvidencePostureReport["purge"];
  redactionPassed: boolean;
  retention: TenantPurgeEvidencePostureReport["retention"];
  storage: TenantPurgeEvidencePostureReport["storage"];
}): string[] {
  const failures: string[] = [];
  if (input.evidenceStatus !== "passed") {
    failures.push("tenant_purge_not_passed");
  }
  if (input.mode !== "live") failures.push("tenant_purge_not_live");
  if (
    input.deployment !== "compose" &&
    input.deployment !== "kubernetes" &&
    input.deployment !== "target"
  ) {
    failures.push("tenant_purge_deployment_invalid");
  }
  for (const check of input.checks.missingRequired) {
    failures.push(`tenant_purge_missing_check:${check}`);
  }
  for (const field of [
    "tenantCount",
    "databasePurgedTenantCount",
    "objectStorePurgedTenantCount",
    "externalVectorReviewedTenantCount",
    "backupRetentionReviewedTenantCount",
    "operationalLogRetentionReviewedTenantCount",
    "supportBundleReviewedTenantCount",
    "externalSecretReviewedTenantCount",
  ] as const) {
    if (!positiveInteger(input.purge[field])) {
      failures.push(`tenant_purge_${field}_missing`);
    }
  }
  for (const field of [
    "postgresRecordCount",
    "objectStoreObjectCount",
    "externalVectorNamespaceCount",
    "backupSystemCount",
    "operationalLogSystemCount",
    "supportBundleSystemCount",
    "secretStoreCount",
  ] as const) {
    if (!positiveInteger(input.storage[field])) {
      failures.push(`tenant_purge_${field}_missing`);
    }
  }
  for (const field of [
    "backupRetentionDays",
    "operationalLogRetentionDays",
    "supportBundleRetentionDays",
  ] as const) {
    if (!positiveInteger(input.retention[field])) {
      failures.push(`tenant_purge_${field}_missing`);
    }
  }
  if (input.hasEvidenceFailureCodes) {
    failures.push("tenant_purge_failure_codes_present");
  }
  if (!input.redactionPassed) failures.push("tenant_purge_redaction_missing");
  return Array.from(new Set(failures));
}

function warningsForFailureCodes(
  failureCodes: string[],
  input: {
    evidenceStatus: "failed" | "passed" | "planned" | "unknown";
    mode: "dry-run" | "live" | "unknown";
  },
): TenantPurgeEvidencePostureReport["warnings"] {
  const warnings = new Set<TenantPurgeEvidencePostureWarning>();
  if (input.evidenceStatus === "failed") {
    warnings.add("tenant_purge_evidence_failed");
  }
  if (input.evidenceStatus !== "passed") {
    warnings.add("tenant_purge_evidence_not_passed");
  }
  if (input.mode !== "live") warnings.add("tenant_purge_evidence_not_live");
  for (const code of failureCodes) {
    if (code === "tenant_purge_deployment_invalid") {
      warnings.add("tenant_purge_deployment_invalid");
    } else if (code.startsWith("tenant_purge_missing_check:")) {
      warnings.add("tenant_purge_required_checks_missing");
    } else if (
      code === "tenant_purge_tenantCount_missing" ||
      code === "tenant_purge_databasePurgedTenantCount_missing"
    ) {
      warnings.add("tenant_purge_app_database_missing");
    } else if (code === "tenant_purge_objectStorePurgedTenantCount_missing") {
      warnings.add("tenant_purge_app_object_store_missing");
    } else if (
      code === "tenant_purge_externalVectorReviewedTenantCount_missing"
    ) {
      warnings.add("tenant_purge_external_vector_missing");
    } else if (
      code === "tenant_purge_backupRetentionReviewedTenantCount_missing"
    ) {
      warnings.add("tenant_purge_backup_retention_missing");
    } else if (
      code === "tenant_purge_operationalLogRetentionReviewedTenantCount_missing"
    ) {
      warnings.add("tenant_purge_operational_log_retention_missing");
    } else if (
      code === "tenant_purge_supportBundleReviewedTenantCount_missing"
    ) {
      warnings.add("tenant_purge_support_bundle_retention_missing");
    } else if (
      code === "tenant_purge_externalSecretReviewedTenantCount_missing"
    ) {
      warnings.add("tenant_purge_external_secret_store_missing");
    } else if (
      code === "tenant_purge_postgresRecordCount_missing" ||
      code === "tenant_purge_objectStoreObjectCount_missing" ||
      code === "tenant_purge_externalVectorNamespaceCount_missing" ||
      code === "tenant_purge_backupSystemCount_missing" ||
      code === "tenant_purge_operationalLogSystemCount_missing" ||
      code === "tenant_purge_supportBundleSystemCount_missing" ||
      code === "tenant_purge_secretStoreCount_missing"
    ) {
      warnings.add("tenant_purge_storage_review_missing");
    } else if (
      code === "tenant_purge_backupRetentionDays_missing" ||
      code === "tenant_purge_operationalLogRetentionDays_missing" ||
      code === "tenant_purge_supportBundleRetentionDays_missing"
    ) {
      warnings.add("tenant_purge_retention_days_missing");
    } else if (code === "tenant_purge_failure_codes_present") {
      warnings.add("tenant_purge_failure_codes_present");
    } else if (code === "tenant_purge_redaction_missing") {
      warnings.add("tenant_purge_redaction_missing");
    }
  }
  return Array.from(warnings);
}

function allRedactionFlagsFalse(input: unknown): boolean {
  const value = recordValue(input);
  return redactionFields.every((field) => value[field] === false);
}

function postureRedaction(): TenantPurgeEvidencePostureReport["redaction"] {
  return {
    backupLocationsReturned: false,
    evidenceFileBodiesReturned: false,
    objectStoreKeysReturned: false,
    operationalLogBodiesReturned: false,
    rawEvidencePathsReturned: false,
    secretValuesReturned: false,
    supportBundleBodiesReturned: false,
    vectorValuesReturned: false,
  };
}

function statusValue(
  input: unknown,
): "failed" | "passed" | "planned" | "unknown" {
  if (input === "failed" || input === "passed" || input === "planned") {
    return input;
  }
  return "unknown";
}

function modeValue(input: unknown): "dry-run" | "live" | "unknown" {
  if (input === "dry-run" || input === "live") return input;
  return "unknown";
}

function deploymentValue(
  input: unknown,
): "compose" | "kubernetes" | "target" | "unknown" {
  if (input === "compose" || input === "kubernetes" || input === "target") {
    return input;
  }
  return "unknown";
}

function optionalSafeNumber(input: unknown): number | undefined {
  return typeof input === "number" && Number.isFinite(input) && input >= 0
    ? input
    : undefined;
}

function safeCount(input: unknown): number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0
    ? input
    : 0;
}

function positiveInteger(input: unknown): boolean {
  return typeof input === "number" && Number.isSafeInteger(input) && input > 0;
}

function stringValue(input: unknown): string | undefined {
  return typeof input === "string" && input.length > 0 ? input : undefined;
}

function recordValue(input: unknown): Record<string, unknown> {
  return isRecord(input) ? input : {};
}

function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
