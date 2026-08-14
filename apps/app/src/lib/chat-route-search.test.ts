import { describe, expect, it } from "vitest";

import {
  selectBranchSearch,
  selectChatSearch,
  validateChatRouteSearch,
} from "./chat-route-search";

describe("reader-scoped chat branch search", () => {
  it("round-trips an explicit leaf for reload and deep links", () => {
    expect(
      validateChatRouteSearch({
        agent: "agent_1",
        chat: "chat_1",
        leaf: "m9",
        workspace: "workspace_1",
      }),
    ).toEqual({
      agent: "agent_1",
      chat: "chat_1",
      leaf: "m9",
      workspace: "workspace_1",
    });
  });

  it("pushes branch history and clears a stale leaf when chat changes", () => {
    const selected = selectBranchSearch(
      { chat: "chat_1", workspace: "workspace_1" },
      "leaf_2",
    );
    expect(selected).toEqual({
      chat: "chat_1",
      leaf: "leaf_2",
      workspace: "workspace_1",
    });
    expect(selectChatSearch(selected, "chat_2")).toEqual({
      chat: "chat_2",
      workspace: "workspace_1",
    });
    expect(selectBranchSearch(selected, undefined)).toEqual({
      chat: "chat_1",
      workspace: "workspace_1",
    });
  });

  it("drops non-string, padded, and oversized identifiers", () => {
    expect(
      validateChatRouteSearch({
        chat: 1,
        leaf: false,
        workspace: " workspace_1",
      }),
    ).toEqual({});
    expect(validateChatRouteSearch({ workspace: "x".repeat(201) })).toEqual({});
  });
});
