import type { ResourceGrant } from "@romeo/auth";

import type {
  AgentKnowledgeBinding,
  AgentToolBinding,
} from "../domain/entities";

export function createSeedGrants(): ResourceGrant[] {
  const resources: Array<
    [ResourceGrant["resourceType"], string, ResourceGrant["permission"]]
  > = [
    ["chat", "chat_welcome", "write"],
    ["agent", "agent_default", "run"],
    ["tool", "tool_calculator", "use"],
    ["tool", "tool_datetime", "use"],
    ["model", "model_openai_compatible_default", "use"],
    ["model", "model_ollama_default", "use"],
    ["provider", "provider_openai_compatible", "use"],
    ["provider", "provider_ollama", "use"],
    ["knowledge_base", "kb_default", "read"],
    ["knowledge_base", "kb_default", "use"],
    ["knowledge_base", "kb_default", "write"],
    ["voice_profile", "voice_default", "use"],
    ["workspace", "workspace_default", "read"],
  ];

  return resources.map(([resourceType, resourceId, permission], index) => ({
    id: `grant_seed_${index + 1}`,
    resourceType,
    resourceId,
    principalType: "group",
    principalId: "group_admins",
    permission,
  }));
}

export function createToolBinding(
  id: string,
  toolId: string,
  enabled: boolean,
  approvalRequired: boolean,
  now: string,
): AgentToolBinding {
  return {
    id,
    orgId: "org_default",
    agentId: "agent_default",
    toolId,
    enabled,
    approvalRequired,
    createdAt: now,
    updatedAt: now,
  };
}

export function createKnowledgeBinding(
  id: string,
  knowledgeBaseId: string,
  now: string,
): AgentKnowledgeBinding {
  return {
    id,
    orgId: "org_default",
    agentId: "agent_default",
    knowledgeBaseId,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}
