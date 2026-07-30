import { assertScope, type AuthSubject } from "@romeo/auth";
import { ProviderCircuitBreaker, type RunEvent } from "@romeo/ai-runtime";
import { type BaseModel } from "@romeo/providers";
import {
  disabledObjectStore,
  MemoryObjectStore,
  type ObjectStore,
} from "@romeo/storage";

import type {
  RunRecord,
  ToolOperationDispatchReadbackResponse,
} from "../domain/entities";
import {
  getRomeoRepositoryRuntime,
  type RomeoRepository,
} from "../domain/repository";
import { createId } from "../ids";
import { replayRunEvents, terminalRunEvents } from "./run-events";
import type { RunEventSequencer } from "./run-event-sequencer";
import { type QueuedChatTurn } from "./run-command-service";
import { type RunToolDispatchWait } from "./run-tool-service";
import {
  RunContextInspectionService,
  type RunContextInspectionInput,
} from "./run-context-inspection-service";
import { type RunKnowledgeCitation } from "./run-knowledge";
import { recordUsage } from "./record-usage";
import {
  createProviderRoutingPolicy,
  type ProviderRoutingPolicy,
} from "./provider-routing";
import {
  summarizeProviderOperations,
  type ProviderOperationalSummary,
} from "./provider-operational-summary";
import type { WebhookEmitter } from "./webhook-service";
import type {
  DeferredRunStart,
  RunServiceOptions,
  StartRunInput,
} from "./run-service-contracts";
import { RunStartService } from "./run-start-service";
import { RunQueueService } from "./run-queue-service";
import { RunRecoveryCoordinator } from "./run-recovery-coordinator";
import { RunExecutionStateService } from "./run-execution-state-service";
import { RunStreamingExecutionService } from "./run-streaming-execution-service";
import { RunContinuationContextBuilder } from "./run-continuation-context";
import { RunAccessService } from "./run-access-service";
import { RunTerminalService } from "./run-terminal-service";
import { RunContinuationService } from "./run-continuation-service";

export type {
  DeferredRunStart,
  RunServiceOptions,
  StartRunInput,
} from "./run-service-contracts";

export class RunService {
  private readonly providerCircuitBreaker: ProviderCircuitBreaker;
  private readonly providerRoutingPolicy: ProviderRoutingPolicy;
  private readonly runWorkerId = createId("run_worker");
  private readonly executionCheckpointStore: ObjectStore;
  private readonly contextInspection: RunContextInspectionService;
  private readonly runStart: RunStartService;
  private readonly runQueue: RunQueueService;
  private readonly recovery: RunRecoveryCoordinator;
  private readonly executionState: RunExecutionStateService;
  private readonly streamingExecution: RunStreamingExecutionService;
  private readonly continuationContext: RunContinuationContextBuilder;
  private readonly access: RunAccessService;
  private readonly terminal: RunTerminalService;
  private readonly continuation: RunContinuationService;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly runEventSequencer: RunEventSequencer,
    private readonly webhooks?: WebhookEmitter,
    private readonly embeddingFetch?: typeof fetch,
    private readonly objectStore: ObjectStore = disabledObjectStore,
    private readonly options: RunServiceOptions = {},
  ) {
    this.access = new RunAccessService(repository);
    this.executionCheckpointStore = getRomeoRepositoryRuntime(repository)
      .durable
      ? objectStore
      : objectStore === disabledObjectStore
        ? new MemoryObjectStore()
        : objectStore;
    this.executionState = new RunExecutionStateService(
      repository,
      runEventSequencer,
      this.executionCheckpointStore,
      this.runWorkerId,
      this.runExecutionLeaseSeconds(),
    );
    this.contextInspection = new RunContextInspectionService(
      repository,
      objectStore,
      embeddingFetch,
      options,
    );
    this.continuationContext = new RunContinuationContextBuilder(
      repository,
      embeddingFetch,
      options,
    );
    this.providerCircuitBreaker = new ProviderCircuitBreaker({
      failureThreshold: options.providerCircuitFailureThreshold ?? 0,
      cooldownMs: options.providerCircuitCooldownMs ?? 0,
    });
    this.providerRoutingPolicy = createProviderRoutingPolicy({
      disabledProviderIds: options.providerDisabledIds,
      fallbackModelId: options.providerFallbackModelId,
    });
    this.streamingExecution = new RunStreamingExecutionService(
      repository,
      runEventSequencer,
      this.executionState,
      this.providerCircuitBreaker,
      this.runWorkerId,
      options,
      (run, event, assistantContent, model, citations) =>
        this.terminal.complete(run, event, assistantContent, model, citations),
    );
    this.runStart = new RunStartService(
      repository,
      runEventSequencer,
      this.providerRoutingPolicy,
      objectStore,
      webhooks,
      embeddingFetch,
      options,
      (prepared, run) => {
        void this.execute({
          run,
          messages: prepared.messages,
          provider: prepared.provider,
          model: prepared.model,
          citations: prepared.citations,
          routePlan: prepared.routePlan,
          providerTools: prepared.providerTools,
          subject: prepared.input.subject,
        });
      },
    );
    this.runQueue = new RunQueueService(
      repository,
      (chatId) => this.recoverStaleRun(chatId),
      (input) => this.runStart.start(input),
      (input) => this.access.subjectFromSnapshot(input),
    );
    this.terminal = new RunTerminalService(
      repository,
      runEventSequencer,
      this.access,
      webhooks,
      options,
      (runId) => this.streamingExecution.abort(runId),
      (chatId) => void this.runQueue.drain(chatId),
    );
    this.continuation = new RunContinuationService(
      repository,
      runEventSequencer,
      this.access,
      this.executionState,
      this.continuationContext,
      this.providerRoutingPolicy,
      options,
      (input) => void this.streamingExecution.execute(input),
    );
    this.recovery = new RunRecoveryCoordinator(
      repository,
      this.providerRoutingPolicy,
      this.runWorkerId,
      options,
      {
        active: (runId) => this.streamingExecution.has(runId),
        drainQueue: (chatId) => void this.runQueue.drain(chatId),
        drainTerminalOutbox: (orgId) => void this.terminal.drain(orgId),
        execute: (input) => void this.streamingExecution.execute(input),
        finishExecution: (job, outcome) =>
          this.executionState.finish(job, outcome),
        persistTerminal: (input) => this.terminal.persist(input),
        readCheckpoint: (job) => this.executionState.readCheckpoint(job),
        subjectFromSnapshot: (input) => this.access.subjectFromSnapshot(input),
      },
    );
  }

  startTerminalOutboxWorker(intervalMs = 1_000): void {
    this.terminal.startWorker(intervalMs);
  }

  stopTerminalOutboxWorker(): void {
    this.terminal.stopWorker();
  }

  runTerminalOutboxOnce(): Promise<number> {
    return this.terminal.runOnce();
  }
  inspectContext(input: RunContextInspectionInput) {
    return this.contextInspection.inspect(input);
  }
  start(input: StartRunInput): Promise<RunRecord> {
    return this.runStart.start(input);
  }

  startDeferred(
    repository: RomeoRepository,
    input: StartRunInput,
  ): Promise<DeferredRunStart> {
    return this.runStart.startDeferred(repository, input);
  }
  async get(runId: string, subject: AuthSubject): Promise<RunRecord> {
    const run = await this.access.getAuthorizedRun(runId, subject, "runs:read");
    return run;
  }

  activeForChat(
    chatId: string,
    subject: AuthSubject,
  ): Promise<RunRecord | undefined> {
    return this.runQueue.activeForChat(chatId, subject);
  }

  queuedForChat(
    chatId: string,
    subject: AuthSubject,
  ): Promise<QueuedChatTurn[]> {
    return this.runQueue.queuedForChat(chatId, subject);
  }

  enqueueTurn(
    input: Omit<
      StartRunInput,
      "attachments" | "fileIds" | "historyBoundaryMessageId"
    > & { idempotencyKey?: string },
  ): Promise<QueuedChatTurn> {
    return this.runQueue.enqueue(input);
  }

  cancelQueuedTurn(
    chatId: string,
    turnId: string,
    subject: AuthSubject,
  ): Promise<QueuedChatTurn> {
    return this.runQueue.cancel(chatId, turnId, subject);
  }
  providerOperationalSummary(
    subject: AuthSubject,
  ): Promise<ProviderOperationalSummary> {
    assertScope(subject, "admin:read");
    return summarizeProviderOperations({
      circuitBreaker: this.providerCircuitBreaker,
      options: this.options,
      orgId: subject.orgId,
      repository: this.repository,
      routingPolicy: this.providerRoutingPolicy,
    });
  }

  cancel(runId: string, subject: AuthSubject): Promise<RunRecord> {
    return this.terminal.cancel(runId, subject);
  }
  async *events(
    runId: string,
    subject: AuthSubject,
    afterSequence = 0,
  ): AsyncIterable<RunEvent> {
    const run = await this.access.getAuthorizedRun(runId, subject, "runs:read");
    await this.recoverStaleRun(run.chatId);
    await recordUsage(this.repository, {
      orgId: run.orgId,
      workspaceId: run.workspaceId,
      actorId: run.createdBy,
      sourceType: "run",
      sourceId: run.id,
      metric: afterSequence > 0 ? "sse.reconnect" : "sse.connection",
      quantity: 1,
      unit: "connection",
      metadata: {
        chatId: run.chatId,
        ...(afterSequence > 0 ? { afterSequence } : {}),
      },
    });
    let terminalSeen = false;
    try {
      for await (const event of replayRunEvents(
        this.repository,
        runId,
        afterSequence,
      )) {
        if (terminalRunEvents.has(event.type)) terminalSeen = true;
        yield event;
      }
    } finally {
      if (!terminalSeen) {
        await recordUsage(this.repository, {
          orgId: run.orgId,
          workspaceId: run.workspaceId,
          actorId: run.createdBy,
          sourceType: "run",
          sourceId: run.id,
          metric: "sse.disconnect",
          quantity: 1,
          unit: "disconnect",
          metadata: { chatId: run.chatId, afterSequence },
        });
      }
    }
  }

  resumeAfterApprovedTool(input: {
    subject: AuthSubject;
    runId: string;
    toolId: string;
    toolInput: unknown;
    toolResult: unknown;
    approvalRequestId: string;
  }): Promise<RunRecord> {
    return this.continuation.resumeAfterApprovedTool(input);
  }

  waitForDispatchRequest(input: {
    dispatch: RunToolDispatchWait;
    runId: string;
    subject: AuthSubject;
    toolId: string;
  }): Promise<RunRecord> {
    return this.continuation.waitForDispatchRequest(input);
  }

  resumeAfterDispatchRequestReadback(input: {
    errorCode?: string;
    jobId: string;
    response?: ToolOperationDispatchReadbackResponse;
    subject: AuthSubject;
  }): Promise<RunRecord | undefined> {
    return this.continuation.resumeAfterDispatchRequestReadback(input);
  }
  private execute(
    input: Parameters<RunStreamingExecutionService["execute"]>[0],
  ): Promise<void> {
    return this.streamingExecution.execute(input);
  }
  private completeRun(
    run: RunRecord,
    event: RunEvent,
    assistantContent: string,
    model: BaseModel,
    citations: RunKnowledgeCitation[],
  ): Promise<void> {
    return this.terminal.complete(
      run,
      event,
      assistantContent,
      model,
      citations,
    );
  }
  private recoverStaleRun(chatId: string): Promise<void> {
    return this.recovery.recover(chatId);
  }
  private runExecutionLeaseSeconds(): number {
    return this.options.runExecutionLeaseSeconds ?? 60;
  }
}
