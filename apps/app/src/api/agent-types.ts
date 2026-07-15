export interface Agent {
  id: string;
  orgId: string;
  name: string;
  workspaceId: string;
  createdBy: string;
  baseModelId: string;
  systemPrompt: string;
  parameters: Record<string, unknown>;
  memoryPolicy: AgentMemoryPolicy;
  safetySettings: AgentSafetySettings;
  voiceProfileId?: string;
  publishedVersionId?: string;
  updatedAt: string;
}

export interface AgentVersion {
  id: string;
  agentId: string;
  version: number;
  status: "published";
  baseModelId: string;
  systemPrompt: string;
  parameters: Record<string, unknown>;
  memoryPolicy: AgentMemoryPolicy;
  safetySettings: AgentSafetySettings;
  voiceProfileId?: string;
  knowledgeBaseBindings?: Array<{ knowledgeBaseId: string; enabled: boolean }>;
  toolBindings?: Array<{
    toolId: string;
    enabled: boolean;
    approvalRequired: boolean;
  }>;
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
    | "systemPrompt"
    | "parameters"
    | "safetySettings"
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
