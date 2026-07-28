import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeToolCommand } from "./tool-commands";

describe("tool administration commands", () => {
  it("uses generated SDK operations for connectors and dispatch requests", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const generatedClient = Object.fromEntries(
      ["patch", "post"].map((method) => [
        method,
        async (options: { url: string }) => {
          requests.push({ method, url: options.url });
          return { data: { data: [] } };
        },
      ]),
    ) as never;
    const operation = [
      "--connector",
      "connector_1",
      "--operation",
      "operation_1",
    ];
    const cases: Array<{ args: string[]; method: string; url: string }> = [
      {
        args: ["tools", "auth-check", "--connector", "connector_1"],
        method: "post",
        url: "/tool-connectors/{connectorId}/auth/check",
      },
      {
        args: ["tools", "connector-enable", "--connector", "connector_1"],
        method: "patch",
        url: "/tool-connectors/{connectorId}",
      },
      {
        args: ["tools", "connector-disable", "--connector", "connector_1"],
        method: "patch",
        url: "/tool-connectors/{connectorId}",
      },
      {
        args: ["tools", "operation-enable", ...operation],
        method: "patch",
        url: "/tool-connectors/{connectorId}/operations/{operationId}",
      },
      {
        args: ["tools", "operation-disable", ...operation],
        method: "patch",
        url: "/tool-connectors/{connectorId}/operations/{operationId}",
      },
      {
        args: ["tools", "operation-dispatch", ...operation],
        method: "post",
        url: "/tool-connectors/{connectorId}/operations/{operationId}/dispatch",
      },
      {
        args: ["tools", "operation-enqueue", ...operation],
        method: "post",
        url: "/tool-connectors/{connectorId}/operations/{operationId}/dispatch-requests",
      },
      {
        args: ["tools", "dispatch-request-claim"],
        method: "post",
        url: "/tool-operation-dispatch-requests/claim",
      },
      {
        args: ["tools", "dispatch-request-renew", "--job", "job_1"],
        method: "post",
        url: "/tool-operation-dispatch-requests/{jobId}/renew-lease",
      },
      {
        args: ["tools", "dispatch-requests-expire"],
        method: "post",
        url: "/tool-operation-dispatch-requests/expire",
      },
      {
        args: [
          "tools",
          "dispatch-request-complete",
          "--job",
          "job_1",
          "--status",
          "200",
        ],
        method: "post",
        url: "/tool-operation-dispatch-requests/{jobId}/complete",
      },
      {
        args: [
          "tools",
          "dispatch-request-fail",
          "--job",
          "job_1",
          "--error-code",
          "failed",
        ],
        method: "post",
        url: "/tool-operation-dispatch-requests/{jobId}/fail",
      },
      {
        args: ["tools", "dispatch-request-cancel", "--job", "job_1"],
        method: "post",
        url: "/tool-operation-dispatch-requests/{jobId}/cancel",
      },
    ];

    for (const testCase of cases) {
      await expect(
        executeToolCommand("tools", testCase.args[1], {
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
