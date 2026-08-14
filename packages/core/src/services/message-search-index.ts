export interface MessageSearchIndexKey {
  orgId: string;
  workspaceId: string;
  chatId: string;
  grantVersion: string;
  aclVersion: string;
}

export type MessageSearchIndexStatus = "live" | "tombstoned";

export interface MessageSearchIndexEntry {
  key: MessageSearchIndexKey;
  messageId: string;
  status: MessageSearchIndexStatus;
  textHash?: string;
  indexedAt: string;
}

export function messageSearchIndexKey(input: MessageSearchIndexKey): string {
  return [
    input.orgId,
    input.workspaceId,
    input.chatId,
    input.grantVersion,
    input.aclVersion,
  ].join("\0");
}

export function applySearchIndexMutation(
  current: MessageSearchIndexEntry | undefined,
  mutation:
    | { type: "upsert"; messageId: string; textHash: string; now: string; key: MessageSearchIndexKey }
    | { type: "tombstone"; messageId: string; now: string; key: MessageSearchIndexKey },
): MessageSearchIndexEntry | { outcome: "rejected"; code: "search_index_tombstoned" } {
  if (current?.status === "tombstoned")
    return { outcome: "rejected", code: "search_index_tombstoned" };
  if (mutation.type === "tombstone")
    return {
      key: mutation.key,
      messageId: mutation.messageId,
      status: "tombstoned",
      indexedAt: mutation.now,
    };
  return {
    key: mutation.key,
    messageId: mutation.messageId,
    status: "live",
    textHash: mutation.textHash,
    indexedAt: mutation.now,
  };
}

export function lookupSearchIndexEntry(
  entry: MessageSearchIndexEntry | undefined,
): { outcome: "hit"; textHash: string } | { outcome: "miss" } {
  if (entry === undefined || entry.status === "tombstoned" || entry.textHash === undefined)
    return { outcome: "miss" };
  return { outcome: "hit", textHash: entry.textHash };
}

export function serverSearchForEncryptedTenant(input: {
  tenantEncrypted: boolean;
  policy: "enabled" | "disabled" | "separate_index";
}):
  | { outcome: "allowed"; mode: "enabled" | "separate_index" }
  | { outcome: "denied"; code: "encrypted_tenant_search_disabled" } {
  if (!input.tenantEncrypted) return { outcome: "allowed", mode: "enabled" };
  if (input.policy === "disabled")
    return { outcome: "denied", code: "encrypted_tenant_search_disabled" };
  return { outcome: "allowed", mode: input.policy };
}
