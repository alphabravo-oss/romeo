import { useMutation } from "@tanstack/react-query";
import type { FormEvent } from "react";

import { updateChat } from "../features";
import {
  createWorkspaceChatMutationOptions,
  forkWorkspaceChatMutationOptions,
} from "../features/chats/mutation-options";
import type { Message } from "../features/types";
import { RomeoApiError } from "@romeo/api-client";
import { getActiveChatRun, listQueuedTurns } from "../features/runs";
import {
  enqueueChatTurnMutationOptions,
  startRunMutationOptions,
} from "../features/runs/mutation-options";
import { replaceQueuedTurnsCache } from "../features/runs/cache-policy";
import {
  fallbackChatTitle,
  generateAutomaticChatTitle,
} from "../lib/chat-titles";
import { trackRun } from "../lib/run-registry";
import {
  readyDocuments,
  readyImages,
  trayBlocksSend,
} from "./composer-tray-lifecycle";
import { optimisticTurnAttachments } from "./optimistic-turn-attachments";
import { resolveAttachmentsForResend } from "./resend-attachments";
import { formatBranchTitle, rememberBranchOrigin } from "./chat-enterprise";
import { isMessageActionEnabled, resolveTurnOutcome } from "./turn-rollback";
import type {
  PendingDocumentAttachment,
  PendingImageAttachment,
} from "./useWorkspaceAttachments";
import type { WorkspaceTurnActionsOptions } from "./workspace-turn-actions-types";
import { workspaceTurnExecutionMode } from "./workspace-turn-execution-mode";
import { safeUserErrorMessage } from "../lib/safe-user-error";

export function useWorkspaceTurnActions(options: WorkspaceTurnActionsOptions) {
  const createChatMutation = useMutation(createWorkspaceChatMutationOptions());
  const startRunMutation = useMutation(startRunMutationOptions());
  const enqueueTurnMutation = useMutation(enqueueChatTurnMutationOptions());
  const forkChatMutation = useMutation(forkWorkspaceChatMutationOptions());
  const executionMode = workspaceTurnExecutionMode(options);

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
        options.onBranchSelection?.(chatId, `msg_run_terminal_${runId}`);
        try {
          await options.syncPersistedMessages(chatId, [
            ...(parentMessageId === undefined ? [] : [parentMessageId]),
            `msg_run_terminal_${runId}`,
          ]);
          afterRefresh?.();
        } catch (caught) {
          options.setError(
            safeUserErrorMessage(caught, options.t("unexpectedAsyncFailure")),
          );
        }
        await options.refreshUsageControls();
        await followQueuedRuns(chatId, runId);
      },
    });
  }

  function appendTurnRow(
    chatId: string,
    content: string,
    attachments: Message["attachments"],
    parentId: string | undefined,
    messageId: string,
  ): string {
    options.appendMessage(
      chatId,
      "user",
      content,
      attachments,
      parentId,
      messageId,
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
    if (trayBlocksSend([...options.imageAttachments, ...options.documentAttachments])) {
      options.setError(options.t("trayWaitForUploads"));
      return;
    }
    if (options.isStreaming) {
      await enqueueTurn(content);
      return;
    }
    if (options.activeChatId !== undefined) {
      const activeRun = await getActiveChatRun(options.activeChatId);
      if (activeRun !== null) {
        trackChatRun(options.activeChatId, activeRun.id);
        await enqueueTurn(content);
        return;
      }
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
      await enqueueTurnMutation.mutateAsync({
        chatId: options.activeChatId,
        agentId: options.activeAgentId,
        content,
        parentMessageId: options.messages.at(-1)?.id ?? null,
        ...(options.selectedModelId === undefined
          ? {}
          : { modelId: options.selectedModelId }),
        ...executionMode,
        ...(options.webSearchEnabled ? { webSearch: true } : {}),
        ...(options.agenticRagEnabled ? { agenticRag: true } : {}),
        ...(options.attachedUrls.length === 0
          ? {}
          : { urls: options.attachedUrls }),
        ...(options.knowledgeBaseIdsOverride === undefined
          ? {}
          : { knowledgeBaseIds: options.knowledgeBaseIdsOverride }),
      });
      options.setDraft("");
      options.setAttachedUrls([]);
    } catch (caught) {
      options.setError(safeUserErrorMessage(caught, options.t("unableQueue")));
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
      const parentMessageId = options.messages.at(-1)?.id ?? null;
      const run = await startRunMutation.mutateAsync({
        chatId: chat.id,
        agentId: options.activeAgentId,
        content,
        parentMessageId,
        ...(options.selectedModelId === undefined
          ? {}
          : { modelId: options.selectedModelId }),
        ...executionMode,
        ...(readyDocuments(documents).length === 0
          ? {}
          : { fileIds: readyDocuments(documents).map((item) => item.fileId) }),
        ...(readyImages(images).length === 0
          ? {}
          : {
              attachments: readyImages(images).map((attachment) => ({
                dataBase64: attachment.dataBase64,
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
              })),
            }),
        ...(options.webSearchEnabled ? { webSearch: true } : {}),
        ...(options.agenticRagEnabled ? { agenticRag: true } : {}),
        ...(options.attachedUrls.length === 0
          ? {}
          : { urls: options.attachedUrls }),
        ...(options.knowledgeBaseIdsOverride === undefined
          ? {}
          : { knowledgeBaseIds: options.knowledgeBaseIdsOverride }),
      });
      accepted = true;
      const userMessageId = appendTurnRow(
        chat.id,
        content,
        optimisticTurnAttachments(images, documents),
        parentMessageId ?? undefined,
        run.inputMessageId,
      );
      options.onBranchSelection?.(chat.id, run.inputMessageId);
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
      if (
        caught instanceof RomeoApiError &&
        caught.code === "chat_run_in_progress"
      ) {
        options.setDraft(content);
        if (snapshotChatId !== undefined) {
          options.restoreMessages(snapshotChatId, snapshot.messages);
        }
        options.restorePendingAttachments(images, documents);
        await enqueueTurn(content);
        return;
      }
      options.setError(
        safeUserErrorMessage(caught, options.t("unableStartRun")),
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

  async function regenerateLast(input?: {
    modelId?: string;
    /** Sibling re-answer of the last user turn, optionally on another model. */
    mode?: "again" | "shorter";
  }): Promise<void> {
    if (
      options.isStreaming ||
      options.activeChatId === undefined ||
      options.activeAgentId === undefined
    ) {
      return;
    }
    const mode = input?.mode ?? "again";
    // "Shorter" is a new follow-up turn, not a sibling regenerate: the user is
    // asking for a rewrite, so it should sit after the previous answer.
    if (mode === "shorter") {
      await submitTurn(options.t("regenerateShorterPrompt"));
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
      const modelId = input?.modelId ?? options.selectedModelId;
      // Nothing is deleted any more: the resend hangs off the same parent as
      // the turn it replaces, so both answers stay in the tree. No history
      // boundary either -- the branch stops short of the replaced turn already.
      const run = await startRunMutation.mutateAsync({
        chatId,
        agentId: options.activeAgentId,
        content: lastUser.content,
        parentMessageId: lastUser.parentId ?? null,
        ...(modelId === undefined ? {} : { modelId }),
        ...executionMode,
        ...(attachments.length === 0 ? {} : { attachments }),
        ...(options.webSearchEnabled ? { webSearch: true } : {}),
        ...(options.agenticRagEnabled ? { agenticRag: true } : {}),
        ...(options.knowledgeBaseIdsOverride === undefined
          ? {}
          : { knowledgeBaseIds: options.knowledgeBaseIdsOverride }),
      });
      const userMessageId = appendTurnRow(
        chatId,
        lastUser.content,
        lastUser.attachments,
        lastUser.parentId,
        run.inputMessageId,
      );
      options.onBranchSelection?.(chatId, run.inputMessageId);
      trackChatRun(chatId, run.id, userMessageId);
    } catch (caught) {
      options.setError(
        safeUserErrorMessage(caught, "Unable to regenerate the response."),
      );
    }
  }

  async function handleFollowUp(prompt: string): Promise<void> {
    await submitTurn(prompt);
  }

  async function followQueuedRuns(chatId: string, previousRunId?: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const [activeRun, queue] = await Promise.all([
        getActiveChatRun(chatId),
        listQueuedTurns(chatId),
      ]);
      // Keyed by the chat being drained, not by the chat on screen: this loop
      // runs from a settled background run and polls for up to three seconds.
      replaceQueuedTurnsCache(options.queryClient, chatId, queue);
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
      const sourceChat = options.activeChatId;
      const sourceTitle =
        options.chats.find((c) => c.id === sourceChat)?.title ??
        "Untitled chat";
      const fork = await forkChatMutation.mutateAsync({
        chatId: options.activeChatId,
        throughMessageId: messageId,
        includeAttachments: true,
        title: formatBranchTitle(sourceTitle),
        workspaceId: options.workspaceId,
      });
      rememberBranchOrigin({
        forkChatId: fork.id,
        sourceChatId: sourceChat,
        sourceTitle,
      });
      options.setActiveChatId(fork.id);
      await options.syncPersistedMessages(fork.id);
    } catch (caught) {
      options.setError(safeUserErrorMessage(caught, "Unable to branch chat."));
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
        ...executionMode,
        ...(attachments.length === 0 ? {} : { attachments }),
        ...(options.webSearchEnabled ? { webSearch: true } : {}),
        ...(options.agenticRagEnabled ? { agenticRag: true } : {}),
        ...(options.knowledgeBaseIdsOverride === undefined
          ? {}
          : { knowledgeBaseIds: options.knowledgeBaseIdsOverride }),
      });
      const userMessageId = appendTurnRow(
        chatId,
        content.trim(),
        message.attachments,
        message.parentId,
        run.inputMessageId,
      );
      options.onBranchSelection?.(chatId, run.inputMessageId);
      trackChatRun(chatId, run.id, userMessageId);
      return true;
    } catch (caught) {
      options.setError(
        safeUserErrorMessage(caught, options.t("workspaceUnableEditMessage")),
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
    handleFollowUp,
    handleSubmit,
    regenerateLast,
    trackChatRun,
  };
}
