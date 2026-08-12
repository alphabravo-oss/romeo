export interface ChatModelSelection {
  assistantModelId: string | undefined;
  chatModelId: string | undefined;
  /** Explicit user default for this workspace. */
  defaultModelId: string | undefined;
  /** Soft fallback: last model the user selected in this workspace. */
  lastModelId: string | undefined;
  overrideModelId: string | undefined;
}

/**
 * Resolve the model shown in the composer and used for the next run.
 *
 * Priority:
 * 1. in-session override (just picked / not yet reconciled)
 * 2. model saved on this chat
 * 3. user's explicit default for the workspace
 * 4. last model the user selected in the workspace
 * 5. curated model's base model
 */
export function resolveChatModelSelection(
  selection: ChatModelSelection,
): string | undefined {
  return (
    selection.overrideModelId ??
    selection.chatModelId ??
    selection.defaultModelId ??
    selection.lastModelId ??
    selection.assistantModelId
  );
}

/** Last assistant reply's model on the visible branch, if any. */
export function lastAssistantModelId(
  messages: Array<{ role: string; modelId?: string }>,
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.modelId !== undefined) {
      return message.modelId;
    }
  }
  return undefined;
}
