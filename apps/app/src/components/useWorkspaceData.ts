import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { getBootstrap, listChatsPage } from "../features";
import { listAgents } from "../features/managed-models";
import {
  getProviderOperationalSummary,
  listModels,
  listProviders,
} from "../features/providers/queries";
import { listAgentTools } from "../features/tools";
import { useWorkspace } from "./WorkspaceContext";

export function useWorkspaceData(activeAgentId: string | undefined) {
  const bootstrapQuery = useQuery({
    queryKey: ["bootstrap"],
    queryFn: getBootstrap,
  });
  // The selected workspace is owned by WorkspaceProvider (persisted +
  // validated). This deduplicates the same ["bootstrap"] query rather than
  // re-fetching. Falls back to nothing while the selection reconciles.
  const { workspace } = useWorkspace();
  const agentsQuery = useQuery({
    queryKey: ["agents", workspace?.id],
    queryFn: () => listAgents(workspace!.id),
    enabled: workspace !== undefined,
  });
  const chatsQuery = useInfiniteQuery({
    queryKey: ["chats", workspace?.id],
    queryFn: ({ pageParam }) =>
      listChatsPage(workspace!.id, { limit: 50, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.offset + lastPage.items.length : undefined,
    enabled: workspace !== undefined,
  });
  const modelsQuery = useQuery({ queryKey: ["models"], queryFn: listModels });
  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
  });
  const providerOperationalSummaryQuery = useQuery({
    queryKey: ["providerOperationalSummary"],
    queryFn: getProviderOperationalSummary,
  });

  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const activeAgent =
    agents.find((agent) => agent.id === activeAgentId) ?? agents[0];
  const toolsQuery = useQuery({
    queryKey: ["agentTools", activeAgent?.id],
    queryFn: () => listAgentTools(activeAgent!.id),
    enabled: activeAgent !== undefined,
  });

  return {
    activeAgent,
    agents,
    chats: chatsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    chatsTotal: chatsQuery.data?.pages[0]?.total ?? 0,
    hasMoreChats: chatsQuery.hasNextPage,
    isLoadingMoreChats: chatsQuery.isFetchingNextPage,
    loadMoreChats: chatsQuery.fetchNextPage,
    models: modelsQuery.data ?? [],
    providerOperationalSummary: providerOperationalSummaryQuery.data,
    providers: providersQuery.data ?? [],
    subject: bootstrapQuery.data?.subject,
    tools: toolsQuery.data ?? [],
    workspace,
  };
}
