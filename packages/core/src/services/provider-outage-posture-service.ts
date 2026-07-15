import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const providerOutageEvidenceSchema = "romeo.provider-outage-evidence.v1";

const requiredChecks = [
  "provider_outage_injected",
  "provider_timeout_observed",
  "provider_circuit_open",
  "fallback_routing_verified",
  "kill_switch_verified",
  "operational_summary_readback",
  "provider_alerting_readback",
  "provider_recovery_verified",
  "provider_log_redaction",
] as const;

const redactionFields = [
  "rawProviderPayloadsReturned",
  "rawProviderResponsesReturned",
  "rawProviderErrorsReturned",
  "rawPromptsReturned",
  "rawApiKeysReturned",
  "rawAlertPayloadsReturned",
  "rawEvidencePathsReturned",
  "secretValuesReturned",
] as const;

type ProviderOutageInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export type ProviderOutagePostureWarning =
  | "provider_outage_alerting_missing"
  | "provider_outage_deployment_invalid"
  | "provider_outage_evidence_failed"
  | "provider_outage_evidence_invalid"
  | "provider_outage_evidence_not_configured"
  | "provider_outage_evidence_not_live"
  | "provider_outage_evidence_not_passed"
  | "provider_outage_failure_codes_present"
  | "provider_outage_injection_missing"
  | "provider_outage_operational_summary_missing"
  | "provider_outage_recovery_missing"
  | "provider_outage_redaction_missing"
  | "provider_outage_required_checks_missing"
  | "provider_outage_runtime_behavior_missing";

export interface ProviderOutagePostureReport {
  schema: "romeo.provider-outage-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: typeof providerOutageEvidenceSchema;
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: ProviderOutageInvalidReason;
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<(typeof requiredChecks)[number]>;
  };
  drill: {
    providerCount: number;
    outageInjectedCount: number;
    timeoutObservedCount: number;
  };
  runtime: {
    circuitOpenCount: number;
    fallbackRoutedCount: number;
    killSwitchVerifiedCount: number;
  };
  operationalSummary: {
    checked: boolean;
    degradedProviderCount: number;
    circuitOpenProviderCount: number;
    fallbackAvailable: boolean;
    killSwitchActiveCount: number;
    alertCodeCount: number;
  };
  alerting: {
    checked: boolean;
    status: "failed" | "passed" | "unknown";
    providerAlertCount: number;
    firingRequiredCount: number;
  };
  recovery: {
    checked: boolean;
    recoveredProviderCount: number;
    recoverySeconds?: number;
  };
  redaction: {
    evidenceFileBodyReturned: false;
    rawAlertPayloadsReturned: false;
    rawApiKeysReturned: false;
    rawEvidencePathsReturned: false;
    rawPromptsReturned: false;
    rawProviderErrorsReturned: false;
    rawProviderPayloadsReturned: false;
    rawProviderResponsesReturned: false;
    secretValuesReturned: false;
  };
  warnings: ProviderOutagePostureWarning[];
}

export class ProviderOutagePostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<ProviderOutagePostureReport> {
    assertScope(subject, "admin:read");
    const generatedAt = new Date().toISOString();
    const evidence = await readEvidence(this.env.PROVIDER_OUTAGE_EVIDENCE_PATH);

    if (evidence.status === "not_configured") {
      return emptyReport({
        generatedAt,
        orgId: subject.orgId,
        warnings: ["provider_outage_evidence_not_configured"],
      });
    }
    if (evidence.status === "invalid") {
      return emptyReport({
        generatedAt,
        invalidReason: evidence.invalidReason,
        orgId: subject.orgId,
        warnings: ["provider_outage_evidence_invalid"],
      });
    }

    const summary = summarizeEvidence(evidence.data);
    return {
      schema: "romeo.provider-outage-posture.v1",
      generatedAt,
      orgId: subject.orgId,
      status: summary.warnings.length === 0 ? "ready" : "attention_required",
      ...summary,
    };
  }
}

type ReadEvidenceResult =
  | { status: "not_configured" }
  | { status: "invalid"; invalidReason: ProviderOutageInvalidReason }
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
    parsed.schemaVersion !== providerOutageEvidenceSchema
  ) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }

  return { status: "valid", data: parsed };
}

function emptyReport(input: {
  generatedAt: string;
  invalidReason?: ProviderOutageInvalidReason;
  orgId: string;
  warnings: ProviderOutagePostureReport["warnings"];
}): ProviderOutagePostureReport {
  return {
    schema: "romeo.provider-outage-posture.v1",
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
      providerCount: 0,
      outageInjectedCount: 0,
      timeoutObservedCount: 0,
    },
    runtime: {
      circuitOpenCount: 0,
      fallbackRoutedCount: 0,
      killSwitchVerifiedCount: 0,
    },
    operationalSummary: {
      checked: false,
      degradedProviderCount: 0,
      circuitOpenProviderCount: 0,
      fallbackAvailable: false,
      killSwitchActiveCount: 0,
      alertCodeCount: 0,
    },
    alerting: {
      checked: false,
      status: "unknown",
      providerAlertCount: 0,
      firingRequiredCount: 0,
    },
    recovery: {
      checked: false,
      recoveredProviderCount: 0,
    },
    redaction: postureRedaction(),
    warnings: input.warnings,
  };
}

function summarizeEvidence(
  data: Record<string, unknown>,
): Omit<
  ProviderOutagePostureReport,
  "generatedAt" | "orgId" | "schema" | "status"
> {
  const checks = summarizeChecks(data.checks);
  const drill = summarizeDrill(data.drill);
  const runtime = summarizeRuntime(data.runtime);
  const operationalSummary = summarizeOperationalSummary(
    data.operationalSummary,
  );
  const alerting = summarizeAlerting(data.alerting);
  const recovery = summarizeRecovery(data.recovery);
  const redactionPassed = allRedactionFlagsFalse(data.redaction);
  const evidenceStatus = statusValue(data.status);
  const mode = modeValue(data.mode);
  const deployment = deploymentValue(data.deployment);
  const generatedAt = stringValue(data.generatedAt);
  const hasEvidenceFailureCodes = asArray(data.failures).length > 0;
  const failureCodes = Array.from(
    new Set([
      ...failureCodesForEvidence({
        alerting,
        checks,
        deployment,
        drill,
        evidenceStatus,
        hasEvidenceFailureCodes,
        mode,
        operationalSummary,
        recovery,
        redactionPassed,
        runtime,
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
      schemaVersion: providerOutageEvidenceSchema,
      ...(generatedAt === undefined ? {} : { generatedAt }),
      evidenceStatus,
      mode,
      deployment,
      failureCodes,
    },
    checks,
    drill,
    runtime,
    operationalSummary,
    alerting,
    recovery,
    redaction: postureRedaction(),
    warnings,
  };
}

function summarizeChecks(
  input: unknown,
): ProviderOutagePostureReport["checks"] {
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

function summarizeDrill(input: unknown): ProviderOutagePostureReport["drill"] {
  const value = recordValue(input);
  return {
    providerCount: safeCount(value.providerCount),
    outageInjectedCount: safeCount(value.outageInjectedCount),
    timeoutObservedCount: safeCount(value.timeoutObservedCount),
  };
}

function summarizeRuntime(
  input: unknown,
): ProviderOutagePostureReport["runtime"] {
  const value = recordValue(input);
  return {
    circuitOpenCount: safeCount(value.circuitOpenCount),
    fallbackRoutedCount: safeCount(value.fallbackRoutedCount),
    killSwitchVerifiedCount: safeCount(value.killSwitchVerifiedCount),
  };
}

function summarizeOperationalSummary(
  input: unknown,
): ProviderOutagePostureReport["operationalSummary"] {
  const value = recordValue(input);
  return {
    checked: value.checked === true,
    degradedProviderCount: safeCount(value.degradedProviderCount),
    circuitOpenProviderCount: safeCount(value.circuitOpenProviderCount),
    fallbackAvailable: value.fallbackAvailable === true,
    killSwitchActiveCount: safeCount(value.killSwitchActiveCount),
    alertCodeCount: safeCount(value.alertCodeCount),
  };
}

function summarizeAlerting(
  input: unknown,
): ProviderOutagePostureReport["alerting"] {
  const value = recordValue(input);
  return {
    checked: value.checked === true,
    status: runStatusValue(value.status),
    providerAlertCount: safeCount(value.providerAlertCount),
    firingRequiredCount: safeCount(value.firingRequiredCount),
  };
}

function summarizeRecovery(
  input: unknown,
): ProviderOutagePostureReport["recovery"] {
  const value = recordValue(input);
  const recoverySeconds = optionalSafeNumber(value.recoverySeconds);
  return {
    checked: value.checked === true,
    recoveredProviderCount: safeCount(value.recoveredProviderCount),
    ...(recoverySeconds === undefined ? {} : { recoverySeconds }),
  };
}

function failureCodesForEvidence(input: {
  alerting: ProviderOutagePostureReport["alerting"];
  checks: ProviderOutagePostureReport["checks"];
  deployment: ProviderOutagePostureReport["evidence"]["deployment"];
  drill: ProviderOutagePostureReport["drill"];
  evidenceStatus: "failed" | "passed" | "planned" | "unknown";
  hasEvidenceFailureCodes: boolean;
  mode: "dry-run" | "live" | "unknown";
  operationalSummary: ProviderOutagePostureReport["operationalSummary"];
  recovery: ProviderOutagePostureReport["recovery"];
  redactionPassed: boolean;
  runtime: ProviderOutagePostureReport["runtime"];
}): string[] {
  const failures: string[] = [];
  if (input.evidenceStatus !== "passed") {
    failures.push("provider_outage_not_passed");
  }
  if (input.mode !== "live") {
    failures.push("provider_outage_not_live");
  }
  if (
    input.deployment !== "compose" &&
    input.deployment !== "kubernetes" &&
    input.deployment !== "target"
  ) {
    failures.push("provider_outage_deployment_invalid");
  }
  for (const check of input.checks.missingRequired) {
    failures.push(`provider_outage_missing_check:${check}`);
  }
  if (
    input.drill.providerCount <= 0 ||
    input.drill.outageInjectedCount <= 0 ||
    input.drill.timeoutObservedCount <= 0
  ) {
    failures.push("provider_outage_injection_missing");
  }
  if (
    input.runtime.circuitOpenCount <= 0 ||
    input.runtime.fallbackRoutedCount <= 0 ||
    input.runtime.killSwitchVerifiedCount <= 0
  ) {
    failures.push("provider_outage_runtime_behavior_missing");
  }
  if (
    !input.operationalSummary.checked ||
    input.operationalSummary.degradedProviderCount <= 0 ||
    input.operationalSummary.circuitOpenProviderCount <= 0 ||
    !input.operationalSummary.fallbackAvailable ||
    input.operationalSummary.alertCodeCount <= 0
  ) {
    failures.push("provider_outage_operational_summary_missing");
  }
  if (
    !input.alerting.checked ||
    input.alerting.status !== "passed" ||
    input.alerting.providerAlertCount <= 0
  ) {
    failures.push("provider_outage_alerting_missing");
  }
  if (!input.recovery.checked || input.recovery.recoveredProviderCount <= 0) {
    failures.push("provider_outage_recovery_missing");
  }
  if (input.hasEvidenceFailureCodes) {
    failures.push("provider_outage_failure_codes_present");
  }
  if (!input.redactionPassed)
    failures.push("provider_outage_redaction_missing");
  return Array.from(new Set(failures));
}

function warningsForFailureCodes(
  failureCodes: string[],
  input: {
    evidenceStatus: "failed" | "passed" | "planned" | "unknown";
    mode: "dry-run" | "live" | "unknown";
  },
): ProviderOutagePostureReport["warnings"] {
  const warnings = new Set<ProviderOutagePostureWarning>();
  if (input.evidenceStatus === "failed") {
    warnings.add("provider_outage_evidence_failed");
  }
  if (input.evidenceStatus !== "passed") {
    warnings.add("provider_outage_evidence_not_passed");
  }
  if (input.mode !== "live") warnings.add("provider_outage_evidence_not_live");
  for (const code of failureCodes) {
    if (code === "provider_outage_deployment_invalid") {
      warnings.add("provider_outage_deployment_invalid");
    } else if (code.startsWith("provider_outage_missing_check:")) {
      warnings.add("provider_outage_required_checks_missing");
    } else if (code === "provider_outage_injection_missing") {
      warnings.add("provider_outage_injection_missing");
    } else if (code === "provider_outage_runtime_behavior_missing") {
      warnings.add("provider_outage_runtime_behavior_missing");
    } else if (code === "provider_outage_operational_summary_missing") {
      warnings.add("provider_outage_operational_summary_missing");
    } else if (code === "provider_outage_alerting_missing") {
      warnings.add("provider_outage_alerting_missing");
    } else if (code === "provider_outage_recovery_missing") {
      warnings.add("provider_outage_recovery_missing");
    } else if (code === "provider_outage_failure_codes_present") {
      warnings.add("provider_outage_failure_codes_present");
    } else if (code === "provider_outage_redaction_missing") {
      warnings.add("provider_outage_redaction_missing");
    }
  }
  return Array.from(warnings);
}

function allRedactionFlagsFalse(input: unknown): boolean {
  const value = recordValue(input);
  return redactionFields.every((field) => value[field] === false);
}

function postureRedaction(): ProviderOutagePostureReport["redaction"] {
  return {
    evidenceFileBodyReturned: false,
    rawAlertPayloadsReturned: false,
    rawApiKeysReturned: false,
    rawEvidencePathsReturned: false,
    rawPromptsReturned: false,
    rawProviderErrorsReturned: false,
    rawProviderPayloadsReturned: false,
    rawProviderResponsesReturned: false,
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
