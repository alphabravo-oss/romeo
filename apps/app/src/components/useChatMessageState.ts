import { useMutation, type QueryClient } from "@tanstack/react-query";

import type { Message } from "../features/types";
import {
  deleteMessageMutationOptions,
  updateAttachmentRetentionMutationOptions,
  updateMessageFeedbackMutationOptions,
} from "../features/chats/mutation-options";
import { getActiveRun, writeChatMessages } from "../lib/run-registry";
import { normalizeFeedbackReasonCode } from "./chat-enterprise";
import { isMessageActionEnabled } from "./turn-rollback";
import { clientMessageId } from "./workspace-controller-media";
import { safeUserErrorMessage } from "../lib/safe-user-error";
import * as appQueryKeys from "../lib/app-query-keys";
import { invalidateCachedResourceExactly } from "../lib/server-mutation-options";
import {
  activeMessagePageQueryOptions,
  resetActiveMessagePages,
} from "../lib/message-page-query";

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
  const deleteMessageMutation = useMutation(deleteMessageMutationOptions());
  const retentionMutation = useMutation(
    updateAttachmentRetentionMutationOptions(),
  );
  const feedbackMutation = useMutation(updateMessageFeedbackMutationOptions());
  // The transcript is a query, not local state, so refreshing it is an
  // invalidation rather than a second fetch that would race the cached one.
  // This runs when a run settles, which can be long after the reader moved to
  // another chat, so every key here is addressed to `chatId` -- never to
  // whatever chat is on screen.
  async function syncPersistedMessages(
    chatId: string,
    optimisticMessageIds: readonly string[] = [],
  ) {
    await invalidateCachedResourceExactly(
      queryClient,
      appQueryKeys.messageFeedback(chatId),
    );
    // A live run owns this chat's transcript. Re-selecting the chat mid-answer
    // would otherwise replace what has streamed so far with the empty
    // assistant row the server holds until the run reaches a terminal state.
    if (getActiveRun(chatId)?.isStreaming === true) return;
    await Promise.all([
      resetActiveMessagePages(queryClient, chatId),
      // The chat carries the leaf pointer that selects which branch is on
      // screen, and the run just moved it. Refetched together so the pointer
      // and the rows it addresses never disagree about which turn is newest.
      queryClient.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.chat(chatId),
      }),
    ]);
    const terminalLeafMessageId = optimisticMessageIds.at(-1);
    if (terminalLeafMessageId !== undefined) {
      await queryClient.fetchInfiniteQuery(
        activeMessagePageQueryOptions(chatId, terminalLeafMessageId),
      );
    }
    if (optimisticMessageIds.length > 0) {
      const persisted = new Set(optimisticMessageIds);
      writeChatMessages(queryClient, chatId, (current) =>
        current.filter((message) => !persisted.has(message.id)),
      );
    }
  }

  function appendMessage(
    chatId: string,
    role: Message["role"],
    content: string,
    attachments?: Message["attachments"],
    parentId?: string,
    messageId = clientMessageId(),
  ): string {
    const message: Message = {
      id: messageId,
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
    return messageId;
  }

  function restoreMessages(chatId: string, snapshot: readonly Message[]): void {
    writeChatMessages(queryClient, chatId, () => [...snapshot]);
  }

  async function handleRateMessage(
    messageId: string,
    rating: "negative" | "none" | "positive",
    reasonCode?: string,
  ) {
    if (activeChatId === undefined) return;
    setError(undefined);
    try {
      const normalizedReason = normalizeFeedbackReasonCode(rating, reasonCode);
      await feedbackMutation.mutateAsync({
        chatId: activeChatId,
        messageId,
        rating,
        ...(normalizedReason === undefined
          ? {}
          : { reasonCode: normalizedReason }),
      });
    } catch (caught) {
      setError(safeUserErrorMessage(caught, "Unable to save feedback."));
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
      await deleteMessageMutation.mutateAsync({
        chatId: activeChatId,
        messageId,
      });
      await syncPersistedMessages(activeChatId);
    } catch (caught) {
      setError(safeUserErrorMessage(caught, "Unable to delete message."));
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
      await retentionMutation.mutateAsync({
        chatId: activeChatId,
        messageId,
        attachmentId,
        retainedInContext,
      });
      await resetActiveMessagePages(queryClient, activeChatId);
    } catch (caught) {
      setError(
        safeUserErrorMessage(caught, "Unable to update attachment context."),
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
