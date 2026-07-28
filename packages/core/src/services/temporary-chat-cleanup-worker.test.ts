import { describe, expect, it } from "vitest";
import { MemoryObjectStore, type ObjectStore } from "@romeo/storage";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { ChatService } from "./chat-service";
import { TemporaryChatCleanupWorker } from "./temporary-chat-cleanup-worker";

describe("temporary chat cleanup worker", () => {
  it("claims an interval job, deletes expired chats, and records sanitized evidence", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createChat({
      id: "chat_expired_worker",
      orgId: "org_default",
      workspaceId: "workspace_default",
      title: "Expired temporary chat",
      temporary: true,
      expiresAt: "2026-07-16T11:59:00.000Z", // deliberately-expired: cleanup target
      createdBy: "user_dev_admin",
      updatedAt: "2026-07-16T11:00:00.000Z",
    });
    const worker = new TemporaryChatCleanupWorker(
      repository,
      new ChatService(repository),
      {
        enabled: true,
        intervalMs: 60_000,
        batchSize: 10,
        leaseSeconds: 300,
        workerId: "cleanup_worker_1",
      },
    );

    await worker.runOnce("2026-07-16T12:00:00.000Z");

    expect(await repository.getChat("chat_expired_worker")).toBeUndefined();
    expect(await repository.listBackgroundJobs("org_default")).toContainEqual(
      expect.objectContaining({
        type: "temporary_chat.cleanup",
        status: "completed",
        payload: expect.objectContaining({
          deleted: 1,
          scanned: 1,
          requestId: expect.stringMatching(
            /^temporary_chat_cleanup_org_default_[0-9]+$/u,
          ),
          traceId: expect.stringMatching(/^[0-9a-f]{32}$/u),
        }),
      }),
    );
    expect(await repository.listAuditLogs("org_default")).toContainEqual(
      expect.objectContaining({
        action: "chat.temporary.cleanup.worker",
        metadata: expect.objectContaining({
          deleted: 1,
          skippedLegalHold: 0,
          requestId: expect.stringMatching(
            /^temporary_chat_cleanup_org_default_[0-9]+$/u,
          ),
          traceId: expect.stringMatching(/^[0-9a-f]{32}$/u),
        }),
      }),
    );
  });

  it("preserves expired chats under legal hold", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createChat({
      id: "chat_expired_held",
      orgId: "org_default",
      workspaceId: "workspace_default",
      title: "Held temporary chat",
      temporary: true,
      expiresAt: "2026-07-16T11:59:00.000Z", // deliberately-expired: legal-hold target
      legalHoldUntil: "2026-08-16T12:00:00.000Z",
      legalHoldReason: "investigation",
      createdBy: "user_dev_admin",
      updatedAt: "2026-07-16T11:00:00.000Z",
    });
    const worker = new TemporaryChatCleanupWorker(
      repository,
      new ChatService(repository),
      {
        enabled: true,
        intervalMs: 60_000,
        batchSize: 10,
        leaseSeconds: 300,
        workerId: "cleanup_worker_1",
      },
    );

    await worker.runOnce("2026-07-16T12:00:00.000Z");

    expect(await repository.getChat("chat_expired_held")).toBeDefined();
    expect(await repository.listBackgroundJobs("org_default")).toContainEqual(
      expect.objectContaining({
        status: "completed",
        payload: expect.objectContaining({ deleted: 0, skippedLegalHold: 1 }),
      }),
    );
  });

  it("allows only one replica to claim a deterministic cleanup interval", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createChat({
      id: "chat_expired_concurrent",
      orgId: "org_default",
      workspaceId: "workspace_default",
      title: "Concurrent cleanup target",
      temporary: true,
      expiresAt: "2026-07-16T11:59:00.000Z", // deliberately-expired: concurrent cleanup target
      createdBy: "user_dev_admin",
      updatedAt: "2026-07-16T11:00:00.000Z",
    });
    const first = new TemporaryChatCleanupWorker(
      repository,
      new ChatService(repository),
      cleanupOptions("cleanup_worker_1"),
    );
    const second = new TemporaryChatCleanupWorker(
      repository,
      new ChatService(repository),
      cleanupOptions("cleanup_worker_2"),
    );

    await Promise.all([
      first.runOnce("2026-07-16T12:00:00.000Z"),
      second.runOnce("2026-07-16T12:00:00.000Z"),
    ]);

    expect(await repository.getChat("chat_expired_concurrent")).toBeUndefined();
    expect(
      (await repository.listBackgroundJobs("org_default")).filter(
        (job) => job.type === "temporary_chat.cleanup",
      ),
    ).toEqual([
      expect.objectContaining({
        status: "completed",
        payload: expect.objectContaining({ deleted: 1 }),
      }),
    ]);
  });

  it("fails closed when an attachment object cannot be deleted and succeeds on retry", async () => {
    const repository = new InMemoryRomeoRepository();
    const backingStore = new MemoryObjectStore();
    const objectKey = "chat-attachments/msg_cleanup/part_cleanup/document.txt";
    let failDelete = true;
    const objectStore: ObjectStore = {
      putObject: (input) => backingStore.putObject(input),
      getObject: (key) => backingStore.getObject(key),
      createPresignedUpload: (input) =>
        backingStore.createPresignedUpload(input),
      deleteObject: async (key) => {
        if (failDelete) throw new Error("object deletion unavailable");
        await backingStore.deleteObject(key);
      },
    };
    await repository.createChat({
      id: "chat_expired_object_failure",
      orgId: "org_default",
      workspaceId: "workspace_default",
      title: "Object deletion failure target",
      temporary: true,
      expiresAt: "2026-07-16T11:59:00.000Z", // deliberately-expired: object failure target
      createdBy: "user_dev_admin",
      updatedAt: "2026-07-16T11:00:00.000Z",
    });
    await repository.createMessage({
      id: "msg_cleanup",
      chatId: "chat_expired_object_failure",
      role: "user",
      content: "attachment cleanup",
      createdAt: "2026-07-16T11:30:00.000Z",
    });
    await repository.createMessageParts([
      {
        id: "part_cleanup",
        messageId: "msg_cleanup",
        type: "attachment",
        content: objectKey,
        metadata: {},
      },
    ]);
    await backingStore.putObject({
      key: objectKey,
      contentType: "text/plain",
      body: Buffer.from("retained until deletion succeeds"),
    });
    const first = new TemporaryChatCleanupWorker(
      repository,
      new ChatService(repository, objectStore),
      cleanupOptions("cleanup_worker_failure"),
    );

    await first.runOnce("2026-07-16T12:00:00.000Z");

    expect(
      await repository.getChat("chat_expired_object_failure"),
    ).toBeDefined();
    expect(await backingStore.getObject(objectKey)).toBeDefined();
    expect(await repository.listBackgroundJobs("org_default")).toContainEqual(
      expect.objectContaining({
        status: "failed",
        payload: expect.objectContaining({
          batchSize: 10,
          errorCode: "temporary_chat_cleanup_failed",
        }),
      }),
    );

    failDelete = false;
    const retry = new TemporaryChatCleanupWorker(
      repository,
      new ChatService(repository, objectStore),
      cleanupOptions("cleanup_worker_retry"),
    );
    await retry.runOnce("2026-07-16T12:01:00.000Z");

    expect(
      await repository.getChat("chat_expired_object_failure"),
    ).toBeUndefined();
    expect(await backingStore.getObject(objectKey)).toBeUndefined();
  });
});

function cleanupOptions(workerId: string) {
  return {
    enabled: true,
    intervalMs: 60_000,
    batchSize: 10,
    leaseSeconds: 300,
    workerId,
  };
}
