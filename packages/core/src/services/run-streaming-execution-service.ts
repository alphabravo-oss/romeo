import type { AuthSubject } from "@romeo/auth";
import {
  ProviderCircuitBreaker,
  streamRunEvents,
  type RunEvent,
} from "@romeo/ai-runtime";
import {
  getProviderAdapter,
  type BaseModel,
  ChatMessage,
  ProviderInstance,
  ProviderToolDefinition,
} from "@romeo/providers";

import type { RunRecord } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ActiveRunControllers, terminalRunEvents } from "./run-events";
import type { RunEventSequencer } from "./run-event-sequencer";
import type { RunExecutionStateService } from "./run-execution-state-service";
import type { RunKnowledgeCitation } from "./run-knowledge";
import type { ProviderRoutePlan } from "./provider-routing";
import type { RunServiceOptions } from "./run-service-contracts";
import { routedRunTarget } from "./run-stream-service";
import { modelToolExecutionResult } from "./run-tool-service";
import {
  continueTelemetryContext,
  withTelemetryFetch,
} from "./telemetry-context";

export interface RunStreamingExecutionInput {
  run: RunRecord;
  messages: ChatMessage[];
  provider: ProviderInstance;
  model: BaseModel;
  citations: RunKnowledgeCitation[];
  routePlan: ProviderRoutePlan;
  providerTools: ProviderToolDefinition[];
  subject: AuthSubject;
  assistantContentPrefix?: string;
  emitRunStarted?: boolean;
}

export class RunStreamingExecutionService {
  private readonly activeRuns = new ActiveRunControllers();

  constructor(
    private readonly repository: RomeoRepository,
    private readonly sequencer: RunEventSequencer,
    private readonly executionState: RunExecutionStateService,
    private readonly circuitBreaker: ProviderCircuitBreaker,
    private readonly workerId: string,
    private readonly options: RunServiceOptions,
    private readonly completeRun: (
      run: RunRecord,
      event: RunEvent,
      assistantContent: string,
      model: BaseModel,
      citations: RunKnowledgeCitation[],
    ) => Promise<void>,
  ) {}

  has(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  abort(runId: string): void {
    this.activeRuns.abort(runId);
  }

  async execute(input: RunStreamingExecutionInput): Promise<void> {
    const claimedExecution = await this.executionState.claim(input);
    if (claimedExecution === undefined) return;
    const traceId = claimedExecution.job.payload.traceId;
    const requestId = claimedExecution.job.payload.requestId;
    if (
      typeof traceId === "string" &&
      /^[0-9a-f]{32}$/u.test(traceId) &&
      typeof requestId === "string" &&
      requestId.length > 0 &&
      requestId.length <= 200
    )
      continueTelemetryContext({ traceId, requestId });
    const controller = this.activeRuns.create(input.run.id);
    const adapter = getProviderAdapter(input.provider.type);
    let assistantContent = claimedExecution.checkpoint.assistantContent;
    let executionJob = claimedExecution.job;
    let executionCheckpoint = claimedExecution.checkpoint;
    let executionFinalized = false;
    const heartbeat = setInterval(() => {
      void this.repository
        .renewBackgroundJobLease({
          orgId: input.run.orgId,
          jobId: executionJob.id,
          workerId: this.workerId,
          leaseSeconds: this.leaseSeconds(),
        })
        .then((renewed) => {
          if (renewed !== undefined) executionJob = renewed;
        });
    }, this.heartbeatMs());
    heartbeat.unref?.();
    const providerApiKeys = await this.resolveProviderApiKeys([
      input.provider,
      input.routePlan.fallback?.provider,
    ]);

    try {
      for await (const rawEvent of streamRunEvents({
        adapter,
        provider: input.provider,
        model: input.model,
        ...(input.emitRunStarted === undefined
          ? {}
          : { emitRunStarted: input.emitRunStarted }),
        ...(Object.keys(providerApiKeys).length === 0
          ? {}
          : { providerApiKeys }),
        fetchImpl: withTelemetryFetch(this.options.providerFetch ?? fetch),
        ...(input.providerTools.length === 0
          ? {}
          : { tools: input.providerTools }),
        ...(this.options.modelToolExecutor === undefined
          ? {}
          : {
              maxModelToolCalls: 4,
              modelToolExecutor: async (toolCall) => ({
                ...modelToolExecutionResult(
                  await this.options.modelToolExecutor!({
                    subject: input.subject,
                    runId: input.run.id,
                    toolId: toolCall.name,
                    input: toolCall.arguments,
                    modelToolCallId: toolCall.providerCallId,
                  }),
                ),
              }),
            }),
        runId: input.run.id,
        messages: input.messages,
        ...(this.options.providerStreamTimeoutMs === undefined
          ? {}
          : { providerTimeoutMs: this.options.providerStreamTimeoutMs }),
        ...(input.routePlan.fallback === undefined
          ? {}
          : { providerFallback: input.routePlan.fallback }),
        providerCircuitBreaker: this.circuitBreaker,
        providerDisabled: input.routePlan.primaryDisabled,
        providerRetryPolicy: {
          maxRetries: this.options.providerRetryAttempts ?? 0,
          backoffMs: this.options.providerRetryBackoffMs ?? 0,
        },
        signal: controller.signal,
      })) {
        const event = await this.sequencer.assign(this.repository, rawEvent);
        await this.repository.appendRunEvents([event]);
        if (event.type === "message.delta")
          assistantContent += (event.data as { text: string }).text;
        executionCheckpoint = { ...executionCheckpoint, assistantContent };
        executionJob = await this.executionState.checkpoint(
          executionJob,
          event,
          executionCheckpoint,
        );
        if (event.type === "run.waiting_tool_approval") {
          await this.executionState.markWaiting(input.run);
          await this.executionState.finish(
            executionJob,
            "waiting_tool_approval",
          );
          executionFinalized = true;
          return;
        }
        if (event.type === "run.waiting_tool_dispatch") {
          await this.executionState.markQueued(input.run);
          await this.executionState.finish(
            executionJob,
            "waiting_tool_dispatch",
          );
          executionFinalized = true;
          return;
        }
        if (terminalRunEvents.has(event.type)) {
          const routed = routedRunTarget(
            input.run,
            input.model,
            input.routePlan,
            event,
          );
          await this.completeRun(
            routed.run,
            event,
            assistantContent,
            routed.model,
            input.citations,
          );
          await this.executionState.finish(
            executionJob,
            event.type === "run.completed" ? "completed" : "failed",
          );
          executionFinalized = true;
        }
      }
    } finally {
      clearInterval(heartbeat);
      this.activeRuns.delete(input.run.id);
      void executionFinalized;
    }
  }

  private async resolveProviderApiKeys(
    providers: Array<ProviderInstance | undefined>,
  ): Promise<Record<string, string>> {
    const unique = [
      ...new Map(
        providers
          .filter(
            (provider): provider is ProviderInstance => provider !== undefined,
          )
          .map((provider) => [provider.id, provider]),
      ).values(),
    ];
    const entries = await Promise.all(
      unique.map(async (provider) => {
        if (provider.credentialRef === undefined) return undefined;
        const resolution = await this.options.secretResolver?.resolveValue?.(
          provider.credentialRef,
        );
        return resolution?.available === true
          ? ([provider.id, resolution.value] as const)
          : undefined;
      }),
    );
    return Object.fromEntries(
      entries.filter(
        (entry): entry is readonly [string, string] => entry !== undefined,
      ),
    );
  }

  private leaseSeconds(): number {
    return this.options.runExecutionLeaseSeconds ?? 60;
  }

  private heartbeatMs(): number {
    return Math.max(250, Math.floor((this.leaseSeconds() * 1_000) / 3));
  }
}
