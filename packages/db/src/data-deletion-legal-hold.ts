import { chats } from "./schema";
import { optionalIsoString, toIsoString } from "./repository-mapping";
import type { DataDeletionPlanRecord } from "./data-deletion-records";

export function activeChatLegalHold(
  chat: Pick<typeof chats.$inferSelect, "legalHoldReason" | "legalHoldUntil">,
): DataDeletionPlanRecord["legalHold"] | undefined {
  if (chat.legalHoldUntil === null) return undefined;
  const until = toIsoString(chat.legalHoldUntil);
  if (new Date(until).getTime() <= Date.now()) return undefined;
  const reason = optionalIsoString(chat.legalHoldReason);
  return {
    until,
    ...(reason === undefined ? {} : { reason }),
  };
}
