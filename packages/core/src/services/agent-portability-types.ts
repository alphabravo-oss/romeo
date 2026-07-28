import type { ResourceGrant } from "@romeo/auth";

import type {
  AgentMemoryPolicy,
  AgentParameters,
  AgentSafetySettings,
} from "../domain/entities";

export interface PortableAgentKnowledgeBinding {
  knowledgeBaseId: string;
  enabled: boolean;
}

export interface PortableAgentToolBinding {
  toolId: string;
  enabled: boolean;
  approvalRequired: boolean;
}

export interface PortableAgentAccessGrant {
  principalType: ResourceGrant["principalType"];
  principalId: string;
  permissions: Array<
    Extract<ResourceGrant["permission"], "read" | "run" | "write">
  >;
}

export interface AgentExportDocument {
  schemaVersion: 1;
  exportedAt: string;
  agent: {
    name: string;
    baseModelId: string;
    systemPrompt: string;
    parameters: AgentParameters;
    memoryPolicy: AgentMemoryPolicy;
    safetySettings: AgentSafetySettings;
    voiceProfileId?: string;
    accessGrants?: PortableAgentAccessGrant[];
    knowledgeBaseBindings?: PortableAgentKnowledgeBinding[];
    toolBindings?: PortableAgentToolBinding[];
  };
}

export interface ResolvedAgentImportBindings {
  voiceProfileId?: string;
  accessGrants: PortableAgentAccessGrant[];
  knowledgeBaseBindings: PortableAgentKnowledgeBinding[];
  toolBindings: PortableAgentToolBinding[];
}

export interface AgentBindingSnapshot {
  knowledgeBaseBindings: PortableAgentKnowledgeBinding[];
  toolBindings: PortableAgentToolBinding[];
}
