import type { QueryClient } from "@tanstack/react-query";

import {
  deleteMessage,
  updateAttachmentRetention,
  updateMessageFeedback,
} from "../features";
import type { Message, MessageFeedbackState } from "../features/types";
import {
  getActiveRun,
  messagesQueryKey,
  writeChatMessages,
} from "../lib/run-registry";
import { isMessageActionEnabled } from "./turn-rollback";
import { clientMessageId } from "./workspace-controller-media";

// A root's children become roots, so the key is dropped rather than set to
// undefined: Message is exactOptionalPropertyTypes, and `parentId: undefined`
// is not the same shape as an absent parentId to anything that reads it.
function reparent(message: Message, parentId: string | undefined): Message {
  const { parentId: _replaced, ...rest } = message;
  return parentId === undefined ? rest : { ...rest, parentId };
}

interface ChatMessageStateOptions {
  activeChatId: string | undefined;
  isStreaming: boolean;
  queryClient: QueryClient;
  setError: (error: string | undefined) => void;
}

export function useChatMessageState({
  activeChatId,
  isStreaming,
  queryClient,
  setError,
}: ChatMessageStateOptions) {
  // The transcript is a query, not local state, so refreshing it is an
  // invalidation rather than a second fetch that would race the cached one.
  // This runs when a run settles, which can be long after the reader moved to
  // another chat, so every key here is addressed to `chatId` -- never to
  // whatever chat is on screen.
  async function syncPersistedMessages(chatId: string) {
    await queryClient.invalidateQueries({
      queryKey: ["messageFeedback", chatId],
    });
    // A live run owns this chat's transcript. Re-selecting the chat mid-answer
    // would otherwise replace what has streamed so far with the empty
    // assistant row the server holds until the run reaches a terminal state.
    if (getActiveRun(chatId)?.isStreaming === true) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: messagesQueryKey(chatId) }),
      // The chat carries the leaf pointer that selects which branch is on
      // screen, and the run just moved it. Refetched together so the pointer
      // and the rows it addresses never disagree about which turn is newest.
      queryClient.invalidateQueries({ queryKey: ["chat", chatId] }),
    ]);
  }

  function appendMessage(
    chatId: string,
    role: Message["role"],
    content: string,
    attachments?: Message["attachments"],
    parentId?: string,
  ): string {
    const message: Message = {
      id: clientMessageId(),
      chatId,
      role,
      content,
      createdAt: new Date().toISOString(),
    };
    if (attachments !== undefined && attachments.length > 0) {
      message.attachments = attachments;
    }
    if (parentId !== undefined) message.parentId = parentId;
    writeChatMessages(queryClient, chatId, (current) => [...current, message]);
    return message.id;
  }

  function restoreMessages(chatId: string, snapshot: readonly Message[]): void {
    writeChatMessages(queryClient, chatId, () => [...snapshot]);
  }

  async function handleRateMessage(
    messageId: string,
    rating: "negative" | "none" | "positive",
  ) {
    if (activeChatId === undefined) return;
    setError(undefined);
    try {
      const feedback = await updateMessageFeedback({
        chatId: activeChatId,
        messageId,
        rating,
      });
      queryClient.setQueryData<Record<string, MessageFeedbackState>>(
        ["messageFeedback", activeChatId],
        (current) => ({ ...current, [messageId]: feedback }),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to save feedback.",
      );
    }
  }

  async function handleDeleteMessage(messageId: string) {
    if (
      !isMessageActionEnabled({
        isStreaming,
        hasActiveChat: activeChatId !== undefined,
      }) ||
      activeChatId === undefined
    )
      return;
    setError(undefined);
    try {
      await deleteMessage(activeChatId, messageId);
      // Mirror the repository's splice rather than just dropping the row: the
      // children of a deleted mid-conversation message would otherwise still
      // name a parent that is gone, chatPath would stop walking there, and the
      // whole branch above the deletion would vanish from the screen. Nothing
      // corrects it later either -- the transcript query is staleTime: Infinity.
      writeChatMessages(queryClient, activeChatId, (current) => {
        const grandparentId = current.find(
          (item) => item.id === messageId,
        )?.parentId;
        return current
          .filter((item) => item.id !== messageId)
          .map((item) =>
            item.parentId === messageId
              ? reparent(item, grandparentId)
              : item,
          );
      });
      // The server also retargets the chat's leaf pointer when it named the
      // deleted row. Refetch it rather than guessing: chatPath tolerates a
      // dangling pointer by falling back to the newest message, which is a
      // different branch than the one the server chose.
      await queryClient.invalidateQueries({
        queryKey: ["chat", activeChatId],
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to delete message.",
      );
    }
  }

  async function handleAttachmentRetention(
    messageId: string,
    attachmentId: string,
    retainedInContext: boolean,
  ) {
    if (
      !isMessageActionEnabled({
        isStreaming,
        hasActiveChat: activeChatId !== undefined,
      }) ||
      activeChatId === undefined
    )
      return;
    setError(undefined);
    try {
      await updateAttachmentRetention({
        chatId: activeChatId,
        messageId,
        attachmentId,
        retainedInContext,
      });
      writeChatMessages(queryClient, activeChatId, (current) =>
        current.map((message) =>
          message.id !== messageId || message.attachments === undefined
            ? message
            : {
                ...message,
                attachments: message.attachments.map((attachment) =>
                  attachment.id === attachmentId
                    ? { ...attachment, retainedInContext }
                    : attachment,
                ),
              },
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to update attachment context.",
      );
    }
  }

  return {
    appendMessage,
    handleAttachmentRetention,
    handleDeleteMessage,
    handleRateMessage,
    restoreMessages,
    syncPersistedMessages,
  };
}
