import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import {
  getAgentReadiness,
  getManagedModelCustomizationPolicy,
  getManagedModelPreferences,
  listAgentKnowledgeBindings,
  listAgentShares,
  listAgentVersions,
} from "./queries";

export function agentVersionsQueryOptions(agentId?: string) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "agentVersions", { agentId }),
    queryKey: appQueryKeys.agentVersions(agentId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listAgentVersions(agentId!)),
    enabled: agentId !== undefined,
  });
}

export function agentSharesQueryOptions(agentId?: string) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "agentShares", { agentId }),
    queryKey: appQueryKeys.agentShares(agentId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listAgentShares(agentId!)),
    enabled: agentId !== undefined,
  });
}

export function agentReadinessQueryOptions(input: {
  agentId: string | undefined;
  principalId: string | undefined;
  principalType: "group" | "service_account" | "user" | undefined;
}) {
  const { agentId, principalId, principalType } = input;
  const enabled =
    agentId !== undefined &&
    principalId !== undefined &&
    principalType !== undefined;
  return queryOptions({
    ...serverQueryPolicy("volatile", "agentReadiness", input),
    queryKey: appQueryKeys.agentReadiness(agentId, principalType, principalId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () =>
        getAgentReadiness({
          agentId: agentId!,
          principalId: principalId!,
          principalType: principalType!,
        }),
      ),
    enabled,
  });
}

export function agentKnowledgeBindingsQueryOptions(agentId?: string) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "agentKnowledgeBindings", {
      agentId,
    }),
    queryKey: appQueryKeys.agentKnowledgeBindings(agentId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listAgentKnowledgeBindings(agentId!)),
    enabled: agentId !== undefined,
  });
}

export function managedModelCustomizationPolicyQueryOptions(agentId?: string) {
  return queryOptions({
    ...serverQueryPolicy("stable", "managedModelCustomizationPolicy", {
      agentId,
    }),
    queryKey: appQueryKeys.managedModelCustomizationPolicy(agentId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () =>
        getManagedModelCustomizationPolicy(agentId!),
      ),
    enabled: agentId !== undefined,
  });
}

export function managedModelPreferencesQueryOptions(agentId?: string) {
  return queryOptions({
    ...serverQueryPolicy("stable", "managedModelPreferences", { agentId }),
    queryKey: appQueryKeys.managedModelPreferences(agentId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => getManagedModelPreferences(agentId!)),
    enabled: agentId !== undefined,
  });
}
