import type { QueryClient } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import type { QueuedChatTurn } from "./types";

export function replaceQueuedTurnsCache(
  client: QueryClient,
  chatId: string,
  turns: readonly QueuedChatTurn[],
): void {
  client.setQueryData<QueuedChatTurn[]>(appQueryKeys.queuedTurns(chatId), [
    ...turns,
  ]);
}
