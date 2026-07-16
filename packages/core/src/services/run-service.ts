import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasWorkspaceAccess,
  scopeValues,
  type AuthSubject,
  type Scope,
} from "@romeo/auth";
import {
  type ProviderFallbackSnapshot,
  ProviderCircuitBreaker,
  streamRunEvents,
  type RunEvent,
} from "@romeo/ai-runtime";
import {
  getProviderAdapter,
  type BaseModel,
  type ChatMessage,
  type ProviderInstance,
  type ProviderToolDefinition,
  type ProviderTokenUsage,
} from "@romeo/providers";
import { disabledObjectStore, type ObjectStore } from "@romeo/storage";

import type {
  AgentVersion,
  BackgroundJob,
  Message,
  MessagePart,
  RunRecord,
  ToolOperationDispatchPayloadStoreReference,
  ToolOperationDispatchReadbackResponse,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { canReadChat, canWriteChat } from "./chat-access";
import {
  ActiveRunControllers,
  replayRunEvents,
  terminalRunEvents,
} from "./run-events";
import type { RunEventSequencer } from "./run-event-sequencer";
import { historyMessageLimit } from "./agent-memory";
import {
  buildRunMessages,
  compareChatMessages,
  historyBefore,
  orderChatHistory,
} from "./run-messages";
import { enforceAgentSafetySettings } from "./agent-safety";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { consumeQuota } from "./consume-quota";
import type { QuotaCoordinator } from "./quota-coordination";
import {
  storeMessageAttachments,
  type ChatAttachmentInput,
} from "./message-attachments";
import { resolveRunContext } from "./run-context";
import {
  appendRunCitations,
  buildRunKnowledgeContext,
  type RunKnowledgeCitation,
  type RunKnowledgeSafetySummary,
} from "./run-knowledge";
import { objectKeys } from "./tool-execution";
import { recordRunStartedUsage, recordRunTerminalUsage } from "./run-usage";
import {
  createProviderRoutePlan,
  createProviderRoutingPolicy,
  type ProviderRoutePlan,
  type ProviderRoutingPolicy,
} from "./provider-routing";
import {
  summarizeProviderOperations,
  type ProviderOperationalSummary,
} from "./provider-operational-summary";
import { buildProviderToolDefinitions } from "./provider-tool-schemas";
import type { SecretResolver } from "./secret-resolver";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import {
  isToolDispatchPayloadStoreReference,
  type ToolDispatchPayloadStore,
} from "./tool-dispatch-payload-store";
import type { WebhookEmitter } from "./webhook-service";
import type { KnowledgeVectorStore } from "./knowledge-vector-store";
import { writeAuditLog } from "./audit-log";

export interface RunServiceOptions {
  modelToolExecutor?: (input: {
    subject: AuthSubject;
    runId: string;
    toolId: string;
    input: unknown;
    modelToolCallId: string;
  }) => Promise<unknown>;
  providerDisabledIds?: string;
  providerCircuitCooldownMs?: number;
  providerCircuitFailureThreshold?: number;
  providerFallbackModelId?: string;
  providerRetryAttempts?: number;
  providerRetryBackoffMs?: number;
  providerFetch?: typeof fetch;
  providerStreamTimeoutMs?: number;
  secretResolver?: SecretResolver;
  dispatchPayloadStore?: ToolDispatchPayloadStore;
  knowledgeVectorStore?: KnowledgeVectorStore;
  messageAttachmentMaxBytes?: number;
  quotaCoordinator?: QuotaCoordinator | undefined;
  toolOperationExecutionEnabled?: boolean;
}

export interface RunToolDispatchWait {
  bodyKeys?: string[];
  connectorId: string;
  jobId: string;
  operationId: string;
  parameterKeys?: string[];
  payloadStorage?: DispatchPayloadStorage;
  workerQueue: "external_tool_operations";
}

export interface DeferredRunStart {
  run: RunRecord;
  startExecution(): void;
}

export interface StartRunInput {
  attachments?: ChatAttachmentInput[];
  subject: AuthSubject;
  chatId: string;
  agentId: string;
  content: string;
  modelId?: string;
  // Id of a user message in this chat to cut prior history at, exclusive. Regenerate sets it to the
  // message it is re-running so the pair being replaced is not replayed back to the model. Omit for
  // an ordinary turn to send the chat's full history.
  historyBoundaryMessageId?: string;
}

interface PreparedRunStart {
  agentId: string;
  agentVersionId: string;
  citations: RunKnowledgeCitation[];
  estimatedInputTokens: number;
  historyMessages: number;
  historyTruncated: boolean;
  input: {
    content: string;
    subject: AuthSubject;
  };
  knowledgeHitsDropped: number;
  knowledgeSafety?: RunKnowledgeSafetySummary;
  messageParts: MessagePart[];
  messages: ChatMessage[];
  model: BaseModel;
  provider: ProviderInstance;
  providerTools: ProviderToolDefinition[];
  quotaTarget: {
    model: BaseModel;
    provider: ProviderInstance;
  };
  routePlan: ProviderRoutePlan;
  run: Omit<RunRecord, "createdBy">;
  userMessage: Message;
}

type DispatchPayloadStorage =
  | "external_worker_secret_store_required"
  | "managed_encrypted_object_store";

export class RunService {
  private readonly activeRuns = new ActiveRunControllers();
  private readonly providerCircuitBreaker: ProviderCircuitBreaker;
  private readonly providerRoutingPolicy: ProviderRoutingPolicy;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly runEventSequencer: RunEventSequencer,
    private readonly webhooks?: WebhookEmitter,
    private readonly embeddingFetch?: typeof fetch,
    private readonly objectStore: ObjectStore = disabledObjectStore,
    private readonly options: RunServiceOptions = {},
  ) {
    this.providerCircuitBreaker = new ProviderCircuitBreaker({
      failureThreshold: options.providerCircuitFailureThreshold ?? 0,
      cooldownMs: options.providerCircuitCooldownMs ?? 0,
    });
    this.providerRoutingPolicy = createProviderRoutingPolicy({
      disabledProviderIds: options.providerDisabledIds,
      fallbackModelId: options.providerFallbackModelId,
    });
  }

  async start(input: StartRunInput): Promise<RunRecord> {
    const storedObjectKeys: string[] = [];
    try {
      const prepared = await this.prepareRunStart(this.repository, input, {
        storedObjectKeys,
      });
      const started = await this.repository.transaction((repository) =>
        this.persistPreparedRunStart(repository, prepared),
      );
      started.startExecution();
      return started.run;
    } catch (error) {
      await deleteObjectKeys(this.objectStore, storedObjectKeys);
      throw error;
    }
  }

  async startDeferred(
    repository: RomeoRepository,
    input: StartRunInput,
  ): Promise<DeferredRunStart> {
    const prepared = await this.prepareRunStart(repository, input);
    return this.persistPreparedRunStart(repository, prepared);
  }

  private async prepareRunStart(
    repository: RomeoRepository,
    input: StartRunInput,
    options: { storedObjectKeys?: string[] } = {},
  ): Promise<PreparedRunStart> {
    const { chat, agent, agentVersion, model, provider } =
      await resolveRunContext(repository, input);
    const routePlan = await createProviderRoutePlan(
      repository,
      this.providerRoutingPolicy,
      { model, provider },
    );
    const quotaTarget =
      routePlan.primaryDisabled && routePlan.fallback !== undefined
        ? routePlan.fallback
        : { model, provider };
    enforceAgentSafetySettings(agentVersion.safetySettings, input.content, {
      source: "user_input",
    });
    await assertAbuseControlsAllow(repository, input.subject, {
      action: "run.start",
      agentId: agent.id,
      providerId: quotaTarget.provider.id,
      workspaceId: chat.workspaceId,
    });

    // Read before createMessage below persists this turn, so this is exactly the prior history.
    const chatMessages = await repository.listMessages(chat.id);
    // Regenerate starts the run before deleting the pair it replaces, so that a failed run does not
    // destroy the user's prompt and previous answer. That old pair is therefore still persisted here,
    // and without a boundary the model would be fed its own previous answer plus the same question
    // twice. Cutting at the message being re-run restores the history the original turn saw.
    const history =
      input.historyBoundaryMessageId === undefined
        ? chatMessages
        : historyBefore(
            orderChatHistory(chatMessages),
            input.historyBoundaryMessageId,
          );

    const userMessageId = createId("msg");
    const attachmentParts = await storeMessageAttachments({
      messageId: userMessageId,
      ...(this.options.messageAttachmentMaxBytes === undefined
        ? {}
        : { maxAttachmentBytes: this.options.messageAttachmentMaxBytes }),
      objectStore: this.objectStore,
      ...(options.storedObjectKeys === undefined
        ? {}
        : { storedObjectKeys: options.storedObjectKeys }),
      ...(input.attachments === undefined
        ? {}
        : { attachments: input.attachments }),
    });
    const userMessage: Message = {
      id: userMessageId,
      chatId: chat.id,
      role: "user",
      content: input.content,
      createdAt: new Date().toISOString(),
    };
    const run: Omit<RunRecord, "createdBy"> = {
      id: createId("run"),
      orgId: chat.orgId,
      workspaceId: chat.workspaceId,
      chatId: chat.id,
      agentId: agent.id,
      agentVersionId: agentVersion.id,
      modelId: model.id,
      providerId: provider.id,
      status: "running",
      createdAt: new Date().toISOString(),
    };

    const knowledge = await buildRunKnowledgeContext(repository, {
      agentId: agent.id,
      subject: input.subject,
      query: input.content,
      safetySettings: agentVersion.safetySettings,
      ...(this.embeddingFetch === undefined
        ? {}
        : { fetchImpl: this.embeddingFetch }),
      ...(this.options.knowledgeVectorStore === undefined
        ? {}
        : { vectorStore: this.options.knowledgeVectorStore }),
    });
    const maxHistoryMessages = historyMessageLimit(agentVersion.memoryPolicy);
    const built = buildRunMessages({
      systemPrompt: agentVersion.systemPrompt,
      history,
      userContent: input.content,
      knowledgeHits: knowledge.hits,
      model: routeServingModel(routePlan, model),
      ...(maxHistoryMessages === undefined ? {} : { maxHistoryMessages }),
    });
    const providerTools = await buildProviderToolDefinitions(
      repository,
      input.subject,
      agent.id,
      {
        externalOperationExecutionEnabled:
          this.options.toolOperationExecutionEnabled === true,
      },
    );
    return {
      agentId: agent.id,
      agentVersionId: agentVersion.id,
      // The shed-aware citations: the budget may drop hits the raw retrieval returned.
      citations: built.citations,
      estimatedInputTokens: built.estimatedInputTokens,
      historyMessages: built.historyMessages,
      historyTruncated: built.historyTruncated,
      input: { content: input.content, subject: input.subject },
      knowledgeHitsDropped: built.knowledgeHitsDropped,
      ...(knowledge.safety === undefined
        ? {}
        : { knowledgeSafety: knowledge.safety }),
      messageParts: attachmentParts,
      messages: built.messages,
      model,
      provider,
      providerTools,
      quotaTarget,
      routePlan,
      run,
      userMessage,
    };
  }

  private async persistPreparedRunStart(
    repository: RomeoRepository,
    prepared: PreparedRunStart,
  ): Promise<DeferredRunStart> {
    await consumeQuota(
      repository,
      prepared.input.subject,
      {
        agentId: prepared.agentId,
        metric: "run.started",
        providerId: prepared.quotaTarget.provider.id,
        quantity: 1,
        workspaceId: prepared.run.workspaceId,
      },
      {
        quotaCoordinator: this.options.quotaCoordinator,
        webhooks: this.webhooks,
      },
    );
    await repository.createMessage(prepared.userMessage);
    if (prepared.messageParts.length > 0)
      await repository.createMessageParts(prepared.messageParts);

    const createdBy = await persistedSubjectActorId(
      repository,
      prepared.input.subject,
      {
        kind: "service_account_run",
        name: "Service Account Run Actor",
      },
    );
    const run = await repository.createRun({
      ...prepared.run,
      createdBy,
    });
    await this.appendRetrievalEvent(
      repository,
      run.id,
      prepared.citations,
      prepared.knowledgeSafety,
    );
    await recordRunStartedUsage(repository, {
      run: {
        ...run,
        modelId: prepared.quotaTarget.model.id,
        providerId: prepared.quotaTarget.provider.id,
      },
      inputTokens: prepared.estimatedInputTokens,
      model: prepared.quotaTarget.model,
      historyMessages: prepared.historyMessages,
      historyTruncated: prepared.historyTruncated,
      knowledgeHitsDropped: prepared.knowledgeHitsDropped,
    });
    return {
      run,
      startExecution: () => {
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
    };
  }

  async get(runId: string, subject: AuthSubject): Promise<RunRecord> {
    const run = await this.getAuthorizedRun(runId, subject, "runs:read");
    return run;
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

  async cancel(runId: string, subject: AuthSubject): Promise<RunRecord> {
    const run = await this.getAuthorizedRun(runId, subject, "runs:cancel");
    if (isTerminalRunStatus(run.status)) return run;
    this.activeRuns.abort(runId);
    const payloadReferences: ToolOperationDispatchPayloadStoreReference[] = [];
    const cancelled = await this.repository.transaction(async (repository) => {
      const cancelled = await repository.updateRun({
        ...run,
        status: "cancelled",
        completedAt: new Date().toISOString(),
      });
      if (run.status === "waiting_tool_approval" || run.status === "queued") {
        const event = await this.runEventSequencer.create(repository, {
          runId,
          type: "run.cancelled",
          data: {},
        });
        await repository.appendRunEvents([event]);
      }
      if (run.status === "queued") {
        payloadReferences.push(
          ...(await this.cancelLinkedDispatchRequests(
            repository,
            run,
            subject,
          )),
        );
      }
      return cancelled;
    });
    await deleteDispatchPayloadObjects(
      this.options.dispatchPayloadStore,
      payloadReferences,
    );
    return cancelled;
  }

  async *events(runId: string, subject: AuthSubject): AsyncIterable<RunEvent> {
    await this.getAuthorizedRun(runId, subject, "runs:read");
    yield* replayRunEvents(this.repository, runId);
  }

  async resumeAfterApprovedTool(input: {
    subject: AuthSubject;
    runId: string;
    toolId: string;
    toolInput: unknown;
    toolResult: unknown;
    approvalRequestId: string;
  }): Promise<RunRecord> {
    const run = await this.getAuthorizedRun(
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
      this.providerRoutingPolicy,
      { model, provider },
    );
    const providerTools = await buildProviderToolDefinitions(
      this.repository,
      input.subject,
      run.agentId,
      {
        externalOperationExecutionEnabled:
          this.options.toolOperationExecutionEnabled === true,
      },
    );
    const resumeContext = await this.buildToolApprovalResumeContext({
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
    const runningRun = await this.markRunContinuing(run, {
      reason: "tool_approval",
      toolId: input.toolId,
      approvalRequestId: input.approvalRequestId,
    });

    void this.execute({
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
    const run = await this.getAuthorizedRun(
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
    ) {
      throw new ApiError(
        "tool_dispatch_run_context_invalid",
        "Tool dispatch request is not linked to this run.",
        409,
        { jobId: input.dispatch.jobId, runId: run.id },
      );
    }
    const existingWait = (await this.repository.listRunEvents(run.id)).some(
      (event) =>
        event.type === "run.waiting_tool_dispatch" &&
        (event.data as { jobId?: unknown }).jobId === input.dispatch.jobId,
    );
    const queued = await this.repository.updateRun(
      runWithStatus(run, "queued"),
    );
    if (!existingWait) {
      const event = await this.runEventSequencer.create(this.repository, {
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
    if (run.orgId !== input.subject.orgId) {
      throw new AuthorizationError(
        "The dispatch request is outside the caller organization.",
      );
    }
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
      this.providerRoutingPolicy,
      { model, provider },
    );
    const providerTools = await buildProviderToolDefinitions(
      this.repository,
      runSubject,
      run.agentId,
      {
        externalOperationExecutionEnabled:
          this.options.toolOperationExecutionEnabled === true,
      },
    );
    const resumeContext = await this.buildToolDispatchResumeContext({
      agentVersion,
      job,
      model,
      routePlan,
      run,
      subject: runSubject,
      ...(input.response === undefined ? {} : { response: input.response }),
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    });
    const runningRun = await this.markRunContinuing(run, {
      reason: "tool_dispatch",
      toolId: context.toolId,
      jobId: input.jobId,
      outcome: input.response === undefined ? "failed" : "completed",
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    });

    void this.execute({
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

  private async execute(input: {
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
  }): Promise<void> {
    const controller = this.activeRuns.create(input.run.id);
    const adapter = getProviderAdapter(input.provider.type);
    let assistantContent = input.assistantContentPrefix ?? "";
    const modelToolExecutor = this.options.modelToolExecutor;
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
        ...(this.options.providerFetch === undefined
          ? {}
          : { fetchImpl: this.options.providerFetch }),
        ...(input.providerTools.length === 0
          ? {}
          : { tools: input.providerTools }),
        ...(modelToolExecutor === undefined
          ? {}
          : {
              maxModelToolCalls: 4,
              modelToolExecutor: async (toolCall) => ({
                ...modelToolExecutionResult(
                  await modelToolExecutor({
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
        providerCircuitBreaker: this.providerCircuitBreaker,
        providerDisabled: input.routePlan.primaryDisabled,
        providerRetryPolicy: {
          maxRetries: this.options.providerRetryAttempts ?? 0,
          backoffMs: this.options.providerRetryBackoffMs ?? 0,
        },
        signal: controller.signal,
      })) {
        const event = await this.runEventSequencer.assign(
          this.repository,
          rawEvent,
        );
        await this.repository.appendRunEvents([event]);
        if (event.type === "message.delta")
          assistantContent += (event.data as { text: string }).text;
        if (event.type === "run.waiting_tool_approval") {
          await this.markRunWaiting(input.run);
          return;
        }
        if (event.type === "run.waiting_tool_dispatch") {
          await this.markRunQueued(input.run);
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
        }
      }
    } finally {
      this.activeRuns.delete(input.run.id);
    }
  }

  private async markRunWaiting(run: RunRecord): Promise<void> {
    await this.repository.updateRun(
      runWithStatus(run, "waiting_tool_approval"),
    );
  }

  private async markRunQueued(run: RunRecord): Promise<void> {
    await this.repository.updateRun(runWithStatus(run, "queued"));
  }

  private async markRunContinuing(
    run: RunRecord,
    data: {
      reason: "tool_approval" | "tool_dispatch";
      toolId: string;
      approvalRequestId?: string;
      errorCode?: string;
      jobId?: string;
      outcome?: "completed" | "failed";
    },
  ): Promise<RunRecord> {
    return this.repository.transaction(async (repository) => {
      const runningRun = await repository.updateRun(
        runWithStatus(run, "running"),
      );
      const event = await this.runEventSequencer.create(repository, {
        runId: run.id,
        type: "run.continuing",
        data,
      });
      await repository.appendRunEvents([event]);
      return runningRun;
    });
  }

  private async buildToolApprovalResumeContext(input: {
    agentVersion: AgentVersion;
    approvalRequestId: string;
    model: BaseModel;
    routePlan: ProviderRoutePlan;
    run: RunRecord;
    subject: AuthSubject;
    toolId: string;
    toolInput: unknown;
    toolResult: unknown;
  }): Promise<{
    assistantContentPrefix: string;
    citations: RunKnowledgeCitation[];
    messages: ChatMessage[];
  }> {
    const [chatMessages, runEvents] = await Promise.all([
      this.repository.listMessages(input.run.chatId),
      this.repository.listRunEvents(input.run.id),
    ]);
    const userMessage = runUserMessage(input.run, chatMessages);
    if (userMessage === undefined) {
      throw new ApiError(
        "run_prompt_context_unavailable",
        "The run cannot be resumed because its prompt context is unavailable.",
        409,
        { runId: input.run.id },
      );
    }

    const priorMessages = historyBefore(
      orderChatHistory(chatMessages),
      userMessage.id,
    );
    const knowledge = await buildRunKnowledgeContext(this.repository, {
      agentId: input.run.agentId,
      subject: input.subject,
      query: userMessage.content,
      safetySettings: input.agentVersion.safetySettings,
      ...(this.embeddingFetch === undefined
        ? {}
        : { fetchImpl: this.embeddingFetch }),
      ...(this.options.knowledgeVectorStore === undefined
        ? {}
        : { vectorStore: this.options.knowledgeVectorStore }),
    });
    const existingCitations = citationsFromRunEvents(runEvents);
    const toolCall = {
      providerCallId: input.approvalRequestId,
      name: input.toolId,
      arguments: objectFromToolInput(input.toolInput),
      argumentKeys: objectKeys(input.toolInput),
    };
    const assistantContentPrefix = assistantContentFromRunEvents(runEvents);
    const maxHistoryMessages = historyMessageLimit(
      input.agentVersion.memoryPolicy,
    );
    const built = buildRunMessages({
      systemPrompt: input.agentVersion.systemPrompt,
      history: priorMessages,
      userContent: userMessage.content,
      knowledgeHits: knowledge.hits,
      model: routeServingModel(input.routePlan, input.model),
      ...(maxHistoryMessages === undefined ? {} : { maxHistoryMessages }),
      // The assistant/tool pair must stay adjacent and last, so it is passed as an unevictable tail.
      tail: [
        {
          role: "assistant",
          content: assistantContentPrefix,
          toolCalls: [toolCall],
        },
        {
          role: "tool",
          content: boundedModelToolResultContent(input.toolResult),
          name: input.toolId,
          toolCallId: input.approvalRequestId,
        },
      ],
    });

    return {
      assistantContentPrefix,
      citations:
        existingCitations.length === 0 ? built.citations : existingCitations,
      messages: built.messages,
    };
  }

  private async buildToolDispatchResumeContext(input: {
    agentVersion: AgentVersion;
    errorCode?: string;
    job: BackgroundJob;
    model: BaseModel;
    response?: ToolOperationDispatchReadbackResponse;
    routePlan: ProviderRoutePlan;
    run: RunRecord;
    subject: AuthSubject;
  }): Promise<{
    assistantContentPrefix: string;
    citations: RunKnowledgeCitation[];
    messages: ChatMessage[];
  }> {
    const [chatMessages, runEvents] = await Promise.all([
      this.repository.listMessages(input.run.chatId),
      this.repository.listRunEvents(input.run.id),
    ]);
    const userMessage = runUserMessage(input.run, chatMessages);
    if (userMessage === undefined) {
      throw new ApiError(
        "run_prompt_context_unavailable",
        "The run cannot be resumed because its prompt context is unavailable.",
        409,
        { runId: input.run.id },
      );
    }

    const priorMessages = historyBefore(
      orderChatHistory(chatMessages),
      userMessage.id,
    );
    const knowledge = await buildRunKnowledgeContext(this.repository, {
      agentId: input.run.agentId,
      subject: input.subject,
      query: userMessage.content,
      safetySettings: input.agentVersion.safetySettings,
      ...(this.embeddingFetch === undefined
        ? {}
        : { fetchImpl: this.embeddingFetch }),
      ...(this.options.knowledgeVectorStore === undefined
        ? {}
        : { vectorStore: this.options.knowledgeVectorStore }),
    });
    const existingCitations = citationsFromRunEvents(runEvents);
    const context = dispatchRunContext(input.job);
    if (context === undefined) {
      throw new ApiError(
        "tool_dispatch_run_context_invalid",
        "Tool dispatch request is not linked to a resumable run.",
        409,
        { jobId: input.job.id },
      );
    }
    const assistantContentPrefix = assistantContentFromRunEvents(runEvents);
    const toolCall = {
      providerCallId: input.job.id,
      name: context.toolId,
      arguments: dispatchContinuationArguments(input.job),
      argumentKeys: ["bodyKeys", "parameterKeys"],
    };

    const maxHistoryMessages = historyMessageLimit(
      input.agentVersion.memoryPolicy,
    );
    const built = buildRunMessages({
      systemPrompt: input.agentVersion.systemPrompt,
      history: priorMessages,
      userContent: userMessage.content,
      knowledgeHits: knowledge.hits,
      model: routeServingModel(input.routePlan, input.model),
      ...(maxHistoryMessages === undefined ? {} : { maxHistoryMessages }),
      // The assistant/tool pair must stay adjacent and last, so it is passed as an unevictable tail.
      tail: [
        {
          role: "assistant",
          content: assistantContentPrefix,
          toolCalls: [toolCall],
        },
        {
          role: "tool",
          content: boundedModelToolResultContent(
            dispatchReadbackToolResult(input.job, {
              ...(input.response === undefined
                ? {}
                : { response: input.response }),
              ...(input.errorCode === undefined
                ? {}
                : { errorCode: input.errorCode }),
            }),
          ),
          name: context.toolId,
          toolCallId: input.job.id,
        },
      ],
    });

    return {
      assistantContentPrefix,
      citations:
        existingCitations.length === 0 ? built.citations : existingCitations,
      messages: built.messages,
    };
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

  private async cancelLinkedDispatchRequests(
    repository: RomeoRepository,
    run: RunRecord,
    subject: AuthSubject,
  ): Promise<ToolOperationDispatchPayloadStoreReference[]> {
    const now = new Date().toISOString();
    const jobs = (await repository.listBackgroundJobs(run.orgId)).filter(
      (job) =>
        job.type === "tool.operation.dispatch_request" &&
        job.payload.runContinuation === "model_tool_dispatch" &&
        job.payload.runId === run.id &&
        (job.status === "queued" || job.status === "running"),
    );
    for (const job of jobs) {
      await repository.updateBackgroundJob({
        ...job,
        status: "failed",
        payload: {
          ...job.payload,
          cancelledAt: now,
          cancelledBy: subject.id,
          cancelReasonCode: "run_cancelled",
          errorCode: "worker_cancelled",
        },
        updatedAt: now,
        completedAt: now,
      });
      await writeAuditLog(repository, {
        subject,
        action: "tool.operation.dispatch_request.cancel",
        resourceType: "tool_operation",
        resourceId: payloadString(job, "operationId"),
        metadata: {
          jobId: job.id,
          connectorId: payloadString(job, "connectorId"),
          operationId: payloadString(job, "operationId"),
          method: payloadString(job, "method"),
          path: payloadString(job, "path"),
          workerQueue: "external_tool_operations",
          errorCode: "worker_cancelled",
          reasonCode: "run_cancelled",
          runId: run.id,
        },
      });
    }
    return jobs
      .map((job) => dispatchPayloadStoreReference(job))
      .filter(
        (reference): reference is ToolOperationDispatchPayloadStoreReference =>
          reference !== undefined,
      );
  }

  private async resolveProviderApiKeys(
    providers: Array<ProviderInstance | undefined>,
  ): Promise<Record<string, string>> {
    const uniqueProviders = [
      ...new Map(
        providers
          .filter(
            (provider): provider is ProviderInstance => provider !== undefined,
          )
          .map((provider) => [provider.id, provider]),
      ).values(),
    ];
    const entries = await Promise.all(
      uniqueProviders.map(async (provider) => {
        const apiKey = await this.resolveProviderApiKey(provider);
        return apiKey === undefined
          ? undefined
          : ([provider.id, apiKey] as const);
      }),
    );
    return Object.fromEntries(
      entries.filter(
        (entry): entry is readonly [string, string] => entry !== undefined,
      ),
    );
  }

  private async resolveProviderApiKey(
    provider: ProviderInstance,
  ): Promise<string | undefined> {
    if (provider.credentialRef === undefined) return undefined;
    const resolution = await this.options.secretResolver?.resolveValue?.(
      provider.credentialRef,
    );
    return resolution?.available === true ? resolution.value : undefined;
  }

  private async completeRun(
    run: RunRecord,
    event: RunEvent,
    assistantContent: string,
    model: BaseModel,
    citations: RunKnowledgeCitation[],
  ): Promise<void> {
    const eventType = event.type;
    const status =
      eventType === "run.completed"
        ? "completed"
        : eventType === "run.cancelled"
          ? "cancelled"
          : "failed";
    const finalAssistantContent = appendRunCitations(
      assistantContent,
      citations,
    );
    const providerUsage = providerUsageFromEvent(event);
    await this.repository.transaction(async (repository) => {
      await repository.updateRun({
        ...run,
        status,
        completedAt: new Date().toISOString(),
      });
      await recordRunTerminalUsage(repository, {
        run,
        status,
        assistantContent: finalAssistantContent,
        model,
        ...(providerUsage === undefined ? {} : { providerUsage }),
      });

      if (finalAssistantContent.length > 0) {
        await repository.createMessage({
          id: createId("msg"),
          chatId: run.chatId,
          role: "assistant",
          content: finalAssistantContent,
          createdAt: new Date().toISOString(),
        });
      }
    });
    this.emitRunWebhook(run, status);
  }

  private emitRunWebhook(
    run: RunRecord,
    status: "cancelled" | "completed" | "failed",
  ): void {
    if (this.webhooks === undefined || status === "cancelled") return;
    const completedAt = new Date().toISOString();
    void this.webhooks
      .emit({
        orgId: run.orgId,
        eventType: status === "completed" ? "run.completed" : "run.failed",
        payload: {
          runId: run.id,
          chatId: run.chatId,
          workspaceId: run.workspaceId,
          agentId: run.agentId,
          agentVersionId: run.agentVersionId,
          modelId: run.modelId,
          providerId: run.providerId,
          status,
          completedAt,
        },
      })
      .catch(() => undefined);
  }

  private async appendRetrievalEvent(
    repository: RomeoRepository,
    runId: string,
    citations: RunKnowledgeCitation[],
    safety: RunKnowledgeSafetySummary | undefined,
  ): Promise<void> {
    if (citations.length === 0 && safety === undefined) return;
    const event = await this.runEventSequencer.create(repository, {
      runId,
      type: "retrieval.completed",
      data: {
        citationCount: citations.length,
        citations,
        ...(safety === undefined ? {} : { safety }),
      },
    });
    await repository.appendRunEvents([event]);
  }

  private async getAuthorizedRun(
    runId: string,
    subject: AuthSubject,
    scope: "runs:read" | "runs:cancel",
  ): Promise<RunRecord> {
    assertScope(subject, scope);

    const run = await this.repository.getRun(runId);
    if (!run) throw notFound("Run");

    if (!canAccessOrg(subject, run.orgId)) {
      throw new AuthorizationError(
        "The run is outside the caller organization.",
      );
    }

    if (!hasWorkspaceAccess(subject, run.workspaceId)) {
      throw new AuthorizationError(
        "The run is outside the caller workspace access.",
      );
    }

    if (run.createdBy === subject.id || subject.isAdmin === true) {
      return run;
    }

    const chat = await this.repository.getChat(run.chatId);
    if (!chat) throw notFound("Chat");
    const grants = await this.repository.listResourceGrants(subject.orgId);
    const hasSharedAccess =
      scope === "runs:read"
        ? canReadChat(subject, grants, chat)
        : canWriteChat(subject, grants, chat);
    if (!hasSharedAccess) {
      throw new AuthorizationError("The run is owned by another principal.");
    }

    return run;
  }
}

interface DispatchRunContext {
  agentId: string;
  runId: string;
  toolId: string;
  workspaceId: string;
}

function dispatchRunContext(
  job: BackgroundJob,
): DispatchRunContext | undefined {
  if (job.payload.runContinuation !== "model_tool_dispatch") return undefined;
  const runId = optionalPayloadString(job, "runId");
  const workspaceId = optionalPayloadString(job, "workspaceId");
  const agentId = optionalPayloadString(job, "agentId");
  const toolId = optionalPayloadString(job, "toolId");
  return runId === undefined ||
    workspaceId === undefined ||
    agentId === undefined ||
    toolId === undefined
    ? undefined
    : { agentId, runId, toolId, workspaceId };
}

function dispatchWaitEventData(
  job: BackgroundJob,
  dispatch: RunToolDispatchWait,
  toolId: string,
): Record<string, unknown> {
  return {
    connectorId: dispatch.connectorId,
    errorCode: "tool_operation_dispatch_queued",
    jobId: dispatch.jobId,
    operationId: dispatch.operationId,
    toolName: toolId,
    workerQueue: dispatch.workerQueue,
    parameterKeys: payloadStringArray(job, "parameterKeys"),
    bodyKeys: payloadStringArray(job, "bodyKeys"),
    payloadStorage: dispatchPayloadStorage(job),
  };
}

function subjectFromDispatchJob(
  job: BackgroundJob,
  run: RunRecord,
): AuthSubject {
  const type =
    job.payload.runSubjectType === "service_account"
      ? "service_account"
      : "user";
  return {
    id: payloadString(job, "actorId"),
    type,
    orgId: run.orgId,
    workspaceIds: payloadStringArray(job, "runSubjectWorkspaceIds", [
      run.workspaceId,
    ]),
    groupIds: payloadStringArray(job, "runSubjectGroupIds", []),
    scopes: payloadScopes(job, "runSubjectScopes"),
    isAdmin: job.payload.runSubjectIsAdmin === true,
  };
}

function dispatchContinuationArguments(
  job: BackgroundJob,
): Record<string, unknown> {
  return {
    parameterKeys: payloadStringArray(job, "parameterKeys"),
    bodyKeys: payloadStringArray(job, "bodyKeys"),
  };
}

function dispatchReadbackToolResult(
  job: BackgroundJob,
  result: {
    errorCode?: string;
    response?: ToolOperationDispatchReadbackResponse;
  },
): Record<string, unknown> {
  return {
    dispatch:
      result.response === undefined && result.errorCode !== undefined
        ? "failed"
        : "completed",
    jobId: job.id,
    connectorId: payloadString(job, "connectorId"),
    operationId: payloadString(job, "operationId"),
    method: payloadString(job, "method"),
    pathTemplate: payloadString(job, "path"),
    workerQueue: "external_tool_operations",
    request: {
      parameterKeys: payloadStringArray(job, "parameterKeys"),
      bodyKeys: payloadStringArray(job, "bodyKeys"),
      host: payloadString(job, "host"),
      payloadStorage: dispatchPayloadStorage(job),
    },
    ...(result.response === undefined ? {} : { response: result.response }),
    ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
  };
}

function payloadString(job: BackgroundJob, key: string): string {
  const value = job.payload[key];
  return typeof value === "string" && value.length > 0 ? value : "";
}

function optionalPayloadString(
  job: BackgroundJob,
  key: string,
): string | undefined {
  const value = payloadString(job, key);
  return value.length === 0 ? undefined : value;
}

function payloadStringArray(
  job: BackgroundJob,
  key: string,
  fallback: string[] = [],
): string[] {
  const value = job.payload[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : fallback;
}

function payloadScopes(job: BackgroundJob, key: string): Scope[] {
  const allowed = new Set<string>(scopeValues);
  return payloadStringArray(job, key).filter((item): item is Scope =>
    allowed.has(item),
  );
}

function routeServingModel(
  routePlan: ProviderRoutePlan,
  model: BaseModel,
): BaseModel {
  // The executor swaps to the fallback before its first attempt when the primary provider is
  // disabled, so in that case the fallback — not the primary — is the model that serves this run.
  // Everywhere else the primary serves it, and the payload is budgeted for the primary's window.
  return routePlan.primaryDisabled && routePlan.fallback !== undefined
    ? routePlan.fallback.model
    : model;
}

function runUserMessage(
  run: RunRecord,
  messages: Message[],
): Message | undefined {
  // Shares the assembler's comparator: a divergent order here would shift the history boundary.
  const sorted = [...messages].sort(compareChatMessages);
  return (
    sorted
      .filter(
        (message) =>
          message.role === "user" && message.createdAt <= run.createdAt,
      )
      .at(-1) ?? sorted.filter((message) => message.role === "user").at(-1)
  );
}

function runWithStatus(run: RunRecord, status: RunRecord["status"]): RunRecord {
  const { completedAt: _completedAt, ...withoutCompletedAt } = run;
  return { ...withoutCompletedAt, status };
}

function isTerminalRunStatus(status: RunRecord["status"]): boolean {
  return (
    status === "cancelled" || status === "completed" || status === "failed"
  );
}

function assistantContentFromRunEvents(events: RunEvent[]): string {
  let content = "";
  for (const event of events.sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    if (event.type === "message.started") content = "";
    if (event.type === "message.delta") {
      const text = (event.data as { text?: unknown }).text;
      if (typeof text === "string") content += text;
    }
  }
  return content;
}

function citationsFromRunEvents(events: RunEvent[]): RunKnowledgeCitation[] {
  return events.flatMap((event) => {
    if (event.type !== "retrieval.completed") return [];
    const citations = (event.data as { citations?: unknown }).citations;
    if (!Array.isArray(citations)) return [];
    return citations.flatMap((citation) => {
      const item = citation as Partial<RunKnowledgeCitation>;
      return typeof item.chunkId === "string" &&
        typeof item.documentId === "string" &&
        typeof item.title === "string"
        ? [
            {
              chunkId: item.chunkId,
              documentId: item.documentId,
              title: item.title,
              ...(typeof item.sourceUri === "string"
                ? { sourceUri: item.sourceUri }
                : {}),
            },
          ]
        : [];
    });
  });
}

function objectFromToolInput(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function modelToolExecutionResult(output: unknown): {
  content: string;
  suspend?: {
    type: "tool_dispatch";
    bodyKeys?: string[];
    connectorId: string;
    jobId: string;
    operationId: string;
    parameterKeys?: string[];
    payloadStorage?: DispatchPayloadStorage;
    workerQueue: "external_tool_operations";
  };
} {
  const dispatchWait = dispatchWaitFromToolOutput(output);
  return {
    content: boundedModelToolResultContent(output),
    ...(dispatchWait === undefined
      ? {}
      : {
          suspend: {
            type: "tool_dispatch",
            ...dispatchWait,
          },
        }),
  };
}

export function dispatchWaitFromToolOutput(
  output: unknown,
): RunToolDispatchWait | undefined {
  if (typeof output !== "object" || output === null || Array.isArray(output))
    return undefined;
  const record = output as Record<string, unknown>;
  return record.dispatch === "queued" &&
    typeof record.jobId === "string" &&
    typeof record.connectorId === "string" &&
    typeof record.operationId === "string" &&
    record.workerQueue === "external_tool_operations"
    ? {
        connectorId: record.connectorId,
        jobId: record.jobId,
        operationId: record.operationId,
        ...dispatchRequestKeys(record),
        workerQueue: "external_tool_operations",
      }
    : undefined;
}

function dispatchRequestKeys(record: Record<string, unknown>): {
  bodyKeys?: string[];
  parameterKeys?: string[];
  payloadStorage?: DispatchPayloadStorage;
} {
  const request =
    typeof record.request === "object" &&
    record.request !== null &&
    !Array.isArray(record.request)
      ? (record.request as Record<string, unknown>)
      : {};
  const parameterKeys = stringArrayValue(request.parameterKeys);
  const bodyKeys = stringArrayValue(request.bodyKeys);
  return {
    ...(parameterKeys === undefined ? {} : { parameterKeys }),
    ...(bodyKeys === undefined ? {} : { bodyKeys }),
    ...(request.payloadStorage === "external_worker_secret_store_required" ||
    request.payloadStorage === "managed_encrypted_object_store"
      ? { payloadStorage: request.payloadStorage }
      : {}),
  };
}

function dispatchPayloadStorage(job: BackgroundJob): DispatchPayloadStorage {
  return job.payload.payloadStorage === "managed_encrypted_object_store"
    ? "managed_encrypted_object_store"
    : "external_worker_secret_store_required";
}

function dispatchPayloadStoreReference(
  job: BackgroundJob,
): ToolOperationDispatchPayloadStoreReference | undefined {
  if (job.payload.payloadStorage !== "managed_encrypted_object_store")
    return undefined;
  return isToolDispatchPayloadStoreReference(job.payload.payloadStore)
    ? job.payload.payloadStore
    : undefined;
}

async function deleteDispatchPayloadObjects(
  payloadStore: ToolDispatchPayloadStore | undefined,
  references: ToolOperationDispatchPayloadStoreReference[],
): Promise<void> {
  if (payloadStore === undefined || references.length === 0) return;
  await Promise.all(
    references.map(async (reference) => {
      try {
        await payloadStore.delete(reference);
      } catch {
        // Object-store lifecycle expiry is the fallback for cleanup failures.
      }
    }),
  );
}

async function deleteObjectKeys(
  objectStore: ObjectStore,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return;
  await Promise.all(
    [...new Set(keys)].map(async (key) => {
      try {
        await objectStore.deleteObject(key);
      } catch {
        // Object-store lifecycle expiry is the fallback for cleanup failures.
      }
    }),
  );
}

function stringArrayValue(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function boundedModelToolResultContent(output: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(output);
  } catch {
    serialized = JSON.stringify({ error: "tool_result_unserializable" });
  }
  const content = serialized ?? "null";
  return content.length <= 8_000 ? content : `${content.slice(0, 8_000)}...`;
}

function providerUsageFromEvent(
  event: RunEvent,
): ProviderTokenUsage | undefined {
  if (event.type !== "run.completed") return undefined;
  const data = event.data as { usage?: ProviderTokenUsage };
  return data.usage;
}

function providerFallbackFromEvent(
  event: RunEvent,
): ProviderFallbackSnapshot | undefined {
  const data = event.data as { providerFallback?: ProviderFallbackSnapshot };
  return data.providerFallback;
}

function routedRunTarget(
  run: RunRecord,
  model: BaseModel,
  routePlan: ProviderRoutePlan,
  event: RunEvent,
): { model: BaseModel; run: RunRecord } {
  const fallback = providerFallbackFromEvent(event);
  if (
    fallback === undefined ||
    routePlan.fallback === undefined ||
    fallback.toModelId !== routePlan.fallback.model.id ||
    fallback.toProviderId !== routePlan.fallback.provider.id
  ) {
    return { model, run };
  }

  return {
    model: routePlan.fallback.model,
    run: {
      ...run,
      modelId: routePlan.fallback.model.id,
      providerId: routePlan.fallback.provider.id,
    },
  };
}
