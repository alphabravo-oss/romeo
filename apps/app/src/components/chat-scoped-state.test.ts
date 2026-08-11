import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueuedChatTurn } from "../features/runs";
import type { MessageFeedbackState } from "../features/types";
import { useChatMessageState } from "./useChatMessageState";
import { useWorkspaceChatActions } from "./useWorkspaceChatActions";
import { useWorkspaceTurnActions } from "./useWorkspaceTurnActions";

// A run outlives the chat it started in, so its settle hook fires while the
// reader is somewhere else entirely. These are the writes that hook performs;
// every one of them has to land on the chat it names.
const server = vi.hoisted(() => ({
  cancelled: [] as string[],
  queues: new Map<string, unknown[]>(),
}));

vi.mock("../features", () => ({
  archiveChat: vi.fn(),
  createChat: vi.fn(),
  deleteMessage: vi.fn(),
  fileContentUrl: (fileId: string) => fileId,
  forkChat: vi.fn(),
  updateAttachmentRetention: vi.fn(),
  updateChat: vi.fn(),
  updateMessageFeedback: vi.fn((input: { messageId: string; rating: string }) =>
    Promise.resolve({ messageId: input.messageId, rating: input.rating }),
  ),
}));

vi.mock("../features/runs", () => ({
  cancelQueuedTurn: vi.fn((chatId: string, turnId: string) => {
    server.cancelled.push(`${chatId}:${turnId}`);
    return Promise.resolve({});
  }),
  cancelRun: vi.fn(),
  enqueueChatTurn: vi.fn(),
  getActiveChatRun: vi.fn(() => Promise.resolve(null)),
  getRun: vi.fn(),
  listQueuedTurns: vi.fn((chatId: string) =>
    Promise.resolve(server.queues.get(chatId) ?? []),
  ),
  startRun: vi.fn(),
  streamRunEvents: vi.fn(),
}));

// The hooks run outside React here; `mutateAsync` is all they use of it.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useMutation: <Input, Output>(options: {
    mutationFn: (input: Input) => Promise<Output>;
  }) => ({ mutateAsync: options.mutationFn }),
}));

function queuedTurn(chatId: string, id: string): QueuedChatTurn {
  return {
    id,
    chatId,
    content: "Queued question.",
    idempotencyKey: id,
    status: "failed",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function feedbackOf(
  queryClient: QueryClient,
  chatId: string,
): Record<string, MessageFeedbackState> {
  return (
    queryClient.getQueryData<Record<string, MessageFeedbackState>>([
      "messageFeedback",
      chatId,
    ]) ?? {}
  );
}

function queueOf(queryClient: QueryClient, chatId: string): string[] {
  return (
    queryClient
      .getQueryData<QueuedChatTurn[]>(["queuedTurns", chatId])
      ?.map((turn) => turn.id) ?? []
  );
}

/** The turn-actions hook needs the whole workspace; only the cache matters. */
function turnActions(queryClient: QueryClient, activeChatId: string) {
  return useWorkspaceTurnActions({
    activeAgentId: "agent_1",
    activeChatId,
    allMessages: [],
    autoTitleEnabled: false,
    appendMessage: () => "msg_new",
    attachedUrls: [],
    clearPendingAttachments: () => {},
    documentAttachments: [],
    draft: "",
    imageAttachments: [],
    isStreaming: false,
    messages: [],
    queryClient,
    refreshUsageControls: () => Promise.resolve(),
    restoreMessages: () => {},
    restorePendingAttachments: () => {},
    selectedModelId: undefined,
    setActiveChatId: () => {},
    setAttachedUrls: () => {},
    setDraft: () => {},
    setError: () => {},
    setIsDraftingNewChat: () => {},
    setTemporaryNextChat: () => {},
    syncPersistedMessages: () => Promise.resolve(),
    t: (key) => key,
    temporaryNextChat: false,
    webSearchEnabled: false,
    workspaceId: "ws_1",
  });
}

function chatActions(queryClient: QueryClient, activeChatId: string) {
  return useWorkspaceChatActions({
    activeChatId,
    allMessages: [],
    followQueuedRuns: () => Promise.resolve(),
    queryClient,
    setActiveAgentId: () => {},
    setActiveChatId: () => {},
    setAttachedUrls: () => {},
    setError: () => {},
    setIsDraftingNewChat: () => {},
    setModelOverrideId: () => {},
    setSpeechArtifacts: () => {},
    setTemporaryNextChat: () => {},
    syncPersistedMessages: () => Promise.resolve(),
    t: (key) => key,
    trackChatRun: () => {},
    workspaceId: "ws_1",
  });
}

describe("a background run settling in another chat", () => {
  beforeEach(() => {
    server.cancelled.length = 0;
    server.queues.clear();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // chat_a's run settles while chat_b is on screen: its settle hook refreshes
  // the feedback of the chat it names. A shared slot made that refresh wipe the
  // rating the reader had just given in chat_b.
  it("leaves the visible chat's ratings alone", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["messageFeedback", "chat_a"], {});
    const messageState = useChatMessageState({
      activeChatId: "chat_b",
      isStreaming: false,
      queryClient,
      setError: () => {},
    });

    await messageState.handleRateMessage("msg_b1", "positive");
    expect(feedbackOf(queryClient, "chat_b").msg_b1?.rating).toBe("positive");

    await messageState.syncPersistedMessages("chat_a");

    expect(feedbackOf(queryClient, "chat_b").msg_b1?.rating).toBe("positive");
    // The refresh reached chat_a, so it is addressed rather than merely inert.
    expect(
      queryClient.getQueryState(["messageFeedback", "chat_a"])?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["messageFeedback", "chat_b"])?.isInvalidated,
    ).toBe(false);
  });

  // The same settle hook drains chat_a's queue, re-reading it every 100ms for
  // up to three seconds. Those reads used to replace the queue rendered under
  // chat_b's composer with chat_a's.
  it("leaves the visible chat's queued turns alone", async () => {
    const queryClient = new QueryClient();
    server.queues.set("chat_a", [queuedTurn("chat_a", "turn_a")]);
    queryClient.setQueryData<QueuedChatTurn[]>(
      ["queuedTurns", "chat_b"],
      [queuedTurn("chat_b", "turn_b")],
    );

    await turnActions(queryClient, "chat_b").followQueuedRuns(
      "chat_a",
      "run_a",
    );

    expect(queueOf(queryClient, "chat_b")).toEqual(["turn_b"]);
    expect(queueOf(queryClient, "chat_a")).toEqual(["turn_a"]);
  });

  // Cancelling addresses the turn's own chat: sending chat_a's turn id to
  // chat_b is a 404, which surfaces as an error the reader cannot act on.
  it("cancels a queued turn against the chat that owns it", async () => {
    const queryClient = new QueryClient();

    await chatActions(queryClient, "chat_b").handleCancelQueuedTurn(
      queuedTurn("chat_a", "turn_a"),
    );

    expect(server.cancelled).toEqual(["chat_a:turn_a"]);
  });
});
