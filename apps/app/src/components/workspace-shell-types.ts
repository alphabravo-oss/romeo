export interface WorkspaceShellProps {
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
}
