import { describe, expect, it } from "vitest";

import { persistReasoningSummary } from "./persist-reasoning-summary";

describe("reasoning summary persistence", () => {
  it("stores a safe summary apart from the assistant answer after DLP", () => {
    const stored = persistReasoningSummary({
      classification: "provider_safe_summary",
      text: "Considered two retrieval paths.",
      durationMs: 40,
      reasoningTokens: 12,
      dlpBlocked: false,
      retentionAllowsPersist: true,
      answerBody: "Use the first path.",
    });
    expect(stored).toMatchObject({
      outcome: "stored",
      answerBody: "Use the first path.",
      record: {
        kind: "reasoning_summary",
        classification: "provider_safe_summary",
        characterCount: "Considered two retrieval paths.".length,
        durationMs: 40,
        reasoningTokens: 12,
      },
    });
    if (stored.outcome !== "stored") throw new Error("expected stored");
    expect(stored.answerBody).not.toContain(stored.record.text);
  });

  it("discards hidden traces, DLP hits, and retention-denied summaries", () => {
    expect(
      persistReasoningSummary({
        classification: "hidden_reasoning_omitted",
        text: "raw chain of thought",
        dlpBlocked: false,
        retentionAllowsPersist: true,
        answerBody: "ok",
      }),
    ).toMatchObject({ outcome: "discarded", code: "hidden_trace", answerBody: "ok" });
    expect(
      persistReasoningSummary({
        classification: "provider_safe_summary",
        text: "ssn 078-05-1120",
        dlpBlocked: true,
        retentionAllowsPersist: true,
        answerBody: "ok",
      }),
    ).toMatchObject({ outcome: "discarded", code: "dlp_blocked" });
    expect(
      persistReasoningSummary({
        classification: "provider_safe_summary",
        text: "expired",
        dlpBlocked: false,
        retentionAllowsPersist: false,
        answerBody: "ok",
      }),
    ).toMatchObject({ outcome: "discarded", code: "retention_denied" });
  });
});
