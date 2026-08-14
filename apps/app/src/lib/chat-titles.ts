import type { QueryClient } from "@tanstack/react-query";
import * as appQueryKeys from "./app-query-keys";
import { invalidateCachedResourceExactly } from "./server-mutation-options";

import { generateChatTitle } from "../features/chat-experience";

export function fallbackChatTitle(content: string): string {
  const title = content
    .trim()
    .replace(/\s+/gu, " ")
    .split(" ")
    .filter(Boolean)
    .slice(0, 6)
    .join(" ")
    .replace(/[.!?,:;]+$/gu, "");
  return title.slice(0, 80) || "New conversation";
}

export async function generateAutomaticChatTitle(input: {
  chatId: string;
  enabled: boolean;
  modelId: string | undefined;
  queryClient: QueryClient;
  workspaceId: string;
}): Promise<void> {
  if (!input.enabled || input.modelId === undefined) return;
  try {
    await generateChatTitle(input.chatId, input.modelId);
    await invalidateCachedResourceExactly(
      input.queryClient,
      appQueryKeys.chats(input.workspaceId),
    );
  } catch {
    // A completed first turn remains successful when the optional background
    // title request cannot reach the configured model.
  }
}
