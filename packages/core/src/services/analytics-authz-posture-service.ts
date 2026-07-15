import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const analyticsAuthzEvidenceSchema = "romeo.analytics-authz-live-evidence.v1";

const requiredChecks = [
  "admin_summary_readback",
  "admin_csv_export_readback",
  "usage_scope_enforced",
  "eval_evidence_resource_grant_enforced",
  "non_admin_summary_denied",
  "non_admin_csv_denied",
  "cross_org_summary_denied",
  "cross_workspace_export_scoped",
  "csv_export_hash_recorded",
  "raw_analytics_content_absent",
  "analytics_log_redaction",
  "analytics_evidence_redaction_reviewed",
] as const;

const redactionFields = [
  "apiKeysReturned",
  "evidenceFileBodiesReturned",
  "rawAnalyticsCsvRowsReturned",
  "rawEvalInputsReturned",
  "rawEvalOutputsReturned",
  "rawEvidencePathsReturned",
  "rawHumanRatingCommentsReturned",
  "rawJobPayloadsReturned",
  "rawOrgNamesReturned",
  "rawProviderConfigReturned",
  "rawSecretRefsReturned",
  "rawToolInputsReturned",
  "rawUsageMetadataReturned",
  "rawUserEmailsReturned",
  "rawWorkspaceNamesReturned",
  "secretValuesReturned",
  "tokenValuesReturned",
] as const;

type AnalyticsAuthzInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export type AnalyticsAuthzPostureWarning =
  | "analytics_authz_admin_readback_missing"
  | "analytics_authz_cross_org_denial_missing"
  | "analytics_authz_cross_workspace_scoping_missing"
  | "analytics_authz_csv_export_missing"
  | "analytics_authz_csv_hash_missing"
  | "analytics_authz_eval_grant_missing"
  | "analytics_authz_evidence_failed"
  | "analytics_authz_evidence_invalid"
  | "analytics_authz_evidence_not_configured"
  | "analytics_authz_evidence_not_live"
  | "analytics_authz_evidence_not_passed"
  | "analytics_authz_live_authorization_missing"
  | "analytics_authz_live_deployment_invalid"
  | "analytics_authz_live_failure_codes_present"
  | "analytics_authz_live_readback_missing"
  | "analytics_authz_live_subjects_missing"
  | "analytics_authz_non_admin_denial_missing"
  | "analytics_authz_redaction_missing"
  | "analytics_authz_required_checks_missing"
  | "analytics_authz_usage_scope_missing";

export interface AnalyticsAuthzPostureReport {
  schema: "romeo.analytics-authz-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: typeof analyticsAuthzEvidenceSchema;
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: AnalyticsAuthzInvalidReason;
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<(typeof requiredChecks)[number]>;
  };
  subjects: {
    adminSubjectCount: number;
    orgAdminSubjectCount: number;
    nonAdminSubjectCount: number;
    serviceAccountSubjectCount: number;
    crossOrgSubjectCount: number;
  };
  authorization: {
    adminSummaryAllowedCount: number;
    adminCsvAllowedCount: number;
    nonAdminSummaryDeniedCount: number;
    nonAdminCsvDeniedCount: number;
    missingUsageScopeDeniedCount: number;
    evalGrantDeniedCount: number;
    crossOrgDeniedCount: number;
    crossWorkspaceScopedCount: number;
  };
  analytics: {
    summaryReadCount: number;
    csvExportReadCount: number;
    evalEvidenceReadCount: number;
    csvSha256Count: number;
    usageMetricCount: number;
    evalSuiteCount: number;
    jobSummaryCount: number;
    providerSummaryCount: number;
  };
  redaction: {
    apiKeysReturned: false;
    evidenceFileBodiesReturned: false;
    rawAnalyticsCsvRowsReturned: false;
    rawEvalInputsReturned: false;
    rawEvalOutputsReturned: false;
    rawEvidencePathsReturned: false;
    rawHumanRatingCommentsReturned: false;
    rawJobPayloadsReturned: false;
    rawOrgNamesReturned: false;
    rawProviderConfigReturned: false;
    rawSecretRefsReturned: false;
    rawToolInputsReturned: false;
    rawUsageMetadataReturned: false;
    rawUserEmailsReturned: false;
    rawWorkspaceNamesReturned: false;
    secretValuesReturned: false;
    tokenValuesReturned: false;
  };
  warnings: AnalyticsAuthzPostureWarning[];
}

export class AnalyticsAuthzPostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<AnalyticsAuthzPostureReport> {
    assertScope(subject, "admin:read");
    const generatedAt = new Date().toISOString();
    const evidence = await readEvidence(this.env.ANALYTICS_AUTHZ_EVIDENCE_PATH);

    if (evidence.status === "not_configured") {
      return emptyReport({
        generatedAt,
        orgId: subject.orgId,
        warnings: ["analytics_authz_evidence_not_configured"],
      });
    }
    if (evidence.status === "invalid") {
      return emptyReport({
        generatedAt,
        invalidReason: evidence.invalidReason,
        orgId: subject.orgId,
        warnings: ["analytics_authz_evidence_invalid"],
      });
    }

    const summary = summarizeEvidence(evidence.data);
    return {
      schema: "romeo.analytics-authz-posture.v1",
      generatedAt,
      orgId: subject.orgId,
      status: summary.warnings.length === 0 ? "ready" : "attention_required",
      ...summary,
    };
  }
}

type ReadEvidenceResult =
  | { status: "not_configured" }
  | { status: "invalid"; invalidReason: AnalyticsAuthzInvalidReason }
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
    parsed.schemaVersion !== analyticsAuthzEvidenceSchema
  ) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }
  return { status: "valid", data: parsed };
}

function emptyReport(input: {
  generatedAt: string;
  invalidReason?: AnalyticsAuthzInvalidReason;
  orgId: string;
  warnings: AnalyticsAuthzPostureReport["warnings"];
}): AnalyticsAuthzPostureReport {
  return {
    schema: "romeo.analytics-authz-posture.v1",
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
    subjects: {
      adminSubjectCount: 0,
      orgAdminSubjectCount: 0,
      nonAdminSubjectCount: 0,
      serviceAccountSubjectCount: 0,
      crossOrgSubjectCount: 0,
    },
    authorization: {
      adminSummaryAllowedCount: 0,
      adminCsvAllowedCount: 0,
      nonAdminSummaryDeniedCount: 0,
      nonAdminCsvDeniedCount: 0,
      missingUsageScopeDeniedCount: 0,
      evalGrantDeniedCount: 0,
      crossOrgDeniedCount: 0,
      crossWorkspaceScopedCount: 0,
    },
    analytics: {
      summaryReadCount: 0,
      csvExportReadCount: 0,
      evalEvidenceReadCount: 0,
      csvSha256Count: 0,
      usageMetricCount: 0,
      evalSuiteCount: 0,
      jobSummaryCount: 0,
      providerSummaryCount: 0,
    },
    redaction: postureRedaction(),
    warnings: input.warnings,
  };
}

function summarizeEvidence(
  data: Record<string, unknown>,
): Omit<
  AnalyticsAuthzPostureReport,
  "generatedAt" | "orgId" | "schema" | "status"
> {
  const checks = summarizeChecks(data.checks);
  const subjects = summarizeSubjects(data.subjects);
  const authorization = summarizeAuthorization(data.authorization);
  const analytics = summarizeAnalytics(data.analytics);
  const evidenceStatus = statusValue(data.status);
  const mode = modeValue(data.mode);
  const deployment = deploymentValue(data.deployment);
  const generatedAt = stringValue(data.generatedAt);
  const redactionPassed = allRedactionFlagsFalse(data.redaction);
  const hasEvidenceFailureCodes = asArray(data.failures).length > 0;
  const failureCodes = Array.from(
    new Set([
      ...failureCodesForEvidence({
        analytics,
        authorization,
        checks,
        deployment,
        evidenceStatus,
        hasEvidenceFailureCodes,
        mode,
        redactionPassed,
        subjects,
      }),
    ]),
  );
  const warnings = warningsForFailureCodes(failureCodes, {
    deployment,
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
      schemaVersion: analyticsAuthzEvidenceSchema,
      ...(generatedAt === undefined ? {} : { generatedAt }),
      evidenceStatus,
      mode,
      deployment,
      failureCodes,
    },
    checks,
    subjects,
    authorization,
    analytics,
    redaction: postureRedaction(),
    warnings,
  };
}

function summarizeChecks(
  input: unknown,
): AnalyticsAuthzPostureReport["checks"] {
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

function summarizeSubjects(
  input: unknown,
): AnalyticsAuthzPostureReport["subjects"] {
  const value = recordValue(input);
  return {
    adminSubjectCount: safeCount(value.adminSubjectCount),
    orgAdminSubjectCount: safeCount(value.orgAdminSubjectCount),
    nonAdminSubjectCount: safeCount(value.nonAdminSubjectCount),
    serviceAccountSubjectCount: safeCount(value.serviceAccountSubjectCount),
    crossOrgSubjectCount: safeCount(value.crossOrgSubjectCount),
  };
}

function summarizeAuthorization(
  input: unknown,
): AnalyticsAuthzPostureReport["authorization"] {
  const value = recordValue(input);
  return {
    adminSummaryAllowedCount: safeCount(value.adminSummaryAllowedCount),
    adminCsvAllowedCount: safeCount(value.adminCsvAllowedCount),
    nonAdminSummaryDeniedCount: safeCount(value.nonAdminSummaryDeniedCount),
    nonAdminCsvDeniedCount: safeCount(value.nonAdminCsvDeniedCount),
    missingUsageScopeDeniedCount: safeCount(value.missingUsageScopeDeniedCount),
    evalGrantDeniedCount: safeCount(value.evalGrantDeniedCount),
    crossOrgDeniedCount: safeCount(value.crossOrgDeniedCount),
    crossWorkspaceScopedCount: safeCount(value.crossWorkspaceScopedCount),
  };
}

function summarizeAnalytics(
  input: unknown,
): AnalyticsAuthzPostureReport["analytics"] {
  const value = recordValue(input);
  return {
    summaryReadCount: safeCount(value.summaryReadCount),
    csvExportReadCount: safeCount(value.csvExportReadCount),
    evalEvidenceReadCount: safeCount(value.evalEvidenceReadCount),
    csvSha256Count: safeCount(value.csvSha256Count),
    usageMetricCount: safeCount(value.usageMetricCount),
    evalSuiteCount: safeCount(value.evalSuiteCount),
    jobSummaryCount: safeCount(value.jobSummaryCount),
    providerSummaryCount: safeCount(value.providerSummaryCount),
  };
}

function failureCodesForEvidence(input: {
  analytics: AnalyticsAuthzPostureReport["analytics"];
  authorization: AnalyticsAuthzPostureReport["authorization"];
  checks: AnalyticsAuthzPostureReport["checks"];
  deployment: "compose" | "kubernetes" | "target" | "unknown";
  evidenceStatus: "failed" | "passed" | "planned" | "unknown";
  hasEvidenceFailureCodes: boolean;
  mode: "dry-run" | "live" | "unknown";
  redactionPassed: boolean;
  subjects: AnalyticsAuthzPostureReport["subjects"];
}): string[] {
  const failures: string[] = [];
  if (input.evidenceStatus !== "passed") {
    failures.push("analytics_authz_live_not_passed");
  }
  if (input.mode !== "live") failures.push("analytics_authz_live_not_live");
  if (input.deployment !== "target" && input.deployment !== "kubernetes") {
    failures.push("analytics_authz_live_deployment_invalid");
  }
  for (const check of input.checks.missingRequired) {
    failures.push(`analytics_authz_live_missing_check:${check}`);
  }
  if (
    input.subjects.adminSubjectCount <= 0 ||
    input.subjects.nonAdminSubjectCount <= 0 ||
    input.subjects.crossOrgSubjectCount <= 0
  ) {
    failures.push("analytics_authz_live_subjects_missing");
  }
  if (
    input.authorization.adminSummaryAllowedCount <= 0 ||
    input.authorization.adminCsvAllowedCount <= 0 ||
    input.authorization.nonAdminSummaryDeniedCount <= 0 ||
    input.authorization.nonAdminCsvDeniedCount <= 0 ||
    input.authorization.missingUsageScopeDeniedCount <= 0 ||
    input.authorization.evalGrantDeniedCount <= 0 ||
    input.authorization.crossOrgDeniedCount <= 0 ||
    input.authorization.crossWorkspaceScopedCount <= 0
  ) {
    failures.push("analytics_authz_live_authorization_missing");
  }
  if (
    input.analytics.summaryReadCount <= 0 ||
    input.analytics.csvExportReadCount <= 0 ||
    input.analytics.evalEvidenceReadCount <= 0 ||
    input.analytics.csvSha256Count <= 0 ||
    input.analytics.usageMetricCount <= 0 ||
    input.analytics.evalSuiteCount <= 0 ||
    input.analytics.jobSummaryCount <= 0 ||
    input.analytics.providerSummaryCount <= 0
  ) {
    failures.push("analytics_authz_live_readback_missing");
  }
  if (input.hasEvidenceFailureCodes) {
    failures.push("analytics_authz_live_failure_codes_present");
  }
  if (!input.redactionPassed) {
    failures.push("analytics_authz_live_redaction_missing");
  }
  return Array.from(new Set(failures));
}

function warningsForFailureCodes(
  failureCodes: string[],
  input: {
    deployment: "compose" | "kubernetes" | "target" | "unknown";
    evidenceStatus: "failed" | "passed" | "planned" | "unknown";
    mode: "dry-run" | "live" | "unknown";
  },
): AnalyticsAuthzPostureReport["warnings"] {
  const warnings = new Set<AnalyticsAuthzPostureWarning>();
  if (input.evidenceStatus === "failed") {
    warnings.add("analytics_authz_evidence_failed");
  }
  if (input.evidenceStatus !== "passed") {
    warnings.add("analytics_authz_evidence_not_passed");
  }
  if (input.mode !== "live") warnings.add("analytics_authz_evidence_not_live");
  if (input.deployment !== "target" && input.deployment !== "kubernetes") {
    warnings.add("analytics_authz_live_deployment_invalid");
  }
  for (const code of failureCodes) {
    if (code.startsWith("analytics_authz_live_missing_check:")) {
      warnings.add("analytics_authz_required_checks_missing");
    } else if (code === "analytics_authz_live_deployment_invalid") {
      warnings.add("analytics_authz_live_deployment_invalid");
    } else if (code === "analytics_authz_live_subjects_missing") {
      warnings.add("analytics_authz_live_subjects_missing");
    } else if (code === "analytics_authz_live_authorization_missing") {
      warnings.add("analytics_authz_live_authorization_missing");
    } else if (code === "analytics_authz_live_readback_missing") {
      warnings.add("analytics_authz_live_readback_missing");
    } else if (code === "analytics_authz_live_failure_codes_present") {
      warnings.add("analytics_authz_live_failure_codes_present");
    } else if (code === "analytics_authz_admin_readback_missing") {
      warnings.add("analytics_authz_admin_readback_missing");
    } else if (code === "analytics_authz_csv_export_missing") {
      warnings.add("analytics_authz_csv_export_missing");
    } else if (code === "analytics_authz_usage_scope_missing") {
      warnings.add("analytics_authz_usage_scope_missing");
    } else if (code === "analytics_authz_eval_grant_missing") {
      warnings.add("analytics_authz_eval_grant_missing");
    } else if (code === "analytics_authz_non_admin_denial_missing") {
      warnings.add("analytics_authz_non_admin_denial_missing");
    } else if (code === "analytics_authz_cross_org_denial_missing") {
      warnings.add("analytics_authz_cross_org_denial_missing");
    } else if (code === "analytics_authz_cross_workspace_scoping_missing") {
      warnings.add("analytics_authz_cross_workspace_scoping_missing");
    } else if (code === "analytics_authz_csv_hash_missing") {
      warnings.add("analytics_authz_csv_hash_missing");
    } else if (code === "analytics_authz_live_redaction_missing") {
      warnings.add("analytics_authz_redaction_missing");
    }
  }
  return Array.from(warnings);
}

function allRedactionFlagsFalse(input: unknown): boolean {
  const value = recordValue(input);
  return redactionFields.every((field) => value[field] === false);
}

function postureRedaction(): AnalyticsAuthzPostureReport["redaction"] {
  return {
    apiKeysReturned: false,
    evidenceFileBodiesReturned: false,
    rawAnalyticsCsvRowsReturned: false,
    rawEvalInputsReturned: false,
    rawEvalOutputsReturned: false,
    rawEvidencePathsReturned: false,
    rawHumanRatingCommentsReturned: false,
    rawJobPayloadsReturned: false,
    rawOrgNamesReturned: false,
    rawProviderConfigReturned: false,
    rawSecretRefsReturned: false,
    rawToolInputsReturned: false,
    rawUsageMetadataReturned: false,
    rawUserEmailsReturned: false,
    rawWorkspaceNamesReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
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
