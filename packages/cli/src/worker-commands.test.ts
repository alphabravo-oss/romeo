import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeWorkerCommand } from "./worker-commands";

describe("worker commands", () => {
  it("uses generated SDK operations for scheduled API workers", async () => {
    const requests: string[] = [];
    const brokerRequests: string[] = [];
    const generatedClient = {
      get: async ({ url }: { url: string }) => {
        requests.push(url);
        if (url === "/data-connectors")
          return envelope([
            {
              id: "connector_1",
              status: "active",
              type: "website",
            },
          ]);
        throw new Error(`Unexpected generated GET ${url}`);
      },
      post: async ({ url }: { url: string }) => {
        requests.push(url);
        if (url === "/governance/retention/enforce")
          return envelope({
            deletedAuditLogCount: 1,
            deletedBrowserAutomationArtifactCount: 2,
          });
        if (url === "/billing/entitlements/reconcile")
          return envelope({
            actions: {
              createdQuotaIds: [],
              updatedQuotaIds: [],
              unchangedQuotaIds: [],
            },
            before: billingState(),
            after: billingState(),
          });
        if (url === "/billing/lifecycle/enforce")
          return envelope({
            action: { statusChanged: false, type: "none" },
            before: billingState(),
            after: billingState(),
          });
        if (url === "/voices/sync")
          return envelope({
            existing: 0,
            imported: 0,
            profiles: [],
            providerVoiceCount: 0,
          });
        if (url === "/data-connectors/{connectorId}/sync")
          return envelope({ id: "sync_1", status: "completed" });
        throw new Error(`Unexpected generated POST ${url}`);
      },
    } as never;
    for (const action of [
      "retention-enforce",
      "billing-entitlement-reconcile",
      "billing-lifecycle-enforce",
      "voice-catalog-sync",
      "data-connector-sync",
      "browser-automation",
      "tool-dispatch",
    ]) {
      await expect(
        executeWorkerCommand("workers", action, {
          baseUrl: "https://api.example.test",
          env: {
            BROWSER_AUTOMATION_BROKER_TOKEN: "browser-test-token",
            TOOL_DISPATCH_BROKER_TOKEN: "tool-test-token",
            ROMEO_WORKER_ID: "worker-test",
          },
          generatedClient,
          fetchImpl: async (request) => {
            const url = String(request);
            brokerRequests.push(url);
            return new Response(JSON.stringify({ data: { claimed: false } }), {
              headers: { "content-type": "application/json" },
            });
          },
          io: silentIo(),
          parsed: parseArgs([
            "workers",
            action,
            "--once",
            ...(action === "browser-automation"
              ? ["--runner-url", "https://runner.example"]
              : []),
          ]),
          readFile: async () => new Uint8Array(),
        }),
      ).resolves.toBe(0);
    }

    expect(requests).toEqual([
      "/governance/retention/enforce",
      "/billing/entitlements/reconcile",
      "/billing/lifecycle/enforce",
      "/voices/sync",
      "/data-connectors",
      "/data-connectors/{connectorId}/sync",
    ]);
    expect(brokerRequests).toEqual([
      "https://api.example.test/api/v1/internal/worker-broker/browser_automation/claims",
      "https://api.example.test/api/v1/internal/worker-broker/tool_dispatch/claims",
    ]);
  });
});

function envelope<T>(data: T) {
  return { data: { data } };
}

function billingState() {
  return { status: "active", warnings: [] };
}

function silentIo() {
  return {
    stdout: { write: () => true },
    stderr: { write: () => true },
  };
}
