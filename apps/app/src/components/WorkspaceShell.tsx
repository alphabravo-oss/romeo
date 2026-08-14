import { NativeSelect } from "@romeo/ui";
import Box from "lucide-react/dist/esm/icons/box.mjs";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid.mjs";
import SquarePen from "lucide-react/dist/esm/icons/square-pen.mjs";
import { useQuery } from "@tanstack/react-query";
import {
  Suspense,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { chatSharesQueryOptions } from "../features/collaboration";
import { type AppCommand, useRegisterCommands } from "../lib/commands";
import { useLocale } from "../lib/i18n";
import { resolveChatAuthorNames } from "./assistant-selection";
import { isGenericCustomModelName, resolveChatAccess } from "./chat-enterprise";
import { ChatHeaderTitle } from "./ChatHeaderTitle";
import { downloadChatMarkdown } from "./workspace-nav-portability";
import { useWorkspaceController } from "./useWorkspaceController";
import { useWorkspaceShellMessageHandlers } from "./useWorkspaceShellMessageHandlers";
import { useWorkspace } from "./WorkspaceContext";
import { WorkspaceNav } from "./WorkspaceNav";
import type { WorkspaceNavDialog } from "./WorkspaceNavDialogs";
import { WorkspaceUserMenu } from "./WorkspaceUserMenu";
import { ThemeToggle } from "./ThemeToggle";
import {
  LazyChatPanel,
  LazyWorkspaceNavDialogs,
} from "./workspace-lazy-components";

const subscribeToHydration = () => () => {};

export function WorkspaceShell({
  onAgentSelection,
  onChatSelection,
  onBranchSelection,
  requestedAgentId,
  requestedChatId,
  requestedLeafMessageId,
}: {
  onAgentSelection?: (agentId: string) => void;
  onChatSelection?: (
    chatId: string | undefined,
    options?: { replace: boolean },
  ) => void;
  onBranchSelection?: (
    leafMessageId: string | undefined,
    options?: { replace: boolean },
  ) => void;
  requestedAgentId?: string;
  requestedChatId?: string;
  requestedLeafMessageId?: string;
}) {
  const { t } = useLocale();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const workspace = useWorkspaceController({
    ...(onAgentSelection === undefined ? {} : { onAgentSelection }),
    ...(onChatSelection === undefined ? {} : { onChatSelection }),
    ...(onBranchSelection === undefined ? {} : { onBranchSelection }),
    ...(requestedAgentId === undefined ? {} : { requestedAgentId }),
    ...(requestedChatId === undefined ? {} : { requestedChatId }),
    ...(requestedLeafMessageId === undefined ? {} : { requestedLeafMessageId }),
  });
  const { agents, handleNewChat, setActiveAgentId } = workspace;
  const namedCustomModels = useMemo(
    () =>
      agents.filter(
        (agent) =>
          agent.readinessStatus === "ready" &&
          !isGenericCustomModelName(agent.name),
      ),
    [agents],
  );
  const passthroughAgentId = useMemo(
    () =>
      agents.find(
        (agent) =>
          agent.readinessStatus === "ready" &&
          isGenericCustomModelName(agent.name),
      )?.id,
    [agents],
  );
  const handleSelectCustomModel = useCallback(
    (agentId: string, baseModelId: string) => {
      setActiveAgentId(agentId);
      void workspace.handleSelectModel(baseModelId, agentId);
    },
    [setActiveAgentId, workspace],
  );
  const handleSelectBaseModel = useCallback(
    (modelId: string) => {
      const current = workspace.activeAgent;
      const leavingCustom =
        current !== undefined && !isGenericCustomModelName(current.name);
      if (leavingCustom && passthroughAgentId !== undefined) {
        setActiveAgentId(passthroughAgentId);
        void workspace.handleSelectModel(modelId, passthroughAgentId);
        return;
      }
      void workspace.handleSelectModel(modelId);
    },
    [passthroughAgentId, setActiveAgentId, workspace],
  );
  const [sessionDialog, setSessionDialog] = useState<WorkspaceNavDialog>(null);
  const { workspaceId, workspaces, setWorkspaceId } = useWorkspace();
  const authorNames = resolveChatAuthorNames({
    agentName: workspace.activeAgent?.name,
    modelDisplayName: workspace.models.find(
      (model) => model.id === workspace.selectedModelId,
    )?.displayName,
  });
  const activeChat = workspace.chats.find(
    (chat) => chat.id === workspace.activeChatId,
  );
  const subject = workspace.subject;
  const isOwnerOrAdmin =
    subject?.isAdmin === true ||
    (subject?.id !== undefined &&
      activeChat?.createdBy !== undefined &&
      activeChat.createdBy === subject.id);
  const chatSharesQuery = useQuery(
    chatSharesQueryOptions(
      workspace.activeChatId,
      "access",
      workspace.activeChatId !== undefined &&
        subject !== undefined &&
        !isOwnerOrAdmin,
    ),
  );
  const chatAccess = useMemo(
    () =>
      resolveChatAccess({
        subjectId: subject?.id,
        isAdmin: subject?.isAdmin,
        groupIds: subject?.groupIds,
        chatCreatedBy: activeChat?.createdBy,
        grants: chatSharesQuery.data ?? [],
      }),
    [
      activeChat?.createdBy,
      chatSharesQuery.data,
      subject?.groupIds,
      subject?.id,
      subject?.isAdmin,
    ],
  );

  // ChatMessageRow is memoised, and a memo only holds if its function props
  // keep their identity -- a fresh arrow per render is a changed prop on every
  // row, and this component re-renders once per streamed token. The controller
  // rebuilds its handlers every render (they close over the draft, the active
  // chat, the transcript), so the wrappers below depend only on a stable ref
  // and read its latest committed controller instead of capturing the first one.
  //
  // Upgrade path: hoist these ten handlers into useWorkspaceController, where
  // they can be memoised against their real dependencies.
  const {
    handleAttachmentRetention,
    handleBranch,
    handleCancelQueuedTurn,
    handleContinue,
    handleDeleteMessage,
    handleEditAndResend,
    handleGenerateSpeech,
    handleRateMessage,
    handleRegenerate,
    handleSelectVariant,
  } = useWorkspaceShellMessageHandlers(workspace);

  const commands = useMemo<AppCommand[]>(
    () => [
      {
        id: "action-new-chat",
        group: t("shellActions"),
        label: t("newChat"),
        icon: SquarePen,
        run: handleNewChat,
      },
      ...namedCustomModels.map((agent) => ({
        id: `switch-model-${agent.id}`,
        group: t("modelGroupCustom"),
        label: agent.name,
        icon: Box,
        run: () => handleSelectCustomModel(agent.id, agent.baseModelId),
      })),
    ],
    [handleNewChat, handleSelectCustomModel, namedCustomModels, t],
  );
  useRegisterCommands(commands);

  if (!hydrated) {
    return (
      <main className="rm-workspace-loading">
        <a className="rm-skip-link" href="#main-content">
          {t("shellSkipToChat")}
        </a>
        <section id="main-content" tabIndex={-1}>
          <div className="rm-loading" role="status">
            {t("loading")}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="rm-workspace">
      <a className="rm-skip-link" href="#main-content">
        {t("shellSkipToChat")}
      </a>
      <WorkspaceNav
        activeChatId={workspace.activeChatId}
        chats={workspace.chats}
        chatsTotal={workspace.chatsTotal}
        hasMoreChats={workspace.hasMoreChats}
        isAdmin={hydrated && workspace.subject?.isAdmin === true}
        isLoadingMoreChats={workspace.isLoadingMoreChats}
        onLoadMoreChats={() => void workspace.loadMoreChats()}
        onDeleteChat={(chatId) => void workspace.deleteChat(chatId)}
        onNewChat={workspace.handleNewChat}
        onNewTemporaryChat={workspace.handleNewTemporaryChat}
        onRenameChat={(chatId, title) =>
          void workspace.renameChat(chatId, title)
        }
        onSelectChat={(chatId) => void workspace.handleSelectChat(chatId)}
        workspaceId={workspaceId}
      />

      <section className="rm-main" id="main-content" tabIndex={-1}>
        <header className="rm-topbar">
          <div className="rm-main-context">
            <ChatHeaderTitle
              canRename={chatAccess !== "read"}
              chatId={workspace.activeChatId}
              onRename={(chatId, title) =>
                void workspace.renameChat(chatId, title)
              }
              title={activeChat?.title}
            />
            {/*
             * Rendered only when there is somewhere to switch to. Previously the
             * single-workspace case fell back to a plain <span> holding the
             * workspace name, which put an inert word in the top bar that looked
             * like a control, and left this <label> wrapping no form element
             * while still announcing "Switch workspace" to assistive tech — a
             * promise of an action that did not exist.
             *
             * Note nothing in the UI calls createWorkspace() today, so this
             * branch is currently unreachable in practice. When workspace
             * creation ships, prefer moving this to the sidebar footer beside
             * the account row: workspace is account scope, not conversation
             * scope, which is why the top bar reads cleaner without it.
             */}
            {workspaces.length > 1 ? (
              <>
                <span className="rm-main-context-divider" aria-hidden="true" />
                <label className="rm-main-workspace">
                  <LayoutGrid aria-hidden="true" size={14} />
                  <span className="sr-only">{t("switchWorkspace")}</span>
                  <NativeSelect
                    aria-label={t("switchWorkspace")}
                    onChange={(event) =>
                      setWorkspaceId(event.currentTarget.value)
                    }
                    value={workspaceId ?? ""}
                  >
                    {workspaces.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              </>
            ) : null}
          </div>
          <div className="rm-topbar-actions">
            <ThemeToggle />
            <WorkspaceUserMenu
              isAdmin={workspace.subject?.isAdmin === true}
              userLabel={
                workspace.subject?.name ??
                workspace.subject?.email ??
                workspace.subject?.id ??
                t("account")
              }
            />
          </div>
        </header>

        <Suspense
          fallback={
            <div className="rm-loading" role="status">
              {t("loading")}
            </div>
          }
        >
          <LazyChatPanel
            activeVoiceProfileId={workspace.activeVoiceProfileId}
            activation={{
              assistantReady: workspace.activeAgent !== undefined,
              conversationComplete: workspace.chatsTotal > 0,
              isAdmin: workspace.subject?.isAdmin === true,
              modelReady: workspace.models.some(
                (model) => model.enabled && model.available !== false,
              ),
              providerReady: workspace.providers.some(
                (provider) => provider.enabled && provider.credentialConfigured,
              ),
            }}
            activeChatId={workspace.activeChatId}
            activeAgent={
              workspace.activeAgent === undefined
                ? undefined
                : {
                    name: workspace.activeAgent.name,
                    ...(workspace.activeAgent.avatarUrl === undefined
                      ? {}
                      : { avatarUrl: workspace.activeAgent.avatarUrl }),
                    ...(workspace.activeAgent.icon === undefined
                      ? {}
                      : { icon: workspace.activeAgent.icon }),
                  }
            }
            chatTitle={
              workspace.chats.find((chat) => chat.id === workspace.activeChatId)
                ?.title
            }
            nextTurnAuthorName={authorNames.nextTurn}
            transcriptAuthorName={authorNames.transcript}
            attachedUrls={workspace.attachedUrls}
            citations={workspace.citations}
            contextPreview={workspace.contextPreview}
            contextPreviewError={workspace.contextPreviewError}
            canInspectContext={workspace.activeChatId !== undefined}
            models={workspace.models}
            providers={workspace.providers}
            promptSuggestions={
              workspace.activeAgent?.promptSuggestions?.length
                ? workspace.activeAgent.promptSuggestions
                : (workspace.chatExperience?.suggestions ?? [])
            }
            selectedModelId={workspace.selectedModelId}
            systemPrompt={workspace.activeAgent?.systemPrompt}
            defaultModelId={workspace.defaultModelId}
            lastReplyModelId={workspace.lastReplyModelId}
            modelDisplayNames={workspace.modelDisplayNames}
            customModels={namedCustomModels}
            {...(workspace.activeAgent === undefined ||
            isGenericCustomModelName(workspace.activeAgent.name)
              ? {}
              : { selectedCustomModelId: workspace.activeAgent.id })}
            onSelectCustomModel={handleSelectCustomModel}
            onSelectModel={handleSelectBaseModel}
            onToggleDefaultModel={(modelId) =>
              void workspace.handleToggleDefaultModel(modelId)
            }
            draft={workspace.draft}
            documentAttachments={workspace.documentAttachments}
            error={workspace.error}
            imageAttachments={workspace.imageAttachments}
            isGeneratingSpeech={workspace.isGeneratingSpeech}
            isInspectingContext={workspace.isInspectingContext}
            isStreaming={workspace.isStreaming}
            hasOlderMessages={workspace.hasOlderMessages}
            isLoadingOlderMessages={workspace.isLoadingOlderMessages}
            isTemporaryChat={
              workspace.temporaryNextChat ||
              workspace.chats.find((chat) => chat.id === workspace.activeChatId)
                ?.temporary === true
            }
            legalHoldUntil={
              workspace.chats.find((chat) => chat.id === workspace.activeChatId)
                ?.legalHoldUntil
            }
            onOpenSourceChat={(sourceChatId) => {
              void workspace.handleSelectChat(sourceChatId);
            }}
            chatAccess={chatAccess}
            queuedTurns={workspace.queuedTurns}
            isTranscribingVoice={workspace.isTranscribingVoice}
            messages={workspace.messages}
            messageFeedback={workspace.messageFeedback}
            knowledgeBaseIdsOverride={workspace.knowledgeBaseIdsOverride}
            webSearchEnabled={workspace.webSearchEnabled}
            agenticRagAvailable={workspace.agenticRagAvailable}
            agenticRagForced={workspace.agenticRagForced}
            agenticRagEnabled={workspace.agenticRagEnabled}
            routingMode={workspace.routingMode}
            researchMode={workspace.researchMode}
            reasoningMode={workspace.reasoningMode}
            workspaceId={workspace.workspace?.id}
            onBranch={handleBranch}
            onCancel={workspace.handleCancel}
            onCancelQueuedTurn={handleCancelQueuedTurn}
            onContinue={handleContinue}
            {...(workspace.subject?.isAdmin === true
              ? {
                  onCreateFeedbackEvalCase: (messageId: string) =>
                    void workspace.handleCreateFeedbackEvalCase(messageId),
                }
              : {})}
            onDeleteMessage={handleDeleteMessage}
            onAttachmentRetention={handleAttachmentRetention}
            onAttachFiles={(files) => void workspace.handleAttachFiles(files)}
            onAttachExistingFile={(file) =>
              void workspace.handleAttachExistingFile(file)
            }
            onAddUrl={workspace.handleAddUrl}
            onDraftChange={workspace.setDraft}
            onGenerateSpeech={handleGenerateSpeech}
            onGenerateImages={(input) =>
              void workspace.handleGenerateImages(input)
            }
            onInspectContext={() => void workspace.handleInspectContext()}
            onReasoningModeChange={workspace.setReasoningMode}
            onLoadOlderMessages={workspace.loadOlderMessages}
            onKnowledgeBaseIdsChange={workspace.setKnowledgeBaseIdsOverride}
            onEditAndResend={handleEditAndResend}
            onRateMessage={handleRateMessage}
            onRegenerate={handleRegenerate}
            onRegenerateWith={(input) => void workspace.regenerateLast(input)}
            onFollowUp={(prompt) => void workspace.handleFollowUp(prompt)}
            regenerateModels={workspace.models
              .filter(
                (model) =>
                  model.enabled &&
                  model.available !== false &&
                  model.id !== workspace.selectedModelId,
              )
              .slice(0, 6)
              .map((model) => ({ id: model.id, label: model.displayName }))}
            onShareChat={
              workspace.activeChatId === undefined || chatAccess === "read"
                ? undefined
                : () => {
                    const chat = workspace.chats.find(
                      (item) => item.id === workspace.activeChatId,
                    );
                    if (chat) setSessionDialog({ kind: "share", chat });
                  }
            }
            onExportChatMarkdown={
              workspace.activeChatId === undefined
                ? undefined
                : () => {
                    const chat = workspace.chats.find(
                      (item) => item.id === workspace.activeChatId,
                    );
                    if (chat) void downloadChatMarkdown(chat);
                  }
            }
            onCancelAttachment={workspace.handleCancelAttachment} onMoveDocumentAttachment={workspace.handleMoveDocumentAttachment} onMoveImageAttachment={workspace.handleMoveImageAttachment} onRetryDocumentAttachment={workspace.handleRetryDocumentAttachment} onSelectDocumentPage={workspace.handleSelectDocumentPage}
            onRemoveImageAttachment={workspace.handleRemoveImageAttachment}
            onRemoveDocumentAttachment={
              workspace.handleRemoveDocumentAttachment
            }
            onRemoveUrl={workspace.handleRemoveUrl}
            onSelectVariant={handleSelectVariant}
            onToggleWebSearch={workspace.setWebSearchEnabled}
            onToggleAgenticRag={workspace.setAgenticRagRequested}
            onRoutingModeChange={workspace.setRoutingMode}
            onResearchModeChange={workspace.setResearchMode}
            onTranscribeAudio={(blob) => workspace.handleTranscribeAudio(blob)}
            onTranscriptionError={workspace.handleTranscriptionError}
            onSubmit={workspace.handleSubmit}
            reasoning={workspace.reasoning}
            runActivities={workspace.runActivities}
            runWait={workspace.runWait}
            speechArtifacts={workspace.speechArtifacts}
            speechMessageId={workspace.speechMessageId}
            toolCalls={workspace.toolCalls}
            variantsByMessageId={workspace.variantsByMessageId}
          />
        </Suspense>
      </section>
      {sessionDialog === null ? null : (
        <Suspense fallback={null}>
          <LazyWorkspaceNavDialogs
            dialog={sessionDialog}
            folders={[]}
            onClose={() => setSessionDialog(null)}
            onRenameChat={(chatId, title) =>
              void workspace.renameChat(chatId, title)
            }
            tags={[]}
            workspaceId={workspaceId}
          />
        </Suspense>
      )}
    </main>
  );
}
