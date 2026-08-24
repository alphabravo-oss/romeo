import { seededSubject } from "@romeo/auth";
import { MemoryObjectStore, type ObjectStore } from "@romeo/storage";
import { describe, expect, it, vi } from "vitest";

import type { FileObject } from "../domain/entities";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { ContentDeletionService } from "./content-deletion-service";
import { FileService } from "./file-service";
import { KnowledgeSourceService } from "./knowledge-source-service";
import type { KnowledgeVectorStore } from "./knowledge-vector-store";

describe("durable cross-store content deletion", () => {
  it("marks a file pending, denies reads, and attests only after absence verification", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const files = new FileService(repository, objectStore);
    const created = await createReadyFile(files);
    const stored = (await repository.getFileObject(created.id))!;

    const pending = await files.delete(seededSubject, created.id);
    const duplicate = await files.delete(seededSubject, created.id);
    const operation = await repository.getActiveContentDeletionOperation(
      seededSubject.orgId,
      "file_object",
      created.id,
    );

    expect(pending.status).toBe("deletion_pending");
    expect(duplicate.status).toBe("deletion_pending");
    expect(operation).toBeDefined();
    expect(await objectStore.headObject(stored.objectKey)).toBeDefined();
    await expect(
      files.readContent(seededSubject, created.id),
    ).rejects.toMatchObject({
      code: "file_not_ready",
    });
    expect(await files.list(seededSubject, stored.workspaceId)).toEqual([]);

    const worker = new ContentDeletionService(repository, objectStore);
    await expect(
      worker.runOnce({ subject: seededSubject, workerId: "delete_worker" }),
    ).resolves.toMatchObject({
      outcome: "completed",
      operationId: operation!.id,
    });
    expect(await objectStore.headObject(stored.objectKey)).toBeUndefined();
    expect(await repository.getFileObject(created.id)).toMatchObject({
      status: "deleted",
      metadata: { contentPurged: true },
    });
    expect(
      await repository.getContentDeletionOperation(
        seededSubject.orgId,
        operation!.id,
      ),
    ).toMatchObject({
      status: "completed",
      objectVerifiedAt: expect.any(String),
      relationalDeletedAt: expect.any(String),
      attestedAt: expect.any(String),
    });
    expect(
      (await repository.listAuditLogs(seededSubject.orgId)).map(
        (entry) => entry.action,
      ),
    ).toEqual(
      expect.arrayContaining([
        "content.deletion.intent",
        "content.deletion.attest",
      ]),
    );
    expect(
      JSON.stringify(await repository.listAuditLogs(seededSubject.orgId)),
    ).not.toContain(stored.objectKey);
    await expect(
      worker.runOnce({ subject: seededSubject, workerId: "delete_worker" }),
    ).resolves.toEqual({ outcome: "idle" });
  });

  it("retries verified object failures with a fenced lease and bounded backoff", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const files = new FileService(repository, objectStore);
    const created = await createReadyFile(files);
    await files.delete(seededSubject, created.id);
    const originalDelete = objectStore.deleteObject.bind(objectStore);
    const deleteObject = vi
      .spyOn(objectStore, "deleteObject")
      .mockRejectedValueOnce(new Error("private provider failure"))
      .mockImplementation(originalDelete);
    const worker = new ContentDeletionService(repository, objectStore);

    await expect(
      worker.runOnce({
        subject: seededSubject,
        workerId: "retry_worker",
        now: "2026-08-23T12:00:00.000Z",
      }),
    ).resolves.toMatchObject({ outcome: "failed" });
    const failed = await repository.getActiveContentDeletionOperation(
      seededSubject.orgId,
      "file_object",
      created.id,
    );
    expect(failed).toMatchObject({
      attempts: 1,
      failureCode: "content_deletion_failed",
      status: "failed",
      nextAttemptAt: "2026-08-23T12:00:30.000Z",
    });
    expect(failed?.lease).toBeUndefined();

    await expect(
      worker.runOnce({
        subject: seededSubject,
        workerId: "retry_worker",
        now: failed!.nextAttemptAt!,
      }),
    ).resolves.toMatchObject({ outcome: "completed" });
    expect(deleteObject).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a pending file generation changes", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const files = new FileService(repository, objectStore);
    const created = await createReadyFile(files);
    await files.delete(seededSubject, created.id);
    const pending = (await repository.getFileObject(created.id))!;
    await repository.updateFileObject({
      ...pending,
      sha256: "f".repeat(64),
      lifecycleVersion: (pending.lifecycleVersion ?? 0) + 1,
    });
    const worker = new ContentDeletionService(repository, objectStore);
    await expect(
      worker.runOnce({ subject: seededSubject, workerId: "generation_worker" }),
    ).resolves.toMatchObject({ outcome: "failed" });
    expect(
      await repository.getActiveContentDeletionOperation(
        seededSubject.orgId,
        "file_object",
        created.id,
      ),
    ).toMatchObject({ failureCode: "content_deletion_generation_mismatch" });
    expect(await objectStore.headObject(pending.objectKey)).toBeDefined();
  });

  it("does not attest or remove relational state without object absence proof", async () => {
    const repository = new InMemoryRomeoRepository();
    const backingStore = new MemoryObjectStore();
    const files = new FileService(repository, backingStore);
    const created = await createReadyFile(files);
    await files.delete(seededSubject, created.id);
    const unverifiableStore: ObjectStore = {
      createPresignedUpload:
        backingStore.createPresignedUpload.bind(backingStore),
      deleteObject: backingStore.deleteObject.bind(backingStore),
      getObject: backingStore.getObject.bind(backingStore),
      putObject: backingStore.putObject.bind(backingStore),
    };

    await expect(
      new ContentDeletionService(repository, unverifiableStore).runOnce({
        subject: seededSubject,
        workerId: "unverifiable_object_worker",
      }),
    ).resolves.toMatchObject({ outcome: "failed" });
    expect(await repository.getFileObject(created.id)).toMatchObject({
      status: "deletion_pending",
    });
    const failed = await repository.getActiveContentDeletionOperation(
      seededSubject.orgId,
      "file_object",
      created.id,
    );
    expect(failed).toMatchObject({
      failureCode: "content_deletion_object_verification_unavailable",
      status: "failed",
    });
    expect(failed).not.toHaveProperty("relationalDeletedAt");
  });

  it("preserves legal-held files without creating an outbox operation", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const retained: FileObject = {
      ...(await repository.createFileObject(fileFixture("file_held"))),
      status: "retained",
      lifecycleVersion: 2,
      retainedAt: "2026-08-23T00:00:00.000Z",
    };
    await repository.updateFileObject(retained);
    await expect(
      new ContentDeletionService(repository, objectStore).enqueueFile(
        seededSubject,
        retained,
      ),
    ).rejects.toMatchObject({ code: "data_deletion_legal_hold" });
    expect(
      await repository.getActiveContentDeletionOperation(
        seededSubject.orgId,
        "file_object",
        retained.id,
      ),
    ).toBeUndefined();
  });

  it("deletes and verifies knowledge objects, external vectors, and relational children", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const vectorStore: KnowledgeVectorStore = {
      deleteEmbeddingsForSource: vi.fn(async () => undefined),
      verifyEmbeddingsAbsentForSource: vi.fn(async () => true),
      search: vi.fn(async () => []),
      upsertEmbeddings: vi.fn(async () => undefined),
    };
    const sources = new KnowledgeSourceService(
      repository,
      objectStore,
      vectorStore,
    );
    const source = await sources.create({
      subject: seededSubject,
      knowledgeBaseId: "kb_default",
      fileName: "delete-me.txt",
      mimeType: "text/plain",
      sizeBytes: 9,
      content: "delete me",
    });
    const pending = await sources.delete({
      subject: seededSubject,
      knowledgeBaseId: "kb_default",
      sourceId: source.id,
    });
    expect(pending.status).toBe("deletion_pending");
    expect(await sources.list("kb_default", seededSubject)).not.toContainEqual(
      expect.objectContaining({ id: source.id }),
    );
    await expect(
      sources.processContentDeletionJob({
        subject: seededSubject,
        workerId: "knowledge_delete_worker",
      }),
    ).resolves.toMatchObject({ outcome: "completed" });
    expect(vectorStore.deleteEmbeddingsForSource).toHaveBeenCalledOnce();
    expect(vectorStore.verifyEmbeddingsAbsentForSource).toHaveBeenCalledOnce();
    expect(await repository.getKnowledgeSource(source.id)).toBeUndefined();
    expect(
      (await repository.listKnowledgeChunks("kb_default")).filter(
        (chunk) => chunk.sourceId === source.id,
      ),
    ).toEqual([]);
  });

  it("does not claim cross-tenant operations and fails closed without vector verification", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    expect(
      await repository.getContentDeletionOperation(
        "org_other",
        "content_delete_unknown",
      ),
    ).toBeUndefined();
    const vectorStore: KnowledgeVectorStore = {
      deleteEmbeddingsForSource: vi.fn(async () => undefined),
      search: vi.fn(async () => []),
      upsertEmbeddings: vi.fn(async () => undefined),
      verifyEmbeddingsAbsentForSource: vi.fn(async () => true),
    };
    const sources = new KnowledgeSourceService(
      repository,
      objectStore,
      vectorStore,
    );
    const source = await sources.create({
      subject: seededSubject,
      knowledgeBaseId: "kb_default",
      fileName: "no-vector-proof.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      content: "proof",
    });
    await sources.delete({
      subject: seededSubject,
      knowledgeBaseId: "kb_default",
      sourceId: source.id,
    });
    await expect(
      new KnowledgeSourceService(
        repository,
        objectStore,
      ).processContentDeletionJob({
        subject: seededSubject,
        workerId: "no_vector_proof",
      }),
    ).resolves.toMatchObject({ outcome: "failed" });
    expect(
      await repository.getActiveContentDeletionOperation(
        seededSubject.orgId,
        "knowledge_source",
        source.id,
      ),
    ).toMatchObject({
      failureCode: "content_deletion_vector_verification_unavailable",
    });
    expect(await repository.getKnowledgeSource(source.id)).toBeDefined();
  });

  it("removes tenant-scoped deletion operations during an authorized tenant purge", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const files = new FileService(repository, objectStore);
    const created = await createReadyFile(files);
    await files.delete(seededSubject, created.id);
    const operation = await repository.getActiveContentDeletionOperation(
      seededSubject.orgId,
      "file_object",
      created.id,
    );

    const purge = await repository.purgeTenantData(seededSubject.orgId);

    expect(purge.recordCounts.contentDeletionOperations).toBe(1);
    expect(
      await repository.getContentDeletionOperation(
        seededSubject.orgId,
        operation!.id,
      ),
    ).toBeUndefined();
  });
});

async function createReadyFile(files: FileService) {
  const created = await files.create(seededSubject, {
    workspaceId: "workspace_default",
    fileName: "delete-me.txt",
    mimeType: "text/plain",
    sizeBytes: 9,
    dataBase64: Buffer.from("delete me").toString("base64"),
  });
  await files.processLifecycleJob({ workerId: "file_setup" });
  return created;
}

function fileFixture(id: string): FileObject {
  return {
    id,
    orgId: seededSubject.orgId,
    workspaceId: "workspace_default",
    ownerType: "user",
    ownerId: seededSubject.id,
    fileName: "held.txt",
    mimeType: "text/plain",
    sizeBytes: 4,
    sha256: "0".repeat(64),
    objectKey: `files/${id}`,
    purpose: "general",
    status: "ready",
    lifecycleVersion: 1,
    lifecycleAttempts: 0,
    metadata: {},
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
  };
}
