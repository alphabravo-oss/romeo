import {
  runsGet,
  runsGetActiveForChat,
  runsListQueuedTurns,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type { QueuedChatTurn, RunRecord } from "./types";

export async function getActiveChatRun(
  chatId: string,
): Promise<RunRecord | null> {
  configureBrowserApiClients();
  const response = await runsGetActiveForChat({
    path: { chatId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function getRun(runId: string): Promise<RunRecord> {
  configureBrowserApiClients();
  const response = await runsGet({ path: { runId }, throwOnError: true });
  return response.data.data;
}

export async function listQueuedTurns(
  chatId: string,
): Promise<QueuedChatTurn[]> {
  configureBrowserApiClients();
  const response = await runsListQueuedTurns({
    path: { chatId },
    throwOnError: true,
  });
  return response.data.data;
}
