import { assertScope, type AuthSubject } from "@romeo/auth";

import type { ToolCallRecord } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import type { RunEventSequencer } from "./run-event-sequencer";
import { type AgentToolSummary, type ToolSummary } from "./tool-execution";
import type { WebhookEmitter } from "./webhook-service";
import { BuiltInToolExecutionService } from "./built-in-tool-execution-service";
import { OperationToolExecutionService } from "./operation-tool-execution-service";
import { ToolApprovalCommandService } from "./tool-approval-command-service";
import { ToolApprovalQueryService } from "./tool-approval-query-service";
import { ToolCatalogService } from "./tool-catalog-service";
import { ToolExecutionSupport } from "./tool-execution-support";
import type {
  ToolApprovalDecisionResult,
  ToolApprovalRequestSummary,
  ToolServiceOptions,
} from "./tool-service-contracts";
import { assertRunToolExecutionAllowed } from "./tool-service-helpers";

export type {
  ToolApprovalDecisionResult,
  ToolApprovalRequestSummary,
} from "./tool-service-contracts";

export class ToolService {
  private readonly approvalCommands: ToolApprovalCommandService;
  private readonly approvalQueries: ToolApprovalQueryService;
  private readonly catalog: ToolCatalogService;
  private readonly builtInExecution: BuiltInToolExecutionService;
  private readonly operationExecution: OperationToolExecutionService;
  private readonly executionSupport: ToolExecutionSupport;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly runEventSequencer: RunEventSequencer,
    private readonly webhooks?: WebhookEmitter,
    private readonly options: ToolServiceOptions = {},
  ) {
    this.catalog = new ToolCatalogService(repository);
    this.approvalCommands = new ToolApprovalCommandService(
      repository,
      runEventSequencer,
    );
    this.approvalQueries = new ToolApprovalQueryService(
      repository,
      this.catalog,
    );
    this.executionSupport = new ToolExecutionSupport(
      repository,
      runEventSequencer,
      webhooks,
      options,
    );
    this.builtInExecution = new BuiltInToolExecutionService(
      repository,
      runEventSequencer,
      this.catalog,
      this.executionSupport,
      webhooks,
      options,
    );
    this.operationExecution = new OperationToolExecutionService(
      repository,
      runEventSequencer,
      this.catalog,
      this.executionSupport,
      webhooks,
      options,
    );
  }

  list(subject: AuthSubject): ToolSummary[] {
    return this.catalog.list(subject);
  }

  listForAgent(
    subject: AuthSubject,
    agentId: string,
  ): Promise<AgentToolSummary[]> {
    return this.catalog.listForAgent(subject, agentId);
  }

  updateBinding(input: {
    subject: AuthSubject;
    agentId: string;
    toolId: string;
    enabled?: boolean;
    approvalRequired?: boolean;
  }): Promise<AgentToolSummary> {
    return this.catalog.updateBinding(input);
  }
  async listCalls(
    subject: AuthSubject,
    agentId?: string,
  ): Promise<ToolCallRecord[]> {
    assertScope(subject, "audit:read");
    if (agentId !== undefined)
      await this.catalog.getAgentForSubject(subject, agentId);
    const calls = await this.repository.listToolCalls(subject.orgId);
    return agentId === undefined
      ? calls
      : calls.filter((call) => call.agentId === agentId);
  }

  async listPendingApprovals(
    subject: AuthSubject,
    input: { agentId?: string; runId?: string } = {},
  ): Promise<ToolApprovalRequestSummary[]> {
    return this.approvalQueries.listPending(subject, input);
  }

  approveApproval(
    subject: AuthSubject,
    approvalRequestId: string,
  ): Promise<ToolApprovalDecisionResult> {
    return this.approvalCommands.decide(subject, approvalRequestId, "approved");
  }

  cancelApproval(
    subject: AuthSubject,
    approvalRequestId: string,
  ): Promise<ToolApprovalDecisionResult> {
    return this.approvalCommands.decide(
      subject,
      approvalRequestId,
      "cancelled",
    );
  }

  rejectApproval(
    subject: AuthSubject,
    approvalRequestId: string,
  ): Promise<ToolApprovalDecisionResult> {
    return this.approvalCommands.decide(subject, approvalRequestId, "rejected");
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
    const builtIn = this.catalog.findBuiltIn(toolId);
    if (builtIn !== undefined)
      return this.builtInExecution.execute(subject, builtIn, input, options);
    const operation = await this.catalog.getOperationTool(subject, toolId);
    if (operation !== undefined)
      return this.operationExecution.execute(
        subject,
        operation,
        input,
        options,
      );
    await this.executionSupport.audit(subject, toolId, "failure", {
      agentId: options.agentId,
      errorCode: "not_found",
    });
    throw notFound("Tool");
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
}
