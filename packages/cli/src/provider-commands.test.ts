import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeProviderCommand } from "./provider-commands";

describe("provider commands", () => {
  it("uses the generated SDK for provider summary, listing, and sync", async () => {
    const requests: Array<{ path?: unknown; url: string }> = [];
    let output = "";
    const commandContext = {
      generatedClient: {
        get: async (options: { path?: unknown; url: string }) => {
          requests.push({ path: options.path, url: options.url });
          return {
            data: {
              data:
                options.url === "/providers/operational-summary"
                  ? { status: "healthy" }
                  : [{ id: "model_generated_1", name: "Generated model" }],
            },
          };
        },
        post: async (options: { path?: unknown; url: string }) => {
          requests.push({ path: options.path, url: options.url });
          return {
            data: {
              data: [{ id: "model_generated_1", name: "Generated model" }],
            },
          };
        },
      } as never,
      io: {
        stdout: {
          write: (value: string) => {
            output += value;
            return true;
          },
        },
        stderr: { write: () => true },
      },
      parsed: parseArgs(["models", "sync", "--provider", "provider_ollama"]),
    };

    await expect(
      executeProviderCommand("providers", "summary", {
        ...commandContext,
        parsed: parseArgs(["providers", "summary"]),
      }),
    ).resolves.toBe(0);
    await expect(
      executeProviderCommand("models", "list", {
        ...commandContext,
        parsed: parseArgs(["models", "list"]),
      }),
    ).resolves.toBe(0);
    await expect(
      executeProviderCommand("models", "sync", commandContext),
    ).resolves.toBe(0);
    expect(requests).toEqual([
      { path: undefined, url: "/providers/operational-summary" },
      { path: undefined, url: "/models" },
      {
        path: { providerId: "provider_ollama" },
        url: "/providers/{providerId}/sync",
      },
    ]);
    expect(output).toContain("model_generated_1");
  });
});
