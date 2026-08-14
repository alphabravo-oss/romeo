import type { PrincipalType } from "@romeo/auth";

export interface AgentParameters {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

export type KnowledgeGroundingMode = "optional" | "prefer" | "required";

export interface AgentSafetySettings {
  maxUserInputLength?: number;
  blockedTerms?: string[];
  /**
   * optional — inject context when found; otherwise normal LLM answer
   * prefer — stronger preference for context when present
   * required — answer only from knowledge; refuse when nothing matches
   */
  knowledgeGroundingMode?: KnowledgeGroundingMode;
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

export interface AgentPromptSuggestion {
  title: string;
  prompt: string;
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
  description?: string;
  icon?: string;
  avatarUrl?: string;
  createdBy: string;
  baseModelId: string;
  systemPrompt: string;
  parameters: AgentParameters;
  memoryPolicy: AgentMemoryPolicy;
  promptSuggestions?: AgentPromptSuggestion[];
  safetySettings: AgentSafetySettings;
  tags?: string[];
  voiceProfileId?: string;
  publishedVersionId?: string;
  grantCount?: number;
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
  promptSuggestions?: AgentPromptSuggestion[];
  safetySettings: AgentSafetySettings;
  tags?: string[];
  voiceProfileId?: string;
  knowledgeBaseBindings?: Array<{ knowledgeBaseId: string; enabled: boolean }>;
  toolBindings?: Array<{
    toolId: string;
    enabled: boolean;
    approvalRequired: boolean;
  }>;
  /** Immutable snapshot of the mutable agent capability assignments at publish time. */
  capabilityDefaults?: AgentVersionCapabilityDefault[];
  createdBy: string;
  createdAt: string;
  publishedAt: string;
  evalSummary?: AgentVersionEvalSummary;
}

export interface AgentVersionCapabilityDefault {
  capabilityId: string;
  state: "inherit" | "enabled" | "disabled" | "required";
  configuration: Record<string, unknown>;
  assignmentVersion: number;
  expiresAt?: string;
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
