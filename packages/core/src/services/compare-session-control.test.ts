import { describe, expect, it } from "vitest";

import {
  applyCompareGroupCancel,
  projectCompareBlinding,
  scoreEvalRubric,
} from "./compare-session-control";

describe("compare blinding, cancel, and rubrics", () => {
  it("hides model identity until reveal and never retries completed legs", () => {
    expect(
      projectCompareBlinding({
        identities: [
          { legId: "a", modelId: "model_secret", providerId: "prov_secret" },
        ],
        reveal: false,
      }),
    ).toEqual([{ legId: "a", blinded: true }]);
    expect(
      applyCompareGroupCancel({
        legs: [
          { legId: "a", state: "completed" },
          { legId: "b", state: "running" },
        ],
      }),
    ).toEqual([
      { legId: "a", state: "completed", retryable: false },
      { legId: "b", state: "cancelled", retryable: false },
    ]);
  });

  it("scores only declared rubric dimensions and keeps notes as a length", () => {
    expect(
      scoreEvalRubric({
        rubric: {
          version: "rubric.v1",
          dimensions: ["helpfulness", "safety"],
        },
        scores: { helpfulness: 0.8, cost: 0.1 },
        notes: "internal reviewer note",
      }),
    ).toEqual({
      version: "rubric.v1",
      scores: { helpfulness: 0.8 },
      noteLength: 22,
    });
  });
});
