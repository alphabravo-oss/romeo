import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

import type { BackgroundJob } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";

const toolDispatchJobType = "tool.operation.dispatch_request";
const toolDispatchWorkerQueue = "external_tool_operations";
const toolDispatchMaxAttempts = 3;
const queuedStaleSeconds = 86_400;
const runningStaleSeconds = 3_600;
const toolDispatchLiveEvidenceSchema = "romeo.tool-dispatch-live-evidence.v1";

const requiredLiveEvidenceChecks = [
  "worker_claim_execution_verified",
  "managed_payload_read_verified",
  "mcp_streamable_http_tools_call_verified",
  "worker_cni_egress_enforced",
  "dns_private_address_denied",
  "secret_resolution_verified",
  "worker_crash_retry_or_reclaim_verified",
  "response_schema_validation_verified",
  "worker_log_redaction",
  "sanitized_readback_verified",
] as const;

export type ToolDispatchPostureWarning =
  | "tool_dispatch_dead_letters_present"
  | "tool_dispatch_execution_disabled"
  | "tool_dispatch_failed_jobs_present"
  | "tool_dispatch_live_evidence_invalid"
  | "tool_dispatch_live_evidence_required"
  | "tool_dispatch_managed_payload_store_disabled"
  | "tool_dispatch_network_policy_not_configured"
  | "tool_dispatch_stale_jobs_present"
  | "tool_dispatch_worker_not_enabled";

export interface ToolDispatchPostureReport {
  schema: "romeo.tool-dispatch-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  backend: {
    activeLeaseRequiredForPayloadReadback: true;
    jobType: typeof toolDispatchJobType;
    maxAttempts: typeof toolDispatchMaxAttempts;
    requiredWorkerScope: "tools:manage";
    terminalReadbackRejectsReplay: true;
    workerQueue: typeof toolDispatchWorkerQueue;
  };
  deployment: {
    externalOperationExecutionEnabled: boolean;
    liveEvidencePathConfigured: boolean;
    networkPolicyConfigured: boolean;
    operationExecutionDriver: RomeoEnv["TOOL_OPERATION_EXECUTION_DRIVER"];
    payloadEncryptionKeyConfigured: boolean;
    payloadStoreConfigured: boolean;
    payloadStoreDriver: RomeoEnv["TOOL_DISPATCH_PAYLOAD_STORE_DRIVER"];
    workerEnabled: boolean;
  };
  queue: {
    cancelled: number;
    completed: number;
    deadLettered: number;
    expired: number;
    failed: number;
    oldestQueuedAgeSeconds: number | null;
    queued: number;
    running: number;
    staleQueued: number;
    staleRunning: number;
    total: number;
  };
  payloadStorage: {
    externalWorkerSecretStoreRequired: number;
    managedEncryptedObjectStore: number;
    unknown: number;
  };
  liveEvidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "satisfied";
    schemaVersion?: typeof toolDispatchLiveEvidenceSchema;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    generatedAt?: string;
    checks: Record<(typeof requiredLiveEvidenceChecks)[number], boolean>;
    failureCodes: string[];
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    summary: {
      completedDispatchCount: number;
      deniedPrivateTargetCount: number;
      dispatchRequestCount: number;
      failedDispatchCount: number;
      managedPayloadReadCount: number;
      podLogScanCount: number;
      reclaimedDispatchCount: number;
      schemaValidationCount: number;
      secretResolutionCount: number;
      workerLogScanCount: number;
    };
    mcp: {
      callCount: number;
      jsonRpcEnvelopeVerified: boolean;
      outputRedacted: boolean;
      payloadArgumentsRedacted: boolean;
      protocolHeadersVerified: boolean;
      streamableHttpToolsCallVerified: boolean;
    };
    redaction: {
      rawEvidencePathsReturned: boolean;
      rawLogLinesReturned: boolean;
      rawObjectStoreKeysReturned: boolean;
      rawOperationHostsReturned: boolean;
      rawPayloadValuesReturned: boolean;
      rawResponseBodiesReturned: boolean;
      rawSecretRefsReturned: boolean;
      secretValuesReturned: boolean;
      tokenValuesReturned: boolean;
    };
  };
  redaction: {
    evidenceFileBodiesReturned: false;
    rawEvidencePathsReturned: false;
    rawObjectStoreKeysReturned: false;
    rawOperationHostsReturned: false;
    rawPayloadValuesReturned: false;
    rawResponseBodiesReturned: false;
    rawSecretRefsReturned: false;
    secretValuesReturned: false;
    tokenValuesReturned: false;
  };
  warnings: ToolDispatchPostureWarning[];
}

export class ToolDispatchPostureService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly env: RomeoEnv,
  ) {}

  async report(subject: AuthSubject): Promise<ToolDispatchPostureReport> {
    assertScope(subject, "admin:read");
    const nowMs = Date.now();
    const jobs = (
      await this.repository.listBackgroundJobs(subject.orgId)
    ).filter((job) => job.type === toolDispatchJobType);
    const queue = queuePosture(jobs, nowMs);
    const payloadStorage = payloadStoragePosture(jobs);
    const liveEvidence = await readToolDispatchLiveEvidence(
      this.env.TOOL_DISPATCH_LIVE_EVIDENCE_PATH,
    );
    const deployment = {
      externalOperationExecutionEnabled:
        this.env.TOOL_OPERATION_EXECUTION_DRIVER === "http-fetch",
      liveEvidencePathConfigured:
        this.env.TOOL_DISPATCH_LIVE_EVIDENCE_PATH.trim().length > 0,
      networkPolicyConfigured: this.env.TOOL_DISPATCH_NETWORK_POLICY_ENABLED,
      operationExecutionDriver: this.env.TOOL_OPERATION_EXECUTION_DRIVER,
      payloadEncryptionKeyConfigured:
        this.env.TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY.trim().length >= 32,
      payloadStoreConfigured:
        this.env.TOOL_DISPATCH_PAYLOAD_STORE_DRIVER === "object-store" &&
        this.env.TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY.trim().length >= 32,
      payloadStoreDriver: this.env.TOOL_DISPATCH_PAYLOAD_STORE_DRIVER,
      workerEnabled: this.env.TOOL_DISPATCH_WORKER_ENABLED,
    } satisfies ToolDispatchPostureReport["deployment"];
    const warnings = warningCodes({
      deadLettered: queue.deadLettered,
      deployment,
      failed: queue.failed,
      liveEvidenceStatus: liveEvidence.status,
      staleQueued: queue.staleQueued,
      staleRunning: queue.staleRunning,
    });
    return {
      schema: "romeo.tool-dispatch-posture.v1",
      generatedAt: new Date(nowMs).toISOString(),
      orgId: subject.orgId,
      status: warnings.length === 0 ? "ready" : "attention_required",
      backend: {
        activeLeaseRequiredForPayloadReadback: true,
        jobType: toolDispatchJobType,
        maxAttempts: toolDispatchMaxAttempts,
        requiredWorkerScope: "tools:manage",
        terminalReadbackRejectsReplay: true,
        workerQueue: toolDispatchWorkerQueue,
      },
      deployment,
      queue,
      payloadStorage,
      liveEvidence,
      redaction: {
        evidenceFileBodiesReturned: false,
        rawEvidencePathsReturned: false,
        rawObjectStoreKeysReturned: false,
        rawOperationHostsReturned: false,
        rawPayloadValuesReturned: false,
        rawResponseBodiesReturned: false,
        rawSecretRefsReturned: false,
        secretValuesReturned: false,
        tokenValuesReturned: false,
      },
      warnings,
    };
  }
}

function queuePosture(
  jobs: BackgroundJob[],
  nowMs: number,
): ToolDispatchPostureReport["queue"] {
  let cancelled = 0;
  let completed = 0;
  let deadLettered = 0;
  let expired = 0;
  let failed = 0;
  let oldestQueuedAgeSeconds: number | null = null;
  let queued = 0;
  let running = 0;
  let staleQueued = 0;
  let staleRunning = 0;

  for (const job of jobs) {
    if (job.status === "completed") completed += 1;
    if (job.status === "failed") failed += 1;
    if (job.payload.deadLetter !== undefined) deadLettered += 1;
    if (job.payload.errorCode === "worker_cancelled") cancelled += 1;
    if (job.payload.errorCode === "worker_dispatch_request_expired")
      expired += 1;
    if (job.status === "queued") {
      queued += 1;
      const ageSeconds = ageSecondsSince(job.createdAt, nowMs);
      if (ageSeconds !== undefined) {
        oldestQueuedAgeSeconds =
          oldestQueuedAgeSeconds === null
            ? ageSeconds
            : Math.max(oldestQueuedAgeSeconds, ageSeconds);
        if (ageSeconds >= queuedStaleSeconds) staleQueued += 1;
      }
    }
    if (job.status === "running") {
      running += 1;
      const lease = workerLease(job);
      const expiresAtMs =
        lease === undefined ? undefined : Date.parse(lease.expiresAt);
      if (
        expiresAtMs !== undefined &&
        Number.isFinite(expiresAtMs) &&
        nowMs - expiresAtMs >= runningStaleSeconds * 1000
      ) {
        staleRunning += 1;
      }
    }
  }

  return {
    cancelled,
    completed,
    deadLettered,
    expired,
    failed,
    oldestQueuedAgeSeconds,
    queued,
    running,
    staleQueued,
    staleRunning,
    total: jobs.length,
  };
}

function payloadStoragePosture(
  jobs: BackgroundJob[],
): ToolDispatchPostureReport["payloadStorage"] {
  let externalWorkerSecretStoreRequired = 0;
  let managedEncryptedObjectStore = 0;
  let unknown = 0;
  for (const job of jobs) {
    if (job.payload.payloadStorage === "managed_encrypted_object_store") {
      managedEncryptedObjectStore += 1;
    } else if (
      job.payload.payloadStorage === "external_worker_secret_store_required" ||
      job.payload.payloadStorage === undefined
    ) {
      externalWorkerSecretStoreRequired += 1;
    } else {
      unknown += 1;
    }
  }
  return {
    externalWorkerSecretStoreRequired,
    managedEncryptedObjectStore,
    unknown,
  };
}

async function readToolDispatchLiveEvidence(
  evidencePath: string,
): Promise<ToolDispatchPostureReport["liveEvidence"]> {
  const notConfigured: ToolDispatchPostureReport["liveEvidence"] = {
    configured: false,
    source: "not_configured",
    status: "not_configured",
    checks: emptyChecks(),
    failureCodes: [],
    summary: emptySummary(),
    mcp: emptyMcp(),
    redaction: liveEvidenceRedaction(),
  };
  if (evidencePath.trim().length === 0) return notConfigured;

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(evidencePath, "utf8"));
  } catch (error) {
    const invalidReason = isSyntaxError(error) ? "invalid_json" : "read_failed";
    return {
      ...notConfigured,
      configured: true,
      source: "configured_file",
      status: "invalid",
      failureCodes: [invalidReason],
      invalidReason,
    };
  }

  if (!isRecord(parsed)) return invalidEvidence("schema_mismatch");
  const schemaVersion =
    stringValue(parsed.schemaVersion) ?? stringValue(parsed.schema);
  if (schemaVersion !== toolDispatchLiveEvidenceSchema) {
    return invalidEvidence("schema_mismatch");
  }

  const checks = liveEvidenceChecks(parsed.checks);
  const redaction = liveEvidenceRedactionFrom(parsed.redaction);
  const mcp = liveEvidenceMcp(parsed.mcp);
  const summary = liveEvidenceSummary(parsed);
  const evidenceStatus = evidenceStatusValue(parsed.status);
  const mode = modeValue(parsed.mode);
  const deployment = deploymentValue(parsed.deployment);
  const failureCodes = liveEvidenceFailureCodes({
    checks,
    deployment,
    evidence: parsed,
    evidenceStatus,
    mcp,
    mode,
    redaction,
    summary,
  });
  const failed = evidenceStatus !== "passed" || failureCodes.length > 0;
  return {
    configured: true,
    source: "configured_file",
    status: failed ? "failed" : "satisfied",
    schemaVersion: toolDispatchLiveEvidenceSchema,
    evidenceStatus,
    ...(typeof parsed.generatedAt === "string"
      ? { generatedAt: parsed.generatedAt }
      : {}),
    mode,
    deployment,
    checks,
    failureCodes,
    summary,
    mcp,
    redaction,
  };
}

function invalidEvidence(
  invalidReason: "invalid_json" | "read_failed" | "schema_mismatch",
): ToolDispatchPostureReport["liveEvidence"] {
  return {
    configured: true,
    source: "configured_file",
    status: "invalid",
    checks: emptyChecks(),
    failureCodes: [invalidReason],
    invalidReason,
    summary: emptySummary(),
    mcp: emptyMcp(),
    redaction: liveEvidenceRedaction(),
  };
}

function emptyChecks(): ToolDispatchPostureReport["liveEvidence"]["checks"] {
  return Object.fromEntries(
    requiredLiveEvidenceChecks.map((check) => [check, false]),
  ) as ToolDispatchPostureReport["liveEvidence"]["checks"];
}

function liveEvidenceChecks(
  value: unknown,
): ToolDispatchPostureReport["liveEvidence"]["checks"] {
  const source = Array.isArray(value) ? value : [];
  const passed = new Set(
    source.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (
        isRecord(item) &&
        typeof item.id === "string" &&
        (item.status === "passed" || item.passed === true)
      ) {
        return [item.id];
      }
      return [];
    }),
  );
  return Object.fromEntries(
    requiredLiveEvidenceChecks.map((check) => [check, passed.has(check)]),
  ) as ToolDispatchPostureReport["liveEvidence"]["checks"];
}

function emptySummary(): ToolDispatchPostureReport["liveEvidence"]["summary"] {
  return {
    completedDispatchCount: 0,
    deniedPrivateTargetCount: 0,
    dispatchRequestCount: 0,
    failedDispatchCount: 0,
    managedPayloadReadCount: 0,
    podLogScanCount: 0,
    reclaimedDispatchCount: 0,
    schemaValidationCount: 0,
    secretResolutionCount: 0,
    workerLogScanCount: 0,
  };
}

function liveEvidenceSummary(
  evidence: Record<string, unknown>,
): ToolDispatchPostureReport["liveEvidence"]["summary"] {
  const operations = recordValue(evidence.operations);
  const egress = recordValue(evidence.egress);
  const worker = recordValue(evidence.worker);
  const secrets = recordValue(evidence.secrets);
  const responseValidation = recordValue(evidence.responseValidation);
  const logRedaction = recordValue(evidence.logRedaction);
  return {
    completedDispatchCount: nonNegativeNumber(
      operations.completedDispatchCount,
    ),
    deniedPrivateTargetCount: nonNegativeNumber(
      egress.deniedPrivateTargetCount,
    ),
    dispatchRequestCount: nonNegativeNumber(operations.dispatchRequestCount),
    failedDispatchCount: nonNegativeNumber(operations.failedDispatchCount),
    managedPayloadReadCount: nonNegativeNumber(
      operations.managedPayloadReadCount,
    ),
    podLogScanCount: nonNegativeNumber(logRedaction.podLogScanCount),
    reclaimedDispatchCount: nonNegativeNumber(worker.reclaimedDispatchCount),
    schemaValidationCount: nonNegativeNumber(
      responseValidation.schemaValidationCount,
    ),
    secretResolutionCount: nonNegativeNumber(secrets.secretResolutionCount),
    workerLogScanCount: nonNegativeNumber(logRedaction.workerLogScanCount),
  };
}

function emptyMcp(): ToolDispatchPostureReport["liveEvidence"]["mcp"] {
  return {
    callCount: 0,
    jsonRpcEnvelopeVerified: false,
    outputRedacted: false,
    payloadArgumentsRedacted: false,
    protocolHeadersVerified: false,
    streamableHttpToolsCallVerified: false,
  };
}

function liveEvidenceMcp(
  value: unknown,
): ToolDispatchPostureReport["liveEvidence"]["mcp"] {
  const source = recordValue(value);
  return {
    callCount: nonNegativeNumber(source.callCount),
    jsonRpcEnvelopeVerified: source.jsonRpcEnvelopeVerified === true,
    outputRedacted: source.outputRedacted === true,
    payloadArgumentsRedacted: source.payloadArgumentsRedacted === true,
    protocolHeadersVerified: source.protocolHeadersVerified === true,
    streamableHttpToolsCallVerified:
      source.streamableHttpToolsCallVerified === true,
  };
}

function mcpProofSatisfied(
  mcp: ToolDispatchPostureReport["liveEvidence"]["mcp"],
): boolean {
  return (
    mcp.streamableHttpToolsCallVerified === true &&
    mcp.protocolHeadersVerified === true &&
    mcp.jsonRpcEnvelopeVerified === true &&
    mcp.callCount > 0 &&
    mcp.payloadArgumentsRedacted === true &&
    mcp.outputRedacted === true
  );
}

function liveEvidenceRedaction(): ToolDispatchPostureReport["liveEvidence"]["redaction"] {
  return {
    rawEvidencePathsReturned: false,
    rawLogLinesReturned: false,
    rawObjectStoreKeysReturned: false,
    rawOperationHostsReturned: false,
    rawPayloadValuesReturned: false,
    rawResponseBodiesReturned: false,
    rawSecretRefsReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
  };
}

function liveEvidenceRedactionFrom(
  value: unknown,
): ToolDispatchPostureReport["liveEvidence"]["redaction"] {
  const source = recordValue(value);
  return {
    rawEvidencePathsReturned: source.rawEvidencePathsReturned === true,
    rawLogLinesReturned: source.rawLogLinesReturned === true,
    rawObjectStoreKeysReturned: source.rawObjectStoreKeysReturned === true,
    rawOperationHostsReturned: source.rawOperationHostsReturned === true,
    rawPayloadValuesReturned: source.rawPayloadValuesReturned === true,
    rawResponseBodiesReturned: source.rawResponseBodiesReturned === true,
    rawSecretRefsReturned: source.rawSecretRefsReturned === true,
    secretValuesReturned: source.secretValuesReturned === true,
    tokenValuesReturned: source.tokenValuesReturned === true,
  };
}

function allRedactionFalse(
  redaction: ToolDispatchPostureReport["liveEvidence"]["redaction"],
): boolean {
  return Object.values(redaction).every((value) => value === false);
}

function liveEvidenceFailureCodes(input: {
  checks: ToolDispatchPostureReport["liveEvidence"]["checks"];
  deployment: ToolDispatchPostureReport["liveEvidence"]["deployment"];
  evidence: Record<string, unknown>;
  evidenceStatus: ToolDispatchPostureReport["liveEvidence"]["evidenceStatus"];
  mcp: ToolDispatchPostureReport["liveEvidence"]["mcp"];
  mode: ToolDispatchPostureReport["liveEvidence"]["mode"];
  redaction: ToolDispatchPostureReport["liveEvidence"]["redaction"];
  summary: ToolDispatchPostureReport["liveEvidence"]["summary"];
}): string[] {
  const failures: string[] = [];
  if (input.evidenceStatus !== "passed") {
    failures.push("tool_dispatch_live_not_passed");
  }
  if (input.mode !== "live") {
    failures.push("tool_dispatch_live_evidence_not_live");
  }
  if (input.deployment !== "kubernetes" && input.deployment !== "target") {
    failures.push("tool_dispatch_live_deployment_invalid");
  }
  for (const check of requiredLiveEvidenceChecks) {
    if (input.checks[check] !== true) {
      failures.push(`tool_dispatch_live_missing_check:${check}`);
    }
  }

  const operations = recordValue(input.evidence.operations);
  const egress = recordValue(input.evidence.egress);
  const secrets = recordValue(input.evidence.secrets);
  const worker = recordValue(input.evidence.worker);
  const responseValidation = recordValue(input.evidence.responseValidation);
  const logRedaction = recordValue(input.evidence.logRedaction);
  const readback = recordValue(input.evidence.readback);

  if (
    operations.workerClaimExecutionVerified !== true ||
    input.summary.dispatchRequestCount <= 0 ||
    input.summary.completedDispatchCount <= 0
  ) {
    failures.push("tool_dispatch_live_worker_claim_invalid");
  }
  if (
    operations.managedPayloadReadVerified !== true ||
    input.summary.managedPayloadReadCount <= 0
  ) {
    failures.push("tool_dispatch_live_payload_read_invalid");
  }
  if (!mcpProofSatisfied(input.mcp)) {
    failures.push("tool_dispatch_live_mcp_invalid");
  }
  if (
    egress.workerCniOrNetworkPolicyEnforced !== true ||
    egress.privateNetworkDenied !== true ||
    egress.redirectDenied !== true ||
    egress.httpsOnly !== true ||
    input.summary.deniedPrivateTargetCount <= 0
  ) {
    failures.push("tool_dispatch_live_egress_invalid");
  }
  if (
    egress.dnsPrivateAddressDenied !== true ||
    input.summary.deniedPrivateTargetCount <= 0
  ) {
    failures.push("tool_dispatch_live_private_dns_invalid");
  }
  if (
    secrets.secretResolutionVerified !== true ||
    secrets.secretResolverBoundaryVerified !== true ||
    secrets.oauthTokenRedactionVerified !== true ||
    input.summary.secretResolutionCount <= 0 ||
    secrets.secretValuesReturned !== false ||
    secrets.tokenValuesReturned !== false
  ) {
    failures.push("tool_dispatch_live_secret_resolution_invalid");
  }
  if (
    worker.workerCrashRetryOrReclaimVerified !== true ||
    input.summary.reclaimedDispatchCount <= 0 ||
    worker.completedAfterReclaim !== true
  ) {
    failures.push("tool_dispatch_live_worker_retry_invalid");
  }
  if (
    responseValidation.responseSchemaValidationVerified !== true ||
    input.summary.schemaValidationCount <= 0 ||
    responseValidation.invalidResponseFailedClosed !== true
  ) {
    failures.push("tool_dispatch_live_response_validation_invalid");
  }
  if (
    logRedaction.workerLogRedactionVerified !== true ||
    logRedaction.podLogRedactionVerified !== true ||
    input.summary.workerLogScanCount <= 0 ||
    input.summary.podLogScanCount <= 0 ||
    nonNegativeNumber(logRedaction.payloadSentinelHitCount) !== 0 ||
    nonNegativeNumber(logRedaction.responseSentinelHitCount) !== 0 ||
    nonNegativeNumber(logRedaction.secretSentinelHitCount) !== 0 ||
    nonNegativeNumber(logRedaction.tokenSentinelHitCount) !== 0
  ) {
    failures.push("tool_dispatch_live_log_redaction_invalid");
  }
  if (
    readback.adminPostureReadbackVerified !== true ||
    readback.dispatchReadbackVerified !== true
  ) {
    failures.push("tool_dispatch_live_readback_invalid");
  }
  if (
    !isRecord(input.evidence.redaction) ||
    !allRedactionFalse(input.redaction)
  ) {
    failures.push("tool_dispatch_live_redaction_missing");
  }
  return Array.from(new Set(failures));
}

function warningCodes(input: {
  deadLettered: number;
  deployment: ToolDispatchPostureReport["deployment"];
  failed: number;
  liveEvidenceStatus: ToolDispatchPostureReport["liveEvidence"]["status"];
  staleQueued: number;
  staleRunning: number;
}): ToolDispatchPostureWarning[] {
  const warnings: ToolDispatchPostureWarning[] = [];
  if (!input.deployment.externalOperationExecutionEnabled)
    warnings.push("tool_dispatch_execution_disabled");
  if (!input.deployment.workerEnabled)
    warnings.push("tool_dispatch_worker_not_enabled");
  if (!input.deployment.networkPolicyConfigured)
    warnings.push("tool_dispatch_network_policy_not_configured");
  if (!input.deployment.payloadStoreConfigured)
    warnings.push("tool_dispatch_managed_payload_store_disabled");
  if (input.liveEvidenceStatus === "not_configured")
    warnings.push("tool_dispatch_live_evidence_required");
  if (
    input.liveEvidenceStatus === "invalid" ||
    input.liveEvidenceStatus === "failed"
  ) {
    warnings.push("tool_dispatch_live_evidence_invalid");
  }
  if (input.deadLettered > 0)
    warnings.push("tool_dispatch_dead_letters_present");
  if (input.failed > 0) warnings.push("tool_dispatch_failed_jobs_present");
  if (input.staleQueued > 0 || input.staleRunning > 0)
    warnings.push("tool_dispatch_stale_jobs_present");
  return warnings;
}

function workerLease(job: BackgroundJob):
  | {
      attempt: number;
      claimedAt: string;
      expiresAt: string;
      leaseSeconds: number;
      renewedAt: string;
      workerId: string;
    }
  | undefined {
  const value = job.payload.workerLease;
  if (!isRecord(value)) return undefined;
  if (
    typeof value.attempt !== "number" ||
    typeof value.claimedAt !== "string" ||
    typeof value.expiresAt !== "string" ||
    typeof value.leaseSeconds !== "number" ||
    typeof value.renewedAt !== "string" ||
    typeof value.workerId !== "string"
  ) {
    return undefined;
  }
  return {
    attempt: value.attempt,
    claimedAt: value.claimedAt,
    expiresAt: value.expiresAt,
    leaseSeconds: value.leaseSeconds,
    renewedAt: value.renewedAt,
    workerId: value.workerId,
  };
}

function ageSecondsSince(timestamp: string, nowMs: number): number | undefined {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.floor((nowMs - parsed) / 1000));
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function evidenceStatusValue(
  value: unknown,
): "failed" | "passed" | "planned" | "unknown" {
  if (value === "failed" || value === "passed" || value === "planned") {
    return value;
  }
  return "unknown";
}

function modeValue(value: unknown): "dry-run" | "live" | "unknown" {
  if (value === "dry-run" || value === "live") return value;
  return "unknown";
}

function deploymentValue(
  value: unknown,
): "compose" | "kubernetes" | "target" | "unknown" {
  if (value === "compose" || value === "kubernetes" || value === "target") {
    return value;
  }
  return "unknown";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError;
}
