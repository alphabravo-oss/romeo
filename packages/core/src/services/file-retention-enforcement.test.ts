import type { AuthSubject } from "@romeo/auth";
import { MemoryObjectStore, type ObjectStore } from "@romeo/storage";
import { describe, expect, it, vi } from "vitest";

import type { FileObject } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { enforceFileRetentionBatches } from "./file-retention-enforcement";

const orgId = "org_retention";
const enforcedAt = "2026-08-23T12:00:00.000Z";
const subject = {
  id: "user_retention",
  type: "user",
  orgId,
  workspaceIds: ["workspace_retention"],
  groupIds: [],
  scopes: [],
  isAdmin: true,
  adminRole: "org_admin",
} satisfies AuthSubject;
const policy = {
  orgId,
  auditLogRetentionDays: 365,
  runEventRetentionDays: 30,
  fileRetentionDays: 1,
  workspaceFileRetentionDays: {},
  userFileRetentionDays: {},
  updatedBy: subject.id,
  updatedAt: enforcedAt,
};

describe("bounded file retention enforcement", () => {
  it("purges expired file-lifecycle dead letters after the retention window", async () => {
    const repository = new InMemoryRomeoRepository();
    const store = new MemoryObjectStore();
    const deadLetter = {
      ...expiredFile(9, orgId),
      status: "failed" as const,
      lifecycleAttempts: 5,
      lifecycleFailureCode: "file_lifecycle_failed",
      metadata: {
        fileLifecycleDeadLetter: {
          schemaVersion: 1,
          attempts: 5,
          failedAt: "2026-08-01T00:00:09.000Z",
          failureCode: "file_lifecycle_failed",
        },
      },
    };
    await repository.createFileObject(deadLetter);
    await store.putObject({
      key: deadLetter.objectKey,
      contentType: deadLetter.mimeType,
      body: new TextEncoder().encode("file-9"),
    });

    const result = await enforceFileRetentionBatches({
      enforcedAt,
      objectStore: store,
      policy,
      repository,
      subject,
    });

    expect(result.deletedFileObjectCount).toBe(1);
    expect(await repository.getFileObject(deadLetter.id)).toMatchObject({
      status: "deleted",
      metadata: { contentPurged: true },
    });
    expect(await store.getObject(deadLetter.objectKey)).toBeUndefined();
  });

  it("persists a tenant cursor, resumes, and never downloads object bodies", async () => {
    const repository = new InMemoryRomeoRepository();
    const store = new MemoryObjectStore();
    const getObject = vi.spyOn(store, "getObject");
    for (const [index, tenant] of [
      [1, orgId],
      [2, orgId],
      [3, orgId],
      [4, "org_other"],
    ] as const) {
      const file = expiredFile(index, tenant);
      await repository.createFileObject(file);
      await store.putObject({
        key: file.objectKey,
        contentType: file.mimeType,
        body: new TextEncoder().encode(`file-${index}`),
      });
    }

    const first = await enforceFileRetentionBatches({
      enforcedAt,
      maxCandidates: 2,
      objectStore: store,
      policy,
      repository,
      subject,
    });
    expect(first).toMatchObject({
      backlogRemaining: true,
      deletedFileObjectCount: 2,
      scannedFileObjectCount: 2,
    });
    expect(first.cursor).toEqual({
      id: "file_2",
      updatedAt: "2026-08-01T00:00:02.000Z",
    });

    const second = await enforceFileRetentionBatches({
      enforcedAt,
      maxCandidates: 2,
      objectStore: store,
      policy,
      repository,
      subject,
    });
    expect(second).toMatchObject({
      backlogRemaining: false,
      deletedFileObjectCount: 1,
      scannedFileObjectCount: 1,
    });
    expect(second.cursor).toBeUndefined();
    expect(await repository.getFileObject("file_4")).toBeDefined();
    expect(getObject).not.toHaveBeenCalled();
  });

  it("preserves legal holds and stops resumably on metadata failures", async () => {
    const base = new InMemoryRomeoRepository();
    const held = expiredFile(1, orgId);
    const blocked = expiredFile(2, orgId);
    await base.createFileObject(held);
    await base.createFileObject(blocked);
    const memory = new MemoryObjectStore();
    await memory.putObject({
      key: held.objectKey,
      contentType: held.mimeType,
      body: new Uint8Array([1]),
    });
    const repository = legalHoldRepository(base, held.id);
    const objectStore: ObjectStore = {
      ...memory,
      putObject: (input) => memory.putObject(input),
      getObject: (key, options) => memory.getObject(key, options),
      deleteObject: (key) => memory.deleteObject(key),
      createPresignedUpload: (input) => memory.createPresignedUpload(input),
      headObject: async (key) => {
        if (key === blocked.objectKey) throw new Error("head unavailable");
        return memory.headObject(key);
      },
    };

    const result = await enforceFileRetentionBatches({
      enforcedAt,
      objectStore,
      policy,
      repository,
      subject,
    });
    expect(result).toMatchObject({
      backlogRemaining: true,
      deletedFileObjectCount: 0,
      legalHoldSkippedCount: 1,
      metadataFailureCount: 1,
      scannedFileObjectCount: 1,
    });
    expect(result.cursor?.id).toBe(held.id);
    expect(await base.getFileObject(held.id)).toBeDefined();
    expect(await base.getFileObject(blocked.id)).toBeDefined();
  });
});

function expiredFile(index: number, tenant: string): FileObject {
  const suffix = String(index).padStart(2, "0");
  return {
    id: `file_${index}`,
    orgId: tenant,
    workspaceId: tenant === orgId ? "workspace_retention" : "workspace_other",
    ownerType: "user",
    ownerId: subject.id,
    fileName: `file-${index}.txt`,
    mimeType: "text/plain",
    sizeBytes: 6,
    sha256: `sha256-${index}`,
    objectKey: `files/${tenant}/file-${index}`,
    purpose: "general",
    status: "ready",
    metadata: {},
    createdAt: `2026-08-01T00:00:${suffix}.000Z`,
    updatedAt: `2026-08-01T00:00:${suffix}.000Z`,
  };
}

function legalHoldRepository(
  repository: RomeoRepository,
  heldFileId: string,
): RomeoRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      if (property === "getDataDeletionPlan") {
        return async (
          tenant: string,
          resourceType: "chat" | "file_object" | "knowledge_source",
          resourceId: string,
        ) => {
          const plan = await target.getDataDeletionPlan(
            tenant,
            resourceType,
            resourceId,
          );
          return plan === undefined || resourceId !== heldFileId
            ? plan
            : {
                ...plan,
                legalHold: {
                  until: "2030-01-01T00:00:00.000Z",
                  reason: "litigation",
                },
              };
        };
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}
