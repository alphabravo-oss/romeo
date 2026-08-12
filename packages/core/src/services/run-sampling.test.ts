import { describe, expect, it } from "vitest";

import { samplingFromParameters } from "./run-sampling";

// A managed model version stores `parameters` as an open record, and before this existed nothing
// read it — temperature was saved, versioned, diffed and audited while every request went out with
// the provider's own default.
describe("samplingFromParameters", () => {
  it("carries the three knobs a provider request can hold", () => {
    expect(
      samplingFromParameters({ temperature: 0.2, topP: 0.9, maxTokens: 512 }),
    ).toEqual({ temperature: 0.2, topP: 0.9, maxTokens: 512 });
  });

  it("keeps zero, which is a meaningful temperature", () => {
    expect(samplingFromParameters({ temperature: 0 })).toEqual({
      temperature: 0,
    });
  });

  it("drops keys no provider request accepts", () => {
    expect(
      samplingFromParameters({ temperature: 0.5, presencePenalty: 1 }),
    ).toEqual({ temperature: 0.5 });
  });

  it("drops values that are not finite numbers", () => {
    expect(
      samplingFromParameters({
        temperature: "0.7" as unknown as number,
        topP: Number.NaN,
        maxTokens: Number.POSITIVE_INFINITY,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when there is nothing to pin", () => {
    expect(samplingFromParameters(undefined)).toBeUndefined();
    expect(samplingFromParameters({})).toBeUndefined();
  });
});
