import * as appQueryKeys from "../../lib/app-query-keys";
import { apiQueryKeys } from "../../lib/api-query-options";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import {
  cloneAgent,
  bindAgentVoice,
  createAgent,
  deleteAgent,
  exportAgentDefinition,
  importAgentDefinition,
  publishAgent,
  revokeAgentGrant,
  rollbackAgentVersion,
  shareAgent,
  shareAgentAccess,
  updateAgent,
  updateAgentKnowledgeBinding,
  updateManagedModelCustomizationPolicy,
} from "./mutations";
import { diffAgentVersions } from "./queries";
import type {
  AgentKnowledgeBinding,
  ManagedModelCustomizationPolicy,
} from "./types";

type CustomizationInput = Parameters<
  typeof updateManagedModelCustomizationPolicy
>[0];

export function updateManagedModelCustomizationPolicyMutationOptions() {
  return serverMutationOptions<
    Awaited<ReturnType<typeof updateManagedModelCustomizationPolicy>>,
    Error,
    CustomizationInput,
    ManagedModelCustomizationPolicy | undefined
  >({
    resource: "managedModel.customizationPolicy.update",
    mutationFn: updateManagedModelCustomizationPolicy,
    optimistic: {
      snapshot: async (client, variables) => {
        const queryKey = appQueryKeys.managedModelCustomizationPolicy(
          variables.agentId,
        );
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<ManagedModelCustomizationPolicy>(queryKey);
      },
      update: (client, variables) => {
        client.setQueryData<ManagedModelCustomizationPolicy>(
          appQueryKeys.managedModelCustomizationPolicy(variables.agentId),
          (current) =>
            current === undefined
              ? undefined
              : { ...current, ...variables.policy },
        );
      },
      rollback: (client, snapshot, variables) => {
        const queryKey = appQueryKeys.managedModelCustomizationPolicy(
          variables.agentId,
        );
        if (snapshot === undefined) {
          client.removeQueries({ exact: true, queryKey });
        } else {
          client.setQueryData(queryKey, snapshot);
        }
      },
    },
    reconcile: (client, policy, variables) => {
      client.setQueryData(
        appQueryKeys.managedModelCustomizationPolicy(variables.agentId),
        policy,
      );
    },
    invalidations: (_policy, variables) => [
      {
        exact: true,
        queryKey: appQueryKeys.managedModelPreferences(variables.agentId),
      },
    ],
  });
}

export function shareAgentMutationOptions() {
  return serverMutationOptions({
    resource: "managedModel.share.create",
    mutationFn: shareAgent,
    reconcile: (client) =>
      invalidateCachedResourceExactly(client, appQueryKeys.auditLogs()),
  });
}

export function updateAgentMutationOptions(workspaceId?: string) {
  return serverMutationOptions({
    resource: "managedModel.update",
    mutationFn: updateAgent,
    reconcile: (client, agent) =>
      refreshAgentViews(client, agent.id, workspaceId),
  });
}

export function bindAgentVoiceMutationOptions(workspaceId?: string) {
  return serverMutationOptions({
    resource: "managedModel.voice.bind",
    mutationFn: bindAgentVoice,
    reconcile: (client, agent) =>
      refreshAgentViews(client, agent.id, workspaceId),
  });
}

export function createAgentMutationOptions() {
  return serverMutationOptions({
    resource: "managedModel.create",
    mutationFn: createAgent,
    reconcile: (client, _agent, variables) =>
      refreshAgentLists(client, variables.workspaceId),
  });
}

export function updateAgentKnowledgeBindingMutationOptions() {
  return serverMutationOptions<
    Awaited<ReturnType<typeof updateAgentKnowledgeBinding>>,
    Error,
    Parameters<typeof updateAgentKnowledgeBinding>[0],
    AgentKnowledgeBinding[] | undefined
  >({
    resource: "managedModel.knowledgeBinding.update",
    mutationFn: updateAgentKnowledgeBinding,
    optimistic: {
      snapshot: async (client, variables) => {
        const queryKey = appQueryKeys.agentKnowledgeBindings(variables.agentId);
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<AgentKnowledgeBinding[]>(queryKey);
      },
      update: (client, variables) => {
        client.setQueryData<AgentKnowledgeBinding[]>(
          appQueryKeys.agentKnowledgeBindings(variables.agentId),
          (current) =>
            current?.map((binding) =>
              binding.knowledgeBaseId === variables.knowledgeBaseId
                ? { ...binding, enabled: variables.enabled }
                : binding,
            ),
        );
      },
      rollback: (client, snapshot, variables) => {
        const queryKey = appQueryKeys.agentKnowledgeBindings(variables.agentId);
        if (snapshot === undefined)
          client.removeQueries({ exact: true, queryKey });
        else client.setQueryData(queryKey, snapshot);
      },
    },
    reconcile: (client, binding, variables) => {
      client.setQueryData<AgentKnowledgeBinding[]>(
        appQueryKeys.agentKnowledgeBindings(variables.agentId),
        (current) =>
          current === undefined
            ? undefined
            : [...current.filter((entry) => entry.id !== binding.id), binding],
      );
    },
    invalidations: (_binding, variables) => [
      {
        exact: true,
        queryKey: appQueryKeys.agentKnowledgeBindings(variables.agentId),
      },
    ],
  });
}

export function publishAgentMutationOptions(workspaceId?: string) {
  return serverMutationOptions({
    resource: "managedModel.publish",
    mutationFn: publishAgent,
    reconcile: (client, _version, variables) =>
      refreshAgentViews(client, variables.agentId, workspaceId),
  });
}

export function rollbackAgentVersionMutationOptions(workspaceId?: string) {
  return serverMutationOptions({
    resource: "managedModel.version.rollback",
    mutationFn: rollbackAgentVersion,
    reconcile: (client, agent) =>
      refreshAgentViews(client, agent.id, workspaceId),
  });
}

export function deleteAgentMutationOptions(workspaceId?: string) {
  return serverMutationOptions({
    resource: "managedModel.delete",
    mutationFn: deleteAgent,
    invalidations: () =>
      workspaceId === undefined
        ? []
        : [
            { exact: true, queryKey: apiQueryKeys.agents(workspaceId) },
            { exact: true, queryKey: apiQueryKeys.agentGallery(workspaceId) },
          ],
  });
}

export function diffAgentVersionsMutationOptions() {
  return serverMutationOptions({
    resource: "managedModel.version.diff",
    mutationFn: diffAgentVersions,
  });
}

export function exportAgentDefinitionMutationOptions() {
  return serverMutationOptions({
    resource: "managedModel.export",
    mutationFn: exportAgentDefinition,
  });
}

export function cloneAgentMutationOptions(workspaceId?: string) {
  return serverMutationOptions({
    resource: "managedModel.clone",
    mutationFn: cloneAgent,
    reconcile: (client) => refreshAgentLists(client, workspaceId),
  });
}

export function importAgentDefinitionMutationOptions() {
  return serverMutationOptions({
    resource: "managedModel.import",
    mutationFn: importAgentDefinition,
    reconcile: (client, _agent, variables) =>
      refreshAgentLists(client, variables.workspaceId),
  });
}

export function shareAgentAccessMutationOptions() {
  return serverMutationOptions({
    resource: "managedModel.access.grant",
    mutationFn: shareAgentAccess,
    reconcile: (client, _grants, variables) =>
      refreshAgentAccessViews(client, variables.agentId),
  });
}

export function revokeAgentGrantMutationOptions() {
  return serverMutationOptions({
    resource: "managedModel.access.revoke",
    mutationFn: revokeAgentGrant,
    reconcile: (client, _grant, variables) =>
      refreshAgentAccessViews(client, variables.agentId),
  });
}

async function refreshAgentViews(
  client: Parameters<typeof invalidateCachedResourceExactly>[0],
  agentId: string,
  workspaceId?: string,
) {
  await Promise.all([
    invalidateCachedResourceExactly(
      client,
      appQueryKeys.agentVersions(agentId),
    ),
    invalidateCachedResourceExactly(
      client,
      appQueryKeys.agentReadiness(agentId),
    ),
    refreshAgentLists(client, workspaceId),
  ]);
}

async function refreshAgentLists(
  client: Parameters<typeof invalidateCachedResourceExactly>[0],
  workspaceId?: string,
) {
  if (workspaceId === undefined) return;
  await Promise.all([
    invalidateCachedResourceExactly(client, apiQueryKeys.agents(workspaceId)),
    invalidateCachedResourceExactly(
      client,
      apiQueryKeys.agentGallery(workspaceId),
    ),
  ]);
}

async function refreshAgentAccessViews(
  client: Parameters<typeof invalidateCachedResourceExactly>[0],
  agentId: string,
) {
  await Promise.all([
    invalidateCachedResourceExactly(client, appQueryKeys.agentShares(agentId)),
    invalidateCachedResourceExactly(
      client,
      appQueryKeys.agentReadiness(agentId),
    ),
    invalidateCachedResourceExactly(client, apiQueryKeys.agentGallery()),
    invalidateCachedResourceExactly(client, appQueryKeys.auditLogs()),
  ]);
}
