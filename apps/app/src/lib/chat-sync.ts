import type { ChatEventStreamStatus } from "../features/chats/events";

export function chatSyncFallbackInterval(
  status: ChatEventStreamStatus,
  online: boolean,
): number | undefined {
  if (!online) return undefined;
  return status === "connected" ? 60_000 : 15_000;
}
