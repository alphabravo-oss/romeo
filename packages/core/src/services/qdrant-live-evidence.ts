import { readFile } from "node:fs/promises";

import type { VectorNamespacePolicy } from "./vector-store-deployment";

export type QdrantLiveEvidenceInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export type QdrantLiveEvidenceStatus =
  | "failed"
  | "invalid"
  | "not_configured"
  | "satisfied";

export interface QdrantLiveEvidenceSummary {
  configured: boolean;
  status: QdrantLiveEvidenceStatus;
  schemaVersion?: "romeo.qdrant-live-evidence.v1";
  generatedAt?: string;
  evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
  evidenceMode?: "dry-run" | "live";
  invalidReason?: QdrantLiveEvidenceInvalidReason;
  namespacePolicy?: VectorNamespacePolicy;
  partitioningPolicy?: VectorNamespacePolicy;
  collectionHealthRead: boolean;
  scopedQueryReturnedExpectedPoint: boolean;
  namespaceTrapExcluded: boolean;
  partitionTrapExcluded: boolean;
  foreignOrgTrapExcluded: boolean;
  vectorsOmittedFromQuery: boolean;
  scopedDeleteVerified: boolean;
  cleanupAttempted: boolean;
  redaction: {
    apiKeyReturned: false;
    collectionReturned: false;
    endpointReturned: false;
    evidenceFileBodyReturned: false;
    namespaceValuesReturned: false;
    partitionValuesReturned: false;
    payloadValuesReturned: false;
    pointIdsReturned: false;
    rawEvidencePathReturned: false;
    vectorValuesReturned: false;
  };
}

type ReadEvidenceResult =
  | {
      status: "not_configured";
    }
  | {
      status: "invalid";
      invalidReason: QdrantLiveEvidenceInvalidReason;
    }
  | {
      status: "valid";
      data: Record<string, unknown>;
    };

const schemaVersion = "romeo.qdrant-live-evidence.v1";

export async function summarizeQdrantLiveEvidence(
  path: string,
): Promise<QdrantLiveEvidenceSummary> {
  const evidence = await readJsonEvidence(path);
  if (evidence.status === "not_configured") {
    return emptySummary("not_configured", false);
  }
  if (evidence.status === "invalid") {
    return {
      ...emptySummary("invalid", true),
      invalidReason: evidence.invalidReason,
    };
  }

  const data = evidence.data;
  const target = recordValue(data.target);
  const collection = recordValue(data.collection);
  const isolation = recordValue(data.isolation);
  const mutation = recordValue(data.mutation);
  const deletion = recordValue(data.deletion);
  const filter = recordValue(isolation.filter);
  const evidenceStatus = evidenceStatusValue(data.status);
  const evidenceMode = evidenceModeValue(data.mode);
  const namespacePolicy = namespacePolicyValue(target.namespacePolicy);
  const partitioningPolicy = namespacePolicyValue(target.partitioningPolicy);
  const collectionHealthRead =
    dataBool(target.endpointValid) &&
    dataBool(target.collectionConfigured) &&
    (typeof collection.status === "string" ||
      dataInteger(collection.pointsCount) !== undefined ||
      dataInteger(collection.vectorsCount) !== undefined);
  const scopedQueryReturnedExpectedPoint = dataBool(
    isolation.expectedHitReturned,
  );
  const namespaceTrapExcluded = dataBool(isolation.namespaceTrapExcluded);
  const partitionTrapExcluded = dataBool(isolation.partitionTrapExcluded);
  const foreignOrgTrapExcluded = dataBool(isolation.foreignOrgTrapExcluded);
  const vectorsOmittedFromQuery = isolation.vectorsReturned === false;
  const scopedDeleteVerified =
    dataBool(deletion.scopedDeleteIssued) &&
    dataBool(deletion.expectedHitRemoved) &&
    dataInteger(deletion.postDeleteResultCount) === 0;
  const cleanupAttempted =
    dataBool(mutation.cleanupAttempted) ||
    dataBool(deletion.cleanupByPointIdAttempted);
  const filterSatisfied =
    dataBool(filter.orgFilterApplied) &&
    dataBool(filter.workspaceFilterApplied) &&
    dataBool(filter.knowledgeBaseFilterApplied) &&
    dataBool(filter.sourceFilterApplied) &&
    dataBool(filter.providerModelDimensionFilterApplied) &&
    dataBool(filter.namespaceFilterApplied);
  const satisfied =
    evidenceStatus === "passed" &&
    evidenceMode === "live" &&
    namespacePolicy !== undefined &&
    namespacePolicy !== "none" &&
    collectionHealthRead &&
    scopedQueryReturnedExpectedPoint &&
    namespaceTrapExcluded &&
    partitionTrapExcluded &&
    foreignOrgTrapExcluded &&
    vectorsOmittedFromQuery &&
    scopedDeleteVerified &&
    cleanupAttempted &&
    filterSatisfied;

  return {
    configured: true,
    status: satisfied ? "satisfied" : "failed",
    schemaVersion,
    ...(typeof data.generatedAt === "string"
      ? { generatedAt: data.generatedAt }
      : {}),
    evidenceStatus,
    ...(evidenceMode === undefined ? {} : { evidenceMode }),
    ...(namespacePolicy === undefined ? {} : { namespacePolicy }),
    ...(partitioningPolicy === undefined ? {} : { partitioningPolicy }),
    collectionHealthRead,
    scopedQueryReturnedExpectedPoint,
    namespaceTrapExcluded,
    partitionTrapExcluded,
    foreignOrgTrapExcluded,
    vectorsOmittedFromQuery,
    scopedDeleteVerified,
    cleanupAttempted,
    redaction: redactionSummary(),
  };
}

async function readJsonEvidence(path: string): Promise<ReadEvidenceResult> {
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

function emptySummary(
  status: "invalid" | "not_configured",
  configured: boolean,
): QdrantLiveEvidenceSummary {
  return {
    configured,
    status,
    collectionHealthRead: false,
    scopedQueryReturnedExpectedPoint: false,
    namespaceTrapExcluded: false,
    partitionTrapExcluded: false,
    foreignOrgTrapExcluded: false,
    vectorsOmittedFromQuery: false,
    scopedDeleteVerified: false,
    cleanupAttempted: false,
    redaction: redactionSummary(),
  };
}

function redactionSummary(): QdrantLiveEvidenceSummary["redaction"] {
  return {
    apiKeyReturned: false,
    collectionReturned: false,
    endpointReturned: false,
    evidenceFileBodyReturned: false,
    namespaceValuesReturned: false,
    partitionValuesReturned: false,
    payloadValuesReturned: false,
    pointIdsReturned: false,
    rawEvidencePathReturned: false,
    vectorValuesReturned: false,
  };
}

function evidenceStatusValue(
  value: unknown,
): "failed" | "passed" | "planned" | "unknown" {
  return value === "failed" || value === "passed" || value === "planned"
    ? value
    : "unknown";
}

function evidenceModeValue(
  value: unknown,
): QdrantLiveEvidenceSummary["evidenceMode"] | undefined {
  return value === "dry-run" || value === "live" ? value : undefined;
}

function namespacePolicyValue(
  value: unknown,
): VectorNamespacePolicy | undefined {
  return value === "knowledge_base" ||
    value === "none" ||
    value === "org" ||
    value === "workspace"
    ? value
    : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function dataBool(value: unknown): boolean {
  return value === true;
}

function dataInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
