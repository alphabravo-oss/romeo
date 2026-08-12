import { NativeSelect } from "@romeo/ui";
import Bot from "lucide-react/dist/esm/icons/bot.mjs";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid.mjs";
import SquarePen from "lucide-react/dist/esm/icons/square-pen.mjs";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

import type { QueuedChatTurn } from "../features/runs";
import { type AppCommand, useRegisterCommands } from "../lib/commands";
import { useLocale } from "../lib/i18n";
import { ChatPanel } from "./ChatPanel";
import { ModelSelector } from "./ModelSelector";
import { useWorkspaceController } from "./useWorkspaceController";
import { useWorkspace } from "./WorkspaceContext";
import { WorkspaceNav } from "./WorkspaceNav";
import { WorkspaceUserMenu } from "./WorkspaceUserMenu";
import { ThemeToggle } from "./ThemeToggle";
import { ManagedModelPersonalization } from "./ManagedModelPersonalization";

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
  const { workspaceId, workspaces, setWorkspaceId } = useWorkspace();

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
    (messageId: string, rating: "negative" | "none" | "positive") =>
      void latest.current.handleRateMessage(messageId, rating),
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
      ...agents.map((agent) => ({
        id: `switch-agent-${agent.id}`,
        group: t("shellSwitchAgent"),
        label: agent.name,
        icon: Bot,
        run: () => setActiveAgentId(agent.id),
      })),
    ],
    [agents, handleNewChat, setActiveAgentId, t],
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
            <ModelSelector
              activeAgentId={
                workspace.activeAgentId ?? workspace.activeAgent?.id
              }
              activeAgentName={
                workspace.activeAgent?.name ?? t("shellRomeoAssistant")
              }
              agents={workspace.agents}
              onSelectAgent={workspace.setActiveAgentId}
              workspaceId={workspace.workspace?.id}
            />
            <ManagedModelPersonalization agentId={workspace.activeAgent?.id} />
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
          agentName={workspace.activeAgent?.name ?? t("shellRomeoAssistant")}
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
          onSelectModel={(modelId) => void workspace.handleSelectModel(modelId)}
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
          queuedTurns={workspace.queuedTurns}
          isTranscribingVoice={workspace.isTranscribingVoice}
          messages={workspace.messages}
          messageFeedback={workspace.messageFeedback}
          webSearchEnabled={workspace.webSearchEnabled}
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
          onEditAndResend={handleEditAndResend}
          onRateMessage={handleRateMessage}
          onRegenerate={handleRegenerate}
          onRemoveImageAttachment={workspace.handleRemoveImageAttachment}
          onRemoveDocumentAttachment={workspace.handleRemoveDocumentAttachment}
          onRemoveUrl={workspace.handleRemoveUrl}
          onSelectVariant={handleSelectVariant}
          onToggleWebSearch={workspace.setWebSearchEnabled}
          onTranscribeAudio={(blob) => workspace.handleTranscribeAudio(blob)}
          onTranscriptionError={workspace.handleTranscriptionError}
          onSubmit={workspace.handleSubmit}
          reasoning={workspace.reasoning}
          runActivities={workspace.runActivities}
          speechArtifacts={workspace.speechArtifacts}
          speechMessageId={workspace.speechMessageId}
          toolCalls={workspace.toolCalls}
          variantsByMessageId={workspace.variantsByMessageId}
        />
      </section>
    </main>
  );
}
