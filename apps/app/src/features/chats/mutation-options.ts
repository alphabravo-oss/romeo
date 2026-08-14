import type { Chat, MessageFeedbackState } from "./types";

import * as appQueryKeys from "../../lib/app-query-keys";
import { currentMutationSessionVersion } from "../../lib/mutation-session-boundary";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import {
  archiveChat,
  createChat,
  deleteMessage,
  forkChat,
  importChat,
  updateAttachmentRetention,
  updateChat,
  updateChatLegalHold,
  updateMessageFeedback,
} from "./mutations";

interface ChatMutationScope {
  chatId: string;
  workspaceId: string | undefined;
}

export interface UpdateWorkspaceChatInput extends ChatMutationScope {
  patch: Parameters<typeof updateChat>[1];
}

export interface UpdateChatLegalHoldInput extends ChatMutationScope {
  input: Parameters<typeof updateChatLegalHold>[1];
}

async function withinCurrentSession<T>(operation: () => Promise<T>) {
  const sessionVersion = currentMutationSessionVersion();
  const result = await operation();
  if (sessionVersion !== currentMutationSessionVersion()) {
    throw new Error("The authentication session changed.");
  }
  return result;
}

function chatListInvalidations(workspaceId: string | undefined) {
  return workspaceId === undefined
    ? []
    : [
        { exact: true as const, queryKey: appQueryKeys.chats(workspaceId) },
        {
          exact: true as const,
          queryKey: appQueryKeys.chats(workspaceId, "collaboration"),
        },
      ];
}

export function createWorkspaceChatMutationOptions() {
  return serverMutationOptions({
    resource: "chat.create",
    mutationFn: (input: Parameters<typeof createChat>[0]) => createChat(input),
    invalidations: (_chat, input) => chatListInvalidations(input.workspaceId),
  });
}

export function importWorkspaceChatMutationOptions() {
  return serverMutationOptions({
    resource: "chat.import",
    mutationFn: (input: Parameters<typeof importChat>[0]) => importChat(input),
    invalidations: (_chat, input) => chatListInvalidations(input.workspaceId),
  });
}

export type ForkWorkspaceChatInput = Parameters<typeof forkChat>[0] & {
  workspaceId: string;
};

export function forkWorkspaceChatMutationOptions() {
  return serverMutationOptions({
    resource: "chat.fork",
    mutationFn: ({
      workspaceId: _workspaceId,
      ...input
    }: ForkWorkspaceChatInput) => forkChat(input),
    invalidations: (_chat, { workspaceId }) =>
      chatListInvalidations(workspaceId),
  });
}

export function updateMessageFeedbackMutationOptions() {
  return serverMutationOptions({
    resource: "chat.message.feedback.update",
    mutationFn: (input: Parameters<typeof updateMessageFeedback>[0]) =>
      updateMessageFeedback(input),
    reconcile: (client, feedback, { chatId, messageId }) => {
      client.setQueryData<Record<string, MessageFeedbackState>>(
        appQueryKeys.messageFeedback(chatId),
        (current) => ({ ...current, [messageId]: feedback }),
      );
    },
  });
}

export function deleteMessageMutationOptions() {
  return serverMutationOptions({
    resource: "chat.message.delete",
    mutationFn: ({
      chatId,
      messageId,
    }: {
      chatId: string;
      messageId: string;
    }) => deleteMessage(chatId, messageId),
    invalidations: (_message, { chatId }) => [
      { exact: true, queryKey: appQueryKeys.chat(chatId) },
      { exact: true, queryKey: appQueryKeys.messageFeedback(chatId) },
    ],
  });
}

export function updateAttachmentRetentionMutationOptions() {
  return serverMutationOptions({
    resource: "chat.attachment.retention.update",
    mutationFn: (input: Parameters<typeof updateAttachmentRetention>[0]) =>
      updateAttachmentRetention(input),
    invalidations: (_attachment, { chatId }) => [
      { exact: true, queryKey: appQueryKeys.chat(chatId) },
    ],
  });
}

export function updateWorkspaceChatMutationOptions() {
  return serverMutationOptions<
    Chat,
    Error,
    UpdateWorkspaceChatInput,
    Chat | undefined
  >({
    resource: "chat.update",
    mutationFn: ({ chatId, patch }) => updateChat(chatId, patch),
    optimistic: {
      snapshot: async (client, { chatId }) => {
        const queryKey = appQueryKeys.chat(chatId);
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<Chat>(queryKey);
      },
      update: (client, { chatId, patch }) => {
        client.setQueryData<Chat>(appQueryKeys.chat(chatId), (current) =>
          current === undefined ? current : applyChatPatch(current, patch),
        );
      },
      rollback: (client, snapshot, { chatId }) => {
        const queryKey = appQueryKeys.chat(chatId);
        if (snapshot === undefined)
          client.removeQueries({ exact: true, queryKey });
        else client.setQueryData(queryKey, snapshot);
      },
    },
    reconcile: (client, chat) => {
      client.setQueryData(appQueryKeys.chat(chat.id), chat);
    },
    invalidations: (_chat, { chatId, workspaceId }) => [
      { exact: true, queryKey: appQueryKeys.chat(chatId) },
      ...chatListInvalidations(workspaceId),
    ],
  });
}

function applyChatPatch(
  current: Chat,
  patch: Parameters<typeof updateChat>[1],
): Chat {
  const next = { ...current };
  if (patch.agentId === null) delete next.agentId;
  else if (patch.agentId !== undefined) next.agentId = patch.agentId;
  if (patch.modelId === null) delete next.modelId;
  else if (patch.modelId !== undefined) next.modelId = patch.modelId;
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.activeLeafMessageId !== undefined) {
    next.activeLeafMessageId = patch.activeLeafMessageId;
  }
  return next;
}

export function archiveWorkspaceChatMutationOptions() {
  return serverMutationOptions({
    resource: "chat.archive",
    mutationFn: ({ chatId }: ChatMutationScope) => archiveChat(chatId),
    reconcile: async (client, chat) => {
      client.setQueryData(appQueryKeys.chat(chat.id), chat);
      await invalidateCachedResourceExactly(client, appQueryKeys.auditLogs());
    },
    invalidations: (_chat, { chatId, workspaceId }) => [
      { exact: true, queryKey: appQueryKeys.chat(chatId) },
      { exact: true, queryKey: appQueryKeys.chatComments(chatId) },
      { exact: true, queryKey: appQueryKeys.accessReview() },
      ...chatListInvalidations(workspaceId),
    ],
  });
}

export function updateChatLegalHoldMutationOptions() {
  return serverMutationOptions<
    Chat,
    Error,
    UpdateChatLegalHoldInput,
    Chat | undefined
  >({
    resource: "chat.legalHold.update",
    mutationFn: ({ chatId, input }) =>
      withinCurrentSession(() => updateChatLegalHold(chatId, input)),
    optimistic: {
      snapshot: async (client, { chatId }) => {
        const queryKey = appQueryKeys.chat(chatId);
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<Chat>(queryKey);
      },
      update: (client, { chatId, input }) => {
        client.setQueryData<Chat>(appQueryKeys.chat(chatId), (current) => {
          if (current === undefined || input.legalHoldUntil === undefined) {
            return current;
          }
          const next = { ...current };
          if (input.legalHoldUntil === null) delete next.legalHoldUntil;
          else next.legalHoldUntil = input.legalHoldUntil;
          return next;
        });
      },
      rollback: (client, snapshot, { chatId }) => {
        const queryKey = appQueryKeys.chat(chatId);
        if (snapshot === undefined) {
          client.removeQueries({ exact: true, queryKey });
        } else {
          client.setQueryData(queryKey, snapshot);
        }
      },
    },
    reconcile: async (client, chat) => {
      client.setQueryData(appQueryKeys.chat(chat.id), chat);
      await invalidateCachedResourceExactly(client, appQueryKeys.auditLogs());
    },
    invalidations: (_chat, { chatId, workspaceId }) => [
      { exact: true, queryKey: appQueryKeys.chat(chatId) },
      { exact: true, queryKey: appQueryKeys.accessReview() },
      ...chatListInvalidations(workspaceId),
    ],
  });
}
