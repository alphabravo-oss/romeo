import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import { listBuiltInTools, type ToolDefinition } from "@romeo/tools";
import { createHash } from "node:crypto";
import { ZodError } from "zod";

import type {
  Agent,
  AgentToolBinding,
  BackgroundJob,
  ToolCallRecord,
  ToolConnector,
  ToolOperation,
  ToolOperationDispatchRequestResult,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { consumeQuota } from "./consume-quota";
import type { QuotaCoordinator } from "./quota-coordination";
import { recordSubjectUsage } from "./record-usage";
import type { RunEventSequencer } from "./run-event-sequencer";
import { disabledSecretResolver, type SecretResolver } from "./secret-resolver";
import { recordToolCall } from "./tool-call-records";
import { enqueueToolOperationDispatch } from "./tool-operation-dispatch";
import {
  createOperationToolDefinition,
  type OperationToolInput,
  parseOperationToolInput,
} from "./tool-operation-tooling";
import {
  objectKeys,
  toolAuditMetadata,
  toAgentToolSummary,
  toToolSummary,
  withTimeout,
  type AgentToolSummary,
  type ToolSummary,
} from "./tool-execution";
import { appendToolRunEvent, getToolRun } from "./tool-run-events";
import { writeAuditLog } from "./audit-log";
import { emitWebhookEvent } from "./webhook-events";
import type { WebhookEmitter } from "./webhook-service";
import type { ToolDispatchPayloadStore } from "./tool-dispatch-payload-store";

interface ToolServiceOptions {
  dispatchPayloadStore?: ToolDispatchPayloadStore;
  externalOperationExecutionEnabled?: boolean;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  quotaCoordinator?: QuotaCoordinator | undefined;
  secretResolver?: SecretResolver;
  timeoutMs?: number;
}

interface OperationToolContext {
  connector: ToolConnector;
  operation: ToolOperation;
  tool: ToolDefinition;
}

type ToolApprovalDecisionStatus = "approved" | "cancelled" | "rejected";

export interface ToolApprovalDecisionResult {
  approvedAt?: string;
  approvalRequestId: string;
  cancelledAt?: string;
  decidedAt: string;
  rejectedAt?: string;
  status: ToolApprovalDecisionStatus;
  toolId: string;
  agentId?: string;
  runId?: string;
  workspaceId?: string;
}

export interface ToolApprovalRequestSummary {
  id: string;
  orgId: string;
  approvalRequestId: string;
  approvalRequired: true;
  actorId: string;
  availableActions: Array<"approve" | "cancel" | "reject">;
  completedAt: string;
  errorCode?: string;
  expiresAt: string;
  inputKeys: string[];
  outputKeys: string[];
  requestedAt: string;
  riskLevel: string;
  source: "operation_dispatch" | "tool_call";
  startedAt: string;
  status: "approval_required";
  toolId: string;
  agentId?: string;
  context?: {
    bodyKeys: string[];
    connectorId: string;
    method: string;
    operationId: string;
    parameterKeys: string[];
    path: string;
    agentId?: string;
    runId?: string;
    workspaceId?: string;
  };
  runId?: string;
  tool: {
    id: string;
    approvalPolicy: string;
    description: string;
    kind: "built_in" | "imported_operation" | "unknown";
    name: string;
    riskLevel: string;
    connectorId?: string;
    method?: string;
    operationId?: string;
    path?: string;
  };
  workspaceId?: string;
}

export class ToolService {
  private readonly tools = new Map<string, ToolDefinition>(
    listBuiltInTools().map((tool) => [tool.id, tool]),
  );

  constructor(
    private readonly repository: RomeoRepository,
    private readonly runEventSequencer: RunEventSequencer,
    private readonly webhooks?: WebhookEmitter,
    private readonly options: ToolServiceOptions = {},
  ) {}

  list(subject: AuthSubject): ToolSummary[] {
    assertScope(subject, "tools:use");
    return [...this.tools.values()].map(toToolSummary);
  }

  async listForAgent(
    subject: AuthSubject,
    agentId: string,
  ): Promise<AgentToolSummary[]> {
    assertScope(subject, "tools:use");
    const agent = await this.getAgentForSubject(subject, agentId);
    const [bindings, grants] = await Promise.all([
      this.repository.listAgentToolBindings(agent.id),
      this.repository.listResourceGrants(subject.orgId),
    ]);

    const builtInSummaries = [...this.tools.values()].map((tool) =>
      toAgentToolSummary(
        tool,
        agent,
        bindings.find((binding) => binding.toolId === tool.id),
        hasGrant(subject, grants, "tool", tool.id, "use"),
      ),
    );
    const operationSummaries: AgentToolSummary[] = [];
    for (const operationTool of await this.listOperationTools(subject)) {
      operationSummaries.push(
        toAgentToolSummary(
          operationTool.tool,
          agent,
          bindings.find((binding) => binding.toolId === operationTool.tool.id),
          true,
        ),
      );
    }

    return [...builtInSummaries, ...operationSummaries];
  }

  async updateBinding(input: {
    subject: AuthSubject;
    agentId: string;
    toolId: string;
    enabled?: boolean;
    approvalRequired?: boolean;
  }): Promise<AgentToolSummary> {
    assertScope(input.subject, "agents:write");
    assertScope(input.subject, "tools:manage");
    const operationTool = await this.getOperationTool(
      input.subject,
      input.toolId,
    );
    const tool = operationTool?.tool ?? this.getTool(input.toolId);
    const agent = await this.getAgentForSubject(input.subject, input.agentId);
    if (operationTool === undefined)
      await this.assertToolAccess(input.subject, tool.id);
    const existing = await this.getBinding(agent.id, tool.id);
    const now = new Date().toISOString();
    const binding = await this.repository.transaction(async (repository) => {
      const saved = await repository.upsertAgentToolBinding({
        id: existing?.id ?? createId("agent_tool_binding"),
        orgId: agent.orgId,
        agentId: agent.id,
        toolId: tool.id,
        enabled: input.enabled ?? existing?.enabled ?? true,
        approvalRequired:
          input.approvalRequired ??
          existing?.approvalRequired ??
          tool.approvalPolicy === "always",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "agent.tool_binding.update",
        resourceType: "agent",
        resourceId: agent.id,
        metadata: {
          toolId: tool.id,
          enabled: saved.enabled,
          approvalRequired: saved.approvalRequired,
          created: existing === undefined,
          importedOperation: operationTool !== undefined,
        },
      });
      return saved;
    });
    return toAgentToolSummary(tool, agent, binding, true);
  }

  async listCalls(
    subject: AuthSubject,
    agentId?: string,
  ): Promise<ToolCallRecord[]> {
    assertScope(subject, "audit:read");
    if (agentId !== undefined) await this.getAgentForSubject(subject, agentId);
    const calls = await this.repository.listToolCalls(subject.orgId);
    return agentId === undefined
      ? calls
      : calls.filter((call) => call.agentId === agentId);
  }

  async listPendingApprovals(
    subject: AuthSubject,
    input: { agentId?: string; runId?: string } = {},
  ): Promise<ToolApprovalRequestSummary[]> {
    assertScope(subject, "tools:use");
    if (input.agentId !== undefined)
      await this.getAgentForSubject(subject, input.agentId);
    const [calls, jobs] = await Promise.all([
      this.repository.listToolCalls(subject.orgId),
      this.repository.listBackgroundJobs(subject.orgId),
    ]);
    const operationTools = await this.listOperationTools(subject);
    const toolCallApprovals = calls
      .filter((call) => call.status === "approval_required")
      .filter((call) => call.actorId === subject.id)
      .filter((call) => hasWorkspaceAccess(subject, call.workspaceId))
      .filter(
        (call) => input.agentId === undefined || call.agentId === input.agentId,
      )
      .filter((call) => input.runId === undefined || call.runId === input.runId)
      .filter((call) => !toolApprovalExpired(call))
      .filter((call) => !toolApprovalConsumed(call, calls))
      .filter((call) => toolApprovalDecision(call, jobs) === undefined)
      .map((call) => this.toToolApprovalRequestSummary(call, operationTools));
    const operationApprovals = jobs
      .filter((job) => job.type === "tool.operation.approval_request")
      .filter((job) => job.status === "completed")
      .filter((job) => job.payload.actorId === subject.id)
      .filter((job) => {
        const workspaceId = stringPayloadOptional(job.payload, "workspaceId");
        return (
          workspaceId === undefined || hasWorkspaceAccess(subject, workspaceId)
        );
      })
      .filter(
        (job) =>
          input.agentId === undefined || job.payload.agentId === input.agentId,
      )
      .filter(
        (job) => input.runId === undefined || job.payload.runId === input.runId,
      )
      .filter((job) => !operationApprovalExpired(job))
      .filter((job) => !operationApprovalConsumed(job))
      .filter((job) => operationApprovalDecision(job) === undefined)
      .map((job) =>
        this.toOperationApprovalRequestSummary(job, operationTools),
      );
    return [...toolCallApprovals, ...operationApprovals].sort(
      (left, right) =>
        right.requestedAt.localeCompare(left.requestedAt) ||
        left.id.localeCompare(right.id),
    );
  }

  async approveApproval(
    subject: AuthSubject,
    approvalRequestId: string,
  ): Promise<ToolApprovalDecisionResult> {
    return this.decideApproval(subject, approvalRequestId, "approved");
  }

  async cancelApproval(
    subject: AuthSubject,
    approvalRequestId: string,
  ): Promise<ToolApprovalDecisionResult> {
    return this.decideApproval(subject, approvalRequestId, "cancelled");
  }

  async rejectApproval(
    subject: AuthSubject,
    approvalRequestId: string,
  ): Promise<ToolApprovalDecisionResult> {
    return this.decideApproval(subject, approvalRequestId, "rejected");
  }

  private async decideApproval(
    subject: AuthSubject,
    approvalRequestId: string,
    decision: ToolApprovalDecisionStatus,
  ): Promise<ToolApprovalDecisionResult> {
    assertScope(subject, "tools:use");
    const [calls, jobs] = await Promise.all([
      this.repository.listToolCalls(subject.orgId),
      this.repository.listBackgroundJobs(subject.orgId),
    ]);
    const approvalRequest = calls.find((call) => call.id === approvalRequestId);
    if (approvalRequest === undefined) {
      const operationApprovalRequest = jobs.find(
        (job) =>
          job.id === approvalRequestId &&
          job.type === "tool.operation.approval_request",
      );
      if (operationApprovalRequest !== undefined)
        return this.decideOperationApproval(
          subject,
          operationApprovalRequest,
          decision,
        );
      throw new ApiError(
        "tool_approval_request_not_found",
        "Tool approval request was not found.",
        404,
        { approvalRequestId },
      );
    }
    if (!hasWorkspaceAccess(subject, approvalRequest.workspaceId)) {
      throw new AuthorizationError(
        "The tool approval request is outside the caller workspace access.",
      );
    }
    if (approvalRequest.actorId !== subject.id) {
      throw new AuthorizationError(
        "The tool approval request is owned by another principal.",
      );
    }
    if (approvalRequest.status !== "approval_required") {
      throw new ApiError(
        "tool_approval_request_not_pending",
        "Tool approval request is not pending.",
        409,
        { approvalRequestId },
      );
    }
    const existingDecision = toolApprovalDecision(approvalRequest, jobs);
    if (existingDecision !== undefined) {
      if (existingDecision.status === decision) return existingDecision;
      throw new ApiError(
        "tool_approval_request_already_decided",
        "Tool approval request already has a terminal decision.",
        409,
        { approvalRequestId, status: existingDecision.status },
      );
    }

    if (toolApprovalExpired(approvalRequest)) {
      throw new ApiError(
        "tool_approval_request_expired",
        "Tool approval request has expired.",
        409,
        { approvalRequestId },
      );
    }
    if (toolApprovalConsumed(approvalRequest, calls)) {
      throw new ApiError(
        "tool_approval_request_consumed",
        "Tool approval request was already consumed.",
        409,
        { approvalRequestId },
      );
    }

    const now = new Date().toISOString();
    const decisionJob = toolApprovalDecisionJob(
      subject,
      approvalRequest,
      decision,
      now,
    );
    try {
      await this.repository.transaction(async (repository) => {
        const currentJobs = await repository.listBackgroundJobs(subject.orgId);
        const currentDecision = toolApprovalDecision(
          approvalRequest,
          currentJobs,
        );
        if (currentDecision !== undefined) {
          if (currentDecision.status === decision) return;
          throw new ApiError(
            "tool_approval_request_already_decided",
            "Tool approval request already has a terminal decision.",
            409,
            { approvalRequestId, status: currentDecision.status },
          );
        }
        const existing = currentJobs.find((job) => job.id === decisionJob.id);
        if (existing !== undefined) return;

        await repository.createBackgroundJob(decisionJob);
        if (decision !== "approved" && approvalRequest.runId !== undefined) {
          const run = await repository.getRun(approvalRequest.runId);
          if (
            run !== undefined &&
            run.orgId === subject.orgId &&
            run.status === "waiting_tool_approval"
          ) {
            await repository.updateRun({
              ...run,
              status: "cancelled",
              completedAt: now,
            });
            const failedEvent = await this.runEventSequencer.create(
              repository,
              {
                runId: run.id,
                type: "tool.failed",
                data: {
                  agentId: approvalRequest.agentId,
                  toolId: approvalRequest.toolId,
                  riskLevel: approvalRequest.riskLevel,
                  approvalRequired: true,
                  inputKeys: approvalRequest.inputKeys,
                  outputKeys: [],
                  errorCode: toolApprovalDecisionErrorCode(decision),
                  approvalRequestId: approvalRequest.id,
                },
              },
            );
            const cancelledEvent = await this.runEventSequencer.create(
              repository,
              {
                runId: run.id,
                type: "run.cancelled",
                data: {
                  reason: toolApprovalDecisionErrorCode(decision),
                  agentId: approvalRequest.agentId,
                  toolId: approvalRequest.toolId,
                  approvalRequestId: approvalRequest.id,
                },
              },
            );
            await repository.appendRunEvents([failedEvent, cancelledEvent]);
          }
        }
        await writeAuditLog(repository, {
          subject,
          action: toolApprovalAuditAction(decision),
          resourceType: "tool",
          resourceId: approvalRequest.toolId,
          metadata: {
            agentId: approvalRequest.agentId,
            approvalRequestId: approvalRequest.id,
            decision,
            ...(decision === "approved"
              ? {}
              : { errorCode: toolApprovalDecisionErrorCode(decision) }),
            inputKeyCount: approvalRequest.inputKeys.length,
            ...(approvalRequest.runId === undefined
              ? {}
              : { runId: approvalRequest.runId }),
            workspaceId: approvalRequest.workspaceId,
          },
        });
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }

    return toolApprovalDecisionFromJob(decisionJob);
  }

  async execute(
    subject: AuthSubject,
    toolId: string,
    input: unknown,
    options: {
      agentId: string;
      approved?: boolean;
      approvalRequestId?: string;
      idempotencyKey?: string;
      runId?: string;
    },
  ): Promise<unknown> {
    assertScope(subject, "tools:use");
    const tool = this.tools.get(toolId);
    if (!tool) {
      const operationTool = await this.getOperationTool(subject, toolId);
      if (operationTool !== undefined) {
        return this.executeOperation(subject, operationTool, input, options);
      }
      await this.auditExecution(subject, toolId, "failure", {
        agentId: options.agentId,
        errorCode: "not_found",
      });
      throw notFound("Tool");
    }

    const agent = await this.getAgentForSubject(subject, options.agentId);
    const run = await getToolRun(
      this.repository,
      subject,
      agent,
      options.runId,
    );
    assertRunToolExecutionAllowed(run, {
      approved: options.approved,
      approvalRequestId: options.approvalRequestId,
    });
    await this.assertToolAccess(subject, tool.id);
    const binding = await this.getBinding(agent.id, tool.id);
    let metadata = toolAuditMetadata(tool, input, agent.id, binding);
    const startedAt = new Date().toISOString();

    if (!binding?.enabled) {
      await this.auditExecution(subject, tool.id, "failure", {
        ...metadata,
        errorCode: "tool_not_bound",
      });
      await recordToolCall(this.repository, {
        subject,
        agent,
        tool,
        binding,
        status: "blocked",
        startedAt,
        requestInput: input,
        errorCode: "tool_not_bound",
        runId: run?.id,
      });
      await appendToolRunEvent(this.repository, this.runEventSequencer, run, {
        type: "tool.failed",
        agent,
        tool,
        requestInput: input,
        errorCode: "tool_not_bound",
        approvalRequired: false,
      });
      throw new ApiError(
        "tool_not_bound",
        "Tool is not enabled for this agent.",
        403,
        { agentId: agent.id, toolId: tool.id },
      );
    }

    if (binding.approvalRequired && options.approved !== true) {
      const toolCall = await recordToolCall(this.repository, {
        subject,
        agent,
        tool,
        binding,
        status: "approval_required",
        startedAt,
        requestInput: input,
        errorCode: "tool_approval_required",
        runId: run?.id,
      });
      await this.auditExecution(subject, tool.id, "failure", {
        ...metadata,
        errorCode: "tool_approval_required",
        approvalRequestId: toolCall.id,
      });
      await appendToolRunEvent(this.repository, this.runEventSequencer, run, {
        type: "tool.approval_required",
        agent,
        tool,
        requestInput: input,
        errorCode: "tool_approval_required",
        approvalRequestId: toolCall.id,
        approvalRequired: true,
      });
      throw new ApiError(
        "tool_approval_required",
        "Tool approval is required before execution.",
        409,
        { agentId: agent.id, toolId: tool.id, approvalRequestId: toolCall.id },
      );
    }

    if (binding.approvalRequired) {
      try {
        await this.assertApprovalRequest(
          subject,
          agent,
          tool.id,
          options.approvalRequestId,
          run?.id,
        );
      } catch (error) {
        const errorCode =
          error instanceof ApiError
            ? error.code
            : "invalid_tool_approval_request";
        await this.auditExecution(subject, tool.id, "failure", {
          ...metadata,
          errorCode,
        });
        await recordToolCall(this.repository, {
          subject,
          agent,
          tool,
          binding,
          status: "blocked",
          startedAt,
          requestInput: input,
          errorCode,
          runId: run?.id,
        });
        await appendToolRunEvent(this.repository, this.runEventSequencer, run, {
          type: "tool.failed",
          agent,
          tool,
          requestInput: input,
          errorCode,
          approvalRequired: true,
        });
        throw error;
      }
    }

    if (options.idempotencyKey !== undefined) {
      await this.consumeExecutionIdempotency({
        subject,
        agent,
        tool,
        runId: run?.id,
        idempotencyKey: options.idempotencyKey,
        requestInput: input,
      });
    }

    await assertAbuseControlsAllow(this.repository, subject, {
      action: "tool.execute",
      agentId: agent.id,
      toolId: tool.id,
      workspaceId: agent.workspaceId,
    });
    await consumeQuota(
      this.repository,
      subject,
      {
        agentId: agent.id,
        metric: "tool.call",
        quantity: 1,
        workspaceId: agent.workspaceId,
      },
      {
        quotaCoordinator: this.options.quotaCoordinator,
        webhooks: this.webhooks,
      },
    );
    await appendToolRunEvent(this.repository, this.runEventSequencer, run, {
      type: "tool.started",
      agent,
      tool,
      requestInput: input,
      approvalRequired: binding.approvalRequired,
    });
    let outcome: "success" | "failure" = "success";
    try {
      const parsedInput = tool.inputSchema.parse(input);
      const output = await withTimeout(
        tool.execute(parsedInput),
        tool.timeoutMs,
      );
      const parsedOutput = tool.outputSchema.parse(output);
      const toolCall = await recordToolCall(this.repository, {
        subject,
        agent,
        tool,
        binding,
        status: "success",
        startedAt,
        requestInput: input,
        output: parsedOutput,
        runId: run?.id,
      });
      await appendToolRunEvent(this.repository, this.runEventSequencer, run, {
        type: "tool.completed",
        agent,
        tool,
        requestInput: input,
        output: parsedOutput,
        approvalRequired: binding.approvalRequired,
      });
      this.emitToolWebhook("tool.call.succeeded", toolCall);
      return parsedOutput;
    } catch (error) {
      outcome = "failure";
      const errorCode =
        error instanceof ZodError ? "invalid_request" : "tool_execution_error";
      metadata = { ...metadata, errorCode };
      const toolCall = await recordToolCall(this.repository, {
        subject,
        agent,
        tool,
        binding,
        status: "failure",
        startedAt,
        requestInput: input,
        errorCode,
        runId: run?.id,
      });
      await appendToolRunEvent(this.repository, this.runEventSequencer, run, {
        type: "tool.failed",
        agent,
        tool,
        requestInput: input,
        errorCode,
        approvalRequired: binding.approvalRequired,
      });
      this.emitToolWebhook("tool.call.failed", toolCall);
      if (error instanceof ZodError) throw error;
      throw new ApiError(
        "tool_execution_error",
        error instanceof Error ? error.message : "Tool execution failed.",
        400,
      );
    } finally {
      await this.auditExecution(subject, tool.id, outcome, metadata);
      await recordSubjectUsage(this.repository, subject, {
        orgId: subject.orgId,
        sourceType: "tool",
        sourceId: tool.id,
        metric:
          outcome === "success" ? "tool.call.success" : "tool.call.failure",
        quantity: 1,
        unit: "call",
        metadata,
      });
    }
  }

  private async executeOperation(
    subject: AuthSubject,
    operationTool: OperationToolContext,
    input: unknown,
    options: {
      agentId: string;
      approved?: boolean;
      approvalRequestId?: string;
      idempotencyKey?: string;
      runId?: string;
    },
  ): Promise<unknown> {
    const { connector, operation, tool } = operationTool;
    const agent = await this.getAgentForSubject(subject, options.agentId);
    const run = await getToolRun(
      this.repository,
      subject,
      agent,
      options.runId,
    );
    assertRunToolExecutionAllowed(run, {
      approved: options.approved,
      approvalRequestId: options.approvalRequestId,
    });
    const binding = await this.getBinding(agent.id, tool.id);
    const approvalRequired = operationApprovalRequired(binding, operation);
    let metadata = operationToolAuditMetadata(
      tool,
      input,
      agent.id,
      binding,
      connector,
      operation,
    );
    const startedAt = new Date().toISOString();

    if (!binding?.enabled) {
      await this.auditExecution(subject, tool.id, "failure", {
        ...metadata,
        errorCode: "tool_not_bound",
      });
      await recordToolCall(this.repository, {
        subject,
        agent,
        tool,
        binding,
        status: "blocked",
        startedAt,
        requestInput: input,
        errorCode: "tool_not_bound",
        runId: run?.id,
      });
      await appendToolRunEvent(this.repository, this.runEventSequencer, run, {
        type: "tool.failed",
        agent,
        tool,
        requestInput: input,
        errorCode: "tool_not_bound",
        approvalRequired: false,
      });
      throw new ApiError(
        "tool_not_bound",
        "Tool is not enabled for this agent.",
        403,
        { agentId: agent.id, toolId: tool.id },
      );
    }

    let parsedInput: OperationToolInput;
    try {
      parsedInput = parseOperationToolInput(input);
    } catch (error) {
      await this.recordOperationFailure({
        agent,
        approvalRequired,
        binding,
        errorCode: "invalid_request",
        input,
        metadata,
        run,
        startedAt,
        subject,
        tool,
      });
      throw error;
    }

    if (
      binding.approvalRequired &&
      operation.approvalPolicy === "never" &&
      options.approved !== true
    ) {
      const toolCall = await recordToolCall(this.repository, {
        subject,
        agent,
        tool,
        binding,
        status: "approval_required",
        startedAt,
        requestInput: input,
        errorCode: "tool_approval_required",
        runId: run?.id,
      });
      await this.auditExecution(subject, tool.id, "failure", {
        ...metadata,
        errorCode: "tool_approval_required",
        approvalRequestId: toolCall.id,
      });
      await appendToolRunEvent(this.repository, this.runEventSequencer, run, {
        type: "tool.approval_required",
        agent,
        tool,
        requestInput: input,
        errorCode: "tool_approval_required",
        approvalRequestId: toolCall.id,
        approvalRequired: true,
      });
      throw new ApiError(
        "tool_approval_required",
        "Tool approval is required before execution.",
        409,
        { agentId: agent.id, toolId: tool.id, approvalRequestId: toolCall.id },
      );
    }

    if (binding.approvalRequired && operation.approvalPolicy === "never") {
      try {
        await this.assertApprovalRequest(
          subject,
          agent,
          tool.id,
          options.approvalRequestId,
          run?.id,
        );
      } catch (error) {
        const errorCode =
          error instanceof ApiError
            ? error.code
            : "invalid_tool_approval_request";
        await this.recordOperationFailure({
          agent,
          approvalRequired,
          binding,
          errorCode,
          input,
          metadata,
          run,
          startedAt,
          subject,
          tool,
        });
        throw error;
      }
    }

    if (operation.approvalPolicy !== "never" && options.approved !== true) {
      try {
        await this.enqueueOperationDispatchRequest({
          connector,
          operation,
          parsedInput,
          subject,
        });
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.code === "tool_operation_approval_required"
        ) {
          const approvalRequestId = stringDetail(
            error.details,
            "approvalRequestId",
          );
          await recordToolCall(this.repository, {
            subject,
            agent,
            tool,
            binding,
            status: "approval_required",
            startedAt,
            requestInput: input,
            errorCode: "tool_approval_required",
            runId: run?.id,
          });
          await this.auditExecution(subject, tool.id, "failure", {
            ...metadata,
            errorCode: "tool_approval_required",
            ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
          });
          await appendToolRunEvent(
            this.repository,
            this.runEventSequencer,
            run,
            {
              type: "tool.approval_required",
              agent,
              tool,
              requestInput: input,
              errorCode: "tool_approval_required",
              ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
              approvalRequired: true,
            },
          );
          throw new ApiError(
            "tool_approval_required",
            "Tool approval is required before execution.",
            409,
            {
              agentId: agent.id,
              toolId: tool.id,
              ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
            },
          );
        }
        const errorCode =
          error instanceof ApiError ? error.code : "tool_execution_error";
        await this.recordOperationFailure({
          agent,
          approvalRequired,
          binding,
          errorCode,
          input,
          metadata,
          run,
          startedAt,
          subject,
          tool,
        });
        throw error;
      }
    }

    await assertAbuseControlsAllow(this.repository, subject, {
      action: "tool.execute",
      agentId: agent.id,
      connectorId: connector.id,
      toolId: tool.id,
      workerClass: "external_tool_operations",
      workspaceId: agent.workspaceId,
    });
    await consumeQuota(
      this.repository,
      subject,
      {
        agentId: agent.id,
        metric: "tool.call",
        quantity: 1,
        workspaceId: agent.workspaceId,
      },
      {
        quotaCoordinator: this.options.quotaCoordinator,
        webhooks: this.webhooks,
      },
    );
    await appendToolRunEvent(this.repository, this.runEventSequencer, run, {
      type: "tool.started",
      agent,
      tool,
      requestInput: input,
      approvalRequired,
    });
    let outcome: "success" | "failure" = "success";
    try {
      const dispatch = await this.enqueueOperationDispatchRequest({
        connector,
        operation,
        parsedInput,
        run,
        subject,
        tool,
        ...(options.approved === undefined
          ? {}
          : { approved: options.approved }),
        ...(options.approvalRequestId === undefined
          ? {}
          : { approvalRequestId: options.approvalRequestId }),
        ...(options.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: options.idempotencyKey }),
      });
      const output = operationDispatchModelOutput(dispatch);
      const toolCall = await recordToolCall(this.repository, {
        subject,
        agent,
        tool,
        binding,
        status: "success",
        startedAt,
        requestInput: input,
        output,
        runId: run?.id,
      });
      await appendToolRunEvent(this.repository, this.runEventSequencer, run, {
        type: "tool.completed",
        agent,
        tool,
        requestInput: input,
        output,
        approvalRequired,
      });
      metadata = {
        ...metadata,
        jobId: dispatch.job.id,
        workerQueue: dispatch.workerQueue,
        payloadStorage: dispatch.request.payloadStorage,
      };
      this.emitToolWebhook("tool.call.succeeded", toolCall);
      return output;
    } catch (error) {
      outcome = "failure";
      const errorCode =
        error instanceof ZodError
          ? "invalid_request"
          : error instanceof ApiError
            ? error.code
            : "tool_execution_error";
      metadata = { ...metadata, errorCode };
      const toolCall = await recordToolCall(this.repository, {
        subject,
        agent,
        tool,
        binding,
        status: "failure",
        startedAt,
        requestInput: input,
        errorCode,
        runId: run?.id,
      });
      await appendToolRunEvent(this.repository, this.runEventSequencer, run, {
        type: "tool.failed",
        agent,
        tool,
        requestInput: input,
        errorCode,
        approvalRequired,
      });
      this.emitToolWebhook("tool.call.failed", toolCall);
      if (error instanceof ZodError || error instanceof ApiError) throw error;
      throw new ApiError(
        "tool_execution_error",
        error instanceof Error ? error.message : "Tool execution failed.",
        400,
      );
    } finally {
      await this.auditExecution(subject, tool.id, outcome, metadata);
      await recordSubjectUsage(this.repository, subject, {
        orgId: subject.orgId,
        sourceType: "tool",
        sourceId: tool.id,
        metric:
          outcome === "success" ? "tool.call.success" : "tool.call.failure",
        quantity: 1,
        unit: "call",
        metadata,
      });
    }
  }

  async executeForRun(
    subject: AuthSubject,
    runId: string,
    toolId: string,
    input: unknown,
    options: {
      approved?: boolean;
      approvalRequestId?: string;
      modelToolCallId?: string;
    },
  ): Promise<unknown> {
    const run = await this.repository.getRun(runId);
    if (!run) throw notFound("Run");
    assertRunToolExecutionAllowed(run, options);
    return this.execute(subject, toolId, input, {
      agentId: run.agentId,
      runId: run.id,
      ...(options.approved === undefined ? {} : { approved: options.approved }),
      ...(options.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: options.approvalRequestId }),
      ...(options.modelToolCallId === undefined
        ? {}
        : { idempotencyKey: options.modelToolCallId }),
    });
  }

  private async enqueueOperationDispatchRequest(input: {
    approvalRequestId?: string;
    approved?: boolean;
    connector: ToolConnector;
    idempotencyKey?: string;
    operation: ToolOperation;
    parsedInput: OperationToolInput;
    run?: Awaited<ReturnType<typeof getToolRun>>;
    subject: AuthSubject;
    tool?: ToolDefinition;
  }): Promise<ToolOperationDispatchRequestResult> {
    return enqueueToolOperationDispatch({
      repository: this.repository,
      secretResolver: this.options.secretResolver ?? disabledSecretResolver,
      externalExecutionEnabled:
        this.options.externalOperationExecutionEnabled === true,
      fetchImpl: this.options.fetchImpl ?? fetch,
      timeoutMs: this.options.timeoutMs ?? 10_000,
      maxBytes: this.options.maxBytes ?? 1_000_000,
      subject: input.subject,
      connector: input.connector,
      operation: input.operation,
      requiredScope: "tools:use",
      ...(this.options.dispatchPayloadStore === undefined
        ? {}
        : { dispatchPayloadStore: this.options.dispatchPayloadStore }),
      ...(input.run === undefined || input.tool === undefined
        ? {}
        : {
            runContext: {
              agentId: input.run.agentId,
              runId: input.run.id,
              toolId: input.tool.id,
              workspaceId: input.run.workspaceId,
            },
          }),
      ...(input.approved === undefined ? {} : { approved: input.approved }),
      ...(input.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: input.approvalRequestId }),
      ...(input.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: input.idempotencyKey }),
      ...(input.parsedInput.parameters === undefined
        ? {}
        : { parameters: input.parsedInput.parameters }),
      ...(input.parsedInput.body === undefined
        ? {}
        : { body: input.parsedInput.body }),
    });
  }

  private async recordOperationFailure(input: {
    agent: Agent;
    approvalRequired: boolean;
    binding: AgentToolBinding | undefined;
    errorCode: string;
    input: unknown;
    metadata: Record<string, unknown>;
    run: Awaited<ReturnType<typeof getToolRun>>;
    startedAt: string;
    subject: AuthSubject;
    tool: ToolDefinition;
  }): Promise<void> {
    await this.auditExecution(input.subject, input.tool.id, "failure", {
      ...input.metadata,
      errorCode: input.errorCode,
    });
    const toolCall = await recordToolCall(this.repository, {
      subject: input.subject,
      agent: input.agent,
      tool: input.tool,
      binding: input.binding,
      status: "failure",
      startedAt: input.startedAt,
      requestInput: input.input,
      errorCode: input.errorCode,
      runId: input.run?.id,
    });
    await appendToolRunEvent(
      this.repository,
      this.runEventSequencer,
      input.run,
      {
        type: "tool.failed",
        agent: input.agent,
        tool: input.tool,
        requestInput: input.input,
        errorCode: input.errorCode,
        approvalRequired: input.approvalRequired,
      },
    );
    this.emitToolWebhook("tool.call.failed", toolCall);
  }

  private getTool(toolId: string): ToolDefinition {
    const tool = this.tools.get(toolId);
    if (!tool) throw notFound("Tool");
    return tool;
  }

  private async getOperationTool(
    subject: AuthSubject,
    toolId: string,
  ): Promise<OperationToolContext | undefined> {
    const tools = await this.listOperationTools(subject);
    return tools.find((tool) => tool.operation.id === toolId);
  }

  private async listOperationTools(
    subject: AuthSubject,
  ): Promise<OperationToolContext[]> {
    const connectors = await this.repository.listToolConnectors(subject.orgId);
    const output: OperationToolContext[] = [];
    for (const connector of connectors) {
      const operations = await this.repository.listToolOperations(connector.id);
      for (const operation of operations) {
        output.push({
          connector,
          operation,
          tool: createOperationToolDefinition(connector, operation),
        });
      }
    }
    return output;
  }

  private async getBinding(
    agentId: string,
    toolId: string,
  ): Promise<AgentToolBinding | undefined> {
    return (await this.repository.listAgentToolBindings(agentId)).find(
      (binding) => binding.toolId === toolId,
    );
  }

  private async getAgentForSubject(
    subject: AuthSubject,
    agentId: string,
  ): Promise<Agent> {
    const agent = await this.repository.getAgent(agentId);
    if (!agent) throw notFound("Agent");
    if (!canAccessOrg(subject, agent.orgId))
      throw new AuthorizationError(
        "The agent is outside the caller organization.",
      );
    if (!hasWorkspaceAccess(subject, agent.workspaceId))
      throw new AuthorizationError(
        "The agent is outside the caller workspace access.",
      );
    return agent;
  }

  private async assertToolAccess(
    subject: AuthSubject,
    toolId: string,
  ): Promise<void> {
    const grants = await this.repository.listResourceGrants(subject.orgId);
    if (!hasGrant(subject, grants, "tool", toolId, "use"))
      throw new AuthorizationError(`Missing use permission for tool:${toolId}`);
  }

  private async assertApprovalRequest(
    subject: AuthSubject,
    agent: Agent,
    toolId: string,
    approvalRequestId: string | undefined,
    runId: string | undefined,
  ): Promise<void> {
    if (approvalRequestId === undefined) {
      throw new ApiError(
        "tool_approval_request_required",
        "Approved tool execution requires an approval request ID.",
        409,
        { agentId: agent.id, toolId },
      );
    }
    const [calls, jobs] = await Promise.all([
      this.repository.listToolCalls(subject.orgId),
      this.repository.listBackgroundJobs(subject.orgId),
    ]);
    const approvalRequest = calls.find((call) => call.id === approvalRequestId);
    if (
      approvalRequest === undefined ||
      approvalRequest.status !== "approval_required" ||
      approvalRequest.actorId !== subject.id ||
      approvalRequest.agentId !== agent.id ||
      approvalRequest.toolId !== toolId ||
      approvalRequest.runId !== runId
    ) {
      throw new ApiError(
        "invalid_tool_approval_request",
        "Tool approval request is invalid for this execution.",
        409,
        { agentId: agent.id, toolId },
      );
    }
    if (toolApprovalConsumed(approvalRequest, calls)) {
      throw new ApiError(
        "tool_approval_request_consumed",
        "Tool approval request was already consumed.",
        409,
        { agentId: agent.id, toolId },
      );
    }
    const decision = toolApprovalDecision(approvalRequest, jobs);
    if (decision?.status === "rejected" || decision?.status === "cancelled") {
      throw new ApiError(
        decision.status === "cancelled"
          ? "tool_approval_request_cancelled"
          : "tool_approval_request_rejected",
        `Tool approval request was ${decision.status}.`,
        409,
        { agentId: agent.id, toolId },
      );
    }
    if (
      Date.now() - new Date(approvalRequest.completedAt).getTime() >
      15 * 60 * 1000
    ) {
      throw new ApiError(
        "tool_approval_request_expired",
        "Tool approval request has expired.",
        409,
        { agentId: agent.id, toolId },
      );
    }
  }

  private async auditExecution(
    subject: AuthSubject,
    toolId: string,
    outcome: "success" | "failure",
    metadata: Record<string, unknown>,
  ) {
    await writeAuditLog(this.repository, {
      subject,
      action: "tool.execute",
      resourceType: "tool",
      resourceId: toolId,
      outcome,
      metadata,
    });
  }

  private async consumeExecutionIdempotency(input: {
    subject: AuthSubject;
    agent: Agent;
    tool: ToolDefinition;
    runId: string | undefined;
    idempotencyKey: string;
    requestInput: unknown;
  }): Promise<void> {
    const now = new Date().toISOString();
    const job = toolExecutionIdempotencyJob(input, now);
    try {
      await this.repository.transaction(async (repository) => {
        const existing = (
          await repository.listBackgroundJobs(input.subject.orgId)
        ).find((item) => item.id === job.id);
        if (existing !== undefined)
          throw toolExecutionReplayError(input.tool.id, input.runId);
        await repository.createBackgroundJob(job);
      });
    } catch (error) {
      if (isToolExecutionReplayError(error)) throw error;
      if (isUniqueConstraintError(error))
        throw toolExecutionReplayError(input.tool.id, input.runId);
      throw error;
    }
  }

  private emitToolWebhook(
    eventType: "tool.call.failed" | "tool.call.succeeded",
    toolCall: ToolCallRecord,
  ): void {
    emitWebhookEvent(this.webhooks, {
      orgId: toolCall.orgId,
      eventType,
      payload: {
        toolCallId: toolCall.id,
        workspaceId: toolCall.workspaceId,
        agentId: toolCall.agentId,
        actorId: toolCall.actorId,
        toolId: toolCall.toolId,
        runId: toolCall.runId,
        status: toolCall.status,
        riskLevel: toolCall.riskLevel,
        approvalRequired: toolCall.approvalRequired,
        inputKeys: toolCall.inputKeys,
        outputKeys: toolCall.outputKeys,
        errorCode: toolCall.errorCode,
        completedAt: toolCall.completedAt,
      },
    });
  }

  private toToolApprovalRequestSummary(
    call: ToolCallRecord,
    operationTools: OperationToolContext[],
  ): ToolApprovalRequestSummary {
    const builtIn = this.tools.get(call.toolId);
    const operationTool = operationTools.find(
      (item) => item.tool.id === call.toolId,
    );
    const toolMetadata =
      builtIn !== undefined
        ? {
            id: builtIn.id,
            approvalPolicy: builtIn.approvalPolicy,
            description: builtIn.description,
            kind: "built_in" as const,
            name: builtIn.name,
            riskLevel: builtIn.riskLevel,
          }
        : operationTool !== undefined
          ? {
              id: operationTool.tool.id,
              approvalPolicy: operationTool.operation.approvalPolicy,
              connectorId: operationTool.connector.id,
              description: operationTool.tool.description,
              kind: "imported_operation" as const,
              method: operationTool.operation.method,
              name: operationTool.tool.name,
              operationId: operationTool.operation.operationId,
              path: operationTool.operation.path,
              riskLevel: operationTool.operation.riskLevel,
            }
          : {
              id: call.toolId,
              approvalPolicy: "unknown",
              description: "Tool approval request",
              kind: "unknown" as const,
              name: call.toolId,
              riskLevel: call.riskLevel,
            };
    return {
      ...call,
      approvalRequestId: call.id,
      approvalRequired: true,
      availableActions: ["approve", "cancel", "reject"],
      expiresAt: new Date(
        new Date(call.completedAt).getTime() + TOOL_APPROVAL_TTL_MS,
      ).toISOString(),
      requestedAt: call.completedAt,
      source: "tool_call",
      status: "approval_required",
      tool: toolMetadata,
    };
  }

  private toOperationApprovalRequestSummary(
    job: BackgroundJob,
    operationTools: OperationToolContext[],
  ): ToolApprovalRequestSummary {
    const payload = job.payload;
    const connectorId = stringPayload(payload, "connectorId");
    const operationId = stringPayload(payload, "operationId");
    const method = stringPayload(payload, "method");
    const path = stringPayload(payload, "path");
    const parameterKeys = stringArrayPayload(payload, "parameterKeys");
    const bodyKeys = stringArrayPayload(payload, "bodyKeys");
    const operationTool = operationTools.find(
      (item) =>
        item.connector.id === connectorId &&
        item.operation.operationId === operationId,
    );
    const completedAt = job.completedAt ?? job.updatedAt;
    const requestedAt = job.createdAt;
    const toolId =
      stringPayloadOptional(payload, "toolId") ??
      operationTool?.tool.id ??
      `operation:${connectorId}:${operationId}`;
    const context = {
      connectorId,
      operationId,
      method,
      path,
      parameterKeys,
      bodyKeys,
      ...optionalStringProperty(payload, "agentId"),
      ...optionalStringProperty(payload, "runId"),
      ...optionalStringProperty(payload, "workspaceId"),
    };
    return {
      id: job.id,
      orgId: job.orgId,
      approvalRequestId: job.id,
      approvalRequired: true,
      actorId: stringPayload(payload, "actorId"),
      availableActions: ["approve", "cancel", "reject"],
      completedAt,
      expiresAt: new Date(
        new Date(requestedAt).getTime() + TOOL_APPROVAL_TTL_MS,
      ).toISOString(),
      inputKeys: [
        ...parameterKeys.map((key) => `parameters.${key}`),
        ...bodyKeys.map((key) => `body.${key}`),
      ],
      outputKeys: [],
      requestedAt,
      riskLevel:
        stringPayloadOptional(payload, "riskLevel") ??
        operationTool?.operation.riskLevel ??
        "unknown",
      source: "operation_dispatch",
      startedAt: job.createdAt,
      status: "approval_required",
      toolId,
      ...optionalStringProperty(payload, "agentId"),
      context,
      ...optionalStringProperty(payload, "runId"),
      tool: {
        id: toolId,
        approvalPolicy:
          stringPayloadOptional(payload, "approvalPolicy") ??
          operationTool?.operation.approvalPolicy ??
          "unknown",
        connectorId,
        description:
          operationTool?.tool.description ??
          `${method.toUpperCase()} ${path} approval request`,
        kind: "imported_operation",
        method,
        name: operationTool?.tool.name ?? operationId,
        operationId,
        path,
        riskLevel:
          stringPayloadOptional(payload, "riskLevel") ??
          operationTool?.operation.riskLevel ??
          "unknown",
      },
      ...optionalStringProperty(payload, "workspaceId"),
    };
  }

  private async decideOperationApproval(
    subject: AuthSubject,
    approvalRequest: BackgroundJob,
    decision: ToolApprovalDecisionStatus,
  ): Promise<ToolApprovalDecisionResult> {
    const workspaceId = stringPayloadOptional(
      approvalRequest.payload,
      "workspaceId",
    );
    if (
      workspaceId !== undefined &&
      !hasWorkspaceAccess(subject, workspaceId)
    ) {
      throw new AuthorizationError(
        "The tool approval request is outside the caller workspace access.",
      );
    }
    if (approvalRequest.payload.actorId !== subject.id) {
      throw new AuthorizationError(
        "The tool approval request is owned by another principal.",
      );
    }
    const existingDecision = operationApprovalDecision(approvalRequest);
    if (existingDecision !== undefined) {
      if (existingDecision === decision)
        return this.operationApprovalDecisionFromJob(approvalRequest);
      throw new ApiError(
        "tool_operation_approval_request_already_decided",
        "Tool operation approval request already has a terminal decision.",
        409,
        { approvalRequestId: approvalRequest.id, status: existingDecision },
      );
    }
    if (operationApprovalExpired(approvalRequest)) {
      throw new ApiError(
        "tool_operation_approval_request_expired",
        "Tool operation approval request has expired.",
        409,
        { approvalRequestId: approvalRequest.id },
      );
    }
    if (operationApprovalConsumed(approvalRequest)) {
      throw new ApiError(
        "tool_operation_approval_request_consumed",
        "Tool operation approval request was already consumed.",
        409,
        { approvalRequestId: approvalRequest.id },
      );
    }

    const now = new Date().toISOString();
    const rejected = await this.repository.transaction(async (repository) => {
      const existing = (
        await repository.listBackgroundJobs(subject.orgId)
      ).find((job) => job.id === approvalRequest.id);
      if (existing === undefined) return approvalRequest;
      const existingDecision = operationApprovalDecision(existing);
      if (existingDecision !== undefined) return existing;
      const updated = await repository.updateBackgroundJob({
        ...existing,
        payload: {
          ...existing.payload,
          decision,
          [toolApprovalDecisionTimestampKey(decision)]: now,
          [toolApprovalDecisionActorKey(decision)]: subject.id,
        },
        updatedAt: now,
      });
      await writeAuditLog(repository, {
        subject,
        action: toolOperationApprovalAuditAction(decision),
        resourceType: "tool_operation",
        resourceId: stringPayload(existing.payload, "operationId"),
        metadata: {
          approvalRequestId: existing.id,
          bodyKeyCount: stringArrayPayload(existing.payload, "bodyKeys").length,
          connectorId: stringPayload(existing.payload, "connectorId"),
          decision,
          ...(decision === "approved"
            ? {}
            : { errorCode: toolOperationApprovalDecisionErrorCode(decision) }),
          method: stringPayload(existing.payload, "method"),
          operationId: stringPayload(existing.payload, "operationId"),
          parameterKeyCount: stringArrayPayload(
            existing.payload,
            "parameterKeys",
          ).length,
          path: stringPayload(existing.payload, "path"),
          ...optionalStringProperty(existing.payload, "agentId"),
          ...optionalStringProperty(existing.payload, "runId"),
          ...optionalStringProperty(existing.payload, "workspaceId"),
        },
      });
      return updated;
    });
    return this.operationApprovalDecisionFromJob(rejected);
  }

  private operationApprovalDecisionFromJob(
    job: BackgroundJob,
  ): ToolApprovalDecisionResult {
    const payload = job.payload;
    const status = operationApprovalDecision(job) ?? "rejected";
    const decidedAt = stringPayload(
      payload,
      toolApprovalDecisionTimestampKey(status),
    );
    const operationToolId =
      stringPayloadOptional(payload, "toolId") ??
      `operation:${stringPayload(payload, "connectorId")}:${stringPayload(
        payload,
        "operationId",
      )}`;
    return {
      approvalRequestId: job.id,
      decidedAt,
      status,
      toolId: operationToolId,
      ...toolApprovalDecisionTimestampProperty(status, decidedAt),
      ...optionalStringProperty(payload, "agentId"),
      ...optionalStringProperty(payload, "runId"),
      ...optionalStringProperty(payload, "workspaceId"),
    };
  }
}

const TOOL_APPROVAL_TTL_MS = 15 * 60 * 1000;

function toolApprovalDecision(
  approval: ToolCallRecord,
  jobs: BackgroundJob[],
): ToolApprovalDecisionResult | undefined {
  const job = jobs.find(
    (item) =>
      item.type === "tool.approval.decision" &&
      item.status === "completed" &&
      item.payload.approvalRequestId === approval.id &&
      toolApprovalDecisionStatus(item.payload.decision) !== undefined,
  );
  return job === undefined ? undefined : toolApprovalDecisionFromJob(job);
}

function toolApprovalDecisionFromJob(
  job: BackgroundJob,
): ToolApprovalDecisionResult {
  const payload = job.payload;
  const status = toolApprovalDecisionStatus(payload.decision) ?? "rejected";
  const decidedAt = stringPayload(
    payload,
    toolApprovalDecisionTimestampKey(status),
  );
  const result: ToolApprovalDecisionResult = {
    agentId: stringPayload(payload, "agentId"),
    approvalRequestId: stringPayload(payload, "approvalRequestId"),
    decidedAt,
    status,
    toolId: stringPayload(payload, "toolId"),
    workspaceId: stringPayload(payload, "workspaceId"),
    ...toolApprovalDecisionTimestampProperty(status, decidedAt),
  };
  const runId = stringPayloadOptional(payload, "runId");
  if (runId !== undefined) result.runId = runId;
  return result;
}

function toolApprovalDecisionJob(
  subject: AuthSubject,
  approval: ToolCallRecord,
  decision: ToolApprovalDecisionStatus,
  decidedAt: string,
): BackgroundJob {
  return {
    id: toolApprovalDecisionJobId(subject.orgId, approval.id, decision),
    orgId: subject.orgId,
    workspaceId: approval.workspaceId,
    type: "tool.approval.decision",
    status: "completed",
    payload: {
      schemaVersion: "romeo.tool-approval-decision.v1",
      decision,
      actorId: subject.id,
      approvalRequestId: approval.id,
      workspaceId: approval.workspaceId,
      agentId: approval.agentId,
      toolId: approval.toolId,
      [toolApprovalDecisionTimestampKey(decision)]: decidedAt,
      ...(approval.runId === undefined ? {} : { runId: approval.runId }),
    },
    createdAt: decidedAt,
    updatedAt: decidedAt,
    completedAt: decidedAt,
  };
}

function toolApprovalDecisionJobId(
  orgId: string,
  approvalRequestId: string,
  decision: ToolApprovalDecisionStatus,
): string {
  return `job_tool_approval_decision_${createHash("sha256")
    .update(`${orgId}:${approvalRequestId}:${decision}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function toolApprovalDecisionStatus(
  value: unknown,
): ToolApprovalDecisionStatus | undefined {
  return value === "approved" || value === "cancelled" || value === "rejected"
    ? value
    : undefined;
}

function toolApprovalDecisionTimestampKey(
  decision: ToolApprovalDecisionStatus,
): "approvedAt" | "cancelledAt" | "rejectedAt" {
  if (decision === "approved") return "approvedAt";
  if (decision === "cancelled") return "cancelledAt";
  return "rejectedAt";
}

function toolApprovalDecisionActorKey(
  decision: ToolApprovalDecisionStatus,
): "approvedBy" | "cancelledBy" | "rejectedBy" {
  if (decision === "approved") return "approvedBy";
  if (decision === "cancelled") return "cancelledBy";
  return "rejectedBy";
}

function toolApprovalDecisionTimestampProperty(
  decision: ToolApprovalDecisionStatus,
  value: string,
): { approvedAt?: string; cancelledAt?: string; rejectedAt?: string } {
  if (decision === "approved") return { approvedAt: value };
  if (decision === "cancelled") return { cancelledAt: value };
  return { rejectedAt: value };
}

function toolApprovalAuditAction(
  decision: ToolApprovalDecisionStatus,
): "tool.approval.approve" | "tool.approval.cancel" | "tool.approval.reject" {
  if (decision === "approved") return "tool.approval.approve";
  if (decision === "cancelled") return "tool.approval.cancel";
  return "tool.approval.reject";
}

function toolOperationApprovalAuditAction(
  decision: ToolApprovalDecisionStatus,
):
  | "tool.operation.approval.approve"
  | "tool.operation.approval.cancel"
  | "tool.operation.approval.reject" {
  if (decision === "approved") return "tool.operation.approval.approve";
  if (decision === "cancelled") return "tool.operation.approval.cancel";
  return "tool.operation.approval.reject";
}

function toolApprovalDecisionErrorCode(
  decision: ToolApprovalDecisionStatus,
): "tool_approval_cancelled" | "tool_approval_rejected" {
  return decision === "cancelled"
    ? "tool_approval_cancelled"
    : "tool_approval_rejected";
}

function toolOperationApprovalDecisionErrorCode(
  decision: ToolApprovalDecisionStatus,
): "tool_operation_approval_cancelled" | "tool_operation_approval_rejected" {
  return decision === "cancelled"
    ? "tool_operation_approval_cancelled"
    : "tool_operation_approval_rejected";
}

function operationApprovalRequired(
  binding: AgentToolBinding | undefined,
  operation: ToolOperation,
): boolean {
  return (
    binding?.approvalRequired === true || operation.approvalPolicy !== "never"
  );
}

function toolApprovalExpired(call: ToolCallRecord): boolean {
  return (
    Date.now() - new Date(call.completedAt).getTime() > TOOL_APPROVAL_TTL_MS
  );
}

function operationApprovalExpired(job: BackgroundJob): boolean {
  return Date.now() - new Date(job.createdAt).getTime() > TOOL_APPROVAL_TTL_MS;
}

function operationApprovalConsumed(job: BackgroundJob): boolean {
  return typeof job.payload.consumedAt === "string";
}

function operationApprovalDecision(
  job: BackgroundJob,
): ToolApprovalDecisionStatus | undefined {
  if (typeof job.payload.approvedAt === "string") return "approved";
  if (typeof job.payload.cancelledAt === "string") return "cancelled";
  if (typeof job.payload.rejectedAt === "string") return "rejected";
  return toolApprovalDecisionStatus(job.payload.decision);
}

function toolApprovalConsumed(
  approval: ToolCallRecord,
  calls: ToolCallRecord[],
): boolean {
  return calls.some(
    (call) =>
      call.id !== approval.id &&
      call.actorId === approval.actorId &&
      call.agentId === approval.agentId &&
      call.toolId === approval.toolId &&
      call.runId === approval.runId &&
      call.completedAt >= approval.completedAt &&
      call.status === "success",
  );
}

function operationToolAuditMetadata(
  tool: ToolDefinition,
  input: unknown,
  agentId: string,
  binding: AgentToolBinding | undefined,
  connector: ToolConnector,
  operation: ToolOperation,
): Record<string, unknown> {
  return {
    ...toolAuditMetadata(tool, input, agentId, binding),
    connectorId: connector.id,
    operationId: operation.operationId,
    method: operation.method,
    path: operation.path,
    payloadStorage: "external_worker_secret_store_required",
  };
}

function operationDispatchModelOutput(
  dispatch: ToolOperationDispatchRequestResult,
): Record<string, unknown> {
  return {
    dispatch: "queued",
    jobId: dispatch.job.id,
    jobStatus: dispatch.job.status,
    connectorId: dispatch.connectorId,
    operationId: dispatch.operationId,
    method: dispatch.method,
    pathTemplate: dispatch.pathTemplate,
    workerQueue: dispatch.workerQueue,
    request: dispatch.request,
    approval: dispatch.approval,
    ...(dispatch.idempotency === undefined
      ? {}
      : { idempotency: dispatch.idempotency }),
  };
}

function stringDetail(
  details: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = details[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringPayload(payload: Record<string, unknown>, key: string): string {
  return stringPayloadOptional(payload, key) ?? "";
}

function stringPayloadOptional(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArrayPayload(
  payload: Record<string, unknown>,
  key: string,
): string[] {
  const value = payload[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").sort()
    : [];
}

function optionalStringProperty(
  payload: Record<string, unknown>,
  key: "agentId" | "runId" | "workspaceId",
): { agentId?: string; runId?: string; workspaceId?: string } {
  const value = stringPayloadOptional(payload, key);
  return value === undefined ? {} : { [key]: value };
}

function assertRunToolExecutionAllowed(
  run: { id: string; status: string } | undefined,
  options: {
    approved?: boolean | undefined;
    approvalRequestId?: string | undefined;
  },
): void {
  if (run === undefined) return;
  if (run.status === "running") return;
  if (run.status === "waiting_tool_approval") {
    if (options.approved === true && options.approvalRequestId !== undefined)
      return;
    throw new ApiError(
      "run_tool_execution_waiting_approval",
      "Run-scoped tool execution is waiting for the pending approval request.",
      409,
      { runId: run.id, status: run.status },
    );
  }
  throw new ApiError(
    "run_tool_execution_not_active",
    "Run-scoped tool execution requires an active run.",
    409,
    { runId: run.id, status: run.status },
  );
}

function toolExecutionIdempotencyJob(
  input: {
    subject: AuthSubject;
    agent: Agent;
    tool: ToolDefinition;
    runId: string | undefined;
    idempotencyKey: string;
    requestInput: unknown;
  },
  now: string,
): BackgroundJob {
  const idempotencyKeyHash = toolExecutionIdempotencyHash(input);
  return {
    id: `job_tool_execution_${idempotencyKeyHash.slice(0, 32)}`,
    orgId: input.subject.orgId,
    workspaceId: input.agent.workspaceId,
    type: "tool.execution.idempotency",
    status: "completed",
    payload: {
      agentId: input.agent.id,
      actorId: input.subject.id,
      idempotencyKeyHash,
      inputKeys: objectKeys(input.requestInput),
      purpose: "model_tool_call_duplicate_guard",
      runId: input.runId ?? null,
      toolId: input.tool.id,
    },
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  };
}

function toolExecutionIdempotencyHash(input: {
  subject: AuthSubject;
  agent: Agent;
  tool: ToolDefinition;
  runId: string | undefined;
  idempotencyKey: string;
}): string {
  return createHash("sha256")
    .update("tool.execution.idempotency.v1")
    .update("\0")
    .update(input.subject.orgId)
    .update("\0")
    .update(input.subject.id)
    .update("\0")
    .update(input.agent.id)
    .update("\0")
    .update(input.tool.id)
    .update("\0")
    .update(input.runId ?? "")
    .update("\0")
    .update(input.idempotencyKey)
    .digest("hex");
}

function toolExecutionReplayError(
  toolId: string,
  runId: string | undefined,
): ApiError {
  return new ApiError(
    "tool_execution_replayed",
    "Tool execution idempotency key was already used.",
    409,
    {
      toolId,
      ...(runId === undefined ? {} : { runId }),
    },
  );
}

function isToolExecutionReplayError(error: unknown): boolean {
  return error instanceof ApiError && error.code === "tool_execution_replayed";
}

function isUniqueConstraintError(error: unknown): boolean {
  const candidate = error as { cause?: { code?: unknown }; code?: unknown };
  return candidate.code === "23505" || candidate.cause?.code === "23505";
}
