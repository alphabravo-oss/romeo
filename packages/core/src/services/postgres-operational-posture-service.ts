import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";
import {
  analyzePostgresConnectionSecurity,
  type PostgresConnectionSecurityPosture,
} from "./postgres-connection-security";

const QUERY_PLAN_REVIEW_CHECKS = [
  {
    id: "chats_workspace_recent",
    category: "chat-history",
    expectedIndexCount: 1,
  },
  {
    id: "messages_chat_ordered",
    category: "chat-history",
    expectedIndexCount: 1,
  },
  { id: "runs_org_recent", category: "run-history", expectedIndexCount: 1 },
  { id: "run_events_sequence", category: "run-history", expectedIndexCount: 1 },
  { id: "audit_org_recent", category: "audit", expectedIndexCount: 1 },
  {
    id: "audit_retention_delete_candidates",
    category: "governed-deletion",
    expectedIndexCount: 1,
  },
  { id: "usage_org_recent", category: "usage", expectedIndexCount: 1 },
  {
    id: "background_jobs_queued",
    category: "worker-queue",
    expectedIndexCount: 1,
  },
  {
    id: "data_connectors_due_sync",
    category: "connector-sync",
    expectedIndexCount: 1,
  },
  {
    id: "data_connector_syncs_connector_recent",
    category: "connector-sync",
    expectedIndexCount: 1,
  },
  {
    id: "workflow_definitions_due_schedule",
    category: "workflow-resume",
    expectedIndexCount: 1,
  },
  {
    id: "workflow_runs_waiting",
    category: "workflow-resume",
    expectedIndexCount: 1,
  },
  {
    id: "notification_delivery_retry",
    category: "notification-retry",
    expectedIndexCount: 1,
  },
  {
    id: "webhook_deliveries_retry_due",
    category: "webhook-retry",
    expectedIndexCount: 1,
  },
  {
    id: "knowledge_sources_recent",
    category: "retrieval",
    expectedIndexCount: 1,
  },
  {
    id: "knowledge_chunks_sequence",
    category: "retrieval",
    expectedIndexCount: 1,
  },
  {
    id: "knowledge_embedding_vector_search",
    category: "retrieval",
    expectedIndexCount: 2,
  },
  {
    id: "resource_grants_lookup",
    category: "access-review",
    expectedIndexCount: 1,
  },
  {
    id: "quota_buckets_org_metric",
    category: "billing",
    expectedIndexCount: 1,
  },
  {
    id: "quota_buckets_due_reset",
    category: "billing",
    expectedIndexCount: 1,
  },
  { id: "billing_plan_org", category: "billing", expectedIndexCount: 1 },
] as const;

export type PostgresOperationalPostureStatus = "attention_required" | "ready";

export type PostgresOperationalWarningCode =
  | "archival_partitioning_decision_required"
  | "live_lock_telemetry_required"
  | "postgres_archival_decision_failures_present"
  | "postgres_connection_security_warning"
  | "postgres_lock_telemetry_failures_present"
  | "postgres_slow_query_failures_present"
  | "representative_query_plan_evidence_required"
  | "slow_query_telemetry_required";

type EvidenceInvalidReason = "invalid_json" | "read_failed" | "schema_mismatch";

export interface PostgresOperationalPostureReport {
  schema: "romeo.postgres-operational-posture.v1";
  generatedAt: string;
  orgId: string;
  status: PostgresOperationalPostureStatus;
  repository: {
    driver: RomeoEnv["REPOSITORY_DRIVER"];
    databaseUrlConfigured: boolean;
    postgresRequiredForProduction: boolean;
  };
  pool: {
    maxConnectionsPerProcess: number;
    source: "POSTGRES_POOL_MAX";
    sizingGuide: "docs/deployment-sizing.md";
    budgetFormula: string;
  };
  connectionSecurity: PostgresConnectionSecurityPosture;
  queryPlanReview: {
    evidenceSchema: "romeo.postgres-query-plan-review.v1";
    command: "pnpm review:postgres-query-plans";
    reviewedPathCount: number;
    requiredIndexCount: number;
    categories: string[];
    checks: Array<{
      id: string;
      category: string;
      expectedIndexCount: number;
    }>;
    representativeVolumeEvidence: {
      requiredForGa: true;
      status: "invalid" | "required" | "satisfied";
      evidenceSource: "configured_file" | "not_configured";
      configured: boolean;
      representativeVolume: boolean;
      evidenceStatus?: "failed" | "passed" | "unknown";
      schemaVersion?: "romeo.postgres-query-plan-review.v1";
      generatedAt?: string;
      invalidReason?: EvidenceInvalidReason;
      missingExpectedIndexCount: number;
      failedCheckCount: number;
    };
  };
  slowQueryTelemetry: {
    requiredForProduction: true;
    status: "external_required" | "invalid" | "satisfied";
    expectedSignals: string[];
    evidence: {
      configured: boolean;
      schemaVersion?: "romeo.postgres-slow-query-telemetry.v1";
      generatedAt?: string;
      evidenceStatus?: "failed" | "passed" | "unknown";
      invalidReason?: EvidenceInvalidReason;
      windowMinutes?: number;
      fingerprintCount: number;
      slowQueryCount: number;
      totalCalls: number;
      maxMeanMs?: number;
      maxP95Ms?: number;
      maxP99Ms?: number;
      tempFileStatementCount: number;
      failureCodes: string[];
    };
  };
  lockTelemetry: {
    requiredForProduction: true;
    status: "external_required" | "invalid" | "satisfied";
    expectedSignals: string[];
    evidence: {
      configured: boolean;
      schemaVersion?: "romeo.postgres-lock-telemetry.v1";
      generatedAt?: string;
      evidenceStatus?: "failed" | "passed" | "unknown";
      invalidReason?: EvidenceInvalidReason;
      windowMinutes?: number;
      blockedSessionMax: number;
      longestWaitMs?: number;
      deadlockCount: number;
      failureCodes: string[];
    };
  };
  archivalPartitioning: {
    status: "accepted" | "decision_required" | "invalid";
    currentDecision: string;
    migrationPolicy: "one_forward_migration_after_live_evidence";
    decisionInputs: string[];
    evidence: {
      configured: boolean;
      schemaVersion?: "romeo.postgres-archival-partitioning-decision.v1";
      generatedAt?: string;
      decisionStatus?: "accepted" | "deferred" | "required" | "unknown";
      invalidReason?: EvidenceInvalidReason;
      migrationRequired?: boolean;
      tableCount: number;
      failureCodes: string[];
    };
  };
  redaction: {
    databaseUrlReturned: false;
    evidenceFileBodiesReturned: false;
    lockStatementReturned: false;
    queryParameterValuesReturned: false;
    rawSqlReturned: false;
    rawEvidencePathsReturned: false;
    rowDataReturned: false;
    secretValuesReturned: false;
    telemetrySampleSqlReturned: false;
  };
  warnings: PostgresOperationalWarningCode[];
}

export class PostgresOperationalPostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(
    subject: AuthSubject,
  ): Promise<PostgresOperationalPostureReport> {
    assertScope(subject, "admin:read");

    const checks = QUERY_PLAN_REVIEW_CHECKS.map((check) => ({ ...check }));
    const categories = Array.from(
      new Set(checks.map((check) => check.category)),
    ).sort();
    const requiredIndexCount = checks.reduce(
      (total, check) => total + check.expectedIndexCount,
      0,
    );
    const queryPlanEvidence = summarizeQueryPlanEvidence(
      await readJsonEvidence(
        this.env.POSTGRES_QUERY_PLAN_EVIDENCE_PATH,
        "romeo.postgres-query-plan-review.v1",
      ),
    );
    const slowQueryTelemetry = summarizeSlowQueryTelemetry(
      await readJsonEvidence(
        this.env.POSTGRES_SLOW_QUERY_TELEMETRY_EVIDENCE_PATH,
        "romeo.postgres-slow-query-telemetry.v1",
      ),
    );
    const lockTelemetry = summarizeLockTelemetry(
      await readJsonEvidence(
        this.env.POSTGRES_LOCK_TELEMETRY_EVIDENCE_PATH,
        "romeo.postgres-lock-telemetry.v1",
      ),
    );
    const archivalPartitioning = summarizeArchivalPartitioning(
      await readJsonEvidence(
        this.env.POSTGRES_ARCHIVAL_PARTITIONING_DECISION_PATH,
        "romeo.postgres-archival-partitioning-decision.v1",
      ),
    );
    const warnings: PostgresOperationalWarningCode[] = [];
    const connectionSecurity = analyzePostgresConnectionSecurity(
      this.env.DATABASE_URL,
    );
    if (connectionSecurity.warningCodes.length > 0) {
      warnings.push("postgres_connection_security_warning");
    }
    if (queryPlanEvidence.status !== "satisfied") {
      warnings.push("representative_query_plan_evidence_required");
    }
    if (slowQueryTelemetry.status !== "satisfied") {
      warnings.push("slow_query_telemetry_required");
    }
    if (
      slowQueryTelemetry.evidence.failureCodes.includes(
        "postgres_slow_query_failures_present",
      )
    ) {
      warnings.push("postgres_slow_query_failures_present");
    }
    if (lockTelemetry.status !== "satisfied") {
      warnings.push("live_lock_telemetry_required");
    }
    if (
      lockTelemetry.evidence.failureCodes.includes(
        "postgres_lock_telemetry_failures_present",
      )
    ) {
      warnings.push("postgres_lock_telemetry_failures_present");
    }
    if (archivalPartitioning.status !== "accepted") {
      warnings.push("archival_partitioning_decision_required");
    }
    if (
      archivalPartitioning.evidence.failureCodes.includes(
        "postgres_archival_decision_failures_present",
      )
    ) {
      warnings.push("postgres_archival_decision_failures_present");
    }

    return {
      schema: "romeo.postgres-operational-posture.v1",
      generatedAt: new Date().toISOString(),
      orgId: subject.orgId,
      status: warnings.length === 0 ? "ready" : "attention_required",
      repository: {
        driver: this.env.REPOSITORY_DRIVER,
        databaseUrlConfigured: this.env.DATABASE_URL.trim().length > 0,
        postgresRequiredForProduction: true,
      },
      pool: {
        maxConnectionsPerProcess: this.env.POSTGRES_POOL_MAX,
        source: "POSTGRES_POOL_MAX",
        sizingGuide: "docs/deployment-sizing.md",
        budgetFormula:
          "app_max_replicas * POSTGRES_POOL_MAX + maintenance + workers + scaler <= usable_database_connections",
      },
      connectionSecurity,
      queryPlanReview: {
        evidenceSchema: "romeo.postgres-query-plan-review.v1",
        command: "pnpm review:postgres-query-plans",
        reviewedPathCount: checks.length,
        requiredIndexCount,
        categories,
        checks,
        representativeVolumeEvidence: queryPlanEvidence,
      },
      slowQueryTelemetry: {
        requiredForProduction: true,
        status: slowQueryTelemetry.status,
        expectedSignals: [
          "statement latency percentile",
          "normalized query fingerprint",
          "calls per interval",
          "rows read or returned",
          "temp file usage",
        ],
        evidence: slowQueryTelemetry.evidence,
      },
      lockTelemetry: {
        requiredForProduction: true,
        status: lockTelemetry.status,
        expectedSignals: [
          "blocked session count",
          "blocking session age",
          "lock wait duration",
          "relation or object class",
          "deadlock count",
        ],
        evidence: lockTelemetry.evidence,
      },
      archivalPartitioning: {
        status: archivalPartitioning.status,
        currentDecision: archivalPartitioning.currentDecision,
        migrationPolicy: "one_forward_migration_after_live_evidence",
        decisionInputs: [
          "representative query plans",
          "table growth by tier",
          "retention and legal-hold requirements",
          "backup and restore duration",
          "tenant isolation requirements",
        ],
        evidence: archivalPartitioning.evidence,
      },
      redaction: {
        databaseUrlReturned: false,
        evidenceFileBodiesReturned: false,
        lockStatementReturned: false,
        queryParameterValuesReturned: false,
        rawSqlReturned: false,
        rawEvidencePathsReturned: false,
        rowDataReturned: false,
        secretValuesReturned: false,
        telemetrySampleSqlReturned: false,
      },
      warnings,
    };
  }
}

type ReadEvidenceResult =
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

async function readJsonEvidence(
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

function summarizeQueryPlanEvidence(
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

function summarizeSlowQueryTelemetry(result: ReadEvidenceResult): {
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

function summarizeLockTelemetry(result: ReadEvidenceResult): {
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

function summarizeArchivalPartitioning(result: ReadEvidenceResult): {
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
