import { createHash } from "node:crypto";

import type { AuthSubject } from "@romeo/auth";

import type {
  ContentDeletionOperation,
  FileObject,
  KnowledgeBase,
  KnowledgeSource,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { ensureSystemAuditActor } from "./system-audit-actor";

export function operationForFile(
  subject: AuthSubject,
  file: FileObject,
  now: string,
): ContentDeletionOperation {
  return baseOperation(subject, file, generationForFile(file), now, {
    targetType: "file_object",
    objectKey: file.objectKey,
    externalVectorVerificationRequired: false,
  });
}

export function operationForKnowledge(
  subject: AuthSubject,
  base: KnowledgeBase,
  source: KnowledgeSource,
  now: string,
  externalVectorVerificationRequired: boolean,
): ContentDeletionOperation {
  return baseOperation(subject, source, generationForKnowledge(source), now, {
    targetType: "knowledge_source",
    knowledgeBaseId: base.id,
    externalVectorVerificationRequired,
    ...(source.objectKey === undefined ? {} : { objectKey: source.objectKey }),
  });
}

export function generationForFile(file: FileObject): string {
  return digest(
    `${file.id}\0${file.objectKey}\0${file.sha256}\0${file.lifecycleVersion ?? 0}`,
  );
}

export function generationForKnowledge(source: KnowledgeSource): string {
  return digest(
    `${source.id}\0${source.objectKey ?? ""}\0${source.contentHash ?? ""}\0${source.updatedAt}`,
  );
}

export async function auditContentDeletion(
  repository: RomeoRepository,
  subject: AuthSubject,
  operation: ContentDeletionOperation,
  action: "content.deletion.intent" | "content.deletion.attest",
  now: string,
) {
  const actorId =
    subject.type === "user"
      ? subject.id
      : (
          await ensureSystemAuditActor(repository, {
            kind: "service_account_content_deletion",
            name: "Service Account Content Deletion Audit",
            orgId: subject.orgId,
          })
        ).id;
  await writeAuditLog(repository, {
    id: createId("audit"),
    orgId: operation.orgId,
    actorId,
    action,
    resourceType: operation.targetType,
    resourceId: operation.targetId,
    outcome: "success",
    metadata: {
      operationId: operation.id,
      targetType: operation.targetType,
      targetGeneration: operation.targetGeneration,
      workspaceId: operation.workspaceId,
      attempts: operation.attempts,
      objectVerified: operation.objectVerifiedAt !== undefined,
      vectorsVerified: operation.vectorsVerifiedAt !== undefined,
      relationalDeleted: operation.relationalDeletedAt !== undefined,
    },
    createdAt: now,
  });
}

export function deletionFailure(code: string) {
  return Object.assign(new Error(code), { code });
}

export function legalHoldError() {
  return new ApiError(
    "data_deletion_legal_hold",
    "Resource is under legal hold and cannot be deleted.",
    409,
  );
}

export function safeDeletionFailureCode(error: unknown): string {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "content_deletion_failed";
  return /^content_deletion_[a-z0-9_]{1,60}$/u.test(code) ||
    code === "data_deletion_legal_hold"
    ? code
    : "content_deletion_failed";
}

export function contentDeletionRetryDelayMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 3_600_000);
}

function baseOperation(
  subject: AuthSubject,
  target: { id: string; orgId: string; workspaceId: string },
  generation: string,
  now: string,
  details: Pick<ContentDeletionOperation, "targetType"> &
    Pick<ContentDeletionOperation, "externalVectorVerificationRequired"> &
    Partial<Pick<ContentDeletionOperation, "objectKey" | "knowledgeBaseId">>,
): ContentDeletionOperation {
  return {
    id: createId("content_delete"),
    orgId: target.orgId,
    workspaceId: target.workspaceId,
    targetType: details.targetType,
    targetId: target.id,
    targetGeneration: generation,
    idempotencyKey: digest(
      `${target.orgId}\0${details.targetType}\0${target.id}\0${generation}`,
    ),
    status: "pending",
    externalVectorVerificationRequired:
      details.externalVectorVerificationRequired,
    ...(details.objectKey === undefined
      ? {}
      : { objectKey: details.objectKey }),
    ...(details.knowledgeBaseId === undefined
      ? {}
      : { knowledgeBaseId: details.knowledgeBaseId }),
    requestedByType: subject.type,
    requestedById: subject.id,
    attempts: 0,
    legalHoldEvaluatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
