import { describe, expect, it } from "vitest";

import type { QueuedChatTurn } from "../domain/entities";
import { InMemoryRomeoRepository } from "./in-memory";

const baseTurn: QueuedChatTurn = {
  id: "queued_turn_1",
  orgId: "org_romeo",
  workspaceId: "workspace_default",
  chatId: "chat_1",
  agentId: "agent_1",
  content: "First prompt",
  createdBy: "user_admin",
  principalId: "user_admin",
  principalType: "user",
  scopeSnapshot: ["chats:write", "runs:create"],
  idempotencyKey: "request_1",
  status: "queued",
  attemptCount: 0,
  createdAt: "2026-07-16T12:00:00.000Z",
  updatedAt: "2026-07-16T12:00:00.000Z",
};

describe("queued chat turn repository", () => {
  it("preserves a bounded reasoning policy and old rows without one", async () => {
    const repository = new InMemoryRomeoRepository();
    const withPolicy: QueuedChatTurn = {
      ...baseTurn,
      id: "queued_turn_reasoning",
      idempotencyKey: "request_reasoning",
      reasoningPolicy: {
        schemaVersion: 1,
        mode: "auto",
        effort: "high",
      },
    };

    await repository.createQueuedChatTurn(baseTurn);
    await repository.createQueuedChatTurn(withPolicy);

    expect(await repository.getQueuedChatTurn(withPolicy.id)).toMatchObject({
      reasoningPolicy: { schemaVersion: 1, mode: "auto", effort: "high" },
    });
    expect(
      (await repository.getQueuedChatTurn(baseTurn.id))?.reasoningPolicy,
    ).toBeUndefined();
  });

  it("deduplicates creates by organization, chat, and idempotency key", async () => {
    const repository = new InMemoryRomeoRepository();
    const first = await repository.createQueuedChatTurn(baseTurn);
    const duplicate = await repository.createQueuedChatTurn({
      ...baseTurn,
      id: "queued_turn_duplicate",
      content: "Duplicate prompt",
    });

    expect(duplicate).toEqual(first);
    expect(await repository.listQueuedChatTurns(baseTurn.chatId)).toEqual([
      first,
    ]);
  });

  it("leases in creation order and blocks a second live lease for the chat", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createQueuedChatTurn(baseTurn);
    await repository.createQueuedChatTurn({
      ...baseTurn,
      id: "queued_turn_2",
      content: "Second prompt",
      idempotencyKey: "request_2",
      createdAt: "2026-07-16T12:00:01.000Z",
      updatedAt: "2026-07-16T12:00:01.000Z",
    });

    const first = await repository.claimNextQueuedChatTurn({
      chatId: baseTurn.chatId,
      leaseOwner: "worker_1",
      leaseToken: "lease_1",
      now: "2026-07-16T12:01:00.000Z",
      leaseExpiresAt: "2026-07-16T12:02:00.000Z",
    });
    const blocked = await repository.claimNextQueuedChatTurn({
      chatId: baseTurn.chatId,
      leaseOwner: "worker_2",
      leaseToken: "lease_2",
      now: "2026-07-16T12:01:30.000Z",
      leaseExpiresAt: "2026-07-16T12:02:30.000Z",
    });

    expect(first?.id).toBe(baseTurn.id);
    expect(first?.attemptCount).toBe(1);
    expect(blocked).toBeUndefined();
  });

  it("reclaims an expired lease and rejects renewal by a different worker", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createQueuedChatTurn(baseTurn);
    await repository.claimNextQueuedChatTurn({
      chatId: baseTurn.chatId,
      leaseOwner: "worker_1",
      leaseToken: "lease_1",
      now: "2026-07-16T12:01:00.000Z",
      leaseExpiresAt: "2026-07-16T12:02:00.000Z",
    });

    expect(
      await repository.renewQueuedChatTurnLease({
        turnId: baseTurn.id,
        leaseOwner: "worker_2",
        leaseToken: "lease_2",
        now: "2026-07-16T12:01:30.000Z",
        leaseExpiresAt: "2026-07-16T12:02:30.000Z",
      }),
    ).toBeUndefined();

    const reclaimed = await repository.claimNextQueuedChatTurn({
      chatId: baseTurn.chatId,
      leaseOwner: "worker_2",
      leaseToken: "lease_2",
      now: "2026-07-16T12:02:01.000Z",
      leaseExpiresAt: "2026-07-16T12:03:01.000Z",
    });
    expect(reclaimed).toMatchObject({
      id: baseTurn.id,
      attemptCount: 2,
      leaseOwner: "worker_2",
      leaseToken: "lease_2",
    });
  });

  it("cancels only queued or failed turns and never an active lease", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createQueuedChatTurn(baseTurn);
    const cancelled = await repository.cancelQueuedChatTurn({
      turnId: baseTurn.id,
      chatId: baseTurn.chatId,
      now: "2026-07-16T12:01:00.000Z",
    });
    expect(cancelled?.status).toBe("cancelled");

    const leasedTurn = {
      ...baseTurn,
      id: "queued_turn_2",
      idempotencyKey: "request_2",
    };
    await repository.createQueuedChatTurn(leasedTurn);
    await repository.claimNextQueuedChatTurn({
      chatId: baseTurn.chatId,
      leaseOwner: "worker_1",
      leaseToken: "lease_1",
      now: "2026-07-16T12:01:00.000Z",
      leaseExpiresAt: "2026-07-16T12:02:00.000Z",
    });
    expect(
      await repository.cancelQueuedChatTurn({
        turnId: leasedTurn.id,
        chatId: baseTurn.chatId,
        now: "2026-07-16T12:01:01.000Z",
      }),
    ).toBeUndefined();
    expect((await repository.getQueuedChatTurn(leasedTurn.id))?.status).toBe(
      "leased",
    );
  });

  it("allows only the lease holder to complete or release a claimed turn", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createQueuedChatTurn(baseTurn);
    await repository.claimNextQueuedChatTurn({
      chatId: baseTurn.chatId,
      leaseOwner: "worker_1",
      leaseToken: "lease_1",
      now: "2026-07-16T12:01:00.000Z",
      leaseExpiresAt: "2026-07-16T12:02:00.000Z",
    });

    expect(
      await repository.finishQueuedChatTurnLease({
        turnId: baseTurn.id,
        leaseOwner: "worker_2",
        leaseToken: "lease_2",
        status: "completed",
        now: "2026-07-16T12:01:01.000Z",
      }),
    ).toBeUndefined();
    expect((await repository.getQueuedChatTurn(baseTurn.id))?.status).toBe(
      "leased",
    );

    expect(
      await repository.finishQueuedChatTurnLease({
        turnId: baseTurn.id,
        leaseOwner: "worker_1",
        leaseToken: "lease_1",
        status: "queued",
        now: "2026-07-16T12:01:02.000Z",
        lastErrorCode: "provider_unavailable",
        lastErrorMessage: "The queued turn could not be started.",
      }),
    ).toMatchObject({
      status: "queued",
      lastErrorCode: "provider_unavailable",
      lastErrorMessage: "The queued turn could not be started.",
    });
  });
});
