import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type {
  DataExportCounts,
  DataExportDocument,
  DataExportResolvedRequest,
  MessagePart,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { readRagPolicy } from "./rag-policy-service";
import { isMessagePartV1 } from "./message-part-v1";
import { publicUsageEvent } from "./voice-artifact-metadata";
import {
  emptyCounts,
  emptyData,
  exportBackgroundJob,
  exportFileObjectBytes,
  exportKnowledgeSourceBytes,
  exportRagVectorPosture,
  exportWorkspace,
  maybeContent,
  safeObject,
  selectedWorkspaces,
  uniqueStrings,
} from "./data-export-support";

export async function collectDataExport(input: {
  repository: RomeoRepository;
  objectStore?: ObjectStore;
  subject: AuthSubject;
  request: DataExportResolvedRequest;
  includeData: boolean;
}): Promise<{
  counts: DataExportCounts;
  data: DataExportDocument["data"];
}> {
  const counts = emptyCounts();
  const data = emptyData();
  const workspaces = await selectedWorkspaces(input);
  const objectBudget = {
    totalIncludedBytes: 0,
  };

  counts.workspaces = workspaces.length;
  if (input.includeData) {
    data.workspaces = workspaces.map((workspace) =>
      exportWorkspace(workspace, input.request.includeContent),
    );
  }

  const allUsageEvents = await input.repository.listUsageEvents(
    input.subject.orgId,
  );
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
  const usageEvents = allUsageEvents.filter(
    (event) =>
      event.workspaceId === undefined || workspaceIds.has(event.workspaceId),
  );
  counts.usageEvents = usageEvents.length;
  if (input.includeData) {
    data.usageEvents = usageEvents.map((event) => {
      const exportedEvent = publicUsageEvent(event);
      return {
        id: exportedEvent.id,
        workspaceId: exportedEvent.workspaceId,
        actorId: exportedEvent.actorId,
        sourceType: exportedEvent.sourceType,
        sourceId: exportedEvent.sourceId,
        metric: exportedEvent.metric,
        quantity: exportedEvent.quantity,
        unit: exportedEvent.unit,
        metadataKeys: Object.keys(exportedEvent.metadata).sort(),
        createdAt: exportedEvent.createdAt,
      };
    });
  }

  const ragPolicy = await readRagPolicy(input.repository, input.subject.orgId);
  if (input.includeData) {
    data.ragVectorPosture = exportRagVectorPosture(ragPolicy);
  }

  const backgroundJobs = await input.repository.listBackgroundJobs(
    input.subject.orgId,
  );
  const exportedBackgroundJobs =
    input.request.scope === "org"
      ? backgroundJobs
      : backgroundJobs.filter(
          (job) => job.workspaceId === input.request.workspaceId,
        );
  counts.backgroundJobs = exportedBackgroundJobs.length;
  if (input.includeData) {
    data.backgroundJobs = exportedBackgroundJobs.map(exportBackgroundJob);
  }

  for (const workspace of workspaces) {
    const [
      agents,
      promptTemplates,
      chats,
      knowledgeBases,
      fileObjects,
      dataConnectors,
      workflows,
    ] = await Promise.all([
      input.repository.listAgents(workspace.id),
      input.repository.listPromptTemplates(input.subject.orgId, workspace.id),
      input.repository.listChats(workspace.id),
      input.repository.listKnowledgeBases(workspace.id),
      input.repository.listFileObjects(input.subject.orgId, workspace.id),
      input.repository.listDataConnectors(input.subject.orgId, workspace.id),
      input.repository.listWorkflowDefinitions(
        input.subject.orgId,
        workspace.id,
      ),
    ]);

    counts.agents += agents.length;
    counts.promptTemplates += promptTemplates.length;
    counts.chats += chats.length;
    counts.knowledgeBases += knowledgeBases.length;
    counts.fileObjects += fileObjects.length;
    counts.dataConnectors += dataConnectors.length;
    counts.workflows += workflows.length;

    if (input.includeData) {
      data.agents.push(
        ...agents.map((agent) => ({
          id: agent.id,
          workspaceId: agent.workspaceId,
          name: maybeContent(agent.name, input.request.includeContent),
          createdBy: agent.createdBy,
          baseModelId: agent.baseModelId,
          parameters: safeObject(agent.parameters),
          memoryPolicy: agent.memoryPolicy,
          safetySettings: safeObject(agent.safetySettings),
          systemPrompt: maybeContent(
            agent.systemPrompt,
            input.request.includeContent,
          ),
          voiceProfileId: agent.voiceProfileId,
          publishedVersionId: agent.publishedVersionId,
          updatedAt: agent.updatedAt,
        })),
      );
      data.promptTemplates.push(
        ...promptTemplates.map((template) => ({
          id: template.id,
          workspaceId: template.workspaceId,
          name: maybeContent(template.name, input.request.includeContent),
          description: maybeContent(
            template.description,
            input.request.includeContent,
          ),
          tags: input.request.includeContent ? template.tags : [],
          visibility: template.visibility,
          createdBy: template.createdBy,
          body: maybeContent(template.body, input.request.includeContent),
          createdAt: template.createdAt,
          updatedAt: template.updatedAt,
        })),
      );
    }

    for (const chat of chats) {
      const [messages, comments] = await Promise.all([
        input.repository.listMessages(chat.id),
        input.repository.listChatComments(chat.id),
      ]);
      const messagesWithParts = [];
      for (const message of messages) {
        const parts = await input.repository.listMessageParts(message.id);
        counts.messageParts += parts.length;
        messagesWithParts.push({
          id: message.id,
          role: message.role,
          content: maybeContent(message.content, input.request.includeContent),
          attachments: (message.attachments ?? []).map((attachment) => ({
            id: attachment.id,
            fileName: maybeContent(
              attachment.fileName,
              input.request.includeContent,
            ),
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            kind: attachment.kind,
          })),
          parts: parts.map((part) =>
            exportMessagePart(part, input.request.includeContent),
          ),
          createdAt: message.createdAt,
        });
      }
      counts.messages += messages.length;
      counts.chatComments += comments.length;
      if (input.includeData) {
        data.chats.push({
          id: chat.id,
          workspaceId: chat.workspaceId,
          title: maybeContent(chat.title, input.request.includeContent),
          createdBy: chat.createdBy,
          archivedAt: chat.archivedAt,
          legalHoldUntil: chat.legalHoldUntil,
          updatedAt: chat.updatedAt,
          messages: messagesWithParts,
          comments: comments.map((comment) => ({
            id: comment.id,
            authorId: comment.authorId,
            body: maybeContent(comment.body, input.request.includeContent),
            mentionedUserIds: comment.mentionedUserIds,
            createdAt: comment.createdAt,
          })),
        });
      }
    }

    for (const knowledgeBase of knowledgeBases) {
      const [sources, chunks, embeddings] = await Promise.all([
        input.repository.listKnowledgeSources(knowledgeBase.id),
        input.repository.listKnowledgeChunks(knowledgeBase.id),
        input.repository.listKnowledgeChunkEmbeddings(knowledgeBase.id),
      ]);
      counts.knowledgeSources += sources.length;
      counts.knowledgeChunks += chunks.length;
      if (input.includeData) {
        const exportedSources = [];
        for (const source of sources) {
          const objectBytes = await exportKnowledgeSourceBytes({
            source,
            objectStore: input.objectStore,
            request: input.request,
            objectBudget,
          });
          if (objectBytes.included) {
            counts.knowledgeSourceBytesIncluded += objectBytes.sizeBytes ?? 0;
          }
          exportedSources.push({
            id: source.id,
            workspaceId: source.workspaceId,
            fileName: maybeContent(
              source.fileName,
              input.request.includeContent,
            ),
            mimeType: source.mimeType,
            sizeBytes: source.sizeBytes,
            status: source.status,
            metadata: safeObject(source.metadata),
            chunkCount: source.chunkCount,
            contentHash: source.contentHash,
            indexedAt: source.indexedAt,
            createdAt: source.createdAt,
            updatedAt: source.updatedAt,
            objectBytes,
          });
        }
        data.knowledgeBases.push({
          id: knowledgeBase.id,
          workspaceId: knowledgeBase.workspaceId,
          name: maybeContent(knowledgeBase.name, input.request.includeContent),
          description: maybeContent(
            knowledgeBase.description,
            input.request.includeContent,
          ),
          createdBy: knowledgeBase.createdBy,
          createdAt: knowledgeBase.createdAt,
          updatedAt: knowledgeBase.updatedAt,
          sources: exportedSources,
          chunks: chunks.map((chunk) => ({
            id: chunk.id,
            sourceId: chunk.sourceId,
            sequence: chunk.sequence,
            content: maybeContent(chunk.content, input.request.includeContent),
            tokenCount: chunk.tokenCount,
            metadata: safeObject(chunk.metadata),
            createdAt: chunk.createdAt,
          })),
          embeddings: {
            count: embeddings.length,
            vectorsIncluded: false,
            providerModels: uniqueStrings(
              embeddings.map(
                (embedding) =>
                  `${embedding.embeddingProvider}:${embedding.embeddingModel}:${embedding.dimensions}`,
              ),
            ),
          },
        });
      }
    }

    if (input.includeData) {
      for (const file of fileObjects) {
        const objectBytes = await exportFileObjectBytes({
          file,
          objectStore: input.objectStore,
          request: input.request,
          objectBudget,
        });
        if (objectBytes.included) {
          counts.fileObjectBytesIncluded += objectBytes.sizeBytes ?? 0;
        }
        data.fileObjects.push({
          id: file.id,
          workspaceId: file.workspaceId,
          ownerType: file.ownerType,
          ownerId: file.ownerId,
          fileName: maybeContent(file.fileName, input.request.includeContent),
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          purpose: file.purpose,
          status: file.status,
          metadata: safeObject(file.metadata),
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
          deletedAt: file.deletedAt,
          objectBytes,
        });
      }
    }

    const syncs = await input.repository.listDataConnectorSyncs(
      input.subject.orgId,
    );
    const connectorIds = new Set(
      dataConnectors.map((connector) => connector.id),
    );
    const workspaceSyncs = syncs.filter((sync) =>
      connectorIds.has(sync.connectorId),
    );
    counts.dataConnectorSyncs += workspaceSyncs.length;
    if (input.includeData) {
      data.dataConnectors.push(
        ...dataConnectors.map((connector) => ({
          id: connector.id,
          workspaceId: connector.workspaceId,
          knowledgeBaseId: connector.knowledgeBaseId,
          type: connector.type,
          name: maybeContent(connector.name, input.request.includeContent),
          status: connector.status,
          configKeys: Object.keys(connector.config).sort(),
          syncIntervalMinutes: connector.syncIntervalMinutes,
          nextSyncAt: connector.nextSyncAt,
          createdBy: connector.createdBy,
          createdAt: connector.createdAt,
          updatedAt: connector.updatedAt,
          lastSyncAt: connector.lastSyncAt,
          syncs: workspaceSyncs
            .filter((sync) => sync.connectorId === connector.id)
            .map((sync) => ({
              id: sync.id,
              status: sync.status,
              itemCount: sync.itemCount,
              sourceIdCount: sync.sourceIds.length,
              summaryKeys: Object.keys(sync.summary).sort(),
              errorCode: sync.errorCode,
              startedAt: sync.startedAt,
              completedAt: sync.completedAt,
            })),
        })),
      );
    }

    for (const workflow of workflows) {
      const runs = await input.repository.listWorkflowRuns(
        input.subject.orgId,
        workflow.id,
      );
      counts.workflowRuns += runs.length;
      if (input.includeData) {
        data.workflows.push({
          id: workflow.id,
          workspaceId: workflow.workspaceId,
          name: maybeContent(workflow.name, input.request.includeContent),
          description: maybeContent(
            workflow.description,
            input.request.includeContent,
          ),
          enabled: workflow.enabled,
          schedule: workflow.schedule,
          createdBy: workflow.createdBy,
          createdAt: workflow.createdAt,
          updatedAt: workflow.updatedAt,
          steps: workflow.steps.map((step) =>
            input.request.includeContent
              ? safeObject(step)
              : {
                  id: step.id,
                  type: step.type,
                  inputKeys: step.inputKeys ?? [],
                  hasPrompt:
                    step.handoffPrompt !== undefined ||
                    step.roomPrompt !== undefined ||
                    step.approvalPrompt !== undefined ||
                    step.task !== undefined ||
                    step.message !== undefined,
                },
          ),
          runs: runs.map((run) => ({
            id: run.id,
            status: run.status,
            createdBy: run.createdBy,
            approvedBy: run.approvedBy,
            inputKeys: Object.keys(run.input).sort(),
            steps: run.steps.map((step) => ({
              stepId: step.stepId,
              type: step.type,
              status: step.status,
              outputKeys: Object.keys(step.output).sort(),
              completedAt: step.completedAt,
            })),
            currentStepId: run.currentStepId,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
            completedAt: run.completedAt,
          })),
        });
      }
    }
  }

  return { counts, data };
}

function exportMessagePart(
  part: MessagePart,
  includeContent: boolean,
): Record<string, unknown> {
  if (!isMessagePartV1(part))
    return {
      id: part.id,
      type: part.type,
      content: maybeContent(part.content, false),
      metadata: safeObject(part.metadata),
    };
  const exported: Record<string, unknown> = { ...part };
  if (part.type === "text")
    exported.text = maybeContent(part.text, includeContent);
  return exported;
}
