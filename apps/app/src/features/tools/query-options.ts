import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { listAgentTools, listToolCalls } from "./queries";

export function agentToolsQueryOptions(agentId?: string) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "agentTools", { agentId }),
    queryKey: appQueryKeys.agentTools(agentId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listAgentTools(agentId!)),
    enabled: agentId !== undefined,
  });
}

export function toolCallsQueryOptions(agentId?: string) {
  return queryOptions({
    ...serverQueryPolicy("volatile", "toolCalls", { agentId }),
    queryKey: appQueryKeys.toolCalls(agentId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listToolCalls(agentId)),
    enabled: agentId !== undefined,
  });
}
