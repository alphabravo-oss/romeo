import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const migrationDrillEvidenceSchema = "romeo.migration-drill-evidence.v1";

const requiredChecks = [
  "failed_migration_injected",
  "migration_failure_detected",
  "migration_job_failed_closed",
  "app_cutover_blocked",
  "rollback_or_retry_verified",
  "schema_validation_after_recovery",
  "migration_log_redaction",
  "operator_runbook_reviewed",
] as const;

const redactionFields = [
  "databaseUrlsReturned",
  "migrationSqlReturned",
  "migrationLogsReturned",
  "rawErrorStacksReturned",
  "rawEvidencePathsReturned",
  "secretValuesReturned",
] as const;

type MigrationDrillInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export type MigrationDrillPostureWarning =
  | "migration_drill_deployment_invalid"
  | "migration_drill_evidence_failed"
  | "migration_drill_evidence_invalid"
  | "migration_drill_evidence_not_configured"
  | "migration_drill_evidence_not_live"
  | "migration_drill_evidence_not_passed"
  | "migration_drill_failure_codes_present"
  | "migration_drill_failure_behavior_missing"
  | "migration_drill_injection_missing"
  | "migration_drill_recovery_missing"
  | "migration_drill_redaction_missing"
  | "migration_drill_required_checks_missing"
  | "migration_drill_runbook_missing"
  | "migration_drill_validation_missing";

export interface MigrationDrillPostureReport {
  schema: "romeo.migration-drill-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: typeof migrationDrillEvidenceSchema;
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: MigrationDrillInvalidReason;
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<(typeof requiredChecks)[number]>;
  };
  drill: {
    attemptedMigrationCount: number;
    failedMigrationCount: number;
    failureInjected: boolean;
    cutoverBlocked: boolean;
  };
  job: {
    migrationJobObserved: boolean;
    failedClosed: boolean;
    retryAttemptCount: number;
    rollbackAttemptCount: number;
  };
  validation: {
    rollbackOrRetryVerified: boolean;
    schemaValidationPassed: boolean;
    appReadinessPassed: boolean;
    postRecoveryMigrationCount: number;
  };
  runbook: {
    reviewed: boolean;
    recoveryDocumented: boolean;
    reviewerCount: number;
  };
  redaction: {
    databaseUrlsReturned: false;
    evidenceFileBodyReturned: false;
    migrationLogsReturned: false;
    migrationSqlReturned: false;
    rawErrorStacksReturned: false;
    rawEvidencePathsReturned: false;
    secretValuesReturned: false;
  };
  warnings: MigrationDrillPostureWarning[];
}

export class MigrationDrillPostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<MigrationDrillPostureReport> {
    assertScope(subject, "admin:read");
    const generatedAt = new Date().toISOString();
    const evidence = await readEvidence(this.env.MIGRATION_DRILL_EVIDENCE_PATH);

    if (evidence.status === "not_configured") {
      return emptyReport({
        generatedAt,
        orgId: subject.orgId,
        warnings: ["migration_drill_evidence_not_configured"],
      });
    }
    if (evidence.status === "invalid") {
      return emptyReport({
        generatedAt,
        invalidReason: evidence.invalidReason,
        orgId: subject.orgId,
        warnings: ["migration_drill_evidence_invalid"],
      });
    }

    const summary = summarizeEvidence(evidence.data);
    return {
      schema: "romeo.migration-drill-posture.v1",
      generatedAt,
      orgId: subject.orgId,
      status: summary.warnings.length === 0 ? "ready" : "attention_required",
      ...summary,
    };
  }
}

type ReadEvidenceResult =
  | { status: "not_configured" }
  | { status: "invalid"; invalidReason: MigrationDrillInvalidReason }
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
    parsed.schemaVersion !== migrationDrillEvidenceSchema
  ) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }

  return { status: "valid", data: parsed };
}

function emptyReport(input: {
  generatedAt: string;
  invalidReason?: MigrationDrillInvalidReason;
  orgId: string;
  warnings: MigrationDrillPostureReport["warnings"];
}): MigrationDrillPostureReport {
  return {
    schema: "romeo.migration-drill-posture.v1",
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
    drill: {
      attemptedMigrationCount: 0,
      failedMigrationCount: 0,
      failureInjected: false,
      cutoverBlocked: false,
    },
    job: {
      migrationJobObserved: false,
      failedClosed: false,
      retryAttemptCount: 0,
      rollbackAttemptCount: 0,
    },
    validation: {
      rollbackOrRetryVerified: false,
      schemaValidationPassed: false,
      appReadinessPassed: false,
      postRecoveryMigrationCount: 0,
    },
    runbook: {
      reviewed: false,
      recoveryDocumented: false,
      reviewerCount: 0,
    },
    redaction: postureRedaction(),
    warnings: input.warnings,
  };
}

function summarizeEvidence(
  data: Record<string, unknown>,
): Omit<
  MigrationDrillPostureReport,
  "generatedAt" | "orgId" | "schema" | "status"
> {
  const checks = summarizeChecks(data.checks);
  const drill = summarizeDrill(data.drill);
  const job = summarizeJob(data.job);
  const validation = summarizeValidation(data.validation);
  const runbook = summarizeRunbook(data.runbook);
  const redactionPassed = allRedactionFlagsFalse(data.redaction);
  const evidenceStatus = statusValue(data.status);
  const mode = modeValue(data.mode);
  const deployment = deploymentValue(data.deployment);
  const generatedAt = stringValue(data.generatedAt);
  const hasEvidenceFailureCodes = asArray(data.failures).length > 0;
  const failureCodes = Array.from(
    new Set([
      ...failureCodesForEvidence({
        checks,
        deployment,
        drill,
        evidenceStatus,
        hasEvidenceFailureCodes,
        job,
        mode,
        redactionPassed,
        runbook,
        validation,
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
      schemaVersion: migrationDrillEvidenceSchema,
      ...(generatedAt === undefined ? {} : { generatedAt }),
      evidenceStatus,
      mode,
      deployment,
      failureCodes,
    },
    checks,
    drill,
    job,
    validation,
    runbook,
    redaction: postureRedaction(),
    warnings,
  };
}

function summarizeChecks(
  input: unknown,
): MigrationDrillPostureReport["checks"] {
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

function summarizeDrill(input: unknown): MigrationDrillPostureReport["drill"] {
  const value = recordValue(input);
  return {
    attemptedMigrationCount: safeCount(value.attemptedMigrationCount),
    failedMigrationCount: safeCount(value.failedMigrationCount),
    failureInjected: value.failureInjected === true,
    cutoverBlocked: value.cutoverBlocked === true,
  };
}

function summarizeJob(input: unknown): MigrationDrillPostureReport["job"] {
  const value = recordValue(input);
  return {
    migrationJobObserved: value.migrationJobObserved === true,
    failedClosed: value.failedClosed === true,
    retryAttemptCount: safeCount(value.retryAttemptCount),
    rollbackAttemptCount: safeCount(value.rollbackAttemptCount),
  };
}

function summarizeValidation(
  input: unknown,
): MigrationDrillPostureReport["validation"] {
  const value = recordValue(input);
  return {
    rollbackOrRetryVerified: value.rollbackOrRetryVerified === true,
    schemaValidationPassed: value.schemaValidationPassed === true,
    appReadinessPassed: value.appReadinessPassed === true,
    postRecoveryMigrationCount: safeCount(value.postRecoveryMigrationCount),
  };
}

function summarizeRunbook(
  input: unknown,
): MigrationDrillPostureReport["runbook"] {
  const value = recordValue(input);
  return {
    reviewed: value.reviewed === true,
    recoveryDocumented: value.recoveryDocumented === true,
    reviewerCount: safeCount(value.reviewerCount),
  };
}

function failureCodesForEvidence(input: {
  checks: MigrationDrillPostureReport["checks"];
  deployment: MigrationDrillPostureReport["evidence"]["deployment"];
  drill: MigrationDrillPostureReport["drill"];
  evidenceStatus: "failed" | "passed" | "planned" | "unknown";
  hasEvidenceFailureCodes: boolean;
  job: MigrationDrillPostureReport["job"];
  mode: "dry-run" | "live" | "unknown";
  redactionPassed: boolean;
  runbook: MigrationDrillPostureReport["runbook"];
  validation: MigrationDrillPostureReport["validation"];
}): string[] {
  const failures: string[] = [];
  if (input.evidenceStatus !== "passed") {
    failures.push("migration_drill_not_passed");
  }
  if (input.mode !== "live") {
    failures.push("migration_drill_not_live");
  }
  if (
    input.deployment !== "compose" &&
    input.deployment !== "kubernetes" &&
    input.deployment !== "target"
  ) {
    failures.push("migration_drill_deployment_invalid");
  }
  for (const check of input.checks.missingRequired) {
    failures.push(`migration_drill_missing_check:${check}`);
  }
  if (
    !input.drill.failureInjected ||
    input.drill.attemptedMigrationCount <= 0 ||
    input.drill.failedMigrationCount <= 0
  ) {
    failures.push("migration_drill_injection_missing");
  }
  if (
    !input.drill.cutoverBlocked ||
    !input.job.migrationJobObserved ||
    !input.job.failedClosed ||
    input.job.retryAttemptCount + input.job.rollbackAttemptCount <= 0
  ) {
    failures.push("migration_drill_failure_behavior_missing");
  }
  if (
    !input.validation.rollbackOrRetryVerified ||
    !input.validation.schemaValidationPassed ||
    !input.validation.appReadinessPassed ||
    input.validation.postRecoveryMigrationCount <= 0
  ) {
    failures.push("migration_drill_recovery_missing");
  }
  if (
    !input.runbook.reviewed ||
    !input.runbook.recoveryDocumented ||
    input.runbook.reviewerCount <= 0
  ) {
    failures.push("migration_drill_runbook_missing");
  }
  if (input.hasEvidenceFailureCodes) {
    failures.push("migration_drill_failure_codes_present");
  }
  if (!input.redactionPassed) {
    failures.push("migration_drill_redaction_missing");
  }
  return Array.from(new Set(failures));
}

function warningsForFailureCodes(
  failureCodes: string[],
  input: {
    evidenceStatus: "failed" | "passed" | "planned" | "unknown";
    mode: "dry-run" | "live" | "unknown";
  },
): MigrationDrillPostureReport["warnings"] {
  const warnings = new Set<MigrationDrillPostureWarning>();
  if (input.evidenceStatus === "failed") {
    warnings.add("migration_drill_evidence_failed");
  }
  if (input.evidenceStatus !== "passed") {
    warnings.add("migration_drill_evidence_not_passed");
  }
  if (input.mode !== "live") warnings.add("migration_drill_evidence_not_live");
  for (const code of failureCodes) {
    if (code === "migration_drill_deployment_invalid") {
      warnings.add("migration_drill_deployment_invalid");
    } else if (code.startsWith("migration_drill_missing_check:")) {
      warnings.add("migration_drill_required_checks_missing");
    } else if (code === "migration_drill_injection_missing") {
      warnings.add("migration_drill_injection_missing");
    } else if (code === "migration_drill_failure_behavior_missing") {
      warnings.add("migration_drill_failure_behavior_missing");
    } else if (code === "migration_drill_recovery_missing") {
      warnings.add("migration_drill_recovery_missing");
    } else if (code === "migration_drill_validation_missing") {
      warnings.add("migration_drill_validation_missing");
    } else if (code === "migration_drill_runbook_missing") {
      warnings.add("migration_drill_runbook_missing");
    } else if (code === "migration_drill_failure_codes_present") {
      warnings.add("migration_drill_failure_codes_present");
    } else if (code === "migration_drill_redaction_missing") {
      warnings.add("migration_drill_redaction_missing");
    }
  }
  return Array.from(warnings);
}

function allRedactionFlagsFalse(input: unknown): boolean {
  const value = recordValue(input);
  return redactionFields.every((field) => value[field] === false);
}

function postureRedaction(): MigrationDrillPostureReport["redaction"] {
  return {
    databaseUrlsReturned: false,
    evidenceFileBodyReturned: false,
    migrationLogsReturned: false,
    migrationSqlReturned: false,
    rawErrorStacksReturned: false,
    rawEvidencePathsReturned: false,
    secretValuesReturned: false,
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

function safeCount(input: unknown): number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0
    ? input
    : 0;
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
