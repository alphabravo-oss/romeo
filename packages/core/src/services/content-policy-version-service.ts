import { assertScope, type AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import {
  contentPolicySettingKey,
  type ContentPolicyDetectorActions,
} from "./content-policy-service";
import {
  createPolicyVersionDraft,
  dryRunPolicyVersion,
  publishPolicyVersion,
  publishedDetectors,
  rollbackPolicyVersion,
  type ContentPolicyVersion,
  type ContentPolicyVersionStore,
  type SanitizedPolicyDecision,
} from "./content-policy-versioning";

const STORE_SCHEMA = "romeo.content-policy.versions.v1";
const DECISION_SCHEMA = "romeo.content-policy.decisions.v1";

export class ContentPolicyVersionService {
  constructor(private readonly repository: RomeoRepository) {}

  async list(subject: AuthSubject): Promise<ContentPolicyVersion[]> {
    assertScope(subject, "admin:read");
    return (await this.readStore(subject.orgId)).versions;
  }

  async createDraft(input: {
    subject: AuthSubject;
    detectors: ContentPolicyDetectorActions;
    approvalRequired?: boolean;
    approvalTtlSeconds?: number;
  }): Promise<ContentPolicyVersion> {
    assertScope(input.subject, "admin:write");
    const now = new Date().toISOString();
    const store = createPolicyVersionDraft({
      store: await this.readStore(input.subject.orgId),
      id: createId("policy_version"),
      now,
      actorId: input.subject.id,
      detectors: input.detectors,
      ...(input.approvalRequired === undefined
        ? {}
        : { approvalRequired: input.approvalRequired }),
      ...(input.approvalTtlSeconds === undefined
        ? {}
        : { approvalTtlSeconds: input.approvalTtlSeconds }),
    });
    const created = store.versions[store.versions.length - 1]!;
    await this.writeStore(input.subject.orgId, store, now);
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action: "admin.content_policy.version.create",
      resourceType: "content_policy",
      resourceId: created.id,
      metadata: { version: created.version, state: created.state },
    });
    return created;
  }

  async dryRun(input: {
    subject: AuthSubject;
    versionId: string;
    content: string;
  }) {
    assertScope(input.subject, "admin:write");
    const version = await this.requireVersion(input.subject.orgId, input.versionId);
    const now = new Date().toISOString();
    const result = dryRunPolicyVersion({
      version,
      content: input.content,
      decisionId: createId("policy_decision"),
      now,
    });
    await this.appendDecision(input.subject.orgId, result.decision, now);
    return {
      ...result.evaluation,
      evaluatedAt: now,
      versionId: version.id,
      redaction: {
        rawContentReturned: false as const,
        rawMatchesReturned: false as const,
      },
    };
  }

  async publish(input: {
    subject: AuthSubject;
    versionId: string;
  }): Promise<ContentPolicyVersion> {
    assertScope(input.subject, "admin:write");
    const now = new Date().toISOString();
    const published = publishPolicyVersion({
      store: await this.readStore(input.subject.orgId),
      versionId: input.versionId,
      now,
      actorId: input.subject.id,
    });
    if (published.outcome === "denied")
      throw new ApiError(
        published.code,
        "Only a draft or staged content-policy version can be published.",
        409,
      );
    await this.writeStore(input.subject.orgId, published.store, now);
    await this.applyPublished(input.subject.orgId, published.store, now, input.subject.id);
    const version = published.store.versions.find((item) => item.id === input.versionId)!;
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action: "admin.content_policy.version.publish",
      resourceType: "content_policy",
      resourceId: version.id,
      metadata: { version: version.version, state: version.state },
    });
    return version;
  }

  async rollback(input: {
    subject: AuthSubject;
    versionId?: string;
  }): Promise<ContentPolicyVersion> {
    assertScope(input.subject, "admin:write");
    const now = new Date().toISOString();
    const rolled = rollbackPolicyVersion({
      store: await this.readStore(input.subject.orgId),
      ...(input.versionId === undefined ? {} : { versionId: input.versionId }),
      now,
      actorId: input.subject.id,
    });
    if (rolled.outcome === "denied")
      throw new ApiError(
        rolled.code,
        "No published content-policy version is available to roll back to.",
        409,
      );
    await this.writeStore(input.subject.orgId, rolled.store, now);
    await this.applyPublished(input.subject.orgId, rolled.store, now, input.subject.id);
    const version = rolled.store.versions.find(
      (item) => item.id === rolled.store.publishedVersionId,
    )!;
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action: "admin.content_policy.rollback",
      resourceType: "content_policy",
      resourceId: version.id,
      metadata: { version: version.version, state: version.state },
    });
    return version;
  }

  async listDecisions(subject: AuthSubject): Promise<SanitizedPolicyDecision[]> {
    assertScope(subject, "admin:read");
    return this.readDecisions(subject.orgId);
  }

  publicVersion(version: ContentPolicyVersion) {
    return {
      id: version.id,
      version: version.version,
      state: version.state,
      detectors: { ...version.detectors },
      approvalRequired: version.approvalRequired,
      approvalTtlSeconds: version.approvalTtlSeconds,
      createdAt: version.createdAt,
      ...(version.publishedAt === undefined ? {} : { publishedAt: version.publishedAt }),
    };
  }

  private async applyPublished(
    orgId: string,
    store: ContentPolicyVersionStore,
    now: string,
    actorId: string,
  ): Promise<void> {
    const detectors = publishedDetectors(store);
    if (detectors === undefined) return;
    await this.repository.upsertSystemSetting({
      key: contentPolicySettingKey(orgId),
      value: {
        schema: "romeo.content-policy.v1",
        orgId,
        detectors: { ...detectors },
        updatedAt: now,
        updatedBy: actorId,
      },
      updatedAt: now,
    });
  }

  private async requireVersion(
    orgId: string,
    versionId: string,
  ): Promise<ContentPolicyVersion> {
    const version = (await this.readStore(orgId)).versions.find(
      (item) => item.id === versionId,
    );
    if (version === undefined) throw notFound("Content policy version");
    return version;
  }

  private async readStore(orgId: string): Promise<ContentPolicyVersionStore> {
    const value = (await this.repository.getSystemSetting(storeKey(orgId)))?.value;
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return { versions: [] };
    const candidate = value as Record<string, unknown>;
    if (candidate.schema !== STORE_SCHEMA || candidate.orgId !== orgId)
      return { versions: [] };
    return {
      ...(typeof candidate.publishedVersionId === "string"
        ? { publishedVersionId: candidate.publishedVersionId }
        : {}),
      ...(typeof candidate.stagedVersionId === "string"
        ? { stagedVersionId: candidate.stagedVersionId }
        : {}),
      versions: Array.isArray(candidate.versions)
        ? (candidate.versions as ContentPolicyVersion[])
        : [],
    };
  }

  private async writeStore(
    orgId: string,
    store: ContentPolicyVersionStore,
    now: string,
  ): Promise<void> {
    await this.repository.upsertSystemSetting({
      key: storeKey(orgId),
      value: { schema: STORE_SCHEMA, orgId, ...store },
      updatedAt: now,
    });
  }

  private async readDecisions(orgId: string): Promise<SanitizedPolicyDecision[]> {
    const value = (await this.repository.getSystemSetting(decisionKey(orgId)))?.value;
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return [];
    const candidate = value as Record<string, unknown>;
    return Array.isArray(candidate.decisions)
      ? (candidate.decisions as SanitizedPolicyDecision[])
      : [];
  }

  private async appendDecision(
    orgId: string,
    decision: SanitizedPolicyDecision,
    now: string,
  ): Promise<void> {
    const decisions = [...(await this.readDecisions(orgId)), decision].slice(-100);
    await this.repository.upsertSystemSetting({
      key: decisionKey(orgId),
      value: { schema: DECISION_SCHEMA, orgId, decisions },
      updatedAt: now,
    });
  }

}

function storeKey(orgId: string): string {
  return `content_policy.versions.v1:${orgId}`;
}

function decisionKey(orgId: string): string {
  return `content_policy.decisions.v1:${orgId}`;
}
