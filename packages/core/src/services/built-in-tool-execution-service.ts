import { assertScope, type AuthSubject } from "@romeo/auth";
import type { ToolDefinition } from "@romeo/tools";
import { ZodError } from "zod";

import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { consumeQuota } from "./consume-quota";
import { recordSubjectUsage } from "./record-usage";
import type { RunEventSequencer } from "./run-event-sequencer";
import { recordToolCall } from "./tool-call-records";
import type { ToolCatalogService } from "./tool-catalog-service";
import { ToolExecutionSupport } from "./tool-execution-support";
import { toolAuditMetadata, withTimeout } from "./tool-execution";
import { appendToolRunEvent, getToolRun } from "./tool-run-events";
import type {
  ToolExecutionOptions,
  ToolServiceOptions,
} from "./tool-service-contracts";
import { assertRunToolExecutionAllowed } from "./tool-service-helpers";
import type { WebhookEmitter } from "./webhook-service";

export class BuiltInToolExecutionService {
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
    tool: ToolDefinition,
    input: unknown,
    options: ToolExecutionOptions,
  ): Promise<unknown> {
    assertScope(subject, "tools:use");
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
    await this.catalog.assertToolAccess(subject, tool.id);
    const binding = await this.catalog.getBinding(agent.id, tool.id);
    let metadata = toolAuditMetadata(tool, input, agent.id, binding);
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

    if (binding.approvalRequired) {
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
        await this.support.audit(subject, tool.id, "failure", {
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

    if (options.idempotencyKey !== undefined)
      await this.support.consumeIdempotency({
        subject,
        agent,
        tool,
        runId: run?.id,
        idempotencyKey: options.idempotencyKey,
        requestInput: input,
      });

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
      this.support.emitWebhook("tool.call.succeeded", toolCall);
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
      this.support.emitWebhook("tool.call.failed", toolCall);
      if (error instanceof ZodError) throw error;
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
