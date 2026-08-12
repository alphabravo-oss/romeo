import { describe, expect, it } from "vitest";

import {
  type ChatSelectionState,
  isActiveChatRemoval,
  shouldApplyRequestedChat,
  shouldAutoSelectChat,
  shouldClearActiveChat,
} from "./chat-selection";

// A user with existing chats -- the population the "New chat" no-op affected.
// Someone with zero chats never saw the bug, because there was no chats[0] to
// snap back to.
const withExistingChats: ChatSelectionState = {
  activeChatId: "chat_1",
  firstChatId: "chat_1",
  isDraftingNewChat: false,
  isStreaming: false,
};

function state(patch: Partial<ChatSelectionState>): ChatSelectionState {
  return { ...withExistingChats, ...patch };
}

describe("shouldAutoSelectChat", () => {
  it("selects the first chat on a cold load with nothing active", () => {
    expect(shouldAutoSelectChat(state({ activeChatId: undefined }))).toBe(true);
  });

  it("does nothing when a chat is already active", () => {
    expect(shouldAutoSelectChat(state({}))).toBe(false);
  });

  it("does nothing when the workspace has no chats at all", () => {
    expect(
      shouldAutoSelectChat(
        state({ activeChatId: undefined, firstChatId: undefined }),
      ),
    ).toBe(false);
  });

  it("does not move the selection while a run is streaming", () => {
    expect(
      shouldAutoSelectChat(
        state({ activeChatId: undefined, isStreaming: true }),
      ),
    ).toBe(false);
  });

  // The regression. handleNewChat clears activeChatId and sets
  // isDraftingNewChat; without the flag this returned true and the effect
  // slammed the user straight back into chat_1.
  describe('the user pressed "New chat"', () => {
    const draftingNewChat = state({
      activeChatId: undefined,
      isDraftingNewChat: true,
    });

    it("keeps the chat blank even though existing chats are available", () => {
      expect(shouldAutoSelectChat(draftingNewChat)).toBe(false);
    });

    it("stays blank on re-render while the chat list is unchanged", () => {
      // The effect re-runs on every dep change; a blank chat has to survive
      // all of them, not just the first, or "New chat" flickers back.
      expect(shouldAutoSelectChat(draftingNewChat)).toBe(false);
      expect(shouldAutoSelectChat(draftingNewChat)).toBe(false);
    });

    it("stays blank when a newly created chat appears at the top of the list", () => {
      // Another tab/device creating a chat must not hijack the blank composer.
      expect(
        shouldAutoSelectChat({ ...draftingNewChat, firstChatId: "chat_new" }),
      ).toBe(false);
    });

    it("resumes auto-selecting once the draft has been sent", () => {
      // handleSubmit sets the created chat active and clears the flag. The
      // flag must not linger, or a later archive would strand the user.
      expect(
        shouldAutoSelectChat(
          state({ activeChatId: "chat_new", isDraftingNewChat: false }),
        ),
      ).toBe(false);
      expect(
        shouldAutoSelectChat(
          state({ activeChatId: undefined, isDraftingNewChat: false }),
        ),
      ).toBe(true);
    });
  });

  // The behaviour the flag must not break: when the active chat disappears,
  // snapping to the next chat is correct.
  describe("the active chat vanished", () => {
    it("re-selects the next chat after the active chat is archived", () => {
      // handleChatArchived: activeChatId cleared, drafting explicitly false.
      expect(
        shouldAutoSelectChat(
          state({
            activeChatId: undefined,
            firstChatId: "chat_2",
            isDraftingNewChat: false,
          }),
        ),
      ).toBe(true);
    });

    it("re-selects the next chat after the active chat is deleted", () => {
      // handleChatDeleted: same shape as archive.
      expect(
        shouldAutoSelectChat(
          state({
            activeChatId: undefined,
            firstChatId: "chat_2",
            isDraftingNewChat: false,
          }),
        ),
      ).toBe(true);
    });

    it("lands on nothing when the last remaining chat is archived", () => {
      expect(
        shouldAutoSelectChat(
          state({
            activeChatId: undefined,
            firstChatId: undefined,
            isDraftingNewChat: false,
          }),
        ),
      ).toBe(false);
    });

    it("does not cancel a blank chat when some other chat is deleted", () => {
      // handleChatDeleted only clears the flag when the deleted chat was the
      // active one. Drafting with nothing active, an unrelated delete must
      // leave the blank chat alone.
      expect(
        shouldAutoSelectChat(
          state({ activeChatId: undefined, isDraftingNewChat: true }),
        ),
      ).toBe(false);
    });
  });
});

describe("isActiveChatRemoval", () => {
  it("recognizes a remote deletion or archive of the active chat", () => {
    expect(
      isActiveChatRemoval("chat_1", {
        action: "deleted",
        chatId: "chat_1",
      }),
    ).toBe(true);
    expect(
      isActiveChatRemoval("chat_1", {
        action: "archived",
        chatId: "chat_1",
      }),
    ).toBe(true);
  });

  it("ignores unrelated and non-removal events", () => {
    expect(
      isActiveChatRemoval("chat_1", {
        action: "deleted",
        chatId: "chat_2",
      }),
    ).toBe(false);
    expect(
      isActiveChatRemoval("chat_1", {
        action: "updated",
        chatId: "chat_1",
      }),
    ).toBe(false);
  });
});

describe("shouldApplyRequestedChat", () => {
  it("applies a different chat requested by route state", () => {
    expect(
      shouldApplyRequestedChat({
        activeChatId: "chat_1",
        isDraftingNewChat: false,
        requestedChatId: "chat_2",
      }),
    ).toBe(true);
  });

  it("ignores the stale route value while New Chat clears the URL", () => {
    expect(
      shouldApplyRequestedChat({
        activeChatId: undefined,
        isDraftingNewChat: true,
        requestedChatId: "chat_1",
      }),
    ).toBe(false);
  });

  it("does not reselect the already-active chat", () => {
    expect(
      shouldApplyRequestedChat({
        activeChatId: "chat_1",
        isDraftingNewChat: false,
        requestedChatId: "chat_1",
      }),
    ).toBe(false);
  });
});

describe("shouldClearActiveChat", () => {
  // Pressing Back off a chat and onto the blank entry that "New chat" pushed.
  it("closes the open chat when the URL loses its chat", () => {
    expect(
      shouldClearActiveChat({
        activeChatId: "chat_1",
        isDraftingNewChat: false,
        isStreaming: false,
        requestedChatId: undefined,
      }),
    ).toBe(true);
  });

  it("leaves the chat alone while a run is streaming", () => {
    // Same rule as shouldAutoSelectChat: history must not pull the transcript
    // out from under an answer that is still being written.
    expect(
      shouldClearActiveChat({
        activeChatId: "chat_1",
        isDraftingNewChat: false,
        isStreaming: true,
        requestedChatId: undefined,
      }),
    ).toBe(false);
  });

  it("does nothing while the user is already drafting a blank chat", () => {
    // This is the state "New chat" itself produces, one tick before its own
    // navigation lands. Clearing again would be a no-op at best, and would
    // fight the auto-select fallback at worst.
    expect(
      shouldClearActiveChat({
        activeChatId: "chat_1",
        isDraftingNewChat: true,
        isStreaming: false,
        requestedChatId: undefined,
      }),
    ).toBe(false);
  });

  it("does nothing when no chat is open", () => {
    expect(
      shouldClearActiveChat({
        activeChatId: undefined,
        isDraftingNewChat: false,
        isStreaming: false,
        requestedChatId: undefined,
      }),
    ).toBe(false);
  });

  it("does nothing when the URL still names a chat", () => {
    // Back landing on another chat is shouldApplyRequestedChat's job; clearing
    // here would blank the transcript for a frame on every history step.
    expect(
      shouldClearActiveChat({
        activeChatId: "chat_1",
        isDraftingNewChat: false,
        isStreaming: false,
        requestedChatId: "chat_2",
      }),
    ).toBe(false);
  });
});
