import type { QueryClient } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import { invalidateCachedResourceExactly } from "../../lib/server-mutation-options";
import type { ChatChangedEvent } from "./events";

export async function reconcileWorkspaceChatEvent(
  client: QueryClient,
  workspaceId: string,
  event: ChatChangedEvent | undefined,
): Promise<void> {
  if (event?.action === "deleted") {
    client.removeQueries({
      exact: true,
      queryKey: appQueryKeys.chat(event.chatId),
    });
  } else if (
    event !== undefined &&
    ["archived", "unarchived", "updated"].includes(event.action)
  ) {
    await client.invalidateQueries({
      exact: true,
      queryKey: appQueryKeys.chat(event.chatId),
    });
  }
  await invalidateCachedResourceExactly(
    client,
    appQueryKeys.chats(workspaceId),
  );
}

export function removeChatCache(client: QueryClient, chatId: string): void {
  client.removeQueries({ exact: true, queryKey: appQueryKeys.chat(chatId) });
}
