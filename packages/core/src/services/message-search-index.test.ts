import { describe, expect, it } from "vitest";

import {
  applySearchIndexMutation,
  lookupSearchIndexEntry,
  messageSearchIndexKey,
  serverSearchForEncryptedTenant,
} from "./message-search-index";

const key = {
  orgId: "org_default",
  workspaceId: "workspace_default",
  chatId: "chat_1",
  grantVersion: "grant:3",
  aclVersion: "acl:2",
};

describe("message search index", () => {
  it("keys tenant/workspace/chat/grant/acl and tombstones before later rank", () => {
    expect(messageSearchIndexKey(key)).toContain("chat_1");
    expect(messageSearchIndexKey(key)).not.toContain("secret prompt");
    const live = applySearchIndexMutation(undefined, {
      type: "upsert",
      key,
      messageId: "msg_1",
      textHash: "hash_a",
      now: "2026-08-14T12:00:00.000Z",
    });
    if ("outcome" in live) throw new Error("expected live entry");
    expect(lookupSearchIndexEntry(live)).toEqual({
      outcome: "hit",
      textHash: "hash_a",
    });
    const tombstoned = applySearchIndexMutation(live, {
      type: "tombstone",
      key,
      messageId: "msg_1",
      now: "2026-08-14T12:01:00.000Z",
    });
    if ("outcome" in tombstoned) throw new Error("expected tombstone");
    expect(lookupSearchIndexEntry(tombstoned)).toEqual({ outcome: "miss" });
    expect(
      applySearchIndexMutation(tombstoned, {
        type: "upsert",
        key,
        messageId: "msg_1",
        textHash: "hash_b",
        now: "2026-08-14T12:02:00.000Z",
      }),
    ).toEqual({ outcome: "rejected", code: "search_index_tombstoned" });
  });

  it("disables server-side search for encrypted tenants unless policy says otherwise", () => {
    expect(
      serverSearchForEncryptedTenant({
        tenantEncrypted: true,
        policy: "disabled",
      }),
    ).toEqual({
      outcome: "denied",
      code: "encrypted_tenant_search_disabled",
    });
    expect(
      serverSearchForEncryptedTenant({
        tenantEncrypted: true,
        policy: "separate_index",
      }),
    ).toEqual({ outcome: "allowed", mode: "separate_index" });
  });
});
