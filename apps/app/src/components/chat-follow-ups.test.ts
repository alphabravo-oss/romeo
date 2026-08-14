import { describe, expect, it } from "vitest";

import { suggestFollowUps } from "./chat-follow-ups";

const labels = {
  explainSimpler: "Simpler",
  giveExample: "Example",
  makeShorter: "Shorter",
  goDeeper: "Deeper",
  explainCode: "Explain code",
  addTests: "Add tests",
  tradeoffs: "Tradeoffs",
};

describe("suggestFollowUps", () => {
  it("returns empty for blank answers", () => {
    expect(suggestFollowUps({ assistantContent: "   ", labels })).toEqual([]);
  });

  it("prefers code follow-ups when the answer has a fence", () => {
    const picks = suggestFollowUps({
      assistantContent: "Here you go:\n```ts\nconst x = 1\n```\nDone.",
      labels,
    });
    expect(picks.map((pick) => pick.label)).toEqual(
      expect.arrayContaining(["Explain code", "Add tests"]),
    );
  });

  it("suggests shorter when the answer is long", () => {
    const picks = suggestFollowUps({
      assistantContent: "word ".repeat(300),
      labels,
    });
    expect(picks.some((pick) => pick.label === "Shorter")).toBe(true);
  });

  it("caps at four chips", () => {
    const picks = suggestFollowUps({
      assistantContent: "Hello world with a thought.",
      labels,
    });
    expect(picks.length).toBeLessThanOrEqual(4);
  });
});
