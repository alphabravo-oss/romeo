import { capabilityIds, parseCapabilityConfigurationPatch } from "@romeo/core";

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
  capabilityDefaults?: Array<{
    capabilityId: string;
    state: "inherit" | "enabled" | "disabled" | "required";
    configuration: Record<string, unknown>;
    assignmentVersion: number;
    expiresAt?: string;
  }>;
  createdBy: string;
  createdAt: string;
  publishedAt: string;
}

export function asVersionCapabilityDefaults(
  value: unknown,
): NonNullable<AgentVersionRecord["capabilityDefaults"]> {
  if (
    !Array.isArray(value) ||
    value.length > capabilityIds.length ||
    new TextEncoder().encode(JSON.stringify(value)).byteLength > 16_384
  )
    throw new Error("Invalid stored agent-version capability defaults.");
  const seen = new Set<string>();
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      throw new Error("Invalid stored agent-version capability default.");
    const record = item as Record<string, unknown>;
    const keys = Object.keys(record);
    const capabilityId = capabilityIds.find(
      (candidate) => candidate === record.capabilityId,
    );
    if (
      keys.some(
        (key) =>
          ![
            "capabilityId",
            "state",
            "configuration",
            "assignmentVersion",
            "expiresAt",
          ].includes(key),
      ) ||
      capabilityId === undefined ||
      seen.has(capabilityId) ||
      !["inherit", "enabled", "disabled", "required"].includes(
        String(record.state),
      ) ||
      typeof record.configuration !== "object" ||
      record.configuration === null ||
      Array.isArray(record.configuration) ||
      !Number.isInteger(record.assignmentVersion) ||
      Number(record.assignmentVersion) <= 0 ||
      (record.expiresAt !== undefined &&
        (typeof record.expiresAt !== "string" ||
          !Number.isFinite(Date.parse(record.expiresAt)) ||
          new Date(record.expiresAt).toISOString() !== record.expiresAt))
    )
      throw new Error("Invalid stored agent-version capability default.");
    seen.add(capabilityId);
    return {
      capabilityId,
      state: record.state as NonNullable<
        AgentVersionRecord["capabilityDefaults"]
      >[number]["state"],
      configuration: Object.fromEntries(
        Object.entries(
          parseCapabilityConfigurationPatch(capabilityId, record.configuration),
        ),
      ),
      assignmentVersion: Number(record.assignmentVersion),
      ...(record.expiresAt === undefined
        ? {}
        : { expiresAt: record.expiresAt as string }),
    };
  });
}

export function attachVersionCapabilityDefaults(
  version: AgentVersionRecord,
  value: unknown,
): void {
  const defaults = asVersionCapabilityDefaults(value);
  if (defaults.length > 0) version.capabilityDefaults = defaults;
}

export function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}
