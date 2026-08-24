import { describe, expect, it } from "vitest";

import { capabilityIds } from "./capability-definition-registry";
import { listCapabilityConsumerRegistrations } from "./capability-consumer-registry";
import { capabilityDeniesOperation } from "./capability-consumer-enforcement";

describe("capability consumer registry", () => {
  it("requires an owned enforcement point for every declared capability", () => {
    const registrations = listCapabilityConsumerRegistrations();

    expect(registrations.map((item) => item.capabilityId)).toEqual(
      capabilityIds,
    );
    expect(new Set(registrations.map((item) => item.capabilityId)).size).toBe(
      capabilityIds.length,
    );
    for (const registration of registrations) {
      expect(registration.owner.trim()).not.toBe("");
      expect(registration.consumers.length).toBeGreaterThan(0);
      for (const consumer of registration.consumers) {
        expect(consumer.id.trim()).not.toBe("");
        expect(consumer.enforcementPoint.trim()).not.toBe("");
      }
    }
  });

  it("returns defensive copies", () => {
    const first = listCapabilityConsumerRegistrations();
    first[0]!.consumers[0]!.id = "mutated";

    expect(listCapabilityConsumerRegistrations()[0]!.consumers[0]!.id).not.toBe(
      "mutated",
    );
  });

  it("fails every non-operational effective status closed", () => {
    expect(capabilityDeniesOperation({ status: "enabled" })).toBe(false);
    expect(capabilityDeniesOperation({ status: "required" })).toBe(false);
    expect(capabilityDeniesOperation({ status: "normalized" })).toBe(false);
    for (const status of [
      "disabled",
      "not_allowed",
      "not_configured",
      "not_entitled",
      "unsupported",
      "unhealthy",
    ] as const) {
      expect(capabilityDeniesOperation({ status })).toBe(true);
    }
  });
});
