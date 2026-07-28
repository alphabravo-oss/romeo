import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeNotificationCommand } from "./notification-commands";

describe("notification commands", () => {
  it("uses the generated SDK client when production configuration provides it", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    let output = "";
    const result = executeNotificationCommand("notifications", "list", {
      generatedClient: {
        get: async (options: { url: string }) => {
          requests.push({ method: "GET", url: options.url });
          return {
            data: {
              data: [
                {
                  id: "notification_generated_1",
                  type: "chat_mention",
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
      parsed: parseArgs(["notifications", "list"]),
    });

    expect(result).toBeDefined();
    await expect(result).resolves.toBe(0);
    expect(requests).toEqual([{ method: "GET", url: "/notifications" }]);
    expect(output).toContain("notification_generated_1");
  });
});
