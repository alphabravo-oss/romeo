import { describe, expect, it } from "vitest";

import type { DataConnectorSync } from "../domain/entities";
import { InMemoryRomeoRepository } from "./in-memory";

const orgId = "org_lease";
const workspaceId = "workspace_lease";
const knowledgeBaseId = "kb_lease";
const initialAt = "2026-08-23T12:00:00.000Z";

describe("durable work-lease repository contract", () => {
  it("fences expired connector owners and accepts only the takeover result", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createDataConnector({
      id: "connector_lease",
      orgId,
      workspaceId,
      knowledgeBaseId,
      type: "rss",
      name: "Lease feed",
      config: {},
      status: "active",
      nextSyncAt: initialAt,
      createdBy: "user_lease",
      createdAt: initialAt,
      updatedAt: initialAt,
    });

    const first = await repository.claimDataConnectorSync({
      connectorId: "connector_lease",
      orgId,
      leaseOwner: "worker_a",
      leaseToken: "lease_a",
      now: initialAt,
      leaseExpiresAt: "2026-08-23T12:05:00.000Z",
    });
    expect(first?.syncLease?.fencingToken).toBe(1);
    expect(
      await repository.claimDataConnectorSync({
        connectorId: "connector_lease",
        orgId,
        leaseOwner: "worker_b",
        leaseToken: "lease_b_early",
        now: "2026-08-23T12:04:59.000Z",
        leaseExpiresAt: "2026-08-23T12:10:00.000Z",
      }),
    ).toBeUndefined();

    const takeover = await repository.claimDataConnectorSync({
      connectorId: "connector_lease",
      orgId,
      leaseOwner: "worker_b",
      leaseToken: "lease_b",
      now: "2026-08-23T12:05:00.000Z",
      leaseExpiresAt: "2026-08-23T12:10:00.000Z",
    });
    expect(takeover?.syncLease?.fencingToken).toBe(2);
    await repository.createDataConnectorSync(
      connectorSync("sync_a", 1, "lease_a"),
    );
    await repository.createDataConnectorSync(
      connectorSync("sync_b", 2, "lease_b"),
    );

    expect(
      await repository.finishDataConnectorSync({
        connector: first!,
        sync: connectorSync("sync_a", 1, "lease_a", "completed"),
        fencingToken: 1,
        leaseOwner: "worker_a",
        leaseToken: "lease_a",
        now: "2026-08-23T12:05:01.000Z",
      }),
    ).toBeUndefined();
    expect(
      await repository.finishDataConnectorSync({
        connector: takeover!,
        sync: connectorSync("sync_b", 2, "lease_b", "completed"),
        fencingToken: 2,
        leaseOwner: "worker_b",
        leaseToken: "lease_b",
        now: "2026-08-23T12:05:01.000Z",
      }),
    ).toMatchObject({ id: "sync_b", status: "completed" });
  });

  it("renews extraction ownership and prevents a stale worker replacing chunks", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createKnowledgeSource({
      id: "source_lease",
      knowledgeBaseId,
      orgId,
      workspaceId,
      fileName: "policy.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      status: "pending",
      objectKey: "source/policy.pdf",
      metadata: {},
      createdAt: initialAt,
      updatedAt: initialAt,
    });
    const first = await repository.claimKnowledgeSourceExtraction({
      knowledgeBaseId,
      sourceId: "source_lease",
      leaseOwner: "worker_a",
      leaseToken: "lease_a",
      now: initialAt,
      leaseExpiresAt: "2026-08-23T12:01:00.000Z",
    });
    const renewed = await repository.renewKnowledgeSourceExtractionLease({
      sourceId: "source_lease",
      fencingToken: 1,
      leaseOwner: "worker_a",
      leaseToken: "lease_a",
      now: "2026-08-23T12:00:30.000Z",
      leaseExpiresAt: "2026-08-23T12:02:00.000Z",
    });
    expect(renewed?.extractionLease?.expiresAt).toBe(
      "2026-08-23T12:02:00.000Z",
    );
    const takeover = await repository.claimKnowledgeSourceExtraction({
      knowledgeBaseId,
      sourceId: "source_lease",
      leaseOwner: "worker_b",
      leaseToken: "lease_b",
      now: "2026-08-23T12:02:00.000Z",
      leaseExpiresAt: "2026-08-23T12:07:00.000Z",
    });
    const staleChunk = knowledgeChunk("chunk_stale", "stale");
    expect(
      await repository.finishKnowledgeSourceExtraction({
        source: { ...first!, status: "indexed" },
        chunks: [staleChunk],
        fencingToken: 1,
        leaseOwner: "worker_a",
        leaseToken: "lease_a",
        now: "2026-08-23T12:02:01.000Z",
      }),
    ).toBeUndefined();
    const currentChunk = knowledgeChunk("chunk_current", "current");
    expect(
      await repository.finishKnowledgeSourceExtraction({
        source: { ...takeover!, status: "indexed", chunkCount: 1 },
        chunks: [currentChunk],
        fencingToken: 2,
        leaseOwner: "worker_b",
        leaseToken: "lease_b",
        now: "2026-08-23T12:02:01.000Z",
      }),
    ).toMatchObject({ id: "source_lease", status: "indexed" });
    expect(await repository.listKnowledgeChunks(knowledgeBaseId)).toEqual([
      currentChunk,
    ]);
  });

  it("claims retry work once, fences takeover, and preserves provider idempotency", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createNotificationDelivery({
      id: "delivery_lease",
      orgId,
      userId: "user_lease",
      notificationId: "notification_lease",
      channelId: "channel_lease",
      status: "failed",
      attemptCount: 1,
      metadata: { nextAttemptAt: initialAt },
      createdAt: initialAt,
      updatedAt: initialAt,
    });
    const [first] = await repository.claimDueNotificationDeliveries({
      orgId,
      limit: 10,
      leaseOwner: "worker_a",
      leaseToken: "lease_a",
      now: initialAt,
      leaseExpiresAt: "2026-08-23T12:01:00.000Z",
    });
    expect(first?.providerIdempotencyKey).toBe("delivery_lease");
    expect(
      await repository.claimDueNotificationDeliveries({
        orgId,
        limit: 10,
        leaseOwner: "worker_b",
        leaseToken: "lease_b_early",
        now: "2026-08-23T12:00:59.000Z",
        leaseExpiresAt: "2026-08-23T12:05:00.000Z",
      }),
    ).toEqual([]);
    const [takeover] = await repository.claimDueNotificationDeliveries({
      orgId,
      limit: 10,
      leaseOwner: "worker_b",
      leaseToken: "lease_b",
      now: "2026-08-23T12:01:00.000Z",
      leaseExpiresAt: "2026-08-23T12:05:00.000Z",
    });
    expect(takeover?.deliveryLease?.fencingToken).toBe(2);
    expect(takeover?.providerIdempotencyKey).toBe("delivery_lease");
    expect(
      await repository.finishNotificationDeliveryLease({
        delivery: { ...first!, status: "sent" },
        fencingToken: 1,
        leaseOwner: "worker_a",
        leaseToken: "lease_a",
        now: "2026-08-23T12:01:01.000Z",
      }),
    ).toBeUndefined();
    expect(
      await repository.finishNotificationDeliveryLease({
        delivery: { ...takeover!, status: "sent" },
        fencingToken: 2,
        leaseOwner: "worker_b",
        leaseToken: "lease_b",
        now: "2026-08-23T12:01:01.000Z",
      }),
    ).toMatchObject({
      id: "delivery_lease",
      providerIdempotencyKey: "delivery_lease",
      status: "sent",
    });
  });
});

function connectorSync(
  id: string,
  fencingToken: number,
  leaseToken: string,
  status: "completed" | "running" = "running",
): DataConnectorSync {
  return {
    id,
    orgId,
    workspaceId,
    knowledgeBaseId,
    connectorId: "connector_lease",
    status,
    createdBy: "user_lease",
    itemCount: status === "completed" ? 1 : 0,
    sourceIds: [],
    summary: {},
    startedAt: initialAt,
    ...(status === "completed"
      ? { completedAt: "2026-08-23T12:05:01.000Z" }
      : {}),
    fencingToken,
    leaseToken,
  };
}

function knowledgeChunk(id: string, content: string) {
  return {
    id,
    knowledgeBaseId,
    sourceId: "source_lease",
    orgId,
    workspaceId,
    sequence: 0,
    content,
    tokenCount: 1,
    metadata: {},
    createdAt: "2026-08-23T12:02:01.000Z",
  };
}
