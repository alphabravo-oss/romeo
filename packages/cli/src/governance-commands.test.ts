import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeGovernanceCommand } from "./governance-commands";

describe("governance commands", () => {
  it("uses generated SDK operations for governance and CSV exports", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const generatedClient = Object.fromEntries(
      ["get", "patch", "post"].map((method) => [
        method,
        async (options: { url: string }) => {
          requests.push({ method, url: options.url });
          return options.url.endsWith(".csv")
            ? { data: "generated,csv\n" }
            : { data: { data: [] } };
        },
      ]),
    ) as never;
    let output = "";
    const cases: Array<{ args: string[]; method: string; url: string }> = [
      { args: ["access-review"], method: "get", url: "/access-review" },
      {
        args: ["access-review", "export"],
        method: "get",
        url: "/access-review.csv",
      },
      {
        args: ["governance", "retention"],
        method: "get",
        url: "/governance/retention",
      },
      {
        args: ["governance", "retention", "--days", "30"],
        method: "patch",
        url: "/governance/retention",
      },
      {
        args: ["governance", "retention-enforce"],
        method: "post",
        url: "/governance/retention/enforce",
      },
      {
        args: ["governance", "data-delete-preview", "--chat", "chat_1"],
        method: "post",
        url: "/governance/data-deletions/preview",
      },
      {
        args: [
          "governance",
          "data-delete",
          "--chat",
          "chat_1",
          "--confirm",
          "chat_1",
        ],
        method: "post",
        url: "/governance/data-deletions/execute",
      },
      {
        args: ["governance", "compliance-report"],
        method: "get",
        url: "/governance/compliance-report",
      },
      {
        args: ["governance", "compliance-report-export"],
        method: "get",
        url: "/governance/compliance-report.csv",
      },
    ];

    for (const testCase of cases) {
      await expect(
        executeGovernanceCommand(testCase.args[0]!, testCase.args[1], {
          generatedClient,
          io: {
            stdout: {
              write: (value: string) => {
                output += value;
                return true;
              },
            },
            stderr: { write: () => true },
          },
          parsed: parseArgs(testCase.args),
        }),
      ).resolves.toBe(0);
    }

    expect(requests).toEqual(cases.map(({ method, url }) => ({ method, url })));
    expect(output).toContain("generated,csv");
  });
});
