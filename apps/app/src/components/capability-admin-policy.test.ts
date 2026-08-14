import type {
  CapabilityAdminOverview,
  CapabilityDefinition,
} from "@romeo/api-client/generated/query";
import { describe, expect, it } from "vitest";

import {
  capabilityConfigurationFor,
  capabilityCopyFor,
  capabilityExpiryInputValue,
  initialCapabilityPolicyValues,
  isCapabilityExpiryValid,
  isCapabilityPolicyValid,
  type CapabilityId,
  type CapabilityPolicyValues,
} from "./capability-admin-policy";

const values: CapabilityPolicyValues = {
  maxImagesPerRequest: 2,
  allowedSizes: ["1024x1024"],
  maxSearchResults: 7,
  maxUrlsPerRequest: 3,
  reasoningModeMaximum: "auto",
  reasoningEffortMaximum: "medium",
  maxReasoningTokens: 10_000,
  allowReasoningSummaryRetention: false,
};

describe("capability admin policy", () => {
  it("builds strict capability-specific configuration patches", () => {
    expect(
      capabilityConfigurationFor("image_generation", "enabled", values),
    ).toEqual({
      maxImagesPerRequest: 2,
      allowedSizes: ["1024x1024"],
    });
    expect(
      capabilityConfigurationFor("web_retrieval", "enabled", values),
    ).toEqual({ maxSearchResults: 7, maxUrlsPerRequest: 3 });
    expect(
      capabilityConfigurationFor("voice_processing", "enabled", values),
    ).toEqual({});
    expect(
      capabilityConfigurationFor("web_retrieval", "inherit", values),
    ).toEqual({});
  });

  it("validates each capability against its own bounded fields", () => {
    expect(isCapabilityPolicyValid("image_generation", "enabled", values)).toBe(
      true,
    );
    expect(
      isCapabilityPolicyValid("image_generation", "enabled", {
        ...values,
        allowedSizes: [],
      }),
    ).toBe(false);
    expect(
      isCapabilityPolicyValid("web_retrieval", "enabled", {
        ...values,
        maxSearchResults: 11,
      }),
    ).toBe(false);
    expect(
      isCapabilityPolicyValid("voice_processing", "disabled", {
        ...values,
        maxUrlsPerRequest: Number.NaN,
      }),
    ).toBe(true);
    expect(
      isCapabilityPolicyValid("image_generation", "inherit", {
        ...values,
        maxImagesPerRequest: Number.NaN,
      }),
    ).toBe(true);
  });

  it("uses fixed localized copy instead of server-provided translation keys", () => {
    expect(capabilityCopyFor("image_generation").name).toBe(
      "capabilityImageGenerationName",
    );
    expect(capabilityCopyFor("voice_processing").name).toBe(
      "capabilityVoiceProcessingName",
    );
    expect(capabilityCopyFor("web_retrieval").name).toBe(
      "capabilityWebRetrievalName",
    );
  });

  it("restores configured values and safely defaults missing fields", () => {
    const row = capabilityRow("web_retrieval", {
      maxSearchResults: 4,
      maxUrlsPerRequest: 2,
    });
    expect(initialCapabilityPolicyValues(row)).toMatchObject({
      maxSearchResults: 4,
      maxUrlsPerRequest: 2,
      maxImagesPerRequest: 1,
    });
  });

  it("formats stored expiry values and rejects invalid or elapsed choices", () => {
    expect(capabilityExpiryInputValue(undefined)).toBe("");
    expect(capabilityExpiryInputValue("invalid")).toBe("");
    expect(isCapabilityExpiryValid("", 1_000)).toBe(true);
    expect(
      isCapabilityExpiryValid("1970-01-01T00:00", Date.UTC(1971, 0, 1)),
    ).toBe(false);
    expect(isCapabilityExpiryValid("2099-01-01T00:00", 1_000)).toBe(true);
  });
});

function capabilityRow(
  id: CapabilityId,
  configuration: Record<string, unknown>,
): CapabilityAdminOverview["capabilities"][number] {
  const definition = {
    id,
    schemaVersion: 1,
    lifecycle: "ga",
    category: id === "web_retrieval" ? "retrieval" : "media",
    risk: "medium",
    controllingLayers: ["organization", "action"],
    allowedStates: ["inherit", "enabled", "disabled"],
    defaultState: "enabled",
    defaultConfiguration: {},
    merge: { boolean: "deny_dominates", maxima: [], allowlists: [] },
    requiredScopes: [],
    dependencies: [],
    copy: {
      nameKey: "untrusted.server.key",
      descriptionKey: "untrusted.server.key",
      riskKey: "untrusted.server.key",
      remediationKey: "untrusted.server.key",
    },
    registryVersion: "test",
  } satisfies CapabilityDefinition;
  return {
    definition,
    configuredAssignment: {
      id: "assignment",
      orgId: "org",
      scopeType: "organization",
      scopeId: "org",
      capabilityId: id,
      state: "enabled",
      configuration,
      version: 1,
      actorId: "user",
      reason: "test",
      effectiveAt: "2026-08-14T00:00:00.000Z",
      createdAt: "2026-08-14T00:00:00.000Z",
    },
    effective: {
      capabilityId: id,
      status: "enabled",
      dimensions: {
        installed: "yes",
        entitled: "not_required",
        available: "yes",
        allowed: "yes",
        capable: "unknown",
        selected: "defaulted",
      },
      effective: {},
      requestedChanges: [],
      reasons: [],
      assignmentVersions: [],
      registryVersion: "test",
      resolvedAt: "2026-08-14T00:00:00.000Z",
    },
    canOverride: true,
  } as CapabilityAdminOverview["capabilities"][number];
}
