import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import {
  archiveChat,
  cancelRun,
  cloneAgent,
  createChat,
  createProvider,
  deleteMessage,
  generateMessageSpeech,
  listMessages,
  startRun,
  syncProviderModels,
  streamRunEvents,
  transcribeVoice,
  updateChat,
  updateModelPricing,
} from "../api/client";
import type { Message, SpeechArtifact } from "../api/types";
import { useToolExecution } from "./useToolExecution";
import { useWorkspaceData } from "./useWorkspaceData";

const initialDraft = "";
const maxImageAttachmentBytes = 5_000_000;
const maxImageAttachments = 4;
const supportedImageMimeTypes = new Set<ImageAttachmentMimeType>([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type ImageAttachmentMimeType =
  | "image/gif"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export interface PendingImageAttachment {
  dataBase64: string;
  fileName: string;
  id: string;
  mimeType: ImageAttachmentMimeType;
  previewUrl: string;
  sizeBytes: number;
}

export function useWorkspaceController() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initialDraft);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string>();
  const [activeChatId, setActiveChatId] = useState<string>();
  const [activeRunId, setActiveRunId] = useState<string>();
  const [speechArtifacts, setSpeechArtifacts] = useState<
    Record<string, SpeechArtifact>
  >({});
  const [speechMessageId, setSpeechMessageId] = useState<string>();
  const [imageAttachments, setImageAttachments] = useState<
    PendingImageAttachment[]
  >([]);
  const [syncingProviderId, setSyncingProviderId] = useState<string>();
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController | undefined>(undefined);
  const {
    activeAgent,
    agents,
    chats,
    models,
    providerOperationalSummary,
    providers,
    subject,
    tools,
    workspace,
  } = useWorkspaceData(activeAgentId);
  const toolExecution = useToolExecution(activeAgent, tools, setError);
  const createChatMutation = useMutation({ mutationFn: createChat });
  const cloneAgentMutation = useMutation({ mutationFn: cloneAgent });
  const createProviderMutation = useMutation({ mutationFn: createProvider });
  const updateModelPricingMutation = useMutation({
    mutationFn: updateModelPricing,
  });
  const generateSpeechMutation = useMutation({
    mutationFn: generateMessageSpeech,
  });
  const transcribeVoiceMutation = useMutation({ mutationFn: transcribeVoice });
  const startRunMutation = useMutation({ mutationFn: startRun });
  const isStreaming = activeRunId !== undefined;
  const firstChatId = chats[0]?.id;

  useEffect(() => {
    if (activeChatId !== undefined || firstChatId === undefined || isStreaming)
      return;
    setActiveChatId(firstChatId);
    void syncPersistedMessages(firstChatId).catch((caught) =>
      setError(
        caught instanceof Error ? caught.message : "Unable to load chat.",
      ),
    );
  }, [activeChatId, firstChatId, isStreaming]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (
      content.length === 0 ||
      workspace === undefined ||
      activeAgent === undefined ||
      isStreaming
    )
      return;
    const attachmentsForRun = imageAttachments;

    setError(undefined);
    setDraft("");
    setImageAttachments([]);

    try {
      const chat = activeChatId
        ? { id: activeChatId }
        : await createChatMutation.mutateAsync({
            workspaceId: workspace.id,
            title: content.slice(0, 80),
          });

      setActiveChatId(chat.id);
      await queryClient.invalidateQueries({
        queryKey: ["chats", workspace.id],
      });
      appendMessage(
        "user",
        content,
        attachmentsForRun.map((attachment) => ({
          id: attachment.id,
          messageId: attachment.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          kind: "image",
          previewUrl: attachment.previewUrl,
        })),
      );
      appendMessage("assistant", "");

      const run = await startRunMutation.mutateAsync({
        chatId: chat.id,
        agentId: activeAgent.id,
        content,
        ...(attachmentsForRun.length === 0
          ? {}
          : {
              attachments: attachmentsForRun.map((attachment) => ({
                dataBase64: attachment.dataBase64,
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
              })),
            }),
      });
      setActiveRunId(run.id);
      await consumeRunStream(run.id);
      await syncPersistedMessages(chat.id);
      await refreshUsageControls();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to start run.",
      );
      setActiveRunId(undefined);
    } finally {
      attachmentsForRun.forEach((attachment) =>
        URL.revokeObjectURL(attachment.previewUrl),
      );
    }
  }

  async function regenerateLast(): Promise<void> {
    if (isStreaming || activeChatId === undefined || activeAgent === undefined)
      return;

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser === undefined) return;

    // Only the trailing assistant turn is being replaced. If the last
    // message isn't an assistant reply (e.g. a prior run never completed),
    // there is nothing trailing to remove.
    const trailingAssistant =
      messages.at(-1)?.role === "assistant" ? messages.at(-1) : undefined;

    setError(undefined);
    try {
      // Resolve attachment bytes before starting anything, so a failed
      // re-fetch aborts cleanly instead of destroying the old answer first.
      const attachmentsForRun = await resolveAttachmentsForResend(
        lastUser.attachments,
      );

      const chatId = activeChatId;

      // Start the new run before touching the old pair. Both deletes commit
      // server-side with no soft delete, so if startRun fails (quota,
      // provider outage, network blip), the user's prompt and the previous
      // answer must still be there afterward — only delete once the run has
      // actually started.
      const run = await startRunMutation.mutateAsync({
        chatId,
        agentId: activeAgent.id,
        content: lastUser.content,
        ...(attachmentsForRun.length === 0
          ? {}
          : { attachments: attachmentsForRun }),
      });

      if (trailingAssistant !== undefined)
        await deleteMessage(chatId, trailingAssistant.id);
      await deleteMessage(chatId, lastUser.id);

      setMessages((current) =>
        current.slice(0, trailingAssistant === undefined ? -1 : -2),
      );
      appendMessage("user", lastUser.content, lastUser.attachments);
      appendMessage("assistant", "");

      setActiveRunId(run.id);
      await consumeRunStream(run.id);
      await syncPersistedMessages(chatId);
      await refreshUsageControls();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to regenerate the response.",
      );
      setActiveRunId(undefined);
    }
  }

  async function consumeRunStream(runId: string) {
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      for await (const event of streamRunEvents(runId, controller.signal)) {
        if (event.type === "message.delta")
          appendAssistantDelta((event.data as { text?: string }).text ?? "");
        if (event.type === "run.failed") setError("The run failed.");
      }
    } finally {
      abortRef.current = undefined;
      setActiveRunId(undefined);
    }
  }

  function handleCancel() {
    const runId = activeRunId;
    if (!runId) return;
    abortRef.current?.abort();
    void cancelRun(runId).catch((caught) =>
      setError(
        caught instanceof Error ? caught.message : "Unable to cancel run.",
      ),
    );
    setActiveRunId(undefined);
  }

  async function handleSelectChat(chatId: string) {
    if (isStreaming) return;
    setActiveChatId(chatId);
    setError(undefined);
    await syncPersistedMessages(chatId);
  }

  function handleNewChat() {
    if (isStreaming) return;
    setActiveChatId(undefined);
    setMessages([]);
    setSpeechArtifacts({});
    setError(undefined);
  }

  async function handleCloneAgent() {
    if (activeAgent === undefined || workspace === undefined) return;

    setError(undefined);
    try {
      const cloned = await cloneAgentMutation.mutateAsync({
        agentId: activeAgent.id,
        name: `${activeAgent.name} copy`,
      });
      setActiveAgentId(cloned.id);
      await queryClient.invalidateQueries({
        queryKey: ["agents", workspace.id],
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to clone agent.",
      );
    }
  }

  async function handleCreateProvider(
    input: Parameters<typeof createProvider>[0],
  ) {
    setError(undefined);
    try {
      await createProviderMutation.mutateAsync(input);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["providers"] }),
        queryClient.invalidateQueries({
          queryKey: ["providerOperationalSummary"],
        }),
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to create provider.",
      );
    }
  }

  async function handleSyncProvider(providerId: string) {
    setError(undefined);
    setSyncingProviderId(providerId);
    try {
      await syncProviderModels(providerId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["models"] }),
        queryClient.invalidateQueries({
          queryKey: ["providerOperationalSummary"],
        }),
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to sync provider models.",
      );
    } finally {
      setSyncingProviderId(undefined);
    }
  }

  async function handleUpdateModelPricing(
    input: Parameters<typeof updateModelPricing>[0],
  ) {
    setError(undefined);
    try {
      await updateModelPricingMutation.mutateAsync(input);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["models"] }),
        queryClient.invalidateQueries({ queryKey: ["usageSummary"] }),
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to update model pricing.",
      );
    }
  }

  async function handleChatDeleted(chatId: string) {
    if (activeChatId === chatId) {
      setActiveChatId(undefined);
      setMessages([]);
      setSpeechArtifacts({});
    }
    await Promise.all([
      workspace
        ? queryClient.invalidateQueries({ queryKey: ["chats", workspace.id] })
        : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: ["chatComments", chatId] }),
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      queryClient.invalidateQueries({ queryKey: ["notificationDeliveries"] }),
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] }),
      queryClient.invalidateQueries({ queryKey: ["usageEvents"] }),
      queryClient.invalidateQueries({ queryKey: ["usageSummary"] }),
    ]);
  }

  async function handleChatArchived(chatId: string) {
    if (activeChatId === chatId) {
      setActiveChatId(undefined);
      setMessages([]);
      setSpeechArtifacts({});
    }
    await Promise.all([
      workspace
        ? queryClient.invalidateQueries({ queryKey: ["chats", workspace.id] })
        : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: ["chatComments", chatId] }),
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] }),
      queryClient.invalidateQueries({ queryKey: ["accessReview"] }),
    ]);
  }

  async function renameChat(chatId: string, title: string): Promise<void> {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    setError(undefined);
    try {
      await updateChat(chatId, { title: trimmed });
      if (workspace !== undefined)
        await queryClient.invalidateQueries({
          queryKey: ["chats", workspace.id],
        });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to rename chat.",
      );
    }
  }

  async function deleteChat(chatId: string): Promise<void> {
    setError(undefined);
    try {
      // Archive, not hard-delete: it is what the API exposes, it is
      // reversible, and it respects the retention/legal-hold rules already
      // in the domain. handleChatArchived resets the active chat (if this
      // was it) and refreshes every query the chat list depends on.
      await archiveChat(chatId);
      await handleChatArchived(chatId);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to delete chat.",
      );
    }
  }

  async function handleWorkspaceArchived(workspaceId: string) {
    setActiveChatId(undefined);
    setActiveAgentId(undefined);
    setMessages([]);
    setSpeechArtifacts({});
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["bootstrap"] }),
      queryClient.invalidateQueries({ queryKey: ["agents", workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["chats", workspaceId] }),
      queryClient.invalidateQueries({
        queryKey: ["knowledgeBases", workspaceId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["agentGallery", workspaceId],
      }),
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] }),
      queryClient.invalidateQueries({ queryKey: ["accessReview"] }),
    ]);
  }

  async function syncPersistedMessages(chatId: string) {
    const savedMessages = await listMessages(chatId);
    setMessages(savedMessages);
  }

  async function handleGenerateSpeech(messageId: string) {
    const voiceProfileId = activeAgent?.voiceProfileId;
    if (voiceProfileId === undefined) {
      setError("Select an agent voice before generating speech.");
      return;
    }
    setError(undefined);
    setSpeechMessageId(messageId);
    try {
      const artifact = await generateSpeechMutation.mutateAsync({
        messageId,
        voiceProfileId,
      });
      setSpeechArtifacts((current) => ({ ...current, [messageId]: artifact }));
      await refreshUsageControls();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to generate speech.",
      );
    } finally {
      setSpeechMessageId(undefined);
    }
  }

  async function handleTranscribeAudio(blob: Blob) {
    if (blob.size > 10_000_000) {
      setError("Voice input is limited to 10 MB.");
      return;
    }
    setError(undefined);
    try {
      const result = await transcribeVoiceMutation.mutateAsync({
        audioBase64: await blobToBase64(blob),
        contentType: blob.type || "audio/webm",
        fileName: `voice-input.${audioExtension(blob.type)}`,
      });
      setDraft((current) =>
        `${current}${current.trim().length > 0 ? " " : ""}${result.text}`.trimStart(),
      );
      await refreshUsageControls();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to transcribe voice input.",
      );
    }
  }

  async function handleAttachImage(file: File | undefined) {
    if (file === undefined) return;
    const mimeType = normalizeImageMimeType(file.type);
    if (mimeType === undefined) {
      setError("Image attachments support PNG, JPEG, GIF, and WebP.");
      return;
    }
    if (file.size <= 0 || file.size > maxImageAttachmentBytes) {
      setError("Image attachments are limited to 5 MB each.");
      return;
    }
    if (imageAttachments.length >= maxImageAttachments) {
      setError("A message can include up to four image attachments.");
      return;
    }
    setError(undefined);
    const attachment: PendingImageAttachment = {
      id: clientMessageId(),
      fileName: safeImageFileName(file.name),
      mimeType,
      sizeBytes: file.size,
      dataBase64: await blobToBase64(file),
      previewUrl: URL.createObjectURL(file),
    };
    setImageAttachments((current) => [...current, attachment]);
  }

  function handleRemoveImageAttachment(attachmentId: string) {
    setImageAttachments((current) => {
      const removed = current.find(
        (attachment) => attachment.id === attachmentId,
      );
      if (removed !== undefined) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((attachment) => attachment.id !== attachmentId);
    });
  }

  function appendMessage(
    role: Message["role"],
    content: string,
    attachments?: Message["attachments"],
  ) {
    const message: Message = {
      id: clientMessageId(),
      role,
      content,
      createdAt: new Date().toISOString(),
    };
    if (attachments !== undefined && attachments.length > 0)
      message.attachments = attachments;
    setMessages((current) => [...current, message]);
  }

  function appendAssistantDelta(delta: string) {
    setMessages((current) => {
      const next = [...current];
      const last = next.at(-1);
      if (last?.role === "assistant")
        next[next.length - 1] = { ...last, content: last.content + delta };
      return next;
    });
  }

  async function refreshUsageControls() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["usageEvents"] }),
      queryClient.invalidateQueries({ queryKey: ["usageSummary"] }),
      queryClient.invalidateQueries({ queryKey: ["usageAlerts"] }),
      queryClient.invalidateQueries({
        queryKey: ["providerOperationalSummary"],
      }),
      queryClient.invalidateQueries({ queryKey: ["quotas"] }),
    ]);
  }

  return {
    activeAgent,
    activeAgentId,
    activeChatId,
    agents,
    chats,
    deleteChat,
    draft,
    error,
    handleCancel,
    handleChatArchived,
    handleChatDeleted,
    handleWorkspaceArchived,
    handleCloneAgent,
    handleCreateProvider,
    handleApproveTool: toolExecution.approvePendingTool,
    handleCancelToolApproval: toolExecution.cancelPendingTool,
    handleExecuteCalculator: toolExecution.handleExecuteCalculator,
    handleExecuteDateTime: toolExecution.handleExecuteDateTime,
    handleGenerateSpeech,
    handleAttachImage,
    handleNewChat,
    handleRemoveImageAttachment,
    handleTranscriptionError: setError,
    handleTranscribeAudio,
    handleSelectChat,
    handleSubmit,
    handleSyncProvider,
    handleUpdateModelPricing,
    isCloningAgent: cloneAgentMutation.isPending,
    isCreatingProvider: createProviderMutation.isPending,
    isExecutingTool: toolExecution.isExecutingTool,
    isGeneratingSpeech: generateSpeechMutation.isPending,
    isTranscribingVoice: transcribeVoiceMutation.isPending,
    isUpdatingModelPricing: updateModelPricingMutation.isPending,
    isStreaming,
    imageAttachments,
    messages,
    models,
    pendingToolApproval: toolExecution.pendingApproval,
    providers,
    providerOperationalSummary,
    regenerateLast,
    renameChat,
    setActiveAgentId,
    setDraft,
    speechArtifacts,
    speechMessageId,
    subject,
    syncingProviderId,
    toolResult: toolExecution.toolResult,
    tools,
    workspace,
  };
}

// Persisted message attachments only carry metadata plus a fetchable
// previewUrl, not the original base64 bytes. Regenerating a message that had
// an image means re-fetching those bytes so the run can resend them, or the
// image would silently disappear from the new answer's context.
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
  const resolved: Array<{
    dataBase64: string;
    fileName: string;
    mimeType: ImageAttachmentMimeType;
    sizeBytes: number;
  }> = [];
  for (const attachment of attachments) {
    const mimeType = normalizeImageMimeType(attachment.mimeType);
    if (attachment.previewUrl === undefined || mimeType === undefined)
      continue;
    const response = await fetch(attachment.previewUrl);
    if (!response.ok)
      throw new Error(`Unable to re-fetch attachment ${attachment.fileName}.`);
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

function normalizeImageMimeType(
  value: string,
): ImageAttachmentMimeType | undefined {
  const normalized = value.split(";", 1)[0]?.toLowerCase() ?? "";
  return supportedImageMimeTypes.has(normalized as ImageAttachmentMimeType)
    ? (normalized as ImageAttachmentMimeType)
    : undefined;
}

function safeImageFileName(fileName: string): string {
  const leaf = fileName.split(/[\\/]/u).pop()?.trim() ?? "";
  const normalized = leaf
    .replace(/[^A-Za-z0-9._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 160);
  return normalized.length === 0 ? "image" : normalized;
}

function clientMessageId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function")
    return randomUUID.call(globalThis.crypto);
  return `client_msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Unable to read audio."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(blob);
  });
  return dataUrl.split(",", 2)[1] ?? "";
}

function audioExtension(contentType: string): string {
  const normalized = contentType.split(";", 1)[0]?.toLowerCase() ?? "";
  if (normalized === "audio/mp4") return "m4a";
  if (normalized === "audio/ogg") return "ogg";
  if (normalized === "audio/wav") return "wav";
  return "webm";
}
