import type { AuthSubject } from "@romeo/auth";
import type { ToolDefinition } from "@romeo/tools";

import type {
  Agent,
  AgentToolBinding,
  ToolCallRecord,
  ToolConnector,
  ToolOperation,
  ToolOperationDispatchRequestResult,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { type AuditMetadata, writeAuditLog } from "./audit-log";
import { disabledSecretResolver } from "./secret-resolver";
import { recordToolCall } from "./tool-call-records";
import { enqueueToolOperationDispatch } from "./tool-operation-dispatch";
import type { OperationToolInput } from "./tool-operation-tooling";
import { appendToolRunEvent, getToolRun } from "./tool-run-events";
import type { RunEventSequencer } from "./run-event-sequencer";
import type { ToolServiceOptions } from "./tool-service-contracts";
import {
  isToolExecutionReplayError,
  isUniqueConstraintError,
  toolApprovalConsumed,
  toolApprovalDecision,
  toolExecutionIdempotencyJob,
  toolExecutionReplayError,
} from "./tool-service-helpers";
import { emitWebhookEvent } from "./webhook-events";
import type { WebhookEmitter } from "./webhook-service";

export class ToolExecutionSupport {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly runEventSequencer: RunEventSequencer,
    private readonly webhooks: WebhookEmitter | undefined,
    private readonly options: ToolServiceOptions,
  ) {}

  async enqueueOperation(input: {
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

  async recordOperationFailure(input: {
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
    await this.audit(input.subject, input.tool.id, "failure", {
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
    this.emitWebhook("tool.call.failed", toolCall);
  }

  async assertApprovalRequest(
    subject: AuthSubject,
    agent: Agent,
    toolId: string,
    approvalRequestId: string | undefined,
    runId: string | undefined,
  ): Promise<void> {
    if (approvalRequestId === undefined)
      throw new ApiError(
        "tool_approval_request_required",
        "Approved tool execution requires an approval request ID.",
        409,
        { agentId: agent.id, toolId },
      );
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
    )
      throw new ApiError(
        "invalid_tool_approval_request",
        "Tool approval request is invalid for this execution.",
        409,
        { agentId: agent.id, toolId },
      );
    if (toolApprovalConsumed(approvalRequest, calls))
      throw new ApiError(
        "tool_approval_request_consumed",
        "Tool approval request was already consumed.",
        409,
        { agentId: agent.id, toolId },
      );
    const decision = toolApprovalDecision(approvalRequest, jobs);
    if (decision?.status === "rejected" || decision?.status === "cancelled")
      throw new ApiError(
        decision.status === "cancelled"
          ? "tool_approval_request_cancelled"
          : "tool_approval_request_rejected",
        `Tool approval request was ${decision.status}.`,
        409,
        { agentId: agent.id, toolId },
      );
    if (Date.now() - new Date(approvalRequest.completedAt).getTime() > 900_000)
      throw new ApiError(
        "tool_approval_request_expired",
        "Tool approval request has expired.",
        409,
        { agentId: agent.id, toolId },
      );
  }

  async audit(
    subject: AuthSubject,
    toolId: string,
    outcome: "success" | "failure",
    metadata: AuditMetadata<"tool.execute">,
  ): Promise<void> {
    await writeAuditLog(this.repository, {
      subject,
      action: "tool.execute",
      resourceType: "tool",
      resourceId: toolId,
      outcome,
      metadata,
    });
  }

  async consumeIdempotency(input: {
    subject: AuthSubject;
    agent: Agent;
    tool: ToolDefinition;
    runId: string | undefined;
    idempotencyKey: string;
    requestInput: unknown;
  }): Promise<void> {
    const job = toolExecutionIdempotencyJob(input, new Date().toISOString());
    try {
      await this.repository.transaction(async (repository) => {
        const exists = (
          await repository.listBackgroundJobs(input.subject.orgId)
        ).some((item) => item.id === job.id);
        if (exists) throw toolExecutionReplayError(input.tool.id, input.runId);
        await repository.createBackgroundJob(job);
      });
    } catch (error) {
      if (isToolExecutionReplayError(error)) throw error;
      if (isUniqueConstraintError(error))
        throw toolExecutionReplayError(input.tool.id, input.runId);
      throw error;
    }
  }

  emitWebhook(
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
}
