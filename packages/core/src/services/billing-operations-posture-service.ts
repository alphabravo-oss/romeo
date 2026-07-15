import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const billingOperationsEvidenceSchema = "romeo.billing-operations-evidence.v1";

const requiredChecks = [
  "entitlement_reconcile_worker_cadence",
  "billing_lifecycle_worker_cadence",
  "entitlement_api_readback",
  "lifecycle_api_readback",
  "worker_log_redaction",
  "billing_alerting_readback",
] as const;

const redactionFields = [
  "rawBillingProviderPayloadsReturned",
  "rawWorkerLogsReturned",
  "rawApiKeysReturned",
  "rawAlertPayloadsReturned",
  "rawCustomerIdentifiersReturned",
  "rawEvidencePathsReturned",
  "secretValuesReturned",
] as const;

type BillingOperationsInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export type BillingOperationsPostureWarning =
  | "billing_operations_alerting_missing"
  | "billing_operations_api_readback_missing"
  | "billing_operations_cadence_missing"
  | "billing_operations_deployment_invalid"
  | "billing_operations_evidence_failed"
  | "billing_operations_evidence_invalid"
  | "billing_operations_evidence_not_configured"
  | "billing_operations_evidence_not_live"
  | "billing_operations_evidence_not_passed"
  | "billing_operations_entitlement_worker_missing"
  | "billing_operations_failure_codes_present"
  | "billing_operations_lifecycle_worker_missing"
  | "billing_operations_redaction_missing"
  | "billing_operations_required_checks_missing"
  | "billing_operations_worker_cadence_missing";

export interface BillingOperationsPostureReport {
  schema: "romeo.billing-operations-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: typeof billingOperationsEvidenceSchema;
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: BillingOperationsInvalidReason;
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<(typeof requiredChecks)[number]>;
  };
  cadence: {
    windowMinutes?: number;
    expectedRunCount: number;
    observedRunCount: number;
    missedRunCount: number;
  };
  workers: {
    entitlementReconcile: BillingWorkerPosture;
    lifecycleEnforce: BillingWorkerPosture;
  };
  apiReadback: {
    entitlementReportHealthy: boolean;
    lifecycleReportHealthy: boolean;
    mismatchCount: number;
    dueTransitionCount: number;
  };
  alerting: {
    checked: boolean;
    status: "failed" | "passed" | "unknown";
    configuredRuleCount: number;
    firingRequiredCount: number;
  };
  redaction: {
    evidenceFileBodyReturned: false;
    rawAlertPayloadsReturned: false;
    rawApiKeysReturned: false;
    rawBillingProviderPayloadsReturned: false;
    rawCustomerIdentifiersReturned: false;
    rawEvidencePathsReturned: false;
    rawWorkerLogsReturned: false;
    secretValuesReturned: false;
  };
  warnings: BillingOperationsPostureWarning[];
}

interface BillingWorkerPosture {
  configured: boolean;
  scheduleConfigured: boolean;
  lastRunStatus: "failed" | "passed" | "unknown";
  successCount: number;
  failureCount: number;
  alertConfigured: boolean;
}

export class BillingOperationsPostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<BillingOperationsPostureReport> {
    assertScope(subject, "admin:read");
    const generatedAt = new Date().toISOString();
    const evidence = await readEvidence(
      this.env.BILLING_OPERATIONS_EVIDENCE_PATH,
    );

    if (evidence.status === "not_configured") {
      return emptyReport({
        generatedAt,
        orgId: subject.orgId,
        warnings: ["billing_operations_evidence_not_configured"],
      });
    }
    if (evidence.status === "invalid") {
      return emptyReport({
        generatedAt,
        invalidReason: evidence.invalidReason,
        orgId: subject.orgId,
        warnings: ["billing_operations_evidence_invalid"],
      });
    }

    const summary = summarizeEvidence(evidence.data);
    return {
      schema: "romeo.billing-operations-posture.v1",
      generatedAt,
      orgId: subject.orgId,
      status: summary.warnings.length === 0 ? "ready" : "attention_required",
      ...summary,
    };
  }
}

type ReadEvidenceResult =
  | { status: "not_configured" }
  | { status: "invalid"; invalidReason: BillingOperationsInvalidReason }
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
    parsed.schemaVersion !== billingOperationsEvidenceSchema
  ) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }

  return { status: "valid", data: parsed };
}

function emptyReport(input: {
  generatedAt: string;
  invalidReason?: BillingOperationsInvalidReason;
  orgId: string;
  warnings: BillingOperationsPostureReport["warnings"];
}): BillingOperationsPostureReport {
  return {
    schema: "romeo.billing-operations-posture.v1",
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
    cadence: {
      expectedRunCount: 0,
      observedRunCount: 0,
      missedRunCount: 0,
    },
    workers: {
      entitlementReconcile: emptyWorker(),
      lifecycleEnforce: emptyWorker(),
    },
    apiReadback: {
      entitlementReportHealthy: false,
      lifecycleReportHealthy: false,
      mismatchCount: 0,
      dueTransitionCount: 0,
    },
    alerting: {
      checked: false,
      status: "unknown",
      configuredRuleCount: 0,
      firingRequiredCount: 0,
    },
    redaction: postureRedaction(),
    warnings: input.warnings,
  };
}

function summarizeEvidence(
  data: Record<string, unknown>,
): Omit<
  BillingOperationsPostureReport,
  "generatedAt" | "orgId" | "schema" | "status"
> {
  const checks = summarizeChecks(data.checks);
  const cadence = summarizeCadence(data.cadence);
  const workers = summarizeWorkers(data.workers);
  const apiReadback = summarizeApiReadback(data.apiReadback);
  const alerting = summarizeAlerting(data.alerting);
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
        alerting,
        apiReadback,
        cadence,
        checks,
        deployment,
        evidenceStatus,
        hasEvidenceFailureCodes,
        mode,
        redactionPassed,
        workers,
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
      schemaVersion: billingOperationsEvidenceSchema,
      ...(generatedAt === undefined ? {} : { generatedAt }),
      evidenceStatus,
      mode,
      deployment,
      failureCodes,
    },
    checks,
    cadence,
    workers,
    apiReadback,
    alerting,
    redaction: postureRedaction(),
    warnings,
  };
}

function summarizeChecks(
  input: unknown,
): BillingOperationsPostureReport["checks"] {
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

function summarizeCadence(
  input: unknown,
): BillingOperationsPostureReport["cadence"] {
  const value = recordValue(input);
  const windowMinutes = optionalSafeNumber(value.windowMinutes);
  return {
    ...(windowMinutes === undefined ? {} : { windowMinutes }),
    expectedRunCount: safeCount(value.expectedRunCount),
    observedRunCount: safeCount(value.observedRunCount),
    missedRunCount: safeCount(value.missedRunCount),
  };
}

function summarizeWorkers(
  input: unknown,
): BillingOperationsPostureReport["workers"] {
  const value = recordValue(input);
  return {
    entitlementReconcile: summarizeWorker(value.entitlementReconcile),
    lifecycleEnforce: summarizeWorker(value.lifecycleEnforce),
  };
}

function summarizeWorker(input: unknown): BillingWorkerPosture {
  const value = recordValue(input);
  return {
    configured: value.configured === true,
    scheduleConfigured: value.scheduleConfigured === true,
    lastRunStatus: runStatusValue(value.lastRunStatus),
    successCount: safeCount(value.successCount),
    failureCount: safeCount(value.failureCount),
    alertConfigured: value.alertConfigured === true,
  };
}

function emptyWorker(): BillingWorkerPosture {
  return {
    configured: false,
    scheduleConfigured: false,
    lastRunStatus: "unknown",
    successCount: 0,
    failureCount: 0,
    alertConfigured: false,
  };
}

function summarizeApiReadback(
  input: unknown,
): BillingOperationsPostureReport["apiReadback"] {
  const value = recordValue(input);
  return {
    entitlementReportHealthy: value.entitlementReportHealthy === true,
    lifecycleReportHealthy: value.lifecycleReportHealthy === true,
    mismatchCount: safeCount(value.mismatchCount),
    dueTransitionCount: safeCount(value.dueTransitionCount),
  };
}

function summarizeAlerting(
  input: unknown,
): BillingOperationsPostureReport["alerting"] {
  const value = recordValue(input);
  return {
    checked: value.checked === true,
    status: runStatusValue(value.status),
    configuredRuleCount: safeCount(value.configuredRuleCount),
    firingRequiredCount: safeCount(value.firingRequiredCount),
  };
}

function failureCodesForEvidence(input: {
  alerting: BillingOperationsPostureReport["alerting"];
  apiReadback: BillingOperationsPostureReport["apiReadback"];
  cadence: BillingOperationsPostureReport["cadence"];
  checks: BillingOperationsPostureReport["checks"];
  deployment: BillingOperationsPostureReport["evidence"]["deployment"];
  evidenceStatus: "failed" | "passed" | "planned" | "unknown";
  hasEvidenceFailureCodes: boolean;
  mode: "dry-run" | "live" | "unknown";
  redactionPassed: boolean;
  workers: BillingOperationsPostureReport["workers"];
}): string[] {
  const failures: string[] = [];
  if (input.evidenceStatus !== "passed") {
    failures.push("billing_operations_not_passed");
  }
  if (input.mode !== "live") {
    failures.push("billing_operations_not_live");
  }
  if (
    input.deployment !== "compose" &&
    input.deployment !== "kubernetes" &&
    input.deployment !== "target"
  ) {
    failures.push("billing_operations_deployment_invalid");
  }
  for (const check of input.checks.missingRequired) {
    failures.push(`billing_operations_missing_check:${check}`);
  }
  if (
    !positiveInteger(input.cadence.windowMinutes) ||
    !positiveInteger(input.cadence.expectedRunCount) ||
    !positiveInteger(input.cadence.observedRunCount) ||
    input.cadence.observedRunCount < input.cadence.expectedRunCount ||
    input.cadence.missedRunCount !== 0
  ) {
    failures.push("billing_operations_cadence_missing");
  }
  if (!workerPassed(input.workers.entitlementReconcile)) {
    failures.push("billing_operations_entitlement_worker_missing");
  }
  if (!workerPassed(input.workers.lifecycleEnforce)) {
    failures.push("billing_operations_lifecycle_worker_missing");
  }
  if (
    !input.apiReadback.entitlementReportHealthy ||
    !input.apiReadback.lifecycleReportHealthy
  ) {
    failures.push("billing_operations_api_readback_missing");
  }
  if (
    !input.alerting.checked ||
    input.alerting.status !== "passed" ||
    !positiveInteger(input.alerting.configuredRuleCount) ||
    !Number.isInteger(input.alerting.firingRequiredCount) ||
    input.alerting.firingRequiredCount < 0
  ) {
    failures.push("billing_operations_alerting_missing");
  }
  if (input.hasEvidenceFailureCodes) {
    failures.push("billing_operations_failure_codes_present");
  }
  if (!input.redactionPassed) {
    failures.push("billing_operations_redaction_missing");
  }
  return Array.from(new Set(failures));
}

function warningsForFailureCodes(
  failureCodes: string[],
  input: {
    evidenceStatus: "failed" | "passed" | "planned" | "unknown";
    mode: "dry-run" | "live" | "unknown";
  },
): BillingOperationsPostureReport["warnings"] {
  const warnings = new Set<BillingOperationsPostureWarning>();
  if (input.evidenceStatus === "failed") {
    warnings.add("billing_operations_evidence_failed");
  }
  if (input.evidenceStatus !== "passed") {
    warnings.add("billing_operations_evidence_not_passed");
  }
  if (input.mode !== "live")
    warnings.add("billing_operations_evidence_not_live");
  for (const code of failureCodes) {
    if (code === "billing_operations_deployment_invalid") {
      warnings.add("billing_operations_deployment_invalid");
    } else if (code.startsWith("billing_operations_missing_check:")) {
      warnings.add("billing_operations_required_checks_missing");
    } else if (code === "billing_operations_cadence_missing") {
      warnings.add("billing_operations_cadence_missing");
    } else if (code === "billing_operations_entitlement_worker_missing") {
      warnings.add("billing_operations_entitlement_worker_missing");
    } else if (code === "billing_operations_lifecycle_worker_missing") {
      warnings.add("billing_operations_lifecycle_worker_missing");
    } else if (code === "billing_operations_api_readback_missing") {
      warnings.add("billing_operations_api_readback_missing");
    } else if (code === "billing_operations_alerting_missing") {
      warnings.add("billing_operations_alerting_missing");
    } else if (code === "billing_operations_failure_codes_present") {
      warnings.add("billing_operations_failure_codes_present");
    } else if (code === "billing_operations_redaction_missing") {
      warnings.add("billing_operations_redaction_missing");
    }
  }
  return Array.from(warnings);
}

function allRedactionFlagsFalse(input: unknown): boolean {
  const value = recordValue(input);
  return redactionFields.every((field) => value[field] === false);
}

function workerPassed(worker: BillingWorkerPosture): boolean {
  return (
    worker.configured &&
    worker.scheduleConfigured &&
    worker.lastRunStatus === "passed" &&
    positiveInteger(worker.successCount) &&
    worker.failureCount === 0 &&
    worker.alertConfigured
  );
}

function postureRedaction(): BillingOperationsPostureReport["redaction"] {
  return {
    evidenceFileBodyReturned: false,
    rawAlertPayloadsReturned: false,
    rawApiKeysReturned: false,
    rawBillingProviderPayloadsReturned: false,
    rawCustomerIdentifiersReturned: false,
    rawEvidencePathsReturned: false,
    rawWorkerLogsReturned: false,
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

function runStatusValue(input: unknown): "failed" | "passed" | "unknown" {
  if (input === "failed" || input === "passed") return input;
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
