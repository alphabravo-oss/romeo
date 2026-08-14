import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";

describe("table saved-view and export HTTP workers", () => {
  it("persists a server saved view and merges a local fallback", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const replaced = await api.request("/api/v1/admin/table-views", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        resource: "audit_logs",
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
        resource: "audit_logs",
        localViews: [{ name: "Incidents", globalFilter: "timeout", pageSize: 25 }],
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
        resource: "audit_logs",
        name: "Secrets",
        globalFilter: "bearer abc.secret",
      }),
    });
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(await rejected.json())).not.toContain("abc.secret");
  });

  it("refuses large browser CSV, then runs the async export worker to an artifact", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const denied = await api.request("/api/v1/admin/table-exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        resource: "audit_logs",
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
    expect(created.status).toBe(200);
    expect(replayed.status).toBe(200);
    const createdBody = await created.json();
    expect(await replayed.json()).toEqual(createdBody);
    const jobId = createdBody.data.jobId as string;
    expect(jobId.startsWith("export_job_")).toBe(true);

    const ran = await api.request(`/api/v1/admin/table-exports/${jobId}/run`, {
      method: "POST",
    });
    expect(ran.status).toBe(200);
    const finished = (await ran.json()).data;
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
    expect(JSON.stringify(finished)).not.toContain("secret");
  });
});
