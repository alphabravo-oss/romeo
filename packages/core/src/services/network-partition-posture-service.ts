import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const networkPartitionEvidenceSchema = "romeo.network-partition-evidence.v1";

const requiredChecks = [
  "network_partition_injected",
  "dependency_partition_verified",
  "api_fail_closed_or_degraded",
  "worker_backpressure_verified",
  "recovery_after_partition_verified",
  "alerting_readback",
  "network_policy_or_cni_context_recorded",
  "partition_log_redaction",
] as const;

const redactionFields = [
  "rawNetworkEndpointsReturned",
  "rawPodIpsReturned",
  "rawPacketCapturesReturned",
  "rawLogLinesReturned",
  "rawEvidencePathsReturned",
  "secretValuesReturned",
] as const;

type NetworkPartitionInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export type NetworkPartitionPostureWarning =
  | "network_partition_alerting_missing"
  | "network_partition_deployment_invalid"
  | "network_partition_evidence_failed"
  | "network_partition_evidence_invalid"
  | "network_partition_evidence_not_configured"
  | "network_partition_evidence_not_live"
  | "network_partition_evidence_not_passed"
  | "network_partition_failure_codes_present"
  | "network_partition_injection_missing"
  | "network_partition_network_context_missing"
  | "network_partition_recovery_missing"
  | "network_partition_redaction_missing"
  | "network_partition_required_checks_missing"
  | "network_partition_runtime_behavior_missing";

export interface NetworkPartitionPostureReport {
  schema: "romeo.network-partition-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: typeof networkPartitionEvidenceSchema;
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: NetworkPartitionInvalidReason;
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<(typeof requiredChecks)[number]>;
  };
  drill: {
    partitionInjected: boolean;
    partitionedDependencyCount: number;
    partitionedServiceCount: number;
    partitionDurationSeconds?: number;
  };
  runtime: {
    apiDegraded: boolean;
    failClosedCount: number;
    backpressureObserved: boolean;
    workerStormPrevented: boolean;
  };
  recovery: {
    checked: boolean;
    recoveredDependencyCount: number;
    recoverySeconds?: number;
    postRecoveryReadbackPassed: boolean;
  };
  alerting: {
    checked: boolean;
    status: "failed" | "passed" | "unknown";
    partitionAlertCount: number;
    firingRequiredCount: number;
  };
  networkContext: {
    cniConfirmed: boolean;
    networkPolicyApplied: boolean;
    namespaceScoped: boolean;
    egressPolicyCount: number;
  };
  redaction: {
    evidenceFileBodyReturned: false;
    rawEvidencePathsReturned: false;
    rawLogLinesReturned: false;
    rawNetworkEndpointsReturned: false;
    rawPacketCapturesReturned: false;
    rawPodIpsReturned: false;
    secretValuesReturned: false;
  };
  warnings: NetworkPartitionPostureWarning[];
}

export class NetworkPartitionPostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<NetworkPartitionPostureReport> {
    assertScope(subject, "admin:read");
    const generatedAt = new Date().toISOString();
    const evidence = await readEvidence(
      this.env.NETWORK_PARTITION_EVIDENCE_PATH,
    );

    if (evidence.status === "not_configured") {
      return emptyReport({
        generatedAt,
        orgId: subject.orgId,
        warnings: ["network_partition_evidence_not_configured"],
      });
    }
    if (evidence.status === "invalid") {
      return emptyReport({
        generatedAt,
        invalidReason: evidence.invalidReason,
        orgId: subject.orgId,
        warnings: ["network_partition_evidence_invalid"],
      });
    }

    const summary = summarizeEvidence(evidence.data);
    return {
      schema: "romeo.network-partition-posture.v1",
      generatedAt,
      orgId: subject.orgId,
      status: summary.warnings.length === 0 ? "ready" : "attention_required",
      ...summary,
    };
  }
}

type ReadEvidenceResult =
  | { status: "not_configured" }
  | { status: "invalid"; invalidReason: NetworkPartitionInvalidReason }
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
    parsed.schemaVersion !== networkPartitionEvidenceSchema
  ) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }

  return { status: "valid", data: parsed };
}

function emptyReport(input: {
  generatedAt: string;
  invalidReason?: NetworkPartitionInvalidReason;
  orgId: string;
  warnings: NetworkPartitionPostureReport["warnings"];
}): NetworkPartitionPostureReport {
  return {
    schema: "romeo.network-partition-posture.v1",
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
      partitionInjected: false,
      partitionedDependencyCount: 0,
      partitionedServiceCount: 0,
    },
    runtime: {
      apiDegraded: false,
      failClosedCount: 0,
      backpressureObserved: false,
      workerStormPrevented: false,
    },
    recovery: {
      checked: false,
      recoveredDependencyCount: 0,
      postRecoveryReadbackPassed: false,
    },
    alerting: {
      checked: false,
      status: "unknown",
      partitionAlertCount: 0,
      firingRequiredCount: 0,
    },
    networkContext: {
      cniConfirmed: false,
      networkPolicyApplied: false,
      namespaceScoped: false,
      egressPolicyCount: 0,
    },
    redaction: postureRedaction(),
    warnings: input.warnings,
  };
}

function summarizeEvidence(
  data: Record<string, unknown>,
): Omit<
  NetworkPartitionPostureReport,
  "generatedAt" | "orgId" | "schema" | "status"
> {
  const checks = summarizeChecks(data.checks);
  const drill = summarizeDrill(data.drill);
  const runtime = summarizeRuntime(data.runtime);
  const recovery = summarizeRecovery(data.recovery);
  const alerting = summarizeAlerting(data.alerting);
  const networkContext = summarizeNetworkContext(data.networkContext);
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
        networkContext,
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
      schemaVersion: networkPartitionEvidenceSchema,
      ...(generatedAt === undefined ? {} : { generatedAt }),
      evidenceStatus,
      mode,
      deployment,
      failureCodes,
    },
    checks,
    drill,
    runtime,
    recovery,
    alerting,
    networkContext,
    redaction: postureRedaction(),
    warnings,
  };
}

function summarizeChecks(
  input: unknown,
): NetworkPartitionPostureReport["checks"] {
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

function summarizeDrill(
  input: unknown,
): NetworkPartitionPostureReport["drill"] {
  const value = recordValue(input);
  const partitionDurationSeconds = optionalSafeNumber(
    value.partitionDurationSeconds,
  );
  return {
    partitionInjected: value.partitionInjected === true,
    partitionedDependencyCount: safeCount(value.partitionedDependencyCount),
    partitionedServiceCount: safeCount(value.partitionedServiceCount),
    ...(partitionDurationSeconds === undefined
      ? {}
      : { partitionDurationSeconds }),
  };
}

function summarizeRuntime(
  input: unknown,
): NetworkPartitionPostureReport["runtime"] {
  const value = recordValue(input);
  return {
    apiDegraded: value.apiDegraded === true,
    failClosedCount: safeCount(value.failClosedCount),
    backpressureObserved: value.backpressureObserved === true,
    workerStormPrevented: value.workerStormPrevented === true,
  };
}

function summarizeRecovery(
  input: unknown,
): NetworkPartitionPostureReport["recovery"] {
  const value = recordValue(input);
  const recoverySeconds = optionalSafeNumber(value.recoverySeconds);
  return {
    checked: value.checked === true,
    recoveredDependencyCount: safeCount(value.recoveredDependencyCount),
    ...(recoverySeconds === undefined ? {} : { recoverySeconds }),
    postRecoveryReadbackPassed: value.postRecoveryReadbackPassed === true,
  };
}

function summarizeAlerting(
  input: unknown,
): NetworkPartitionPostureReport["alerting"] {
  const value = recordValue(input);
  return {
    checked: value.checked === true,
    status: runStatusValue(value.status),
    partitionAlertCount: safeCount(value.partitionAlertCount),
    firingRequiredCount: safeCount(value.firingRequiredCount),
  };
}

function summarizeNetworkContext(
  input: unknown,
): NetworkPartitionPostureReport["networkContext"] {
  const value = recordValue(input);
  return {
    cniConfirmed: value.cniConfirmed === true,
    networkPolicyApplied: value.networkPolicyApplied === true,
    namespaceScoped: value.namespaceScoped === true,
    egressPolicyCount: safeCount(value.egressPolicyCount),
  };
}

function failureCodesForEvidence(input: {
  alerting: NetworkPartitionPostureReport["alerting"];
  checks: NetworkPartitionPostureReport["checks"];
  deployment: NetworkPartitionPostureReport["evidence"]["deployment"];
  drill: NetworkPartitionPostureReport["drill"];
  evidenceStatus: "failed" | "passed" | "planned" | "unknown";
  hasEvidenceFailureCodes: boolean;
  mode: "dry-run" | "live" | "unknown";
  networkContext: NetworkPartitionPostureReport["networkContext"];
  recovery: NetworkPartitionPostureReport["recovery"];
  redactionPassed: boolean;
  runtime: NetworkPartitionPostureReport["runtime"];
}): string[] {
  const failures: string[] = [];
  if (input.evidenceStatus !== "passed") {
    failures.push("network_partition_not_passed");
  }
  if (input.mode !== "live") {
    failures.push("network_partition_not_live");
  }
  if (
    input.deployment !== "compose" &&
    input.deployment !== "kubernetes" &&
    input.deployment !== "target"
  ) {
    failures.push("network_partition_deployment_invalid");
  }
  for (const check of input.checks.missingRequired) {
    failures.push(`network_partition_missing_check:${check}`);
  }
  if (
    !input.drill.partitionInjected ||
    input.drill.partitionedDependencyCount <= 0 ||
    input.drill.partitionedServiceCount <= 0 ||
    !positiveInteger(input.drill.partitionDurationSeconds)
  ) {
    failures.push("network_partition_injection_missing");
  }
  if (
    !input.runtime.apiDegraded ||
    input.runtime.failClosedCount <= 0 ||
    !input.runtime.backpressureObserved ||
    !input.runtime.workerStormPrevented
  ) {
    failures.push("network_partition_runtime_behavior_missing");
  }
  if (
    !input.recovery.checked ||
    input.recovery.recoveredDependencyCount <= 0 ||
    !input.recovery.postRecoveryReadbackPassed
  ) {
    failures.push("network_partition_recovery_missing");
  }
  if (
    !input.alerting.checked ||
    input.alerting.status !== "passed" ||
    input.alerting.partitionAlertCount <= 0
  ) {
    failures.push("network_partition_alerting_missing");
  }
  if (
    !input.networkContext.cniConfirmed ||
    !input.networkContext.networkPolicyApplied ||
    !input.networkContext.namespaceScoped ||
    input.networkContext.egressPolicyCount <= 0
  ) {
    failures.push("network_partition_context_missing");
  }
  if (input.hasEvidenceFailureCodes) {
    failures.push("network_partition_failure_codes_present");
  }
  if (!input.redactionPassed) {
    failures.push("network_partition_redaction_missing");
  }
  return Array.from(new Set(failures));
}

function warningsForFailureCodes(
  failureCodes: string[],
  input: {
    evidenceStatus: "failed" | "passed" | "planned" | "unknown";
    mode: "dry-run" | "live" | "unknown";
  },
): NetworkPartitionPostureReport["warnings"] {
  const warnings = new Set<NetworkPartitionPostureWarning>();
  if (input.evidenceStatus === "failed") {
    warnings.add("network_partition_evidence_failed");
  }
  if (input.evidenceStatus !== "passed") {
    warnings.add("network_partition_evidence_not_passed");
  }
  if (input.mode !== "live")
    warnings.add("network_partition_evidence_not_live");
  for (const code of failureCodes) {
    if (code === "network_partition_deployment_invalid") {
      warnings.add("network_partition_deployment_invalid");
    } else if (code.startsWith("network_partition_missing_check:")) {
      warnings.add("network_partition_required_checks_missing");
    } else if (code === "network_partition_injection_missing") {
      warnings.add("network_partition_injection_missing");
    } else if (code === "network_partition_runtime_behavior_missing") {
      warnings.add("network_partition_runtime_behavior_missing");
    } else if (code === "network_partition_recovery_missing") {
      warnings.add("network_partition_recovery_missing");
    } else if (code === "network_partition_alerting_missing") {
      warnings.add("network_partition_alerting_missing");
    } else if (code === "network_partition_context_missing") {
      warnings.add("network_partition_network_context_missing");
    } else if (code === "network_partition_failure_codes_present") {
      warnings.add("network_partition_failure_codes_present");
    } else if (code === "network_partition_redaction_missing") {
      warnings.add("network_partition_redaction_missing");
    }
  }
  return Array.from(warnings);
}

function allRedactionFlagsFalse(input: unknown): boolean {
  const value = recordValue(input);
  return redactionFields.every((field) => value[field] === false);
}

function postureRedaction(): NetworkPartitionPostureReport["redaction"] {
  return {
    evidenceFileBodyReturned: false,
    rawEvidencePathsReturned: false,
    rawLogLinesReturned: false,
    rawNetworkEndpointsReturned: false,
    rawPacketCapturesReturned: false,
    rawPodIpsReturned: false,
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

function positiveInteger(input: unknown): boolean {
  return Number.isSafeInteger(input) && Number(input) > 0;
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
