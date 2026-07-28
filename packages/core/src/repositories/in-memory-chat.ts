import type * as Auth from "@romeo/auth";
import type * as Ai from "@romeo/ai-runtime";

import type * as OAuth from "../domain/delegated-oauth";
import type * as E from "../domain/entities";
import type * as R from "../domain/repository";
import {
  append,
  appendMany,
  removeById,
  replaceById,
} from "./collection-helpers";
import { InMemoryCatalogRepository } from "./in-memory-catalog";

export abstract class InMemoryChatRepository extends InMemoryCatalogRepository {
  async listEvalSuites(agentId: string): Promise<E.EvalSuite[]> {
    return this.data.evalSuites
      .filter((suite) => suite.agentId === agentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getEvalSuite(suiteId: string): Promise<E.EvalSuite | undefined> {
    return this.data.evalSuites.find((suite) => suite.id === suiteId);
  }

  async createEvalSuite(suite: E.EvalSuite): Promise<E.EvalSuite> {
    return append(this.data.evalSuites, suite);
  }

  async listEvalCases(suiteId: string): Promise<E.EvalCase[]> {
    return this.data.evalCases.filter(
      (testCase) => testCase.suiteId === suiteId,
    );
  }

  async createEvalCases(cases: E.EvalCase[]): Promise<E.EvalCase[]> {
    return appendMany(this.data.evalCases, cases);
  }

  async listEvalRuns(agentId: string): Promise<E.EvalRun[]> {
    return this.data.evalRuns
      .filter((run) => run.agentId === agentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getEvalRun(runId: string): Promise<E.EvalRun | undefined> {
    return this.data.evalRuns.find((run) => run.id === runId);
  }

  async createEvalRun(run: E.EvalRun): Promise<E.EvalRun> {
    return append(this.data.evalRuns, run);
  }

  async getEvalRunResult(
    resultId: string,
  ): Promise<E.EvalRunResult | undefined> {
    return this.data.evalRunResults.find((result) => result.id === resultId);
  }

  async listEvalRunResults(runId: string): Promise<E.EvalRunResult[]> {
    return this.data.evalRunResults.filter((result) => result.runId === runId);
  }

  async createEvalRunResults(
    results: E.EvalRunResult[],
  ): Promise<E.EvalRunResult[]> {
    return appendMany(this.data.evalRunResults, results);
  }

  async listEvalResultHumanRatings(
    runId: string,
  ): Promise<E.EvalResultHumanRating[]> {
    return this.data.evalResultHumanRatings
      .filter((rating) => rating.runId === runId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getEvalResultHumanRating(
    resultId: string,
    reviewerId: string,
  ): Promise<E.EvalResultHumanRating | undefined> {
    return this.data.evalResultHumanRatings.find(
      (rating) =>
        rating.resultId === resultId && rating.reviewerId === reviewerId,
    );
  }

  async upsertEvalResultHumanRating(
    rating: E.EvalResultHumanRating,
  ): Promise<E.EvalResultHumanRating> {
    const index = this.data.evalResultHumanRatings.findIndex(
      (item) =>
        item.resultId === rating.resultId &&
        item.reviewerId === rating.reviewerId,
    );
    if (index >= 0) this.data.evalResultHumanRatings[index] = rating;
    else this.data.evalResultHumanRatings.push(rating);
    return rating;
  }

  async listChats(workspaceId: string): Promise<E.Chat[]> {
    return this.data.chats
      .filter((chat) => chat.workspaceId === workspaceId)
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.id.localeCompare(right.id),
      );
  }

  async listAuthorizedChatsPage(
    input: R.AuthorizedChatCatalogQuery,
  ): Promise<{ items: E.Chat[]; total: number }> {
    const visible = this.data.chats
      .filter(
        (chat) =>
          chat.orgId === input.orgId && chat.workspaceId === input.workspaceId,
      )
      .filter(
        (chat) => chat.expiresAt === undefined || chat.expiresAt > input.now,
      )
      .filter((chat) => {
        if (input.archived === "all") return true;
        if (input.archived === "archived") return chat.archivedAt !== undefined;
        return chat.archivedAt === undefined;
      })
      .filter(
        (chat) =>
          input.isAdmin ||
          chat.createdBy === input.principalId ||
          this.data.grants.some(
            (grant) =>
              grant.resourceType === "chat" &&
              grant.resourceId === chat.id &&
              (grant.permission === "read" || grant.permission === "write") &&
              ((grant.principalType === input.principalType &&
                grant.principalId === input.principalId) ||
                (grant.principalType === "group" &&
                  input.groupIds.includes(grant.principalId))),
          ),
      )
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.id.localeCompare(right.id),
      );
    return {
      items: visible.slice(input.offset, input.offset + input.limit),
      total: visible.length,
    };
  }

  async createChat(chat: E.Chat): Promise<E.Chat> {
    return append(this.data.chats, chat);
  }

  async updateChat(chat: E.Chat): Promise<E.Chat> {
    return replaceById(this.data.chats, chat);
  }

  async getChat(chatId: string): Promise<E.Chat | undefined> {
    return this.data.chats.find((chat) => chat.id === chatId);
  }

  async listQueuedChatTurns(chatId: string): Promise<E.QueuedChatTurn[]> {
    return this.data.queuedChatTurns
      .filter((turn) => turn.chatId === chatId)
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
  }

  async getQueuedChatTurn(
    turnId: string,
  ): Promise<E.QueuedChatTurn | undefined> {
    return this.data.queuedChatTurns.find((turn) => turn.id === turnId);
  }

  async getQueuedChatTurnByIdempotency(
    orgId: string,
    chatId: string,
    idempotencyKey: string,
  ): Promise<E.QueuedChatTurn | undefined> {
    return this.data.queuedChatTurns.find(
      (turn) =>
        turn.orgId === orgId &&
        turn.chatId === chatId &&
        turn.idempotencyKey === idempotencyKey,
    );
  }

  async createQueuedChatTurn(
    turn: E.QueuedChatTurn,
  ): Promise<E.QueuedChatTurn> {
    const existing = await this.getQueuedChatTurnByIdempotency(
      turn.orgId,
      turn.chatId,
      turn.idempotencyKey,
    );
    return existing ?? append(this.data.queuedChatTurns, turn);
  }

  async claimNextQueuedChatTurn(
    input: R.ClaimQueuedChatTurnInput,
  ): Promise<E.QueuedChatTurn | undefined> {
    const nowMs = Date.parse(input.now);
    if (
      this.data.queuedChatTurns.some(
        (turn) =>
          turn.chatId === input.chatId &&
          turn.status === "leased" &&
          turn.leaseExpiresAt !== undefined &&
          Date.parse(turn.leaseExpiresAt) > nowMs,
      )
    ) {
      return undefined;
    }
    const candidate = this.data.queuedChatTurns
      .filter(
        (turn) =>
          turn.chatId === input.chatId &&
          (turn.status === "queued" ||
            (turn.status === "leased" &&
              turn.leaseExpiresAt !== undefined &&
              Date.parse(turn.leaseExpiresAt) <= nowMs)),
      )
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      )[0];
    if (candidate === undefined) return undefined;
    return replaceById(this.data.queuedChatTurns, {
      ...candidate,
      status: "leased",
      attemptCount: candidate.attemptCount + 1,
      leaseOwner: input.leaseOwner,
      leaseToken: input.leaseToken,
      leaseExpiresAt: input.leaseExpiresAt,
      heartbeatAt: input.now,
      updatedAt: input.now,
    });
  }

  async renewQueuedChatTurnLease(
    input: R.RenewQueuedChatTurnLeaseInput,
  ): Promise<E.QueuedChatTurn | undefined> {
    const turn = this.data.queuedChatTurns.find(
      (item) =>
        item.id === input.turnId &&
        item.status === "leased" &&
        item.leaseOwner === input.leaseOwner &&
        item.leaseToken === input.leaseToken,
    );
    if (turn === undefined) return undefined;
    return replaceById(this.data.queuedChatTurns, {
      ...turn,
      leaseExpiresAt: input.leaseExpiresAt,
      heartbeatAt: input.now,
      updatedAt: input.now,
    });
  }

  async cancelQueuedChatTurn(
    input: R.CancelQueuedChatTurnInput,
  ): Promise<E.QueuedChatTurn | undefined> {
    const turn = this.data.queuedChatTurns.find(
      (item) =>
        item.id === input.turnId &&
        item.chatId === input.chatId &&
        (item.status === "queued" || item.status === "failed"),
    );
    if (turn === undefined) return undefined;
    const {
      leaseOwner: _leaseOwner,
      leaseToken: _leaseToken,
      leaseExpiresAt: _leaseExpiresAt,
      heartbeatAt: _heartbeatAt,
      ...unleasedTurn
    } = turn;
    return replaceById(this.data.queuedChatTurns, {
      ...unleasedTurn,
      status: "cancelled",
      updatedAt: input.now,
      completedAt: input.now,
    });
  }

  async finishQueuedChatTurnLease(
    input: R.FinishQueuedChatTurnLeaseInput,
  ): Promise<E.QueuedChatTurn | undefined> {
    const turn = this.data.queuedChatTurns.find(
      (item) =>
        item.id === input.turnId &&
        item.status === "leased" &&
        item.leaseOwner === input.leaseOwner &&
        item.leaseToken === input.leaseToken,
    );
    if (turn === undefined) return undefined;
    const {
      leaseOwner: _leaseOwner,
      leaseToken: _leaseToken,
      leaseExpiresAt: _leaseExpiresAt,
      heartbeatAt: _heartbeatAt,
      lastErrorCode: _lastErrorCode,
      lastErrorMessage: _lastErrorMessage,
      completedAt: _completedAt,
      ...releasedTurn
    } = turn;
    return replaceById(this.data.queuedChatTurns, {
      ...releasedTurn,
      status: input.status,
      updatedAt: input.now,
      ...(input.status === "failed" || input.status === "completed"
        ? { completedAt: input.now }
        : {}),
      ...(input.lastErrorCode === undefined
        ? {}
        : { lastErrorCode: input.lastErrorCode }),
      ...(input.lastErrorMessage === undefined
        ? {}
        : { lastErrorMessage: input.lastErrorMessage }),
    });
  }

  async updateQueuedChatTurn(
    turn: E.QueuedChatTurn,
  ): Promise<E.QueuedChatTurn> {
    return replaceById(this.data.queuedChatTurns, turn);
  }
}
