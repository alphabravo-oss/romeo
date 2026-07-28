import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeSessionCommand } from "./session-commands";

describe("session commands", () => {
  it("routes sessions and support impersonation through generated operations", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const generatedClient = Object.fromEntries(
      ["delete", "get", "post"].map((method) => [
        method,
        async (options: { url: string }) => {
          requests.push({ method, url: options.url });
          return { data: { data: [] } };
        },
      ]),
    ) as never;
    const supportFlags = [
      "--target-user",
      "user_1",
      "--confirm-target-user",
      "user_1",
      "--reason",
      "Support",
    ];
    const cases: Array<{ args: string[]; method: string; url: string }> = [
      { args: ["sessions", "list"], method: "get", url: "/sessions" },
      { args: ["sessions", "create"], method: "post", url: "/sessions" },
      {
        args: ["sessions", "impersonate", ...supportFlags],
        method: "post",
        url: "/admin/impersonation/sessions",
      },
      {
        args: ["sessions", "impersonation-report"],
        method: "get",
        url: "/admin/impersonation/sessions",
      },
      {
        args: ["sessions", "impersonation-requests"],
        method: "get",
        url: "/admin/impersonation/requests",
      },
      {
        args: ["sessions", "request-impersonation", ...supportFlags],
        method: "post",
        url: "/admin/impersonation/requests",
      },
      {
        args: ["sessions", "approve-impersonation", "--request", "request_1"],
        method: "post",
        url: "/admin/impersonation/requests/{requestId}/approve",
      },
      {
        args: ["sessions", "reject-impersonation", "--request", "request_1"],
        method: "post",
        url: "/admin/impersonation/requests/{requestId}/reject",
      },
      {
        args: ["sessions", "revoke-current"],
        method: "delete",
        url: "/sessions/current",
      },
    ];

    for (const testCase of cases) {
      await expect(
        executeSessionCommand("sessions", testCase.args[1], {
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
