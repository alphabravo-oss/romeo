import { createHash } from "node:crypto";

import {
  AuthorizationError,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type {
  BackgroundJob,
  DataExportCounts,
  DataExportDocument,
  DataExportLimits,
  DataExportResolvedRequest,
  ExportedObjectBytes,
  FileObject,
  KnowledgeSource,
  Workspace,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { readRagPolicy } from "./rag-policy-service";

export const maxTotalObjectBytes = 10_000_000;

export async function selectedWorkspaces(input: {
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

export async function exportFileObjectBytes(input: {
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

export async function exportKnowledgeSourceBytes(input: {
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
  const bytes = await input.objectStore?.getObject(input.objectKey, {
    maxBytes: Math.min(
      input.declaredSizeBytes,
      input.request.maxObjectBytes,
      maxTotalObjectBytes,
    ),
  });
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

export function exportWorkspace(
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

export function maybeContent(
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

export function emptyCounts(): DataExportCounts {
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

export function emptyData(): DataExportDocument["data"] {
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

export function exportLimits(
  request: DataExportResolvedRequest,
): DataExportLimits {
  return {
    maxObjectBytes: request.maxObjectBytes,
    maxTotalObjectBytes,
  };
}

export function warningsFor(
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

export function exportBackgroundJob(
  job: BackgroundJob,
): Record<string, unknown> {
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

export function exportRagVectorPosture(
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

export function safeObject(value: unknown): unknown {
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

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
