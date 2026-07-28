import { z } from "@hono/zod-openapi";

export const id = z.string().min(1);
export const timestamp = z.string().datetime();
export const evidenceInvalidReason = z.enum([
  "invalid_json",
  "read_failed",
  "schema_mismatch",
]);
export const gaSummary = z.strictObject({
  total: z.number().int().nonnegative(),
  satisfied: z.number().int().nonnegative(),
  excepted: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  environmentRequired: z.number().int().nonnegative(),
  securityCriticalBlocked: z.number().int().nonnegative(),
});
export const gaTarget = z.strictObject({
  profile: z.enum(["default-ga", "full-product-enterprise", "unknown"]),
  fullProductEnterpriseRequired: z.boolean(),
  deploymentTiers: z.array(z.string()),
  postgresModes: z.array(z.string()),
  qdrantLiveRequired: z.boolean(),
  qdrantDrRequired: z.boolean(),
  ciGovernanceLiveRequired: z.boolean(),
  kedaRequired: z.boolean(),
  browserAutomationRequired: z.boolean(),
  identityLiveRequired: z.boolean(),
  dataConnectorLiveRequired: z.boolean(),
  toolDispatchLiveRequired: z.boolean(),
  voiceProviderLiveRequired: z.boolean(),
  notificationAdapterLiveRequired: z.boolean(),
  analyticsAuthzLiveRequired: z.boolean(),
  targetQualityVectorComparisonRequired: z.boolean(),
  dataRightsRetentionLiveRequired: z.boolean(),
  billingOperationsLiveRequired: z.boolean(),
  auditIntegrityLiveRequired: z.boolean(),
  tenantPurgeLiveRequired: z.boolean(),
  supportBundleLiveRequired: z.boolean(),
  targetResilienceDrillsRequired: z.boolean(),
  postgresOperationsLiveRequired: z.boolean(),
});
export const GaEvidencePostureGateEvidenceSchema = z
  .strictObject({
    path: z.string(),
    status: z.enum([
      "failed",
      "invalid_json",
      "missing",
      "satisfied",
      "unknown",
    ]),
    schemaVersion: z.string().optional(),
    evidenceStatus: z.string().optional(),
    failureCodes: z.array(z.string()),
  })
  .openapi("GaEvidencePostureGateEvidence");
export const GaEvidencePostureGateSchema = z
  .strictObject({
    id,
    phase: z.string(),
    title: z.string(),
    status: z.enum(["blocked", "excepted", "satisfied", "unknown"]),
    requiredForGa: z.boolean(),
    exceptionAllowed: z.boolean(),
    environmentRequired: z.boolean(),
    securityCritical: z.boolean(),
    evidence: z.array(GaEvidencePostureGateEvidenceSchema),
    exception: z
      .strictObject({
        status: z.enum(["invalid", "valid", "unknown"]),
        expiresAt: timestamp.optional(),
        failureCodes: z.array(z.string()),
      })
      .optional(),
  })
  .openapi("GaEvidencePostureGate");
export const preflightGateEvidence = z.strictObject({
  path: z.string(),
  status: z.enum([
    "blocked",
    "failed",
    "missing",
    "ready",
    "satisfied",
    "unknown",
  ]),
  schemaVersion: z.string().optional(),
});
const preflightCheck = z.strictObject({
  name: z.string(),
  status: z.enum(["blocked", "optional", "ready", "unknown"]),
  reason: z.string().optional(),
  configured: z.boolean().optional(),
  required: z.boolean().optional(),
  configuredNames: z.array(z.string()).optional(),
  context: z.string().optional(),
  origin: z.string().optional(),
  path: z.string().optional(),
  baselineConfigured: z.boolean().optional(),
  candidateConfigured: z.boolean().optional(),
  replayKind: z.string().optional(),
  baselineRouteMode: z.string().optional(),
  candidateRouteMode: z.string().optional(),
  baselineCaseCount: z.number().int().nonnegative().optional(),
  candidateCaseCount: z.number().int().nonnegative().optional(),
});
export const preflightGate = z.strictObject({
  id,
  phase: z.string(),
  title: z.string(),
  status: z.enum(["blocked", "ready", "unknown"]),
  environmentRequired: z.boolean(),
  securityCritical: z.boolean(),
  evidence: z.array(preflightGateEvidence),
  command: z.string().optional(),
  checks: z.array(preflightCheck),
  notes: z.array(z.string()),
});
export const targetPlanGate = z.strictObject({
  order: z.number().int().nonnegative(),
  id,
  phase: z.string(),
  title: z.string(),
  status: z.enum(["blocked", "ready", "unknown"]),
  environmentRequired: z.boolean(),
  securityCritical: z.boolean(),
  command: z.string().optional(),
  commandRedacted: z.boolean(),
  operatorAction: z.strictObject({
    state: z.enum([
      "blocked_on_prerequisites",
      "command_redacted",
      "ready_to_run",
      "unknown",
    ]),
    commandAvailable: z.boolean(),
    prerequisiteBlocked: z.boolean(),
    blockedReasonCodes: z.array(z.string()),
  }),
  evidenceTargets: z.array(preflightGateEvidence),
  requiredCommands: z.array(z.string()),
  requiredEnvironment: z.array(z.string()),
  anyOfEnvironment: z.array(z.array(z.string())),
  optionalEnvironment: z.array(z.string()),
  requiredFiles: z.array(z.string()),
  checks: z.strictObject({
    total: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    optional: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
    blockedReasons: z.array(z.string()),
  }),
  blockedChecks: z.array(
    z.strictObject({
      name: z.string(),
      reason: z.string(),
      configured: z.boolean().optional(),
    }),
  ),
  notes: z.array(z.string()),
});
export const targetExecutionGate = z.strictObject({
  id,
  phase: z.string(),
  title: z.string(),
  targetStatus: z.enum(["blocked", "ready", "unknown"]),
  operatorActionState: z.enum([
    "blocked_on_prerequisites",
    "command_redacted",
    "ready_to_run",
    "unknown",
  ]),
  commandHash: z.string().optional(),
  commandAvailable: z.boolean(),
  commandRedacted: z.boolean(),
  executionStatus: z.enum(["failed", "passed", "skipped", "unknown"]),
  skippedReason: z.string().optional(),
  failureReason: z.string().optional(),
  exitCode: z.number().int().optional(),
  signal: z.string().optional(),
  startedAt: timestamp.optional(),
  completedAt: timestamp.optional(),
  durationMs: z.number().nonnegative(),
  evidenceTargets: z.array(preflightGateEvidence),
  blockedReasonCodes: z.array(z.string()),
});
export const gaBundleTarget = gaTarget
  .omit({ deploymentTiers: true, postgresModes: true })
  .extend({
    status: z.string(),
    strict: z.boolean(),
    summary: gaSummary,
    blockedGateIds: z.array(z.string()),
    exceptionCount: z.number().int().nonnegative(),
  });
