import type {
  CancelQueuedChatTurnInput,
  ClaimQueuedChatTurnInput,
  FinishQueuedChatTurnLeaseInput,
  RenewQueuedChatTurnLeaseInput,
} from "@romeo/core";
import { and, asc, eq, gt, lte, or, sql } from "drizzle-orm";
import type { RomeoDatabase } from "./client";
import { queuedChatTurns } from "./schema";
import {
  toQueuedChatTurnInsert,
  toQueuedChatTurnRecord,
  toQueuedChatTurnUpdate,
  type QueuedChatTurnRecord,
} from "./chat-repository-records";

export class PgQueuedChatTurnRepository {
  constructor(private readonly db: RomeoDatabase) {}
  async listQueuedChatTurns(chatId: string): Promise<QueuedChatTurnRecord[]> {
    const rows = await this.db
      .select()
      .from(queuedChatTurns)
      .where(eq(queuedChatTurns.chatId, chatId))
      .orderBy(asc(queuedChatTurns.createdAt), asc(queuedChatTurns.id));
    return rows.map(toQueuedChatTurnRecord);
  }

  async getQueuedChatTurn(
    turnId: string,
  ): Promise<QueuedChatTurnRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(queuedChatTurns)
      .where(eq(queuedChatTurns.id, turnId))
      .limit(1);
    return row === undefined ? undefined : toQueuedChatTurnRecord(row);
  }

  async getQueuedChatTurnByIdempotency(
    orgId: string,
    chatId: string,
    idempotencyKey: string,
  ): Promise<QueuedChatTurnRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(queuedChatTurns)
      .where(
        and(
          eq(queuedChatTurns.orgId, orgId),
          eq(queuedChatTurns.chatId, chatId),
          eq(queuedChatTurns.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toQueuedChatTurnRecord(row);
  }

  async createQueuedChatTurn(
    turn: QueuedChatTurnRecord,
  ): Promise<QueuedChatTurnRecord> {
    const [row] = await this.db
      .insert(queuedChatTurns)
      .values(toQueuedChatTurnInsert(turn))
      .onConflictDoNothing()
      .returning();
    if (row !== undefined) return toQueuedChatTurnRecord(row);
    return (
      (await this.getQueuedChatTurnByIdempotency(
        turn.orgId,
        turn.chatId,
        turn.idempotencyKey,
      )) ?? turn
    );
  }

  async claimNextQueuedChatTurn(
    input: ClaimQueuedChatTurnInput,
  ): Promise<QueuedChatTurnRecord | undefined> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.chatId}, 0))`,
      );
      const now = new Date(input.now);
      const liveLease = await transaction
        .select({ id: queuedChatTurns.id })
        .from(queuedChatTurns)
        .where(
          and(
            eq(queuedChatTurns.chatId, input.chatId),
            eq(queuedChatTurns.status, "leased"),
            gt(queuedChatTurns.leaseExpiresAt, now),
          ),
        )
        .limit(1);
      if (liveLease.length > 0) return undefined;
      const claimable = or(
        eq(queuedChatTurns.status, "queued"),
        and(
          eq(queuedChatTurns.status, "leased"),
          lte(queuedChatTurns.leaseExpiresAt, now),
        ),
      );
      const [candidate] = await transaction
        .select()
        .from(queuedChatTurns)
        .where(and(eq(queuedChatTurns.chatId, input.chatId), claimable))
        .orderBy(asc(queuedChatTurns.createdAt), asc(queuedChatTurns.id))
        .limit(1);
      if (candidate === undefined) return undefined;
      const [row] = await transaction
        .update(queuedChatTurns)
        .set({
          status: "leased",
          attemptCount: candidate.attemptCount + 1,
          leaseOwner: input.leaseOwner,
          leaseToken: input.leaseToken,
          leaseExpiresAt: new Date(input.leaseExpiresAt),
          heartbeatAt: now,
          updatedAt: now,
        })
        .where(and(eq(queuedChatTurns.id, candidate.id), claimable))
        .returning();
      return row === undefined ? undefined : toQueuedChatTurnRecord(row);
    });
  }

  async renewQueuedChatTurnLease(
    input: RenewQueuedChatTurnLeaseInput,
  ): Promise<QueuedChatTurnRecord | undefined> {
    const [row] = await this.db
      .update(queuedChatTurns)
      .set({
        leaseExpiresAt: new Date(input.leaseExpiresAt),
        heartbeatAt: new Date(input.now),
        updatedAt: new Date(input.now),
      })
      .where(
        and(
          eq(queuedChatTurns.id, input.turnId),
          eq(queuedChatTurns.status, "leased"),
          eq(queuedChatTurns.leaseOwner, input.leaseOwner),
          eq(queuedChatTurns.leaseToken, input.leaseToken),
        ),
      )
      .returning();
    return row === undefined ? undefined : toQueuedChatTurnRecord(row);
  }

  async cancelQueuedChatTurn(
    input: CancelQueuedChatTurnInput,
  ): Promise<QueuedChatTurnRecord | undefined> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.chatId}, 0))`,
      );
      const [row] = await transaction
        .update(queuedChatTurns)
        .set({
          status: "cancelled",
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          updatedAt: new Date(input.now),
          completedAt: new Date(input.now),
        })
        .where(
          and(
            eq(queuedChatTurns.id, input.turnId),
            eq(queuedChatTurns.chatId, input.chatId),
            or(
              eq(queuedChatTurns.status, "queued"),
              eq(queuedChatTurns.status, "failed"),
            ),
          ),
        )
        .returning();
      return row === undefined ? undefined : toQueuedChatTurnRecord(row);
    });
  }

  async finishQueuedChatTurnLease(
    input: FinishQueuedChatTurnLeaseInput,
  ): Promise<QueuedChatTurnRecord | undefined> {
    const terminal = input.status === "completed" || input.status === "failed";
    const [row] = await this.db
      .update(queuedChatTurns)
      .set({
        status: input.status,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        updatedAt: new Date(input.now),
        completedAt: terminal ? new Date(input.now) : null,
        lastErrorCode: input.lastErrorCode ?? null,
        lastErrorMessage: input.lastErrorMessage ?? null,
      })
      .where(
        and(
          eq(queuedChatTurns.id, input.turnId),
          eq(queuedChatTurns.status, "leased"),
          eq(queuedChatTurns.leaseOwner, input.leaseOwner),
          eq(queuedChatTurns.leaseToken, input.leaseToken),
        ),
      )
      .returning();
    return row === undefined ? undefined : toQueuedChatTurnRecord(row);
  }

  async updateQueuedChatTurn(
    turn: QueuedChatTurnRecord,
  ): Promise<QueuedChatTurnRecord> {
    const [row] = await this.db
      .update(queuedChatTurns)
      .set(toQueuedChatTurnUpdate(turn))
      .where(eq(queuedChatTurns.id, turn.id))
      .returning();
    return row === undefined ? turn : toQueuedChatTurnRecord(row);
  }
}
