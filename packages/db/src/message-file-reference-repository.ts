import {
  ApiError,
  fileIdsForMessagePart,
  isFileReadyForUse,
  transitionFileRetentionReconciliation,
  type FileObject,
  type MessagePart,
} from "@romeo/core";
import { and, eq, inArray } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { toFileObjectRecord, toFileObjectUpdate } from "./file-record-mapping";
import {
  chats,
  messageFileReferences,
  messageParts,
  messages,
  objectRecords,
} from "./schema";
import {
  toMessagePartInsert,
  toMessagePartRecord,
  type MessagePartRecord,
} from "./chat-repository-records";

export async function createPartsWithFileReferences(
  db: RomeoDatabase,
  parts: MessagePartRecord[],
): Promise<MessagePartRecord[]> {
  if (parts.length === 0) return [];
  return db.transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as RomeoDatabase;
    const contexts = new Map<
      string,
      { chatId: string; orgId: string; workspaceId: string }
    >();
    for (const messageId of [
      ...new Set(parts.map((part) => part.messageId)),
    ].sort()) {
      const [message] = await tx
        .select({ chatId: messages.chatId })
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      if (message === undefined)
        throw new Error("Message part parent not found.");
      const [chat] = await tx
        .select({
          id: chats.id,
          orgId: chats.orgId,
          workspaceId: chats.workspaceId,
        })
        .from(chats)
        .where(eq(chats.id, message.chatId))
        .limit(1)
        .for("update");
      if (chat === undefined) throw new Error("Message part chat not found.");
      contexts.set(messageId, {
        chatId: chat.id,
        orgId: chat.orgId,
        workspaceId: chat.workspaceId,
      });
    }
    const references = parts.flatMap((part) => {
      const context = contexts.get(part.messageId)!;
      const createdAt =
        "createdAt" in part ? part.createdAt : new Date().toISOString();
      return fileIdsForMessagePart(part).map((fileId) => ({
        messagePartId: part.id,
        messageId: part.messageId,
        fileId,
        orgId: context.orgId,
        workspaceId: context.workspaceId,
        createdAt: new Date(createdAt),
      }));
    });
    const fileIds = [
      ...new Set(references.map((reference) => reference.fileId)),
    ].sort();
    await assertReferenceFiles(tx, references, fileIds);
    const rows = await tx
      .insert(messageParts)
      .values(parts.map((part, index) => toMessagePartInsert(part, index)))
      .returning();
    if (references.length > 0)
      await tx.insert(messageFileReferences).values(references);
    await reconcileFileReferenceIds(tx, fileIds, new Date().toISOString());
    return rows.map(toMessagePartRecord);
  });
}

export async function reconcileChatFileReferencesInPostgres(
  db: RomeoDatabase,
  chatId: string,
  now: string,
): Promise<FileObject[]> {
  const [chat] = await db
    .select({ id: chats.id })
    .from(chats)
    .where(eq(chats.id, chatId))
    .limit(1)
    .for("update");
  if (chat === undefined) return [];
  const rows = await db
    .select({ fileId: messageFileReferences.fileId })
    .from(messageFileReferences)
    .innerJoin(messages, eq(messageFileReferences.messageId, messages.id))
    .where(eq(messages.chatId, chatId));
  return reconcileFileReferenceIds(
    db,
    [...new Set(rows.map((row) => row.fileId))],
    now,
  );
}

export async function referencedFileIdsForMessage(
  db: RomeoDatabase,
  messageId: string,
): Promise<string[]> {
  const rows = await db
    .select({ fileId: messageFileReferences.fileId })
    .from(messageFileReferences)
    .where(eq(messageFileReferences.messageId, messageId));
  return [...new Set(rows.map((row) => row.fileId))];
}

export async function referencedFileIdsForChat(
  db: RomeoDatabase,
  chatId: string,
): Promise<string[]> {
  const rows = await db
    .select({ fileId: messageFileReferences.fileId })
    .from(messageFileReferences)
    .innerJoin(messages, eq(messageFileReferences.messageId, messages.id))
    .where(eq(messages.chatId, chatId));
  return [...new Set(rows.map((row) => row.fileId))];
}

export async function reconcileFileReferenceIds(
  db: RomeoDatabase,
  fileIds: string[],
  now: string,
): Promise<FileObject[]> {
  const updated: FileObject[] = [];
  for (const fileId of [...new Set(fileIds)].sort()) {
    const [row] = await db
      .select()
      .from(objectRecords)
      .where(eq(objectRecords.id, fileId))
      .limit(1)
      .for("update");
    if (row === undefined || row.status === "deleted") continue;
    const references = await db
      .select({ legalHoldUntil: chats.legalHoldUntil })
      .from(messageFileReferences)
      .innerJoin(messages, eq(messageFileReferences.messageId, messages.id))
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(eq(messageFileReferences.fileId, fileId));
    const at = new Date(now);
    const held = references.some(
      (reference) =>
        reference.legalHoldUntil !== null && reference.legalHoldUntil > at,
    );
    const target = held
      ? "retained"
      : references.length > 0
        ? "attached"
        : "ready";
    const current = toFileObjectRecord(row);
    if (current.status === target) continue;
    const next = transitionFileRetentionReconciliation(current, target, now);
    if (target === "retained") next.retainedAt = now;
    else delete next.retainedAt;
    if (target === "attached") next.attachedAt ??= now;
    if (target === "ready") delete next.attachedAt;
    const [persisted] = await db
      .update(objectRecords)
      .set(toFileObjectUpdate(next))
      .where(
        and(
          eq(objectRecords.id, fileId),
          eq(objectRecords.lifecycleVersion, current.lifecycleVersion ?? 0),
        ),
      )
      .returning();
    if (persisted === undefined)
      throw new ApiError(
        "file_lifecycle_version_conflict",
        "The file lifecycle changed during reference reconciliation.",
        409,
      );
    updated.push(toFileObjectRecord(persisted));
  }
  return updated;
}

export async function assertMessagePartFileIdsImmutable(
  db: RomeoDatabase,
  part: MessagePart,
): Promise<void> {
  const [row] = await db
    .select()
    .from(messageParts)
    .where(eq(messageParts.id, part.id))
    .limit(1);
  if (row === undefined) return;
  const current = toMessagePartRecord(row);
  if (!sameIds(fileIdsForMessagePart(current), fileIdsForMessagePart(part)))
    throw new Error("Message file references are immutable.");
}

async function assertReferenceFiles(
  db: RomeoDatabase,
  references: Array<{ fileId: string; orgId: string; workspaceId: string }>,
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return;
  const rows = await db
    .select()
    .from(objectRecords)
    .where(inArray(objectRecords.id, fileIds))
    .orderBy(objectRecords.id)
    .for("update");
  const byId = new Map(rows.map((row) => [row.id, toFileObjectRecord(row)]));
  for (const reference of references) {
    const file = byId.get(reference.fileId);
    if (
      file === undefined ||
      file.orgId !== reference.orgId ||
      file.workspaceId !== reference.workspaceId ||
      !isFileReadyForUse(file)
    )
      throw new ApiError(
        "file_not_ready",
        "The referenced file is unavailable for message attachment.",
        409,
      );
  }
}

function sameIds(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}
