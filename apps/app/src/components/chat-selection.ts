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
