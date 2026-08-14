import * as appQueryKeys from "../../lib/app-query-keys";
import { invalidateCachedResourceExactly } from "../../lib/server-mutation-options";

type QueryClient = Parameters<typeof invalidateCachedResourceExactly>[0];

/** Refreshes only concrete cached projections affected by a tool execution. */
export async function refreshToolActivityQueries(
  client: QueryClient,
  agentId?: string,
): Promise<void> {
  await Promise.all([
    invalidateCachedResourceExactly(client, appQueryKeys.usageEvents()),
    invalidateCachedResourceExactly(client, appQueryKeys.usageSummary()),
    invalidateCachedResourceExactly(client, appQueryKeys.usageAlerts()),
    invalidateCachedResourceExactly(client, appQueryKeys.quotas()),
    invalidateCachedResourceExactly(client, appQueryKeys.toolCalls(agentId)),
    invalidateCachedResourceExactly(client, appQueryKeys.auditLogs()),
  ]);
}
