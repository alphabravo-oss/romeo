import { describe, expect, it } from "vitest";

import {
  toRunEventRecord,
  toRunRecord,
  toToolCallRecord,
} from "./run-repository";

describe("run repository mappers", () => {
  it("maps run rows with optional completion state", () => {
    const run = toRunRecord({
      id: "run_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      chatId: "chat_1",
      agentId: "agent_1",
      agentVersionId: "agent_version_1",
      modelId: "model_1",
      providerId: "provider_1",
      status: "completed",
      createdBy: "user_1",
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      completedAt: new Date("2026-06-27T00:01:00.000Z"),
    });

    expect(run).toEqual({
      id: "run_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      chatId: "chat_1",
      agentId: "agent_1",
      agentVersionId: "agent_version_1",
      modelId: "model_1",
      providerId: "provider_1",
      status: "completed",
      createdBy: "user_1",
      createdAt: "2026-06-27T00:00:00.000Z",
      completedAt: "2026-06-27T00:01:00.000Z",
    });
  });

  it("normalizes unknown run event types to a terminal failure event", () => {
    const event = toRunEventRecord({
      id: "evt_1",
      runId: "run_1",
      sequence: 3,
      type: "unexpected.event",
      data: { errorCode: "unknown_event" },
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(event).toEqual({
      id: "evt_1",
      runId: "run_1",
      sequence: 3,
      type: "run.failed",
      data: { errorCode: "unknown_event" },
      createdAt: "2026-06-27T00:00:00.000Z",
    });
  });

  it("maps tool calls without raw tool payloads", () => {
    const call = toToolCallRecord({
      id: "tool_call_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      agentId: "agent_1",
      actorId: "user_1",
      toolId: "tool_1",
      status: "approval_required",
      riskLevel: "high",
      approvalRequired: true,
      inputKeys: ["ticketId", 42] as never,
      outputKeys: ["status"],
      errorCode: "tool_approval_required",
      runId: "run_1",
      startedAt: new Date("2026-06-27T00:00:00.000Z"),
      completedAt: new Date("2026-06-27T00:00:01.000Z"),
    });

    expect(call).toEqual({
      id: "tool_call_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      agentId: "agent_1",
      actorId: "user_1",
      toolId: "tool_1",
      status: "approval_required",
      riskLevel: "high",
      approvalRequired: true,
      inputKeys: ["ticketId"],
      outputKeys: ["status"],
      errorCode: "tool_approval_required",
      runId: "run_1",
      startedAt: "2026-06-27T00:00:00.000Z",
      completedAt: "2026-06-27T00:00:01.000Z",
    });
    expect(JSON.stringify(call)).not.toContain("secret");
  });
});
