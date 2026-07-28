// Pure chat-turn lifecycle decisions for useWorkspaceTurnActions. Kept
// UI-free (and import-free) so the failure path can be tested without a DOM.
//
// Sending clears the composer before the server accepts the run. If that
// request is rejected, the exact draft, transcript, and attachment previews
// must survive so the user can correct the request and retry. Once the server
// accepts the run, however, the client must not restore the pre-send state
// merely because a later stream or refresh step fails: the turn now exists on
// the server and restoring it would invite an accidental duplicate send.
//
// Message controls have the same boundary. Handlers guard against actions
// while a run is streaming, so their visible controls must use the identical
// predicate instead of accepting a click that will be silently discarded.

export interface TurnSnapshot<TMessage> {
  draft: string;
  messages: readonly TMessage[];
}

export interface TurnOutcome<TMessage> {
  draft: string;
  messages: readonly TMessage[];
  revokePreviews: boolean;
}

/** What the composer and transcript must look like after a send attempt. */
export function resolveTurnOutcome<TMessage>(input: {
  snapshot: TurnSnapshot<TMessage>;
  accepted: boolean;
}): TurnOutcome<TMessage> {
  return input.accepted
    ? { draft: "", messages: input.snapshot.messages, revokePreviews: true }
    : {
        draft: input.snapshot.draft,
        messages: input.snapshot.messages,
        revokePreviews: false,
      };
}

/** Message-level actions are unavailable while a run is streaming. */
export function isMessageActionEnabled(input: {
  isStreaming: boolean;
  hasActiveChat: boolean;
}): boolean {
  return !input.isStreaming && input.hasActiveChat;
}
