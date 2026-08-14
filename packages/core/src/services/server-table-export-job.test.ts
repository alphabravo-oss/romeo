import { describe, expect, it } from "vitest";

import {
  advanceTableExportJob,
  authorizeTableExportJob,
  expireTableExportArtifact,
  freezeTableExportSnapshot,
  tableExportProgressEvent,
  TABLE_EXPORT_SNAPSHOT_SCHEMA,
} from "./server-table-export-job";

describe("server table export jobs", () => {
  it("freezes the query snapshot and refuses a large browser CSV", () => {
    const snapshot = freezeTableExportSnapshot({
      orgId: "org_default",
      workspaceId: "workspace_default",
      resource: "audit_logs",
      actorId: "user_dev_admin",
      policyVersion: "audit-table-v1",
      sort: [{ field: "createdAt", direction: "desc" }],
      filters: [{ field: "outcome", operator: "eq" }],
      estimatedRows: 12_000,
      now: "2026-08-14T12:00:00.000Z",
    });
    expect(snapshot.schema).toBe(TABLE_EXPORT_SNAPSHOT_SCHEMA);
    expect(snapshot.applied.sort).toEqual([
      { field: "createdAt", direction: "desc" },
    ]);
    expect(
      authorizeTableExportJob({
        mode: "browser_csv",
        estimatedRows: snapshot.estimatedRows,
      }),
    ).toEqual({ outcome: "denied", code: "table_export_must_be_async" });
    expect(
      authorizeTableExportJob({
        mode: "async_artifact",
        estimatedRows: snapshot.estimatedRows,
      }),
    ).toEqual({ outcome: "accepted", mode: "async_artifact" });
  });

  it("advances to an expiring artifact and emits metadata-only SSE progress", () => {
    const snapshot = freezeTableExportSnapshot({
      orgId: "org_default",
      workspaceId: "workspace_default",
      resource: "usage_events",
      actorId: "user_dev_admin",
      policyVersion: "usage-table-v1",
      sort: [],
      filters: [],
      estimatedRows: 80,
      now: "2026-08-14T12:00:00.000Z",
    });
    let job = {
      id: "export_job_1",
      snapshot,
      state: "queued" as const,
      percent: 0,
    };
    job = advanceTableExportJob(job, { type: "start" });
    job = advanceTableExportJob(job, { type: "progress", percent: 40 });
    job = advanceTableExportJob(job, {
      type: "complete",
      artifactId: "file_export_1",
      expiresAt: "2027-08-14T13:00:00.000Z",
    });
    expect(job).toMatchObject({
      state: "artifact_ready",
      artifactId: "file_export_1",
      percent: 100,
    });
    expect(
      expireTableExportArtifact(job, "2027-08-14T13:00:00.000Z"),
    ).toMatchObject({ state: "expired", artifactId: undefined });
    const progress = tableExportProgressEvent({
      jobId: job.id,
      sequence: 2,
      percent: 40,
      stage: "write",
    });
    expect(progress).toMatchObject({
      ownerKind: "export",
      type: "export.progress",
      sequence: 2,
      data: { percent: 40, stage: "write" },
    });
    expect(JSON.stringify(progress)).not.toContain("user_");
    expect(JSON.stringify(progress)).not.toContain("secret");
  });
});
