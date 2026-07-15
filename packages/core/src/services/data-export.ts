import { createHash } from "node:crypto";

import {
  AuthorizationError,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type {
  DataExportCounts,
  DataExportDocument,
  DataExportLimits,
  DataExportPreview,
  DataExportRequest,
  DataExportResolvedRequest,
  ExportedObjectBytes,
  BackgroundJob,
  FileObject,
  KnowledgeSource,
  Workspace,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { readRagPolicy } from "./rag-policy-service";
import { publicUsageEvent } from "./voice-artifact-metadata";

const defaultMaxObjectBytes = 1_000_000;
const hardMaxObjectBytes = 5_000_000;
const maxTotalObjectBytes = 10_000_000;

const exclusions = [
  "object_store_keys",
  "embedding_vectors",
  "provider_payloads",
  "connector_secret_refs",
  "connector_raw_config",
  "webhook_payloads",
  "background_job_payloads",
  "operational_logs",
  "backup_locations",
];

export async function previewDataExport(input: {
  repository: RomeoRepository;
  subject: AuthSubject;
  request: DataExportRequest;
}): Promise<DataExportPreview> {
  const request = normalizeDataExportRequest(input.request);
  const collected = await collectDataExport({
    repository: input.repository,
    subject: input.subject,
    request,
    includeData: false,
  });
  return {
    schema: "romeo.data-export-preview.v1",
    orgId: input.subject.orgId,
    request,
    counts: collected.counts,
    limits: exportLimits(request),
    warnings: warningsFor(request, collected.counts),
    exclusions,
    previewedAt: new Date().toISOString(),
  };
}

export async function executeDataExport(input: {
  repository: RomeoRepository;
  objectStore: ObjectStore;
  subject: AuthSubject;
  request: DataExportRequest;
}): Promise<DataExportDocument> {
  const request = normalizeDataExportRequest(input.request);
  const collected = await collectDataExport({
    repository: input.repository,
    objectStore: input.objectStore,
    subject: input.subject,
    request,
    includeData: true,
  });
  return {
    schema: "romeo.data-export.v1",
    orgId: input.subject.orgId,
    request,
    counts: collected.counts,
    limits: exportLimits(request),
    warnings: warningsFor(request, collected.counts),
    exclusions,
    data: collected.data,
    exportedAt: new Date().toISOString(),
  };
}

function normalizeDataExportRequest(
  request: DataExportRequest,
): DataExportResolvedRequest {
  if (request.scope !== "org" && request.scope !== "workspace") {
    throw new ApiError(
      "invalid_data_export_scope",
      "Data export scope must be org or workspace.",
      400,
    );
  }
  if (request.scope === "workspace" && request.workspaceId === undefined) {
    throw new ApiError(
      "data_export_workspace_required",
      "workspaceId is required for workspace data exports.",
      400,
    );
  }
  if (request.scope === "org" && request.workspaceId !== undefined) {
    throw new ApiError(
      "data_export_workspace_not_allowed",
      "workspaceId can only be supplied for workspace data exports.",
      400,
    );
  }
  const maxObjectBytes = request.maxObjectBytes ?? defaultMaxObjectBytes;
  if (
    !Number.isInteger(maxObjectBytes) ||
    maxObjectBytes < 0 ||
    maxObjectBytes > hardMaxObjectBytes
  ) {
    throw new ApiError(
      "invalid_data_export_object_limit",
      `maxObjectBytes must be an integer between 0 and ${hardMaxObjectBytes}.`,
      400,
    );
  }
  return {
    scope: request.scope,
    ...(request.workspaceId === undefined
      ? {}
      : { workspaceId: request.workspaceId }),
    includeContent: request.includeContent === true,
    includeObjectBytes: request.includeObjectBytes === true,
    maxObjectBytes,
  };
}

async function collectDataExport(input: {
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
          parts: parts.map((part) => ({
            id: part.id,
            type: part.type,
            content: maybeContent(part.content, false),
            metadata: safeObject(part.metadata),
          })),
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

async function selectedWorkspaces(input: {
  repository: RomeoRepository;
  subject: AuthSubject;
  request: DataExportResolvedRequest;
}): Promise<Workspace[]> {
  if (input.request.scope === "workspace") {
    const workspace = await input.repository.getWorkspace(
      input.request.workspaceId!,
    );
    if (workspace === undefined) throw notFound("Workspace");
    if (workspace.orgId !== input.subject.orgId) {
      throw new AuthorizationError(
        "The workspace is outside the caller organization.",
      );
    }
    if (!hasWorkspaceAccess(input.subject, workspace.id)) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }
    return [workspace];
  }
  const workspaces = await input.repository.listWorkspaces(input.subject.orgId);
  return workspaces.filter((workspace) =>
    hasWorkspaceAccess(input.subject, workspace.id),
  );
}

async function exportFileObjectBytes(input: {
  file: FileObject;
  objectStore: ObjectStore | undefined;
  request: DataExportResolvedRequest;
  objectBudget: { totalIncludedBytes: number };
}): Promise<ExportedObjectBytes> {
  return exportObjectBytes({
    objectKey: input.file.objectKey,
    declaredSizeBytes: input.file.sizeBytes,
    declaredSha256: input.file.sha256,
    objectStore: input.objectStore,
    request: input.request,
    objectBudget: input.objectBudget,
  });
}

async function exportKnowledgeSourceBytes(input: {
  source: KnowledgeSource;
  objectStore: ObjectStore | undefined;
  request: DataExportResolvedRequest;
  objectBudget: { totalIncludedBytes: number };
}): Promise<ExportedObjectBytes> {
  if (input.source.objectKey === undefined) {
    return { included: false, reason: "missing_object" };
  }
  return exportObjectBytes({
    objectKey: input.source.objectKey,
    declaredSizeBytes: input.source.sizeBytes,
    objectStore: input.objectStore,
    request: input.request,
    objectBudget: input.objectBudget,
  });
}

async function exportObjectBytes(input: {
  objectKey: string;
  declaredSizeBytes: number;
  declaredSha256?: string;
  objectStore: ObjectStore | undefined;
  request: DataExportResolvedRequest;
  objectBudget: { totalIncludedBytes: number };
}): Promise<ExportedObjectBytes> {
  if (!input.request.includeObjectBytes) {
    return { included: false, reason: "not_requested" };
  }
  if (
    input.declaredSizeBytes > input.request.maxObjectBytes ||
    input.request.maxObjectBytes === 0
  ) {
    return { included: false, reason: "object_too_large" };
  }
  if (
    input.objectBudget.totalIncludedBytes + input.declaredSizeBytes >
    maxTotalObjectBytes
  ) {
    return { included: false, reason: "total_limit_exceeded" };
  }
  const bytes = await input.objectStore?.getObject(input.objectKey);
  if (bytes === undefined) return { included: false, reason: "missing_object" };
  if (bytes.byteLength > input.request.maxObjectBytes) {
    return { included: false, reason: "object_too_large" };
  }
  if (
    input.objectBudget.totalIncludedBytes + bytes.byteLength >
    maxTotalObjectBytes
  ) {
    return { included: false, reason: "total_limit_exceeded" };
  }
  input.objectBudget.totalIncludedBytes += bytes.byteLength;
  return {
    included: true,
    encoding: "base64",
    sizeBytes: bytes.byteLength,
    sha256: input.declaredSha256 ?? sha256Hex(bytes),
    dataBase64: Buffer.from(bytes).toString("base64"),
  };
}

function exportWorkspace(
  workspace: Workspace,
  includeContent: boolean,
): Record<string, unknown> {
  return {
    id: workspace.id,
    orgId: workspace.orgId,
    name: maybeContent(workspace.name, includeContent),
    slug: workspace.slug,
    archivedAt: workspace.archivedAt,
  };
}

function maybeContent(
  value: string | undefined,
  includeContent: boolean,
): Record<string, unknown> {
  if (includeContent && value !== undefined) {
    return { included: true, value };
  }
  return {
    included: false,
    ...(value === undefined
      ? { reason: "absent" }
      : { reason: "not_requested" }),
  };
}

function emptyCounts(): DataExportCounts {
  return {
    workspaces: 0,
    agents: 0,
    promptTemplates: 0,
    chats: 0,
    messages: 0,
    messageParts: 0,
    chatComments: 0,
    knowledgeBases: 0,
    knowledgeSources: 0,
    knowledgeChunks: 0,
    fileObjects: 0,
    fileObjectBytesIncluded: 0,
    knowledgeSourceBytesIncluded: 0,
    dataConnectors: 0,
    dataConnectorSyncs: 0,
    workflows: 0,
    workflowRuns: 0,
    usageEvents: 0,
    backgroundJobs: 0,
  };
}

function emptyData(): DataExportDocument["data"] {
  return {
    workspaces: [],
    agents: [],
    promptTemplates: [],
    chats: [],
    knowledgeBases: [],
    fileObjects: [],
    dataConnectors: [],
    workflows: [],
    usageEvents: [],
    backgroundJobs: [],
    ragVectorPosture: {},
  };
}

function exportLimits(request: DataExportResolvedRequest): DataExportLimits {
  return {
    maxObjectBytes: request.maxObjectBytes,
    maxTotalObjectBytes,
  };
}

function warningsFor(
  request: DataExportResolvedRequest,
  counts: DataExportCounts,
): string[] {
  const warnings = [];
  if (!request.includeContent) {
    warnings.push("customer_content_omitted");
  }
  if (
    !request.includeObjectBytes &&
    counts.fileObjects + counts.knowledgeSources > 0
  ) {
    warnings.push("object_bytes_omitted");
  }
  warnings.push("operational_logs_and_backups_excluded");
  warnings.push("embedding_vectors_excluded");
  return warnings;
}

function exportBackgroundJob(job: BackgroundJob): Record<string, unknown> {
  return {
    id: job.id,
    orgId: job.orgId,
    ...(job.workspaceId === undefined ? {} : { workspaceId: job.workspaceId }),
    type: job.type,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    payload: {
      included: false,
      reason: "background_job_payloads_excluded",
    },
  };
}

function exportRagVectorPosture(
  policy: Awaited<ReturnType<typeof readRagPolicy>>,
): Record<string, unknown> {
  return {
    schema: "romeo.rag-vector-export-posture.v1",
    orgId: policy.orgId,
    source: policy.source,
    enabledTiers: policy.enabledTiers,
    dataResidencyTagCount: policy.dataResidencyTags.length,
    allowedEmbeddingProviderModelCount:
      policy.allowedEmbeddingProviderModels.length,
    knowledgeBaseTierAssignmentCounts: {
      org: policy.knowledgeBaseTierAssignments.org.length,
      shared: policy.knowledgeBaseTierAssignments.shared.length,
    },
    externalVectorStore: {
      mode: policy.externalVectorStore.mode,
      configured: policy.externalVectorStore.configured,
      namespacePolicy: policy.externalVectorStore.namespacePolicy,
      partitioningPolicy: policy.externalVectorStore.partitioningPolicy,
      drStrategy: policy.externalVectorStore.drStrategy,
      exportPolicy: policy.externalVectorStore.exportPolicy,
      restoreValidation: policy.externalVectorStore.restoreValidation,
    },
    physicalVectorIsolation: {
      mode: policy.physicalVectorIsolation.mode,
      enforcement: policy.physicalVectorIsolation.enforcement,
      configured: policy.physicalVectorIsolation.configured,
      postgresAuthoritative:
        policy.physicalVectorIsolation.postgresAuthoritative,
      liveEvidenceRequired: policy.physicalVectorIsolation.liveEvidenceRequired,
    },
    retention: policy.retention,
    enforcement: policy.enforcement,
    redaction: {
      embeddingVectorsIncluded: false,
      externalVectorIdsIncluded: false,
      vectorStoreEndpointsIncluded: false,
      vectorStoreNamespacesIncluded: false,
      vectorStoreCollectionsIncluded: false,
      secretRefsIncluded: false,
    },
  };
}

function safeObject(value: unknown): unknown {
  return sanitizeValue(value, 0);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 8) return "[max_depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value !== "object") return "[unsupported]";
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isSensitiveKey(key))
      .map(([key, nested]) => [key, sanitizeValue(nested, depth + 1)]),
  );
}

function sanitizeString(value: string): string {
  if (isSecretRef(value)) return "[redacted_ref]";
  if (value.length > 10_000) return `${value.slice(0, 10_000)}[truncated]`;
  return value;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return (
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("password") ||
    normalized.includes("credential") ||
    normalized.includes("authorization") ||
    normalized.includes("objectkey") ||
    normalized.includes("storagekey") ||
    normalized.includes("apikey") ||
    normalized.includes("clientsecret") ||
    normalized.includes("refreshtoken")
  );
}

function isSecretRef(value: string): boolean {
  return /^(romeo-secret|vault|env|external-secret|aws-sm|gcp-sm|azure-kv):\/\//u.test(
    value,
  );
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
