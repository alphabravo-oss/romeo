import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeWebhookCommand } from "./webhook-commands";

describe("webhook commands", () => {
  it("uses the generated SDK client when production configuration provides it", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    let output = "";
    const result = executeWebhookCommand("webhooks", "list", {
      generatedClient: {
        get: async (options: { url: string }) => {
          requests.push({ method: "GET", url: options.url });
          return {
            data: {
              data: [
                {
                  id: "webhook_generated_1",
                  urlHost: "hooks.example.com",
                },
              ],
            },
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
      parsed: parseArgs(["webhooks", "list"]),
    });

    expect(result).toBeDefined();
    await expect(result).resolves.toBe(0);
    expect(requests).toEqual([{ method: "GET", url: "/webhooks" }]);
    expect(output).toContain("webhook_generated_1");
  });
});
