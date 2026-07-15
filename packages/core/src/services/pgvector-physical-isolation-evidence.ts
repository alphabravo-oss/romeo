import { readFile } from "node:fs/promises";

export type PgvectorPhysicalIsolationEvidenceInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export type PgvectorPhysicalIsolationEvidenceStatus =
  | "failed"
  | "invalid"
  | "not_configured"
  | "satisfied";

export interface PgvectorPhysicalIsolationEvidenceSummary {
  configured: boolean;
  status: PgvectorPhysicalIsolationEvidenceStatus;
  schemaVersion?: "romeo.pgvector-physical-isolation-review.v1";
  generatedAt?: string;
  evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
  evidenceMode?: "dry-run" | "live";
  invalidReason?: PgvectorPhysicalIsolationEvidenceInvalidReason;
  tablePartitioned: boolean;
  partitionKeyIncludesOrgId: boolean;
  partitionCount: number;
  hnswIndexCount: number;
  queryPlanReviewed: boolean;
  redaction: {
    databaseUrlReturned: false;
    evidenceFileBodyReturned: false;
    rawEvidencePathReturned: false;
    rawSqlReturned: false;
    vectorValuesReturned: false;
  };
}

type ReadEvidenceResult =
  | {
      status: "not_configured";
    }
  | {
      status: "invalid";
      invalidReason: PgvectorPhysicalIsolationEvidenceInvalidReason;
    }
  | {
      status: "valid";
      data: Record<string, unknown>;
    };

const schemaVersion = "romeo.pgvector-physical-isolation-review.v1";

export async function summarizePgvectorPhysicalIsolationEvidence(
  path: string,
): Promise<PgvectorPhysicalIsolationEvidenceSummary> {
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
  const checks = isRecord(data.checks) ? data.checks : {};
  const target = isRecord(data.target) ? data.target : {};
  const tablePartitioned = dataBool(checks.tablePartitioned);
  const partitionKeyIncludesOrgId = dataBool(checks.partitionKeyIncludesOrgId);
  const partitionCount = dataInteger(checks.partitionCount);
  const hnswIndexCount = dataInteger(checks.hnswIndexCount);
  const queryPlanReviewed = dataBool(checks.queryPlanReviewed);
  const evidenceStatus = evidenceStatusValue(data.status);
  const evidenceMode = evidenceModeValue(data.mode);
  const targetMode =
    typeof target.expectedIsolationMode === "string"
      ? target.expectedIsolationMode
      : undefined;
  const satisfied =
    evidenceStatus === "passed" &&
    evidenceMode === "live" &&
    targetMode === "pgvector_partitioned_by_org" &&
    tablePartitioned &&
    partitionKeyIncludesOrgId &&
    partitionCount > 0 &&
    hnswIndexCount > 0 &&
    queryPlanReviewed;

  return {
    configured: true,
    status: satisfied ? "satisfied" : "failed",
    schemaVersion,
    ...(typeof data.generatedAt === "string"
      ? { generatedAt: data.generatedAt }
      : {}),
    evidenceStatus,
    ...(evidenceMode === undefined ? {} : { evidenceMode }),
    tablePartitioned,
    partitionKeyIncludesOrgId,
    partitionCount,
    hnswIndexCount,
    queryPlanReviewed,
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
): PgvectorPhysicalIsolationEvidenceSummary {
  return {
    configured,
    status,
    tablePartitioned: false,
    partitionKeyIncludesOrgId: false,
    partitionCount: 0,
    hnswIndexCount: 0,
    queryPlanReviewed: false,
    redaction: redactionSummary(),
  };
}

function redactionSummary(): PgvectorPhysicalIsolationEvidenceSummary["redaction"] {
  return {
    databaseUrlReturned: false,
    evidenceFileBodyReturned: false,
    rawEvidencePathReturned: false,
    rawSqlReturned: false,
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
): PgvectorPhysicalIsolationEvidenceSummary["evidenceMode"] | undefined {
  return value === "dry-run" || value === "live" ? value : undefined;
}

function dataBool(value: unknown): boolean {
  return value === true;
}

function dataInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
