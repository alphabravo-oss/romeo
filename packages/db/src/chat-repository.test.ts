import { describe, expect, it } from "vitest";

import {
  toChatCommentRecord,
  toChatRecord,
  toMessagePartRecord,
} from "./chat-repository";

describe("chat repository mappers", () => {
  it("maps optional chat lifecycle fields", () => {
    const chat = toChatRecord({
      id: "chat_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      title: "Incident review",
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
