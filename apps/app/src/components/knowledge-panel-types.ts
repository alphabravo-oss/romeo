import type { Agent } from "../features/types";

export interface KnowledgePanelProps {
  activeAgent: Agent | undefined;
  isAdmin?: boolean;
  onSelectionChange: (knowledgeBaseId: string | null) => void;
  selectedKnowledgeBaseId: string | undefined;
  workspaceId: string | undefined;
}
