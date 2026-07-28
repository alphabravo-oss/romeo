import {
  chatsExport,
  chatsGet,
  chatsGetMessageFeedback,
  chatsList,
  chatsListComments,
  chatsListMessageFeedback,
  chatsListMessages,
  chatsPreviewDelete,
  chatsSearch,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  Chat,
  ChatArchiveFilter,
  ChatComment,
  ChatExport,
  ChatPage,
  Message,
  MessageFeedbackState,
} from "./types";

export async function listChats(
  workspaceId: string,
  archived: ChatArchiveFilter = "active",
): Promise<Chat[]> {
  configureBrowserApiClients();
  const response = await chatsList({
    query: { workspaceId, ...(archived === "active" ? {} : { archived }) },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listChatsPage(
  workspaceId: string,
  options: {
    archived?: ChatArchiveFilter;
    limit?: number;
    offset?: number;
  } = {},
): Promise<ChatPage> {
  configureBrowserApiClients();
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const response = await chatsList({
    query: {
      workspaceId,
      limit,
      offset,
      ...(options.archived === undefined || options.archived === "active"
        ? {}
        : { archived: options.archived }),
    },
    throwOnError: true,
  });
  const meta = response.data.meta;
  if (meta === undefined) {
    throw new Error(
      "The paginated chat response did not include page metadata.",
    );
  }
  return { items: response.data.data, ...meta };
}

export async function searchChats(
  workspaceId: string,
  query: string,
): Promise<Array<Chat & { match?: { messageId: string; snippet: string } }>> {
  configureBrowserApiClients();
  const response = await chatsSearch({
    query: { workspaceId, q: query },
    throwOnError: true,
  });
  return response.data.data;
}

export async function getChat(chatId: string): Promise<Chat> {
  configureBrowserApiClients();
  const response = await chatsGet({ path: { chatId }, throwOnError: true });
  return response.data.data;
}

export async function listMessages(chatId: string): Promise<Message[]> {
  configureBrowserApiClients();
  const response = await chatsListMessages({
    path: { chatId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listMessageFeedback(
  chatId: string,
): Promise<MessageFeedbackState[]> {
  configureBrowserApiClients();
  const response = await chatsListMessageFeedback({
    path: { chatId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function getMessageFeedback(
  chatId: string,
  messageId: string,
): Promise<MessageFeedbackState> {
  configureBrowserApiClients();
  const response = await chatsGetMessageFeedback({
    path: { chatId, messageId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listChatComments(chatId: string): Promise<ChatComment[]> {
  configureBrowserApiClients();
  const response = await chatsListComments({
    path: { chatId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function previewDeleteChat(chatId: string) {
  configureBrowserApiClients();
  const response = await chatsPreviewDelete({
    path: { chatId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function exportChat(chatId: string): Promise<ChatExport> {
  configureBrowserApiClients();
  const response = await chatsExport({
    path: { chatId },
    query: { format: "json" },
    headers: { accept: "application/json" },
    throwOnError: true,
  });
  if (typeof response.data === "string") {
    throw new Error("The chat export endpoint returned an unexpected format.");
  }
  return response.data.data;
}
