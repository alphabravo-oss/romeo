import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeDataConnectorCommand } from "./data-connector-commands";

describe("data connector commands", () => {
  it("uses generated SDK operations for connector configuration and sync", async () => {
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
    const identity = ["--workspace", "workspace_1", "--kb", "kb_1"];
    const cases: Array<{ args: string[]; method: string; url: string }> = [
      { args: ["connectors", "list"], method: "get", url: "/data-connectors" },
      {
        args: ["connectors", "create-local", ...identity],
        method: "post",
        url: "/data-connectors",
      },
      {
        args: [
          "connectors",
          "create-website",
          ...identity,
          "--url",
          "https://example.com",
        ],
        method: "post",
        url: "/data-connectors",
      },
      {
        args: [
          "connectors",
          "create-rss",
          ...identity,
          "--url",
          "https://example.com/feed",
        ],
        method: "post",
        url: "/data-connectors",
      },
      {
        args: ["connectors", "create-s3", ...identity, "--bucket", "docs"],
        method: "post",
        url: "/data-connectors",
      },
      {
        args: [
          "connectors",
          "sync-local",
          "--connector",
          "connector_1",
          "--file",
          "note.txt",
        ],
        method: "post",
        url: "/data-connectors/{connectorId}/sync",
      },
      {
        args: ["connectors", "sync", "--connector", "connector_1"],
        method: "post",
        url: "/data-connectors/{connectorId}/sync",
      },
    ];

    for (const testCase of cases) {
      await expect(
        executeDataConnectorCommand("connectors", testCase.args[1], {
          generatedClient,
          io: {
            stdout: { write: () => true },
            stderr: { write: () => true },
          },
          parsed: parseArgs(testCase.args),
          readFile: async () => new TextEncoder().encode("hello"),
        }),
      ).resolves.toBe(0);
    }

    expect(requests).toEqual(cases.map(({ method, url }) => ({ method, url })));
  });
});
