import type * as E from "../domain/entities";
import type {
  MessagePartBackfillBatchInput,
  MessagePartBackfillBatchResult,
} from "../domain/repository-content";
import {
  isMessagePartV1,
  parseMessagePartV1,
  persistedTextPartId,
  textPartForMessage,
} from "../services/message-part-v1";
import type { SeedData } from "./seed-data";

const maximumPartPositions = 10_000;

export function createMessageWithTextPart(
  data: SeedData,
  message: E.Message,
): E.Message {
  if (data.messages.some((item) => item.id === message.id))
    throw new Error(`Duplicate id: ${message.id}`);
  const textPart = textPartForMessage({
    id: persistedTextPartId(message.id),
    message,
    position: 0,
  });
  if (
    textPart !== undefined &&
    data.messageParts.some((part) => part.id === textPart.id)
  )
    throw new Error(`Duplicate id: ${textPart.id}`);
  data.messages.push(message);
  if (textPart !== undefined) data.messageParts.push(textPart);
  data.messagePartSchemaVersions[message.id] = 1;
  return message;
}

export function orderedMessageParts(parts: E.MessagePart[]): E.MessagePart[] {
  return parts
    .map(validatePart)
    .map((part, index) => ({
      index,
      part,
      position: isMessagePartV1(part) ? part.position : index,
    }))
    .sort(
      (left, right) =>
        left.position - right.position || left.index - right.index,
    )
    .map(({ part }) => part);
}

export function listOrderedMessagePartsForMessages(
  data: SeedData,
  messageIds: string[],
): E.MessagePart[] {
  const requested = new Set(messageIds);
  return Array.from(requested)
    .sort()
    .flatMap((messageId) =>
      orderedMessageParts(
        data.messageParts.filter((part) => part.messageId === messageId),
      ),
    );
}

export function findOrderedMessagePart(
  data: SeedData,
  messagePartId: string,
): E.MessagePart | undefined {
  const part = data.messageParts.find((item) => item.id === messagePartId);
  return part === undefined ? undefined : orderedMessageParts([part])[0];
}

export function appendValidatedMessageParts(
  data: SeedData,
  parts: E.MessagePart[],
): E.MessagePart[] {
  const validated = parts.map(validatePart);
  const ids = new Set(data.messageParts.map((part) => part.id));
  const positions = typedPositions(data.messageParts);
  for (const part of validated) {
    if (ids.has(part.id)) throw new Error(`Duplicate id: ${part.id}`);
    ids.add(part.id);
    assertPositionAvailable(positions, part);
  }
  data.messageParts.push(...validated);
  return validated;
}

export function updateValidatedMessagePart(
  data: SeedData,
  part: E.MessagePart,
): E.MessagePart {
  const validated = validatePart(part);
  const index = data.messageParts.findIndex((item) => item.id === part.id);
  const otherParts = data.messageParts.filter((item) => item.id !== part.id);
  assertPositionAvailable(typedPositions(otherParts), validated);
  if (index < 0) data.messageParts.push(validated);
  else data.messageParts[index] = validated;
  return validated;
}

export function backfillInMemoryMessageTextParts(
  data: SeedData,
  input: MessagePartBackfillBatchInput,
): MessagePartBackfillBatchResult {
  assertBatchBound(input.maxMessages, 1, 500, "maxMessages");
  assertBatchBound(input.maxPartRows, 1, maximumPartPositions, "maxPartRows");
  const legacy = data.messages
    .filter((message) => data.messagePartSchemaVersions[message.id] !== 1)
    .sort((left, right) => left.id.localeCompare(right.id));
  let claimedRows = 0;
  let messagesCompleted = 0;
  let partsReindexed = 0;
  let textPartsCreated = 0;
  let blockedMessages = 0;
  for (const message of legacy) {
    const existing = data.messageParts
      .filter((part) => part.messageId === message.id)
      .map(validatePart)
      .sort((left, right) => left.id.localeCompare(right.id));
    const requiredRows = existing.length + (message.content === "" ? 0 : 1);
    if (
      requiredRows > maximumPartPositions ||
      existing.length > input.maxPartRows
    ) {
      blockedMessages += 1;
      continue;
    }
    if (
      messagesCompleted >= input.maxMessages ||
      claimedRows + existing.length > input.maxPartRows
    )
      continue;
    claimedRows += existing.length;
    const reindexed = existing.map((part, position) =>
      isMessagePartV1(part) ? { ...part, position } : part,
    );
    const existingIds = new Set(existing.map((part) => part.id));
    data.messageParts = data.messageParts.map((part) => {
      const index = existingIds.has(part.id)
        ? existing.findIndex((item) => item.id === part.id)
        : -1;
      return index < 0 ? part : (reindexed[index] ?? part);
    });
    partsReindexed += existing.length;
    if (!existing.some(isTextPart)) {
      const textPart = textPartForMessage({
        id: persistedTextPartId(message.id),
        message,
        position: existing.length,
      });
      if (textPart !== undefined) {
        data.messageParts.push(textPart);
        textPartsCreated += 1;
      }
    }
    data.messagePartSchemaVersions[message.id] = 1;
    messagesCompleted += 1;
  }
  return {
    messagesCompleted,
    partsReindexed,
    remainingMessages: legacy.length - messagesCompleted,
    textPartsCreated,
    blockedMessages,
  };
}

function isTextPart(part: E.MessagePart): boolean {
  return isMessagePartV1(part) && part.type === "text";
}

function validatePart(part: E.MessagePart): E.MessagePart {
  return "schemaVersion" in part ? parseMessagePartV1(part) : part;
}

function typedPositions(parts: E.MessagePart[]): Map<string, Set<number>> {
  const positions = new Map<string, Set<number>>();
  for (const part of parts) {
    if (!isMessagePartV1(part)) continue;
    const messagePositions = positions.get(part.messageId) ?? new Set<number>();
    messagePositions.add(part.position);
    positions.set(part.messageId, messagePositions);
  }
  return positions;
}

function assertPositionAvailable(
  positions: Map<string, Set<number>>,
  part: E.MessagePart,
): void {
  if (!isMessagePartV1(part)) return;
  const messagePositions = positions.get(part.messageId) ?? new Set<number>();
  if (messagePositions.has(part.position))
    throw new Error("Duplicate typed message part position.");
  messagePositions.add(part.position);
  positions.set(part.messageId, messagePositions);
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
