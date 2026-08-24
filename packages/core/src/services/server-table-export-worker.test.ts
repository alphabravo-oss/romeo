import type { AuthSubject } from "@romeo/auth";
import { MemoryObjectStore } from "@romeo/storage";
import { describe, expect, it, vi } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import type { InventoriedTablePageService } from "./inventoried-table-page-service";
import { ServerTableExportWorker } from "./server-table-export-worker";

const workerSubject: AuthSubject = {
  groupIds: [],
  id: "system_table_export_org_default",
  isAdmin: true,
  orgId: "org_default",
  scopes: ["admin:read", "workspaces:read"],
  type: "service_account",
  workspaceIds: ["workspace_default"],
};

describe("ServerTableExportWorker", () => {
  it("survives restart and writes a large export as bounded object parts", async () => {
    const rows = Array.from({ length: 1_250 }, (_, index) => ({
      id: `usage_${index.toString().padStart(4, "0")}`,
      createdAt: "2026-08-23T12:00:00.000Z",
      metric: "tokens",
      value: index,
    }));
    const pageService = fakePages(rows);
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const firstProcess = new ServerTableExportWorker(
      repository,
      pageService,
      objectStore,
    );
    const created = await createExport(firstProcess, rows.length);
    const restarted = new ServerTableExportWorker(
      repository,
      pageService,
      objectStore,
    );
    const completed = await restarted.runNext({
      subject: workerSubject,
      workerId: "restarted-worker",
      jobId: created.id,
    });

    expect(completed).toMatchObject({
      id: created.id,
      state: "artifact_ready",
      percent: 100,
      processedRows: 1_250,
    });
    expect(pageService.query).toHaveBeenCalledTimes(13);
    const artifact = await restarted.readArtifact({
      subject: workerSubject,
      jobId: created.id,
    });
    const csv = await new Response(artifact.body).text();
    expect(csv.split("\n")).toHaveLength(1_252);
    expect(csv).toContain("usage_1249");
    const stored = (await repository.listBackgroundJobs("org_default")).find(
      (job) => job.id === created.id,
    );
    expect(JSON.stringify(stored?.payload)).not.toContain(csv);
    expect(JSON.stringify(stored?.payload)).not.toContain("usage_1249");
  });

  it("fences two workers so only one can claim the same export", async () => {
    const pageService = fakePages([{ id: "usage_1", metric: "tokens" }]);
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const worker = new ServerTableExportWorker(
      repository,
      pageService,
      objectStore,
    );
    const created = await createExport(worker, 1);

    const outcomes = await Promise.all([
      worker.runNext({
        subject: workerSubject,
        workerId: "worker-a",
        jobId: created.id,
      }),
      worker.runNext({
        subject: workerSubject,
        workerId: "worker-b",
        jobId: created.id,
      }),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(outcomes.find(Boolean)?.state).toBe("artifact_ready");
  });

  it("resumes a fenced page checkpoint after a worker restart", async () => {
    const rows = Array.from({ length: 250 }, (_, index) => ({
      id: `usage_${index}`,
      metric: "tokens",
    }));
    const stablePages = fakePages(rows);
    let callCount = 0;
    const interruptedPages = {
      query: vi.fn(
        async (
          subject: Parameters<InventoriedTablePageService["query"]>[0],
          request: Parameters<InventoriedTablePageService["query"]>[1],
        ) => {
          callCount += 1;
          if (callCount === 2) throw new Error("process terminated");
          return stablePages.query(subject, request);
        },
      ),
    } as unknown as InventoriedTablePageService;
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const interrupted = new ServerTableExportWorker(
      repository,
      interruptedPages,
      objectStore,
    );
    const created = await createExport(interrupted, rows.length);
    const checkpoint = await interrupted.runNext({
      subject: workerSubject,
      workerId: "interrupted-worker",
      jobId: created.id,
    });
    expect(checkpoint).toMatchObject({
      state: "queued",
      attemptCount: 1,
      processedRows: 100,
    });

    const restarted = new ServerTableExportWorker(
      repository,
      stablePages,
      objectStore,
    );
    const completed = await restarted.runNext({
      subject: workerSubject,
      workerId: "replacement-worker",
      jobId: created.id,
    });
    expect(completed).toMatchObject({
      state: "artifact_ready",
      attemptCount: 2,
      processedRows: 250,
    });
    expect(stablePages.query).toHaveBeenLastCalledWith(
      workerSubject,
      expect.objectContaining({ cursor: "200" }),
    );
  });

  it("retries transient failures and reaches a terminal failure at the bound", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const query = vi.fn().mockRejectedValue(new Error("storage unavailable"));
    const worker = new ServerTableExportWorker(
      repository,
      { query } as unknown as InventoriedTablePageService,
      objectStore,
    );
    const created = await createExport(worker, 1);

    const first = await worker.runNext({
      subject: workerSubject,
      workerId: "retry-worker",
      jobId: created.id,
    });
    const second = await worker.runNext({
      subject: workerSubject,
      workerId: "retry-worker",
      jobId: created.id,
    });
    const third = await worker.runNext({
      subject: workerSubject,
      workerId: "retry-worker",
      jobId: created.id,
    });
    expect(first).toMatchObject({ state: "queued", attemptCount: 1 });
    expect(second).toMatchObject({ state: "queued", attemptCount: 2 });
    expect(third).toMatchObject({
      state: "failed",
      attemptCount: 3,
      errorCode: "table_export_failed",
    });
    await expect(
      worker.runNext({
        subject: workerSubject,
        workerId: "retry-worker",
        jobId: created.id,
      }),
    ).resolves.toBeUndefined();
  });

  it("expires and deletes artifact objects and hides jobs across tenants", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const worker = new ServerTableExportWorker(
      repository,
      fakePages([{ id: "usage_1", metric: "tokens" }]),
      objectStore,
    );
    const created = await createExport(worker, 1);
    const completed = await worker.runNext({
      subject: workerSubject,
      workerId: "expiry-worker",
      jobId: created.id,
    });
    if (completed?.expiresAt === undefined)
      throw new Error("artifact did not complete");
    const expired = await worker.get({
      subject: workerSubject,
      jobId: created.id,
      now: new Date(Date.parse(completed.expiresAt) + 1).toISOString(),
    });
    expect(expired.state).toBe("expired");
    await expect(
      worker.readArtifact({ subject: workerSubject, jobId: created.id }),
    ).rejects.toThrow("Table export artifact was not found");
    await expect(
      worker.get({
        subject: { ...workerSubject, orgId: "org_other" },
        jobId: created.id,
      }),
    ).rejects.toThrow("Table export was not found");
  });
});

function fakePages(rows: Array<Record<string, unknown> & { id: string }>) {
  return {
    query: vi.fn(
      async (_subject: AuthSubject, request: { cursor?: string }) => {
        const start = request.cursor === undefined ? 0 : Number(request.cursor);
        const items = rows.slice(start, start + 100);
        const next = start + items.length;
        return {
          applied: { filters: [], sort: [] },
          items,
          page: {
            estimatedTotal: rows.length,
            limit: 100,
            nextCursor: next < rows.length ? String(next) : null,
            previousCursor: null,
          },
          resource: "usage_events",
        };
      },
    ),
  } as unknown as InventoriedTablePageService & {
    query: ReturnType<typeof vi.fn>;
  };
}

async function createExport(
  worker: ServerTableExportWorker,
  estimatedRows: number,
) {
  const created = await worker.create({
    subject: workerSubject,
    workspaceId: "workspace_default",
    resource: "usage_events",
    mode: "async_artifact",
    estimatedRows,
    sort: [{ field: "createdAt", direction: "desc" }],
    filters: [],
  });
  if (created.outcome !== "accepted") throw new Error("export was denied");
  return created.job;
}
