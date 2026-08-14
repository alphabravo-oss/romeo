import { describe, expect, it } from "vitest";

import {
  evaluateProviderProbe,
  mergeProviderCapabilityRecords,
  omitUnsupportedProviderKnobs,
} from "./provider-capability-merge";

describe("provider capability merge and probe", () => {
  it("preserves admin overrides and fails closed on probe mismatch", () => {
    const override = {
      value: false,
      source: "override" as const,
      updatedAt: "2026-08-14T10:00:00.000Z",
      sourceVersion: "admin-1",
    };
    expect(
      mergeProviderCapabilityRecords({
        current: override,
        incoming: {
          value: true,
          source: "detected",
          updatedAt: "2026-08-14T11:00:00.000Z",
          sourceVersion: "sync-2",
        },
      }),
    ).toEqual(override);
    expect(evaluateProviderProbe({ advertised: true, probed: false })).toEqual({
      outcome: "mismatch",
      code: "provider_probe_mismatch",
    });
    expect(
      omitUnsupportedProviderKnobs({
        requested: { temperature: 0.2, seed: 7 },
        supported: new Set(["temperature"]),
      }),
    ).toEqual({ effective: { temperature: 0.2 }, omitted: ["seed"] });
  });
});
