import { describe, expect, it } from "vitest";
import { MemoryObjectStore } from "@romeo/storage";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { createServices } from "./services";

describe("table saved-view and export HTTP workers", () => {
  it("persists a server saved view and merges a local fallback", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const replaced = await api.request("/api/v1/admin/table-views", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        resource: "usage_events",
        name: "Incidents",
        globalFilter: "denied",
        pageSize: 50,
        sorting: [{ id: "createdAt", desc: true }],
      }),
    });
    expect(replaced.status).toBe(200);
    const stored = (await replaced.json()).data;
    expect(stored).toMatchObject({
      name: "Incidents",
      source: "server",
      canEdit: true,
      isDefault: false,
      schemaVersion: 2,
      visibility: "private",
      query: {
        search: "denied",
        pageSize: 50,
        sort: [{ field: "createdAt", direction: "desc" }],
      },
    });

    const listed = await api.request("/api/v1/admin/table-views/list", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        resource: "usage_events",
        localViews: [
          { name: "Incidents", globalFilter: "timeout", pageSize: 25 },
        ],
      }),
    });
    expect(listed.status).toBe(200);
    const views = (await listed.json()).data;
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      source: "server",
      query: { search: "denied" },
    });

    const rejected = await api.request("/api/v1/admin/table-views", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        resource: "usage_events",
        name: "Secrets",
        globalFilter: "bearer abc.secret",
      }),
    });
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(await rejected.json())).not.toContain("abc.secret");

    const viewId = stored.id as string;
    const shared = await api.request(
      `/api/v1/admin/table-views/${viewId}/share`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace_default",
          resource: "usage_events",
          visibility: "workspace",
        }),
      },
    );
    expect(shared.status).toBe(200);
    expect((await shared.json()).data).toMatchObject({
      id: viewId,
      visibility: "workspace",
    });
    const madeDefault = await api.request(
      `/api/v1/admin/table-views/${viewId}/default`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace_default",
          resource: "usage_events",
          isDefault: true,
        }),
      },
    );
    expect(madeDefault.status).toBe(200);
    expect((await madeDefault.json()).data.isDefault).toBe(true);
    const deleted = await api.request(`/api/v1/admin/table-views/${viewId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        resource: "usage_events",
      }),
    });
    expect(deleted.status).toBe(200);
    const deleteBody = await deleted.json();
    expect(deleteBody).toMatchObject({
      data: {
        deleted: true,
        version: 4,
      },
    });
    expect(deleteBody.data.undoToken).toMatch(/^saved_view_undo_/);
    expect(deleteBody.data.undoExpiresAt).toMatch(/Z$/);
    const replayDelete = await api.request(
      `/api/v1/admin/table-views/${viewId}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace_default",
          resource: "usage_events",
        }),
      },
    );
    expect(await replayDelete.json()).toEqual({ data: { deleted: false } });
  });

  it("refuses large browser CSV, then runs the async export worker to an artifact", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const api = createRomeoApi(repository, { objectStore });
    const denied = await api.request("/api/v1/admin/table-exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        resource: "usage_events",
        mode: "browser_csv",
        estimatedRows: 12_000,
      }),
    });
    expect(denied.status).toBe(200);
    expect(await denied.json()).toMatchObject({
      data: { outcome: "denied", code: "table_export_must_be_async" },
    });

    const created = await api.request("/api/v1/admin/table-exports", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "table-export-replay",
      },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        resource: "usage_events",
        mode: "async_artifact",
        estimatedRows: 80,
        sort: [{ field: "createdAt", direction: "desc" }],
      }),
    });
    const replayed = await api.request("/api/v1/admin/table-exports", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "table-export-replay",
      },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        resource: "usage_events",
        mode: "async_artifact",
        estimatedRows: 80,
        sort: [{ field: "createdAt", direction: "desc" }],
      }),
    });
    expect(created.status).toBe(202);
    expect(replayed.status).toBe(202);
    const createdBody = await created.json();
    expect(await replayed.json()).toEqual(createdBody);
    const jobId = createdBody.data.jobId as string;
    expect(jobId.startsWith("export_job_")).toBe(true);

    const rejectedRun = await api.request(
      `/api/v1/admin/table-exports/${jobId}/run`,
      {
        method: "POST",
      },
    );
    expect(rejectedRun.status).toBe(403);
    const ran = await createServices(repository, {
      objectStore,
    }).tableExports.runNext({
      subject: {
        groupIds: [],
        id: "system_table_export_org_default",
        isAdmin: true,
        orgId: "org_default",
        scopes: ["admin:read", "workspaces:read"],
        type: "service_account",
        workspaceIds: ["workspace_default"],
      },
      workerId: "worker_table_export_test",
      jobId,
    });
    if (ran === undefined) throw new Error("export job was not claimed");
    const finished = {
      outcome: "accepted",
      jobId: ran.id,
      state: ran.state,
      percent: ran.percent,
      artifactId: ran.artifactId,
      expiresAt: ran.expiresAt,
    };
    expect(finished).toMatchObject({
      outcome: "accepted",
      state: "artifact_ready",
      percent: 100,
    });
    expect(typeof finished.artifactId).toBe("string");
    expect(typeof finished.expiresAt).toBe("string");

    const fetched = await api.request(`/api/v1/admin/table-exports/${jobId}`);
    expect(fetched.status).toBe(200);
    expect((await fetched.json()).data).toMatchObject({
      jobId,
      state: "artifact_ready",
    });
    const artifact = await api.request(
      `/api/v1/admin/table-exports/${jobId}/artifact`,
    );
    expect(artifact.status).toBe(200);
    expect(artifact.headers.get("content-type")).toContain("text/csv");
    expect(artifact.headers.get("cache-control")).toBe("private, no-store");
    expect(artifact.headers.get("content-disposition")).toContain("attachment");
    expect(typeof (await artifact.text())).toBe("string");
    const deleted = await api.request(`/api/v1/admin/table-exports/${jobId}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ data: { deleted: true } });
    const deletedArtifact = await api.request(
      `/api/v1/admin/table-exports/${jobId}/artifact`,
    );
    expect(deletedArtifact.status).toBe(404);
    const expiredResponse = await api.request(
      `/api/v1/admin/table-exports/${jobId}`,
    );
    expect((await expiredResponse.json()).data).toMatchObject({
      state: "expired",
    });
    const missingArtifact = await api.request(
      "/api/v1/admin/table-exports/export_job_missing/artifact",
    );
    expect(missingArtifact.status).toBe(404);
    expect(JSON.stringify(finished)).not.toContain("secret");
  });
});
