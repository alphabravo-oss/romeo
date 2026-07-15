import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const secretRotationEvidenceSchema = "romeo.secret-rotation-drill-evidence.v1";

const requiredChecks = [
  "session_secret_staged_dual_read",
  "webhook_signing_key_cutover",
  "local_mfa_envelope_rewrap_verified",
  "managed_secret_envelope_rewrap_verified",
  "old_secret_rejected_or_retired",
  "new_secret_accepted",
  "post_rotation_readiness_verified",
  "dependency_credentials_reviewed",
  "secret_rotation_alerting_readback",
  "secret_rotation_log_redaction",
] as const;

const redactionFields = [
  "keyMaterialReturned",
  "rawApiKeysReturned",
  "rawEvidencePathsReturned",
  "rawLogLinesReturned",
  "rawSecretRefsReturned",
  "rawSecretValuesReturned",
  "rawTokensReturned",
  "webhookSigningSecretsReturned",
] as const;

type SecretRotationInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export type SecretRotationDrillPostureWarning =
  | "secret_rotation_alerting_missing"
  | "secret_rotation_dependency_review_missing"
  | "secret_rotation_drill_deployment_invalid"
  | "secret_rotation_drill_failure_codes_present"
  | "secret_rotation_evidence_failed"
  | "secret_rotation_evidence_invalid"
  | "secret_rotation_evidence_not_configured"
  | "secret_rotation_evidence_not_live"
  | "secret_rotation_evidence_not_passed"
  | "secret_rotation_new_secret_acceptance_missing"
  | "secret_rotation_old_secret_retirement_missing"
  | "secret_rotation_readiness_missing"
  | "secret_rotation_redaction_missing"
  | "secret_rotation_required_checks_missing"
  | "secret_rotation_rewrap_missing"
  | "secret_rotation_staged_cutover_missing";

export interface SecretRotationDrillPostureReport {
  schema: "romeo.secret-rotation-drill-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: typeof secretRotationEvidenceSchema;
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: SecretRotationInvalidReason;
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<(typeof requiredChecks)[number]>;
  };
  stagedCutover: {
    sessionSecretStaged: boolean;
    webhookSigningKeyCutover: boolean;
    apiOrServiceKeyContinuityVerified: boolean;
  };
  rewrap: {
    localMfaPreviewPassed: boolean;
    localMfaRewrappedCount: number;
    managedSecretsPreviewPassed: boolean;
    managedSecretsRewrappedCount: number;
    failureCount: number;
  };
  acceptance: {
    oldSecretRetiredOrRejectedCount: number;
    newSecretAcceptedCount: number;
  };
  dependencies: {
    databaseCredentialsReviewed: boolean;
    objectStoreCredentialsReviewed: boolean;
    providerCredentialCount: number;
    connectorCredentialCount: number;
  };
  readiness: {
    checked: boolean;
    readinessPassed: boolean;
    postRotationLoginPassed: boolean;
    postRotationWebhookPassed: boolean;
  };
  alerting: {
    checked: boolean;
    status: "failed" | "passed" | "unknown";
    rotationAlertCount: number;
    firingRequiredCount: number;
  };
  redaction: {
    evidenceFileBodyReturned: false;
    keyMaterialReturned: false;
    rawApiKeysReturned: false;
    rawEvidencePathsReturned: false;
    rawLogLinesReturned: false;
    rawSecretRefsReturned: false;
    rawSecretValuesReturned: false;
    rawTokensReturned: false;
    webhookSigningSecretsReturned: false;
  };
  warnings: SecretRotationDrillPostureWarning[];
}

export class SecretRotationDrillPostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(
    subject: AuthSubject,
  ): Promise<SecretRotationDrillPostureReport> {
    assertScope(subject, "admin:read");
    const generatedAt = new Date().toISOString();
    const evidence = await readEvidence(
      this.env.SECRET_ROTATION_DRILL_EVIDENCE_PATH,
    );

    if (evidence.status === "not_configured") {
      return emptyReport({
        generatedAt,
        orgId: subject.orgId,
        warnings: ["secret_rotation_evidence_not_configured"],
      });
    }
    if (evidence.status === "invalid") {
      return emptyReport({
        generatedAt,
        invalidReason: evidence.invalidReason,
        orgId: subject.orgId,
        warnings: ["secret_rotation_evidence_invalid"],
      });
    }

    const summary = summarizeEvidence(evidence.data);
    return {
      schema: "romeo.secret-rotation-drill-posture.v1",
      generatedAt,
      orgId: subject.orgId,
      status: summary.warnings.length === 0 ? "ready" : "attention_required",
      ...summary,
    };
  }
}

type ReadEvidenceResult =
  | { status: "not_configured" }
  | { status: "invalid"; invalidReason: SecretRotationInvalidReason }
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
    parsed.schemaVersion !== secretRotationEvidenceSchema
  ) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }

  return { status: "valid", data: parsed };
}

function emptyReport(input: {
  generatedAt: string;
  invalidReason?: SecretRotationInvalidReason;
  orgId: string;
  warnings: SecretRotationDrillPostureReport["warnings"];
}): SecretRotationDrillPostureReport {
  return {
    schema: "romeo.secret-rotation-drill-posture.v1",
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
    stagedCutover: {
      sessionSecretStaged: false,
      webhookSigningKeyCutover: false,
      apiOrServiceKeyContinuityVerified: false,
    },
    rewrap: {
      localMfaPreviewPassed: false,
      localMfaRewrappedCount: 0,
      managedSecretsPreviewPassed: false,
      managedSecretsRewrappedCount: 0,
      failureCount: 0,
    },
    acceptance: {
      oldSecretRetiredOrRejectedCount: 0,
      newSecretAcceptedCount: 0,
    },
    dependencies: {
      databaseCredentialsReviewed: false,
      objectStoreCredentialsReviewed: false,
      providerCredentialCount: 0,
      connectorCredentialCount: 0,
    },
    readiness: {
      checked: false,
      readinessPassed: false,
      postRotationLoginPassed: false,
      postRotationWebhookPassed: false,
    },
    alerting: {
      checked: false,
      status: "unknown",
      rotationAlertCount: 0,
      firingRequiredCount: 0,
    },
    redaction: postureRedaction(),
    warnings: input.warnings,
  };
}

function summarizeEvidence(
  data: Record<string, unknown>,
): Omit<
  SecretRotationDrillPostureReport,
  "generatedAt" | "orgId" | "schema" | "status"
> {
  const checks = summarizeChecks(data.checks);
  const stagedCutover = summarizeStagedCutover(data.stagedCutover);
  const rewrap = summarizeRewrap(data.rewrap);
  const acceptance = summarizeAcceptance(data.acceptance);
  const dependencies = summarizeDependencies(data.dependencies);
  const readiness = summarizeReadiness(data.readiness);
  const alerting = summarizeAlerting(data.alerting);
  const redactionPassed = allRedactionFlagsFalse(data.redaction);
  const evidenceStatus = statusValue(data.status);
  const mode = modeValue(data.mode);
  const deployment = deploymentValue(data.deployment);
  const generatedAt = stringValue(data.generatedAt);
  const hasEvidenceFailureCodes = asArray(data.failures).length > 0;
  const failureCodes = Array.from(
    new Set([
      ...failureCodesForEvidence({
        acceptance,
        alerting,
        checks,
        deployment,
        dependencies,
        evidenceStatus,
        hasEvidenceFailureCodes,
        mode,
        readiness,
        redactionPassed,
        rewrap,
        stagedCutover,
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
      schemaVersion: secretRotationEvidenceSchema,
      ...(generatedAt === undefined ? {} : { generatedAt }),
      evidenceStatus,
      mode,
      deployment,
      failureCodes,
    },
    checks,
    stagedCutover,
    rewrap,
    acceptance,
    dependencies,
    readiness,
    alerting,
    redaction: postureRedaction(),
    warnings,
  };
}

function summarizeChecks(
  input: unknown,
): SecretRotationDrillPostureReport["checks"] {
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

function summarizeStagedCutover(
  input: unknown,
): SecretRotationDrillPostureReport["stagedCutover"] {
  const value = recordValue(input);
  return {
    sessionSecretStaged: value.sessionSecretStaged === true,
    webhookSigningKeyCutover: value.webhookSigningKeyCutover === true,
    apiOrServiceKeyContinuityVerified:
      value.apiOrServiceKeyContinuityVerified === true,
  };
}

function summarizeRewrap(
  input: unknown,
): SecretRotationDrillPostureReport["rewrap"] {
  const value = recordValue(input);
  return {
    localMfaPreviewPassed: value.localMfaPreviewPassed === true,
    localMfaRewrappedCount: safeCount(value.localMfaRewrappedCount),
    managedSecretsPreviewPassed: value.managedSecretsPreviewPassed === true,
    managedSecretsRewrappedCount: safeCount(value.managedSecretsRewrappedCount),
    failureCount: safeCount(value.failureCount),
  };
}

function summarizeAcceptance(
  input: unknown,
): SecretRotationDrillPostureReport["acceptance"] {
  const value = recordValue(input);
  return {
    oldSecretRetiredOrRejectedCount: safeCount(
      value.oldSecretRetiredOrRejectedCount,
    ),
    newSecretAcceptedCount: safeCount(value.newSecretAcceptedCount),
  };
}

function summarizeDependencies(
  input: unknown,
): SecretRotationDrillPostureReport["dependencies"] {
  const value = recordValue(input);
  return {
    databaseCredentialsReviewed: value.databaseCredentialsReviewed === true,
    objectStoreCredentialsReviewed:
      value.objectStoreCredentialsReviewed === true,
    providerCredentialCount: safeCount(value.providerCredentialCount),
    connectorCredentialCount: safeCount(value.connectorCredentialCount),
  };
}

function summarizeReadiness(
  input: unknown,
): SecretRotationDrillPostureReport["readiness"] {
  const value = recordValue(input);
  return {
    checked: value.checked === true,
    readinessPassed: value.readinessPassed === true,
    postRotationLoginPassed: value.postRotationLoginPassed === true,
    postRotationWebhookPassed: value.postRotationWebhookPassed === true,
  };
}

function summarizeAlerting(
  input: unknown,
): SecretRotationDrillPostureReport["alerting"] {
  const value = recordValue(input);
  return {
    checked: value.checked === true,
    status: runStatusValue(value.status),
    rotationAlertCount: safeCount(value.rotationAlertCount),
    firingRequiredCount: safeCount(value.firingRequiredCount),
  };
}

function failureCodesForEvidence(input: {
  acceptance: SecretRotationDrillPostureReport["acceptance"];
  alerting: SecretRotationDrillPostureReport["alerting"];
  checks: SecretRotationDrillPostureReport["checks"];
  deployment: SecretRotationDrillPostureReport["evidence"]["deployment"];
  dependencies: SecretRotationDrillPostureReport["dependencies"];
  evidenceStatus: "failed" | "passed" | "planned" | "unknown";
  hasEvidenceFailureCodes: boolean;
  mode: "dry-run" | "live" | "unknown";
  readiness: SecretRotationDrillPostureReport["readiness"];
  redactionPassed: boolean;
  rewrap: SecretRotationDrillPostureReport["rewrap"];
  stagedCutover: SecretRotationDrillPostureReport["stagedCutover"];
}): string[] {
  const failures: string[] = [];
  if (input.evidenceStatus !== "passed") {
    failures.push("secret_rotation_drill_not_passed");
  }
  if (input.mode !== "live") {
    failures.push("secret_rotation_drill_not_live");
  }
  if (
    input.deployment !== "compose" &&
    input.deployment !== "kubernetes" &&
    input.deployment !== "target"
  ) {
    failures.push("secret_rotation_drill_deployment_invalid");
  }
  for (const check of input.checks.missingRequired) {
    failures.push(`secret_rotation_drill_missing_check:${check}`);
  }
  if (
    !input.stagedCutover.sessionSecretStaged ||
    !input.stagedCutover.webhookSigningKeyCutover ||
    !input.stagedCutover.apiOrServiceKeyContinuityVerified
  ) {
    failures.push("secret_rotation_drill_cutover_missing");
  }
  if (
    !input.rewrap.localMfaPreviewPassed ||
    input.rewrap.localMfaRewrappedCount <= 0 ||
    !input.rewrap.managedSecretsPreviewPassed ||
    input.rewrap.managedSecretsRewrappedCount <= 0 ||
    input.rewrap.failureCount > 0
  ) {
    failures.push("secret_rotation_drill_rewrap_missing");
  }
  if (
    input.acceptance.oldSecretRetiredOrRejectedCount <= 0 ||
    input.acceptance.newSecretAcceptedCount <= 0
  ) {
    failures.push("secret_rotation_drill_acceptance_missing");
  }
  if (
    !input.dependencies.databaseCredentialsReviewed ||
    !input.dependencies.objectStoreCredentialsReviewed ||
    input.dependencies.providerCredentialCount <= 0 ||
    input.dependencies.connectorCredentialCount <= 0
  ) {
    failures.push("secret_rotation_drill_dependency_review_missing");
  }
  if (
    !input.readiness.checked ||
    !input.readiness.readinessPassed ||
    !input.readiness.postRotationLoginPassed ||
    !input.readiness.postRotationWebhookPassed
  ) {
    failures.push("secret_rotation_drill_readiness_missing");
  }
  if (
    !input.alerting.checked ||
    input.alerting.status !== "passed" ||
    input.alerting.rotationAlertCount <= 0
  ) {
    failures.push("secret_rotation_drill_alerting_missing");
  }
  if (input.hasEvidenceFailureCodes) {
    failures.push("secret_rotation_drill_failure_codes_present");
  }
  if (!input.redactionPassed) {
    failures.push("secret_rotation_drill_redaction_missing");
  }
  return Array.from(new Set(failures));
}

function warningsForFailureCodes(
  failureCodes: string[],
  input: {
    evidenceStatus: "failed" | "passed" | "planned" | "unknown";
    mode: "dry-run" | "live" | "unknown";
  },
): SecretRotationDrillPostureReport["warnings"] {
  const warnings = new Set<SecretRotationDrillPostureWarning>();
  if (input.evidenceStatus === "failed") {
    warnings.add("secret_rotation_evidence_failed");
  }
  if (input.evidenceStatus !== "passed") {
    warnings.add("secret_rotation_evidence_not_passed");
  }
  if (input.mode !== "live") warnings.add("secret_rotation_evidence_not_live");
  for (const code of failureCodes) {
    if (code === "secret_rotation_drill_deployment_invalid") {
      warnings.add("secret_rotation_drill_deployment_invalid");
    } else if (code.startsWith("secret_rotation_drill_missing_check:")) {
      warnings.add("secret_rotation_required_checks_missing");
    } else if (code === "secret_rotation_drill_cutover_missing") {
      warnings.add("secret_rotation_staged_cutover_missing");
    } else if (code === "secret_rotation_drill_rewrap_missing") {
      warnings.add("secret_rotation_rewrap_missing");
    } else if (code === "secret_rotation_drill_acceptance_missing") {
      warnings.add("secret_rotation_old_secret_retirement_missing");
      warnings.add("secret_rotation_new_secret_acceptance_missing");
    } else if (code === "secret_rotation_drill_dependency_review_missing") {
      warnings.add("secret_rotation_dependency_review_missing");
    } else if (code === "secret_rotation_drill_readiness_missing") {
      warnings.add("secret_rotation_readiness_missing");
    } else if (code === "secret_rotation_drill_alerting_missing") {
      warnings.add("secret_rotation_alerting_missing");
    } else if (code === "secret_rotation_drill_failure_codes_present") {
      warnings.add("secret_rotation_drill_failure_codes_present");
    } else if (code === "secret_rotation_drill_redaction_missing") {
      warnings.add("secret_rotation_redaction_missing");
    }
  }
  return Array.from(warnings);
}

function allRedactionFlagsFalse(input: unknown): boolean {
  const value = recordValue(input);
  return redactionFields.every((field) => value[field] === false);
}

function postureRedaction(): SecretRotationDrillPostureReport["redaction"] {
  return {
    evidenceFileBodyReturned: false,
    keyMaterialReturned: false,
    rawApiKeysReturned: false,
    rawEvidencePathsReturned: false,
    rawLogLinesReturned: false,
    rawSecretRefsReturned: false,
    rawSecretValuesReturned: false,
    rawTokensReturned: false,
    webhookSigningSecretsReturned: false,
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

function runStatusValue(input: unknown): "failed" | "passed" | "unknown" {
  if (input === "failed" || input === "passed") return input;
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
