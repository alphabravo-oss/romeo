import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import {
  readJsonEvidence,
  summarizeArchivalPartitioning,
  summarizeLockTelemetry,
  summarizeQueryPlanEvidence,
  summarizeSlowQueryTelemetry,
  type EvidenceInvalidReason,
} from "./postgres-operational-evidence";
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
