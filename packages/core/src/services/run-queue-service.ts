import type { AuthSubject, Scope } from "@romeo/auth";

import type {
  QueuedChatTurn as PersistedQueuedChatTurn,
  RunRecord,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { enforceContentPolicyText } from "./content-policy-service";
import { getAuthorizedChat } from "./chat-access";
import { publicQueuedTurn, type QueuedChatTurn } from "./run-command-service";
import { isTerminalRunStatus } from "./run-recovery-service";
import type { StartRunInput } from "./run-service-contracts";
import { recordUsage } from "./record-usage";
import { persistedSubjectActorId } from "./subject-persisted-actor";

interface SubjectSnapshot {
  orgId: string;
  workspaceId: string;
  principalId: string;
  principalType: "user" | "service_account";
  scopeSnapshot: Scope[];
}

export class RunQueueService {
  private readonly drainingChats = new Set<string>();
  private readonly workerId = createId("queue_worker");

  constructor(
    private readonly repository: RomeoRepository,
    private readonly recoverStaleRun: (chatId: string) => Promise<void>,
    private readonly startRun: (input: StartRunInput) => Promise<RunRecord>,
    private readonly subjectFromSnapshot: (
      input: SubjectSnapshot,
    ) => Promise<AuthSubject>,
  ) {}

  async activeForChat(
    chatId: string,
    subject: AuthSubject,
  ): Promise<RunRecord | undefined> {
    await getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
    await this.recoverStaleRun(chatId);
    return (await this.repository.listRuns(chatId)).find(
      (run) => !isTerminalRunStatus(run.status),
    );
  }

  async queuedForChat(
    chatId: string,
    subject: AuthSubject,
  ): Promise<QueuedChatTurn[]> {
    await getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
    await this.recoverStaleRun(chatId);
    void this.drain(chatId);
    return (await this.repository.listQueuedChatTurns(chatId))
      .filter(
        (turn) =>
          turn.status === "queued" ||
          turn.status === "leased" ||
          turn.status === "failed",
      )
      .map(publicQueuedTurn);
  }

  async enqueue(
    input: Omit<
      StartRunInput,
      "attachments" | "fileIds" | "historyBoundaryMessageId"
    > & { idempotencyKey?: string },
  ): Promise<QueuedChatTurn> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:write",
      permission: "write",
    });
    const governedPrompt = await enforceContentPolicyText(
      this.repository,
      input.subject,
      input.content,
    );
    if (typeof input.parentMessageId === "string") {
      const parent = await this.repository.getMessage(input.parentMessageId);
      if (parent === undefined || parent.chatId !== chat.id)
        throw notFound("Message");
    }
    const createdBy = await persistedSubjectActorId(
      this.repository,
      input.subject,
      { kind: "queued_chat_turn", name: "Queued chat turn actor" },
    );
    const now = new Date().toISOString();
    const turn: PersistedQueuedChatTurn = {
      id: createId("queued_turn"),
      orgId: chat.orgId,
      workspaceId: chat.workspaceId,
      chatId: input.chatId,
      agentId: input.agentId,
      content: governedPrompt.content,
      createdBy,
      principalId: input.subject.id,
      principalType: input.subject.type,
      scopeSnapshot: [...input.subject.scopes],
      idempotencyKey: input.idempotencyKey ?? createId("queue_request"),
      status: "queued",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
      ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
      ...(input.routingMode === "economy" ? { routingMode: "economy" } : {}),
      ...(input.researchMode === "deep" ? { researchMode: "deep" } : {}),
      ...(input.reasoningPolicy === undefined
        ? {}
        : { reasoningPolicy: input.reasoningPolicy }),
      ...(input.parentMessageId === undefined
        ? {}
        : { parentMessageId: input.parentMessageId }),
      ...(input.webSearch === undefined ? {} : { webSearch: input.webSearch }),
      ...(input.agenticRag === undefined
        ? {}
        : { agenticRag: input.agenticRag }),
      ...(input.urls === undefined ? {} : { urls: input.urls }),
    };
    const created = await this.repository.transaction(async (repository) => {
      const existing = await repository.getQueuedChatTurnByIdempotency(
        turn.orgId,
        turn.chatId,
        turn.idempotencyKey,
      );
      if (existing !== undefined) {
        assertSameReasoningPolicy(existing, turn);
        return existing;
      }
      const current = (
        await repository.listQueuedChatTurns(input.chatId)
      ).filter((item) => item.status === "queued" || item.status === "leased");
      if (current.length >= 20)
        throw new ApiError(
          "chat_queue_full",
          "A chat can queue at most 20 turns.",
          409,
        );
      const stored = await repository.createQueuedChatTurn(turn);
      assertSameReasoningPolicy(stored, turn);
      return stored;
    });
    void this.drain(input.chatId);
    return publicQueuedTurn(created);
  }

  async cancel(
    chatId: string,
    turnId: string,
    subject: AuthSubject,
  ): Promise<QueuedChatTurn> {
    await getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:write",
      permission: "write",
    });
    const turn = await this.repository.getQueuedChatTurn(turnId);
    if (turn === undefined || turn.chatId !== chatId)
      throw notFound("Queued turn");
    if (turn.status === "leased")
      throw new ApiError(
        "queued_turn_already_leased",
        "The queued turn is already starting and can no longer be cancelled.",
        409,
      );
    if (turn.status !== "queued" && turn.status !== "failed")
      return publicQueuedTurn(turn);
    const cancelled = await this.repository.cancelQueuedChatTurn({
      turnId,
      chatId,
      now: new Date().toISOString(),
    });
    if (cancelled !== undefined) return publicQueuedTurn(cancelled);
    const current = await this.repository.getQueuedChatTurn(turnId);
    if (current?.status === "leased")
      throw new ApiError(
        "queued_turn_already_leased",
        "The queued turn is already starting and can no longer be cancelled.",
        409,
      );
    return publicQueuedTurn(current ?? turn);
  }

  async drain(chatId: string): Promise<void> {
    if (this.drainingChats.has(chatId)) return;
    this.drainingChats.add(chatId);
    try {
      if (
        (await this.repository.listRuns(chatId)).some(
          (run) => !isTerminalRunStatus(run.status),
        )
      )
        return;
      const now = new Date();
      const leaseToken = createId("queue_lease");
      const next = await this.repository.claimNextQueuedChatTurn({
        chatId,
        leaseOwner: this.workerId,
        leaseToken,
        now: now.toISOString(),
        leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
      });
      if (next === undefined) return;
      const heartbeat = setInterval(() => {
        const heartbeatAt = new Date();
        void this.repository.renewQueuedChatTurnLease({
          turnId: next.id,
          leaseOwner: this.workerId,
          leaseToken,
          now: heartbeatAt.toISOString(),
          leaseExpiresAt: new Date(
            heartbeatAt.getTime() + 60_000,
          ).toISOString(),
        });
      }, 20_000);
      heartbeat.unref?.();
      try {
        const subject = await this.subjectFromSnapshot({
          orgId: next.orgId,
          workspaceId: next.workspaceId,
          principalId: next.principalId,
          principalType: next.principalType,
          scopeSnapshot: next.scopeSnapshot,
        });
        const startedRun = await this.startRun({
          subject,
          chatId,
          agentId: next.agentId,
          content: next.content,
          ...(next.modelId === undefined ? {} : { modelId: next.modelId }),
          ...(next.routingMode === undefined
            ? {}
            : { routingMode: next.routingMode }),
          ...(next.researchMode === undefined
            ? {}
            : { researchMode: next.researchMode }),
          ...(next.reasoningPolicy === undefined
            ? {}
            : { reasoningPolicy: next.reasoningPolicy }),
          ...(next.parentMessageId === undefined
            ? {}
            : { parentMessageId: next.parentMessageId }),
          ...(next.webSearch === undefined
            ? {}
            : { webSearch: next.webSearch }),
          ...(next.agenticRag === undefined
            ? {}
            : { agenticRag: next.agenticRag }),
          ...(next.urls === undefined ? {} : { urls: next.urls }),
        });
        await recordUsage(this.repository, {
          orgId: startedRun.orgId,
          workspaceId: startedRun.workspaceId,
          actorId: startedRun.createdBy,
          sourceType: "run",
          sourceId: startedRun.id,
          metric: "queue.wait",
          quantity: Math.max(
            0,
            Date.parse(startedRun.createdAt) - Date.parse(next.createdAt),
          ),
          unit: "millisecond",
          metadata: {
            chatId: startedRun.chatId,
            queuedTurnId: next.id,
            attemptCount: next.attemptCount,
          },
        });
        await this.repository.finishQueuedChatTurnLease({
          turnId: next.id,
          leaseOwner: this.workerId,
          leaseToken,
          status: "completed",
          now: new Date().toISOString(),
        });
      } catch (error) {
        await this.repository.finishQueuedChatTurnLease({
          turnId: next.id,
          leaseOwner: this.workerId,
          leaseToken,
          status: next.attemptCount >= 3 ? "failed" : "queued",
          now: new Date().toISOString(),
          lastErrorCode:
            error instanceof ApiError ? error.code : "queued_turn_start_failed",
          lastErrorMessage: "The queued turn could not be started.",
        });
      } finally {
        clearInterval(heartbeat);
      }
    } finally {
      this.drainingChats.delete(chatId);
    }
  }
}

function assertSameReasoningPolicy(
  left: PersistedQueuedChatTurn,
  right: PersistedQueuedChatTurn,
): void {
  if (policyKey(left.reasoningPolicy) === policyKey(right.reasoningPolicy))
    return;
  throw new ApiError(
    "idempotency_key_conflict",
    "The idempotency key was already used for a different request.",
    409,
  );
}

function policyKey(policy: PersistedQueuedChatTurn["reasoningPolicy"]): string {
  if (policy === undefined) return "absent";
  if (policy.mode === "off") return "1|off";
  return [
    "1",
    policy.mode,
    policy.effort ?? "",
    policy.maxReasoningTokens ?? "",
    policy.mode === "summary" ? (policy.summaryDetail ?? "") : "",
    policy.mode === "summary" ? String(policy.retainSummary) : "",
  ].join("|");
}
