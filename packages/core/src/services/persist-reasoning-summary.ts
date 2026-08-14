export interface PersistedReasoningSummary {
  kind: "reasoning_summary";
  classification: "provider_safe_summary";
  characterCount: number;
  durationMs?: number;
  reasoningTokens?: number;
  text: string;
}

export function persistReasoningSummary(input: {
  classification: string;
  text: string;
  durationMs?: number;
  reasoningTokens?: number;
  dlpBlocked: boolean;
  retentionAllowsPersist: boolean;
  answerBody: string;
}):
  | { outcome: "stored"; record: PersistedReasoningSummary; answerBody: string }
  | {
      outcome: "discarded";
      code: "hidden_trace" | "dlp_blocked" | "retention_denied";
      answerBody: string;
    } {
  const answerBody = input.answerBody;
  if (input.classification !== "provider_safe_summary")
    return { outcome: "discarded", code: "hidden_trace", answerBody };
  if (input.dlpBlocked)
    return { outcome: "discarded", code: "dlp_blocked", answerBody };
  if (!input.retentionAllowsPersist)
    return { outcome: "discarded", code: "retention_denied", answerBody };
  return {
    outcome: "stored",
    answerBody,
    record: {
      kind: "reasoning_summary",
      classification: "provider_safe_summary",
      characterCount: input.text.length,
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
      ...(input.reasoningTokens === undefined
        ? {}
        : { reasoningTokens: input.reasoningTokens }),
      text: input.text,
    },
  };
}
