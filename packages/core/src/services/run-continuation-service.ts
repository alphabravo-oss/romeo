import { AuthorizationError, type AuthSubject } from "@romeo/auth";

import type {
  BackgroundJob,
  RunRecord,
  ToolOperationDispatchReadbackResponse,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { buildProviderToolDefinitions } from "./provider-tool-schemas";
import {
  createProviderRoutePlan,
  type ProviderRoutingPolicy,
} from "./provider-routing";
import type { RunAccessService } from "./run-access-service";
import type { RunContinuationContextBuilder } from "./run-continuation-context";
import type { RunEventSequencer } from "./run-event-sequencer";
import type { RunExecutionStateService } from "./run-execution-state-service";
import { isTerminalRunStatus, runWithStatus } from "./run-recovery-service";
import type { RunServiceOptions } from "./run-service-contracts";
import type { RunStreamingExecutionInput } from "./run-streaming-execution-service";
import {
  dispatchRunContext,
  dispatchWaitEventData,
  subjectFromDispatchJob,
  type RunToolDispatchWait,
} from "./run-tool-service";

export class RunContinuationService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly sequencer: RunEventSequencer,
    private readonly access: RunAccessService,
    private readonly executionState: RunExecutionStateService,
    private readonly contextBuilder: RunContinuationContextBuilder,
    private readonly routingPolicy: ProviderRoutingPolicy,
    private readonly options: RunServiceOptions,
    private readonly execute: (input: RunStreamingExecutionInput) => void,
  ) {}

  async resumeAfterApprovedTool(input: {
    subject: AuthSubject;
    runId: string;
    toolId: string;
    toolInput: unknown;
    toolResult: unknown;
    approvalRequestId: string;
  }): Promise<RunRecord> {
    const run = await this.access.getAuthorizedRun(
      input.runId,
      input.subject,
      "runs:read",
    );
    if (run.status !== "waiting_tool_approval") return run;
    const [model, provider, agentVersion] = await Promise.all([
      this.repository.getModel(run.modelId),
      this.repository.getProvider(run.providerId),
      this.repository.getAgentVersion(run.agentVersionId),
    ]);
    if (model === undefined) throw notFound("Model");
    if (provider === undefined) throw notFound("Provider");
    if (agentVersion === undefined) throw notFound("Agent version");
    const routePlan = await createProviderRoutePlan(
      this.repository,
      this.routingPolicy,
      { model, provider },
    );
    const providerTools = await this.providerTools(input.subject, run);
    const resumeContext = await this.contextBuilder.buildApproval({
      agentVersion,
      approvalRequestId: input.approvalRequestId,
      model,
      routePlan,
      run,
      subject: input.subject,
      toolId: input.toolId,
      toolInput: input.toolInput,
      toolResult: input.toolResult,
    });
    const runningRun = await this.executionState.markContinuing(run, {
      reason: "tool_approval",
      toolId: input.toolId,
      approvalRequestId: input.approvalRequestId,
    });
    this.execute({
      run: runningRun,
      messages: resumeContext.messages,
      provider,
      model,
      citations: resumeContext.citations,
      routePlan,
      providerTools,
      subject: input.subject,
      assistantContentPrefix: resumeContext.assistantContentPrefix,
      emitRunStarted: false,
    });
    return runningRun;
  }

  async waitForDispatchRequest(input: {
    dispatch: RunToolDispatchWait;
    runId: string;
    subject: AuthSubject;
    toolId: string;
  }): Promise<RunRecord> {
    const run = await this.access.getAuthorizedRun(
      input.runId,
      input.subject,
      "runs:read",
    );
    if (isTerminalRunStatus(run.status)) return run;
    const job = await this.getDispatchRequestJob(
      input.subject.orgId,
      input.dispatch.jobId,
    );
    const context = dispatchRunContext(job);
    if (
      context === undefined ||
      context.runId !== run.id ||
      context.toolId !== input.toolId
    )
      throw new ApiError(
        "tool_dispatch_run_context_invalid",
        "Tool dispatch request is not linked to this run.",
        409,
        { jobId: input.dispatch.jobId, runId: run.id },
      );
    const existingWait = (await this.repository.listRunEvents(run.id)).some(
      (event) =>
        event.type === "run.waiting_tool_dispatch" &&
        (event.data as { jobId?: unknown }).jobId === input.dispatch.jobId,
    );
    const queued = await this.repository.updateRun(
      runWithStatus(run, "queued"),
    );
    if (!existingWait) {
      const event = await this.sequencer.create(this.repository, {
        runId: run.id,
        type: "run.waiting_tool_dispatch",
        data: dispatchWaitEventData(job, input.dispatch, input.toolId),
      });
      await this.repository.appendRunEvents([event]);
    }
    return queued;
  }

  async resumeAfterDispatchRequestReadback(input: {
    errorCode?: string;
    jobId: string;
    response?: ToolOperationDispatchReadbackResponse;
    subject: AuthSubject;
  }): Promise<RunRecord | undefined> {
    const job = await this.getDispatchRequestJob(
      input.subject.orgId,
      input.jobId,
    );
    const context = dispatchRunContext(job);
    if (context === undefined) return undefined;
    const run = await this.repository.getRun(context.runId);
    if (run === undefined) return undefined;
    if (run.orgId !== input.subject.orgId)
      throw new AuthorizationError(
        "The dispatch request is outside the caller organization.",
      );
    if (run.status !== "queued") return run;
    const [model, provider, agentVersion] = await Promise.all([
      this.repository.getModel(run.modelId),
      this.repository.getProvider(run.providerId),
      this.repository.getAgentVersion(run.agentVersionId),
    ]);
    if (model === undefined) throw notFound("Model");
    if (provider === undefined) throw notFound("Provider");
    if (agentVersion === undefined) throw notFound("Agent version");
    const runSubject = subjectFromDispatchJob(job, run);
    const routePlan = await createProviderRoutePlan(
      this.repository,
      this.routingPolicy,
      { model, provider },
    );
    const providerTools = await this.providerTools(runSubject, run);
    const resumeContext = await this.contextBuilder.buildDispatch({
      agentVersion,
      job,
      model,
      routePlan,
      run,
      subject: runSubject,
      ...(input.response === undefined ? {} : { response: input.response }),
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    });
    const runningRun = await this.executionState.markContinuing(run, {
      reason: "tool_dispatch",
      toolId: context.toolId,
      jobId: input.jobId,
      outcome: input.response === undefined ? "failed" : "completed",
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    });
    this.execute({
      run: runningRun,
      messages: resumeContext.messages,
      provider,
      model,
      citations: resumeContext.citations,
      routePlan,
      providerTools,
      subject: runSubject,
      assistantContentPrefix: resumeContext.assistantContentPrefix,
      emitRunStarted: false,
    });
    return runningRun;
  }

  private async providerTools(subject: AuthSubject, run: RunRecord) {
    return buildProviderToolDefinitions(this.repository, subject, run.agentId, {
      externalOperationExecutionEnabled:
        this.options.toolOperationExecutionEnabled === true,
    });
  }

  private async getDispatchRequestJob(
    orgId: string,
    jobId: string,
  ): Promise<BackgroundJob> {
    const job = (await this.repository.listBackgroundJobs(orgId)).find(
      (item) =>
        item.id === jobId && item.type === "tool.operation.dispatch_request",
    );
    if (job === undefined) throw notFound("Tool operation dispatch request");
    return job;
  }
}
