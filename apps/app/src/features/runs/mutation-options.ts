import * as appQueryKeys from "../../lib/app-query-keys";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import { cancelQueuedTurn, enqueueChatTurn, startRun } from "./mutations";
import type { EnqueueChatTurnRequest } from "@romeo/api-client/generated/sdk";
import type { QueuedChatTurn } from "./types";

export function startRunMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "run.start",
    mutationFn: (input: Parameters<typeof startRun>[0]) => startRun(input),
    invalidations: (_run, { chatId }) => [
      { exact: true, queryKey: appQueryKeys.queuedTurns(chatId) },
    ],
  });
}

export function enqueueChatTurnMutationOptions() {
  return serverMutationOptions({
    resource: "run.queuedTurn.create",
    mutationFn: (input: EnqueueChatTurnRequest & { chatId: string }) =>
      enqueueChatTurn(input),
    reconcile: (client, turn, { chatId }) => {
      client.setQueryData<QueuedChatTurn[]>(
        appQueryKeys.queuedTurns(chatId),
        (current) => [
          ...(current ?? []).filter((candidate) => candidate.id !== turn.id),
          turn,
        ],
      );
    },
    invalidations: (_turn, { chatId }) => [
      { exact: true, queryKey: appQueryKeys.queuedTurns(chatId) },
    ],
  });
}

export function cancelQueuedTurnMutationOptions() {
  return serverMutationOptions({
    resource: "run.queuedTurn.cancel",
    mutationFn: ({ chatId, turnId }: { chatId: string; turnId: string }) =>
      cancelQueuedTurn(chatId, turnId),
    invalidations: (_turn, { chatId }) => [
      { exact: true, queryKey: appQueryKeys.queuedTurns(chatId) },
    ],
  });
}

export async function refreshAgentTestRunQueries(
  client: Parameters<typeof invalidateCachedResourceExactly>[0],
  workspaceId: string,
) {
  await Promise.all([
    invalidateCachedResourceExactly(client, appQueryKeys.chats(workspaceId)),
    invalidateCachedResourceExactly(client, appQueryKeys.usageEvents()),
    invalidateCachedResourceExactly(client, appQueryKeys.usageSummary()),
    invalidateCachedResourceExactly(client, appQueryKeys.usageAlerts()),
    invalidateCachedResourceExactly(client, appQueryKeys.quotas()),
  ]);
}
