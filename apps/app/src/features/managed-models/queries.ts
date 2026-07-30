import {
  managedModelsDiffVersion,
  managedModelsGetCustomizationPolicy,
  managedModelsGetPreferences,
  managedModelsGetReadiness,
  managedModelsList,
  managedModelsListGallery,
  managedModelsListGrants,
  managedModelsListKnowledgeBindings,
  managedModelsListVersions,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  Agent,
  AgentGalleryItem,
  AgentGrant,
  AgentKnowledgeBinding,
  AgentVersion,
  AgentVersionDiff,
  ManagedModelCustomizationPolicy,
  ManagedModelPreferences,
  ManagedModelReadiness,
} from "./types";

export async function listAgents(workspaceId: string): Promise<Agent[]> {
  configureBrowserApiClients();
  const response = await managedModelsList({
    query: { workspaceId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listAgentVersions(
  agentId: string,
): Promise<AgentVersion[]> {
  configureBrowserApiClients();
  const response = await managedModelsListVersions({
    path: { agentId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listAgentShares(agentId: string): Promise<AgentGrant[]> {
  configureBrowserApiClients();
  const response = await managedModelsListGrants({
    path: { agentId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listAgentGallery(
  workspaceId?: string,
): Promise<AgentGalleryItem[]> {
  configureBrowserApiClients();
  const response = await managedModelsListGallery({
    query: workspaceId === undefined ? {} : { workspaceId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listAgentKnowledgeBindings(
  agentId: string,
): Promise<AgentKnowledgeBinding[]> {
  configureBrowserApiClients();
  const response = await managedModelsListKnowledgeBindings({
    path: { agentId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function diffAgentVersions(input: {
  agentId: string;
  leftVersionId: string;
  rightVersionId: string;
}): Promise<AgentVersionDiff> {
  configureBrowserApiClients();
  const response = await managedModelsDiffVersion({
    path: { agentId: input.agentId, versionId: input.leftVersionId },
    query: { compareTo: input.rightVersionId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function getManagedModelCustomizationPolicy(
  agentId: string,
): Promise<ManagedModelCustomizationPolicy> {
  configureBrowserApiClients();
  const response = await managedModelsGetCustomizationPolicy({
    path: { agentId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function getManagedModelPreferences(
  agentId: string,
): Promise<ManagedModelPreferences> {
  configureBrowserApiClients();
  const response = await managedModelsGetPreferences({
    path: { agentId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function getAgentReadiness(input: {
  agentId: string;
  principalType?: "group" | "service_account" | "user";
  principalId?: string;
}): Promise<ManagedModelReadiness> {
  configureBrowserApiClients();
  const response = await managedModelsGetReadiness({
    path: { agentId: input.agentId },
    query:
      input.principalType === undefined || input.principalId === undefined
        ? {}
        : {
            principalType: input.principalType,
            principalId: input.principalId,
          },
    throwOnError: true,
  });
  return response.data.data;
}
