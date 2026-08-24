import { describe, expect, it } from "vitest";

import { PgContentDeletionRepository } from "./content-deletion-repository";

const now = "2026-08-23T12:00:00.000Z";

describe("PgContentDeletionRepository", () => {
  it("creates, resolves idempotency conflicts, and rejects an empty conflict", async () => {
    const inserted = row();
    await expect(
      repository([[inserted]]).createContentDeletionOperation(operation()),
    ).resolves.toMatchObject({
      id: inserted.id,
      externalVectorVerificationRequired: true,
      objectKey: inserted.objectKey,
      lease: { fencingToken: 2 },
    });

    await expect(
      repository([[], [inserted]]).createContentDeletionOperation(operation()),
    ).resolves.toMatchObject({
      id: inserted.id,
    });
    await expect(
      repository([[], []]).createContentDeletionOperation(operation()),
    ).rejects.toThrow("content_deletion_target_conflict");
  });

  it("reads exact and active operations without manufacturing missing rows", async () => {
    const existing = row({
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    await expect(
      repository([[existing]]).getContentDeletionOperation(
        "org_default",
        existing.id,
      ),
    ).resolves.toMatchObject({
      id: existing.id,
    });
    await expect(
      repository([[]]).getContentDeletionOperation("org_default", "missing"),
    ).resolves.toBeUndefined();
    await expect(
      repository([[existing]]).getActiveContentDeletionOperation(
        "org_default",
        "knowledge_source",
        existing.targetId,
      ),
    ).resolves.toMatchObject({
      targetType: "knowledge_source",
    });
    await expect(
      repository([[]]).getActiveContentDeletionOperation(
        "org_default",
        "knowledge_source",
        "missing",
      ),
    ).resolves.toBeUndefined();
  });

  it("claims due work atomically and handles lost claim races", async () => {
    const candidate = row({ status: "failed", nextAttemptAt: new Date(now) });
    const claimed = row({ attempts: 2, status: "processing" });
    const input = {
      orgId: "org_default",
      leaseOwner: "worker_a",
      leaseToken: "lease_a",
      leaseExpiresAt: "2026-08-23T12:05:00.000Z",
      now,
    };
    await expect(
      repository([[]]).claimContentDeletionOperation(input),
    ).resolves.toBeUndefined();
    await expect(
      repository([[candidate], []]).claimContentDeletionOperation(input),
    ).resolves.toBeUndefined();
    await expect(
      repository([[candidate], [claimed]]).claimContentDeletionOperation(input),
    ).resolves.toMatchObject({
      attempts: 2,
      status: "processing",
    });
  });

  it("checkpoints processing and terminal states and renews only owned leases", async () => {
    const processing = operation();
    const completed = {
      ...processing,
      status: "completed" as const,
      completedAt: now,
      objectDeletedAt: now,
      objectVerifiedAt: now,
      vectorsDeletedAt: now,
      vectorsVerifiedAt: now,
      relationalDeletedAt: now,
      attestedAt: now,
      nextAttemptAt: now,
      failureCode: "content_deletion_failed",
    };
    const input = {
      operation: processing,
      leaseOwner: "worker_a",
      leaseToken: "lease_a",
      fencingToken: 2,
      now,
    };
    await expect(
      repository([[row()]]).updateContentDeletionOperationWithLease(input),
    ).resolves.toMatchObject({ id: processing.id });
    await expect(
      repository([[]]).updateContentDeletionOperationWithLease(input),
    ).resolves.toBeUndefined();
    await expect(
      repository([
        [row({ status: "completed" })],
      ]).updateContentDeletionOperationWithLease({
        ...input,
        operation: completed,
      }),
    ).resolves.toMatchObject({ status: "completed" });

    const renewal = {
      orgId: "org_default",
      operationId: processing.id,
      leaseOwner: "worker_a",
      leaseToken: "lease_a",
      fencingToken: 2,
      leaseExpiresAt: "2026-08-23T12:10:00.000Z",
      now,
    };
    await expect(
      repository([[row()]]).renewContentDeletionOperationLease(renewal),
    ).resolves.toBeDefined();
    await expect(
      repository([[]]).renewContentDeletionOperationLease(renewal),
    ).resolves.toBeUndefined();
  });
});

function operation() {
  return {
    id: "content_delete_1",
    orgId: "org_default",
    workspaceId: "workspace_default",
    targetType: "knowledge_source" as const,
    targetId: "source_1",
    targetGeneration: "generation",
    idempotencyKey: "idempotency",
    status: "processing" as const,
    externalVectorVerificationRequired: true,
    objectKey: "knowledge/source_1",
    knowledgeBaseId: "kb_default",
    requestedByType: "user" as const,
    requestedById: "user_dev_admin",
    attempts: 1,
    legalHoldEvaluatedAt: now,
    lease: {
      owner: "worker_a",
      token: "lease_a",
      fencingToken: 2,
      attempt: 1,
      expiresAt: "2026-08-23T12:05:00.000Z",
    },
    createdAt: now,
    updatedAt: now,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "content_delete_1",
    orgId: "org_default",
    workspaceId: "workspace_default",
    targetType: "knowledge_source",
    targetId: "source_1",
    targetGeneration: "generation",
    idempotencyKey: "idempotency",
    status: "processing",
    externalVectorVerificationRequired: true,
    objectKey: "knowledge/source_1",
    knowledgeBaseId: "kb_default",
    requestedByType: "user",
    requestedById: "user_dev_admin",
    attempts: 1,
    nextAttemptAt: null,
    failureCode: null,
    legalHoldEvaluatedAt: new Date(now),
    objectDeletedAt: new Date(now),
    objectVerifiedAt: new Date(now),
    vectorsDeletedAt: new Date(now),
    vectorsVerifiedAt: new Date(now),
    relationalDeletedAt: new Date(now),
    attestedAt: new Date(now),
    leaseOwner: "worker_a",
    leaseToken: "lease_a",
    leaseExpiresAt: new Date("2026-08-23T12:05:00.000Z"),
    leaseFence: 2,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    completedAt: null,
    ...overrides,
  };
}

function repository(results: unknown[][]) {
  return new PgContentDeletionRepository(chainDatabase(results) as never);
}

function chainDatabase(results: unknown[][]) {
  const pending = [...results];
  const database: Record<string, unknown> = {};
  const query = () => {
    const result = pending.shift() ?? [];
    const chain = new Proxy(
      {},
      {
        get: (_target, property) =>
          property === "then"
            ? (resolve: (value: unknown) => unknown) => resolve(result)
            : () => chain,
      },
    );
    return chain;
  };
  database.insert = query;
  database.select = query;
  database.update = query;
  database.transaction = (callback: (transaction: unknown) => unknown) =>
    callback(database);
  return database;
}
