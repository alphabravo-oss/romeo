import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeBillingCommand } from "./billing-commands";

describe("billing commands", () => {
  it("uses generated SDK operations for billing administration", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const generatedClient = Object.fromEntries(
      ["get", "post"].map((method) => [
        method,
        async (options: { url: string }) => {
          requests.push({ method, url: options.url });
          return { data: { data: [] } };
        },
      ]),
    ) as never;
    const cases: Array<{ args: string[]; method: string; url: string }> = [
      { args: ["billing", "plan"], method: "get", url: "/billing/plan" },
      {
        args: ["billing", "entitlements"],
        method: "get",
        url: "/billing/entitlements",
      },
      {
        args: ["billing", "reconcile-entitlements"],
        method: "post",
        url: "/billing/entitlements/reconcile",
      },
      {
        args: ["billing", "lifecycle"],
        method: "get",
        url: "/billing/lifecycle",
      },
      {
        args: ["billing", "enforce-lifecycle"],
        method: "post",
        url: "/billing/lifecycle/enforce",
      },
      {
        args: [
          "billing",
          "apply-plan",
          "--code",
          "pro",
          "--name",
          "Pro",
          "--quota",
          "run.started:100:monthly",
        ],
        method: "post",
        url: "/billing/plan",
      },
      {
        args: [
          "billing",
          "sync-external",
          "--provider",
          "stripe",
          "--event",
          "invoice.paid",
        ],
        method: "post",
        url: "/billing/external-events",
      },
    ];

    for (const testCase of cases) {
      await expect(
        executeBillingCommand("billing", testCase.args[1], {
          generatedClient,
          io: {
            stdout: { write: () => true },
            stderr: { write: () => true },
          },
          parsed: parseArgs(testCase.args),
        }),
      ).resolves.toBe(0);
    }

    expect(requests).toEqual(cases.map(({ method, url }) => ({ method, url })));
  });
});
