import {
  managedModelsCreate,
  managedModelsDelete,
  managedModelsBindVoice,
  managedModelsClearPreferences,
  managedModelsClone,
  managedModelsExport,
  managedModelsImport,
  managedModelsPublish,
  managedModelsRevokeGrant,
  managedModelsRollbackVersion,
  managedModelsShare,
  managedModelsUpdate,
  managedModelsUpdateCustomizationPolicy,
  managedModelsUpdateKnowledgeBinding,
  managedModelsUpdatePreferences,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  Agent,
  AgentGrant,
  AgentKnowledgeBinding,
  AgentMemoryPolicy,
  AgentSafetySettings,
  AgentVersion,
  ManagedModelCustomizationPolicy,
  ManagedModelExportDocument,
  ManagedModelPreferences,
} from "./types";

export async function createAgent(input: {
  workspaceId: string;
  name: string;
  description?: string;
  icon?: string;
  avatarUrl?: string;
  baseModelId: string;
  systemPrompt: string;
}): Promise<Agent> {
  configureBrowserApiClients();
  const response = await managedModelsCreate({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function deleteAgent(agentId: string): Promise<Agent> {
  configureBrowserApiClients();
  const response = await managedModelsDelete({
    path: { agentId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function cloneAgent(input: {
  agentId: string;
  includeKnowledgeBindings?: boolean;
  name?: string;
  systemPrompt?: string;
}): Promise<Agent> {
  configureBrowserApiClients();
  const response = await managedModelsClone({
    path: { agentId: input.agentId },
    body: {
      ...(input.includeKnowledgeBindings === undefined
        ? {}
        : { includeKnowledgeBindings: input.includeKnowledgeBindings }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.systemPrompt === undefined
        ? {}
        : { systemPrompt: input.systemPrompt }),
    },
    throwOnError: true,
  });
  return response.data.data;
}

export async function exportAgentDefinition(
  agentId: string,
): Promise<ManagedModelExportDocument> {
  configureBrowserApiClients();
  const response = await managedModelsExport({
    path: { agentId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function importAgentDefinition(input: {
  workspaceId: string;
  document: ManagedModelExportDocument;
}): Promise<Agent> {
  configureBrowserApiClients();
  const response = await managedModelsImport({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function bindAgentVoice(input: {
  agentId: string;
  voiceProfileId: string;
}): Promise<Agent> {
  configureBrowserApiClients();
  const { agentId, voiceProfileId } = input;
  const response = await managedModelsBindVoice({
    path: { agentId },
    body: { voiceProfileId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function shareAgentAccess(input: {
  agentId: string;
  principalType: "group" | "service_account" | "user";
  principalId: string;
  permissions: Array<"read" | "run" | "write">;
}): Promise<AgentGrant[]> {
  configureBrowserApiClients();
  const { agentId, ...body } = input;
  const response = await managedModelsShare({
    path: { agentId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function revokeAgentGrant(input: {
  agentId: string;
  grantId: string;
}): Promise<AgentGrant> {
  configureBrowserApiClients();
  const response = await managedModelsRevokeGrant({
    path: input,
    throwOnError: true,
  });
  return response.data.data;
}

export function shareAgent(input: {
  agentId: string;
  principalId: string;
  principalType?: "group" | "service_account" | "user";
}): Promise<AgentGrant[]> {
  return shareAgentAccess({
    agentId: input.agentId,
    principalId: input.principalId,
    principalType: input.principalType ?? "group",
    permissions: ["read", "run"],
  });
}

export async function updateAgentKnowledgeBinding(input: {
  agentId: string;
  enabled: boolean;
  knowledgeBaseId: string;
}): Promise<AgentKnowledgeBinding> {
  configureBrowserApiClients();
  const { agentId, knowledgeBaseId, enabled } = input;
  const response = await managedModelsUpdateKnowledgeBinding({
    path: { agentId, knowledgeBaseId },
    body: { enabled },
    throwOnError: true,
  });
  return response.data.data;
}

export async function updateAgent(input: {
  agentId: string;
  name?: string;
  description?: string;
  icon?: string;
  avatarUrl?: string;
  baseModelId?: string;
  systemPrompt?: string;
  parameters?: Record<string, unknown>;
  memoryPolicy?: AgentMemoryPolicy;
  safetySettings?: AgentSafetySettings;
  promptSuggestions?: Array<{ title: string; prompt: string }>;
  tags?: string[];
}): Promise<Agent> {
  configureBrowserApiClients();
  const { agentId, ...body } = input;
  const response = await managedModelsUpdate({
    path: { agentId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function publishAgent(agentId: string): Promise<AgentVersion> {
  configureBrowserApiClients();
  const response = await managedModelsPublish({
    path: { agentId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function rollbackAgentVersion(input: {
  agentId: string;
  versionId: string;
}): Promise<Agent> {
  configureBrowserApiClients();
  const response = await managedModelsRollbackVersion({
    path: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function updateManagedModelCustomizationPolicy(input: {
  agentId: string;
  policy: Partial<ManagedModelCustomizationPolicy>;
}): Promise<ManagedModelCustomizationPolicy> {
  configureBrowserApiClients();
  const response = await managedModelsUpdateCustomizationPolicy({
    path: { agentId: input.agentId },
    body: input.policy,
    throwOnError: true,
  });
  return response.data.data;
}

export async function updateManagedModelPreferences(input: {
  agentId: string;
  preferences: Partial<ManagedModelPreferences>;
}): Promise<ManagedModelPreferences> {
  configureBrowserApiClients();
  const response = await managedModelsUpdatePreferences({
    path: { agentId: input.agentId },
    body: input.preferences,
    throwOnError: true,
  });
  return response.data.data;
}

export async function clearManagedModelPreferences(
  agentId: string,
): Promise<ManagedModelPreferences> {
  configureBrowserApiClients();
  const response = await managedModelsClearPreferences({
    path: { agentId },
    throwOnError: true,
  });
  return response.data.data;
}
