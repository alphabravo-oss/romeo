import { useMutation, type QueryClient } from "@tanstack/react-query";
import type { Dispatch, FormEvent, SetStateAction } from "react";

import { createChat, fileContentUrl, forkChat, updateChat } from "../features";
import type { Chat, Message } from "../features/types";
import {
  enqueueChatTurn,
  getActiveChatRun,
  listQueuedTurns,
  startRun,
  type QueuedChatTurn,
} from "../features/runs";
import type { MessageKey } from "../lib/i18n";
import {
  fallbackChatTitle,
  generateAutomaticChatTitle,
} from "../lib/chat-titles";
import { trackRun } from "../lib/run-registry";
import { resolveAttachmentsForResend } from "./resend-attachments";
import type {
  PendingDocumentAttachment,
  PendingImageAttachment,
} from "./useWorkspaceAttachments";
import { isMessageActionEnabled, resolveTurnOutcome } from "./turn-rollback";

interface WorkspaceTurnActionsOptions {
  activeAgentId: string | undefined;
  activeChatId: string | undefined;
  /** Every message, sibling branches included; `messages` is the visible one. */
  allMessages: Message[];
  autoTitleEnabled: boolean;
  appendMessage: (
    chatId: string,
    role: Message["role"],
    content: string,
    attachments?: Message["attachments"],
    parentId?: string,
  ) => string;
  attachedUrls: string[];
  clearPendingAttachments: () => void;
  documentAttachments: PendingDocumentAttachment[];
  draft: string;
  imageAttachments: PendingImageAttachment[];
  isStreaming: boolean;
  messages: Message[];
  onChatCreated?: (chatId: string) => void;
  queryClient: QueryClient;
  refreshUsageControls: () => Promise<void>;
  restoreMessages: (chatId: string, snapshot: readonly Message[]) => void;
  restorePendingAttachments: (
    images: readonly PendingImageAttachment[],
    documents: readonly PendingDocumentAttachment[],
  ) => void;
  selectedModelId: string | undefined;
  setActiveChatId: Dispatch<SetStateAction<string | undefined>>;
  setAttachedUrls: Dispatch<SetStateAction<string[]>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setIsDraftingNewChat: Dispatch<SetStateAction<boolean>>;
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

  // Hands the run to the module-level registry and returns immediately. The
  // follow-up work runs when the stream settles, wherever the user is by then.
  // `afterRefresh` fires once the optimistic rows have been replaced by the
  // persisted ones, which is the earliest point their previews are disposable.
  function trackChatRun(
    chatId: string,
    runId: string,
    parentMessageId?: string,
    afterRefresh?: () => void,
  ): void {
    trackRun({
      chatId,
      runId,
      ...(parentMessageId === undefined ? {} : { parentMessageId }),
      queryClient: options.queryClient,
      t: options.t,
      onSettled: async () => {
        await options.syncPersistedMessages(chatId);
        afterRefresh?.();
        await options.refreshUsageControls();
        await followQueuedRuns(chatId, runId);
      },
    });
  }

  // Appends the optimistic user row and points the chat at it: a variant's row
  // hangs off an older parent, so without the pointer it would stream into a
  // branch the reader is not looking at. The server sets the same pointer.
  //
  // ponytail: a run always mints a user message, so a variant is always a
  // *user* sibling and the "‹ 2 / 3 ›" picker lands on the prompt, not on the
  // answer where ChatGPT puts it. Fixing that needs a user-message-free start.
  function appendTurnRow(
    chatId: string,
    content: string,
    attachments: Message["attachments"],
    parentId: string | undefined,
  ): string {
    const messageId = options.appendMessage(
      chatId,
      "user",
      content,
      attachments,
      parentId,
    );
    options.queryClient.setQueryData<Chat>(["chat", chatId], (current) =>
      current === undefined
        ? current
        : { ...current, activeLeafMessageId: messageId },
    );
    return messageId;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typedContent = options.draft.trim();
    const content =
      typedContent ||
      (options.imageAttachments.length > 0 ||
      options.documentAttachments.length > 0
        ? options.t("chatReviewAttachments")
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
      options.queryClient.setQueryData<QueuedChatTurn[]>(
        ["queuedTurns", options.activeChatId],
        await listQueuedTurns(options.activeChatId),
      );
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
    const snapshotChatId = options.activeChatId;
    const snapshot = {
      draft: options.draft,
      // Whole tree: a rollback rewrites the cache wholesale, and restoring
      // only the visible branch would drop the siblings.
      messages: options.allMessages,
    };
    let accepted = false;
    options.setError(undefined);
    options.setDraft("");
    options.clearPendingAttachments();
    try {
      const isNewChat = options.activeChatId === undefined;
      const chat = options.activeChatId
        ? { id: options.activeChatId }
        : await createChatMutation.mutateAsync({
            agentId: options.activeAgentId,
            workspaceId: options.workspaceId,
            title: fallbackChatTitle(content),
            ...(options.temporaryNextChat ? { temporary: true } : {}),
          });
      options.setActiveChatId(chat.id);
      if (isNewChat) options.onChatCreated?.(chat.id);
      if (options.selectedModelId !== undefined && isNewChat) {
        await updateChat(chat.id, { modelId: options.selectedModelId });
      }
      options.setIsDraftingNewChat(false);
      options.setTemporaryNextChat(false);
      await options.queryClient.invalidateQueries({
        queryKey: ["chats", options.workspaceId],
      });
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
      accepted = true;
      const userMessageId = appendOptimisticTurn(
        chat.id,
        content,
        images,
        documents,
        options.messages.at(-1)?.id,
      );
      options.setAttachedUrls([]);
      const outcome = resolveTurnOutcome({ snapshot, accepted });
      trackChatRun(chat.id, run.id, userMessageId, () => {
        // Revoked on the success path only, and only once the persisted rows
        // have landed: on failure the attachments go back to the composer, and
        // a revoked object URL renders as a broken image either way.
        if (!outcome.revokePreviews) return;
        images.forEach((attachment) =>
          URL.revokeObjectURL(attachment.previewUrl),
        );
      });
      await generateAutomaticChatTitle({
        chatId: chat.id,
        enabled: isNewChat && options.autoTitleEnabled,
        modelId: options.selectedModelId,
        queryClient: options.queryClient,
        workspaceId: options.workspaceId,
      });
    } catch (caught) {
      options.setError(
        caught instanceof Error ? caught.message : options.t("unableStartRun"),
      );
      const outcome = resolveTurnOutcome({ snapshot, accepted });
      if (!accepted) {
        options.setDraft(outcome.draft);
        if (snapshotChatId !== undefined) {
          options.restoreMessages(snapshotChatId, outcome.messages);
        }
        options.restorePendingAttachments(images, documents);
      }
    }
  }

  function appendOptimisticTurn(
    chatId: string,
    content: string,
    images: PendingImageAttachment[],
    documents: PendingDocumentAttachment[],
    parentMessageId: string | undefined,
  ): string {
    return appendTurnRow(
      chatId,
      content,
      [
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
      ],
      parentMessageId,
    );
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
    options.setError(undefined);
    try {
      const attachments = await resolveAttachmentsForResend(
        lastUser.attachments,
      );
      const chatId = options.activeChatId;
      // Nothing is deleted any more: the resend hangs off the same parent as
      // the turn it replaces, so both answers stay in the tree. No history
      // boundary either -- the branch stops short of the replaced turn already.
      const run = await startRunMutation.mutateAsync({
        chatId,
        agentId: options.activeAgentId,
        content: lastUser.content,
        parentMessageId: lastUser.parentId ?? null,
        ...(options.selectedModelId === undefined
          ? {}
          : { modelId: options.selectedModelId }),
        ...(attachments.length === 0 ? {} : { attachments }),
      });
      const userMessageId = appendTurnRow(
        chatId,
        lastUser.content,
        lastUser.attachments,
        lastUser.parentId,
      );
      trackChatRun(chatId, run.id, userMessageId);
    } catch (caught) {
      options.setError(
        caught instanceof Error
          ? caught.message
          : "Unable to regenerate the response.",
      );
    }
  }

  async function followQueuedRuns(chatId: string, previousRunId?: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const [activeRun, queue] = await Promise.all([
        getActiveChatRun(chatId),
        listQueuedTurns(chatId),
      ]);
      // Keyed by the chat being drained, not by the chat on screen: this loop
      // runs from a settled background run and polls for up to three seconds.
      options.queryClient.setQueryData<QueuedChatTurn[]>(
        ["queuedTurns", chatId],
        queue,
      );
      // Hand the drained turn to the registry and stop: its own settle hook
      // calls back here, so the queue drains without holding this loop open.
      if (activeRun !== null && activeRun.id !== previousRunId) {
        trackChatRun(chatId, activeRun.id);
        return;
      }
      if (queue.every((turn) => turn.status === "failed")) return;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
  }

  async function handleBranchFromMessage(messageId: string) {
    if (
      !isMessageActionEnabled({
        isStreaming: options.isStreaming,
        hasActiveChat: options.activeChatId !== undefined,
      }) ||
      options.workspaceId === undefined ||
      options.activeChatId === undefined
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

  async function handleEditAndResend(
    messageId: string,
    content: string,
  ): Promise<boolean> {
    if (
      !isMessageActionEnabled({
        isStreaming: options.isStreaming,
        hasActiveChat: options.activeChatId !== undefined,
      }) ||
      options.activeChatId === undefined ||
      options.activeAgentId === undefined ||
      content.trim().length === 0
    ) {
      return false;
    }
    const message = options.messages.find((item) => item.id === messageId);
    if (message?.role !== "user") return false;
    options.setError(undefined);
    try {
      const chatId = options.activeChatId;
      const attachments = await resolveAttachmentsForResend(
        message.attachments,
      );
      // A sibling of the original, not a replacement: the turns that followed
      // it stay on their own branch, one variant step away.
      const run = await startRunMutation.mutateAsync({
        chatId,
        agentId: options.activeAgentId,
        content: content.trim(),
        parentMessageId: message.parentId ?? null,
        ...(options.selectedModelId === undefined
          ? {}
          : { modelId: options.selectedModelId }),
        ...(attachments.length === 0 ? {} : { attachments }),
      });
      const userMessageId = appendTurnRow(
        chatId,
        content.trim(),
        message.attachments,
        message.parentId,
      );
      trackChatRun(chatId, run.id, userMessageId);
      return true;
    } catch (caught) {
      options.setError(
        caught instanceof Error
          ? caught.message
          : options.t("workspaceUnableEditMessage"),
      );
      return false;
    }
  }

  async function handleContinueResponse() {
    await submitTurn(options.t("chatContinueResponse"));
  }

  return {
    followQueuedRuns,
    handleBranchFromMessage,
    handleContinueResponse,
    handleEditAndResend,
    handleSubmit,
    regenerateLast,
    trackChatRun,
  };
}
