import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeAuditCommand } from "./audit-commands";

describe("audit commands", () => {
  it("uses generated list and CSV export operations", async () => {
    const requests: string[] = [];
    let output = "";
    const generatedClient = {
      get: async (options: { url: string }) => {
        requests.push(options.url);
        return options.url.endsWith(".csv")
          ? { data: "generated,audit\n" }
          : { data: { data: [] } };
      },
    } as never;
    for (const args of [
      ["audit", "list", "--outcome", "success"],
      ["audit", "export", "--resource-type", "chat"],
    ]) {
      await expect(
        executeAuditCommand("audit", args[1], {
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
          parsed: parseArgs(args),
        }),
      ).resolves.toBe(0);
    }

    expect(requests).toEqual(["/audit-logs", "/audit-logs.csv"]);
    expect(output).toContain("generated,audit");
  });
});
