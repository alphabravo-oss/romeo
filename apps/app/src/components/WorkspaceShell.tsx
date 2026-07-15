import Bot from "lucide-react/dist/esm/icons/bot.mjs";
import SquarePen from "lucide-react/dist/esm/icons/square-pen.mjs";
import { useMemo } from "react";

import { type AppCommand, useRegisterCommands } from "../lib/commands";
import { ChatPanel } from "./ChatPanel";
import { ModelSelector } from "./ModelSelector";
import { useWorkspaceController } from "./useWorkspaceController";
import { useWorkspace } from "./WorkspaceContext";
import { WorkspaceNav } from "./WorkspaceNav";

export function WorkspaceShell() {
  const workspace = useWorkspaceController();
  const {
    workspaceId,
    workspaces,
    setWorkspaceId,
  } = useWorkspace();

  // Publish chat actions to the ⌘K command registry while this screen is mounted.
  const commands = useMemo<AppCommand[]>(
    () => [
      {
        id: "action-new-chat",
        group: "Actions",
        label: "New chat",
        icon: SquarePen,
        run: workspace.handleNewChat,
      },
      ...workspace.agents.map((agent) => ({
        id: `switch-agent-${agent.id}`,
        group: "Switch agent",
        label: agent.name,
        icon: Bot,
        run: () => workspace.setActiveAgentId(agent.id),
      })),
    ],
    [workspace.agents, workspace.handleNewChat, workspace.setActiveAgentId],
  );
  useRegisterCommands(commands);

  return (
    <main className="rm-workspace">
      <WorkspaceNav
        activeChatId={workspace.activeChatId}
        chats={workspace.chats}
        isAdmin={workspace.subject?.isAdmin === true}
        onDeleteChat={(chatId) => void workspace.deleteChat(chatId)}
        onNewChat={workspace.handleNewChat}
        onRenameChat={(chatId, title) => void workspace.renameChat(chatId, title)}
        onSelectChat={(chatId) => void workspace.handleSelectChat(chatId)}
        onSelectWorkspace={setWorkspaceId}
        userLabel={workspace.subject?.id ?? "Account"}
        workspaceId={workspaceId}
        workspaceName={workspace.workspace?.name ?? "Loading"}
        workspaces={workspaces}
      />

      <section className="rm-main">
        <header className="rm-topbar">
          <ModelSelector
            activeAgentId={workspace.activeAgentId ?? workspace.activeAgent?.id}
            activeAgentName={workspace.activeAgent?.name ?? "Romeo Assistant"}
            agents={workspace.agents}
            isCloning={workspace.isCloningAgent}
            onCloneAgent={() => void workspace.handleCloneAgent()}
            onSelectAgent={workspace.setActiveAgentId}
            workspaceName={workspace.workspace?.name ?? "Default workspace"}
          />
        </header>

        <ChatPanel
          activeVoiceProfileId={workspace.activeAgent?.voiceProfileId}
          agentName={workspace.activeAgent?.name ?? "Romeo Assistant"}
          draft={workspace.draft}
          error={workspace.error}
          imageAttachments={workspace.imageAttachments}
          isGeneratingSpeech={workspace.isGeneratingSpeech}
          isStreaming={workspace.isStreaming}
          isTranscribingVoice={workspace.isTranscribingVoice}
          messages={workspace.messages}
          onCancel={workspace.handleCancel}
          onAttachImage={(file) => void workspace.handleAttachImage(file)}
          onDraftChange={workspace.setDraft}
          onGenerateSpeech={(messageId) =>
            void workspace.handleGenerateSpeech(messageId)
          }
          onRegenerate={() => void workspace.regenerateLast()}
          onRemoveImageAttachment={workspace.handleRemoveImageAttachment}
          onTranscribeAudio={(blob) => workspace.handleTranscribeAudio(blob)}
          onTranscriptionError={workspace.handleTranscriptionError}
          onSubmit={workspace.handleSubmit}
          speechArtifacts={workspace.speechArtifacts}
          speechMessageId={workspace.speechMessageId}
        />
      </section>
    </main>
  );
}
