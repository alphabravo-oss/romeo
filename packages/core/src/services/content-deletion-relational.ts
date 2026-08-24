import type { AuthSubject } from "@romeo/auth";

import type { ContentDeletionOperation } from "../domain/entities";
import { tombstoneFileObject } from "../domain/file-tombstone";
import type { RomeoRepository } from "../domain/repository";
import { deletionFailure } from "./content-deletion-support";
import { transitionFileLifecycle } from "./file-lifecycle";
import { readRagPolicy } from "./rag-policy-service";
import { recordSubjectUsage } from "./record-usage";
import { writeAuditLog } from "./audit-log";

export async function deleteContentRelational(input: {
  repository: RomeoRepository;
  operation: ContentDeletionOperation;
  now: string;
}): Promise<void> {
  const subject = requesterSubject(input.operation);
  if (input.operation.targetType === "file_object") {
    await deleteFileRelational(
      input.repository,
      input.operation,
      subject,
      input.now,
    );
    return;
  }
  await deleteKnowledgeRelational(input.repository, input.operation, subject);
}

async function deleteFileRelational(
  repository: RomeoRepository,
  operation: ContentDeletionOperation,
  subject: AuthSubject,
  now: string,
) {
  const file = await repository.getFileObject(operation.targetId);
  if (file === undefined || file.status !== "deletion_pending")
    throw deletionFailure("content_deletion_target_missing");
  await repository.updateFileObject(
    tombstoneFileObject(transitionFileLifecycle(file, "deleted", now), now),
  );
  await writeAuditLog(repository, {
    subject,
    action: "file.delete",
    resourceType: "file_object",
    resourceId: file.id,
    metadata: {
      mimeType: file.mimeType,
      purpose: file.purpose,
      sizeBytes: file.sizeBytes,
      workspaceId: file.workspaceId,
    },
  });
}

async function deleteKnowledgeRelational(
  repository: RomeoRepository,
  operation: ContentDeletionOperation,
  subject: AuthSubject,
) {
  if (operation.knowledgeBaseId === undefined)
    throw deletionFailure("content_deletion_target_invalid");
  const [source, chunks, embeddings, ragPolicy] = await Promise.all([
    repository.getKnowledgeSource(operation.targetId),
    repository.listKnowledgeChunks(operation.knowledgeBaseId),
    repository.listKnowledgeChunkEmbeddings(operation.knowledgeBaseId),
    readRagPolicy(repository, operation.orgId),
  ]);
  if (source === undefined || source.status !== "deletion_pending")
    throw deletionFailure("content_deletion_target_missing");
  const chunkCount = chunks.filter(
    (chunk) => chunk.sourceId === source.id,
  ).length;
  const embeddingCount = embeddings.filter(
    (embedding) => embedding.sourceId === source.id,
  ).length;
  await repository.deleteKnowledgeChunkEmbeddingsForSource(source.id);
  await repository.deleteKnowledgeChunksForSource(source.id);
  if (!(await repository.deleteKnowledgeSource(source.id)))
    throw deletionFailure("content_deletion_target_missing");
  const metadata = {
    chunkCount,
    deleteVectorsOnSourceDelete:
      ragPolicy.retention.deleteVectorsOnSourceDelete,
    embeddingCount,
    exportIncludesEmbeddingVectors:
      ragPolicy.retention.exportIncludesEmbeddingVectors,
    knowledgeBaseId: operation.knowledgeBaseId,
    objectDeleted: operation.objectKey !== undefined,
    ragPolicySource: ragPolicy.source,
  };
  await recordSubjectUsage(repository, subject, {
    orgId: operation.orgId,
    workspaceId: operation.workspaceId,
    sourceType: "storage",
    sourceId: source.id,
    metric: "storage.source_deleted",
    quantity: source.sizeBytes,
    unit: "byte",
    metadata,
  });
  await writeAuditLog(repository, {
    subject,
    action: "knowledge.source.delete",
    resourceType: "knowledge_source",
    resourceId: source.id,
    metadata: {
      actorSubjectType: subject.type,
      ...metadata,
      ...(subject.type === "service_account"
        ? { serviceAccountId: subject.id }
        : {}),
      sourceId: source.id,
      workspaceId: operation.workspaceId,
    },
  });
}

function requesterSubject(operation: ContentDeletionOperation): AuthSubject {
  return {
    id: operation.requestedById,
    type: operation.requestedByType,
    orgId: operation.orgId,
    workspaceIds: [operation.workspaceId],
    groupIds: [],
    scopes: [],
  };
}
