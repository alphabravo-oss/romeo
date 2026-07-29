import type { ChatEventStreamStatus } from "../features/chats/events";

export function chatSyncFallbackInterval(
  status: ChatEventStreamStatus,
  online: boolean,
): number | undefined {
  return online && status === "degraded" ? 15_000 : undefined;
}
