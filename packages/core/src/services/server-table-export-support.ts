import type { ObjectStore } from "@romeo/storage";

import {
  freezeTableExportSnapshot,
  TABLE_EXPORT_SNAPSHOT_SCHEMA,
  type FrozenTableExportSnapshot,
  type TableExportJob,
} from "./server-table-export-job";

export const TABLE_EXPORT_JOB_SCHEMA = "romeo.server-table-export-job.v2";
export const TABLE_EXPORT_MANIFEST_SCHEMA =
  "romeo.server-table-export-manifest.v1";
export const TABLE_EXPORT_JOB_TYPE = "table.export";
export const TABLE_EXPORT_PAGE_SIZE = 100;
export const TABLE_EXPORT_MAX_ATTEMPTS = 3;
export const TABLE_EXPORT_LEASE_SECONDS = 60;
export const TABLE_EXPORT_MAX_MANIFEST_BYTES = 1_048_576;
export const TABLE_EXPORT_MAX_PART_BYTES = 4 * 1_048_576;
export const TABLE_EXPORT_ARTIFACT_TTL_MS = 60 * 60 * 1_000;

export interface ExportArtifactMetadata {
  artifactId: string;
  key: string;
  fileName: string;
  contentType: "text/csv; charset=utf-8";
  sizeBytes: number;
  expiresAt: string;
}

export interface ExportJobPayload {
  schema: typeof TABLE_EXPORT_JOB_SCHEMA;
  snapshot: FrozenTableExportSnapshot;
  state: TableExportJob["state"];
  percent: number;
  attemptCount: number;
  processedRows: number;
  columns?: string[];
  cursor?: string;
  partKeys: string[];
  sizeBytes: number;
  artifact?: ExportArtifactMetadata;
  errorCode?: string;
}

export interface ExportManifest {
  schema: typeof TABLE_EXPORT_MANIFEST_SCHEMA;
  jobId: string;
  orgId: string;
  workspaceId: string;
  partKeys: string[];
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
}

export function createExportJobPayload(input: {
  actorId: string;
  estimatedRows: number;
  filters: FrozenTableExportSnapshot["applied"]["filters"];
  now: string;
  orgId: string;
  parentId?: string;
  resource: string;
  search?: string;
  sort: FrozenTableExportSnapshot["applied"]["sort"];
  workspaceId: string;
}): ExportJobPayload {
  const snapshot = freezeTableExportSnapshot({
    ...input,
    policyVersion: `${input.resource}:v1`,
  });
  return {
    schema: TABLE_EXPORT_JOB_SCHEMA,
    snapshot,
    state: "queued",
    percent: 0,
    attemptCount: 0,
    processedRows: 0,
    partKeys: [],
    sizeBytes: 0,
  };
}

export function publicExportJob(
  id: string,
  payload: ExportJobPayload,
): TableExportJob {
  return {
    id,
    snapshot: payload.snapshot,
    state: payload.state,
    percent: payload.percent,
    processedRows: payload.processedRows,
    attemptCount: payload.attemptCount,
    ...(payload.errorCode === undefined
      ? {}
      : { errorCode: payload.errorCode }),
    ...(payload.artifact === undefined
      ? {}
      : {
          artifactId: payload.artifact.artifactId,
          expiresAt: payload.artifact.expiresAt,
        }),
  };
}

export function parseExportPayload(
  value: Record<string, unknown>,
): ExportJobPayload | undefined {
  const candidate = value as unknown as Partial<ExportJobPayload>;
  return candidate.schema === TABLE_EXPORT_JOB_SCHEMA &&
    candidate.snapshot?.schema === TABLE_EXPORT_SNAPSHOT_SCHEMA &&
    typeof candidate.state === "string" &&
    typeof candidate.percent === "number" &&
    typeof candidate.attemptCount === "number" &&
    typeof candidate.processedRows === "number" &&
    (candidate.columns === undefined ||
      (Array.isArray(candidate.columns) &&
        candidate.columns.every((column) => typeof column === "string"))) &&
    Array.isArray(candidate.partKeys) &&
    candidate.partKeys.every((key) => typeof key === "string") &&
    typeof candidate.sizeBytes === "number"
    ? (candidate as ExportJobPayload)
    : undefined;
}

export function parseExportManifest(
  value: unknown,
): ExportManifest | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = value as Partial<ExportManifest>;
  return candidate.schema === TABLE_EXPORT_MANIFEST_SCHEMA &&
    typeof candidate.jobId === "string" &&
    typeof candidate.orgId === "string" &&
    typeof candidate.workspaceId === "string" &&
    Array.isArray(candidate.partKeys) &&
    candidate.partKeys.every((key) => typeof key === "string") &&
    typeof candidate.sizeBytes === "number" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.expiresAt === "string"
    ? (candidate as ExportManifest)
    : undefined;
}

export function workerLeaseAttempt(payload: Record<string, unknown>) {
  const lease = payload.workerLease;
  if (lease === null || typeof lease !== "object" || Array.isArray(lease))
    return undefined;
  const attempt = (lease as Record<string, unknown>).attempt;
  return typeof attempt === "number" && Number.isSafeInteger(attempt)
    ? attempt
    : undefined;
}

export function encodeCsvPart(
  rows: Array<Record<string, unknown>>,
  includeHeader: boolean,
  columns: string[],
) {
  const lines = [
    ...(includeHeader && columns.length > 0
      ? [columns.map(csvCell).join(",")]
      : []),
    ...rows.map((row) =>
      columns.map((column) => csvCell(row[column])).join(","),
    ),
  ];
  return new TextEncoder().encode(
    lines.length === 0 ? "" : `${lines.join("\n")}\n`,
  );
}

function csvCell(value: unknown) {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function objectPartStream(objectStore: ObjectStore, partKeys: string[]) {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const key = partKeys[index];
      if (key === undefined) {
        controller.close();
        return;
      }
      const bytes = await objectStore.getObject(key, {
        maxBytes: TABLE_EXPORT_MAX_PART_BYTES,
      });
      if (bytes === undefined) {
        controller.error(new Error("table_export_part_missing"));
        return;
      }
      index += 1;
      controller.enqueue(bytes);
    },
  });
}

export async function deleteExportObjects(
  objectStore: ObjectStore,
  keys: string[],
) {
  await Promise.all(keys.map((key) => objectStore.deleteObject(key)));
}

export function exportPartKey(
  orgId: string,
  jobId: string,
  attempt: number,
  index: number,
) {
  return `table-exports/${safeFilePart(orgId)}/${safeFilePart(jobId)}/attempt-${attempt}/part-${index}.csv`;
}

export function exportManifestKey(
  orgId: string,
  jobId: string,
  attempt: number,
) {
  return `table-exports/${safeFilePart(orgId)}/${safeFilePart(jobId)}/attempt-${attempt}/manifest.json`;
}

export function safeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
}

export function boundedExportProgress(
  processedRows: number,
  estimatedRows: number,
) {
  return Math.min(
    99,
    Math.max(1, Math.floor((processedRows / Math.max(1, estimatedRows)) * 100)),
  );
}

export function exportErrorCode(error: unknown) {
  return error instanceof Error && /^table_export_[a-z_]+$/u.test(error.message)
    ? error.message
    : "table_export_failed";
}

export function cleanExportPayload(
  value: ExportJobPayload,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}
