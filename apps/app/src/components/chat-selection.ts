// Pure chat-selection logic for useWorkspaceController. Kept UI-free (and
// import-free) so it can be unit-tested without a DOM.
//
// `activeChatId === undefined` is ambiguous. It is what BOTH of these look
// like, and they want opposite things from the auto-select effect:
//
//   - the active chat vanished (archived/deleted, or its workspace was
//     archived) -> snap to the next chat, because the thing the user was
//     looking at no longer exists;
//   - the user pressed "New chat" -> stay blank, because a blank composer IS
//     the request. `handleSubmit` creates the chat lazily on first send, so
//     "no chat yet" is a legitimate resting state, not a gap to be filled.
//
// Reading only `activeChatId`, the effect cannot tell those apart -- that is
// the actual defect behind "New chat is a no-op". Anyone with at least one
// existing chat pressed "New chat", the effect saw `undefined` on the very
// next render, and re-selected chats[0] along with its messages.
//
// `isDraftingNewChat` is the explicit intent signal that separates the two.

export interface ChatSelectionState {
  /** The chat currently open, or undefined when none is selected. */
  activeChatId: string | undefined;
  /** chats[0]?.id -- the chat auto-selection would fall back to. */
  firstChatId: string | undefined;
  /** True only while the user is composing a chat that does not exist yet. */
  isDraftingNewChat: boolean;
  /** True while a run is streaming; selection must not move underneath it. */
  isStreaming: boolean;
}

export function shouldAutoSelectChat(state: ChatSelectionState): boolean {
  // Something is already open -- nothing to fall back to.
  if (state.activeChatId !== undefined) return false;
  // No chats exist yet, so there is nothing to select.
  if (state.firstChatId === undefined) return false;
  // Never yank the selection out from under an in-flight run.
  if (state.isStreaming) return false;
  // The user explicitly asked for a blank chat. Auto-selecting chats[0] here
  // is precisely what made "New chat" a no-op.
  return !state.isDraftingNewChat;
}

export function shouldApplyRequestedChat(state: {
  activeChatId: string | undefined;
  isDraftingNewChat: boolean;
  requestedChatId: string | undefined;
}): state is {
  activeChatId: string | undefined;
  isDraftingNewChat: false;
  requestedChatId: string;
} {
  return (
    !state.isDraftingNewChat &&
    state.requestedChatId !== undefined &&
    state.requestedChatId !== state.activeChatId
  );
}

/**
 * Whether a `?chat`-less URL should close the chat that is currently open.
 *
 * This is the other half of `shouldApplyRequestedChat`, and it exists because
 * Back was asymmetric without it. "New chat" pushes a blank entry; opening a
 * chat pushes one that names it. Walking forward off the blank entry works
 * because the URL names a chat and `shouldApplyRequestedChat` picks it up.
 * Walking BACK onto the blank entry used to do nothing at all -- the URL lost
 * its chat, but nothing was watching for a chat to disappear -- so Back looked
 * broken while Forward worked.
 *
 * Callers must only consult this when `?chat` has actually CHANGED. The URL
 * trails our own selections by a tick, so "the URL has no chat right now" is
 * also what the moment just after auto-selecting the most recent chat looks
 * like, and clearing there would close the chat the app just opened.
 */
export function shouldClearActiveChat(state: {
  activeChatId: string | undefined;
  isDraftingNewChat: boolean;
  isStreaming: boolean;
  requestedChatId: string | undefined;
}): boolean {
  // The URL names a chat, so this is a move between chats, not a clear.
  if (state.requestedChatId !== undefined) return false;
  // Nothing open to close -- "New chat" already left the app in this state.
  if (state.activeChatId === undefined) return false;
  // A blank composer is already what the user asked for.
  if (state.isDraftingNewChat) return false;
  // Same rule as auto-select: never move the selection under an in-flight run.
  return !state.isStreaming;
}

export function isActiveChatRemoval(
  activeChatId: string | undefined,
  event: { action: string; chatId: string } | undefined,
): event is { action: "archived" | "deleted"; chatId: string } {
  return (
    activeChatId !== undefined &&
    event?.chatId === activeChatId &&
    (event.action === "archived" || event.action === "deleted")
  );
}
