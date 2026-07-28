import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeWorkflowCommand } from "./workflow-commands";

describe("workflow commands", () => {
  it("uses generated SDK operations for workflow authoring and runs", async () => {
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
    const cases: Array<{ args: string[]; method: string; url: string }> = [
      { args: ["workflows", "list"], method: "get", url: "/workflows" },
      {
        args: ["workflows", "templates"],
        method: "get",
        url: "/workflow-templates",
      },
      {
        args: [
          "workflows",
          "create-template",
          "--template",
          "template_1",
          "--workspace",
          "workspace_1",
        ],
        method: "post",
        url: "/workflow-templates/{templateId}/create",
      },
      {
        args: [
          "workflows",
          "create",
          "--workspace",
          "workspace_1",
          "--name",
          "Review",
          "--agent",
          "agent_1",
        ],
        method: "post",
        url: "/workflows",
      },
      {
        args: ["workflows", "run-due-schedules"],
        method: "post",
        url: "/workflows/schedules/run-due",
      },
      {
        args: ["workflows", "run", "--workflow", "workflow_1"],
        method: "post",
        url: "/workflows/{workflowId}/runs",
      },
      {
        args: ["workflows", "approve", "--run", "run_1"],
        method: "post",
        url: "/workflow-runs/{workflowRunId}/approve",
      },
      {
        args: ["workflows", "resume", "--run", "run_1"],
        method: "post",
        url: "/workflow-runs/{workflowRunId}/resume",
      },
    ];

    for (const testCase of cases) {
      await expect(
        executeWorkflowCommand("workflows", testCase.args[1], {
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
