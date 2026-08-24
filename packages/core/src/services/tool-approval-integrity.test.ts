import type { AuthSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import type {
  ToolCallRecord,
  ToolConnector,
  ToolOperation,
} from "../domain/entities";
import {
  dispatchApprovalRequestDigest,
  toolApprovalBindingJob,
  toolApprovalRequestDigest,
  validToolApprovalBinding,
} from "./tool-approval-integrity";
import {
  toolApprovalDecisionJob,
  toolOperationApprovalDecisionJob,
} from "./tool-service-helpers";

describe("tool approval integrity", () => {
  it("canonicalizes object key order while binding every nested value", () => {
    const approval = toolCallApproval();
    const left = toolApprovalRequestDigest(approval, {
      nested: { alpha: 1, beta: [true, "value"] },
      mode: "safe",
    });
    const reordered = toolApprovalRequestDigest(approval, {
      mode: "safe",
      nested: { beta: [true, "value"], alpha: 1 },
    });
    const changed = toolApprovalRequestDigest(approval, {
      mode: "safe",
      nested: { beta: [true, "changed"], alpha: 1 },
    });

    expect(left).toBe(reordered);
    expect(left).not.toBe(changed);
  });

  it("stores only a digest and validates the exact direct-tool binding", () => {
    const approval = toolCallApproval();
    const requestInput = { token: "RAW-APPROVAL-SECRET", mode: "safe" };
    const binding = toolApprovalBindingJob(approval, requestInput);

    expect(validToolApprovalBinding(approval, requestInput, [binding])).toBe(
      true,
    );
    expect(
      validToolApprovalBinding(
        approval,
        { token: "DIFFERENT-SECRET", mode: "safe" },
        [binding],
      ),
    ).toBe(false);
    expect(JSON.stringify(binding)).not.toContain("RAW-APPROVAL-SECRET");
  });

  it("binds dispatch values and run scope, not only parameter names", () => {
    const { connector, operation } = operationFixture();
    const subject = toolManageSubject();
    const baseline = dispatchApprovalRequestDigest({
      subject,
      connector,
      operation,
      parameters: { issueId: "ISSUE-1" },
      body: { title: "one" },
      runContext: {
        agentId: "agent_one",
        runId: "run_one",
        toolId: "tool_one",
        workspaceId: "workspace_default",
      },
    });
    const changedValue = dispatchApprovalRequestDigest({
      subject,
      connector,
      operation,
      parameters: { issueId: "ISSUE-2" },
      body: { title: "one" },
      runContext: {
        agentId: "agent_one",
        runId: "run_one",
        toolId: "tool_one",
        workspaceId: "workspace_default",
      },
    });
    const changedRun = dispatchApprovalRequestDigest({
      subject,
      connector,
      operation,
      parameters: { issueId: "ISSUE-1" },
      body: { title: "one" },
      runContext: {
        agentId: "agent_one",
        runId: "run_two",
        toolId: "tool_one",
        workspaceId: "workspace_default",
      },
    });

    expect(baseline).not.toBe(changedValue);
    expect(baseline).not.toBe(changedRun);
  });

  it("uses one durable decision identity across conflicting outcomes", () => {
    const subject = toolManageSubject();
    const approval = toolCallApproval();
    const approved = toolApprovalDecisionJob(
      subject,
      approval,
      "approved",
      "2025-01-01T00:01:00.000Z",
    );
    const rejected = toolApprovalDecisionJob(
      subject,
      approval,
      "rejected",
      "2025-01-01T00:01:00.001Z",
    );
    const { connector, operation } = operationFixture();
    const operationApproval = {
      id: "operation_approval",
      orgId: subject.orgId,
      type: "tool.operation.approval_request",
      status: "completed" as const,
      payload: {
        actorId: subject.id,
        connectorId: connector.id,
        operationId: operation.operationId,
      },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:00.000Z",
    };

    expect(approved.id).toBe(rejected.id);
    expect(
      toolOperationApprovalDecisionJob(
        subject,
        operationApproval,
        "approved",
        "2025-01-01T00:01:00.000Z",
      ).id,
    ).toBe(
      toolOperationApprovalDecisionJob(
        subject,
        operationApproval,
        "rejected",
        "2025-01-01T00:01:00.001Z",
      ).id,
    );
  });
});

function operationFixture(): {
  connector: ToolConnector;
  operation: ToolOperation;
} {
  const createdAt = "2025-01-01T00:00:00.000Z";
  const connector: ToolConnector = {
    id: "connector_one",
    orgId: "org_default",
    type: "openapi",
    name: "Issue tracker",
    description: "Approval digest fixture.",
    schema: { baseUrl: "https://api.example.com" },
    authConfig: { type: "none" },
    networkPolicy: {
      mode: "allow_hosts",
      allowedHosts: ["api.example.com"],
      allowPrivateNetwork: false,
    },
    riskLevel: "medium",
    approvalPolicy: "external_side_effects",
    visibility: "org",
    enabled: true,
    createdAt,
    updatedAt: createdAt,
  };
  return {
    connector,
    operation: {
      id: "operation_one",
      orgId: "org_default",
      connectorId: connector.id,
      operationId: "create-issue",
      method: "post",
      path: "/issues/{issueId}",
      name: "Create issue",
      description: "Creates an issue.",
      inputSchema: {},
      outputSchema: {},
      riskLevel: "medium",
      approvalPolicy: "external_side_effects",
      enabled: true,
      createdAt,
    },
  };
}

function toolManageSubject(): AuthSubject {
  return {
    id: "user_default",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: [],
    scopes: ["tools:manage", "tools:use"],
    isAdmin: false,
  };
}

function toolCallApproval(): ToolCallRecord {
  return {
    id: "tool_call_approval",
    orgId: "org_default",
    workspaceId: "workspace_default",
    agentId: "agent_default",
    actorId: "user_default",
    toolId: "tool_datetime",
    status: "approval_required",
    riskLevel: "low",
    approvalRequired: true,
    inputKeys: ["mode", "nested"],
    outputKeys: [],
    runId: "run_default",
    startedAt: "2025-01-01T00:00:00.000Z",
    completedAt: "2025-01-01T00:00:01.000Z",
  };
}
