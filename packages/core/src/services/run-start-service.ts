import type { ObjectStore } from "@romeo/storage";

import type { Message, RunRecord } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { requestedChatParametersForStart } from "./run-reasoning-policy";
import { enforceAgentSafetySettings } from "./agent-safety";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { assistantsEnabledForOrg } from "./chat-experience-service";
import { consumeQuota } from "./consume-quota";
import { enforceContentPolicyText } from "./content-policy-service";
import {
  materializeInlineAttachmentsAsFiles,
  planFileReferenceAttach,
} from "./file-reference-writer";
import { fileIdsForMessagePart } from "./message-part-v1";
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
import { persistRunRetrievalEvent } from "./run-retrieval-event-persistence";
import { routeServingModel } from "./run-stream-service";
import { deleteObjectKeys } from "./run-tool-service";
import { governRunProviderInputs } from "./run-provider-input-governance";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import { writeAuditLog } from "./audit-log";
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
    return (await this.startWithInputMessage(input)).run;
  }

  async startWithInputMessage(
    input: StartRunInput,
  ): Promise<{ inputMessageId: string; run: RunRecord }> {
    const storedObjectKeys: string[] = [];
    try {
      const prepared = await this.prepare(this.repository, input, {
        storedObjectKeys,
      });
      const started = await this.repository.transaction((repository) =>
        this.persist(repository, prepared),
      );
      started.startExecution();
      return { inputMessageId: started.inputMessageId, run: started.run };
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
    const { chat, agent, agentVersion, model, provider, routingDecision } =
      await resolveRunContext(repository, {
        ...input,
        disabledProviderIds: this.providerRoutingPolicy.disabledProviderIds,
      });
    const governedPrompt = await enforceContentPolicyText(
      repository,
      input.subject,
      input.content,
    );
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
        subject: input.subject,
        workspaceId: chat.workspaceId,
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
    const combinedContent = appendDocumentContext(governedPrompt.content, [
      ...retainedAttachments.documents,
      ...governedFiles.flatMap((file) =>
        file.extractedText === undefined
          ? []
          : [{ fileName: file.fileName, text: file.extractedText }],
      ),
    ]);
    const runContent = (
      await enforceContentPolicyText(repository, input.subject, combinedContent)
    ).content;
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
    const userMessage: Message = {
      id: userMessageId,
      chatId: chat.id,
      role: "user",
      content: governedPrompt.content,
      ...(parentId === undefined ? {} : { parentId }),
      createdAt: new Date().toISOString(),
    };
    const inlineFiles = await materializeInlineAttachmentsAsFiles({
      attachments: [...(input.attachments ?? [])],
      messageId: userMessageId,
      now: userMessage.createdAt,
      objectStore: this.objectStore,
      orgId: chat.orgId,
      ownerId: input.subject.id,
      ownerType: input.subject.type,
      repository,
      workspaceId: chat.workspaceId,
      ...(this.options.messageAttachmentMaxBytes === undefined
        ? {}
        : { maxBytes: this.options.messageAttachmentMaxBytes }),
      ...(this.options.malwareScanning === undefined
        ? {}
        : { malwareScanning: this.options.malwareScanning }),
    });
    options.storedObjectKeys?.push(...inlineFiles.files.map((file) => file.objectKey));
    const planned = planFileReferenceAttach({
      files: [
        ...inlineFiles.files,
        ...governedFiles.map((file) => ({
          id: file.id,
          status: "ready" as const,
          mimeType: file.mimeType,
          fileName: file.fileName,
        })),
      ],
      messageId: userMessageId,
      now: userMessage.createdAt,
    });
    if (planned.outcome === "denied")
      throw new ApiError("file_not_ready", "The file has not completed its security lifecycle.", 409);
    const messageParts = planned.parts;
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
    const deepResearch = input.researchMode === "deep";
    const agentic = await resolveRunAgentic(
      repository,
      input.subject.orgId,
      deepResearch || input.agenticRag,
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
      (!deepResearch &&
        input.webSearch !== true &&
        (input.urls?.length ?? 0) === 0)
        ? Promise.resolve([])
        : this.options.webRetrieval({
            subject: input.subject,
            workspaceId: chat.workspaceId,
            agentId: agent.id,
            agentVersionId: agentVersion.id,
            query: runContent,
            search: deepResearch || input.webSearch === true,
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
      ...(input.researchMode === undefined
        ? {}
        : { researchMode: input.researchMode }),
    });
    const requestedParameters = await requestedChatParametersForStart(
      repository,
      {
        agentParameters: agentVersion.parameters,
        model: servingModel,
        orgId: chat.orgId,
        workspaceId: chat.workspaceId,
        ...(this.options.capabilityPlatformPolicy === undefined
          ? {}
          : { platformPolicy: this.options.capabilityPlatformPolicy }),
        ...(input.reasoningPolicy === undefined
          ? {}
          : { runRequest: input.reasoningPolicy }),
      },
    );
    const governedProvider = await governRunProviderInputs({
      agentId: agent.id,
      messages: built.messages,
      repository,
      subject: input.subject,
      toolOperationExecutionEnabled:
        this.options.toolOperationExecutionEnabled === true,
    });
    return {
      agentId: agent.id,
      agentVersionId: agentVersion.id,
      citations: built.citations,
      estimatedInputTokens: built.estimatedInputTokens,
      historyMessages: built.historyMessages,
      historyTruncated: built.historyTruncated,
      input: { content: governedPrompt.content, subject: input.subject },
      knowledgeHitsDropped: built.knowledgeHitsDropped,
      ...(knowledge.safety === undefined
        ? {}
        : { knowledgeSafety: knowledge.safety }),
      messageParts,
      messages: governedProvider.messages,
      model,
      provider,
      providerTools: governedProvider.providerTools,
      quotaTarget,
      routePlan,
      routingDecision,
      run,
      ...requestedParameters,
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
    const fileReferenceCount = prepared.messageParts.reduce(
      (count, part) => count + fileIdsForMessagePart(part).length,
      0,
    );
    if (fileReferenceCount > 0)
      await writeAuditLog(repository, {
        subject: prepared.input.subject,
        action: "file.reference.attach",
        resourceType: "chat",
        resourceId: prepared.run.chatId,
        metadata: {
          messageId: prepared.userMessage.id,
          referenceCount: fileReferenceCount,
          workspaceId: prepared.run.workspaceId,
        },
      });
    const createdBy = await persistedSubjectActorId(
      repository,
      prepared.input.subject,
      { kind: "service_account_run", name: "Service Account Run Actor" },
    );
    const run = await repository.createRun({ ...prepared.run, createdBy });
    const retrievalEvents = await persistRunRetrievalEvent(
      repository,
      this.runEventSequencer,
      {
        runId: run.id,
        citations: prepared.citations,
        safety: prepared.knowledgeSafety,
      },
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
      imageInputCount: prepared.messages.reduce(
        (count, message) =>
          count + ("images" in message ? (message.images?.length ?? 0) : 0),
        0,
      ),
      knowledgeHitsDropped: prepared.knowledgeHitsDropped,
      routing: prepared.routingDecision,
    });
    return {
      inputMessageId: prepared.userMessage.id,
      run,
      startExecution: () => {
        void this.runEventSequencer.notify(retrievalEvents);
        this.beginExecution(prepared, run);
      },
    };
  }
}
