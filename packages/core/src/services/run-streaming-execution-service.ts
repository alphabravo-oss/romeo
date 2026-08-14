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
  type ProviderReasoningParameters,
  type ProviderReasoningPolicyLayers,
  type ProviderSampling,
  type ProviderStructuredOutput,
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
import { reasoningPolicyLayersAtDispatch } from "./run-reasoning-policy";
import { ReasoningSummaryGovernor } from "./run-reasoning-summary-policy";
import {
  contentPolicyActionsFor,
} from "./content-policy-service";
import { OutputPolicyBuffer } from "./output-policy-buffer";
import {
  gateStreamedOutputDelta,
  persistAndEmitOutputParts,
} from "./run-output-policy-gate";
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
  sampling?: ProviderSampling;
  reasoning?: ProviderReasoningParameters;
  reasoningPolicy?: ProviderReasoningPolicyLayers;
  structuredOutput?: ProviderStructuredOutput;
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
      subject: AuthSubject,
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
    const reasoningSummaryGovernor = new ReasoningSummaryGovernor(
      this.repository,
      input.subject,
    );
    const outputPolicyBuffer = new OutputPolicyBuffer({
      mode: "rolling",
      detectors: await contentPolicyActionsFor(
        this.repository,
        input.subject.orgId,
      ),
      failClosed: true,
    });
    const persistedOutputParts: Array<{ type: string; fileId?: string }> = [];
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
    try {
      // Everything after claiming the job must be inside this cleanup scope.
      // Secret resolution can fail before provider streaming begins.
      const providerApiKeys = await this.resolveProviderApiKeys([
        input.provider,
        input.routePlan.fallback?.provider,
      ]);
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
        ...(input.sampling === undefined ? {} : { sampling: input.sampling }),
        ...(input.reasoning === undefined
          ? {}
          : { reasoning: input.reasoning }),
        ...(input.reasoningPolicy === undefined
          ? {}
          : {
              reasoningPolicy: input.reasoningPolicy,
              reasoningPolicyResolver: () =>
                reasoningPolicyLayersAtDispatch(
                  this.repository,
                  input.run,
                  input.reasoningPolicy!,
                  this.options.capabilityPlatformPolicy,
                ),
            }),
        ...(input.structuredOutput === undefined
          ? {}
          : { structuredOutput: input.structuredOutput }),
        ...providerTimeoutFields(
          this.options.providerStreamTimeoutMs,
          input.model,
        ),
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
        if (terminalRunEvents.has(rawEvent.type)) {
          const flushed = outputPolicyBuffer.finish();
          if (flushed.action === "release") assistantContent += flushed.text;
          const routed = routedRunTarget(
            input.run,
            input.model,
            input.routePlan,
            rawEvent,
          );
          await this.completeRun(
            routed.run,
            rawEvent,
            assistantContent,
            routed.model,
            input.citations,
            input.subject,
          );
          await this.executionState.finish(
            executionJob,
            rawEvent.type === "run.completed" && flushed.action !== "block"
              ? "completed"
              : "failed",
          );
          executionFinalized = true;
          return;
        }
        const outputPartEvents = await persistAndEmitOutputParts({
          event: rawEvent,
          store: async () => ({ fileId: `file_${input.run.id}_${persistedOutputParts.length}` }),
          persistPart: async (part) => {
            persistedOutputParts.push(part);
          },
        });
        const governedEvents = await reasoningSummaryGovernor.consume(rawEvent);
        for (const governedEvent of [
          ...governedEvents,
          ...outputPartEvents.map((partEvent) => ({
            ...rawEvent,
            type: "output.part.ready" as const,
            data: partEvent.partRef,
          })),
        ]) {
          if (governedEvent.type === "message.delta") {
            const gated = gateStreamedOutputDelta({
              buffer: outputPolicyBuffer,
              text: (governedEvent.data as { text: string }).text,
            });
            if (gated.outcome === "hold") continue;
            if (gated.outcome === "block" || gated.outcome === "pause") {
              const blocked = await this.sequencer.assign(this.repository, {
                ...governedEvent,
                type: gated.outcome === "pause"
                  ? "run.waiting_tool_approval"
                  : "run.failed",
                data: {
                  code: gated.code,
                  channel: "content_policy",
                },
              });
              if (gated.outcome === "pause")
                await this.executionState.markWaiting(input.run);
              await this.sequencer.append(this.repository, [blocked]);
              await this.executionState.finish(
                executionJob,
                gated.outcome === "pause" ? "waiting_tool_approval" : "failed",
              );
              executionFinalized = true;
              return;
            }
            assistantContent += gated.text;
            governedEvent.data = { text: gated.text };
          }
          const event = await this.sequencer.assign(
            this.repository,
            governedEvent,
          );
          executionCheckpoint = { ...executionCheckpoint, assistantContent };
          if (
            event.type === "run.waiting_tool_approval" ||
            event.type === "run.waiting_tool_dispatch"
          ) {
            if (event.type === "run.waiting_tool_approval") {
              await this.executionState.markWaiting(input.run);
            } else {
              await this.executionState.markQueued(input.run);
            }
            executionJob = await this.executionState.checkpoint(
              executionJob,
              event,
              executionCheckpoint,
            );
            await this.executionState.finish(
              executionJob,
              event.type === "run.waiting_tool_approval"
                ? "waiting_tool_approval"
                : "waiting_tool_dispatch",
            );
            executionFinalized = true;
            clearInterval(heartbeat);
            this.activeRuns.delete(input.run.id);
            await this.sequencer.append(this.repository, [event]);
            return;
          }
          await this.sequencer.append(this.repository, [event]);
          executionJob = await this.executionState.checkpoint(
            executionJob,
            event,
            executionCheckpoint,
          );
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

const REASONING_STREAM_TIMEOUT_FLOOR_MS = 180_000;

function providerTimeoutFields(
  configuredMs: number | undefined,
  model: BaseModel,
): { providerTimeoutMs: number } | Record<string, never> {
  if (configuredMs === undefined) return {};
  return {
    providerTimeoutMs:
      model.capabilities.reasoning === true
        ? Math.max(configuredMs, REASONING_STREAM_TIMEOUT_FLOOR_MS)
        : configuredMs,
  };
}
