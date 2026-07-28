import { describe, expect, it } from "vitest";

import { isMessageActionEnabled, resolveTurnOutcome } from "./turn-rollback";

describe("resolveTurnOutcome", () => {
  const messages = [
    { id: "message_1", content: "Earlier turn" },
    { id: "message_2", content: "Earlier response" },
  ] as const;
  const snapshot = {
    draft: "Retry this exact request.  ",
    messages,
  };

  it("clears the draft and revokes previews after the server accepts the turn", () => {
    const outcome = resolveTurnOutcome({ snapshot, accepted: true });

    expect(outcome.draft).toBe("");
    expect(outcome.messages).toBe(messages);
    expect(outcome.revokePreviews).toBe(true);
  });

  it("restores the rejected turn verbatim without revoking its previews", () => {
    const outcome = resolveTurnOutcome({ snapshot, accepted: false });

    expect(outcome.draft).toBe("Retry this exact request.  ");
    expect(outcome.messages).toBe(messages);
    expect(outcome.revokePreviews).toBe(false);
  });
});

describe("isMessageActionEnabled", () => {
  it.each([
    {
      isStreaming: false,
      hasActiveChat: false,
      expected: false,
    },
    {
      isStreaming: false,
      hasActiveChat: true,
      expected: true,
    },
    {
      isStreaming: true,
      hasActiveChat: false,
      expected: false,
    },
    {
      isStreaming: true,
      hasActiveChat: true,
      expected: false,
    },
  ])(
    "returns $expected when streaming=$isStreaming and activeChat=$hasActiveChat",
    ({ expected, ...input }) => {
      expect(isMessageActionEnabled(input)).toBe(expected);
    },
  );
});
