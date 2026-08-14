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
  resource: string;
  actorId: string;
  policyVersion: string;
  applied: {
    sort: Array<{ field: string; direction: "asc" | "desc" }>;
    filters: Array<{ field: string; operator: string }>;
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
}

export function freezeTableExportSnapshot(input: {
  orgId: string;
  workspaceId: string;
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
    | { type: "fail" },
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
  if (event.type === "fail") return { ...job, state: "failed" };
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
  if (job.expiresAt === undefined || Date.parse(job.expiresAt) > Date.parse(now))
    return job;
  return {
    ...job,
    state: "expired",
    artifactId: undefined,
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
