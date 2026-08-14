import { describe, expect, it } from "vitest";

import type { AuthSubject } from "@romeo/auth";
import { MemoryObjectStore } from "@romeo/storage";

import type { FileObject } from "../domain/entities";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import {
  assertFileLifecycleTransition,
  safeFileLifecycleFailureCode,
  transitionFileLifecycle,
} from "./file-lifecycle";
import { FileService } from "./file-service";

const subject: AuthSubject = {
  id: "user_dev_admin",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: [],
  scopes: ["files:read", "files:write"],
};

describe("secure file lifecycle", () => {
  it("keeps retained content terminal and maps untrusted failures to safe codes", () => {
    const retained = fileFixture({ status: "retained", lifecycleVersion: 4 });
    const weakened = {
      ...retained,
      status: "ready" as const,
      lifecycleVersion: 5,
    };
    expect(() => assertFileLifecycleTransition(retained, weakened)).toThrow(
      "not allowed",
    );
    expect(
      safeFileLifecycleFailureCode({ code: "scanner_cluster_blue_42" }),
    ).toBe("file_lifecycle_failed");
    expect(
      safeFileLifecycleFailureCode({ code: "file_malware_scan_unavailable" }),
    ).toBe("file_malware_scan_unavailable");
  });

  it("refuses request-path deletion of retained content", async () => {
    const repository = new InMemoryRomeoRepository();
    const retained = await repository.createFileObject(
      fileFixture({ status: "retained", lifecycleVersion: 4 }),
    );
    const service = new FileService(repository, new MemoryObjectStore());
    await expect(service.delete(subject, retained.id)).rejects.toMatchObject({
      code: "data_deletion_legal_hold",
    });
    expect(await repository.getFileObject(retained.id)).toMatchObject({
      status: "retained",
    });
  });

  it("requeues a failed upload and counts one attempt per processing claim", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const unavailable = new FileService(
      repository,
      objectStore,
      undefined,
      {},
      { policy: "required" },
    );
    const bytes = new TextEncoder().encode("bounded retry sentinel");

    await expect(
      unavailable.create(subject, {
        workspaceId: "workspace_default",
        fileName: "retry.txt",
        mimeType: "text/plain",
        sizeBytes: bytes.byteLength,
        dataBase64: Buffer.from(bytes).toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "file_malware_scan_unavailable" });
    const [failed] = await repository.listFileObjects("org_default");
    expect(failed).toMatchObject({ status: "failed", lifecycleAttempts: 1 });

    const recovered = new FileService(
      repository,
      objectStore,
      undefined,
      {},
      {
        policy: "required",
        scanner: { scan: async () => ({ verdict: "clean" }) },
      },
    );
    const queued = await recovered.retryLifecycle(subject, failed!.id);
    expect(queued).toMatchObject({ status: "quarantined" });
    expect(queued.lifecycle.attempts).toBe(1);
    expect(await repository.listAuditLogs(subject.orgId)).toContainEqual(
      expect.objectContaining({
        action: "file.lifecycle.retry",
        metadata: expect.objectContaining({
          attempts: 1,
          failureCode: "file_malware_scan_unavailable",
        }),
      }),
    );
    const result = await recovered.processLifecycleJob({
      workerId: "worker_a",
      now: "2026-08-14T12:00:00.000Z",
    });
    expect(result).toMatchObject({ outcome: "completed", state: "ready" });
    expect(await repository.getFileObject(failed!.id)).toMatchObject({
      status: "ready",
      lifecycleAttempts: 2,
    });
    await expect(
      recovered.processLifecycleJob({
        workerId: "worker_b",
        now: "2026-08-14T12:00:01.000Z",
      }),
    ).resolves.toEqual({ outcome: "idle" });
  });

  it("rejects stale completion after expiry and permits one takeover", async () => {
    const repository = new InMemoryRomeoRepository();
    const failed = await repository.createFileObject(
      fileFixture({
        status: "failed",
        lifecycleAttempts: 1,
        lifecycleVersion: 3,
        lifecycleNextAttemptAt: "2026-08-14T11:59:00.000Z",
      }),
    );
    const first = await repository.claimNextFileLifecycle({
      leaseOwner: "worker_a",
      leaseToken: "token_a",
      now: "2026-08-14T12:00:00.000Z",
      leaseExpiresAt: "2026-08-14T12:01:00.000Z",
    });
    expect(first).toMatchObject({ lifecycleAttempts: 2 });
    const scanning = transitionFileLifecycle(
      first!,
      "scanning",
      "2026-08-14T12:00:01.000Z",
    );
    expect(
      await repository.advanceFileLifecycleLease({
        file: scanning,
        leaseOwner: "worker_a",
        leaseToken: "token_a",
        now: "2026-08-14T12:00:01.000Z",
      }),
    ).toMatchObject({ status: "scanning" });
    const staleReady = transitionFileLifecycle(
      scanning,
      "ready",
      "2026-08-14T12:02:00.000Z",
    );
    expect(
      await repository.finishFileLifecycleLease({
        file: staleReady,
        leaseOwner: "worker_a",
        leaseToken: "token_a",
        now: "2026-08-14T12:02:00.000Z",
      }),
    ).toBeUndefined();
    const takeover = await repository.claimNextFileLifecycle({
      leaseOwner: "worker_b",
      leaseToken: "token_b",
      now: "2026-08-14T12:02:00.000Z",
      leaseExpiresAt: "2026-08-14T12:03:00.000Z",
    });
    expect(takeover).toMatchObject({
      id: failed.id,
      lifecycleAttempts: 3,
      lifecycleLeaseOwner: "worker_b",
    });
    expect(
      await repository.finishFileLifecycleLease({
        file: staleReady,
        leaseOwner: "worker_a",
        leaseToken: "token_a",
        now: "2026-08-14T12:02:01.000Z",
      }),
    ).toBeUndefined();
  });

  it("fails an oversized stored object without reading past the declared bound", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const failed = await repository.createFileObject(
      fileFixture({
        status: "failed",
        lifecycleAttempts: 1,
        lifecycleVersion: 3,
        lifecycleNextAttemptAt: "2026-08-14T11:59:00.000Z",
      }),
    );
    await objectStore.putObject({
      key: failed.objectKey,
      body: new TextEncoder().encode("larger-than-seven-bytes"),
      contentType: failed.mimeType,
    });
    const service = new FileService(repository, objectStore);
    await expect(
      service.processLifecycleJob({
        workerId: "worker_size",
        now: "2026-08-14T12:00:00.000Z",
      }),
    ).resolves.toMatchObject({ outcome: "failed", state: "failed" });
    expect(await repository.getFileObject(failed.id)).toMatchObject({
      lifecycleAttempts: 2,
      lifecycleFailureCode: "file_size_mismatch",
      status: "failed",
    });
  });

  it("uses the configured upload-mode bound instead of a hidden worker limit", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const failed = await repository.createFileObject(
      fileFixture({
        status: "failed",
        sizeBytes: 10,
        metadata: { uploadMode: "resumable_backend_composed" },
        lifecycleAttempts: 1,
        lifecycleVersion: 3,
        lifecycleNextAttemptAt: "2026-08-14T11:59:00.000Z",
      }),
    );
    await objectStore.putObject({
      key: failed.objectKey,
      body: new TextEncoder().encode("ten-bytes!"),
      contentType: failed.mimeType,
    });
    const service = new FileService(repository, objectStore, undefined, {
      resumableUploadMaxBytes: 8,
    });

    await expect(
      service.processLifecycleJob({
        workerId: "worker_configured_size",
        now: "2026-08-14T12:00:00.000Z",
      }),
    ).resolves.toMatchObject({ outcome: "failed", state: "failed" });
    expect(await repository.getFileObject(failed.id)).toMatchObject({
      lifecycleAttempts: 2,
      lifecycleFailureCode: "file_size_mismatch",
      status: "failed",
    });
  });
});

function fileFixture(patch: Partial<FileObject> = {}): FileObject {
  return {
    id: "file_lifecycle_fixture",
    orgId: "org_default",
    workspaceId: "workspace_default",
    ownerType: "user",
    ownerId: "user_dev_admin",
    fileName: "fixture.txt",
    mimeType: "text/plain",
    sizeBytes: 7,
    sha256: "a".repeat(64),
    objectKey: "files/org_default/workspace_default/fixture.txt",
    purpose: "general",
    status: "uploading",
    metadata: {},
    createdAt: "2026-08-14T11:00:00.000Z",
    updatedAt: "2026-08-14T11:00:00.000Z",
    ...patch,
  };
}
