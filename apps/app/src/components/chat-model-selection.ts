export interface ChatModelSelection {
  assistantModelId: string | undefined;
  chatModelId: string | undefined;
  overrideModelId: string | undefined;
}

/** Resolve the model shown in the composer and used for the next run. */
export function resolveChatModelSelection(
  selection: ChatModelSelection,
): string | undefined {
  return (
    selection.overrideModelId ??
    selection.chatModelId ??
    selection.assistantModelId
  );
}
