import { seededSubject } from "@romeo/auth";
import {
  MemoryObjectStore,
  type ObjectStore,
  type PutObjectInput,
} from "@romeo/storage";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import {
  enqueueGovernedDataExportPackage,
  readGovernedDataExportPackage,
} from "./data-export-package";
import { GovernanceExportWorker } from "./governance-export-worker";
import { InventoriedTablePageService } from "./inventoried-table-page-service";

describe("governance export worker", () => {
  it("persists a queued job, creates a bounded artifact, and resumes from server authority", async () => {
    const repository = new InMemoryRomeoRepository();
    const backing = new MemoryObjectStore();
    const writtenSizes: number[] = [];
    const objectStore = recordingStore(backing, writtenSizes);
    for (let index = 0; index < 350; index += 1)
      await repository.createUsageEvent({
        id: `usage_export_${String(index).padStart(4, "0")}`,
        orgId: seededSubject.orgId,
        workspaceId: "workspace_default",
        actorId: seededSubject.id,
        sourceType: "run",
        sourceId: `run_${index}`,
        metric: "run.completed",
        quantity: 1,
        unit: "run",
        metadata: {},
        createdAt: "2026-08-14T12:00:00.000Z",
      });
    const queued = await enqueueGovernedDataExportPackage({
      repository,
      subject: seededSubject,
      request: { scope: "workspace", workspaceId: "workspace_default" },
    });
    expect(queued.state).toBe("queued");
    expect(
      (await repository.listGovernanceExportJobs(seededSubject.orgId, 10))[0]
        ?.state,
    ).toBe("queued");

    const worker = new GovernanceExportWorker(
      repository,
      new InventoriedTablePageService(repository),
      objectStore,
    );
    const completed = await worker.runNext({
      subject: seededSubject,
      workerId: "governance_export_worker_test",
      jobId: queued.packageId,
    });
    expect(completed).toMatchObject({ state: "artifact_ready", percent: 100 });
    expect(completed?.processedRows).toBeGreaterThanOrEqual(350);
    expect(writtenSizes.every((size) => size <= 8 * 1_048_576)).toBe(true);
    expect(writtenSizes.length).toBeGreaterThan(4);

    const artifact = await repository.getGovernanceExportArtifact(
      seededSubject.orgId,
      queued.packageId,
    );
    expect(artifact?.partCount).toBeGreaterThan(4);
    const read = await readGovernedDataExportPackage({
      repository,
      objectStore,
      orgId: seededSubject.orgId,
      packageId: queued.packageId,
    });
    const content = await new Response(read.body).text();
    expect(content).toContain('"dataset":"usage_events"');
    expect(content).not.toContain("objectKey");
  });

  it("fences two workers so only one can claim the same job", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const queued = await enqueueGovernedDataExportPackage({
      repository,
      subject: seededSubject,
      request: { scope: "workspace", workspaceId: "workspace_default" },
    });
    const worker = new GovernanceExportWorker(
      repository,
      new InventoriedTablePageService(repository),
      objectStore,
    );
    const [first, second] = await Promise.all([
      worker.runNext({
        subject: seededSubject,
        workerId: "governance_export_worker_a",
        jobId: queued.packageId,
      }),
      worker.runNext({
        subject: seededSubject,
        workerId: "governance_export_worker_b",
        jobId: queued.packageId,
      }),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(first?.state ?? second?.state).toBe("artifact_ready");
  });

  it("requeues an object-store failure and completes on an idempotent retry", async () => {
    const repository = new InMemoryRomeoRepository();
    const backing = new MemoryObjectStore();
    let failNextPut = true;
    const objectStore: ObjectStore = {
      ...recordingStore(backing, []),
      async putObject(input) {
        if (failNextPut) {
          failNextPut = false;
          throw new Error("temporary_object_store_failure");
        }
        return backing.putObject(input);
      },
    };
    const queued = await enqueueGovernedDataExportPackage({
      repository,
      subject: seededSubject,
      request: { scope: "workspace", workspaceId: "workspace_default" },
    });
    const worker = new GovernanceExportWorker(
      repository,
      new InventoriedTablePageService(repository),
      objectStore,
    );
    const failed = await worker.runNext({
      subject: seededSubject,
      workerId: "governance_export_retry_worker",
      jobId: queued.packageId,
    });
    expect(failed).toMatchObject({
      state: "queued",
      errorCode: "temporary_object_store_failure",
    });
    const completed = await worker.runNext({
      subject: seededSubject,
      workerId: "governance_export_retry_worker",
      jobId: queued.packageId,
    });
    expect(completed?.state).toBe("artifact_ready");
    expect(completed?.attemptCount).toBe(2);
  });
});

function recordingStore(
  backing: MemoryObjectStore,
  writtenSizes: number[],
): ObjectStore {
  return {
    putObject(input: PutObjectInput) {
      writtenSizes.push(input.body.byteLength);
      return backing.putObject(input);
    },
    getObject: (key, options) => backing.getObject(key, options),
    getObjectStream: (key, options) => backing.getObjectStream(key, options),
    headObject: (key) => backing.headObject(key),
    deleteObject: (key) => backing.deleteObject(key),
    createPresignedUpload: (input) => backing.createPresignedUpload(input),
  };
}
