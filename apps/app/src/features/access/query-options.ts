import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import {
  listKnowledgeShares,
  listModelShares,
  listWorkspaceMembers,
} from "./api";

export function modelSharesQueryOptions(modelId: string) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "modelShares", { modelId }),
    queryKey: appQueryKeys.modelShares(modelId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listModelShares(modelId)),
  });
}

export function knowledgeSharesQueryOptions(
  knowledgeBaseId: string | undefined,
  enabled: boolean,
) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "knowledgeShares", {
      knowledgeBaseId,
    }),
    queryKey: appQueryKeys.knowledgeShares(knowledgeBaseId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listKnowledgeShares(knowledgeBaseId!)),
    enabled: enabled && knowledgeBaseId !== undefined,
  });
}

export function workspaceMembersQueryOptions(workspaceId: string) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "workspaceMembers", { workspaceId }),
    queryKey: appQueryKeys.workspaceMembers(workspaceId || undefined),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listWorkspaceMembers(workspaceId)),
    enabled: workspaceId.length > 0,
  });
}
