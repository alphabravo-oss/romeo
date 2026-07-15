import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

import {
  evidenceDefinitions,
  type KubernetesDatabaseMode,
  type KubernetesEvidenceDefinition,
  type KubernetesEvidenceMode,
  type KubernetesEvidenceStatus,
  type KubernetesEvidenceSummary,
  type KubernetesInvalidReason,
  type KubernetesPostureReport,
} from "./kubernetes-posture-definitions";
import { failureCodesForEvidence } from "./kubernetes-posture-validation";

export type {
  KubernetesEvidenceSummary,
  KubernetesPostureReport,
} from "./kubernetes-posture-definitions";

export class KubernetesPostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<KubernetesPostureReport> {
    assertScope(subject, "admin:read");
    const evidence = await Promise.all(
      evidenceDefinitions.map((definition) =>
        summarizeEvidence(definition, this.env[definition.envKey]),
      ),
    );
    const required = evidence.filter((item) => item.required);
    const summary = {
      total: evidence.length,
      requiredTotal: required.length,
      configured: evidence.filter((item) => item.configured).length,
      notConfigured: evidence.filter((item) => item.status === "not_configured")
        .length,
      invalid: evidence.filter((item) => item.status === "invalid").length,
      planned: evidence.filter((item) => item.status === "planned").length,
      failed: evidence.filter((item) => item.status === "failed").length,
      satisfied: evidence.filter((item) => item.status === "satisfied").length,
      requiredSatisfied: required.filter((item) => item.status === "satisfied")
        .length,
      requiredMissing: required.filter((item) => item.status !== "satisfied")
        .length,
    };
    const warnings = kubernetesWarnings(evidence);
    return {
      schema: "romeo.kubernetes-posture.v1",
      generatedAt: new Date().toISOString(),
      orgId: subject.orgId,
      status: warnings.length === 0 ? "ready" : "attention_required",
      summary,
      evidence,
      redaction: {
        databaseUrlsReturned: false,
        evidenceFileBodiesReturned: false,
        kubernetesObjectBodiesReturned: false,
        podLogsReturned: false,
        rawEvidencePathsReturned: false,
        rawImageRefsReturned: false,
        rawNamespaceValuesReturned: false,
        secretValuesReturned: false,
      },
      warnings,
    };
  }
}

async function summarizeEvidence(
  definition: KubernetesEvidenceDefinition,
  evidencePath: string,
): Promise<KubernetesEvidenceSummary> {
  const configuredPath = evidencePath.trim();
  if (configuredPath.length === 0) {
    return emptyEvidence(definition, "not_configured");
  }
  const readResult = await readEvidence(configuredPath);
  if (readResult.status === "invalid") {
    return emptyEvidence(definition, "invalid", readResult.invalidReason);
  }
  const data = readResult.data;
  if (data.schemaVersion !== definition.schemaVersion) {
    return emptyEvidence(definition, "invalid", "schema_mismatch");
  }
  const databaseMode = databaseModeValue(data.databaseMode);
  if (
    "requiredDatabaseMode" in definition &&
    databaseMode !== definition.requiredDatabaseMode
  ) {
    return emptyEvidence(definition, "invalid", "database_mode_mismatch", {
      schemaVersion: definition.schemaVersion,
      databaseMode,
    });
  }

  const evidenceStatus = statusValue(data.status);
  const mode = modeValue(data.mode);
  const generatedAt = stringValue(data.generatedAt);
  const checks = checkSummary(definition.requiredChecks, data.checks);
  const logRedaction = logRedactionSummary(data);
  const target = targetSummary(data);
  const vectorPosture = vectorPostureSummary(data);
  const failureCodes = failureCodesForEvidence({
    checks,
    data,
    databaseMode,
    evidenceStatus,
    kind: definition.kind,
    logRedaction,
    mode,
    target,
    vectorPosture,
  });
  const status =
    evidenceStatus === "planned" || mode === "dry-run"
      ? "planned"
      : failureCodes.length === 0
        ? "satisfied"
        : "failed";

  return {
    kind: definition.kind,
    gateId: definition.gateId,
    label: definition.label,
    required: definition.required,
    configured: true,
    source: "configured_file",
    status,
    schemaVersion: definition.schemaVersion,
    ...(generatedAt === undefined ? {} : { generatedAt }),
    evidenceStatus,
    mode,
    ...(databaseMode === "unknown" ? {} : { databaseMode }),
    failureCodes,
    checks,
    target,
    logRedaction,
    metrics: metricsSummary(data),
    ...(vectorPosture === undefined ? {} : { vectorPosture }),
  };
}

type ReadEvidenceResult =
  | { status: "valid"; data: Record<string, unknown> }
  | { status: "invalid"; invalidReason: KubernetesInvalidReason };

async function readEvidence(evidencePath: string): Promise<ReadEvidenceResult> {
  let raw: string;
  try {
    raw = await readFile(evidencePath, "utf8");
  } catch {
    return { status: "invalid", invalidReason: "read_failed" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", invalidReason: "invalid_json" };
  }
  if (!isRecord(parsed)) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }
  return { status: "valid", data: parsed };
}

function emptyEvidence(
  definition: KubernetesEvidenceDefinition,
  status: "invalid" | "not_configured",
  invalidReason?: KubernetesInvalidReason,
  extra: Partial<KubernetesEvidenceSummary> = {},
): KubernetesEvidenceSummary {
  const failureCodes =
    status === "not_configured" ? [] : [invalidReason ?? "schema_mismatch"];
  return {
    kind: definition.kind,
    gateId: definition.gateId,
    label: definition.label,
    required: definition.required,
    configured: status !== "not_configured",
    source: status === "not_configured" ? "not_configured" : "configured_file",
    status,
    ...(invalidReason === undefined ? {} : { invalidReason }),
    failureCodes,
    checks: {
      total: 0,
      requiredTotal: definition.requiredChecks.length,
      requiredPresent: 0,
      missingRequired: [...definition.requiredChecks],
    },
    target: {
      deployment: "unknown",
      namespaceConfigured: false,
      releaseConfigured: false,
      serviceConfigured: false,
      deploymentConfigured: false,
    },
    logRedaction: {
      configured: false,
      status: "unknown",
      scanCount: 0,
      sentinelCheckCount: 0,
    },
    metrics: {},
    ...extra,
  };
}

function checkSummary(
  requiredChecks: readonly string[],
  checksValue: unknown,
): KubernetesEvidenceSummary["checks"] {
  const checks = Array.isArray(checksValue)
    ? checksValue.filter((value): value is string => typeof value === "string")
    : [];
  const checkSet = new Set(checks);
  const missingRequired = requiredChecks.filter(
    (check) => !checkSet.has(check),
  );
  return {
    total: checks.length,
    requiredTotal: requiredChecks.length,
    requiredPresent: requiredChecks.length - missingRequired.length,
    missingRequired,
  };
}

function targetSummary(
  data: Record<string, unknown>,
): KubernetesEvidenceSummary["target"] {
  const target = isRecord(data.target) ? data.target : {};
  return {
    deployment:
      target.deployment === "kubernetes" || data.target === "kubernetes"
        ? "kubernetes"
        : "unknown",
    namespaceConfigured:
      stringValue(target.namespace) !== undefined ||
      stringValue(data.namespace) !== undefined ||
      (isRecord(data.source) &&
        stringValue(data.source.namespace) !== undefined),
    releaseConfigured:
      stringValue(target.releaseName) !== undefined ||
      stringValue(data.releaseName) !== undefined,
    serviceConfigured:
      stringValue(target.serviceName) !== undefined ||
      stringValue(data.serviceName) !== undefined,
    deploymentConfigured:
      stringValue(target.deploymentName) !== undefined ||
      stringValue(data.deploymentName) !== undefined ||
      stringValue(target.appName) !== undefined ||
      stringValue(data.appName) !== undefined,
  };
}

function logRedactionSummary(
  data: Record<string, unknown>,
): KubernetesEvidenceSummary["logRedaction"] {
  const logRedaction = isRecord(data.logRedaction) ? data.logRedaction : {};
  const redaction = isRecord(data.redaction) ? data.redaction : {};
  const scanned = isRecord(data.scanned) ? data.scanned : {};
  const sentinelCounts = isRecord(data.sentinelCounts)
    ? data.sentinelCounts
    : {};
  const configured =
    Object.keys(logRedaction).length > 0 ||
    Object.keys(redaction).length > 0 ||
    Object.keys(scanned).length > 0;
  const status = statusFromObjects([logRedaction, redaction]);
  return {
    configured,
    status,
    scanCount:
      sumNumberFields(logRedaction, /scanned|logEntries|entries/i) +
      sumNumberFields(scanned, /entries|reads/i),
    sentinelCheckCount:
      sumNumberFields(logRedaction, /checked|sentinel|secret|raw/i) +
      sumNumberFields(sentinelCounts, /.*/),
  };
}

function statusFromObjects(
  records: Array<Record<string, unknown>>,
): "failed" | "passed" | "unknown" {
  for (const record of records) {
    if (record.status === "passed") return "passed";
    if (record.status === "failed") return "failed";
  }
  return "unknown";
}

function metricsSummary(
  data: Record<string, unknown>,
): KubernetesEvidenceSummary["metrics"] {
  const soak = isRecord(data.soak) ? data.soak : {};
  const kedaJob = isRecord(data.kedaJob) ? data.kedaJob : {};
  const vectorPosture = isRecord(data.vectorPosture) ? data.vectorPosture : {};
  return compactMetrics({
    authorizedTierCount: numberValue(data.authorizedTierCount),
    iterationCount: numberValue(data.iterations),
    kedaSucceededJobs: numberValue(kedaJob.succeeded),
    loadRunCount: numberValue(data.loadRuns),
    skippedDeniedCount: numberValue(data.skippedDeniedCount),
    soakObservedSeconds: numberValue(soak.observedSeconds),
    soakRequestedSeconds: numberValue(soak.requestedSeconds),
    vectorPlanEntryCount: numberValue(vectorPosture.planEntryCount),
    workerCount: numberValue(data.workerCount),
  });
}

function vectorPostureSummary(
  data: Record<string, unknown>,
): KubernetesEvidenceSummary["vectorPosture"] | undefined {
  const vectorPosture = isRecord(data.vectorPosture) ? data.vectorPosture : {};
  if (Object.keys(vectorPosture).length === 0) return undefined;
  const counts = isRecord(vectorPosture.vectorScopeDriverCounts)
    ? vectorPosture.vectorScopeDriverCounts
    : {};
  return {
    driver: vectorDriverValue(vectorPosture.driver),
    isolationMode: vectorIsolationModeValue(vectorPosture.isolationMode),
    externalVectorStoreDriver: externalVectorDriverValue(
      vectorPosture.externalVectorStoreDriver,
    ),
    externalVectorStoreRoutingActive:
      vectorPosture.externalVectorStoreRoutingActive === true,
    namespaceConfigured: vectorPosture.namespaceConfigured === true,
    namespacePolicy: vectorPolicyValue(vectorPosture.namespacePolicy),
    partitioningConfigured: vectorPosture.partitioningConfigured === true,
    partitioningPolicy: vectorPolicyValue(vectorPosture.partitioningPolicy),
    planEntryCount: numberValue(vectorPosture.planEntryCount) ?? 0,
    vectorScopeDriverCounts: {
      pgvector: numberValue(counts.pgvector) ?? 0,
      qdrant: numberValue(counts.qdrant) ?? 0,
    },
  };
}

type KubernetesVectorPostureSummary = NonNullable<
  KubernetesEvidenceSummary["vectorPosture"]
>;

function vectorDriverValue(
  value: unknown,
): KubernetesVectorPostureSummary["driver"] {
  return value === "pgvector" || value === "qdrant" ? value : "unknown";
}

function externalVectorDriverValue(
  value: unknown,
): KubernetesVectorPostureSummary["externalVectorStoreDriver"] {
  return value === "disabled" || value === "qdrant" ? value : "unknown";
}

function vectorIsolationModeValue(
  value: unknown,
): KubernetesVectorPostureSummary["isolationMode"] {
  if (
    value === "dedicated_vector_store_per_org" ||
    value === "external_collection_per_org" ||
    value === "external_namespace_per_org" ||
    value === "pgvector_partitioned_by_org" ||
    value === "shared_row_scope"
  ) {
    return value;
  }
  return "unknown";
}

function vectorPolicyValue(
  value: unknown,
): KubernetesVectorPostureSummary["namespacePolicy"] {
  if (
    value === "knowledge_base" ||
    value === "none" ||
    value === "org" ||
    value === "workspace"
  ) {
    return value;
  }
  return "unknown";
}

function compactMetrics(
  metrics: Record<string, number | undefined>,
): KubernetesEvidenceSummary["metrics"] {
  return Object.fromEntries(
    Object.entries(metrics).filter(([, value]) => value !== undefined),
  ) as KubernetesEvidenceSummary["metrics"];
}

function kubernetesWarnings(
  evidence: KubernetesEvidenceSummary[],
): KubernetesPostureReport["warnings"] {
  const warnings = new Set<KubernetesPostureReport["warnings"][number]>();
  for (const item of evidence) {
    if (!item.required && item.status === "invalid") {
      warnings.add("kubernetes_optional_evidence_invalid");
      continue;
    }
    if (!item.required) continue;
    if (item.status === "not_configured") {
      warnings.add("kubernetes_required_evidence_missing");
    } else if (item.status === "invalid") {
      warnings.add("kubernetes_required_evidence_invalid");
    } else if (item.status === "planned") {
      warnings.add("kubernetes_required_evidence_planned");
    } else if (item.status === "failed") {
      warnings.add("kubernetes_required_evidence_failed");
    }
  }
  return [...warnings];
}

function statusValue(value: unknown): KubernetesEvidenceStatus {
  if (value === "failed" || value === "passed" || value === "planned") {
    return value;
  }
  return "unknown";
}

function modeValue(value: unknown): KubernetesEvidenceMode {
  if (value === "dry-run" || value === "live") return value;
  return "unknown";
}

function databaseModeValue(value: unknown): KubernetesDatabaseMode {
  if (value === "cloudnativepg" || value === "external-postgres") {
    return value;
  }
  return "unknown";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function sumNumberFields(
  record: Record<string, unknown>,
  pattern: RegExp,
): number {
  return Object.entries(record).reduce((total, [key, value]) => {
    if (!pattern.test(key) || typeof value !== "number") return total;
    return total + value;
  }, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
