import { describe, expect, it } from "vitest";

import {
  type ChatSelectionState,
  shouldAutoSelectChat,
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
