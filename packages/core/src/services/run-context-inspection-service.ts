import type { AuthSubject } from "@romeo/auth";
import {
  resolveProviderReasoningPolicy,
  type ProviderReasoningPolicy,
} from "@romeo/providers";
import type { ObjectStore } from "@romeo/storage";

import type { RomeoRepository } from "../domain/repository";
import { assistantsEnabledForOrg } from "./chat-experience-service";
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
import { orderChatHistory, pathThroughMessage } from "./run-messages";
import type { RunServiceOptions } from "./run-service-contracts";
import { resolveRunMemories } from "./workspace-content-service";
import type { ModelRoutingMode } from "./model-routing";
import { reasoningPolicyLayersForStart } from "./run-reasoning-policy";

export interface RunContextInspectionInput {
  subject: AuthSubject;
  chatId: string;
  agentId: string;
  content: string;
  modelId?: string;
  routingMode?: ModelRoutingMode;
  researchMode?: "standard" | "deep";
  reasoningPolicy?: ProviderReasoningPolicy;
  fileIds?: string[];
  imageCount: number;
  webSearch?: boolean;
  urls?: string[];
  agenticRag?: boolean;
}

export class RunContextInspectionService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly objectStore: ObjectStore,
    private readonly embeddingFetch: typeof fetch | undefined,
    private readonly options: RunServiceOptions,
    private readonly disabledProviderIds: ReadonlySet<string> = new Set(),
  ) {}

  async inspect(input: RunContextInspectionInput) {
    const { chat, agentVersion, model, provider, routingDecision } =
      await resolveRunContext(this.repository, {
        ...input,
        disabledProviderIds: this.disabledProviderIds,
      });
    const customization = await resolveManagedModelCustomization(
      this.repository,
      input.subject,
      input.agentId,
      this.options,
    );
    const [chatMessages, governedFiles, memories] = await Promise.all([
      this.repository.listMessages(chat.id),
      resolveGovernedRunFiles({
        fileIds: input.fileIds ?? [],
        objectStore: this.objectStore,
        repository: this.repository,
        subject: input.subject,
        workspaceId: chat.workspaceId,
      }),
      resolveRunMemories({
        repository: this.repository,
        objectStore: this.objectStore,
        subject: input.subject,
        workspaceId: chat.workspaceId,
        includePersonal:
          customization.policy.allowPersonalMemory &&
          customization.preferences.personalMemoryEnabled === true,
      }),
    ]);
    // ponytail: the preview always previews the chat's active branch. InspectRunContextSchema has
    // no parentMessageId, so a variant cannot be costed before it is sent. Add one to the schema
    // and mirror run-start-service's resolution here if that ever matters.
    const branch =
      chat.activeLeafMessageId === undefined
        ? []
        : pathThroughMessage(
            orderChatHistory(chatMessages),
            chat.activeLeafMessageId,
          );
    const history = branch.length === 0 ? chatMessages : branch;
    const retained = await resolveRetainedMessageContext({
      messages: history,
      objectStore: this.objectStore,
      repository: this.repository,
      subject: input.subject,
      workspaceId: chat.workspaceId,
    });
    const documents = [
      ...retained.documents.map((document) => ({
        ...document,
        retained: true,
      })),
      ...governedFiles.flatMap((file) =>
        file.extractedText === undefined
          ? []
          : [
              {
                fileName: file.fileName,
                text: file.extractedText,
                retained: false,
              },
            ],
      ),
    ];
    const runContent = appendDocumentContext(input.content, documents);
    const deepResearch = input.researchMode === "deep";
    const agentic = await resolveRunAgentic(
      this.repository,
      input.subject.orgId,
      deepResearch || input.agenticRag,
    );
    const [knowledge, webHits] = await Promise.all([
      buildRunKnowledgeContext(this.repository, {
        agentId: input.agentId,
        subject: input.subject,
        query: runContent,
        safetySettings: agentVersion.safetySettings,
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
            agentId: input.agentId,
            agentVersionId: agentVersion.id,
            query: runContent,
            search: deepResearch || input.webSearch === true,
            urls: input.urls ?? [],
          }),
    ]);
    const previewImages = [
      ...retained.images,
      ...governedFiles.flatMap((file) =>
        file.mimeType.startsWith("image/")
          ? [
              {
                dataBase64: "[image-bytes-redacted]",
                mimeType: file.mimeType as
                  | "image/gif"
                  | "image/jpeg"
                  | "image/png"
                  | "image/webp",
              },
            ]
          : [],
      ),
      ...Array.from({ length: input.imageCount }, () => ({
        dataBase64: "[pending-image-bytes-redacted]",
        mimeType: "image/png" as const,
      })),
    ];
    // The preview exists to show what the run would send, so it reads the same org setting the run
    // path reads. Diverging here would let an operator sign off on a request shape production never
    // sends — the exact failure this preview is meant to catch.
    const assistantsEnabled = await assistantsEnabledForOrg(
      this.repository,
      chat.orgId,
    );
    const built = buildCanonicalRunContext({
      agentVersion,
      assistantsEnabled,
      preferences: customization.preferences,
      memories,
      history,
      userContent: runContent,
      knowledgeHits: [...webHits, ...knowledge.hits],
      model,
      ...(input.researchMode === undefined
        ? {}
        : { researchMode: input.researchMode }),
      ...(previewImages.length === 0 ? {} : { userImages: previewImages }),
    });
    const reasoningLayers = await reasoningPolicyLayersForStart(
      this.repository,
      {
        agentParameters: agentVersion.parameters,
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
    const reasoningResolution =
      reasoningLayers === undefined
        ? undefined
        : resolveProviderReasoningPolicy({
            kind: provider.type,
            layers: reasoningLayers,
            model,
            provider,
          });
    return {
      routing: routingDecision,
      model: {
        id: model.id,
        name: model.displayName,
        contextWindow: built.contextWindow,
      },
      ...(reasoningResolution === undefined
        ? {}
        : {
            reasoningPolicy: {
              requested: reasoningResolution.requested,
              effective: reasoningResolution.effective,
              source: reasoningResolution.source,
              rejected: reasoningResolution.rejected,
              adjustments: [...reasoningResolution.adjustments],
            },
          }),
      budget: {
        estimatedInputTokens: built.estimatedInputTokens,
        usableInputTokens: built.usableInputTokens,
        remainingInputTokens: Math.max(
          0,
          built.usableInputTokens - built.estimatedInputTokens,
        ),
      },
      history: {
        includedMessages: built.historyMessages,
        availableMessages: history.length,
        truncated: built.historyTruncated,
      },
      attachments: {
        currentFiles: governedFiles.map((file) => ({
          fileName: file.fileName,
          mimeType: file.mimeType,
        })),
        retainedDocuments: retained.documents.map((file) => file.fileName),
        retainedImages: retained.images.length,
        pendingImages: input.imageCount,
      },
      knowledge: built.citations,
      // Memory rides in the system prompt, which bare mode withholds, so listing it here would
      // advertise context the request does not carry.
      memories: assistantsEnabled
        ? memories.map((memory) => ({
            id: memory.id,
            title: memory.title,
            scope: memory.scope,
          }))
        : [],
      messages: built.messages.map((message) => ({
        role: message.role,
        // The builder output can contain system prompts, retrieved document text,
        // policy instructions, and provider-ready transformations. Keep the
        // compatibility shape and role/image counts without returning that raw
        // request body to a browser client.
        content: "",
        imageCount: message.role === "user" ? (message.images?.length ?? 0) : 0,
      })),
    };
  }
}
