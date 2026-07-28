import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeWorkerCommand } from "./worker-commands";

describe("worker commands", () => {
  it("uses generated SDK operations for scheduled API workers", async () => {
    const requests: string[] = [];
    const generatedClient = {
      get: async ({ url }: { url: string }) => {
        requests.push(url);
        if (url === "/workflows")
          return envelope([{ id: "workflow_1", enabled: true }]);
        if (url === "/workflows/{workflowId}/runs")
          return envelope([
            workflowRun("run_waiting", "waiting_run", "step_1"),
          ]);
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
        if (url === "/workflow-runs/{workflowRunId}/resume")
          return envelope(workflowRun("run_waiting", "completed"));
        if (url === "/data-connectors/{connectorId}/sync")
          return envelope({ id: "sync_1", status: "completed" });
        if (url === "/browser-automation-tasks/claim")
          return envelope({
            claimed: false,
            workerQueue: "browser_automation",
          });
        if (url === "/tool-operation-dispatch-requests/claim")
          return envelope({
            claimed: false,
            workerQueue: "tool_operation_dispatch",
          });
        throw new Error(`Unexpected generated POST ${url}`);
      },
    } as never;
    for (const action of [
      "retention-enforce",
      "billing-entitlement-reconcile",
      "billing-lifecycle-enforce",
      "voice-catalog-sync",
      "workflow-resume",
      "data-connector-sync",
      "browser-automation",
      "tool-dispatch",
    ]) {
      await expect(
        executeWorkerCommand("workers", action, {
          generatedClient,
          fetchImpl: fetch,
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
      "/workflows",
      "/workflows/{workflowId}/runs",
      "/workflow-runs/{workflowRunId}/resume",
      "/data-connectors",
      "/data-connectors/{connectorId}/sync",
      "/browser-automation-tasks/claim",
      "/tool-operation-dispatch-requests/claim",
    ]);
  });
});

function envelope<T>(data: T) {
  return { data: { data } };
}

function billingState() {
  return { status: "active", warnings: [] };
}

function workflowRun(id: string, status: string, currentStepId?: string) {
  return {
    id,
    workflowId: "workflow_1",
    status,
    currentStepId,
    steps: [
      {
        stepId: "step_1",
        type: "agent_run",
        status,
        output: {},
      },
    ],
  };
}

function silentIo() {
  return {
    stdout: { write: () => true },
    stderr: { write: () => true },
  };
}
