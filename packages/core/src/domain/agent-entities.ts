import type { PrincipalType } from "@romeo/auth";

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

/** Persistence record; API-facing policy schemas live in @romeo/contracts. */
export interface ManagedModelCustomizationPolicyRecord {
  orgId: string;
  agentId: string;
  allowCommunicationStyle: boolean;
  allowResponseLength: boolean;
  allowLanguage: boolean;
  allowCustomInstructions: boolean;
  allowPersonalMemory: boolean;
  allowVoiceSelection: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Tenant-scoped stored preference. Custom instructions are encoded at the service boundary. */
export interface ManagedModelPreferenceRecord {
  orgId: string;
  agentId: string;
  principalType: PrincipalType;
  principalId: string;
  communicationStyle?:
    | "balanced"
    | "concise"
    | "detailed"
    | "formal"
    | "friendly";
  responseLength?: "short" | "standard" | "long";
  language?: string;
  encodedCustomInstructions?: string;
  personalMemoryEnabled?: boolean;
  voiceProfileId?: string;
  createdAt: string;
  updatedAt: string;
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
  archivedAt?: string;
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
  knowledgeBaseBindings?: Array<{ knowledgeBaseId: string; enabled: boolean }>;
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
