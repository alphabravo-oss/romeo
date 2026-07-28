import {
  chatsArchive,
  chatsCleanupExpired,
  chatsCreate,
  chatsCreateComment,
  chatsDelete,
  chatsDeleteMessage,
  chatsFork,
  chatsImport,
  chatsUnarchive,
  chatsUpdate,
  chatsUpdateAttachmentRetention,
  chatsUpdateLegalHold,
  chatsUpdateMessageFeedback,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type { Chat, ChatComment, Message, MessageFeedbackState } from "./types";

export async function createChat(
  input: Parameters<typeof chatsCreate>[0]["body"],
): Promise<Chat> {
  configureBrowserApiClients();
  const response = await chatsCreate({ body: input, throwOnError: true });
  return response.data.data;
}

export async function importChat(
  input: Parameters<typeof chatsImport>[0]["body"],
): Promise<Chat> {
  configureBrowserApiClients();
  const response = await chatsImport({ body: input, throwOnError: true });
  return response.data.data;
}

export async function updateChat(
  chatId: string,
  input: Parameters<typeof chatsUpdate>[0]["body"],
): Promise<Chat> {
  configureBrowserApiClients();
  const response = await chatsUpdate({
    path: { chatId },
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function archiveChat(chatId: string): Promise<Chat> {
  configureBrowserApiClients();
  const response = await chatsArchive({
    path: { chatId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function unarchiveChat(chatId: string): Promise<Chat> {
  configureBrowserApiClients();
  const response = await chatsUnarchive({
    path: { chatId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function updateChatLegalHold(
  chatId: string,
  input: Parameters<typeof chatsUpdateLegalHold>[0]["body"],
): Promise<Chat> {
  configureBrowserApiClients();
  const response = await chatsUpdateLegalHold({
    path: { chatId },
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function deleteChat(chatId: string) {
  configureBrowserApiClients();
  const response = await chatsDelete({
    path: { chatId },
    body: { confirmChatId: chatId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function deleteMessage(
  chatId: string,
  messageId: string,
): Promise<Message> {
  configureBrowserApiClients();
  const response = await chatsDeleteMessage({
    path: { chatId, messageId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function updateAttachmentRetention(input: {
  attachmentId: string;
  chatId: string;
  messageId: string;
  retainedInContext: boolean;
}) {
  configureBrowserApiClients();
  const { retainedInContext, ...path } = input;
  const response = await chatsUpdateAttachmentRetention({
    path,
    body: { retainedInContext },
    throwOnError: true,
  });
  return response.data.data;
}

export async function updateMessageFeedback(input: {
  chatId: string;
  messageId: string;
  rating: "negative" | "none" | "positive";
  reasonCode?: string;
}): Promise<MessageFeedbackState> {
  configureBrowserApiClients();
  const { chatId, messageId, ...body } = input;
  const response = await chatsUpdateMessageFeedback({
    path: { chatId, messageId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function forkChat(input: {
  chatId: string;
  throughMessageId?: string;
  title?: string;
  includeAttachments?: boolean;
}): Promise<Chat> {
  configureBrowserApiClients();
  const { chatId, ...body } = input;
  const response = await chatsFork({
    path: { chatId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function createChatComment(input: {
  chatId: string;
  body: string;
}): Promise<ChatComment> {
  configureBrowserApiClients();
  const response = await chatsCreateComment({
    path: { chatId: input.chatId },
    body: { body: input.body },
    throwOnError: true,
  });
  return response.data.data;
}

export async function cleanupExpiredChats(workspaceId?: string) {
  configureBrowserApiClients();
  const response = await chatsCleanupExpired({
    body: workspaceId === undefined ? {} : { workspaceId },
    throwOnError: true,
  });
  return response.data.data;
}
