import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  getBootstrap,
  getProviderOperationalSummary,
  listAgents,
  listChats,
  listModels,
  listProviders,
} from "../api/client";
import { listAgentTools } from "../api/tools";
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
  const chatsQuery = useQuery({
    queryKey: ["chats", workspace?.id],
    queryFn: () => listChats(workspace!.id),
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
    chats: chatsQuery.data ?? [],
    models: modelsQuery.data ?? [],
    providerOperationalSummary: providerOperationalSummaryQuery.data,
    providers: providersQuery.data ?? [],
    subject: bootstrapQuery.data?.subject,
    tools: toolsQuery.data ?? [],
    workspace,
  };
}
