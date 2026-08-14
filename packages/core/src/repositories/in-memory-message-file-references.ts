import type {
  FileObject,
  MessageFileReference,
  MessagePart,
} from "../domain/entities";
import { ApiError } from "../errors";
import {
  isFileReadyForUse,
  transitionFileRetentionReconciliation,
} from "../services/file-lifecycle";
import { fileIdsForMessagePart } from "../services/message-part-v1";
import type { SeedData } from "./seed-data";
import {
  appendValidatedMessageParts,
  updateValidatedMessagePart,
} from "./in-memory-message-parts";

export function createMessagePartsWithFileReferences(
  data: SeedData,
  parts: MessagePart[],
): MessagePart[] {
  const references = validateMessageFileReferences(data, parts);
  const created = appendValidatedMessageParts(data, parts);
  persistMessageFileReferences(data, references);
  return created;
}

export function updateMessagePartWithImmutableReferences(
  data: SeedData,
  part: MessagePart,
): MessagePart {
  const current = data.messageParts.find((item) => item.id === part.id);
  if (current !== undefined) {
    const before = validateMessageFileReferences(data, [current]);
    const after = validateMessageFileReferences(data, [part]);
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error("Message file references are immutable.");
  }
  return updateValidatedMessagePart(data, part);
}

export function countMessageFileReferencesInMemory(
  data: SeedData,
  fileId: string,
): number {
  return data.messageFileReferences.filter(
    (reference) => reference.fileId === fileId,
  ).length;
}

export function validateMessageFileReferences(
  data: SeedData,
  parts: MessagePart[],
): MessageFileReference[] {
  const references: MessageFileReference[] = [];
  for (const part of parts) {
    const message = data.messages.find(
      (candidate) => candidate.id === part.messageId,
    );
    if (message === undefined)
      throw new Error("Message part parent not found.");
    const chat = data.chats.find(
      (candidate) => candidate.id === message.chatId,
    );
    if (chat === undefined) throw new Error("Message part chat not found.");
    for (const fileId of fileIdsForMessagePart(part)) {
      const file = data.fileObjects.find(
        (candidate) => candidate.id === fileId,
      );
      if (
        file === undefined ||
        file.orgId !== chat.orgId ||
        file.workspaceId !== chat.workspaceId ||
        !isFileReadyForUse(file)
      )
        throw invalidFileReference();
      references.push({
        messagePartId: part.id,
        messageId: message.id,
        fileId,
        orgId: chat.orgId,
        workspaceId: chat.workspaceId,
        createdAt: "createdAt" in part ? part.createdAt : message.createdAt,
      });
    }
  }
  return references;
}

export function persistMessageFileReferences(
  data: SeedData,
  references: MessageFileReference[],
  now = new Date().toISOString(),
): void {
  const keys = new Set(data.messageFileReferences.map(referenceKey));
  for (const reference of references) {
    const key = referenceKey(reference);
    if (keys.has(key))
      throw new Error("Message file reference already exists.");
    keys.add(key);
  }
  data.messageFileReferences.push(...references);
  reconcileFileReferencesInMemory(
    data,
    [...new Set(references.map((reference) => reference.fileId))],
    now,
  );
}

export function removeMessageFileReferences(
  data: SeedData,
  messageId: string,
  now = new Date().toISOString(),
): void {
  const removedFileIds = data.messageFileReferences
    .filter((reference) => reference.messageId === messageId)
    .map((reference) => reference.fileId);
  data.messageFileReferences = data.messageFileReferences.filter(
    (reference) => reference.messageId !== messageId,
  );
  reconcileFileReferencesInMemory(data, [...new Set(removedFileIds)], now);
}

export function reconcileChatFileReferencesInMemory(
  data: SeedData,
  chatId: string,
  now: string,
): FileObject[] {
  const messageIds = new Set(
    data.messages
      .filter((message) => message.chatId === chatId)
      .map((message) => message.id),
  );
  const fileIds = [
    ...new Set(
      data.messageFileReferences
        .filter((reference) => messageIds.has(reference.messageId))
        .map((reference) => reference.fileId),
    ),
  ];
  return reconcileFileReferencesInMemory(data, fileIds, now);
}

export function reconcileFileReferencesInMemory(
  data: SeedData,
  fileIds: string[],
  now: string,
): FileObject[] {
  const updated: FileObject[] = [];
  for (const fileId of [...fileIds].sort()) {
    const index = data.fileObjects.findIndex((file) => file.id === fileId);
    if (index < 0) continue;
    const current = data.fileObjects[index]!;
    if (current.status === "deleted") continue;
    const references = data.messageFileReferences.filter(
      (reference) => reference.fileId === fileId,
    );
    const held = references.some((reference) => {
      const message = data.messages.find(
        (candidate) => candidate.id === reference.messageId,
      );
      const chat = data.chats.find(
        (candidate) => candidate.id === message?.chatId,
      );
      return chat?.legalHoldUntil !== undefined && chat.legalHoldUntil > now;
    });
    const target = held
      ? "retained"
      : references.length > 0
        ? "attached"
        : "ready";
    if (current.status === target) continue;
    const next = transitionFileRetentionReconciliation(current, target, now);
    if (target === "retained") next.retainedAt = now;
    else delete next.retainedAt;
    if (target === "attached") next.attachedAt ??= now;
    if (target === "ready") delete next.attachedAt;
    data.fileObjects[index] = next;
    updated.push(next);
  }
  return updated;
}

function referenceKey(
  reference: Pick<MessageFileReference, "fileId" | "messagePartId">,
) {
  return `${reference.messagePartId}\u0000${reference.fileId}`;
}

function invalidFileReference(): ApiError {
  return new ApiError(
    "file_not_ready",
    "The referenced file is unavailable for message attachment.",
    409,
  );
}
