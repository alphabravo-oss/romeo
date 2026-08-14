import { describe, expect, it } from "vitest";

import {
  hitsAreSufficient,
  planAgenticQueries,
  planFollowUpQueries,
  shouldUseAgenticRag,
} from "./knowledge-agentic";

describe("shouldUseAgenticRag", () => {
  it("stays off until the org enables it", () => {
    expect(
      shouldUseAgenticRag({ enabled: false, userMode: "required" }, true),
    ).toBe(false);
  });

  it("forces every turn when the org requires it", () => {
    expect(
      shouldUseAgenticRag({ enabled: true, userMode: "required" }, false),
    ).toBe(true);
  });

  it("honors the member toggle only when the org leaves it optional", () => {
    expect(shouldUseAgenticRag({ enabled: true, userMode: "optional" })).toBe(
      false,
    );
    expect(
      shouldUseAgenticRag({ enabled: true, userMode: "optional" }, true),
    ).toBe(true);
  });
});

describe("planAgenticQueries", () => {
  it("keeps the original question and splits comparative parts", () => {
    expect(
      planAgenticQueries(
        "Compare vacation policy versus parental leave policy",
      ),
    ).toEqual([
      "Compare vacation policy versus parental leave policy",
      "Compare vacation policy",
      "parental leave policy",
    ]);
  });

  it("extracts quoted phrases as extra searches", () => {
    expect(planAgenticQueries('What does "retention window" require?')).toEqual(
      ['What does "retention window" require?', "retention window"],
    );
  });
});

describe("planFollowUpQueries", () => {
  it("searches leftover question terms after a weak first pass", () => {
    expect(
      planFollowUpQueries("vacation policy parental leave", [
        {
          id: "hit_1",
          content: "Vacation days accrue monthly.",
          score: 0.4,
          citation: {
            chunkId: "c1",
            documentId: "d1",
            title: "Vacation",
          },
          metadata: {},
        },
      ]),
    ).toEqual(["policy parental leave", "Vacation policy parental leave"]);
  });
});

describe("hitsAreSufficient", () => {
  it("rejects an empty or single weak hit", () => {
    expect(hitsAreSufficient([], "anything")).toBe(false);
    expect(
      hitsAreSufficient(
        [
          {
            id: "hit_1",
            content: "weak",
            score: 0.2,
            citation: { chunkId: "c1", documentId: "d1", title: "A" },
            metadata: {},
          },
        ],
        "anything",
      ),
    ).toBe(false);
  });

  it("accepts a strong hit unless the question is multi-part", () => {
    const hit = {
      id: "hit_1",
      content: "Vacation policy body",
      score: 0.8,
      citation: { chunkId: "c1", documentId: "d1", title: "Vacation" },
      metadata: {},
    };
    expect(hitsAreSufficient([hit], "What is vacation policy?")).toBe(true);
    expect(
      hitsAreSufficient([hit], "vacation policy versus parental leave"),
    ).toBe(false);
  });
});
