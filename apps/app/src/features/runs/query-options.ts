import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { listQueuedTurns } from "./queries";

export function queuedTurnsQueryOptions(chatId?: string) {
  return queryOptions({
    ...serverQueryPolicy("volatile", "queuedTurns", { chatId }),
    queryKey: appQueryKeys.queuedTurns(chatId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listQueuedTurns(chatId!)),
    enabled: chatId !== undefined,
  });
}
