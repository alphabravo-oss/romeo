import { describe, expect, it, vi } from "vitest";

import type { AuthSubject } from "@romeo/auth";
import { MemoryObjectStore, type ObjectStore } from "@romeo/storage";

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

  it("keeps scan-clean images attachable when optional OCR is unavailable", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const service = new FileService(repository, objectStore);
    const bytes = new Uint8Array(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlJkAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const accepted = await service.create(subject, {
      dataBase64: Buffer.from(bytes).toString("base64"),
      fileName: "vision-fixture.png",
      mimeType: "image/png",
      purpose: "chat_attachment",
      sizeBytes: bytes.byteLength,
      workspaceId: "workspace_default",
    });

    await expect(
      service.processLifecycleJob({ workerId: "worker_optional_ocr" }),
    ).resolves.toMatchObject({ outcome: "completed", state: "ready" });
    await expect(service.get(subject, accepted.id)).resolves.toMatchObject({
      contentUrl: expect.stringContaining(accepted.id),
      extraction: {
        failureCode: "file_ocr_unavailable",
        status: "failed",
      },
      status: "ready",
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

    const accepted = await unavailable.create(subject, {
      workspaceId: "workspace_default",
      fileName: "retry.txt",
      mimeType: "text/plain",
      sizeBytes: bytes.byteLength,
      dataBase64: Buffer.from(bytes).toString("base64"),
    });
    expect(accepted).toMatchObject({
      status: "quarantined",
      contentUrl: null,
      lifecycle: { attempts: 0, state: "quarantined" },
    });
    await expect(
      unavailable.processLifecycleJob({
        workerId: "worker_unavailable",
        now: "2026-08-14T12:00:00.000Z",
      }),
    ).resolves.toMatchObject({ outcome: "failed", state: "failed" });
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
    await expect(
      recovered.processLifecycleJob({
        workerId: "worker_early",
        now: "2026-08-14T12:00:29.999Z",
      }),
    ).resolves.toEqual({ outcome: "idle" });
    const result = await recovered.processLifecycleJob({
      workerId: "worker_a",
      now: "2026-08-14T12:00:30.000Z",
    });
    expect(result).toMatchObject({ outcome: "completed", state: "ready" });
    expect(await repository.getFileObject(failed!.id)).toMatchObject({
      status: "ready",
      lifecycleAttempts: 2,
    });
    await expect(
      recovered.processLifecycleJob({
        workerId: "worker_b",
        now: "2026-08-14T12:00:31.000Z",
      }),
    ).resolves.toEqual({ outcome: "idle" });
  });

  it("does not invoke scanner or extractor before returning the upload", async () => {
    const repository = new InMemoryRomeoRepository();
    const scanner = vi.fn(async () => ({ verdict: "clean" as const }));
    const extractor = vi.fn(async () => ({ content: "text", metadata: {} }));
    const bytes = new TextEncoder().encode("request boundary sentinel");
    const service = new FileService(
      repository,
      new MemoryObjectStore(),
      undefined,
      {},
      { policy: "required", scanner: { scan: scanner } },
      { extract: extractor },
    );

    const accepted = await service.create(subject, {
      workspaceId: "workspace_default",
      fileName: "async.txt",
      mimeType: "text/plain",
      sizeBytes: bytes.byteLength,
      dataBase64: Buffer.from(bytes).toString("base64"),
    });

    expect(accepted.status).toBe("quarantined");
    expect(scanner).not.toHaveBeenCalled();
    expect(extractor).not.toHaveBeenCalled();
    await expect(
      service.processLifecycleJob({ workerId: "file_worker" }),
    ).resolves.toMatchObject({ outcome: "completed", state: "ready" });
    expect(scanner).toHaveBeenCalledOnce();
  });

  it("dead-letters an exhausted retry without scheduling another claim", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const failed = await repository.createFileObject(
      fileFixture({
        status: "failed",
        lifecycleAttempts: 4,
        lifecycleVersion: 3,
        lifecycleNextAttemptAt: "2026-08-14T11:59:00.000Z",
      }),
    );
    await objectStore.putObject({
      key: failed.objectKey,
      body: new TextEncoder().encode("fixture"),
      contentType: failed.mimeType,
    });
    const service = new FileService(
      repository,
      objectStore,
      undefined,
      {},
      {
        policy: "required",
      },
    );

    await expect(
      service.processLifecycleJob({
        workerId: "worker_exhaustion",
        now: "2026-08-14T12:00:00.000Z",
      }),
    ).resolves.toMatchObject({ outcome: "failed", state: "failed" });
    const deadLetter = await repository.getFileObject(failed.id);
    expect(deadLetter).toMatchObject({
      status: "failed",
      lifecycleAttempts: 5,
      metadata: {
        fileLifecycleDeadLetter: {
          schemaVersion: 1,
          attempts: 5,
          failureCode: "file_malware_scan_unavailable",
        },
      },
    });
    expect(deadLetter?.lifecycleNextAttemptAt).toBeUndefined();
    await expect(
      service.processLifecycleJob({
        workerId: "worker_after_exhaustion",
        now: "2026-08-15T12:00:00.000Z",
      }),
    ).resolves.toEqual({ outcome: "idle" });
  });

  it("propagates supervisor cancellation into active scanner work", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const queued = await repository.createFileObject(
      fileFixture({ status: "quarantined", lifecycleVersion: 1 }),
    );
    await objectStore.putObject({
      key: queued.objectKey,
      body: new TextEncoder().encode("fixture"),
      contentType: queued.mimeType,
    });
    const service = new FileService(
      repository,
      objectStore,
      undefined,
      {},
      {
        policy: "required",
        scanner: {
          scan: async (input) => {
            observedSignal = input.signal;
            return new Promise((_resolveScan, rejectScan) =>
              input.signal?.addEventListener(
                "abort",
                () => rejectScan(input.signal?.reason),
                { once: true },
              ),
            );
          },
        },
      },
    );
    const scanning = service.processLifecycleJob({
      workerId: "worker_cancel",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    controller.abort();
    await expect(scanning).resolves.toMatchObject({
      outcome: "failed",
      state: "failed",
    });
    expect(await repository.getFileObject(queued.id)).toMatchObject({
      lifecycleFailureCode: "file_lifecycle_aborted",
    });
  });

  it.each(["object_read", "ocr", "extractor"] as const)(
    "propagates supervisor cancellation into active %s work",
    async (mode) => {
      const repository = new InMemoryRomeoRepository();
      const memory = new MemoryObjectStore();
      const controller = new AbortController();
      let observedSignal: AbortSignal | undefined;
      const bytes =
        mode === "ocr"
          ? new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
          : mode === "extractor"
            ? new TextEncoder().encode("%PDF-1.4 fixture")
            : new TextEncoder().encode("fixture");
      const queued = await repository.createFileObject(
        fileFixture({
          status: "quarantined",
          lifecycleVersion: 1,
          fileName:
            mode === "ocr"
              ? "fixture.png"
              : mode === "extractor"
                ? "fixture.pdf"
                : "fixture.txt",
          mimeType:
            mode === "ocr"
              ? "image/png"
              : mode === "extractor"
                ? "application/pdf"
                : "text/plain",
          sizeBytes: bytes.byteLength,
        }),
      );
      await memory.putObject({
        key: queued.objectKey,
        body: bytes,
        contentType: queued.mimeType,
      });
      const waitForAbort = <T>(signal: AbortSignal | undefined) => {
        observedSignal = signal;
        return new Promise<T>((_resolve, reject) => {
          if (signal?.aborted === true) {
            reject(signal.reason);
            return;
          }
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      };
      const objectStore: ObjectStore =
        mode === "object_read"
          ? {
              putObject: (input) => memory.putObject(input),
              getObject: (_key, options) =>
                waitForAbort<Uint8Array | undefined>(options?.signal),
              headObject: (key) => memory.headObject(key),
              deleteObject: (key) => memory.deleteObject(key),
              createPresignedUpload: (input) =>
                memory.createPresignedUpload(input),
            }
          : memory;
      const service = new FileService(
        repository,
        objectStore,
        undefined,
        {},
        { policy: "off" },
        {
          extract: (input) =>
            mode === "extractor"
              ? waitForAbort<never>(input.signal)
              : Promise.reject(new Error("extractor should not be called")),
        },
        {
          recognize: (input) =>
            mode === "ocr"
              ? waitForAbort<never>(input.signal)
              : Promise.reject(new Error("OCR should not be called")),
        },
      );

      const work = service.processLifecycleJob({
        workerId: `worker_cancel_${mode}`,
        signal: controller.signal,
      });
      await vi.waitFor(() => expect(observedSignal).toBeDefined());
      controller.abort();
      await expect(work).resolves.toMatchObject({
        outcome: "failed",
        state: "failed",
      });
      expect(await repository.getFileObject(queued.id)).toMatchObject({
        lifecycleFailureCode: "file_lifecycle_aborted",
      });
    },
  );

  it("aborts timed-out scanner work before releasing the lease", async () => {
    vi.useFakeTimers();
    try {
      const repository = new InMemoryRomeoRepository();
      const objectStore = new MemoryObjectStore();
      const queued = await repository.createFileObject(
        fileFixture({ status: "quarantined", lifecycleVersion: 1 }),
      );
      await objectStore.putObject({
        key: queued.objectKey,
        body: new TextEncoder().encode("fixture"),
        contentType: queued.mimeType,
      });
      let scannerAborted = false;
      const service = new FileService(
        repository,
        objectStore,
        undefined,
        {},
        {
          policy: "required",
          scanner: {
            scan: (input) =>
              new Promise<never>((_resolve, reject) =>
                input.signal?.addEventListener(
                  "abort",
                  () => {
                    scannerAborted = true;
                    reject(input.signal?.reason);
                  },
                  { once: true },
                ),
              ),
          },
        },
      );

      const work = service.processLifecycleJob({
        workerId: "worker_timeout",
        leaseMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(800);
      await expect(work).resolves.toMatchObject({
        outcome: "failed",
        state: "failed",
      });
      expect(scannerAborted).toBe(true);
      expect(await repository.getFileObject(queued.id)).toMatchObject({
        lifecycleFailureCode: "file_lifecycle_timeout",
      });
    } finally {
      vi.useRealTimers();
    }
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

  it("does not claim lifecycle work after its supervisor is aborted", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createFileObject(
      fileFixture({ status: "quarantined", lifecycleVersion: 1 }),
    );
    const controller = new AbortController();
    controller.abort();

    const service = new FileService(repository, new MemoryObjectStore());
    await expect(
      service.processLifecycleJob({
        workerId: "worker_aborted",
        signal: controller.signal,
      }),
    ).resolves.toEqual({ outcome: "idle" });
    expect(
      await repository.getFileObject("file_lifecycle_fixture"),
    ).toMatchObject({ status: "quarantined", lifecycleAttempts: 0 });
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
