import { describe, expect, it } from "vitest";

import {
  buildProvenanceChips,
  canPerformChatWriteAction,
  chatSensitivity,
  complianceExportChecklist,
  formatBranchTitle,
  isFeedbackReasonCode,
  normalizeFeedbackReasonCode,
  parseBranchOrigin,
  policyErrorCopy,
  resolveChatAccess,
  streamRecoveryLabel,
  streamRecoveryPhase,
} from "./chat-enterprise";

describe("buildProvenanceChips", () => {
  it("includes model, tools, knowledge, and web when present", () => {
    const chips = buildProvenanceChips({
      modelId: "model_x",
      modelDisplayName: "Kimi",
      agentName: "Support desk",
      toolCallCount: 2,
      citationCount: 3,
      webSearchUsed: true,
    });
    expect(chips.map((c) => c.kind)).toEqual([
      "model",
      "tools",
      "knowledge",
      "web",
    ]);
    expect(chips[0]?.label).toBe("Support desk");
    expect(chips[1]?.label).toBe("Tools · 2");
  });

  it("suppresses generic custom model names like Romeo Assistant", () => {
    const chips = buildProvenanceChips({
      modelDisplayName: "Kimi",
      agentName: "Romeo Assistant",
    });
    expect(chips.map((c) => c.kind)).toEqual(["model"]);
    expect(chips.some((c) => c.label === "Romeo Assistant")).toBe(false);
  });

  it("returns empty when nothing is known", () => {
    expect(buildProvenanceChips({})).toEqual([]);
  });
});

describe("policyErrorCopy", () => {
  it("maps stream timeout to actionable next step", () => {
    const copy = policyErrorCopy({ code: "provider_stream_timeout" });
    expect(copy.code).toBe("provider_stream_timeout");
    expect(copy.title.toLowerCase()).toContain("too long");
    expect(copy.nextStep.length).toBeGreaterThan(10);
  });

  it("prefers explicit provider message in body", () => {
    const copy = policyErrorCopy({
      code: "provider_run_failed",
      message: "upstream 502",
    });
    expect(copy.body).toBe("upstream 502");
  });
});

describe("chatSensitivity", () => {
  it("labels temporary chats", () => {
    expect(chatSensitivity({ temporary: true }).kind).toBe("temporary");
  });

  it("labels legal hold over retained", () => {
    expect(
      chatSensitivity({
        temporary: false,
        legalHoldUntil: "2026-12-01T00:00:00.000Z",
      }).kind,
    ).toBe("legal_hold");
  });

  it("defaults to retained", () => {
    expect(chatSensitivity({}).kind).toBe("retained");
  });
});

describe("canPerformChatWriteAction", () => {
  it("blocks write actions for read-only access", () => {
    expect(canPerformChatWriteAction("read", "regenerate")).toBe(false);
    expect(canPerformChatWriteAction("read", "branch")).toBe(false);
    expect(canPerformChatWriteAction("read", "delete")).toBe(false);
    expect(canPerformChatWriteAction("read", "share")).toBe(false);
    expect(canPerformChatWriteAction("read", "send")).toBe(false);
    expect(canPerformChatWriteAction("read", "attach")).toBe(false);
  });

  it("allows rate and export for readers", () => {
    expect(canPerformChatWriteAction("read", "rate")).toBe(true);
    expect(canPerformChatWriteAction("read", "export")).toBe(true);
  });

  it("allows all for write and owner", () => {
    expect(canPerformChatWriteAction("write", "regenerate")).toBe(true);
    expect(canPerformChatWriteAction("owner", "share")).toBe(true);
    expect(canPerformChatWriteAction("write", "send")).toBe(true);
  });
});

describe("resolveChatAccess", () => {
  it("returns owner for creator and admin", () => {
    expect(
      resolveChatAccess({
        subjectId: "user_1",
        chatCreatedBy: "user_1",
        grants: [],
      }),
    ).toBe("owner");
    expect(
      resolveChatAccess({
        subjectId: "user_2",
        isAdmin: true,
        chatCreatedBy: "user_1",
        grants: [],
      }),
    ).toBe("owner");
  });

  it("returns write when principal has a write grant", () => {
    expect(
      resolveChatAccess({
        subjectId: "user_2",
        chatCreatedBy: "user_1",
        grants: [
          {
            principalType: "user",
            principalId: "user_2",
            permission: "write",
          },
        ],
      }),
    ).toBe("write");
  });

  it("returns read when principal only has a read grant (user or group)", () => {
    expect(
      resolveChatAccess({
        subjectId: "user_2",
        chatCreatedBy: "user_1",
        grants: [
          {
            principalType: "user",
            principalId: "user_2",
            permission: "read",
          },
        ],
      }),
    ).toBe("read");
    expect(
      resolveChatAccess({
        subjectId: "user_3",
        groupIds: ["group_readers"],
        chatCreatedBy: "user_1",
        grants: [
          {
            principalType: "group",
            principalId: "group_readers",
            permission: "read",
          },
        ],
      }),
    ).toBe("read");
  });

  it("defaults to read when viewing an existing foreign chat without a grant", () => {
    expect(
      resolveChatAccess({
        subjectId: "user_x",
        chatCreatedBy: "user_1",
        grants: [],
      }),
    ).toBe("read");
  });

  it("treats a new draft (no chatCreatedBy) as owner so first message can send", () => {
    expect(
      resolveChatAccess({
        subjectId: "user_1",
        chatCreatedBy: undefined,
        grants: [],
      }),
    ).toBe("owner");
    expect(
      canPerformChatWriteAction(
        resolveChatAccess({
          subjectId: "user_1",
          chatCreatedBy: undefined,
          grants: [],
        }),
        "send",
      ),
    ).toBe(true);
    expect(
      canPerformChatWriteAction(
        resolveChatAccess({
          subjectId: "user_1",
          chatCreatedBy: undefined,
          grants: [],
        }),
        "attach",
      ),
    ).toBe(true);
  });
});

describe("branch origin title helpers", () => {
  it("formats and parses branch titles", () => {
    const title = formatBranchTitle("Sample Python code");
    expect(title).toBe("Branch of Sample Python code");
    expect(parseBranchOrigin(title)).toEqual({
      sourceTitle: "Sample Python code",
    });
  });

  it("returns null for non-branch titles", () => {
    expect(parseBranchOrigin("Sample Python code")).toBeNull();
  });
});

describe("feedback reason codes", () => {
  it("accepts known codes only for negative ratings", () => {
    expect(isFeedbackReasonCode("inaccurate")).toBe(true);
    expect(isFeedbackReasonCode("nope")).toBe(false);
    expect(normalizeFeedbackReasonCode("negative", "unhelpful")).toBe(
      "unhelpful",
    );
    expect(normalizeFeedbackReasonCode("positive", "unhelpful")).toBeUndefined();
    expect(normalizeFeedbackReasonCode("negative", "bad")).toBeUndefined();
  });
});

describe("complianceExportChecklist", () => {
  it("requires schema, timestamps, and message rows for complete", () => {
    const incomplete = complianceExportChecklist({
      schema: "romeo.chat-export.v1",
      exportedAt: "2026-08-12T00:00:00.000Z",
      chat: { id: "chat_1", title: "T" },
      messages: [],
    });
    expect(incomplete.complete).toBe(false);

    const complete = complianceExportChecklist({
      schema: "romeo.chat-export.v1",
      exportedAt: "2026-08-12T00:00:00.000Z",
      chat: { id: "chat_1", title: "T", modelId: "m1", agentId: "a1" },
      messages: [
        {
          id: "msg_1",
          role: "assistant",
          content: "hi",
          modelId: "m1",
          createdAt: "2026-08-12T00:00:01.000Z",
          citations: [{ chunkId: "c1" }],
        },
      ],
    });
    expect(complete.complete).toBe(true);
    expect(complete.messagesMayIncludeModel).toBe(true);
    expect(complete.messagesMayIncludeCitations).toBe(true);
  });
});

describe("read-only production path", () => {
  it("blocks send/attach for a shared read grant and allows for owner", () => {
    const reader = resolveChatAccess({
      subjectId: "user_reader",
      chatCreatedBy: "user_owner",
      grants: [
        {
          principalType: "user",
          principalId: "user_reader",
          permission: "read",
        },
      ],
    });
    expect(reader).toBe("read");
    expect(canPerformChatWriteAction(reader, "send")).toBe(false);
    expect(canPerformChatWriteAction(reader, "attach")).toBe(false);
    expect(canPerformChatWriteAction(reader, "regenerate")).toBe(false);
    expect(canPerformChatWriteAction(reader, "share")).toBe(false);

    const owner = resolveChatAccess({
      subjectId: "user_owner",
      chatCreatedBy: "user_owner",
      grants: [],
    });
    expect(owner).toBe("owner");
    expect(canPerformChatWriteAction(owner, "send")).toBe(true);
    expect(canPerformChatWriteAction(owner, "attach")).toBe(true);
  });
});

describe("streamRecoveryPhase", () => {
  it("maps reconnect attempts to phases", () => {
    expect(
      streamRecoveryPhase({
        isStreaming: true,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        hasTerminalError: false,
      }),
    ).toBe("connected");
    expect(
      streamRecoveryPhase({
        isStreaming: true,
        reconnectAttempts: 2,
        maxReconnectAttempts: 5,
        hasTerminalError: false,
      }),
    ).toBe("reconnecting");
    expect(
      streamRecoveryPhase({
        isStreaming: true,
        reconnectAttempts: 6,
        maxReconnectAttempts: 5,
        hasTerminalError: false,
      }),
    ).toBe("failed");
    expect(
      streamRecoveryLabel("reconnecting").toLowerCase(),
    ).toContain("reconnect");
  });
});
