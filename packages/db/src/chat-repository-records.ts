import type { QueuedChatTurn } from "@romeo/core";
import { providerReasoningPolicyFromUnknown } from "@romeo/providers";
import { chatComments, chats, messages, queuedChatTurns } from "./schema";
import {
  asStringArray,
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";
export interface ChatRecord {
  agentId?: string;
  id: string;
  orgId: string;
  workspaceId: string;
  title: string;
  modelId?: string;
  temporary?: boolean;
  expiresAt?: string;
  createdBy: string;
  archivedAt?: string;
  legalHoldUntil?: string;
  legalHoldReason?: string;
  activeLeafMessageId?: string;
  transcriptVersion?: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  chatId: string;
  role: "assistant" | "system" | "tool" | "user";
  content: string;
  citations?: Array<{
    chunkId: string;
    documentId: string;
    title: string;
    sourceUri?: string;
  }>;
  error?: {
    code: string;
    message?: string;
  };
  modelId?: string;
  parentId?: string;
  createdAt: string;
}

export {
  toMessagePartInsert,
  toMessagePartRecord,
  type MessagePartRecord,
} from "./message-part-records";

export interface ChatCommentRecord {
  id: string;
  orgId: string;
  chatId: string;
  authorId: string;
  body: string;
  mentionedUserIds: string[];
  createdAt: string;
}

export interface QueuedChatTurnRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  chatId: string;
  agentId: string;
  modelId?: string;
  routingMode?: "economy";
  researchMode?: "deep";
  reasoningPolicy?: NonNullable<QueuedChatTurn["reasoningPolicy"]>;
  parentMessageId?: string | null;
  content: string;
  webSearch?: boolean;
  agenticRag?: boolean;
  urls?: string[];
  createdBy: string;
  principalId: string;
  principalType: "user" | "service_account";
  scopeSnapshot: QueuedChatTurn["scopeSnapshot"];
  idempotencyKey: string;
  status: "queued" | "leased" | "failed" | "cancelled" | "completed";
  attemptCount: number;
  leaseOwner?: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
  heartbeatAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export function toChatRecord(row: typeof chats.$inferSelect): ChatRecord {
  const chat: ChatRecord = {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    title: row.title,
    createdBy: row.createdBy,
    transcriptVersion: row.transcriptVersion.toString(),
    updatedAt: toIsoString(row.updatedAt),
    ...(row.temporary ? { temporary: true } : {}),
  };
  if (row.agentId !== null) chat.agentId = row.agentId;
  if (row.modelId !== null) chat.modelId = row.modelId;
  const expiresAt = optionalIsoString(row.expiresAt);
  if (expiresAt !== undefined) chat.expiresAt = expiresAt;
  const archivedAt = optionalIsoString(row.archivedAt);
  if (archivedAt !== undefined) chat.archivedAt = archivedAt;
  const legalHoldUntil = optionalIsoString(row.legalHoldUntil);
  if (legalHoldUntil !== undefined) chat.legalHoldUntil = legalHoldUntil;
  const legalHoldReason = optionalIsoString(row.legalHoldReason);
  if (legalHoldReason !== undefined) chat.legalHoldReason = legalHoldReason;
  if (row.activeLeafMessageId !== null)
    chat.activeLeafMessageId = row.activeLeafMessageId;
  return chat;
}

export function toMessageRecord(
  row: Omit<typeof messages.$inferSelect, "partsSchemaVersion"> & {
    partsSchemaVersion?: number;
  },
): MessageRecord {
  const citations = asMessageCitations(row.citations);
  const error = asMessageRunError(row.error);
  return {
    id: row.id,
    chatId: row.chatId,
    role: row.role,
    content: row.content,
    ...(citations.length === 0 ? {} : { citations }),
    ...(error === undefined ? {} : { error }),
    ...(row.modelId === null || row.modelId === undefined
      ? {}
      : { modelId: row.modelId }),
    ...(row.parentId === null ? {} : { parentId: row.parentId }),
    createdAt: toIsoString(row.createdAt),
  };
}

export function toChatCommentRecord(
  row: typeof chatComments.$inferSelect,
): ChatCommentRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    chatId: row.chatId,
    authorId: row.authorId,
    body: row.body,
    mentionedUserIds: asStringArray(row.mentionedUserIds),
    createdAt: toIsoString(row.createdAt),
  };
}

export function toQueuedChatTurnRecord(
  row: typeof queuedChatTurns.$inferSelect,
): QueuedChatTurnRecord {
  const record: QueuedChatTurnRecord = {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    chatId: row.chatId,
    agentId: row.agentId,
    content: row.content,
    createdBy: row.createdBy,
    principalId: row.principalId,
    principalType:
      row.principalType === "service_account" ? "service_account" : "user",
    scopeSnapshot: asStringArray(
      row.scopeSnapshot,
    ) as QueuedChatTurn["scopeSnapshot"],
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    attemptCount: row.attemptCount,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  if (row.modelId !== null) record.modelId = row.modelId;
  if (row.routingMode === "economy") record.routingMode = "economy";
  if (row.researchMode === "deep") record.researchMode = "deep";
  const reasoningPolicy = providerReasoningPolicyFromUnknown(
    row.reasoningPolicy,
  );
  if (row.reasoningPolicy !== null && reasoningPolicy === undefined)
    throw new Error("Stored queued turn has an invalid reasoning policy.");
  if (reasoningPolicy !== undefined) record.reasoningPolicy = reasoningPolicy;
  if (row.parentMessageConfigured) record.parentMessageId = row.parentMessageId;
  if (row.webSearch) record.webSearch = true;
  if (row.agenticRag) record.agenticRag = true;
  if (row.urls.length > 0) record.urls = row.urls;
  if (row.leaseOwner !== null) record.leaseOwner = row.leaseOwner;
  if (row.leaseToken !== null) record.leaseToken = row.leaseToken;
  const leaseExpiresAt = optionalIsoString(row.leaseExpiresAt);
  if (leaseExpiresAt !== undefined) record.leaseExpiresAt = leaseExpiresAt;
  const heartbeatAt = optionalIsoString(row.heartbeatAt);
  if (heartbeatAt !== undefined) record.heartbeatAt = heartbeatAt;
  if (row.lastErrorCode !== null) record.lastErrorCode = row.lastErrorCode;
  if (row.lastErrorMessage !== null)
    record.lastErrorMessage = row.lastErrorMessage;
  const completedAt = optionalIsoString(row.completedAt);
  if (completedAt !== undefined) record.completedAt = completedAt;
  return record;
}

export function toChatInsert(record: ChatRecord): typeof chats.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    title: record.title,
    agentId: record.agentId ?? null,
    modelId: record.modelId ?? null,
    temporary: record.temporary === true,
    expiresAt: optionalDate(record.expiresAt),
    createdBy: record.createdBy,
    archivedAt: optionalDate(record.archivedAt),
    legalHoldUntil: optionalDate(record.legalHoldUntil),
    legalHoldReason: record.legalHoldReason ?? null,
    activeLeafMessageId: record.activeLeafMessageId ?? null,
    transcriptVersion: BigInt(record.transcriptVersion ?? "0"),
    updatedAt: new Date(record.updatedAt),
  };
}

export function toMessageInsert(
  record: MessageRecord,
): typeof messages.$inferInsert {
  return {
    id: record.id,
    chatId: record.chatId,
    role: record.role,
    content: record.content,
    partsSchemaVersion: 1,
    citations: record.citations ?? null,
    error: record.error ?? null,
    modelId: record.modelId ?? null,
    parentId: record.parentId ?? null,
    createdAt: new Date(record.createdAt),
  };
}

export function toQueuedChatTurnInsert(
  record: QueuedChatTurnRecord,
): typeof queuedChatTurns.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    chatId: record.chatId,
    agentId: record.agentId,
    modelId: record.modelId ?? null,
    routingMode: record.routingMode ?? "selected",
    researchMode: record.researchMode ?? "standard",
    reasoningPolicy: record.reasoningPolicy ?? null,
    parentMessageConfigured: record.parentMessageId !== undefined,
    parentMessageId: record.parentMessageId ?? null,
    content: record.content,
    webSearch: record.webSearch === true,
    agenticRag: record.agenticRag === true,
    urls: record.urls ?? [],
    createdBy: record.createdBy,
    principalId: record.principalId,
    principalType: record.principalType,
    scopeSnapshot: record.scopeSnapshot,
    idempotencyKey: record.idempotencyKey,
    status: record.status,
    attemptCount: record.attemptCount,
    leaseOwner: record.leaseOwner ?? null,
    leaseToken: record.leaseToken ?? null,
    leaseExpiresAt: optionalDate(record.leaseExpiresAt),
    heartbeatAt: optionalDate(record.heartbeatAt),
    lastErrorCode: record.lastErrorCode ?? null,
    lastErrorMessage: record.lastErrorMessage ?? null,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    completedAt: optionalDate(record.completedAt),
  };
}

export function toQueuedChatTurnUpdate(record: QueuedChatTurnRecord) {
  return {
    modelId: record.modelId ?? null,
    routingMode: record.routingMode ?? "selected",
    researchMode: record.researchMode ?? "standard",
    reasoningPolicy: record.reasoningPolicy ?? null,
    parentMessageConfigured: record.parentMessageId !== undefined,
    parentMessageId: record.parentMessageId ?? null,
    content: record.content,
    webSearch: record.webSearch === true,
    agenticRag: record.agenticRag === true,
    urls: record.urls ?? [],
    status: record.status,
    attemptCount: record.attemptCount,
    leaseOwner: record.leaseOwner ?? null,
    leaseToken: record.leaseToken ?? null,
    leaseExpiresAt: optionalDate(record.leaseExpiresAt),
    heartbeatAt: optionalDate(record.heartbeatAt),
    lastErrorCode: record.lastErrorCode ?? null,
    lastErrorMessage: record.lastErrorMessage ?? null,
    updatedAt: new Date(record.updatedAt),
    completedAt: optionalDate(record.completedAt),
  };
}

function asMessageRunError(value: unknown): MessageRecord["error"] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.code !== "string" || item.code.trim().length === 0)
    return undefined;
  return {
    code: item.code.trim().slice(0, 120),
    ...(typeof item.message === "string" && item.message.trim().length > 0
      ? { message: item.message.trim().slice(0, 2_000) }
      : {}),
  };
}

function asMessageCitations(
  value: unknown,
): NonNullable<MessageRecord["citations"]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const item = raw as Record<string, unknown>;
    if (
      typeof item.chunkId !== "string" ||
      typeof item.documentId !== "string" ||
      typeof item.title !== "string"
    )
      return [];
    return [
      {
        chunkId: item.chunkId,
        documentId: item.documentId,
        title: item.title,
        ...(typeof item.sourceUri === "string"
          ? { sourceUri: item.sourceUri }
          : {}),
        ...citationStringField(item, "sourceType"),
        ...citationStringField(item, "provider"),
        ...citationStringField(item, "retrievedAt"),
        ...citationStringField(item, "accessedAt"),
        ...citationStringField(item, "publishedAt"),
      },
    ];
  });
}

function citationStringField(
  item: Record<string, unknown>,
  key: string,
): Record<string, string> {
  return typeof item[key] === "string"
    ? ({ [key]: item[key] } as Record<string, string>)
    : {};
}

export function toChatCommentInsert(
  record: ChatCommentRecord,
): typeof chatComments.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    chatId: record.chatId,
    authorId: record.authorId,
    body: record.body,
    mentionedUserIds: record.mentionedUserIds,
    createdAt: new Date(record.createdAt),
  };
}
