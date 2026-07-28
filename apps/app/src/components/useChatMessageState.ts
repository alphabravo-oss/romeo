import type { Dispatch, SetStateAction } from "react";

import {
  deleteMessage,
  listMessageFeedback,
  listMessages,
  updateAttachmentRetention,
  updateMessageFeedback,
} from "../features";
import type { Message, MessageFeedbackState } from "../features/types";
import { isMessageActionEnabled } from "./turn-rollback";
import { clientMessageId } from "./workspace-controller-media";

interface ChatMessageStateOptions {
  activeChatId: string | undefined;
  isStreaming: boolean;
  setMessageFeedback: Dispatch<
    SetStateAction<Record<string, MessageFeedbackState>>
  >;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setError: (error: string | undefined) => void;
}

export function useChatMessageState({
  activeChatId,
  isStreaming,
  setMessageFeedback,
  setMessages,
  setError,
}: ChatMessageStateOptions) {
  async function syncPersistedMessages(chatId: string) {
    const [savedMessages, savedFeedback] = await Promise.all([
      listMessages(chatId),
      listMessageFeedback(chatId),
    ]);
    setMessages(savedMessages);
    setMessageFeedback(
      Object.fromEntries(savedFeedback.map((item) => [item.messageId, item])),
    );
  }

  function appendMessage(
    chatId: string,
    role: Message["role"],
    content: string,
    attachments?: Message["attachments"],
  ) {
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
    setMessages((current) => [...current, message]);
  }

  function restoreMessages(snapshot: readonly Message[]): void {
    setMessages([...snapshot]);
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
      setMessageFeedback((current) => ({
        ...current,
        [messageId]: feedback,
      }));
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
      setMessages((current) => current.filter((item) => item.id !== messageId));
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
      setMessages((current) =>
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
