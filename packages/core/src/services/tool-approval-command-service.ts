import {
  AuthorizationError,
  assertScope,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import type { RunEvent } from "@romeo/ai-runtime";

import type { BackgroundJob } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { writeAuditLog } from "./audit-log";
import type { RunEventSequencer } from "./run-event-sequencer";
import type {
  ToolApprovalDecisionResult,
  ToolApprovalDecisionStatus,
} from "./tool-service-contracts";
import {
  isUniqueConstraintError,
  operationApprovalConsumed,
  operationApprovalDecision,
  operationApprovalExpired,
  optionalStringProperty,
  stringArrayPayload,
  stringPayload,
  stringPayloadOptional,
  toolApprovalAuditAction,
  toolApprovalConsumed,
  toolApprovalDecision,
  toolApprovalDecisionActorKey,
  toolApprovalDecisionErrorCode,
  toolApprovalDecisionFromJob,
  toolApprovalDecisionJob,
  toolApprovalDecisionTimestampKey,
  toolApprovalDecisionTimestampProperty,
  toolApprovalExpired,
  toolOperationApprovalAuditAction,
  toolOperationApprovalDecisionErrorCode,
} from "./tool-service-helpers";

export class ToolApprovalCommandService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly runEventSequencer: RunEventSequencer,
  ) {}

  async decide(
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
        return this.decideOperation(
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
      const events = await this.repository.transaction<RunEvent[]>(
        async (repository) => {
          const currentJobs = await repository.listBackgroundJobs(
            subject.orgId,
          );
          const currentDecision = toolApprovalDecision(
            approvalRequest,
            currentJobs,
          );
          if (currentDecision !== undefined) {
            if (currentDecision.status === decision) return [];
            throw new ApiError(
              "tool_approval_request_already_decided",
              "Tool approval request already has a terminal decision.",
              409,
              { approvalRequestId, status: currentDecision.status },
            );
          }
          if (currentJobs.some((job) => job.id === decisionJob.id)) return [];
          const events: RunEvent[] = [];
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
              const errorCode = toolApprovalDecisionErrorCode(decision);
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
                    errorCode,
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
                    reason: errorCode,
                    agentId: approvalRequest.agentId,
                    toolId: approvalRequest.toolId,
                    approvalRequestId: approvalRequest.id,
                  },
                },
              );
              await this.runEventSequencer.persist(repository, [
                failedEvent,
                cancelledEvent,
              ]);
              events.push(failedEvent, cancelledEvent);
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
          return events;
        },
      );
      await this.runEventSequencer.notify(events);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
    return toolApprovalDecisionFromJob(decisionJob);
  }

  private async decideOperation(
    subject: AuthSubject,
    approvalRequest: BackgroundJob,
    decision: ToolApprovalDecisionStatus,
  ): Promise<ToolApprovalDecisionResult> {
    const workspaceId = stringPayloadOptional(
      approvalRequest.payload,
      "workspaceId",
    );
    if (workspaceId !== undefined && !hasWorkspaceAccess(subject, workspaceId))
      throw new AuthorizationError(
        "The tool approval request is outside the caller workspace access.",
      );
    if (approvalRequest.payload.actorId !== subject.id)
      throw new AuthorizationError(
        "The tool approval request is owned by another principal.",
      );
    const existingDecision = operationApprovalDecision(approvalRequest);
    if (existingDecision !== undefined) {
      if (existingDecision === decision)
        return this.operationDecisionResult(approvalRequest);
      throw new ApiError(
        "tool_operation_approval_request_already_decided",
        "Tool operation approval request already has a terminal decision.",
        409,
        { approvalRequestId: approvalRequest.id, status: existingDecision },
      );
    }
    if (operationApprovalExpired(approvalRequest))
      throw new ApiError(
        "tool_operation_approval_request_expired",
        "Tool operation approval request has expired.",
        409,
        { approvalRequestId: approvalRequest.id },
      );
    if (operationApprovalConsumed(approvalRequest))
      throw new ApiError(
        "tool_operation_approval_request_consumed",
        "Tool operation approval request was already consumed.",
        409,
        { approvalRequestId: approvalRequest.id },
      );

    const now = new Date().toISOString();
    const updated = await this.repository.transaction(async (repository) => {
      const existing = (
        await repository.listBackgroundJobs(subject.orgId)
      ).find((job) => job.id === approvalRequest.id);
      if (existing === undefined) return approvalRequest;
      if (operationApprovalDecision(existing) !== undefined) return existing;
      const saved = await repository.updateBackgroundJob({
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
      return saved;
    });
    return this.operationDecisionResult(updated);
  }

  private operationDecisionResult(
    job: BackgroundJob,
  ): ToolApprovalDecisionResult {
    const payload = job.payload;
    const status = operationApprovalDecision(job) ?? "rejected";
    const decidedAt = stringPayload(
      payload,
      toolApprovalDecisionTimestampKey(status),
    );
    const toolId =
      stringPayloadOptional(payload, "toolId") ??
      `operation:${stringPayload(payload, "connectorId")}:${stringPayload(
        payload,
        "operationId",
      )}`;
    return {
      approvalRequestId: job.id,
      decidedAt,
      status,
      toolId,
      ...toolApprovalDecisionTimestampProperty(status, decidedAt),
      ...optionalStringProperty(payload, "agentId"),
      ...optionalStringProperty(payload, "runId"),
      ...optionalStringProperty(payload, "workspaceId"),
    };
  }
}
