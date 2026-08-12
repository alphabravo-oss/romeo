import type { RunContextPreview } from "../features/chat";

export interface ContextMeterValue {
  contextWindow: number | undefined;
  /** False whenever any part of the number came from the local estimate. */
  exact: boolean;
  percent: number | undefined;
  retainedFiles: number;
  usedTokens: number;
}

/**
 * A copy of the server's estimator (packages/core token-estimate.ts) rather
 * than an import of it: the architecture ratchet's `ui_imports_server_packages`
 * rule forbids apps/app UI files from importing @romeo/core, whose barrel
 * re-exports the entire server service layer. The meter is only honest if the
 * client counts a draft the same way the budget that gates the run counts it,
 * so context-meter.test.ts runs both functions over the same inputs and fails
 * the moment they disagree.
 *
 * ponytail: the ceiling is that the copy can drift between test runs, and the
 * equivalence check only covers the samples it is given. Upgrade path: move
 * token-estimate.ts into a leaf package that both the browser and the server
 * may import, which is a new workspace package for four lines of code.
 */
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

/**
 * The context preview is a snapshot the reader asked for; the draft is live.
 * Nothing here calls the inspect endpoint — it costs an embedding request, a
 * vector search and an object-store fan-out per call, which is not something a
 * keystroke may trigger.
 *
 * ponytail: the ceiling is that a preview taken with text already in the box
 * counted that text, so while the same draft is still there the meter counts it
 * twice; `exact: false` (the leading "~") is the honest signal, and the error is
 * bounded by the draft itself. Upgrade path: have the inspect response report
 * the draft's token cost separately from the conversation's.
 */
export function contextMeterValue(input: {
  contextWindow: number | undefined;
  draft: string;
  preview: RunContextPreview | undefined;
}): ContextMeterValue {
  const draftTokens = estimateTokens(input.draft);
  const usedTokens =
    (input.preview?.budget.estimatedInputTokens ?? 0) + draftTokens;
  // The preview names the model that actually answered, which beats the picker
  // when the two disagree (a managed override, or a model swapped mid-chat).
  const contextWindow =
    input.preview?.model.contextWindow ?? input.contextWindow;
  return {
    contextWindow,
    exact: input.preview !== undefined && draftTokens === 0,
    percent:
      contextWindow === undefined || contextWindow <= 0
        ? undefined
        : Math.min(100, Math.round((usedTokens / contextWindow) * 100)),
    retainedFiles: input.preview?.attachments.retainedDocuments.length ?? 0,
    usedTokens,
  };
}
