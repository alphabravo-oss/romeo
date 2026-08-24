import type { WorkspaceControllerOptions } from "./workspace-controller-types";

export function createWorkspaceControllerNavigation(input: {
  activeChatId?: string;
  onChatSelection?: WorkspaceControllerOptions["onChatSelection"];
  selectChat: (chatId: string) => Promise<void>;
  startNewChat: () => void;
  startNewTemporaryChat: () => void;
  clearModelOverride: () => void;
}) {
  return {
    handleSelectChat: async (chatId: string) => {
      input.clearModelOverride();
      const moved = chatId !== input.activeChatId;
      await input.selectChat(chatId);
      if (moved) input.onChatSelection?.(chatId);
    },
    handleNewChat: () => {
      input.clearModelOverride();
      const moved = input.activeChatId !== undefined;
      input.startNewChat();
      if (moved) input.onChatSelection?.(undefined);
    },
    handleNewTemporaryChat: () => {
      input.clearModelOverride();
      const moved = input.activeChatId !== undefined;
      input.startNewTemporaryChat();
      if (moved) input.onChatSelection?.(undefined);
    },
  };
}
