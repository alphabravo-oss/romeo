import { describe, expect, it } from "vitest";

import adversarialCases from "../../../../test/fixtures/network-policy-adversarial-cases.json";
import { assertConnectorHostAllowed } from "./data-connector-network-policy";
import {
  isBlockedNetworkAddress,
  isPrivateNetworkHost,
} from "./network-host-policy";
import { normalizeBrowserTaskStep } from "./workflow-browser-tasks";

describe("canonical network host policy", () => {
  it.each(adversarialCases.addressCases)(
    "classifies $label",
    ({ address, blocked }) => {
      expect(isBlockedNetworkAddress(address)).toBe(blocked);
      expect(isPrivateNetworkHost(address)).toBe(blocked);
    },
  );

  it.each(adversarialCases.dnsCases)(
    "evaluates every address in $label",
    async ({ addresses, blocked }) => {
      const evaluation = assertConnectorHostAllowed(
        new URL("https://api.example.com/resource"),
        {
          hostLookup: async () =>
            addresses.map((address) => ({
              address,
              family: address.includes(":") ? 6 : 4,
            })),
        },
      );
      if (blocked) await expect(evaluation).rejects.toThrow(/private/iu);
      else await expect(evaluation).resolves.toHaveLength(addresses.length);
    },
  );

  it("rejects special-use literals in browser task targets", () => {
    const blocked = adversarialCases.addressCases.filter(
      (testCase) => testCase.blocked,
    );
    for (const testCase of blocked) {
      const host = testCase.address.includes(":")
        ? `[${testCase.address}]`
        : testCase.address;
      expect(() =>
        normalizeBrowserTaskStep({
          name: testCase.label,
          type: "browser_task",
          targetUrl: `https://${host}/resource`,
          task: "Read the resource",
        }),
      ).toThrow(/private/iu);
    }
  });
});
