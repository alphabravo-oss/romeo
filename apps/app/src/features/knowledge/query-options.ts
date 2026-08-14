import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { getAgenticRagSettings } from "./agentic";
import { getKnowledgeIngestReadiness } from "./ingest-readiness";
import { listKnowledgeBases, listKnowledgeSources } from "./queries";

export function knowledgeBasesQueryOptions(
  workspaceId: string | undefined,
  enabled = workspaceId !== undefined,
) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "knowledgeBases", { workspaceId }),
    queryKey: appQueryKeys.knowledgeBases(workspaceId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listKnowledgeBases(workspaceId!)),
    enabled: enabled && workspaceId !== undefined,
  });
}

export function knowledgeSourcesQueryOptions(knowledgeBaseId?: string) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "knowledgeSources", {
      knowledgeBaseId,
    }),
    queryKey: appQueryKeys.knowledgeSources(knowledgeBaseId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listKnowledgeSources(knowledgeBaseId!)),
    enabled: knowledgeBaseId !== undefined,
  });
}

export function knowledgeIngestReadinessQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("volatile", "knowledgeIngestReadiness"),
    queryKey: appQueryKeys.knowledgeIngestReadiness(),
    queryFn: ({ signal }) =>
      abortableQuery(signal, getKnowledgeIngestReadiness),
  });
}

export function agenticRagSettingsQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("stable", "agenticRagSettings"),
    queryKey: appQueryKeys.agenticRagSettings(),
    queryFn: ({ signal }) => abortableQuery(signal, getAgenticRagSettings),
  });
}
