import { describe, expect, it } from "vitest";

import {
  toChatCommentRecord,
  toChatRecord,
  toMessagePartRecord,
  toMessageRecord,
  toQueuedChatTurnRecord,
} from "./chat-repository";

describe("chat repository mappers", () => {
  it("maps queued-turn leases and optional payload fields", () => {
    expect(
      toQueuedChatTurnRecord({
        id: "queued_turn_1",
        orgId: "org_1",
        workspaceId: "workspace_1",
        chatId: "chat_1",
        agentId: "agent_1",
        modelId: null,
        content: "Queued prompt",
        webSearch: true,
        urls: ["https://example.com/context"],
        createdBy: "user_1",
        principalId: "user_1",
        principalType: "user",
        scopeSnapshot: ["chats:write", "runs:create"],
        idempotencyKey: "request_1",
        status: "leased",
        attemptCount: 1,
        leaseOwner: "worker_1",
        leaseToken: "lease_1",
        leaseExpiresAt: new Date("2026-07-16T12:02:00.000Z"),
        heartbeatAt: new Date("2026-07-16T12:01:00.000Z"),
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: new Date("2026-07-16T12:00:00.000Z"),
        updatedAt: new Date("2026-07-16T12:01:00.000Z"),
        completedAt: null,
      }),
    ).toEqual(
      expect.objectContaining({
        id: "queued_turn_1",
        status: "leased",
        webSearch: true,
        urls: ["https://example.com/context"],
        leaseOwner: "worker_1",
        leaseExpiresAt: "2026-07-16T12:02:00.000Z",
      }),
    );
  });

  it("maps optional chat lifecycle fields", () => {
    const chat = toChatRecord({
      id: "chat_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      title: "Incident review",
      modelId: null,
      agentId: null,
      temporary: false,
      expiresAt: null,
      createdBy: "user_1",
      archivedAt: null,
      legalHoldUntil: new Date("2026-07-01T00:00:00.000Z"),
      legalHoldReason: "investigation",
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:05:00.000Z"),
    });

    expect(chat).toEqual({
      id: "chat_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      title: "Incident review",
      createdBy: "user_1",
      legalHoldUntil: "2026-07-01T00:00:00.000Z",
      legalHoldReason: "investigation",
      updatedAt: "2026-06-27T00:05:00.000Z",
    });
  });

  it("maps message parts without exposing internal ordering columns", () => {
    const part = toMessagePartRecord({
      id: "msg_part_1",
      messageId: "msg_1",
      position: 2,
      type: "attachment",
      content: "chat-attachments/msg_1/msg_part_1/image.png",
      metadata: {
        fileName: "image.png",
        mimeType: "image/png",
        nested: { ignoredByPublicAttachment: true },
        sizeBytes: 128,
      },
    });

    expect(part).toEqual({
      id: "msg_part_1",
      messageId: "msg_1",
      type: "attachment",
      content: "chat-attachments/msg_1/msg_part_1/image.png",
      metadata: {
        fileName: "image.png",
        mimeType: "image/png",
        nested: { ignoredByPublicAttachment: true },
        sizeBytes: 128,
      },
    });
    expect(JSON.stringify(part)).not.toContain("position");
  });

  it("preserves metadata-only citation provenance from PostgreSQL JSON", () => {
    const message = toMessageRecord({
      id: "msg_1",
      chatId: "chat_1",
      role: "assistant",
      content: "Cited response",
      citations: [
        {
          chunkId: "chunk_1",
          documentId: "document_1",
          title: "Source",
          sourceUri: "https://docs.example.test/source",
          sourceType: "web_search",
          provider: "tavily",
          retrievedAt: "2026-07-16T12:00:00.000Z",
          accessedAt: "2026-07-16T12:00:00.000Z",
          publishedAt: "2026-07-15T12:00:00.000Z",
        },
      ],
      createdAt: new Date("2026-07-16T12:00:01.000Z"),
    });

    expect(message.citations?.[0]).toMatchObject({
      sourceType: "web_search",
      provider: "tavily",
      retrievedAt: "2026-07-16T12:00:00.000Z",
      accessedAt: "2026-07-16T12:00:00.000Z",
      publishedAt: "2026-07-15T12:00:00.000Z",
    });
  });

  it("normalizes mentioned user IDs from chat comments", () => {
    const comment = toChatCommentRecord({
      id: "comment_1",
      orgId: "org_1",
      chatId: "chat_1",
      authorId: "user_1",
      body: "Please review.",
      mentionedUserIds: ["user_2", 7, "user_3"] as never,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(comment.mentionedUserIds).toEqual(["user_2", "user_3"]);
  });
});
