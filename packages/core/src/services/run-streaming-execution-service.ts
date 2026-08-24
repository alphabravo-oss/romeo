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
  type ProviderInstance,
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
import { activeContentPolicyFor } from "./content-policy-service";
import { OutputPolicyBuffer } from "./output-policy-buffer";
import { FileService } from "./file-service";
import {
  ProviderOutputPartError,
  type PersistedOutputPartRef,
} from "./persist-output-parts";
import { storeProviderOutputFile } from "./run-provider-output-file-service";
import {
  authoritativeTerminalPolicyOutcome,
  gateStreamedOutputDelta,
  persistAndEmitOutputParts,
} from "./run-output-policy-gate";
import type { PauseForPolicyApprovalInput } from "./run-policy-approval-lifecycle";
import {
  continueTelemetryContext,
  withTelemetryFetch,
} from "./telemetry-context";
import { resolveRunProviderApiKeys } from "./run-provider-api-keys";
import { governedProviderFetch } from "./provider-secret-egress";
import { persistSafeMessageCompleted } from "./run-message-completion";
import { providerTimeoutFields } from "./run-provider-timeout";

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
      outputParts: PersistedOutputPartRef[],
    ) => Promise<void>,
    outputFiles?: FileService,
    private readonly pauseForPolicyApproval?: (
      input: PauseForPolicyApprovalInput,
    ) => Promise<unknown>,
  ) {
    this.outputFiles = outputFiles ?? new FileService(repository);
  }

  private readonly outputFiles: FileService;

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
    let pendingMessageCompleted: RunEvent | undefined;
    const reasoningSummaryGovernor = new ReasoningSummaryGovernor(
      this.repository,
      input.subject,
    );
    const activePolicy = await activeContentPolicyFor(
      this.repository,
      input.subject.orgId,
    );
    const outputPolicyBuffer = new OutputPolicyBuffer({
      mode: "rolling",
      detectors: activePolicy.detectors,
      failClosed: true,
    });
    const persistedOutputParts: PersistedOutputPartRef[] = [
      ...(claimedExecution.checkpoint.outputParts ?? []),
    ];
    const heartbeat = setInterval(() => {
      void this.repository
        .renewBackgroundJobLease({
          orgId: input.run.orgId,
          jobId: executionJob.id,
          workerId: this.workerId,
          leaseSeconds: this.leaseSeconds(),
        })
        .then((renewed) => {
          if (renewed === undefined) {
            controller.abort();
            return;
          }
          executionJob = renewed;
        })
        .catch(() => {
          controller.abort();
        });
    }, this.heartbeatMs());
    heartbeat.unref?.();
    try {
      // Everything after claiming the job must be inside this cleanup scope.
      // Secret resolution can fail before provider streaming begins.
      const providerApiKeys = await resolveRunProviderApiKeys(
        [input.provider, input.routePlan.fallback?.provider],
        this.options.secretResolver,
      );
      const providerTimeout = providerTimeoutFields(
        this.options.providerStreamTimeoutMs,
        input.model,
      );
      const providerFetch = governedProviderFetch({
        fetchImpl: this.options.providerFetch ?? fetch,
        providerApiKeys,
        providers: [input.provider, input.routePlan.fallback?.provider],
        timeoutMs:
          "providerTimeoutMs" in providerTimeout
            ? providerTimeout.providerTimeoutMs
            : 60_000,
      });
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
        fetchImpl: withTelemetryFetch(providerFetch),
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
        ...providerTimeout,
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
        let outputPartEvents;
        try {
          outputPartEvents = await persistAndEmitOutputParts({
            citations: input.citations,
            event: rawEvent,
            store: (part) =>
              storeProviderOutputFile({
                fileService: this.outputFiles,
                index: persistedOutputParts.length,
                model: input.model,
                part,
                provider: input.provider,
                run: input.run,
                subject: input.subject,
              }),
            persistPart: async (part) => {
              persistedOutputParts.push(part);
            },
          });
        } catch (caught) {
          const failureEvent: RunEvent = {
            ...rawEvent,
            type: "run.failed",
            data: {
              channel: "provider_output",
              errorCode:
                caught instanceof ProviderOutputPartError
                  ? caught.code
                  : "provider_output_persistence_failed",
            },
          };
          const routed = routedRunTarget(
            input.run,
            input.model,
            input.routePlan,
            failureEvent,
          );
          await this.completeRun(
            routed.run,
            failureEvent,
            assistantContent,
            routed.model,
            input.citations,
            input.subject,
            persistedOutputParts,
          );
          await this.executionState.finish(executionJob, "failed");
          return;
        }
        if (terminalRunEvents.has(rawEvent.type)) {
          for (const partEvent of outputPartEvents) {
            const ready = await this.sequencer.assign(this.repository, {
              ...rawEvent,
              data: partEvent.partRef,
              type: "output.part.ready",
            });
            await this.sequencer.append(this.repository, [ready]);
          }
          const terminalPolicy = outputPolicyBuffer.finish();
          if (
            terminalPolicy.action === "block" &&
            activePolicy.approvalRequired &&
            this.pauseForPolicyApproval !== undefined
          ) {
            await this.pauseForPolicyApproval({
              run: input.run,
              executionJob,
              checkpoint: {
                ...executionCheckpoint,
                assistantContent,
                outputParts: [...persistedOutputParts],
              },
              policyVersionId: activePolicy.versionId,
              approvalTtlSeconds: activePolicy.approvalTtlSeconds,
              detectors: terminalPolicy.detectors.map((code) => ({
                code,
                count: 1,
                action: "block" as const,
              })),
            });
            return;
          }
          const terminal = authoritativeTerminalPolicyOutcome({
            policy: terminalPolicy,
            providerEvent: rawEvent,
          });
          assistantContent += terminal.assistantText;
          if (
            terminal.executionOutcome === "completed" &&
            pendingMessageCompleted !== undefined
          ) {
            await persistSafeMessageCompleted({
              repository: this.repository,
              sequencer: this.sequencer,
              event: pendingMessageCompleted,
              content: assistantContent,
            });
          }
          const routed = routedRunTarget(
            input.run,
            input.model,
            input.routePlan,
            terminal.terminalEvent,
          );
          await this.completeRun(
            routed.run,
            terminal.terminalEvent,
            assistantContent,
            routed.model,
            input.citations,
            input.subject,
            persistedOutputParts,
          );
          await this.executionState.finish(
            executionJob,
            terminal.executionOutcome,
          );
          return;
        }
        const governedEvents = await reasoningSummaryGovernor.consume(rawEvent);
        for (const governedEvent of [
          ...governedEvents,
          ...outputPartEvents.map((partEvent) => ({
            ...rawEvent,
            type: "output.part.ready" as const,
            data: partEvent.partRef,
          })),
        ]) {
          if (governedEvent.type === "message.completed") {
            pendingMessageCompleted = governedEvent;
            continue;
          }
          if (governedEvent.type === "message.delta") {
            const gated = gateStreamedOutputDelta({
              buffer: outputPolicyBuffer,
              text: (governedEvent.data as { text: string }).text,
              approvalRequired:
                activePolicy.approvalRequired &&
                this.pauseForPolicyApproval !== undefined,
            });
            if (gated.outcome === "hold") continue;
            if (gated.outcome === "block") {
              const failureEvent: RunEvent = {
                ...governedEvent,
                type: "run.failed",
                data: {
                  channel: "content_policy",
                  errorCode: gated.code,
                },
              };
              const routed = routedRunTarget(
                input.run,
                input.model,
                input.routePlan,
                failureEvent,
              );
              await this.completeRun(
                routed.run,
                failureEvent,
                assistantContent,
                routed.model,
                input.citations,
                input.subject,
                persistedOutputParts,
              );
              await this.executionState.finish(executionJob, "failed");
              return;
            }
            if (gated.outcome === "pause") {
              await this.pauseForPolicyApproval!({
                run: input.run,
                executionJob,
                checkpoint: {
                  ...executionCheckpoint,
                  assistantContent,
                  outputParts: [...persistedOutputParts],
                },
                policyVersionId: activePolicy.versionId,
                approvalTtlSeconds: activePolicy.approvalTtlSeconds,
                detectors: gated.detectors.map((code) => ({
                  code,
                  count: 1,
                  action: "block" as const,
                })),
              });
              return;
            }
            assistantContent += gated.text;
            governedEvent.data = { text: gated.text };
          }
          const event = await this.sequencer.assign(
            this.repository,
            governedEvent,
          );
          executionCheckpoint = {
            ...executionCheckpoint,
            assistantContent,
            outputParts: [...persistedOutputParts],
          };
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
    }
  }

  private leaseSeconds(): number {
    return this.options.runExecutionLeaseSeconds ?? 60;
  }

  private heartbeatMs(): number {
    return Math.max(250, Math.floor((this.leaseSeconds() * 1_000) / 3));
  }
}
