import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeDeviceCommand } from "./device-commands";
import { executeVoiceCommand } from "./voice-commands";

describe("device and voice commands", () => {
  it("uses generated SDK operations without touching legacy resources", async () => {
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
    const io = {
      stdout: { write: () => true },
      stderr: { write: () => true },
    };
    const deviceCases = [
      ["devices", "list"],
      ["devices", "create", "--name", "Laptop", "--scopes", "me:read"],
      ["devices", "refresh", "--refresh-token", "refresh_1"],
      ["devices", "revoke", "--device", "device_1"],
    ];

    for (const args of deviceCases) {
      await expect(
        executeDeviceCommand(args[0]!, args[1], {
          generatedClient,
          io,
          parsed: parseArgs(args),
        }),
      ).resolves.toBe(0);
    }
    for (const args of [
      ["voices", "list"],
      ["voices", "sync"],
    ]) {
      await expect(
        executeVoiceCommand(args[0]!, args[1], {
          generatedClient,
          io,
          parsed: parseArgs(args),
        }),
      ).resolves.toBe(0);
    }

    expect(requests).toEqual([
      { method: "get", url: "/device-authorizations" },
      { method: "post", url: "/device-authorizations" },
      { method: "post", url: "/device-authorizations/refresh" },
      {
        method: "post",
        url: "/device-authorizations/{deviceAuthorizationId}/revoke",
      },
      { method: "get", url: "/voices" },
      { method: "post", url: "/voices/sync" },
    ]);
  });
});
