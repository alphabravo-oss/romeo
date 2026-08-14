import {
  textPartForMessage,
  persistedTextPartId,
  type MessagePartBackfillBatchInput,
  type MessagePartBackfillBatchResult,
} from "@romeo/core";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  toMessagePartInsert,
  toMessagePartRecord,
  type MessagePartRecord,
} from "./chat-repository-records";
import { messageFileReferences, messageParts, messages } from "./schema";
import {
  assertMessagePartFileIdsImmutable,
  createPartsWithFileReferences,
  reconcileChatFileReferencesInPostgres,
} from "./message-file-reference-repository";

const maxStoredPositions = 10_000;

export class PgMessagePartRepository {
  constructor(protected readonly db: RomeoDatabase) {}

  async listMessageParts(messageId: string): Promise<MessagePartRecord[]> {
    const rows = await this.db
      .select()
      .from(messageParts)
      .where(eq(messageParts.messageId, messageId))
      .orderBy(partOrder(), asc(messageParts.position), asc(messageParts.id));
    return rows.map(toMessagePartRecord);
  }

  async listMessagePartsForMessages(
    messageIds: string[],
  ): Promise<MessagePartRecord[]> {
    if (messageIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(messageParts)
      .where(inArray(messageParts.messageId, messageIds))
      .orderBy(
        asc(messageParts.messageId),
        partOrder(),
        asc(messageParts.position),
        asc(messageParts.id),
      );
    return rows.map(toMessagePartRecord);
  }

  async getMessagePart(
    messagePartId: string,
  ): Promise<MessagePartRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(messageParts)
      .where(eq(messageParts.id, messagePartId))
      .limit(1);
    return row === undefined ? undefined : toMessagePartRecord(row);
  }

  async createMessageParts(
    parts: MessagePartRecord[],
  ): Promise<MessagePartRecord[]> {
    return createPartsWithFileReferences(this.db, parts);
  }

  async updateMessagePart(part: MessagePartRecord): Promise<MessagePartRecord> {
    await assertMessagePartFileIdsImmutable(this.db, part);
    const stored = toMessagePartInsert(
      part,
      "position" in part ? part.position : 0,
    );
    const [row] = await this.db
      .update(messageParts)
      .set({
        content: stored.content,
        metadata: stored.metadata,
        schemaVersion: stored.schemaVersion,
        type: stored.type,
      })
      .where(eq(messageParts.id, part.id))
      .returning();
    return row === undefined ? part : toMessagePartRecord(row);
  }

  async reconcileChatFileReferences(chatId: string, now: string) {
    return reconcileChatFileReferencesInPostgres(this.db, chatId, now);
  }

  async countMessageFileReferences(fileId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(messageFileReferences)
      .where(eq(messageFileReferences.fileId, fileId));
    return Number(row?.value ?? 0);
  }

  async backfillLegacyMessageTextParts(
    input: MessagePartBackfillBatchInput,
  ): Promise<MessagePartBackfillBatchResult> {
    assertBatchBound(input.maxMessages, 1, 500, "maxMessages");
    assertBatchBound(input.maxPartRows, 1, maxStoredPositions, "maxPartRows");
    return this.db.transaction(async (rawTransaction) => {
      const transaction = rawTransaction as unknown as RomeoDatabase;
      const candidates = await transaction
        .select({
          id: messages.id,
          content: messages.content,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.partsSchemaVersion, 0),
            sql`(SELECT COUNT(*) FROM message_parts AS candidate_parts WHERE candidate_parts.message_id = ${messages.id}) <= ${input.maxPartRows}`,
            sql`(SELECT COUNT(*) FROM message_parts AS candidate_parts WHERE candidate_parts.message_id = ${messages.id})
              + CASE WHEN ${messages.content} = '' THEN 0 ELSE 1 END <= ${maxStoredPositions}`,
          ),
        )
        .orderBy(asc(messages.id))
        .limit(input.maxMessages)
        .for("update", { skipLocked: true });
      let claimedPartRows = 0;
      let messagesCompleted = 0;
      let partsReindexed = 0;
      let textPartsCreated = 0;
      for (const candidate of candidates) {
        const partCount = await storedPartCount(transaction, candidate.id);
        const requiredRows = partCount + (candidate.content === "" ? 0 : 1);
        if (requiredRows > maxStoredPositions) continue;
        if (claimedPartRows + partCount > input.maxPartRows) continue;
        claimedPartRows += partCount;
        await reindexMessageParts(transaction, candidate.id);
        partsReindexed += partCount;
        const [existingText] = await transaction
          .select({ id: messageParts.id })
          .from(messageParts)
          .where(
            and(
              eq(messageParts.messageId, candidate.id),
              eq(messageParts.schemaVersion, 1),
              eq(messageParts.type, "text"),
            ),
          )
          .limit(1);
        const textPart = textPartForMessage({
          id: persistedTextPartId(candidate.id),
          message: {
            id: candidate.id,
            content: candidate.content,
            createdAt: candidate.createdAt.toISOString(),
          },
          position: partCount,
        });
        if (existingText === undefined && textPart !== undefined) {
          await transaction
            .insert(messageParts)
            .values(toMessagePartInsert(textPart, textPart.position));
          textPartsCreated += 1;
        }
        await transaction
          .update(messages)
          .set({ partsSchemaVersion: 1 })
          .where(eq(messages.id, candidate.id));
        messagesCompleted += 1;
      }
      const [{ value: remainingMessages = 0 } = {}] = await transaction
        .select({ value: count() })
        .from(messages)
        .where(eq(messages.partsSchemaVersion, 0));
      const [{ value: blockedMessages = 0 } = {}] = await transaction
        .select({ value: count() })
        .from(messages)
        .where(
          and(
            eq(messages.partsSchemaVersion, 0),
            sql`(SELECT COUNT(*) FROM message_parts AS blocked_parts WHERE blocked_parts.message_id = ${messages.id}) > ${input.maxPartRows}
              OR (SELECT COUNT(*) FROM message_parts AS blocked_parts WHERE blocked_parts.message_id = ${messages.id})
                + CASE WHEN ${messages.content} = '' THEN 0 ELSE 1 END > ${maxStoredPositions}`,
          ),
        );
      return {
        messagesCompleted,
        partsReindexed,
        remainingMessages: Number(remainingMessages),
        textPartsCreated,
        blockedMessages: Number(blockedMessages),
      };
    });
  }
}

async function storedPartCount(
  transaction: RomeoDatabase,
  messageId: string,
): Promise<number> {
  const [result] = await transaction
    .select({ value: count() })
    .from(messageParts)
    .where(eq(messageParts.messageId, messageId));
  return Number(result?.value ?? 0);
}

async function reindexMessageParts(
  transaction: RomeoDatabase,
  messageId: string,
): Promise<void> {
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${messageId}, 702))`,
  );
  await transaction
    .update(messageParts)
    .set({ canonicalPosition: null })
    .where(eq(messageParts.messageId, messageId));
  await transaction.execute(sql`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) - 1 AS canonical_position
      FROM message_parts
      WHERE message_id = ${messageId}
    )
    UPDATE message_parts AS part
    SET canonical_position = ranked.canonical_position,
        position = ranked.canonical_position
    FROM ranked
    WHERE part.id = ranked.id
  `);
}

function partOrder() {
  return sql`COALESCE(${messageParts.canonicalPosition}, ${messageParts.position})`;
}

function assertBatchBound(
  value: number,
  minimum: number,
  maximum: number,
  field: string,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(
      `${field} must be an integer from ${minimum} to ${maximum}.`,
    );
}
