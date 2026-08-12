import type { ObjectStore } from "@romeo/storage";

import type { Message, RunRecord } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { samplingForModel, samplingFromParameters } from "./run-sampling";
import { enforceAgentSafetySettings } from "./agent-safety";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { assistantsEnabledForOrg } from "./chat-experience-service";
import { consumeQuota } from "./consume-quota";
import { storeMessageAttachments } from "./message-attachments";
import {
  createProviderRoutePlan,
  type ProviderRoutingPolicy,
} from "./provider-routing";
import { advanceChatLeaf } from "./run-command-service";
import { recordRunStartedUsage } from "./run-usage";
import {
  appendDocumentContext,
  buildCanonicalRunContext,
  resolveGovernedRunFiles,
  resolveManagedModelCustomization,
  resolveRetainedMessageContext,
} from "./run-context-builder";
import { resolveRunContext } from "./run-context";
import { resolveRunAgentic } from "./knowledge-agentic";
import { buildRunKnowledgeContext } from "./run-knowledge";
import {
  historyBefore,
  orderChatHistory,
  linearParentId,
  pathThroughMessage,
} from "./run-messages";
import { isTerminalRunStatus } from "./run-recovery-service";
import type { RunEventSequencer } from "./run-event-sequencer";
import type {
  DeferredRunStart,
  PreparedRunStart,
  RunServiceOptions,
  StartRunInput,
} from "./run-service-contracts";
import { routeServingModel } from "./run-stream-service";
import { deleteObjectKeys } from "./run-tool-service";
import { buildProviderToolDefinitions } from "./provider-tool-schemas";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import type { WebhookEmitter } from "./webhook-service";
import { resolveRunMemories } from "./workspace-content-service";

export class RunStartService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly runEventSequencer: RunEventSequencer,
    private readonly providerRoutingPolicy: ProviderRoutingPolicy,
    private readonly objectStore: ObjectStore,
    private readonly webhooks: WebhookEmitter | undefined,
    private readonly embeddingFetch: typeof fetch | undefined,
    private readonly options: RunServiceOptions,
    private readonly beginExecution: (
      prepared: PreparedRunStart,
      run: RunRecord,
    ) => void,
  ) {}

  async start(input: StartRunInput): Promise<RunRecord> {
    const storedObjectKeys: string[] = [];
    try {
      const prepared = await this.prepare(this.repository, input, {
        storedObjectKeys,
      });
      const started = await this.repository.transaction((repository) =>
        this.persist(repository, prepared),
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
    return this.persist(repository, await this.prepare(repository, input));
  }

  private async prepare(
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
    const chatMessages = await repository.listMessages(chat.id);
    if (
      input.parentMessageId !== undefined &&
      input.parentMessageId !== null &&
      !chatMessages.some((message) => message.id === input.parentMessageId)
    )
      throw notFound("Message");
    // Explicit null is a deliberate fork from the chat root — the only way to re-answer the first
    // turn — and must stay distinguishable from "no parent could be resolved".
    const rootFork = input.parentMessageId === null;
    const requestedParentId = rootFork
      ? undefined
      : (input.parentMessageId ??
        linearParentId(chatMessages, chat.activeLeafMessageId));
    const branch =
      requestedParentId === undefined
        ? []
        : pathThroughMessage(orderChatHistory(chatMessages), requestedParentId);
    const parentId = branch.length === 0 ? undefined : requestedParentId;
    // A root fork replays nothing. A pointer that resolves to nothing — its message was deleted, or
    // the chat predates parent links — degrades to the pre-branching behaviour of replaying it all.
    const branchMessages =
      rootFork || branch.length > 0 ? branch : chatMessages;
    const customization = await resolveManagedModelCustomization(
      repository,
      input.subject,
      agent.id,
      this.options,
    );
    const [retainedAttachments, governedFiles, memories] = await Promise.all([
      resolveRetainedMessageContext({
        // Branch, not chat: a sibling's attachments must not leak into a variant that never saw them.
        messages: branchMessages,
        objectStore: this.objectStore,
        repository,
      }),
      resolveGovernedRunFiles({
        fileIds: input.fileIds ?? [],
        objectStore: this.objectStore,
        repository,
        subject: input.subject,
        workspaceId: chat.workspaceId,
      }),
      resolveRunMemories({
        repository,
        objectStore: this.objectStore,
        subject: input.subject,
        workspaceId: chat.workspaceId,
        includePersonal:
          customization.policy.allowPersonalMemory &&
          customization.preferences.personalMemoryEnabled === true,
      }),
    ]);
    const runContent = appendDocumentContext(input.content, [
      ...retainedAttachments.documents,
      ...governedFiles.flatMap((file) =>
        file.extractedText === undefined
          ? []
          : [{ fileName: file.fileName, text: file.extractedText }],
      ),
    ]);
    const currentImages = [
      ...(input.attachments ?? []).map((attachment) => ({
        dataBase64: attachment.dataBase64,
        mimeType: attachment.mimeType as
          | "image/gif"
          | "image/jpeg"
          | "image/png"
          | "image/webp",
      })),
      ...governedFiles.flatMap((file) =>
        file.mimeType.startsWith("image/")
          ? [
              {
                dataBase64: Buffer.from(file.bytes).toString("base64"),
                mimeType: file.mimeType as
                  | "image/gif"
                  | "image/jpeg"
                  | "image/png"
                  | "image/webp",
              },
            ]
          : [],
      ),
      ...retainedAttachments.images,
    ];
    const servingModel = routeServingModel(routePlan, model);
    if (
      currentImages.length > 0 &&
      servingModel.capabilitiesSource !== undefined &&
      !servingModel.capabilities.vision
    )
      throw new ApiError(
        "model_vision_not_supported",
        "The selected model does not support image input.",
        409,
        { modelId: servingModel.id },
      );
    enforceAgentSafetySettings(agentVersion.safetySettings, runContent, {
      source: "user_input",
    });
    await assertAbuseControlsAllow(repository, input.subject, {
      action: "run.start",
      agentId: agent.id,
      providerId: quotaTarget.provider.id,
      workspaceId: chat.workspaceId,
    });
    const history =
      input.historyBoundaryMessageId === undefined
        ? branchMessages
        : historyBefore(
            orderChatHistory(branchMessages),
            input.historyBoundaryMessageId,
          );
    const userMessageId = createId("msg");
    const messageParts = await storeMessageAttachments({
      messageId: userMessageId,
      ...(this.options.messageAttachmentMaxBytes === undefined
        ? {}
        : { maxAttachmentBytes: this.options.messageAttachmentMaxBytes }),
      objectStore: this.objectStore,
      ...(this.options.malwareScanning === undefined
        ? {}
        : { malwareScanning: this.options.malwareScanning }),
      ...(options.storedObjectKeys === undefined
        ? {}
        : { storedObjectKeys: options.storedObjectKeys }),
      attachments: [
        ...(input.attachments ?? []),
        ...governedFiles.map((file) => ({
          dataBase64: Buffer.from(file.bytes).toString("base64"),
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.bytes.byteLength,
          ...(file.extractedText === undefined
            ? {}
            : { extractedText: file.extractedText }),
        })),
      ],
    });
    const userMessage: Message = {
      id: userMessageId,
      chatId: chat.id,
      role: "user",
      content: input.content,
      ...(parentId === undefined ? {} : { parentId }),
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
    const agentic = await resolveRunAgentic(
      repository,
      input.subject.orgId,
      input.agenticRag,
    );
    const [knowledge, webHits] = await Promise.all([
      buildRunKnowledgeContext(repository, {
        agentId: agent.id,
        subject: input.subject,
        query: runContent,
        safetySettings: agentVersion.safetySettings,
        ...(input.knowledgeBaseIds === undefined
          ? {}
          : { knowledgeBaseIds: input.knowledgeBaseIds }),
        ...(agentic ? { agentic: true } : {}),
        ...(this.embeddingFetch === undefined
          ? {}
          : { fetchImpl: this.embeddingFetch }),
        ...(this.options.knowledgeVectorStore === undefined
          ? {}
          : { vectorStore: this.options.knowledgeVectorStore }),
      }),
      this.options.webRetrieval === undefined ||
      (input.webSearch !== true && (input.urls?.length ?? 0) === 0)
        ? Promise.resolve([])
        : this.options.webRetrieval({
            subject: input.subject,
            query: runContent,
            search: input.webSearch === true,
            urls: input.urls ?? [],
          }),
    ]);
    const built = buildCanonicalRunContext({
      agentVersion,
      assistantsEnabled: await assistantsEnabledForOrg(repository, chat.orgId),
      preferences: customization.preferences,
      memories,
      history,
      userContent: runContent,
      ...(currentImages.length === 0 ? {} : { userImages: currentImages }),
      knowledgeHits: [...webHits, ...knowledge.hits],
      model: servingModel,
    });
    // The sampling a version pins belongs to the run, not to whichever provider answers it, so it
    // is resolved once here and carried through retries and fallback.
    const sampling = {
      ...samplingFromParameters(
        servingModel.defaultParameters as
          | import("../domain/agent-entities").AgentParameters
          | undefined,
      ),
      ...samplingFromParameters(agentVersion.parameters),
    };
    const resolvedSampling = samplingForModel(
      servingModel,
      Object.keys(sampling).length === 0 ? undefined : sampling,
    );
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
      citations: built.citations,
      estimatedInputTokens: built.estimatedInputTokens,
      historyMessages: built.historyMessages,
      historyTruncated: built.historyTruncated,
      input: { content: input.content, subject: input.subject },
      knowledgeHitsDropped: built.knowledgeHitsDropped,
      ...(knowledge.safety === undefined
        ? {}
        : { knowledgeSafety: knowledge.safety }),
      messageParts,
      messages: built.messages,
      model,
      provider,
      providerTools,
      quotaTarget,
      routePlan,
      run,
      ...(resolvedSampling === undefined ? {} : { sampling: resolvedSampling }),
      userMessage,
    };
  }

  private async persist(
    repository: RomeoRepository,
    prepared: PreparedRunStart,
  ): Promise<DeferredRunStart> {
    const active = (await repository.listRuns(prepared.run.chatId)).find(
      (run) => !isTerminalRunStatus(run.status),
    );
    if (active !== undefined) {
      throw new ApiError(
        "chat_run_in_progress",
        "This chat is already generating a response.",
        409,
      );
    }
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
    await advanceChatLeaf(
      repository,
      prepared.run.chatId,
      prepared.userMessage.id,
    );
    if (prepared.messageParts.length > 0)
      await repository.createMessageParts(prepared.messageParts);
    const createdBy = await persistedSubjectActorId(
      repository,
      prepared.input.subject,
      { kind: "service_account_run", name: "Service Account Run Actor" },
    );
    const run = await repository.createRun({ ...prepared.run, createdBy });
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
      startExecution: () => this.beginExecution(prepared, run),
    };
  }

  private async appendRetrievalEvent(
    repository: RomeoRepository,
    runId: string,
    citations: PreparedRunStart["citations"],
    safety: PreparedRunStart["knowledgeSafety"],
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
}
