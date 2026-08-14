import type { AuthSubject } from "@romeo/auth";
import { ZodError } from "zod";

import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { consumeQuota } from "./consume-quota";
import { recordSubjectUsage } from "./record-usage";
import type { RunEventSequencer } from "./run-event-sequencer";
import { recordToolCall } from "./tool-call-records";
import type { ToolCatalogService } from "./tool-catalog-service";
import type { ToolExecutionSupport } from "./tool-execution-support";
import { parseOperationToolInput } from "./tool-operation-tooling";
import { appendToolRunEvent, getToolRun } from "./tool-run-events";
import type {
  OperationToolContext,
  ToolExecutionOptions,
  ToolServiceOptions,
} from "./tool-service-contracts";
import {
  assertRunToolExecutionAllowed,
  operationApprovalRequired,
  operationDispatchModelOutput,
  operationToolAuditMetadata,
  stringDetail,
} from "./tool-service-helpers";
import type { WebhookEmitter } from "./webhook-service";

export class OperationToolExecutionService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly runEventSequencer: RunEventSequencer,
    private readonly catalog: ToolCatalogService,
    private readonly support: ToolExecutionSupport,
    private readonly webhooks: WebhookEmitter | undefined,
    private readonly options: ToolServiceOptions,
  ) {}

  async execute(
    subject: AuthSubject,
    operationTool: OperationToolContext,
    input: unknown,
    options: ToolExecutionOptions,
  ): Promise<unknown> {
    const { connector, operation, tool } = operationTool;
    const agent = await this.catalog.getAgentForSubject(
      subject,
      options.agentId,
    );
    const run = await getToolRun(
      this.repository,
      subject,
      agent,
      options.runId,
    );
    assertRunToolExecutionAllowed(run, options);
    const binding = await this.catalog.getBinding(agent.id, tool.id);
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
      await this.support.audit(subject, tool.id, "failure", {
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

    let parsedInput;
    try {
      parsedInput = parseOperationToolInput(input);
    } catch (error) {
      await this.support.recordOperationFailure({
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
      await this.support.audit(subject, tool.id, "failure", {
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
        await this.support.assertApprovalRequest(
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
        await this.support.recordOperationFailure({
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
        await this.support.enqueueOperation({
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
          await this.support.audit(subject, tool.id, "failure", {
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
        await this.support.recordOperationFailure({
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
      const dispatch = await this.support.enqueueOperation({
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
      this.support.emitWebhook("tool.call.succeeded", toolCall);
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
      this.support.emitWebhook("tool.call.failed", toolCall);
      if (error instanceof ZodError || error instanceof ApiError) throw error;
      throw new ApiError(
        "tool_execution_error",
        "The tool could not complete the request.",
        400,
      );
    } finally {
      await this.support.audit(subject, tool.id, outcome, metadata);
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
}
