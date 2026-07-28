import { useMutation, type QueryClient } from "@tanstack/react-query";
import type { Dispatch, FormEvent, SetStateAction } from "react";

import {
  createChat,
  deleteMessage,
  fileContentUrl,
  forkChat,
  updateChat,
} from "../features";
import type { Message } from "../features/types";
import {
  enqueueChatTurn,
  getActiveChatRun,
  listQueuedTurns,
  startRun,
  type QueuedChatTurn,
} from "../features/runs";
import type { MessageKey } from "../lib/i18n";
import {
  normalizeImageMimeType,
  type ImageAttachmentMimeType,
  type PendingDocumentAttachment,
  type PendingImageAttachment,
} from "./useWorkspaceAttachments";
import { blobToBase64, clientMessageId } from "./workspace-controller-media";

interface WorkspaceTurnActionsOptions {
  activeAgentId: string | undefined;
  activeChatId: string | undefined;
  appendMessage: (
    chatId: string,
    role: Message["role"],
    content: string,
    attachments?: Message["attachments"],
  ) => void;
  attachedUrls: string[];
  clearPendingAttachments: () => void;
  consumeRunStream: (runId: string) => Promise<void>;
  documentAttachments: PendingDocumentAttachment[];
  draft: string;
  imageAttachments: PendingImageAttachment[];
  isStreaming: boolean;
  messages: Message[];
  queryClient: QueryClient;
  refreshUsageControls: () => Promise<void>;
  resetRunPresentation: () => void;
  selectedModelId: string | undefined;
  setActiveChatId: Dispatch<SetStateAction<string | undefined>>;
  setActiveRunId: Dispatch<SetStateAction<string | undefined>>;
  setAttachedUrls: Dispatch<SetStateAction<string[]>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setIsDraftingNewChat: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setQueuedTurns: Dispatch<SetStateAction<QueuedChatTurn[]>>;
  setTemporaryNextChat: Dispatch<SetStateAction<boolean>>;
  syncPersistedMessages: (chatId: string) => Promise<void>;
  t: (key: MessageKey) => string;
  temporaryNextChat: boolean;
  webSearchEnabled: boolean;
  workspaceId: string | undefined;
}

export function useWorkspaceTurnActions(options: WorkspaceTurnActionsOptions) {
  const createChatMutation = useMutation({ mutationFn: createChat });
  const startRunMutation = useMutation({ mutationFn: startRun });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typedContent = options.draft.trim();
    const content =
      typedContent ||
      (options.imageAttachments.length > 0 ||
      options.documentAttachments.length > 0
        ? "Review the attached file(s)."
        : "");
    if (
      content.length === 0 ||
      options.workspaceId === undefined ||
      options.activeAgentId === undefined
    ) {
      return;
    }
    if (options.isStreaming) {
      await enqueueTurn(content);
      return;
    }
    await submitTurn(
      content,
      options.imageAttachments,
      options.documentAttachments,
    );
  }

  async function enqueueTurn(content: string): Promise<void> {
    if (
      options.imageAttachments.length > 0 ||
      options.documentAttachments.length > 0
    ) {
      options.setError(options.t("fileAfterResponse"));
      return;
    }
    if (
      options.activeChatId === undefined ||
      options.activeAgentId === undefined
    )
      return;
    try {
      await enqueueChatTurn({
        chatId: options.activeChatId,
        agentId: options.activeAgentId,
        content,
        ...(options.selectedModelId === undefined
          ? {}
          : { modelId: options.selectedModelId }),
        ...(options.webSearchEnabled ? { webSearch: true } : {}),
        ...(options.attachedUrls.length === 0
          ? {}
          : { urls: options.attachedUrls }),
      });
      options.setQueuedTurns(await listQueuedTurns(options.activeChatId));
      options.setDraft("");
      options.setAttachedUrls([]);
    } catch (caught) {
      options.setError(
        caught instanceof Error ? caught.message : options.t("unableQueue"),
      );
    }
  }

  async function submitTurn(
    content: string,
    images: PendingImageAttachment[] = [],
    documents: PendingDocumentAttachment[] = [],
    allowQueued = false,
  ) {
    if (
      options.workspaceId === undefined ||
      options.activeAgentId === undefined ||
      (options.isStreaming && !allowQueued)
    ) {
      return;
    }
    options.setError(undefined);
    options.setDraft("");
    options.clearPendingAttachments();
    options.resetRunPresentation();
    try {
      const chat = options.activeChatId
        ? { id: options.activeChatId }
        : await createChatMutation.mutateAsync({
            workspaceId: options.workspaceId,
            title: content.slice(0, 80),
            ...(options.temporaryNextChat ? { temporary: true } : {}),
          });
      options.setActiveChatId(chat.id);
      if (options.selectedModelId !== undefined && !options.activeChatId) {
        await updateChat(chat.id, { modelId: options.selectedModelId });
      }
      options.setIsDraftingNewChat(false);
      options.setTemporaryNextChat(false);
      await options.queryClient.invalidateQueries({
        queryKey: ["chats", options.workspaceId],
      });
      appendOptimisticTurn(chat.id, content, images, documents);
      const run = await startRunMutation.mutateAsync({
        chatId: chat.id,
        agentId: options.activeAgentId,
        content,
        ...(options.selectedModelId === undefined
          ? {}
          : { modelId: options.selectedModelId }),
        ...(documents.length === 0
          ? {}
          : { fileIds: documents.map((attachment) => attachment.fileId) }),
        ...(images.length === 0
          ? {}
          : {
              attachments: images.map((attachment) => ({
                dataBase64: attachment.dataBase64,
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
              })),
            }),
        ...(options.webSearchEnabled ? { webSearch: true } : {}),
        ...(options.attachedUrls.length === 0
          ? {}
          : { urls: options.attachedUrls }),
      });
      options.setAttachedUrls([]);
      options.setActiveRunId(run.id);
      await options.consumeRunStream(run.id);
      await options.syncPersistedMessages(chat.id);
      await followQueuedRuns(chat.id, run.id);
      await options.refreshUsageControls();
    } catch (caught) {
      options.setError(
        caught instanceof Error ? caught.message : options.t("unableStartRun"),
      );
      options.setActiveRunId(undefined);
    } finally {
      images.forEach((attachment) =>
        URL.revokeObjectURL(attachment.previewUrl),
      );
    }
  }

  function appendOptimisticTurn(
    chatId: string,
    content: string,
    images: PendingImageAttachment[],
    documents: PendingDocumentAttachment[],
  ): void {
    options.appendMessage(chatId, "user", content, [
      ...images.map((attachment) => ({
        id: attachment.id,
        messageId: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        kind: "image" as const,
        retainedInContext: true,
        previewUrl: attachment.previewUrl,
      })),
      ...documents.map((attachment) => ({
        id: attachment.id,
        messageId: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        kind: "document" as const,
        retainedInContext: true,
        previewUrl: fileContentUrl(attachment.fileId),
      })),
    ]);
    options.appendMessage(chatId, "assistant", "");
  }

  async function regenerateLast(): Promise<void> {
    if (
      options.isStreaming ||
      options.activeChatId === undefined ||
      options.activeAgentId === undefined
    ) {
      return;
    }
    const lastUser = [...options.messages]
      .reverse()
      .find((message) => message.role === "user");
    if (lastUser === undefined) return;
    const trailingAssistant =
      options.messages.at(-1)?.role === "assistant"
        ? options.messages.at(-1)
        : undefined;
    options.setError(undefined);
    try {
      const attachments = await resolveAttachmentsForResend(
        lastUser.attachments,
      );
      const chatId = options.activeChatId;
      const run = await startRunMutation.mutateAsync({
        chatId,
        agentId: options.activeAgentId,
        content: lastUser.content,
        historyBoundaryMessageId: lastUser.id,
        ...(options.selectedModelId === undefined
          ? {}
          : { modelId: options.selectedModelId }),
        ...(attachments.length === 0 ? {} : { attachments }),
      });
      if (trailingAssistant !== undefined) {
        await deleteMessage(chatId, trailingAssistant.id);
      }
      await deleteMessage(chatId, lastUser.id);
      options.setMessages((current) =>
        current.slice(0, trailingAssistant === undefined ? -1 : -2),
      );
      options.appendMessage(
        chatId,
        "user",
        lastUser.content,
        lastUser.attachments,
      );
      options.appendMessage(chatId, "assistant", "");
      options.setActiveRunId(run.id);
      await options.consumeRunStream(run.id);
      await options.syncPersistedMessages(chatId);
      await options.refreshUsageControls();
    } catch (caught) {
      options.setError(
        caught instanceof Error
          ? caught.message
          : "Unable to regenerate the response.",
      );
      options.setActiveRunId(undefined);
    }
  }

  async function followQueuedRuns(chatId: string, previousRunId?: string) {
    let lastRunId = previousRunId;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const [activeRun, queue] = await Promise.all([
        getActiveChatRun(chatId),
        listQueuedTurns(chatId),
      ]);
      options.setQueuedTurns(queue);
      if (activeRun !== null && activeRun.id !== lastRunId) {
        options.setActiveRunId(activeRun.id);
        options.appendMessage(chatId, "assistant", "");
        await options.consumeRunStream(activeRun.id);
        await options.syncPersistedMessages(chatId);
        lastRunId = activeRun.id;
        attempt = 0;
        continue;
      }
      if (queue.every((turn) => turn.status === "failed")) return;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
  }

  async function handleBranchFromMessage(messageId: string) {
    if (
      options.activeChatId === undefined ||
      options.workspaceId === undefined ||
      options.isStreaming
    ) {
      return;
    }
    options.setError(undefined);
    try {
      const source = options.messages.find((item) => item.id === messageId);
      const fork = await forkChat({
        chatId: options.activeChatId,
        throughMessageId: messageId,
        includeAttachments: true,
        title: `Branch · ${(source?.content ?? "conversation").slice(0, 60)}`,
      });
      await options.queryClient.invalidateQueries({
        queryKey: ["chats", options.workspaceId],
      });
      options.setActiveChatId(fork.id);
      await options.syncPersistedMessages(fork.id);
    } catch (caught) {
      options.setError(
        caught instanceof Error ? caught.message : "Unable to branch chat.",
      );
    }
  }

  async function handleEditAndResend(messageId: string, content: string) {
    if (
      options.activeChatId === undefined ||
      options.activeAgentId === undefined ||
      options.isStreaming ||
      content.trim().length === 0
    ) {
      return;
    }
    const index = options.messages.findIndex((item) => item.id === messageId);
    const message = options.messages[index];
    if (message?.role !== "user") return;
    options.setError(undefined);
    try {
      const attachments = await resolveAttachmentsForResend(
        message.attachments,
      );
      const run = await startRunMutation.mutateAsync({
        chatId: options.activeChatId,
        agentId: options.activeAgentId,
        content: content.trim(),
        historyBoundaryMessageId: message.id,
        ...(options.selectedModelId === undefined
          ? {}
          : { modelId: options.selectedModelId }),
        ...(attachments.length === 0 ? {} : { attachments }),
      });
      await Promise.all(
        options.messages
          .slice(index)
          .map((item) => deleteMessage(options.activeChatId!, item.id)),
      );
      options.setMessages((current) => current.slice(0, index));
      options.appendMessage(
        options.activeChatId,
        "user",
        content.trim(),
        message.attachments,
      );
      options.appendMessage(options.activeChatId, "assistant", "");
      options.setActiveRunId(run.id);
      await options.consumeRunStream(run.id);
      await options.syncPersistedMessages(options.activeChatId);
      await options.refreshUsageControls();
    } catch (caught) {
      options.setError(
        caught instanceof Error
          ? caught.message
          : options.t("workspaceUnableEditMessage"),
      );
      options.setActiveRunId(undefined);
    }
  }

  async function handleContinueResponse() {
    await submitTurn("Continue from where you stopped.");
  }

  return {
    followQueuedRuns,
    handleBranchFromMessage,
    handleContinueResponse,
    handleEditAndResend,
    handleSubmit,
    regenerateLast,
  };
}

async function resolveAttachmentsForResend(
  attachments: Message["attachments"],
): Promise<
  Array<{
    dataBase64: string;
    fileName: string;
    mimeType: ImageAttachmentMimeType;
    sizeBytes: number;
  }>
> {
  if (attachments === undefined || attachments.length === 0) return [];
  const resolved = [];
  for (const attachment of attachments) {
    const mimeType = normalizeImageMimeType(attachment.mimeType);
    if (attachment.previewUrl === undefined || mimeType === undefined) continue;
    const response = await fetch(attachment.previewUrl);
    if (!response.ok) {
      throw new Error(`Unable to re-fetch attachment ${attachment.fileName}.`);
    }
    const blob = await response.blob();
    resolved.push({
      dataBase64: await blobToBase64(blob),
      fileName: attachment.fileName,
      mimeType,
      sizeBytes: blob.size,
    });
  }
  return resolved;
}
