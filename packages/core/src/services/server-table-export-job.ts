import {
  durableEventUsesRunSequencer,
  type DurableEventEnvelope,
} from "./durable-event-channel";

export const TABLE_EXPORT_SNAPSHOT_SCHEMA = "romeo.server-table-export.v1";
export const TABLE_EXPORT_BROWSER_ROW_CEILING = 500;

export interface FrozenTableExportSnapshot {
  schema: typeof TABLE_EXPORT_SNAPSHOT_SCHEMA;
  orgId: string;
  workspaceId: string;
  parentId?: string;
  resource: string;
  actorId: string;
  policyVersion: string;
  applied: {
    sort: Array<{ field: string; direction: "asc" | "desc" }>;
    filters: Array<{ field: string; operator: string; value?: unknown }>;
    search?: string;
  };
  estimatedRows: number;
  frozenAt: string;
}

export type TableExportJobState =
  | "queued"
  | "running"
  | "artifact_ready"
  | "failed"
  | "expired";

export interface TableExportJob {
  id: string;
  snapshot: FrozenTableExportSnapshot;
  state: TableExportJobState;
  artifactId?: string;
  expiresAt?: string;
  percent: number;
  processedRows?: number;
  attemptCount?: number;
  errorCode?: string;
}

export const TABLE_EXPORT_ARTIFACT_SCHEMA =
  "romeo.server-table-export-artifact.v1";

export interface TableExportArtifact {
  schema: typeof TABLE_EXPORT_ARTIFACT_SCHEMA;
  id: string;
  jobId: string;
  orgId: string;
  workspaceId: string;
  fileName: string;
  body: ReadableStream<Uint8Array>;
  contentType: "text/csv; charset=utf-8";
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
}

export function freezeTableExportSnapshot(input: {
  orgId: string;
  workspaceId: string;
  parentId?: string;
  resource: string;
  actorId: string;
  policyVersion: string;
  sort: FrozenTableExportSnapshot["applied"]["sort"];
  filters: FrozenTableExportSnapshot["applied"]["filters"];
  search?: string;
  estimatedRows: number;
  now: string;
}): FrozenTableExportSnapshot {
  return {
    schema: TABLE_EXPORT_SNAPSHOT_SCHEMA,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
    resource: input.resource,
    actorId: input.actorId,
    policyVersion: input.policyVersion,
    applied: {
      sort: input.sort,
      filters: input.filters,
      ...(input.search === undefined ? {} : { search: input.search }),
    },
    estimatedRows: input.estimatedRows,
    frozenAt: input.now,
  };
}

export function authorizeTableExportJob(input: {
  mode: "browser_csv" | "async_artifact";
  estimatedRows: number;
}):
  | { outcome: "accepted"; mode: "async_artifact" }
  | { outcome: "denied"; code: "table_export_must_be_async" } {
  if (
    input.mode === "browser_csv" &&
    input.estimatedRows > TABLE_EXPORT_BROWSER_ROW_CEILING
  )
    return { outcome: "denied", code: "table_export_must_be_async" };
  return { outcome: "accepted", mode: "async_artifact" };
}

export function advanceTableExportJob(
  job: TableExportJob,
  event:
    | { type: "start" }
    | { type: "progress"; percent: number }
    | { type: "complete"; artifactId: string; expiresAt: string }
    | { type: "fail"; errorCode?: string },
): TableExportJob {
  if (job.state === "expired" || job.state === "failed") return job;
  if (event.type === "start")
    return { ...job, state: "running", percent: Math.max(job.percent, 1) };
  if (event.type === "progress")
    return {
      ...job,
      state: "running",
      percent: Math.min(99, Math.max(job.percent, event.percent)),
    };
  if (event.type === "fail")
    return {
      ...job,
      state: "failed",
      ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
    };
  return {
    ...job,
    state: "artifact_ready",
    artifactId: event.artifactId,
    expiresAt: event.expiresAt,
    percent: 100,
  };
}

export function expireTableExportArtifact(
  job: TableExportJob,
  now: string,
): TableExportJob {
  if (
    job.expiresAt === undefined ||
    Date.parse(job.expiresAt) > Date.parse(now)
  )
    return job;
  const { artifactId: _expiredArtifactId, ...expired } = job;
  return {
    ...expired,
    state: "expired",
  };
}

export function tableExportProgressEvent(input: {
  jobId: string;
  sequence: number;
  percent: number;
  stage: "queued" | "scan" | "write" | "complete";
}): DurableEventEnvelope {
  const event: DurableEventEnvelope = {
    ownerKind: "export",
    ownerId: input.jobId,
    sequence: input.sequence,
    type: "export.progress",
    data: { percent: input.percent, stage: input.stage },
  };
  void durableEventUsesRunSequencer(event.ownerKind);
  return event;
}
