import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import {
  listPromptMarketplace,
  listPromptTemplates,
  listPromptTemplatesPage,
} from "./queries";

export function promptTemplatesQueryOptions(workspaceId?: string) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "promptTemplates", { workspaceId }),
    queryKey: appQueryKeys.promptTemplates(workspaceId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listPromptTemplates(workspaceId)),
    enabled: workspaceId !== undefined,
  });
}

export function promptMarketplaceQueryOptions(workspaceId?: string) {
  return queryOptions({
    ...serverQueryPolicy("stable", "promptMarketplace", { workspaceId }),
    queryKey: appQueryKeys.promptMarketplace(workspaceId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listPromptMarketplace(workspaceId)),
    enabled: workspaceId !== undefined,
  });
}

export function promptTemplatePageQueryOptions(input: {
  enabled: boolean;
  page: number;
  pageSize: number;
  query: string;
  workspaceId: string | undefined;
}) {
  const { enabled, page, pageSize, query, workspaceId } = input;
  const normalizedQuery = query.trim();
  return queryOptions({
    ...serverQueryPolicy("interactive", "promptTemplates", {
      page,
      query: normalizedQuery,
      workspaceId,
    }),
    queryKey: appQueryKeys.promptTemplates(workspaceId, {
      page,
      query: normalizedQuery,
    }),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () =>
        listPromptTemplatesPage({
          workspaceId: workspaceId!,
          limit: pageSize,
          offset: page * pageSize,
          ...(normalizedQuery === "" ? {} : { query }),
        }),
      ),
    enabled: enabled && workspaceId !== undefined,
  });
}

export function commandPromptTemplatesQueryOptions(input: {
  enabled: boolean;
  limit: number;
  query: string;
  workspaceId: string | undefined;
}) {
  const { enabled, limit, query, workspaceId } = input;
  return queryOptions({
    ...serverQueryPolicy("interactive", "promptTemplates", {
      purpose: "command",
      query,
      workspaceId,
    }),
    queryKey: appQueryKeys.promptTemplates(workspaceId, {
      purpose: "command",
      query,
    }),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () =>
        listPromptTemplatesPage({
          workspaceId: workspaceId!,
          limit,
          offset: 0,
          ...(query === "" ? {} : { query }),
        }),
      ),
    enabled: enabled && workspaceId !== undefined,
  });
}
