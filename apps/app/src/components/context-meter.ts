import type { RunContextPreview } from "../features/chat";

export interface ContextMeterMessage {
  content: string;
  error?: { code: string } | null;
  role: string;
}

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

/** Per-message framing cost mirrored from the server budget builder. */
const messageFramingTokens = 4;

/**
 * Live estimate of conversation history the next send will carry. Skips
 * failed/cancelled assistant rows (error-only) so they do not inflate the bar.
 */
export function estimateHistoryTokens(
  messages: ContextMeterMessage[] | undefined,
): number {
  if (messages === undefined || messages.length === 0) return 0;
  let total = 0;
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (message.error !== undefined && message.error !== null) continue;
    const content = message.content.trim();
    if (content.length === 0) continue;
    total += estimateTokens(content) + messageFramingTokens;
  }
  return total;
}

/**
 * The draft is always live. History is estimated from the visible transcript so
 * the meter moves when replies land without waiting for an inspect click.
 * An inspect preview still supplies retained-file counts and a model window when
 * present; its token total is not mixed in (it would double-count the draft).
 */
export function contextMeterValue(input: {
  contextWindow: number | undefined;
  draft: string;
  messages?: ContextMeterMessage[];
  preview: RunContextPreview | undefined;
  systemPrompt?: string;
}): ContextMeterValue {
  const draftTokens = estimateTokens(input.draft);
  const historyTokens = estimateHistoryTokens(input.messages);
  const systemTokens =
    input.systemPrompt === undefined || input.systemPrompt.trim().length === 0
      ? 0
      : estimateTokens(input.systemPrompt) + messageFramingTokens;
  const usedTokens = historyTokens + systemTokens + draftTokens;
  // Prefer the model window from a recent inspect, else the composer's selection.
  const contextWindow =
    input.preview?.model.contextWindow ?? input.contextWindow;
  return {
    contextWindow,
    // Local estimator only — never claim exact without a dedicated budget API.
    exact: false,
    percent:
      contextWindow === undefined || contextWindow <= 0
        ? undefined
        : Math.min(100, Math.round((usedTokens / contextWindow) * 100)),
    retainedFiles: input.preview?.attachments.retainedDocuments.length ?? 0,
    usedTokens,
  };
}
