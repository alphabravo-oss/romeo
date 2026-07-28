import { z } from "@hono/zod-openapi";

const id = z.string().min(1);
const timestamp = z.string().datetime();
const evidenceInvalidReason = z.enum([
  "invalid_json",
  "read_failed",
  "schema_mismatch",
]);
const postgresEvidenceBase = {
  configured: z.boolean(),
  generatedAt: timestamp.optional(),
  evidenceStatus: z.enum(["failed", "passed", "unknown"]).optional(),
  invalidReason: evidenceInvalidReason.optional(),
};
export const PostgresOperationalPostureReportSchema = z
  .strictObject({
    schema: z.literal("romeo.postgres-operational-posture.v1"),
    generatedAt: timestamp,
    orgId: id,
    status: z.enum(["attention_required", "ready"]),
    repository: z.strictObject({
      driver: z.enum(["memory", "postgres"]),
      databaseUrlConfigured: z.boolean(),
      postgresRequiredForProduction: z.boolean(),
    }),
    pool: z.strictObject({
      maxConnectionsPerProcess: z.number().int().nonnegative(),
      source: z.literal("POSTGRES_POOL_MAX"),
      sizingGuide: z.literal("docs/deployment-sizing.md"),
      budgetFormula: z.string(),
    }),
    connectionSecurity: z.strictObject({
      databaseUrlValid: z.boolean(),
      hostCategory: z.enum([
        "invalid",
        "internal",
        "local",
        "missing",
        "remote",
      ]),
      hostedPostgresTlsRecommended: z.boolean(),
      sslmodeSource: z.enum(["none", "ssl", "sslmode"]),
      tlsConfigured: z.boolean(),
      tlsMode: z.enum([
        "allow",
        "disable",
        "prefer",
        "require",
        "unknown",
        "verify_ca",
        "verify_full",
      ]),
      tlsVerification: z.enum([
        "certificate_authority",
        "full",
        "none",
        "opportunistic",
        "unknown",
      ]),
      warningCodes: z.array(
        z.enum([
          "postgres_database_url_invalid",
          "postgres_hosted_tls_not_configured",
          "postgres_hosted_tls_verification_recommended",
        ]),
      ),
      redaction: z.strictObject({
        databaseUrlReturned: z.literal(false),
        hostReturned: z.literal(false),
        passwordReturned: z.literal(false),
        usernameReturned: z.literal(false),
      }),
    }),
    queryPlanReview: z.strictObject({
      evidenceSchema: z.literal("romeo.postgres-query-plan-review.v1"),
      command: z.literal("pnpm review:postgres-query-plans"),
      reviewedPathCount: z.number().int().nonnegative(),
      requiredIndexCount: z.number().int().nonnegative(),
      categories: z.array(z.string()),
      checks: z.array(
        z.strictObject({
          id,
          category: z.string(),
          expectedIndexCount: z.number().int().nonnegative(),
        }),
      ),
      representativeVolumeEvidence: z.strictObject({
        requiredForGa: z.literal(true),
        status: z.enum(["invalid", "required", "satisfied"]),
        evidenceSource: z.enum(["configured_file", "not_configured"]),
        configured: z.boolean(),
        representativeVolume: z.boolean(),
        evidenceStatus: z.enum(["failed", "passed", "unknown"]).optional(),
        schemaVersion: z
          .literal("romeo.postgres-query-plan-review.v1")
          .optional(),
        generatedAt: timestamp.optional(),
        invalidReason: evidenceInvalidReason.optional(),
        missingExpectedIndexCount: z.number().int().nonnegative(),
        failedCheckCount: z.number().int().nonnegative(),
      }),
    }),
    slowQueryTelemetry: z.strictObject({
      requiredForProduction: z.literal(true),
      status: z.enum(["external_required", "invalid", "satisfied"]),
      expectedSignals: z.array(z.string()),
      evidence: z.strictObject({
        ...postgresEvidenceBase,
        schemaVersion: z
          .literal("romeo.postgres-slow-query-telemetry.v1")
          .optional(),
        windowMinutes: z.number().nonnegative().optional(),
        fingerprintCount: z.number().int().nonnegative(),
        slowQueryCount: z.number().int().nonnegative(),
        totalCalls: z.number().int().nonnegative(),
        maxMeanMs: z.number().nonnegative().optional(),
        maxP95Ms: z.number().nonnegative().optional(),
        maxP99Ms: z.number().nonnegative().optional(),
        tempFileStatementCount: z.number().int().nonnegative(),
        failureCodes: z.array(z.string()),
      }),
    }),
    lockTelemetry: z.strictObject({
      requiredForProduction: z.literal(true),
      status: z.enum(["external_required", "invalid", "satisfied"]),
      expectedSignals: z.array(z.string()),
      evidence: z.strictObject({
        ...postgresEvidenceBase,
        schemaVersion: z.literal("romeo.postgres-lock-telemetry.v1").optional(),
        windowMinutes: z.number().nonnegative().optional(),
        blockedSessionMax: z.number().int().nonnegative(),
        longestWaitMs: z.number().nonnegative().optional(),
        deadlockCount: z.number().int().nonnegative(),
        failureCodes: z.array(z.string()),
      }),
    }),
    archivalPartitioning: z.strictObject({
      status: z.enum(["accepted", "decision_required", "invalid"]),
      currentDecision: z.string(),
      migrationPolicy: z.literal("one_forward_migration_after_live_evidence"),
      decisionInputs: z.array(z.string()),
      evidence: z.strictObject({
        configured: z.boolean(),
        schemaVersion: z
          .literal("romeo.postgres-archival-partitioning-decision.v1")
          .optional(),
        generatedAt: timestamp.optional(),
        decisionStatus: z
          .enum(["accepted", "deferred", "required", "unknown"])
          .optional(),
        invalidReason: evidenceInvalidReason.optional(),
        migrationRequired: z.boolean().optional(),
        tableCount: z.number().int().nonnegative(),
        failureCodes: z.array(z.string()),
      }),
    }),
    redaction: z.strictObject({
      databaseUrlReturned: z.literal(false),
      evidenceFileBodiesReturned: z.literal(false),
      lockStatementReturned: z.literal(false),
      queryParameterValuesReturned: z.literal(false),
      rawSqlReturned: z.literal(false),
      rawEvidencePathsReturned: z.literal(false),
      rowDataReturned: z.literal(false),
      secretValuesReturned: z.literal(false),
      telemetrySampleSqlReturned: z.literal(false),
    }),
    warnings: z.array(
      z.enum([
        "archival_partitioning_decision_required",
        "live_lock_telemetry_required",
        "postgres_archival_decision_failures_present",
        "postgres_connection_security_warning",
        "postgres_lock_telemetry_failures_present",
        "postgres_slow_query_failures_present",
        "representative_query_plan_evidence_required",
        "slow_query_telemetry_required",
      ]),
    ),
  })
  .openapi("PostgresOperationalPostureReport");
