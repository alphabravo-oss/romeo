import { NativeSelect } from "@romeo/ui";
import Bot from "lucide-react/dist/esm/icons/bot.mjs";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid.mjs";
import SquarePen from "lucide-react/dist/esm/icons/square-pen.mjs";
import { useMemo, useSyncExternalStore } from "react";

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
  onChatSelection?: (chatId: string | undefined) => void;
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
  const { workspaceId, workspaces, setWorkspaceId } = useWorkspace();

  // Publish chat actions to the ⌘K command registry while this screen is mounted.
  const commands = useMemo<AppCommand[]>(
    () => [
      {
        id: "action-new-chat",
        group: t("shellActions"),
        label: t("newChat"),
        icon: SquarePen,
        run: workspace.handleNewChat,
      },
      ...workspace.agents.map((agent) => ({
        id: `switch-agent-${agent.id}`,
        group: t("shellSwitchAgent"),
        label: agent.name,
        icon: Bot,
        run: () => workspace.setActiveAgentId(agent.id),
      })),
    ],
    [t, workspace.agents, workspace.handleNewChat, workspace.setActiveAgentId],
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
          onBranch={(messageId) =>
            void workspace.handleBranchFromMessage(messageId)
          }
          onCancel={workspace.handleCancel}
          onCancelQueuedTurn={(turnId) =>
            void workspace.handleCancelQueuedTurn(turnId)
          }
          onContinue={() => void workspace.handleContinueResponse()}
          onDeleteMessage={(messageId) =>
            void workspace.handleDeleteMessage(messageId)
          }
          onAttachmentRetention={(messageId, attachmentId, retained) =>
            void workspace.handleAttachmentRetention(
              messageId,
              attachmentId,
              retained,
            )
          }
          onAttachFiles={(files) => void workspace.handleAttachFiles(files)}
          onAttachExistingFile={(file) =>
            void workspace.handleAttachExistingFile(file)
          }
          onAddUrl={workspace.handleAddUrl}
          onDraftChange={workspace.setDraft}
          onGenerateSpeech={(messageId) =>
            void workspace.handleGenerateSpeech(messageId)
          }
          onGenerateImages={(input) =>
            void workspace.handleGenerateImages(input)
          }
          onInspectContext={() => void workspace.handleInspectContext()}
          onEditAndResend={workspace.handleEditAndResend}
          onRateMessage={(messageId, rating) =>
            void workspace.handleRateMessage(messageId, rating)
          }
          onRegenerate={() => void workspace.regenerateLast()}
          onRemoveImageAttachment={workspace.handleRemoveImageAttachment}
          onRemoveDocumentAttachment={workspace.handleRemoveDocumentAttachment}
          onRemoveUrl={workspace.handleRemoveUrl}
          onToggleWebSearch={workspace.setWebSearchEnabled}
          onTranscribeAudio={(blob) => workspace.handleTranscribeAudio(blob)}
          onTranscriptionError={workspace.handleTranscriptionError}
          onSubmit={workspace.handleSubmit}
          runActivities={workspace.runActivities}
          speechArtifacts={workspace.speechArtifacts}
          speechMessageId={workspace.speechMessageId}
        />
      </section>
    </main>
  );
}
