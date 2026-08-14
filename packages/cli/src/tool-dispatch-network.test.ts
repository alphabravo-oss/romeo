import { describe, expect, it } from "vitest";

import adversarialCases from "../../../test/fixtures/network-policy-adversarial-cases.json";
import { assertBrowserTargetAllowed } from "./browser-automation-worker";
import {
  isBlockedNetworkAddress,
  isPrivateNetworkHost,
} from "./network-host-policy";
import {
  assertResolvedHostAllowed,
  fetchApprovedHost,
  safeHost,
} from "./tool-dispatch-network";

describe("tool dispatch network policy", () => {
  it.each(adversarialCases.addressCases)(
    "classifies $label",
    ({ address, blocked }) => {
      expect(isBlockedNetworkAddress(address)).toBe(blocked);
      expect(isPrivateNetworkHost(address)).toBe(blocked);
      expect(safeHost(address, false)).toBe(!blocked);
    },
  );

  it.each(adversarialCases.dnsCases)(
    "evaluates every address in $label",
    async ({ addresses, blocked }) => {
      const evaluation = assertResolvedHostAllowed(
        {
          dnsLookup: async () =>
            addresses.map((address) => ({
              address,
              family: address.includes(":") ? 6 : 4,
            })),
        },
        "api.example.com",
      );
      if (blocked)
        await expect(evaluation).rejects.toThrow("worker_host_denied");
      else await expect(evaluation).resolves.toHaveLength(addresses.length);
    },
  );

  it.each(adversarialCases.dnsCases)(
    "applies $label to browser targets before runner dispatch",
    async ({ addresses, blocked }) => {
      const evaluation = assertBrowserTargetAllowed(
        {
          dnsLookup: async () =>
            addresses.map((address) => ({
              address,
              family: address.includes(":") ? 6 : 4,
            })),
        },
        {
          targetHost: "browser.example.com",
          targetOrigin: "https://browser.example.com",
          targetUrl: "https://browser.example.com/resource",
          task: "Read the resource",
          taskHash: "task_hash",
          taskLength: 17,
        },
      );
      if (blocked) {
        await expect(evaluation).rejects.toThrow("browser_target_host_denied");
      } else {
        await expect(evaluation).resolves.toHaveLength(addresses.length);
      }
    },
  );

  it("pins the one approved DNS result instead of resolving again at fetch", async () => {
    let lookups = 0;
    const approvedAddresses = await assertResolvedHostAllowed(
      {
        dnsLookup: async () => {
          lookups += 1;
          const addresses =
            lookups === 1
              ? adversarialCases.rebinding.approved
              : adversarialCases.rebinding.laterResolution;
          return addresses.map((address) => ({ address, family: 4 }));
        },
      },
      "rebind.example.com",
    );
    const pinnedCalls: unknown[] = [];
    const response = await fetchApprovedHost(
      {
        fetchImpl: async () => {
          throw new Error("ordinary fetch must not be used");
        },
        pinnedFetchImpl: async (url, init, addresses) => {
          pinnedCalls.push({
            addresses,
            method: init.method,
            url: url.toString(),
          });
          return new Response("ok");
        },
      },
      new URL("https://rebind.example.com/resource"),
      { method: "GET", redirect: "error" },
      approvedAddresses,
    );

    expect(await response.text()).toBe("ok");
    expect(lookups).toBe(1);
    expect(pinnedCalls).toEqual([
      {
        addresses: [{ address: "93.184.216.34", family: 4 }],
        method: "GET",
        url: "https://rebind.example.com/resource",
      },
    ]);
  });

  it("fails closed when resolved addresses cannot be socket-pinned", async () => {
    await expect(
      fetchApprovedHost(
        { fetchImpl: async () => new Response("unsafe") },
        new URL("https://api.example.com/resource"),
        { method: "GET" },
        [{ address: "93.184.216.34", family: 4 }],
      ),
    ).rejects.toThrow("worker_dns_pinning_unavailable");
  });
});
