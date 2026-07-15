import { describe, expect, it } from "vitest";

import {
  toWorkflowDefinitionRecord,
  toWorkflowRunRecord,
} from "./workflow-repository";

describe("workflow repository mappers", () => {
  it("maps workflow definitions with schedules and normalized steps", () => {
    const workflow = toWorkflowDefinitionRecord({
      id: "workflow_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      name: "Review workflow",
      description: null,
      steps: [
        {
          id: "step_1",
          type: "approval",
          name: "Human review",
          approvalPrompt: "Approve?",
          inputKeys: ["ticketId", 42],
        },
        { id: "step_2", type: "unknown", name: "Ignored" },
      ],
      schedule: {
        enabled: true,
        intervalMinutes: 60,
        nextRunAt: "2026-06-27T01:00:00.000Z",
      },
      nextScheduledRunAt: new Date("2026-06-27T01:00:00.000Z"),
      enabled: true,
      createdBy: "user_1",
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:05:00.000Z"),
    });

    expect(workflow).toMatchObject({
      id: "workflow_1",
      steps: [
        {
          id: "step_1",
          type: "approval",
          inputKeys: ["ticketId"],
        },
      ],
      schedule: {
        enabled: true,
        intervalMinutes: 60,
        nextRunAt: "2026-06-27T01:00:00.000Z",
      },
    });
    expect(workflow.description).toBeUndefined();
  });

  it("maps workflow runs and fails closed on unknown run or step status", () => {
    const run = toWorkflowRunRecord({
      id: "workflow_run_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      workflowId: "workflow_1",
      status: "paused",
      input: [],
      steps: [
        {
          stepId: "step_1",
          type: "approval",
          status: "paused",
          output: [],
          completedAt: "2026-06-27T00:02:00.000Z",
        },
      ],
      currentStepId: "step_1",
      createdBy: "user_1",
      approvedBy: null,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:01:00.000Z"),
      completedAt: null,
    });

    expect(run).toMatchObject({
      id: "workflow_run_1",
      status: "failed",
      input: {},
      steps: [
        {
          stepId: "step_1",
          type: "approval",
          status: "failed",
          output: {},
          completedAt: "2026-06-27T00:02:00.000Z",
        },
      ],
      currentStepId: "step_1",
    });
    expect(run.approvedBy).toBeUndefined();
    expect(run.completedAt).toBeUndefined();
  });
});
