import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeManagedModelCommand } from "./managed-model-commands";

describe("managed-model commands", () => {
  it("lists models through the generated SDK", async () => {
    const requests: Array<{ query?: unknown; url: string }> = [];
    let output = "";
    const command = executeManagedModelCommand("agents", "list", {
      generatedClient: {
        get: async (options: { query?: unknown; url: string }) => {
          requests.push({ query: options.query, url: options.url });
          return {
            data: { data: [{ id: "agent_generated_1", name: "Romeo" }] },
          };
        },
      } as never,
      io: {
        stdout: {
          write: (value) => {
            output += value;
            return true;
          },
        },
        stderr: { write: () => true },
      },
      parsed: parseArgs(["agents", "list", "--workspace", "ws_1"]),
      readFile: async () => new Uint8Array(),
    });

    await expect(command).resolves.toBe(0);
    expect(requests).toEqual([
      { query: { workspaceId: "ws_1" }, url: "/agents" },
    ]);
    expect(output).toContain("agent_generated_1");
  });
});
