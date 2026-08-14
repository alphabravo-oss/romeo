import type { Chat } from "./types";

import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  completeMutationNetworkRevalidation,
  markMutationNetworkOffline,
} from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import { clearRouteDataForLogout } from "../../lib/route-intent";
import {
  archiveWorkspaceChatMutationOptions,
  updateMessageFeedbackMutationOptions,
  updateChatLegalHoldMutationOptions,
  updateWorkspaceChatMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  archiveChat: vi.fn(),
  createChat: vi.fn(),
  deleteMessage: vi.fn(),
  forkChat: vi.fn(),
  importChat: vi.fn(),
  updateAttachmentRetention: vi.fn(),
  updateChat: vi.fn(),
  updateChatLegalHold: vi.fn(),
  updateMessageFeedback: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

const chat = (title: string): Chat => ({
  createdBy: "user-1",
  id: "chat-1",
  orgId: "org-1",
  title,
  transcriptVersion: "version-1",
  updatedAt: "2026-08-14T00:00:00.000Z",
  workspaceId: "workspace-1",
});

describe("chat mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("rolls an optimistic title change back after a conflict", async () => {
    const client = createRomeoQueryClient();
    const before = chat("Before");
    client.setQueryData(appQueryKeys.chat(before.id), before);
    let rejectUpdate!: (error: Error) => void;
    mutationMocks.updateChat.mockReturnValueOnce(
      new Promise<Chat>((_resolve, reject) => {
        rejectUpdate = reject;
      }),
    );
    const observer = new MutationObserver(
      client,
      updateWorkspaceChatMutationOptions(),
    );
    const mutation = observer.mutate({
      chatId: before.id,
      patch: { title: "Optimistic" },
      workspaceId: before.workspaceId,
    });
    await vi.waitFor(() =>
      expect(
        client.getQueryData<Chat>(appQueryKeys.chat(before.id))?.title,
      ).toBe("Optimistic"),
    );

    rejectUpdate(new Error("version_conflict"));
    await expect(mutation).rejects.toThrow("version_conflict");
    expect(client.getQueryData(appQueryKeys.chat(before.id))).toEqual(before);
  });

  it("invalidates only the exact chat list variants after success", async () => {
    const client = createRomeoQueryClient();
    const before = chat("Before");
    const chatsKey = appQueryKeys.chats(before.workspaceId);
    const collaborationKey = appQueryKeys.chats(
      before.workspaceId,
      "collaboration",
    );
    const unrelatedChild = [...collaborationKey, "other"] as const;
    client.setQueryData(appQueryKeys.chat(before.id), before);
    client.setQueryData(chatsKey, []);
    client.setQueryData(collaborationKey, []);
    client.setQueryData(unrelatedChild, []);
    mutationMocks.updateChat.mockResolvedValueOnce(chat("Saved"));
    const observer = new MutationObserver(
      client,
      updateWorkspaceChatMutationOptions(),
    );

    await observer.mutate({
      chatId: before.id,
      patch: { title: "Saved" },
      workspaceId: before.workspaceId,
    });

    expect(client.getQueryState(chatsKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(collaborationKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(unrelatedChild)?.isInvalidated).toBe(false);
  });

  it("does not reconcile an archive response from a logged-out session", async () => {
    const client = createRomeoQueryClient();
    let resolveArchive!: (value: Chat) => void;
    mutationMocks.archiveChat.mockReturnValueOnce(
      new Promise<Chat>((resolve) => {
        resolveArchive = resolve;
      }),
    );
    const observer = new MutationObserver(
      client,
      archiveWorkspaceChatMutationOptions(),
    );
    const mutation = observer.mutate({
      chatId: "chat-1",
      workspaceId: "workspace-1",
    });
    await vi.waitFor(() =>
      expect(mutationMocks.archiveChat).toHaveBeenCalled(),
    );

    await clearRouteDataForLogout(client);
    const nextSession = chat("Next session");
    client.setQueryData(appQueryKeys.chat(nextSession.id), nextSession);
    resolveArchive({ ...chat("Late"), archivedAt: "2026-08-14T01:00:00.000Z" });
    await mutation;

    expect(client.getQueryData(appQueryKeys.chat(nextSession.id))).toEqual(
      nextSession,
    );
  });

  it("rolls an optimistic legal-hold change back after conflict or denial", async () => {
    const client = createRomeoQueryClient();
    const before = chat("Held chat");
    const queryKey = appQueryKeys.chat(before.id);
    const observer = new MutationObserver(
      client,
      updateChatLegalHoldMutationOptions(),
    );

    for (const error of ["version_conflict", "forbidden"]) {
      client.setQueryData(queryKey, before);
      let rejectUpdate!: (reason: Error) => void;
      mutationMocks.updateChatLegalHold.mockReturnValueOnce(
        new Promise<Chat>((_resolve, reject) => {
          rejectUpdate = reject;
        }),
      );
      const mutation = observer.mutate({
        chatId: before.id,
        input: { legalHoldUntil: "2026-12-01T00:00:00.000Z" },
        workspaceId: before.workspaceId,
      });
      await vi.waitFor(() =>
        expect(client.getQueryData<Chat>(queryKey)?.legalHoldUntil).toBe(
          "2026-12-01T00:00:00.000Z",
        ),
      );

      rejectUpdate(new Error(error));
      await expect(mutation).rejects.toThrow(error);
      expect(client.getQueryData(queryKey)).toEqual(before);
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
    }
  });

  it("reconciles legal hold and invalidates only exact affected projections", async () => {
    const client = createRomeoQueryClient();
    const before = chat("Before hold");
    const updated = {
      ...before,
      legalHoldUntil: "2026-12-01T00:00:00.000Z",
    };
    const chatKey = appQueryKeys.chat(before.id);
    const chatsKey = appQueryKeys.chats(before.workspaceId);
    const collaborationKey = appQueryKeys.chats(
      before.workspaceId,
      "collaboration",
    );
    const accessKey = appQueryKeys.accessReview();
    const auditKey = appQueryKeys.auditLogs({ limit: 25 });
    const unrelated = appQueryKeys.chats("workspace-2");
    for (const queryKey of [
      chatKey,
      chatsKey,
      collaborationKey,
      accessKey,
      auditKey,
      unrelated,
    ]) {
      client.setQueryData(queryKey, queryKey === chatKey ? before : []);
    }
    mutationMocks.updateChatLegalHold.mockResolvedValueOnce(updated);
    const observer = new MutationObserver(
      client,
      updateChatLegalHoldMutationOptions(),
    );

    await observer.mutate({
      chatId: before.id,
      input: { legalHoldUntil: updated.legalHoldUntil },
      workspaceId: before.workspaceId,
    });

    expect(client.getQueryData(chatKey)).toEqual(updated);
    for (const queryKey of [
      chatKey,
      chatsKey,
      collaborationKey,
      accessKey,
      auditKey,
    ]) {
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  });

  it("executes no legal-hold write while offline", async () => {
    const client = createRomeoQueryClient();
    markMutationNetworkOffline();
    const observer = new MutationObserver(
      client,
      updateChatLegalHoldMutationOptions(),
    );

    await expect(
      observer.mutate({
        chatId: "chat-1",
        input: { legalHoldUntil: null },
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow(
      "Changes are unavailable until the secure connection is ready.",
    );
    expect(mutationMocks.updateChatLegalHold).not.toHaveBeenCalled();
  });

  it("rejects a late legal-hold response after logout without cache commit", async () => {
    const client = createRomeoQueryClient();
    let resolveUpdate!: (value: Chat) => void;
    mutationMocks.updateChatLegalHold.mockReturnValueOnce(
      new Promise<Chat>((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    const observer = new MutationObserver(
      client,
      updateChatLegalHoldMutationOptions(),
    );
    const mutation = observer.mutate({
      chatId: "chat-1",
      input: { legalHoldUntil: "2026-12-01T00:00:00.000Z" },
      workspaceId: "workspace-1",
    });
    await vi.waitFor(() =>
      expect(mutationMocks.updateChatLegalHold).toHaveBeenCalled(),
    );

    await clearRouteDataForLogout(client);
    const nextSession = chat("Next session");
    client.setQueryData(appQueryKeys.chat(nextSession.id), nextSession);
    resolveUpdate({
      ...chat("Late hold"),
      legalHoldUntil: "2026-12-01T00:00:00.000Z",
    });

    await expect(mutation).rejects.toThrow(
      "The authentication session changed.",
    );
    expect(client.getQueryData(appQueryKeys.chat(nextSession.id))).toEqual(
      nextSession,
    );
  });

  it("keeps late feedback from a prior session out of the next cache", async () => {
    const client = createRomeoQueryClient();
    let resolveFeedback!: (value: {
      chatId: string;
      configured: boolean;
      messageId: string;
      rating: "positive";
      redaction: {
        freeTextReturned: false;
        messageContentReturned: false;
        rawUsageMetadataReturned: false;
        reviewerIdentityReturned: false;
      };
    }) => void;
    mutationMocks.updateMessageFeedback.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFeedback = resolve;
      }),
    );
    const observer = new MutationObserver(
      client,
      updateMessageFeedbackMutationOptions(),
    );
    const pending = observer.mutate({
      chatId: "chat-1",
      messageId: "message-1",
      rating: "positive",
    });
    await vi.waitFor(() =>
      expect(mutationMocks.updateMessageFeedback).toHaveBeenCalledOnce(),
    );

    await clearRouteDataForLogout(client);
    resolveFeedback({
      chatId: "chat-1",
      configured: true,
      messageId: "message-1",
      rating: "positive",
      redaction: {
        freeTextReturned: false,
        messageContentReturned: false,
        rawUsageMetadataReturned: false,
        reviewerIdentityReturned: false,
      },
    });
    await pending;

    expect(
      client.getQueryData(appQueryKeys.messageFeedback("chat-1")),
    ).toBeUndefined();
  });
});
