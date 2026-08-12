import { NativeSelect } from "@romeo/ui";
import Box from "lucide-react/dist/esm/icons/box.mjs";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid.mjs";
import SquarePen from "lucide-react/dist/esm/icons/square-pen.mjs";
import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { listChatShares } from "../features/collaboration";
import type { QueuedChatTurn } from "../features/runs";
import { type AppCommand, useRegisterCommands } from "../lib/commands";
import { useLocale } from "../lib/i18n";
import { resolveChatAuthorNames } from "./assistant-selection";
import { isGenericCustomModelName, resolveChatAccess } from "./chat-enterprise";
import { ChatHeaderTitle } from "./ChatHeaderTitle";
import { ChatPanel } from "./ChatPanel";
import { downloadChatMarkdown } from "./workspace-nav-portability";
import { useWorkspaceController } from "./useWorkspaceController";
import { useWorkspace } from "./WorkspaceContext";
import { WorkspaceNav } from "./WorkspaceNav";
import {
  WorkspaceNavDialogs,
  type WorkspaceNavDialog,
} from "./WorkspaceNavDialogs";
import { WorkspaceUserMenu } from "./WorkspaceUserMenu";
import { ThemeToggle } from "./ThemeToggle";

const subscribeToHydration = () => () => {};

export function WorkspaceShell({
  onAgentSelection,
  onChatSelection,
  requestedAgentId,
  requestedChatId,
}: {
  onAgentSelection?: (agentId: string) => void;
  onChatSelection?: (
    chatId: string | undefined,
    options?: { replace: boolean },
  ) => void;
  requestedAgentId?: string;
  requestedChatId?: string;
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
    ...(requestedAgentId === undefined ? {} : { requestedAgentId }),
    ...(requestedChatId === undefined ? {} : { requestedChatId }),
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
  // Product stack: provider → base model → custom model. Custom models are
  // picker entries, not a separate assistant identity.
  const authorNames = resolveChatAuthorNames({
    agentName: workspace.activeAgent?.name,
    assistantsEnabled: true,
    fallbackName: t("shellCustomModel"),
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
  // Shares are only needed when the viewer is not already the owner/admin —
  // otherwise we would hit the list endpoint on every owned chat open.
  const chatSharesQuery = useQuery({
    queryKey: ["chatShares", "access", workspace.activeChatId],
    queryFn: () => listChatShares(workspace.activeChatId!),
    enabled:
      workspace.activeChatId !== undefined &&
      subject !== undefined &&
      !isOwnerOrAdmin,
    staleTime: 30_000,
  });
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
  // chat, the transcript), so the wrappers below are pinned to [] and read the
  // current controller through a ref instead of capturing the first one.
  //
  // ponytail: a ref written during render, which a render React then throws
  // away (StrictMode, offscreen or suspended trees) still writes -- the pinned
  // callbacks can read a controller from a render that never committed.
  // Upgrade path: hoist these nine handlers into useWorkspaceController, where
  // they can be memoised against their real dependencies.
  const latest = useRef(workspace);
  latest.current = workspace;
  const handleAttachmentRetention = useCallback(
    (messageId: string, attachmentId: string, retained: boolean) =>
      void latest.current.handleAttachmentRetention(
        messageId,
        attachmentId,
        retained,
      ),
    [],
  );
  const handleBranch = useCallback(
    (messageId: string) =>
      void latest.current.handleBranchFromMessage(messageId),
    [],
  );
  const handleCancelQueuedTurn = useCallback(
    (turn: QueuedChatTurn) => void latest.current.handleCancelQueuedTurn(turn),
    [],
  );
  const handleContinue = useCallback(
    () => void latest.current.handleContinueResponse(),
    [],
  );
  const handleDeleteMessage = useCallback(
    (messageId: string) => void latest.current.handleDeleteMessage(messageId),
    [],
  );
  const handleEditAndResend = useCallback(
    (messageId: string, content: string) =>
      latest.current.handleEditAndResend(messageId, content),
    [],
  );
  const handleGenerateSpeech = useCallback(
    (messageId: string) => void latest.current.handleGenerateSpeech(messageId),
    [],
  );
  const handleRateMessage = useCallback(
    (
      messageId: string,
      rating: "negative" | "none" | "positive",
      reasonCode?: string,
    ) => void latest.current.handleRateMessage(messageId, rating, reasonCode),
    [],
  );
  const handleRegenerate = useCallback(
    () => void latest.current.regenerateLast(),
    [],
  );
  const handleSelectVariant = useCallback(
    (messageId: string) => void latest.current.handleSelectVariant(messageId),
    [],
  );

  // Publish chat actions to the ⌘K command registry while this screen is mounted.
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
          <div className="rm-empty" role="status">
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

        <ChatPanel
          activeVoiceProfileId={workspace.activeVoiceProfileId}
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
          workspaceId={workspace.workspace?.id}
          onBranch={handleBranch}
          onCancel={workspace.handleCancel}
          onCancelQueuedTurn={handleCancelQueuedTurn}
          onContinue={handleContinue}
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
          onRemoveImageAttachment={workspace.handleRemoveImageAttachment}
          onRemoveDocumentAttachment={workspace.handleRemoveDocumentAttachment}
          onRemoveUrl={workspace.handleRemoveUrl}
          onSelectVariant={handleSelectVariant}
          onToggleWebSearch={workspace.setWebSearchEnabled}
          onToggleAgenticRag={workspace.setAgenticRagRequested}
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
      </section>
      <WorkspaceNavDialogs
        dialog={sessionDialog}
        folders={[]}
        onClose={() => setSessionDialog(null)}
        onRenameChat={(chatId, title) =>
          void workspace.renameChat(chatId, title)
        }
        tags={[]}
        workspaceId={workspaceId}
      />
    </main>
  );
}
