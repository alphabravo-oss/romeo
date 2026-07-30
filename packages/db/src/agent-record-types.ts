export interface AgentParametersRecord {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

export interface AgentSafetySettingsRecord {
  maxUserInputLength?: number;
  blockedTerms?: string[];
  promptInjectionGuard?: AgentPromptInjectionGuardRecord;
}

export interface AgentPromptInjectionGuardRecord {
  mode: "block";
  scanUserInput: boolean;
  scanRetrievedContext: boolean;
}

export interface AgentMemoryPolicyRecord {
  mode: "disabled" | "recent_messages";
  maxMessages?: number;
}

export interface AgentRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  description?: string;
  icon?: string;
  avatarUrl?: string;
  createdBy: string;
  baseModelId: string;
  systemPrompt: string;
  parameters: AgentParametersRecord;
  memoryPolicy: AgentMemoryPolicyRecord;
  promptSuggestions?: Array<{ title: string; prompt: string }>;
  safetySettings: AgentSafetySettingsRecord;
  tags?: string[];
  voiceProfileId?: string;
  publishedVersionId?: string;
  archivedAt?: string;
  updatedAt: string;
}

export interface AgentKnowledgeBindingRecord {
  id: string;
  orgId: string;
  agentId: string;
  knowledgeBaseId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentToolBindingRecord {
  id: string;
  orgId: string;
  agentId: string;
  toolId: string;
  enabled: boolean;
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentVersionRecord {
  id: string;
  agentId: string;
  orgId: string;
  workspaceId: string;
  version: number;
  status: "published";
  baseModelId: string;
  systemPrompt: string;
  parameters: AgentParametersRecord;
  memoryPolicy: AgentMemoryPolicyRecord;
  promptSuggestions?: Array<{ title: string; prompt: string }>;
  safetySettings: AgentSafetySettingsRecord;
  tags?: string[];
  voiceProfileId?: string;
  knowledgeBaseBindings?: Array<{ knowledgeBaseId: string; enabled: boolean }>;
  toolBindings?: Array<{
    toolId: string;
    enabled: boolean;
    approvalRequired: boolean;
  }>;
  createdBy: string;
  createdAt: string;
  publishedAt: string;
}
