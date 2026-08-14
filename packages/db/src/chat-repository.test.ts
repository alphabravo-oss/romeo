import { describe, expect, it } from "vitest";

import {
  toChatCommentRecord,
  toChatRecord,
  toMessagePartRecord,
  toMessagePartInsert,
  toMessageRecord,
  toQueuedChatTurnInsert,
  toQueuedChatTurnRecord,
  toQueuedChatTurnUpdate,
} from "./chat-repository";

describe("chat repository mappers", () => {
  it("maps queued-turn leases and optional payload fields", () => {
    const row: Parameters<typeof toQueuedChatTurnRecord>[0] = {
      id: "queued_turn_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      chatId: "chat_1",
      agentId: "agent_1",
      modelId: null,
      routingMode: "economy",
      researchMode: "deep",
      reasoningPolicy: {
        schemaVersion: 1,
        mode: "auto",
        effort: "high",
      },
      parentMessageConfigured: true,
      parentMessageId: "message_parent",
      content: "Queued prompt",
      agenticRag: false,
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
    };
    const mapped = toQueuedChatTurnRecord(row);
    expect(mapped).toEqual(
      expect.objectContaining({
        id: "queued_turn_1",
        routingMode: "economy",
        researchMode: "deep",
        reasoningPolicy: {
          schemaVersion: 1,
          mode: "auto",
          effort: "high",
        },
        parentMessageId: "message_parent",
        status: "leased",
        webSearch: true,
        urls: ["https://example.com/context"],
        leaseOwner: "worker_1",
        leaseExpiresAt: "2026-07-16T12:02:00.000Z",
      }),
    );
    expect(toQueuedChatTurnInsert(mapped).reasoningPolicy).toEqual(
      mapped.reasoningPolicy,
    );
    expect(toQueuedChatTurnUpdate(mapped).reasoningPolicy).toEqual(
      mapped.reasoningPolicy,
    );
    expect(
      toQueuedChatTurnRecord({ ...row, reasoningPolicy: null }).reasoningPolicy,
    ).toBeUndefined();
    expect(() =>
      toQueuedChatTurnRecord({
        ...row,
        reasoningPolicy: {
          schemaVersion: 1,
          mode: "auto",
          rawTrace: "private-secret",
        } as never,
      }),
    ).toThrow("invalid reasoning policy");
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
      activeLeafMessageId: null,
      transcriptVersion: 0n,
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
      transcriptVersion: "0",
    });
    expect("activeLeafMessageId" in chat).toBe(false);
  });

  it("maps message tree pointers and omits absent ones", () => {
    const row = {
      id: "msg_2",
      chatId: "chat_1",
      role: "assistant" as const,
      content: "Branch answer",
      citations: null,
      error: null,
      modelId: null,
      createdAt: new Date("2026-07-16T12:00:01.000Z"),
    };

    expect(toMessageRecord({ ...row, parentId: "msg_1" })).toMatchObject({
      parentId: "msg_1",
    });
    expect("parentId" in toMessageRecord({ ...row, parentId: null })).toBe(
      false,
    );
    expect(
      toChatRecord({
        id: "chat_1",
        orgId: "org_1",
        workspaceId: "workspace_1",
        title: "Branched",
        modelId: null,
        agentId: null,
        temporary: false,
        expiresAt: null,
        createdBy: "user_1",
        archivedAt: null,
        legalHoldUntil: null,
        legalHoldReason: null,
        activeLeafMessageId: "msg_2",
        transcriptVersion: 9n,
        createdAt: new Date("2026-06-27T00:00:00.000Z"),
        updatedAt: new Date("2026-06-27T00:05:00.000Z"),
      }),
    ).toMatchObject({ activeLeafMessageId: "msg_2", transcriptVersion: "9" });
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

  it("round-trips strict typed parts and fails closed on corrupted rows", () => {
    const typed = {
      schemaVersion: 1 as const,
      type: "text" as const,
      id: "msg_part_text_1",
      messageId: "msg_1",
      position: 3,
      createdAt: "2026-08-14T12:00:00.000Z",
      text: "typed text",
    };
    const stored = toMessagePartInsert(typed, 99);
    expect(stored).toMatchObject({
      position: 3,
      canonicalPosition: 3,
      schemaVersion: 1,
      type: "text",
      content: "romeo-message-text-v1:typed text",
      metadata: {},
    });
    const storedRow = {
      id: typed.id,
      messageId: typed.messageId,
      position: typed.position,
      canonicalPosition: typed.position,
      schemaVersion: 1,
      type: "text",
      content: "romeo-message-text-v1:typed text",
      metadata: {},
      createdAt: new Date(typed.createdAt),
    };
    expect(toMessagePartRecord(storedRow)).toEqual(typed);
    expect(() =>
      toMessagePartRecord({
        ...storedRow,
        metadata: { text: "smuggled" },
      }),
    ).toThrow("Invalid stored typed message part metadata");
    expect(() =>
      toMessagePartRecord({
        ...storedRow,
        type: "provider_blob",
      }),
    ).toThrow("Invalid stored typed message part type.");
    expect(() =>
      toMessagePartRecord({ ...storedRow, schemaVersion: 2 }),
    ).toThrow("Unsupported stored message part schema version.");
  });

  it("preserves metadata-only citation provenance from PostgreSQL JSON", () => {
    const message = toMessageRecord({
      id: "msg_1",
      chatId: "chat_1",
      role: "assistant",
      content: "Cited response",
      error: null,
      modelId: "model_1",
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
      parentId: null,
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
