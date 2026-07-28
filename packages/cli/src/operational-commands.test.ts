import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeOperationalCommand } from "./operational-commands";

describe("operational commands", () => {
  it("uses generated SDK operations for platform and workspace posture", async () => {
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
      { args: ["health"], method: "get", url: "/health" },
      {
        args: ["workspaces", "archive", "--workspace", "workspace_1"],
        method: "post",
        url: "/workspaces/{workspaceId}/archive",
      },
      {
        args: ["workspaces", "export", "--workspace", "workspace_1"],
        method: "get",
        url: "/workspaces/{workspaceId}/export",
      },
      { args: ["readiness"], method: "get", url: "/admin/readiness" },
      { args: ["jobs", "list"], method: "get", url: "/jobs" },
      {
        args: ["jobs", "summary"],
        method: "get",
        url: "/jobs/operational-summary",
      },
    ];

    for (const testCase of cases) {
      await expect(
        executeOperationalCommand(testCase.args[0]!, testCase.args[1], {
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
