import { assertScope, type AuthSubject } from "@romeo/auth";

import type { QuotaBucket } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import {
  createDisabledQuotaCoordinator,
  toQuotaReservationBucket,
  type QuotaCoordinator,
  type QuotaCoordinationStatus,
} from "./quota-coordination";
import { nextResetAt, resetDueQuotaBuckets } from "./quota-resets";

export class QuotaService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly quotaCoordinator: QuotaCoordinator = createDisabledQuotaCoordinator(),
  ) {}

  async list(subject: AuthSubject): Promise<QuotaBucket[]> {
    assertScope(subject, "admin:read");
    return resetDueQuotaBuckets(
      this.repository,
      await this.repository.listQuotaBuckets(subject.orgId),
    );
  }

  async create(input: {
    subject: AuthSubject;
    scopeType: QuotaBucket["scopeType"];
    scopeId?: string;
    metric: QuotaBucket["metric"];
    limit: number;
    resetInterval: QuotaBucket["resetInterval"];
  }): Promise<QuotaBucket> {
    assertScope(input.subject, "admin:write");
    const scopeId = await this.resolveScopeId(input);
    const duplicate = (
      await this.repository.listQuotaBuckets(input.subject.orgId)
    ).find(
      (bucket) =>
        bucket.scopeType === input.scopeType &&
        bucket.scopeId === scopeId &&
        bucket.metric === input.metric,
    );
    if (duplicate) {
      throw new ApiError(
        "quota_already_exists",
        "A quota bucket already exists for this scope and metric.",
        409,
        {
          metric: input.metric,
          scopeType: input.scopeType,
        },
      );
    }

    const now = new Date().toISOString();
    const resetAt = nextResetAt(input.resetInterval);
    const bucket: QuotaBucket = {
      id: createId("quota"),
      orgId: input.subject.orgId,
      scopeType: input.scopeType,
      scopeId,
      metric: input.metric,
      limit: input.limit,
      used: 0,
      resetInterval: input.resetInterval,
      createdAt: now,
      updatedAt: now,
    };
    if (resetAt !== undefined) bucket.resetAt = resetAt;
    const created = await this.repository.transaction(async (repository) => {
      const saved = await repository.createQuotaBucket(bucket);
      await this.audit(repository, input.subject, "quota.create", saved, {
        limit: saved.limit,
        resetInterval: saved.resetInterval,
      });
      return saved;
    });
    await this.quotaCoordinator.syncBucket(toQuotaReservationBucket(created));
    return created;
  }

  async update(input: {
    subject: AuthSubject;
    quotaBucketId: string;
    limit?: number;
    resetInterval?: QuotaBucket["resetInterval"];
    resetUsage?: boolean;
  }): Promise<QuotaBucket> {
    const bucket = await this.getWritableBucket(
      input.subject,
      input.quotaBucketId,
    );
    const resetInterval = input.resetInterval ?? bucket.resetInterval;
    const resetAt =
      input.resetInterval === undefined
        ? bucket.resetAt
        : nextResetAt(resetInterval);
    const updated: QuotaBucket = {
      ...bucket,
      limit: input.limit ?? bucket.limit,
      resetInterval,
      used: input.resetUsage === true ? 0 : bucket.used,
      updatedAt: new Date().toISOString(),
    };
    if (resetAt === undefined) delete updated.resetAt;
    else updated.resetAt = resetAt;
    const saved = await this.repository.transaction(async (repository) => {
      const persisted = await repository.updateQuotaBucket(updated);
      await this.audit(repository, input.subject, "quota.update", persisted, {
        changedLimit: input.limit !== undefined,
        changedResetInterval: input.resetInterval !== undefined,
        resetUsage: input.resetUsage === true,
        limit: persisted.limit,
        resetInterval: persisted.resetInterval,
      });
      return persisted;
    });
    await this.quotaCoordinator.syncBucket(toQuotaReservationBucket(saved));
    return saved;
  }

  async delete(
    subject: AuthSubject,
    quotaBucketId: string,
  ): Promise<QuotaBucket> {
    const bucket = await this.getWritableBucket(subject, quotaBucketId);
    const deleted = await this.repository.transaction(async (repository) => {
      const removed = await repository.deleteQuotaBucket(quotaBucketId);
      if (!removed) throw notFound("Quota bucket");
      await this.audit(repository, subject, "quota.delete", removed, {
        limit: removed.limit,
        resetInterval: removed.resetInterval,
      });
      return removed;
    });
    await this.quotaCoordinator.deleteBucket(toQuotaReservationBucket(bucket));
    return deleted;
  }

  async coordinationStatus(
    subject: AuthSubject,
  ): Promise<QuotaCoordinationStatus> {
    assertScope(subject, "admin:read");
    return this.quotaCoordinator.status();
  }

  private async getWritableBucket(
    subject: AuthSubject,
    quotaBucketId: string,
  ): Promise<QuotaBucket> {
    assertScope(subject, "admin:write");
    const bucket = (await this.repository.listQuotaBuckets(subject.orgId)).find(
      (item) => item.id === quotaBucketId,
    );
    if (!bucket) throw notFound("Quota bucket");
    return bucket;
  }

  private async resolveScopeId(input: {
    subject: AuthSubject;
    scopeType: QuotaBucket["scopeType"];
    scopeId?: string;
  }): Promise<string> {
    if (input.scopeType === "org") return input.subject.orgId;
    if (input.scopeType === "user") return input.subject.id;
    if (input.scopeId === undefined) {
      throw new ApiError(
        "quota_scope_id_required",
        `Quota scope ${input.scopeType} requires scopeId.`,
        400,
        { scopeType: input.scopeType },
      );
    }

    if (input.scopeType === "workspace") {
      const workspace = (
        await this.repository.listWorkspaces(input.subject.orgId)
      ).find((item) => item.id === input.scopeId);
      if (!workspace) throw notFound("Workspace");
      return workspace.id;
    }

    if (input.scopeType === "api_key") {
      const apiKey = await this.repository.getApiKey(input.scopeId);
      if (!apiKey || apiKey.orgId !== input.subject.orgId)
        throw notFound("API key");
      return apiKey.id;
    }

    if (input.scopeType === "provider") {
      const provider = await this.repository.getProvider(input.scopeId);
      if (!provider || provider.orgId !== input.subject.orgId)
        throw notFound("Provider");
      return provider.id;
    }

    const agent = await this.repository.getAgent(input.scopeId);
    if (!agent || agent.orgId !== input.subject.orgId) throw notFound("Agent");
    return agent.id;
  }

  private async audit(
    repository: RomeoRepository,
    subject: AuthSubject,
    action: string,
    bucket: QuotaBucket,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType: "quota_bucket",
      resourceId: bucket.id,
      metadata: {
        metric: bucket.metric,
        scopeType: bucket.scopeType,
        scopeId: bucket.scopeId,
        ...metadata,
      },
    });
  }
}
