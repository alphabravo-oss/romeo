import { describe, expect, it } from "vitest";

import { parseRagPolicyPatch } from "./rag-change-request";

describe("parseRagPolicyPatch", () => {
  it("accepts a non-empty JSON object", () => {
    expect(
      parseRagPolicyPatch(
        '{"enabledTiers":["workspace"],"dataResidencyTags":["eu"]}',
      ),
    ).toEqual({
      ok: true,
      policy: {
        enabledTiers: ["workspace"],
        dataResidencyTags: ["eu"],
      },
    });
  });

  it("rejects malformed JSON", () => {
    expect(parseRagPolicyPatch('{"enabledTiers":')).toEqual({
      error: "invalid_json",
      ok: false,
    });
  });

  it.each(["null", "[]", '"workspace"', "42"])(
    "rejects non-object JSON: %s",
    (value) => {
      expect(parseRagPolicyPatch(value)).toEqual({
        error: "object_required",
        ok: false,
      });
    },
  );

  it("rejects an empty policy patch", () => {
    expect(parseRagPolicyPatch("{}")).toEqual({
      error: "empty_patch",
      ok: false,
    });
  });
});
