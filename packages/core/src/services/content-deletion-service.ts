import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type {
  ContentDeletionOperation,
  FileObject,
  KnowledgeBase,
  KnowledgeSource,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import {
  auditContentDeletion,
  contentDeletionRetryDelayMs,
  deletionFailure,
  generationForFile,
  generationForKnowledge,
  legalHoldError,
  operationForFile,
  operationForKnowledge,
  safeDeletionFailureCode,
} from "./content-deletion-support";
import { deleteContentRelational } from "./content-deletion-relational";
import { fileObjectStoredObjectKeys } from "./file-resumable-helpers";
import { transitionFileLifecycle } from "./file-lifecycle";
import type { KnowledgeVectorStore } from "./knowledge-vector-store";
import { startWorkLeaseHeartbeat } from "./work-lease-heartbeat";

const maxAttempts = 10;
const leaseMs = 300_000;

export class ContentDeletionService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly objectStore: ObjectStore,
    private readonly vectorStore?: KnowledgeVectorStore,
  ) {}

  enqueueFile(subject: AuthSubject, file: FileObject) {
    return this.repository.transaction(async (repository) => {
      const existing = await repository.getActiveContentDeletionOperation(
        subject.orgId,
        "file_object",
        file.id,
      );
      if (existing !== undefined) return existing;
      const plan = await repository.getDataDeletionPlan(
        subject.orgId,
        "file_object",
        file.id,
      );
      if (plan?.legalHold !== undefined || file.status === "retained")
        throw legalHoldError();
      if ((await repository.countMessageFileReferences(file.id)) > 0)
        throw new ApiError(
          "file_lifecycle_transition_invalid",
          "A referenced file cannot be deleted before its message references are removed.",
          409,
        );
      const now = new Date().toISOString();
      const current = await repository.getFileObject(file.id);
      if (current === undefined || current.orgId !== subject.orgId)
        throw new Error("content_deletion_target_missing");
      const pending =
        current.status === "deletion_pending"
          ? current
          : transitionFileLifecycle(current, "deletion_pending", now);
      const operation = await repository.createContentDeletionOperation(
        operationForFile(subject, pending, now),
      );
      if (current.status !== "deletion_pending")
        await repository.updateFileObject(pending);
      await auditContentDeletion(
        repository,
        subject,
        operation,
        "content.deletion.intent",
        now,
      );
      return operation;
    });
  }

  enqueueKnowledgeSource(
    subject: AuthSubject,
    knowledgeBase: KnowledgeBase,
    source: KnowledgeSource,
  ) {
    return this.repository.transaction(async (repository) => {
      const existing = await repository.getActiveContentDeletionOperation(
        subject.orgId,
        "knowledge_source",
        source.id,
      );
      if (existing !== undefined) return existing;
      const plan = await repository.getDataDeletionPlan(
        subject.orgId,
        "knowledge_source",
        source.id,
      );
      if (plan?.legalHold !== undefined) throw legalHoldError();
      const now = new Date().toISOString();
      const pending: KnowledgeSource = {
        ...source,
        status: "deletion_pending",
        updatedAt: now,
      };
      const operation = await repository.createContentDeletionOperation(
        operationForKnowledge(
          subject,
          knowledgeBase,
          pending,
          now,
          this.vectorStore !== undefined,
        ),
      );
      await repository.updateKnowledgeSource(pending);
      await auditContentDeletion(
        repository,
        subject,
        operation,
        "content.deletion.intent",
        now,
      );
      return operation;
    });
  }

  async runOnce(input: {
    subject: AuthSubject;
    workerId: string;
    signal?: AbortSignal;
    now?: string;
  }): Promise<{
    operationId?: string;
    outcome: "completed" | "failed" | "idle" | "lease_lost";
  }> {
    input.signal?.throwIfAborted();
    const now = input.now ?? new Date().toISOString();
    const leaseToken = createId("content_delete_lease");
    let operation = await this.repository.claimContentDeletionOperation({
      orgId: input.subject.orgId,
      leaseOwner: input.workerId,
      leaseToken,
      leaseExpiresAt: new Date(Date.parse(now) + leaseMs).toISOString(),
      now,
    });
    if (operation?.lease === undefined) return { outcome: "idle" };
    const lease = operation.lease;
    const heartbeat = startWorkLeaseHeartbeat({
      leaseDurationMs: leaseMs,
      lostError: () => deletionFailure("content_deletion_lease_lost"),
      renew: async (renewal) =>
        (await this.repository.renewContentDeletionOperationLease({
          orgId: operation!.orgId,
          operationId: operation!.id,
          leaseOwner: lease.owner,
          leaseToken: lease.token,
          fencingToken: lease.fencingToken,
          ...renewal,
        })) !== undefined,
    });
    try {
      input.signal?.throwIfAborted();
      if (operation.relationalDeletedAt === undefined) {
        await this.assertCurrentTarget(operation, now);
        if (operation.objectVerifiedAt === undefined) {
          await this.deleteAndVerifyObjects(operation, input.signal);
          heartbeat.assertOwned();
          operation = await this.checkpoint(operation, lease, {
            objectDeletedAt: now,
            objectVerifiedAt: now,
          });
        }
        if (operation.vectorsVerifiedAt === undefined) {
          await this.assertCurrentTarget(operation, new Date().toISOString());
          await this.deleteAndVerifyVectors(operation);
          heartbeat.assertOwned();
          operation = await this.checkpoint(operation, lease, {
            vectorsDeletedAt: now,
            vectorsVerifiedAt: now,
          });
        }
        operation = await this.deleteRelational(operation, lease, now);
      }
      await heartbeat.stop();
      await this.finalize(operation, lease, input.subject, now);
      return { operationId: operation.id, outcome: "completed" };
    } catch (error) {
      await heartbeat.stop({ requireOwned: false });
      const failed = await this.fail(operation, lease, error, now);
      return failed === undefined
        ? { operationId: operation.id, outcome: "lease_lost" }
        : { operationId: operation.id, outcome: "failed" };
    }
  }

  private async assertCurrentTarget(
    operation: ContentDeletionOperation,
    now: string,
    repository: RomeoRepository = this.repository,
  ) {
    const plan = await repository.getDataDeletionPlan(
      operation.orgId,
      operation.targetType,
      operation.targetId,
      now,
    );
    if (plan?.legalHold !== undefined) throw legalHoldError();
    if (operation.targetType === "file_object") {
      const file = await repository.getFileObject(operation.targetId);
      if (file === undefined || file.orgId !== operation.orgId)
        throw deletionFailure("content_deletion_target_missing");
      if (
        file.status !== "deletion_pending" ||
        generationForFile(file) !== operation.targetGeneration
      )
        throw deletionFailure("content_deletion_generation_mismatch");
      if ((await repository.countMessageFileReferences(file.id)) > 0)
        throw legalHoldError();
      return;
    }
    const source = await repository.getKnowledgeSource(operation.targetId);
    if (
      source === undefined ||
      source.orgId !== operation.orgId ||
      source.status !== "deletion_pending" ||
      generationForKnowledge(source) !== operation.targetGeneration
    )
      throw deletionFailure("content_deletion_generation_mismatch");
  }

  private async deleteAndVerifyObjects(
    operation: ContentDeletionOperation,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const keys = await this.objectKeys(operation);
    for (const key of keys) {
      signal?.throwIfAborted();
      await this.objectStore.deleteObject(key);
    }
    if (this.objectStore.headObject === undefined)
      throw deletionFailure("content_deletion_object_verification_unavailable");
    for (const key of keys) {
      signal?.throwIfAborted();
      if ((await this.objectStore.headObject(key)) !== undefined)
        throw deletionFailure("content_deletion_object_still_present");
    }
  }

  private async deleteAndVerifyVectors(operation: ContentDeletionOperation) {
    if (operation.targetType === "file_object") return;
    if (!operation.externalVectorVerificationRequired) return;
    if (this.vectorStore === undefined)
      throw deletionFailure("content_deletion_vector_verification_unavailable");
    if (operation.knowledgeBaseId === undefined)
      throw deletionFailure("content_deletion_target_invalid");
    await this.vectorStore.deleteEmbeddingsForSource({
      knowledgeBaseId: operation.knowledgeBaseId,
      orgId: operation.orgId,
      sourceId: operation.targetId,
      workspaceId: operation.workspaceId,
    });
    if (this.vectorStore.verifyEmbeddingsAbsentForSource === undefined)
      throw deletionFailure("content_deletion_vector_verification_unavailable");
    const absent = await this.vectorStore.verifyEmbeddingsAbsentForSource({
      knowledgeBaseId: operation.knowledgeBaseId,
      orgId: operation.orgId,
      sourceId: operation.targetId,
      workspaceId: operation.workspaceId,
    });
    if (!absent)
      throw deletionFailure("content_deletion_vectors_still_present");
  }

  private async deleteRelational(
    operation: ContentDeletionOperation,
    lease: NonNullable<ContentDeletionOperation["lease"]>,
    now: string,
  ) {
    return this.repository.transaction(async (repository) => {
      await this.assertCurrentTarget(
        operation,
        new Date().toISOString(),
        repository,
      );
      await deleteContentRelational({ repository, operation, now });
      const updated = await repository.updateContentDeletionOperationWithLease({
        operation: { ...operation, relationalDeletedAt: now },
        leaseOwner: lease.owner,
        leaseToken: lease.token,
        fencingToken: lease.fencingToken,
        now,
      });
      if (updated === undefined)
        throw deletionFailure("content_deletion_lease_lost");
      return updated;
    });
  }

  private async finalize(
    operation: ContentDeletionOperation,
    lease: NonNullable<ContentDeletionOperation["lease"]>,
    subject: AuthSubject,
    now: string,
  ) {
    return this.repository.transaction(async (repository) => {
      await auditContentDeletion(
        repository,
        subject,
        operation,
        "content.deletion.attest",
        now,
      );
      const completed =
        await repository.updateContentDeletionOperationWithLease({
          operation: {
            ...operation,
            status: "completed",
            attestedAt: now,
            completedAt: now,
          },
          leaseOwner: lease.owner,
          leaseToken: lease.token,
          fencingToken: lease.fencingToken,
          now,
        });
      if (completed === undefined)
        throw deletionFailure("content_deletion_lease_lost");
      return completed;
    });
  }

  private checkpoint(
    operation: ContentDeletionOperation,
    lease: NonNullable<ContentDeletionOperation["lease"]>,
    patch: Partial<ContentDeletionOperation>,
  ) {
    return this.repository
      .updateContentDeletionOperationWithLease({
        operation: { ...operation, ...patch },
        leaseOwner: lease.owner,
        leaseToken: lease.token,
        fencingToken: lease.fencingToken,
        now: operation.updatedAt,
      })
      .then((updated) => {
        if (updated === undefined)
          throw deletionFailure("content_deletion_lease_lost");
        return updated;
      });
  }

  private fail(
    operation: ContentDeletionOperation,
    lease: NonNullable<ContentDeletionOperation["lease"]>,
    error: unknown,
    now: string,
  ) {
    const exhausted = operation.attempts >= maxAttempts;
    return this.repository.updateContentDeletionOperationWithLease({
      operation: {
        ...operation,
        status: exhausted ? "blocked" : "failed",
        failureCode: safeDeletionFailureCode(error),
        ...(exhausted
          ? {}
          : {
              nextAttemptAt: new Date(
                Date.parse(now) +
                  contentDeletionRetryDelayMs(operation.attempts),
              ).toISOString(),
            }),
      },
      leaseOwner: lease.owner,
      leaseToken: lease.token,
      fencingToken: lease.fencingToken,
      now,
    });
  }

  private async objectKeys(operation: ContentDeletionOperation) {
    if (operation.targetType === "file_object") {
      const file = await this.repository.getFileObject(operation.targetId);
      if (file === undefined) return [];
      return fileObjectStoredObjectKeys(file);
    }
    return operation.objectKey === undefined ? [] : [operation.objectKey];
  }
}
