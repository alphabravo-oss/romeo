import { seededSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import type { QueuedChatTurn, RunRecord } from "../domain/entities";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { RunQueueService } from "./run-queue-service";
import type { StartRunInput } from "./run-service-contracts";

describe("queued run reasoning policy", () => {
  it("reconstructs the validated policy when a durable worker starts the run", async () => {
    const repository = new InMemoryRomeoRepository();
    const turn: QueuedChatTurn = {
      id: "queued_turn_reasoning_worker",
      orgId: seededSubject.orgId,
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      content: "Use the queued reasoning request.",
      reasoningPolicy: {
        schemaVersion: 1,
        mode: "auto",
        effort: "high",
      },
      createdBy: seededSubject.id,
      principalId: seededSubject.id,
      principalType: seededSubject.type,
      scopeSnapshot: [...seededSubject.scopes],
      idempotencyKey: "queued-reasoning-worker",
      status: "queued",
      attemptCount: 0,
      createdAt: "2026-08-14T12:00:00.000Z",
      updatedAt: "2026-08-14T12:00:00.000Z",
    };
    await repository.createQueuedChatTurn(turn);
    let startedInput: StartRunInput | undefined;
    const runQueue = new RunQueueService(
      repository,
      async () => {},
      async (input) => {
        startedInput = input;
        return startedRun;
      },
      async () => seededSubject,
    );

    await runQueue.drain(turn.chatId);

    expect(startedInput?.reasoningPolicy).toEqual(turn.reasoningPolicy);
    expect(await repository.getQueuedChatTurn(turn.id)).toMatchObject({
      status: "completed",
      reasoningPolicy: turn.reasoningPolicy,
    });
  });
});

const startedRun: RunRecord = {
  id: "run_queued_reasoning_worker",
  orgId: seededSubject.orgId,
  workspaceId: "workspace_default",
  chatId: "chat_welcome",
  agentId: "agent_default",
  agentVersionId: "agent_version_default_v1",
  modelId: "model_openai_compatible_default",
  providerId: "provider_openai_compatible",
  status: "running",
  createdBy: seededSubject.id,
  createdAt: "2026-08-14T12:00:01.000Z",
};
