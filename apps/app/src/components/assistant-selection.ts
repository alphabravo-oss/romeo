import type { AgentGalleryItem } from "../features/managed-models";

export function resolveActiveAssistant(input: {
  activeAgentId?: string;
  agents: AgentGalleryItem[];
  chatAgentId?: string;
  includeDrafts?: boolean;
  requestedAgentId?: string;
  userDefaultAgentId?: string;
  workspaceDefaultAgentId?: string;
}): AgentGalleryItem | undefined {
  const preferredIds = [
    input.chatAgentId,
    input.requestedAgentId,
    input.activeAgentId,
    input.userDefaultAgentId,
    input.workspaceDefaultAgentId,
  ];
  for (const id of preferredIds) {
    if (id === undefined) continue;
    const preferred = input.agents.find((agent) => agent.id === id);
    if (
      preferred !== undefined &&
      (input.includeDrafts || preferred.readinessStatus === "ready")
    )
      return preferred;
  }
  return input.includeDrafts
    ? input.agents[0]
    : input.agents.find((agent) => agent.readinessStatus === "ready");
}
