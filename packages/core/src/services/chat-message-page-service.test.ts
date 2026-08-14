import { describe, expect, it } from "vitest";

import type { AuthSubject } from "@romeo/auth";

import { ApiError } from "../errors";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { ChatMessagePageService } from "./chat-message-page-service";

const cursorSecrets = ["message-page-unit-test-secret-00000001"] as const;

function subject(
  orgId = "org_message_page",
  workspaceId = "ws_message_page",
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

async function branchFixture() {
  const repository = new InMemoryRomeoRepository();
  const actor = subject();
  await repository.createChat({
    activeLeafMessageId: "message_leaf",
    createdBy: actor.id,
    id: "chat_message_page",
    orgId: actor.orgId,
    title: "Paged branch",
    updatedAt: "2026-08-14T12:00:00.000Z",
    workspaceId: actor.workspaceIds[0]!,
  });
  const timestamp = "2026-08-14T12:00:00.000Z";
  for (const message of [
    { id: "message_root", content: "root" },
    { id: "message_user", content: "user", parentId: "message_root" },
    { id: "message_answer", content: "answer", parentId: "message_user" },
    { id: "message_leaf", content: "leaf", parentId: "message_answer" },
    { id: "message_sibling", content: "sibling", parentId: "message_user" },
  ]) {
    await repository.createMessage({
      ...message,
      chatId: "chat_message_page",
      createdAt: timestamp,
      role:
        message.id.includes("answer") || message.id.includes("sibling")
          ? "assistant"
          : "user",
    });
  }
  return {
    actor,
    repository,
    service: new ChatMessagePageService(repository, cursorSecrets),
  };
}

describe("ChatMessagePageService", () => {
  it("returns contiguous active-branch pages root-to-leaf and excludes siblings", async () => {
    const { actor, repository, service } = await branchFixture();
    const first = await service.list({
      chatId: "chat_message_page",
      direction: "older",
      limit: 2,
      subject: actor,
    });

    expect(first.data.map((message) => message.id)).toEqual([
      "message_answer",
      "message_leaf",
    ]);
    expect(first.data.some((message) => message.id === "message_sibling")).toBe(
      false,
    );
    expect(first.meta).toMatchObject({
      activeBranchChanged: false,
      branchLeafMessageId: "message_leaf",
      hasOlder: true,
      mode: "branch",
      transcriptVersion: "5",
    });
    expect(first.meta.branchVariants).toEqual([
      {
        index: 0,
        messageId: "message_answer",
        nextLeafMessageId: "message_sibling",
        total: 2,
      },
    ]);
    const inactiveBranch = await service.list({
      branchLeafMessageId: "message_sibling",
      chatId: "chat_message_page",
      direction: "older",
      limit: 2,
      subject: actor,
    });
    expect(inactiveBranch.data.map((message) => message.id)).toEqual([
      "message_user",
      "message_sibling",
    ]);
    expect(inactiveBranch.meta).toMatchObject({
      activeBranchChanged: true,
      branchLeafMessageId: "message_sibling",
      currentActiveLeafMessageId: "message_leaf",
    });
    expect(inactiveBranch.meta.branchVariants).toEqual([
      {
        index: 1,
        messageId: "message_sibling",
        previousLeafMessageId: "message_leaf",
        total: 2,
      },
    ]);

    await repository.createMessage({
      chatId: "chat_message_page",
      content: "new live leaf",
      createdAt: "2026-08-14T12:01:00.000Z",
      id: "message_new_leaf",
      parentId: "message_leaf",
      role: "assistant",
    });
    const chat = await repository.getChat("chat_message_page");
    await repository.updateChat({
      ...chat!,
      activeLeafMessageId: "message_new_leaf",
    });
    const pinnedReader = await service.list({
      branchLeafMessageId: "message_leaf",
      chatId: "chat_message_page",
      direction: "older",
      limit: 2,
      subject: actor,
    });
    expect(pinnedReader.data.map(({ id }) => id)).toEqual([
      "message_answer",
      "message_leaf",
    ]);
    expect(pinnedReader.meta).toMatchObject({
      activeBranchChanged: true,
      branchLeafMessageId: "message_leaf",
      currentActiveLeafMessageId: "message_new_leaf",
    });
    await expect(
      service.list({
        chatId: "chat_message_page",
        cursor: first.meta.olderCursor!,
        direction: "older",
        limit: 2,
        subject: actor,
      }),
    ).rejects.toMatchObject({
      code: "message_page_reset_required",
      status: 409,
    });
    await expect(
      service.list({
        branchLeafMessageId: "message_sibling",
        chatId: "chat_message_page",
        cursor: first.meta.olderCursor!,
        direction: "older",
        limit: 2,
        subject: actor,
      }),
    ).rejects.toMatchObject({ code: "invalid_page_cursor", status: 400 });
  });

  it("increments only for structural changes and invalidates unrelated edits", async () => {
    const { actor, repository, service } = await branchFixture();
    const first = await service.list({
      chatId: "chat_message_page",
      direction: "older",
      limit: 1,
      subject: actor,
    });
    const before = await repository.getChat("chat_message_page");
    await repository.updateChat({ ...before!, title: "Nonstructural rename" });
    expect(
      (await repository.getChat("chat_message_page"))?.transcriptVersion,
    ).toBe(before?.transcriptVersion);

    await repository.createMessage({
      chatId: "chat_message_page",
      content: "unrelated sibling",
      createdAt: "2026-08-14T12:02:00.000Z",
      id: "message_unrelated_sibling",
      parentId: "message_user",
      role: "assistant",
    });
    expect(
      BigInt(
        (await repository.getChat("chat_message_page"))?.transcriptVersion ??
          "0",
      ),
    ).toBe(BigInt(before?.transcriptVersion ?? "0") + 1n);
    await expect(
      service.list({
        chatId: "chat_message_page",
        cursor: first.meta.olderCursor!,
        direction: "older",
        limit: 1,
        subject: actor,
      }),
    ).rejects.toMatchObject({
      code: "message_page_reset_required",
      status: 409,
    });
  });

  it("fails closed when deletion changes the signed page boundary", async () => {
    const { actor, repository, service } = await branchFixture();
    const first = await service.list({
      chatId: "chat_message_page",
      direction: "older",
      limit: 1,
      subject: actor,
    });
    await repository.deleteMessage("message_answer");

    await expect(
      service.list({
        branchLeafMessageId: first.meta.branchLeafMessageId!,
        chatId: "chat_message_page",
        cursor: first.meta.olderCursor!,
        direction: "older",
        limit: 1,
        subject: actor,
      }),
    ).rejects.toMatchObject({
      code: "message_page_reset_required",
      status: 409,
    });
  });

  it("rejects tampering and cross-tenant cursor replay without leaking rows", async () => {
    const { actor, repository, service } = await branchFixture();
    const first = await service.list({
      chatId: "chat_message_page",
      direction: "older",
      limit: 1,
      subject: actor,
    });
    const cursor = first.meta.olderCursor!;
    await expect(
      service.list({
        branchLeafMessageId: "message_leaf",
        chatId: "chat_message_page",
        cursor: `${cursor.slice(0, -1)}x`,
        direction: "older",
        limit: 1,
        subject: actor,
      }),
    ).rejects.toMatchObject({ code: "invalid_page_cursor", status: 400 });

    const other = subject("org_message_page_2", "ws_message_page_2");
    await repository.createChat({
      activeLeafMessageId: "other_leaf",
      createdBy: other.id,
      id: "chat_message_page_2",
      legalHoldReason: "investigation",
      legalHoldUntil: "2030-01-01T00:00:00.000Z",
      orgId: other.orgId,
      title: "Other tenant",
      updatedAt: "2026-08-14T12:00:00.000Z",
      workspaceId: other.workspaceIds[0]!,
    });
    await repository.createMessage({
      chatId: "chat_message_page_2",
      content: "privacy sentinel other tenant",
      createdAt: "2026-08-14T12:00:00.000Z",
      id: "other_leaf",
      role: "user",
    });
    await expect(
      service.list({
        branchLeafMessageId: "message_leaf",
        chatId: "chat_message_page_2",
        cursor,
        direction: "older",
        limit: 1,
        subject: other,
      }),
    ).rejects.toMatchObject({ code: "invalid_page_cursor", status: 400 });

    await repository.createChat({
      activeLeafMessageId: "same_tenant_other_leaf",
      createdBy: actor.id,
      id: "chat_message_page_other",
      orgId: actor.orgId,
      title: "Same tenant other chat",
      updatedAt: "2026-08-14T12:00:00.000Z",
      workspaceId: actor.workspaceIds[0]!,
    });
    await repository.createMessage({
      chatId: "chat_message_page_other",
      content: "cross-chat sentinel",
      createdAt: "2026-08-14T12:00:00.000Z",
      id: "same_tenant_other_leaf",
      role: "user",
    });
    await expect(
      service.list({
        chatId: "chat_message_page_other",
        cursor,
        direction: "older",
        limit: 1,
        subject: actor,
      }),
    ).rejects.toMatchObject({ code: "invalid_page_cursor", status: 400 });
  });

  it("supports empty/legal-hold legacy chats and fails closed on cycles", async () => {
    const repository = new InMemoryRomeoRepository();
    const actor = subject();
    await repository.createChat({
      createdBy: actor.id,
      id: "chat_empty_legal_hold",
      legalHoldReason: "preserve",
      legalHoldUntil: "2030-01-01T00:00:00.000Z",
      orgId: actor.orgId,
      title: "Empty",
      updatedAt: "2026-08-14T12:00:00.000Z",
      workspaceId: actor.workspaceIds[0]!,
    });
    const service = new ChatMessagePageService(repository, cursorSecrets);
    await expect(
      service.list({
        chatId: "chat_empty_legal_hold",
        direction: "older",
        limit: 100,
        subject: actor,
      }),
    ).resolves.toMatchObject({
      data: [],
      meta: { hasOlder: false, mode: "linear" },
    });

    await repository.createMessage({
      chatId: "chat_empty_legal_hold",
      content: "a",
      createdAt: "2026-08-14T12:00:00.000Z",
      id: "cycle_a",
      parentId: "cycle_b",
      role: "user",
    });
    await repository.createMessage({
      chatId: "chat_empty_legal_hold",
      content: "b",
      createdAt: "2026-08-14T12:00:00.000Z",
      id: "cycle_b",
      parentId: "cycle_a",
      role: "assistant",
    });
    const chat = await repository.getChat("chat_empty_legal_hold");
    await repository.updateChat({ ...chat!, activeLeafMessageId: "cycle_a" });
    await expect(
      service.list({
        chatId: "chat_empty_legal_hold",
        direction: "older",
        limit: 10,
        subject: actor,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("uses a stable createdAt+id keyset for legacy linear chats", async () => {
    const repository = new InMemoryRomeoRepository();
    const actor = subject();
    await repository.createChat({
      createdBy: actor.id,
      id: "chat_linear_page",
      orgId: actor.orgId,
      title: "Linear legacy",
      updatedAt: "2026-08-14T12:00:00.000Z",
      workspaceId: actor.workspaceIds[0]!,
    });
    const timestamp = "2026-08-14T12:00:00.000Z";
    for (const id of ["linear_a", "linear_b", "linear_c", "linear_d"]) {
      await repository.createMessage({
        chatId: "chat_linear_page",
        content: id,
        createdAt: timestamp,
        id,
        role: "user",
      });
    }
    const service = new ChatMessagePageService(repository, cursorSecrets);
    const first = await service.list({
      chatId: "chat_linear_page",
      direction: "older",
      limit: 2,
      subject: actor,
    });
    expect(first.data.map((message) => message.id)).toEqual([
      "linear_c",
      "linear_d",
    ]);

    await repository.createMessage({
      chatId: "chat_linear_page",
      content: "concurrent insert",
      createdAt: timestamp,
      id: "linear_z",
      role: "assistant",
    });
    await repository.deleteMessage("linear_b");
    await expect(
      service.list({
        chatId: "chat_linear_page",
        cursor: first.meta.olderCursor!,
        direction: "older",
        limit: 2,
        subject: actor,
      }),
    ).rejects.toMatchObject({
      code: "message_page_reset_required",
      status: 409,
    });
  });
});
