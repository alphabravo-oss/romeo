import type {
  ClaimIdempotencyReceiptInput,
  ClaimIdempotencyReceiptResult,
  CompleteIdempotencyReceiptInput,
  FailIdempotencyReceiptInput,
  IdempotencyReceipt,
} from "@romeo/core";
import { and, asc, eq, isNull, lt, lte, ne, or, sql } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { idempotencyReceipts } from "./schema";

export class PgIdempotencyRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async claimIdempotencyReceipt(
    input: ClaimIdempotencyReceiptInput,
  ): Promise<ClaimIdempotencyReceiptResult> {
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as RomeoDatabase;
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${receiptScope(input.receipt)}, 0))`,
      );
      const [row] = await db
        .select()
        .from(idempotencyReceipts)
        .where(scopePredicate(input.receipt))
        .limit(1);
      if (row === undefined) {
        const [inserted] = await db
          .insert(idempotencyReceipts)
          .values(toInsert(input.receipt))
          .returning();
        if (inserted === undefined)
          throw new Error("Idempotency receipt insert returned no record.");
        return { outcome: "owner", receipt: toReceipt(inserted) };
      }
      const current = toReceipt(row);
      if (current.requestHash !== input.receipt.requestHash)
        return { outcome: "conflict", receipt: current };
      if (current.state === "completed")
        return { outcome: "replay", receipt: current };
      if (current.state === "failed")
        return { outcome: "failed", receipt: current };
      if (
        current.leaseExpiresAt !== undefined &&
        current.leaseExpiresAt > input.now
      )
        return { outcome: "in_progress", receipt: current };
      const [claimed] = await db
        .update(idempotencyReceipts)
        .set({
          leaseToken: input.receipt.leaseToken,
          leaseExpiresAt: asDate(input.receipt.leaseExpiresAt),
          expiresAt: new Date(input.receipt.expiresAt),
          updatedAt: new Date(input.now),
        })
        .where(eq(idempotencyReceipts.id, row.id))
        .returning();
      if (claimed === undefined)
        throw new Error("Idempotency receipt takeover returned no record.");
      return { outcome: "owner", receipt: toReceipt(claimed) };
    });
  }

  completeIdempotencyReceipt(
    input: CompleteIdempotencyReceiptInput,
  ): Promise<IdempotencyReceipt | undefined> {
    return this.finish(input, {
      state: "completed",
      responseStatus: input.responseStatus,
      responseBody: input.responseBody,
      errorCode: null,
    });
  }

  failIdempotencyReceipt(
    input: FailIdempotencyReceiptInput,
  ): Promise<IdempotencyReceipt | undefined> {
    return this.finish(input, {
      state: "failed",
      responseStatus: null,
      responseBody: null,
      errorCode: input.errorCode,
    });
  }

  async deleteExpiredIdempotencyReceipts(input: {
    before: string;
    limit: number;
  }): Promise<number> {
    if (input.limit <= 0) return 0;
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as RomeoDatabase;
      const rows = await db
        .select({ id: idempotencyReceipts.id })
        .from(idempotencyReceipts)
        .where(
          and(
            lt(idempotencyReceipts.expiresAt, new Date(input.before)),
            or(
              ne(idempotencyReceipts.state, "in_progress"),
              isNull(idempotencyReceipts.leaseExpiresAt),
              lte(idempotencyReceipts.leaseExpiresAt, new Date(input.before)),
            ),
          ),
        )
        .orderBy(
          asc(idempotencyReceipts.expiresAt),
          asc(idempotencyReceipts.id),
        )
        .limit(input.limit)
        .for("update", { skipLocked: true });
      if (rows.length === 0) return 0;
      const deleted = await Promise.all(
        rows.map(({ id }) =>
          db
            .delete(idempotencyReceipts)
            .where(eq(idempotencyReceipts.id, id))
            .returning({ id: idempotencyReceipts.id }),
        ),
      );
      return deleted.reduce((count, row) => count + row.length, 0);
    });
  }

  private async finish(
    input: { id: string; orgId: string; leaseToken: string; now: string },
    update: {
      state: "completed" | "failed";
      responseStatus: number | null;
      responseBody: unknown;
      errorCode: string | null;
    },
  ): Promise<IdempotencyReceipt | undefined> {
    const [row] = await this.db
      .update(idempotencyReceipts)
      .set({
        ...update,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(input.now),
      })
      .where(
        and(
          eq(idempotencyReceipts.id, input.id),
          eq(idempotencyReceipts.orgId, input.orgId),
          eq(idempotencyReceipts.state, "in_progress"),
          eq(idempotencyReceipts.leaseToken, input.leaseToken),
        ),
      )
      .returning();
    return row === undefined ? undefined : toReceipt(row);
  }
}

function scopePredicate(receipt: IdempotencyReceipt) {
  return and(
    eq(idempotencyReceipts.orgId, receipt.orgId),
    eq(idempotencyReceipts.actorType, receipt.actorType),
    eq(idempotencyReceipts.actorId, receipt.actorId),
    eq(idempotencyReceipts.credentialHash, receipt.credentialHash),
    eq(idempotencyReceipts.operation, receipt.operation),
    eq(idempotencyReceipts.keyHash, receipt.keyHash),
  );
}

function receiptScope(receipt: IdempotencyReceipt): string {
  return [
    receipt.orgId,
    receipt.actorType,
    receipt.actorId,
    receipt.credentialHash,
    receipt.operation,
    receipt.keyHash,
  ].join("\u001f");
}

function toInsert(
  receipt: IdempotencyReceipt,
): typeof idempotencyReceipts.$inferInsert {
  return {
    ...receipt,
    leaseExpiresAt: asDate(receipt.leaseExpiresAt),
    createdAt: new Date(receipt.createdAt),
    updatedAt: new Date(receipt.updatedAt),
    expiresAt: new Date(receipt.expiresAt),
  };
}

function asDate(value: string | undefined): Date | null {
  return value === undefined ? null : new Date(value);
}

export function toReceipt(
  row: typeof idempotencyReceipts.$inferSelect,
): IdempotencyReceipt {
  return {
    id: row.id,
    orgId: row.orgId,
    actorType: row.actorType as IdempotencyReceipt["actorType"],
    actorId: row.actorId,
    credentialHash: row.credentialHash,
    operation: row.operation,
    keyHash: row.keyHash,
    requestHash: row.requestHash,
    state: row.state as IdempotencyReceipt["state"],
    ...(row.leaseToken === null ? {} : { leaseToken: row.leaseToken }),
    ...(row.leaseExpiresAt === null
      ? {}
      : { leaseExpiresAt: row.leaseExpiresAt.toISOString() }),
    ...(row.responseStatus === null
      ? {}
      : { responseStatus: row.responseStatus }),
    ...(row.responseBody === null ? {} : { responseBody: row.responseBody }),
    ...(row.errorCode === null ? {} : { errorCode: row.errorCode }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}
