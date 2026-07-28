import { readFile } from "node:fs/promises";

import type { PostgresOperationalPostureReport } from "./postgres-operational-posture-service";

export type EvidenceInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export type ReadEvidenceResult =
  | {
      status: "not_configured";
    }
  | {
      status: "invalid";
      invalidReason: EvidenceInvalidReason;
    }
  | {
      status: "valid";
      data: Record<string, unknown>;
    };

export async function readJsonEvidence(
  path: string,
  schemaVersion: string,
): Promise<ReadEvidenceResult> {
  const configuredPath = path.trim();
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
  if (!isRecord(parsed) || parsed.schemaVersion !== schemaVersion) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }
  return { status: "valid", data: parsed };
}

export function summarizeQueryPlanEvidence(
  result: ReadEvidenceResult,
): PostgresOperationalPostureReport["queryPlanReview"]["representativeVolumeEvidence"] {
  if (result.status === "not_configured") {
    return {
      requiredForGa: true,
      status: "required",
      evidenceSource: "not_configured",
      configured: false,
      representativeVolume: false,
      missingExpectedIndexCount: 0,
      failedCheckCount: 0,
    };
  }
  if (result.status === "invalid") {
    return {
      requiredForGa: true,
      status: "invalid",
      evidenceSource: "configured_file",
      configured: true,
      representativeVolume: false,
      invalidReason: result.invalidReason,
      missingExpectedIndexCount: 0,
      failedCheckCount: 0,
    };
  }
  const evidenceStatus = safeEvidenceStatus(result.data.status);
  const representativeVolume =
    isRecord(result.data.target) &&
    result.data.target.representativeVolume === true;
  const failedCheckCount = asArray(result.data.checks).filter(
    (check) => isRecord(check) && check.status === "failed",
  ).length;
  return {
    requiredForGa: true,
    status:
      evidenceStatus === "passed" && representativeVolume
        ? "satisfied"
        : "required",
    evidenceSource: "configured_file",
    configured: true,
    representativeVolume,
    evidenceStatus,
    schemaVersion: "romeo.postgres-query-plan-review.v1",
    ...(typeof result.data.generatedAt === "string"
      ? { generatedAt: result.data.generatedAt }
      : {}),
    missingExpectedIndexCount: asArray(result.data.missingExpectedIndexes)
      .length,
    failedCheckCount,
  };
}

export function summarizeSlowQueryTelemetry(result: ReadEvidenceResult): {
  status: PostgresOperationalPostureReport["slowQueryTelemetry"]["status"];
  evidence: PostgresOperationalPostureReport["slowQueryTelemetry"]["evidence"];
} {
  if (result.status === "not_configured") {
    return {
      status: "external_required",
      evidence: {
        configured: false,
        fingerprintCount: 0,
        slowQueryCount: 0,
        totalCalls: 0,
        tempFileStatementCount: 0,
        failureCodes: [],
      },
    };
  }
  if (result.status === "invalid") {
    return {
      status: "invalid",
      evidence: {
        configured: true,
        invalidReason: result.invalidReason,
        fingerprintCount: 0,
        slowQueryCount: 0,
        totalCalls: 0,
        tempFileStatementCount: 0,
        failureCodes: [],
      },
    };
  }
  const evidenceStatus = safeEvidenceStatus(result.data.status);
  const summary = isRecord(result.data.summary) ? result.data.summary : {};
  const windowMinutes = safeOptionalNumber(summary.windowMinutes);
  const maxMeanMs = safeOptionalNumber(summary.maxMeanMs);
  const maxP95Ms = safeOptionalNumber(summary.maxP95Ms);
  const maxP99Ms = safeOptionalNumber(summary.maxP99Ms);
  const failureCodes = failurePresenceCodes(
    result.data.failures,
    "postgres_slow_query_failures_present",
  );
  return {
    status:
      evidenceStatus === "passed" && failureCodes.length === 0
        ? "satisfied"
        : "external_required",
    evidence: {
      configured: true,
      schemaVersion: "romeo.postgres-slow-query-telemetry.v1",
      ...(typeof result.data.generatedAt === "string"
        ? { generatedAt: result.data.generatedAt }
        : {}),
      evidenceStatus,
      ...(windowMinutes === undefined ? {} : { windowMinutes }),
      fingerprintCount: safeCount(summary.fingerprintCount),
      slowQueryCount: safeCount(summary.slowQueryCount),
      totalCalls: safeCount(summary.totalCalls),
      ...(maxMeanMs === undefined ? {} : { maxMeanMs }),
      ...(maxP95Ms === undefined ? {} : { maxP95Ms }),
      ...(maxP99Ms === undefined ? {} : { maxP99Ms }),
      tempFileStatementCount: safeCount(summary.tempFileStatementCount),
      failureCodes,
    },
  };
}

export function summarizeLockTelemetry(result: ReadEvidenceResult): {
  status: PostgresOperationalPostureReport["lockTelemetry"]["status"];
  evidence: PostgresOperationalPostureReport["lockTelemetry"]["evidence"];
} {
  if (result.status === "not_configured") {
    return {
      status: "external_required",
      evidence: {
        configured: false,
        blockedSessionMax: 0,
        deadlockCount: 0,
        failureCodes: [],
      },
    };
  }
  if (result.status === "invalid") {
    return {
      status: "invalid",
      evidence: {
        configured: true,
        invalidReason: result.invalidReason,
        blockedSessionMax: 0,
        deadlockCount: 0,
        failureCodes: [],
      },
    };
  }
  const evidenceStatus = safeEvidenceStatus(result.data.status);
  const summary = isRecord(result.data.summary) ? result.data.summary : {};
  const windowMinutes = safeOptionalNumber(summary.windowMinutes);
  const longestWaitMs = safeOptionalNumber(summary.longestWaitMs);
  const failureCodes = failurePresenceCodes(
    result.data.failures,
    "postgres_lock_telemetry_failures_present",
  );
  return {
    status:
      evidenceStatus === "passed" && failureCodes.length === 0
        ? "satisfied"
        : "external_required",
    evidence: {
      configured: true,
      schemaVersion: "romeo.postgres-lock-telemetry.v1",
      ...(typeof result.data.generatedAt === "string"
        ? { generatedAt: result.data.generatedAt }
        : {}),
      evidenceStatus,
      ...(windowMinutes === undefined ? {} : { windowMinutes }),
      blockedSessionMax: safeCount(summary.blockedSessionMax),
      ...(longestWaitMs === undefined ? {} : { longestWaitMs }),
      deadlockCount: safeCount(summary.deadlockCount),
      failureCodes,
    },
  };
}

export function summarizeArchivalPartitioning(result: ReadEvidenceResult): {
  status: PostgresOperationalPostureReport["archivalPartitioning"]["status"];
  currentDecision: string;
  evidence: PostgresOperationalPostureReport["archivalPartitioning"]["evidence"];
} {
  if (result.status === "not_configured") {
    return {
      status: "decision_required",
      currentDecision: "no_runtime_partitioning_enabled",
      evidence: {
        configured: false,
        tableCount: 0,
        failureCodes: [],
      },
    };
  }
  if (result.status === "invalid") {
    return {
      status: "invalid",
      currentDecision: "no_runtime_partitioning_enabled",
      evidence: {
        configured: true,
        invalidReason: result.invalidReason,
        tableCount: 0,
        failureCodes: [],
      },
    };
  }
  const decisionStatus = safeDecisionStatus(result.data.status);
  const decision = safeToken(result.data.decision);
  const failureCodes = failurePresenceCodes(
    result.data.failures,
    "postgres_archival_decision_failures_present",
  );
  return {
    status:
      decisionStatus === "accepted" && failureCodes.length === 0
        ? "accepted"
        : "decision_required",
    currentDecision: decision,
    evidence: {
      configured: true,
      schemaVersion: "romeo.postgres-archival-partitioning-decision.v1",
      ...(typeof result.data.generatedAt === "string"
        ? { generatedAt: result.data.generatedAt }
        : {}),
      decisionStatus,
      ...(typeof result.data.migrationRequired === "boolean"
        ? { migrationRequired: result.data.migrationRequired }
        : {}),
      tableCount: asArray(result.data.tables).length,
      failureCodes,
    },
  };
}

function safeEvidenceStatus(input: unknown): "failed" | "passed" | "unknown" {
  return input === "passed" || input === "failed" ? input : "unknown";
}

function safeDecisionStatus(
  input: unknown,
): "accepted" | "deferred" | "required" | "unknown" {
  if (input === "accepted" || input === "deferred" || input === "required") {
    return input;
  }
  return "unknown";
}

function safeCount(input: unknown): number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0
    ? input
    : 0;
}

function safeOptionalNumber(input: unknown): number | undefined {
  return typeof input === "number" && Number.isFinite(input) && input >= 0
    ? input
    : undefined;
}

function failurePresenceCodes(input: unknown, code: string): string[] {
  return asArray(input).length === 0 ? [] : [code];
}

function safeToken(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) return "unknown";
  if (!/^[A-Za-z0-9:._/-]{1,160}$/.test(input)) return "redacted";
  return input;
}

function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
