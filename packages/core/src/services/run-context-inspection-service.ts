import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type { RomeoRepository } from "../domain/repository";
import {
  appendDocumentContext,
  buildCanonicalRunContext,
  resolveGovernedRunFiles,
  resolveManagedModelCustomization,
  resolveRetainedMessageContext,
} from "./run-context-builder";
import { resolveRunContext } from "./run-context";
import { buildRunKnowledgeContext } from "./run-knowledge";
import { orderChatHistory, pathThroughMessage } from "./run-messages";
import type { RunServiceOptions } from "./run-service-contracts";
import { resolveRunMemories } from "./workspace-content-service";

export interface RunContextInspectionInput {
  subject: AuthSubject;
  chatId: string;
  agentId: string;
  content: string;
  modelId?: string;
  fileIds?: string[];
  imageCount: number;
  webSearch?: boolean;
  urls?: string[];
}

export class RunContextInspectionService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly objectStore: ObjectStore,
    private readonly embeddingFetch: typeof fetch | undefined,
    private readonly options: RunServiceOptions,
  ) {}

  async inspect(input: RunContextInspectionInput) {
    const { chat, agentVersion, model } = await resolveRunContext(
      this.repository,
      input,
    );
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
    const [knowledge, webHits] = await Promise.all([
      buildRunKnowledgeContext(this.repository, {
        agentId: input.agentId,
        subject: input.subject,
        query: runContent,
        safetySettings: agentVersion.safetySettings,
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
    const built = buildCanonicalRunContext({
      agentVersion,
      preferences: customization.preferences,
      memories,
      history,
      userContent: runContent,
      knowledgeHits: [...webHits, ...knowledge.hits],
      model,
      ...(previewImages.length === 0 ? {} : { userImages: previewImages }),
    });
    return {
      model: {
        id: model.id,
        name: model.displayName,
        contextWindow: built.contextWindow,
      },
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
      memories: memories.map((memory) => ({
        id: memory.id,
        title: memory.title,
        scope: memory.scope,
      })),
      messages: built.messages.map((message) => ({
        role: message.role,
        content: message.content,
        imageCount: message.role === "user" ? (message.images?.length ?? 0) : 0,
      })),
    };
  }
}
