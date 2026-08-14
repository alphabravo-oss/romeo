import {
  runsCancel,
  runsCancelQueuedTurn,
  runsEnqueueTurn,
  runsStart,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  EnqueueChatTurnRequest,
  StartedRunRecord,
} from "@romeo/api-client/generated/sdk";
import type { QueuedChatTurn, RunRecord } from "./types";

export async function startRun(
  input: Parameters<typeof runsStart>[0]["body"],
): Promise<StartedRunRecord> {
  configureBrowserApiClients();
  const response = await runsStart({ body: input, throwOnError: true });
  return response.data.data;
}

export async function cancelRun(runId: string): Promise<RunRecord> {
  configureBrowserApiClients();
  const response = await runsCancel({
    path: { runId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function enqueueChatTurn(
  input: EnqueueChatTurnRequest & { chatId: string },
): Promise<QueuedChatTurn> {
  configureBrowserApiClients();
  const { chatId, ...body } = input;
  const response = await runsEnqueueTurn({
    path: { chatId },
    body: {
      ...body,
      idempotencyKey: body.idempotencyKey ?? crypto.randomUUID(),
    },
    throwOnError: true,
  });
  return response.data.data;
}

export async function cancelQueuedTurn(
  chatId: string,
  turnId: string,
): Promise<QueuedChatTurn> {
  configureBrowserApiClients();
  const response = await runsCancelQueuedTurn({
    path: { chatId, turnId },
    throwOnError: true,
  });
  return response.data.data;
}
