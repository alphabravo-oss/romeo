import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

import { listDataConnectorCatalogEntries } from "../domain/data-connector-catalog";
import type {
  DataConnector,
  DataConnectorSync,
  DataConnectorType,
} from "../domain/entities";
import {
  dataConnectorLiveEvidenceSchema,
  dataConnectorRequiredLiveEvidenceChecks,
  type DataConnectorPostureReport,
} from "./data-connector-contracts";

export function dataConnectorCounts(
  connectors: DataConnector[],
  nowMs: number,
): DataConnectorPostureReport["connectors"] {
  const byType = Object.fromEntries(
    listDataConnectorCatalogEntries().map((entry) => [entry.type, 0]),
  ) as Record<DataConnectorType, number>;
  let active = 0;
  let disabled = 0;
  let due = 0;
  let managed = 0;
  let scheduled = 0;
  for (const connector of connectors) {
    byType[connector.type] += 1;
    if (connector.status === "active") active += 1;
    if (connector.status === "disabled") disabled += 1;
    if (connector.type !== "local_import") managed += 1;
    if (connector.syncIntervalMinutes !== undefined) scheduled += 1;
    if (
      connector.status === "active" &&
      connector.nextSyncAt !== undefined &&
      Date.parse(connector.nextSyncAt) <= nowMs
    ) {
      due += 1;
    }
  }
  return {
    active,
    disabled,
    due,
    managed,
    scheduled,
    total: connectors.length,
    byType,
  };
}

export function dataConnectorSyncCounts(
  syncs: DataConnectorSync[],
): DataConnectorPostureReport["syncs"] {
  let completed = 0;
  let failed = 0;
  let latestCompletedAt: string | null = null;
  let latestFailedAt: string | null = null;
  let running = 0;
  for (const sync of syncs) {
    if (sync.status === "running") running += 1;
    if (sync.status === "completed") {
      completed += 1;
      if (
        sync.completedAt !== undefined &&
        (latestCompletedAt === null ||
          sync.completedAt.localeCompare(latestCompletedAt) > 0)
      ) {
        latestCompletedAt = sync.completedAt;
      }
    }
    if (sync.status === "failed") {
      failed += 1;
      if (
        sync.completedAt !== undefined &&
        (latestFailedAt === null ||
          sync.completedAt.localeCompare(latestFailedAt) > 0)
      ) {
        latestFailedAt = sync.completedAt;
      }
    }
  }
  return {
    completed,
    failed,
    latestCompletedAt,
    latestFailedAt,
    running,
    total: syncs.length,
  };
}

export async function readDataConnectorLiveEvidence(
  evidencePath: string,
): Promise<DataConnectorPostureReport["liveEvidence"]> {
  const emptyChecks = emptyDataConnectorLiveEvidenceChecks();
  const notConfigured: DataConnectorPostureReport["liveEvidence"] = {
    configured: false,
    source: "not_configured",
    status: "not_configured",
    checks: emptyChecks,
    failureCodes: [],
    summary: emptyDataConnectorLiveEvidenceSummary(),
    redaction: dataConnectorLiveEvidenceRedaction(),
  };
  if (evidencePath.trim().length === 0) return notConfigured;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(evidencePath, "utf8"));
  } catch (error) {
    return {
      ...notConfigured,
      configured: true,
      source: "configured_file",
      status: "invalid",
      failureCodes: [isSyntaxError(error) ? "invalid_json" : "read_failed"],
      invalidReason: isSyntaxError(error) ? "invalid_json" : "read_failed",
    };
  }
  if (!isRecord(parsed)) {
    return invalidDataConnectorLiveEvidence("schema_mismatch", [
      "evidence_not_object",
    ]);
  }
  const schemaVersion =
    stringValue(parsed.schemaVersion) ?? stringValue(parsed.schema);
  if (schemaVersion !== dataConnectorLiveEvidenceSchema) {
    return invalidDataConnectorLiveEvidence("schema_mismatch", [
      "schema_mismatch",
    ]);
  }
  const checks = dataConnectorLiveEvidenceChecks(parsed.checks);
  const summary = dataConnectorLiveEvidenceSummary(parsed);
  const redaction = dataConnectorLiveEvidenceRedactionFrom(parsed.redaction);
  const evidenceStatus = evidenceStatusValue(parsed.status);
  const mode = modeValue(parsed.mode);
  const deployment = deploymentValue(parsed.deployment);
  const failureCodes = dataConnectorLiveEvidenceFailureCodes({
    checks,
    deployment,
    evidence: parsed,
    evidenceStatus,
    mode,
    redaction,
    summary,
  });
  const failed = evidenceStatus !== "passed" || failureCodes.length > 0;
  return {
    configured: true,
    source: "configured_file",
    status: failed ? "failed" : "satisfied",
    schemaVersion: dataConnectorLiveEvidenceSchema,
    evidenceStatus,
    ...(typeof parsed.generatedAt === "string"
      ? { generatedAt: parsed.generatedAt }
      : {}),
    mode,
    deployment,
    checks,
    failureCodes,
    summary,
    redaction,
  };
}

function invalidDataConnectorLiveEvidence(
  invalidReason: "invalid_json" | "read_failed" | "schema_mismatch",
  failureCodes: string[],
): DataConnectorPostureReport["liveEvidence"] {
  return {
    configured: true,
    source: "configured_file",
    status: "invalid",
    checks: emptyDataConnectorLiveEvidenceChecks(),
    failureCodes,
    invalidReason,
    summary: emptyDataConnectorLiveEvidenceSummary(),
    redaction: dataConnectorLiveEvidenceRedaction(),
  };
}

function emptyDataConnectorLiveEvidenceChecks(): DataConnectorPostureReport["liveEvidence"]["checks"] {
  return Object.fromEntries(
    dataConnectorRequiredLiveEvidenceChecks.map((check) => [check, false]),
  ) as DataConnectorPostureReport["liveEvidence"]["checks"];
}

function dataConnectorLiveEvidenceChecks(
  value: unknown,
): DataConnectorPostureReport["liveEvidence"]["checks"] {
  const source = Array.isArray(value) ? value : [];
  const passed = new Set(
    source.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (isRecord(item)) {
        const id =
          typeof item.id === "string"
            ? item.id
            : typeof item.name === "string"
              ? item.name
              : undefined;
        if (
          id !== undefined &&
          (item.status === "passed" ||
            item.status === "pass" ||
            item.passed === true)
        ) {
          return [id];
        }
      }
      return [];
    }),
  );
  return Object.fromEntries(
    dataConnectorRequiredLiveEvidenceChecks.map((check) => [
      check,
      passed.has(check),
    ]),
  ) as DataConnectorPostureReport["liveEvidence"]["checks"];
}

function emptyDataConnectorLiveEvidenceSummary(): DataConnectorPostureReport["liveEvidence"]["summary"] {
  return {
    delegatedOAuthConnectorCount: 0,
    deniedPrivateTargetCount: 0,
    failedSyncCount: 0,
    managedConnectorTypeCount: 0,
    podLogScanCount: 0,
    requeuedSyncCount: 0,
    secretRefConnectorCount: 0,
    successfulSyncCount: 0,
    syncAttemptCount: 0,
    workerLogScanCount: 0,
  };
}

function dataConnectorLiveEvidenceSummary(
  evidence: Record<string, unknown>,
): DataConnectorPostureReport["liveEvidence"]["summary"] {
  const connectors = recordValue(evidence.connectors);
  const logRedaction = recordValue(evidence.logRedaction);
  const worker = recordValue(evidence.worker);
  return {
    delegatedOAuthConnectorCount: nonNegativeNumber(
      connectors.delegatedOAuthConnectorCount,
    ),
    deniedPrivateTargetCount: nonNegativeNumber(
      connectors.deniedPrivateTargetCount,
    ),
    failedSyncCount: nonNegativeNumber(connectors.failedSyncCount),
    managedConnectorTypeCount: nonNegativeNumber(
      connectors.managedConnectorTypeCount,
    ),
    podLogScanCount: nonNegativeNumber(logRedaction.podLogScanCount),
    requeuedSyncCount: nonNegativeNumber(worker.requeuedSyncCount),
    secretRefConnectorCount: nonNegativeNumber(
      connectors.secretRefConnectorCount,
    ),
    successfulSyncCount: nonNegativeNumber(connectors.successfulSyncCount),
    syncAttemptCount: nonNegativeNumber(connectors.syncAttemptCount),
    workerLogScanCount: nonNegativeNumber(logRedaction.workerLogScanCount),
  };
}

function dataConnectorLiveEvidenceRedaction(): DataConnectorPostureReport["liveEvidence"]["redaction"] {
  return {
    rawAllowedHostsReturned: false,
    rawConnectorConfigReturned: false,
    rawConnectorContentReturned: false,
    rawEndpointUrlsReturned: false,
    rawEvidencePathsReturned: false,
    rawLogLinesReturned: false,
    rawSecretRefsReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
  };
}

function dataConnectorLiveEvidenceRedactionFrom(
  value: unknown,
): DataConnectorPostureReport["liveEvidence"]["redaction"] {
  if (!isRecord(value)) return dataConnectorLiveEvidenceRedaction();
  return {
    rawAllowedHostsReturned: value.rawAllowedHostsReturned === true,
    rawConnectorConfigReturned: value.rawConnectorConfigReturned === true,
    rawConnectorContentReturned: value.rawConnectorContentReturned === true,
    rawEndpointUrlsReturned: value.rawEndpointUrlsReturned === true,
    rawEvidencePathsReturned: value.rawEvidencePathsReturned === true,
    rawLogLinesReturned: value.rawLogLinesReturned === true,
    rawSecretRefsReturned: value.rawSecretRefsReturned === true,
    secretValuesReturned: value.secretValuesReturned === true,
    tokenValuesReturned: value.tokenValuesReturned === true,
  };
}

function allDataConnectorLiveEvidenceRedactionFalse(
  redaction: DataConnectorPostureReport["liveEvidence"]["redaction"],
): boolean {
  return Object.values(redaction).every((value) => value === false);
}

function dataConnectorLiveEvidenceFailureCodes(input: {
  checks: DataConnectorPostureReport["liveEvidence"]["checks"];
  deployment: DataConnectorPostureReport["liveEvidence"]["deployment"];
  evidence: Record<string, unknown>;
  evidenceStatus: DataConnectorPostureReport["liveEvidence"]["evidenceStatus"];
  mode: DataConnectorPostureReport["liveEvidence"]["mode"];
  redaction: DataConnectorPostureReport["liveEvidence"]["redaction"];
  summary: DataConnectorPostureReport["liveEvidence"]["summary"];
}): string[] {
  const failures: string[] = [];
  if (input.evidenceStatus !== "passed") {
    failures.push("data_connector_live_not_passed");
  }
  if (input.mode !== "live") {
    failures.push("data_connector_live_evidence_not_live");
  }
  if (input.deployment !== "kubernetes" && input.deployment !== "target") {
    failures.push("data_connector_live_deployment_invalid");
  }
  for (const check of dataConnectorRequiredLiveEvidenceChecks) {
    if (input.checks[check] !== true) {
      failures.push(`data_connector_live_missing_check:${check}`);
    }
  }

  const egress = recordValue(input.evidence.egress);
  const secrets = recordValue(input.evidence.secrets);
  const worker = recordValue(input.evidence.worker);
  const logRedaction = recordValue(input.evidence.logRedaction);
  const readback = recordValue(input.evidence.readback);

  if (
    input.summary.managedConnectorTypeCount <= 0 ||
    input.summary.syncAttemptCount <= 0 ||
    input.summary.successfulSyncCount <= 0
  ) {
    failures.push("data_connector_live_managed_sync_invalid");
  }
  if (
    egress.workerCniOrNetworkPolicyEnforced !== true ||
    egress.allowlistRequired !== true ||
    egress.privateNetworkDenied !== true ||
    nonNegativeNumber(egress.deniedPrivateNetworkCount) <= 0 ||
    nonNegativeNumber(egress.allowedExternalHostCount) <= 0
  ) {
    failures.push("data_connector_live_egress_invalid");
  }
  if (
    egress.dnsRebindingDenied !== true ||
    input.summary.deniedPrivateTargetCount <= 0
  ) {
    failures.push("data_connector_live_private_dns_invalid");
  }
  if (
    secrets.secretRefResolutionVerified !== true ||
    secrets.secretResolverBoundaryVerified !== true ||
    input.summary.secretRefConnectorCount <= 0 ||
    secrets.rawSecretValuesReturned !== false ||
    secrets.tokenValuesReturned !== false
  ) {
    failures.push("data_connector_live_secret_resolution_invalid");
  }
  if (
    worker.workerExecutionVerified !== true ||
    worker.crashRetryOrRequeueVerified !== true ||
    input.summary.requeuedSyncCount <= 0 ||
    worker.completedAfterRetry !== true
  ) {
    failures.push("data_connector_live_worker_retry_invalid");
  }
  if (
    logRedaction.syncLogRedactionVerified !== true ||
    logRedaction.podLogRedactionVerified !== true ||
    input.summary.podLogScanCount <= 0 ||
    input.summary.workerLogScanCount <= 0 ||
    nonNegativeNumber(logRedaction.connectorContentSentinelHitCount) !== 0 ||
    nonNegativeNumber(logRedaction.secretSentinelHitCount) !== 0 ||
    nonNegativeNumber(logRedaction.tokenSentinelHitCount) !== 0
  ) {
    failures.push("data_connector_live_log_redaction_invalid");
  }
  if (
    readback.adminPostureReadbackVerified !== true ||
    readback.syncHistoryReadbackVerified !== true
  ) {
    failures.push("data_connector_live_readback_invalid");
  }
  if (
    !isRecord(input.evidence.redaction) ||
    !allDataConnectorLiveEvidenceRedactionFalse(input.redaction)
  ) {
    failures.push("data_connector_live_redaction_missing");
  }
  return Array.from(new Set(failures));
}

export function dataConnectorWarnings(input: {
  executionDriver: RomeoEnv["DATA_CONNECTOR_EXECUTION_DRIVER"];
  failedSyncs: number;
  liveEvidenceStatus: DataConnectorPostureReport["liveEvidence"]["status"];
  networkPolicyConfigured: boolean;
  scheduledConnectors: number;
  workerEnabled: boolean;
}): DataConnectorPostureReport["warnings"] {
  const warnings: DataConnectorPostureReport["warnings"] = [];
  if (input.executionDriver === "disabled")
    warnings.push("data_connector_driver_disabled");
  if (!input.workerEnabled) warnings.push("data_connector_worker_not_enabled");
  if (!input.networkPolicyConfigured)
    warnings.push("data_connector_network_policy_not_configured");
  if (input.scheduledConnectors > 0 && !input.workerEnabled)
    warnings.push("data_connector_scheduled_syncs_without_worker");
  if (input.liveEvidenceStatus === "not_configured")
    warnings.push("data_connector_live_evidence_required");
  if (
    input.liveEvidenceStatus === "invalid" ||
    input.liveEvidenceStatus === "failed"
  ) {
    warnings.push("data_connector_live_evidence_invalid");
  }
  if (input.failedSyncs > 0)
    warnings.push("data_connector_failed_syncs_present");
  return warnings;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError;
}
