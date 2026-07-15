export interface AgentParameters {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

export interface AgentSafetySettings {
  maxUserInputLength?: number;
  blockedTerms?: string[];
  promptInjectionGuard?: AgentPromptInjectionGuard;
}

export interface AgentPromptInjectionGuard {
  mode: "block";
  scanUserInput: boolean;
  scanRetrievedContext: boolean;
}

export interface AgentMemoryPolicy {
  mode: "disabled" | "recent_messages";
  maxMessages?: number;
}

export interface Agent {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  createdBy: string;
  baseModelId: string;
  systemPrompt: string;
  parameters: AgentParameters;
  memoryPolicy: AgentMemoryPolicy;
  safetySettings: AgentSafetySettings;
  voiceProfileId?: string;
  publishedVersionId?: string;
  updatedAt: string;
}

export interface AgentVersion {
  id: string;
  agentId: string;
  orgId: string;
  workspaceId: string;
  version: number;
  status: "published";
  baseModelId: string;
  systemPrompt: string;
  parameters: AgentParameters;
  memoryPolicy: AgentMemoryPolicy;
  safetySettings: AgentSafetySettings;
  voiceProfileId?: string;
  knowledgeBaseBindings?: Array<{
    knowledgeBaseId: string;
    enabled: boolean;
  }>;
  toolBindings?: Array<{
    toolId: string;
    enabled: boolean;
    approvalRequired: boolean;
  }>;
  createdBy: string;
  createdAt: string;
  publishedAt: string;
  evalSummary?: AgentVersionEvalSummary;
}

export interface AgentVersionEvalSuiteSummary {
  suiteId: string;
  runId: string | null;
  status: "failed" | "missing" | "passed";
  score: number | null;
  completedAt: string | null;
}

export interface AgentVersionEvalSummary {
  status: "failed" | "missing" | "not_required" | "passed";
  suiteCount: number;
  passedSuiteCount: number;
  failedSuiteCount: number;
  missingSuiteCount: number;
  averageScore: number | null;
  evaluatedAt: string | null;
  suites: AgentVersionEvalSuiteSummary[];
}

export interface AgentVersionDiffChange {
  field:
    | "baseModelId"
    | "knowledgeBaseBindings"
    | "memoryPolicy"
    | "parameters"
    | "safetySettings"
    | "systemPrompt"
    | "toolBindings"
    | "voiceProfileId";
  left: unknown;
  right: unknown;
}

export interface AgentVersionDiff {
  agentId: string;
  leftVersionId: string;
  rightVersionId: string;
  changes: AgentVersionDiffChange[];
}

export interface CreateAgentInput {
  workspaceId: string;
  name: string;
  baseModelId: string;
  systemPrompt: string;
  parameters?: AgentParameters;
  memoryPolicy?: AgentMemoryPolicy;
  safetySettings?: AgentSafetySettings;
}

export interface UpdateAgentInput {
  name?: string;
  baseModelId?: string;
  systemPrompt?: string;
  parameters?: AgentParameters;
  memoryPolicy?: AgentMemoryPolicy;
  safetySettings?: AgentSafetySettings;
}

export interface CloneAgentInput {
  name?: string;
  systemPrompt?: string;
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
    accessGrants?: Array<{
      principalType: "group" | "service_account" | "user";
      principalId: string;
      permissions: Array<"read" | "run" | "write">;
    }>;
    knowledgeBaseBindings?: Array<{
      knowledgeBaseId: string;
      enabled: boolean;
    }>;
    toolBindings?: Array<{
      toolId: string;
      enabled: boolean;
      approvalRequired: boolean;
    }>;
  };
}

export interface ImportAgentInput {
  workspaceId: string;
  document: AgentExportDocument;
}
