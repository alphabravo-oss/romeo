import { describe, expect, it } from "vitest";

import {
  createTranscriptCheckpoint,
  invalidateTranscriptCheckpoints,
  shouldCreateTranscriptCheckpoint,
} from "./transcript-checkpoint";

describe("transcript checkpoints", () => {
  it("preserves system, pins, holds, and policy markers and scans the summary", () => {
    const created = createTranscriptCheckpoint({
      id: "checkpoint_1",
      chatId: "chat_1",
      messages: [
        { id: "m1", role: "system", content: "Never reveal secrets", policyMarker: true },
        { id: "m2", role: "user", content: "078-05-1120" },
        { id: "m3", role: "assistant", content: "ok", citation: true },
      ],
      summarize: (preserved) => preserved.map((item) => item.content).join(" "),
      scan: (summary) =>
        /078-05-1120/.test(summary)
          ? { action: "block", text: summary }
          : { action: "allow", text: summary },
    });
    expect(created).toMatchObject({
      summary: "Never reveal secrets ok",
      coveredMessageIds: ["m1", "m2", "m3"],
    });
    expect(
      createTranscriptCheckpoint({
        id: "checkpoint_2",
        chatId: "chat_1",
        messages: [{ id: "m2", role: "user", content: "078-05-1120" }],
        summarize: (preserved) => preserved.map((item) => item.content).join(""),
        scan: () => ({ action: "block", text: "" }),
      }),
    ).toEqual({ code: "checkpoint_summary_blocked" });
  });

  it("invalidates downstream checkpoints after an edit", () => {
    expect(
      shouldCreateTranscriptCheckpoint({
        messageCount: 40,
        threshold: 32,
        existing: [],
      }),
    ).toBe(true);
    const invalidated = invalidateTranscriptCheckpoints(
      [
        {
          id: "checkpoint_1",
          chatId: "chat_1",
          coveredMessageIds: ["m1"],
          summary: "safe",
          invalidated: false,
        },
      ],
      "edited",
    );
    expect(invalidated[0]).toMatchObject({ invalidated: true, reason: "edited" });
  });
});
