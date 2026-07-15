import { parseSseStream } from "@romeo/api-client";

import { apiJson } from "./http";
import type {
  Chat,
  ChatArchiveFilter,
  ChatComment,
  Envelope,
  Message,
  RunEvent,
  RunRecord,
} from "./types";

export async function listChats(
  workspaceId: string,
  archived: ChatArchiveFilter = "active",
): Promise<Chat[]> {
  const params = new URLSearchParams({ workspaceId });
  if (archived !== "active") params.set("archived", archived);
  const response = await apiJson<Envelope<Chat[]>>(
    `/api/v1/chats?${params.toString()}`,
  );
  return response.data;
}

export async function listMessages(chatId: string): Promise<Message[]> {
  const response = await apiJson<Envelope<Message[]>>(
    `/api/v1/chats/${encodeURIComponent(chatId)}/messages`,
  );
  return response.data;
}

export async function deleteMessage(
  chatId: string,
  messageId: string,
): Promise<Message> {
  const response = await apiJson<Envelope<Message>>(
    `/api/v1/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: "DELETE",
      // A body-less DELETE crashes Hono's body-limit middleware under the
      // Node/h3 request adapter this app runs on (pre-existing bug that
      // affects every other body-less DELETE route too, e.g.
      // /api/v1/groups/{id}/members/{id}). Sending an empty JSON body takes
      // the working code path without touching that shared middleware.
      body: "{}",
    },
  );
  return response.data;
}

export async function listChatComments(chatId: string): Promise<ChatComment[]> {
  const response = await apiJson<Envelope<ChatComment[]>>(
    `/api/v1/chats/${encodeURIComponent(chatId)}/comments`,
  );
  return response.data;
}

export async function createChatComment(input: {
  chatId: string;
  body: string;
}): Promise<ChatComment> {
  const response = await apiJson<Envelope<ChatComment>>(
    `/api/v1/chats/${encodeURIComponent(input.chatId)}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ body: input.body }),
    },
  );
  return response.data;
}

export async function createChat(input: {
  workspaceId: string;
  title: string;
}): Promise<Chat> {
  const response = await apiJson<Envelope<Chat>>("/api/v1/chats", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function archiveChat(chatId: string): Promise<Chat> {
  const response = await apiJson<Envelope<Chat>>(
    `/api/v1/chats/${encodeURIComponent(chatId)}/archive`,
    {
      method: "POST",
    },
  );
  return response.data;
}

export async function updateChat(
  chatId: string,
  input: { title: string },
): Promise<Chat> {
  const response = await apiJson<Envelope<Chat>>(
    `/api/v1/chats/${encodeURIComponent(chatId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function unarchiveChat(chatId: string): Promise<Chat> {
  const response = await apiJson<Envelope<Chat>>(
    `/api/v1/chats/${encodeURIComponent(chatId)}/unarchive`,
    {
      method: "POST",
    },
  );
  return response.data;
}

export async function updateChatLegalHold(
  chatId: string,
  input: { legalHoldUntil?: string | null; legalHoldReason?: string },
): Promise<Chat> {
  const response = await apiJson<Envelope<Chat>>(
    `/api/v1/chats/${encodeURIComponent(chatId)}/legal-hold`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function startRun(input: {
  chatId: string;
  agentId: string;
  content: string;
  attachments?: Array<{
    dataBase64: string;
    fileName: string;
    mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
    sizeBytes: number;
  }>;
}): Promise<RunRecord> {
  const response = await apiJson<Envelope<RunRecord>>("/api/v1/runs", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function cancelRun(runId: string): Promise<RunRecord> {
  const response = await apiJson<Envelope<RunRecord>>(
    `/api/v1/runs/${encodeURIComponent(runId)}/cancel`,
    {
      method: "POST",
    },
  );
  return response.data;
}

export async function* streamRunEvents(
  runId: string,
  signal?: AbortSignal,
): AsyncIterable<RunEvent> {
  const init: RequestInit = { headers: { accept: "text/event-stream" } };
  if (signal !== undefined) init.signal = signal;
  const response = await fetch(
    `/api/v1/runs/${encodeURIComponent(runId)}/events`,
    init,
  );
  if (!response.ok || response.body === null)
    throw new Error(`Run event stream failed with ${response.status}.`);
  for await (const event of parseSseStream(response.body)) {
    if (isRunEvent(event.data)) yield event.data;
  }
}

function isRunEvent(value: unknown): value is RunEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "runId" in value
  );
}
