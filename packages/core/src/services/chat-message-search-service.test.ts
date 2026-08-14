import { describe, expect, it } from "vitest";

import type { AuthSubject } from "@romeo/auth";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { ChatMessageSearchService } from "./chat-message-search-service";

const cursorSecrets = ["message-search-unit-test-secret-000001"] as const;

function subject(
  orgId = "org_message_search",
  workspaceId = "ws_message_search",
): AuthSubject {
  return {
    groupIds: [],
    id: `admin_${orgId}`,
    isAdmin: true,
    orgId,
    scopes: ["chats:read"],
    type: "user",
    workspaceIds: [workspaceId],
  };
}

async function fixture() {
  const repository = new InMemoryRomeoRepository();
  const actor = subject();
  await repository.createChat({
    activeLeafMessageId: "message_active_leaf",
    createdBy: actor.id,
    id: "chat_message_search",
    orgId: actor.orgId,
    title: "Search fixture",
    updatedAt: "2026-08-14T12:00:00.000Z",
    workspaceId: actor.workspaceIds[0]!,
  });
  const messages = [
    {
      content: "Root enterprise security finding",
      id: "message_root",
      role: "user" as const,
    },
    {
      content: "Active enterprise security answer",
      id: "message_active",
      parentId: "message_root",
      role: "assistant" as const,
    },
    {
      content: "Active leaf without a match",
      id: "message_active_leaf",
      parentId: "message_active",
      role: "user" as const,
    },
    {
      content: "Alternate enterprise security answer",
      id: "message_alternate",
      parentId: "message_root",
      role: "assistant" as const,
    },
  ];
  for (const [index, message] of messages.entries()) {
    await repository.createMessage({
      ...message,
      chatId: "chat_message_search",
      createdAt: `2026-08-14T12:0${index}:00.000Z`,
    });
  }
  return {
    actor,
    repository,
    service: new ChatMessageSearchService(repository, cursorSecrets),
  };
}

describe("ChatMessageSearchService", () => {
  it("returns bounded chronological results with active-branch indication", async () => {
    const { actor, service } = await fixture();
    const first = await service.search({
      chatId: "chat_message_search",
      limit: 2,
      query: "  ENTERPRISE SECURITY  ",
      subject: actor,
    });

    expect(first.data).toMatchObject([
      {
        branch: "active",
        branchLeafMessageId: "message_root",
        messageId: "message_root",
      },
      {
        branch: "active",
        branchLeafMessageId: "message_active",
        messageId: "message_active",
      },
    ]);
    expect(first.meta).toMatchObject({ hasMore: true, limit: 2, total: 3 });
    expect(first.meta.nextCursor).toEqual(expect.any(String));

    const second = await service.search({
      chatId: "chat_message_search",
      cursor: first.meta.nextCursor!,
      limit: 2,
      query: "enterprise security",
      subject: actor,
    });
    expect(second.data).toMatchObject([
      {
        branch: "alternate",
        branchLeafMessageId: "message_alternate",
        messageId: "message_alternate",
      },
    ]);
    expect(second.meta).toMatchObject({ hasMore: false, total: 3 });
  });

  it("binds cursors to query, limit, tenant, chat, and transcript version", async () => {
    const { actor, repository, service } = await fixture();
    const first = await service.search({
      chatId: "chat_message_search",
      limit: 1,
      query: "enterprise",
      subject: actor,
    });
    const cursor = first.meta.nextCursor!;

    await expect(
      service.search({
        chatId: "chat_message_search",
        cursor,
        limit: 2,
        query: "enterprise",
        subject: actor,
      }),
    ).rejects.toMatchObject({ code: "invalid_page_cursor", status: 400 });
    await expect(
      service.search({
        chatId: "chat_message_search",
        cursor,
        limit: 1,
        query: "security",
        subject: actor,
      }),
    ).rejects.toMatchObject({ code: "invalid_page_cursor", status: 400 });

    await repository.createMessage({
      chatId: "chat_message_search",
      content: "A later enterprise result",
      createdAt: "2026-08-14T12:05:00.000Z",
      id: "message_later",
      parentId: "message_active_leaf",
      role: "assistant",
    });
    await expect(
      service.search({
        chatId: "chat_message_search",
        cursor,
        limit: 1,
        query: "enterprise",
        subject: actor,
      }),
    ).rejects.toMatchObject({
      code: "message_page_reset_required",
      status: 409,
    });
  });

  it("enforces chat ACLs and removes deleted content from new searches", async () => {
    const { actor, repository, service } = await fixture();
    await expect(
      service.search({
        chatId: "chat_message_search",
        limit: 25,
        query: "enterprise",
        subject: subject("org_other", "ws_other"),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const current = await repository.getChat("chat_message_search");
    await expect(
      repository.searchAuthorizedChatMessages({
        chatId: "chat_message_search",
        limit: 25,
        normalizedQuery: "enterprise",
        orgId: "org_other",
        transcriptVersion: current?.transcriptVersion ?? "0",
        workspaceId: "ws_other",
      }),
    ).resolves.toMatchObject({
      invalidTranscriptVersion: true,
      items: [],
      total: 0,
    });

    await repository.deleteMessage("message_alternate");
    const result = await service.search({
      chatId: "chat_message_search",
      limit: 25,
      query: "enterprise",
      subject: actor,
    });
    expect(result.meta.total).toBe(2);
    expect(result.data.map((item) => item.messageId)).not.toContain(
      "message_alternate",
    );
  });

  it("rejects unbounded direct-service input before repository search", async () => {
    const { actor, service } = await fixture();
    await expect(
      service.search({
        chatId: "chat_message_search",
        limit: 51,
        query: "enterprise",
        subject: actor,
      }),
    ).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    await expect(
      service.search({
        chatId: "chat_message_search",
        limit: 25,
        query: "x",
        subject: actor,
      }),
    ).rejects.toMatchObject({ code: "invalid_request", status: 400 });
  });
});
