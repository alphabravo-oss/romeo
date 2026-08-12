import { canAccessOrg, type AuthSubject } from "@romeo/auth";
import {
  disabledRagProvider,
  type RagProvider,
  type RetrievalHit,
} from "@romeo/rag";
import {
  memoryObjectStore,
  type ObjectStore,
  type PresignedUpload,
} from "@romeo/storage";

import type { KnowledgeBase, KnowledgeSource } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import {
  assertKnowledgeWorkspaceAccess,
  createKnowledgeOwnerGrants,
  getAuthorizedKnowledgeBase,
} from "./knowledge-access";
import {
  disabledKnowledgeBinaryExtractor,
  type KnowledgeBinaryExtractor,
  type KnowledgeExtractionJobResult,
} from "./knowledge-extraction-worker";
import type { KnowledgeEmbeddingIndexResult } from "./knowledge-embedding-indexing";
import {
  defaultRetrievalPosture,
  type KnowledgeRetrievalPosture,
  type KnowledgeRetrievalTier,
} from "./knowledge-retrieval-plan";
import type {
  KnowledgeRetrievalReplayCaseInput,
  KnowledgeRetrievalReplayComparisonReport,
  KnowledgeRetrievalReplayReport,
  TieredKnowledgeQueryResult,
} from "./knowledge-replay-reporting";
import { KnowledgeRetrievalService } from "./knowledge-retrieval-service";
import { KnowledgeSourceService } from "./knowledge-source-service";
import { KnowledgeUploadService } from "./knowledge-upload-service";
import type { KnowledgeVectorStore } from "./knowledge-vector-store";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import type { QuotaCoordinator } from "./quota-coordination";
import { ensureSystemAuditActor } from "./system-audit-actor";
import type { WebhookEmitter } from "./webhook-service";
import { assertWorkspaceActive } from "./workspace-guard";
import { canSeeKnowledgeBase } from "./access-visibility";

export type {
  KnowledgeRetrievalReplayCaseInput,
  KnowledgeRetrievalReplayCaseResult,
  KnowledgeRetrievalReplayComparisonReport,
  KnowledgeRetrievalReplayReport,
  TieredKnowledgeQueryResult,
  TieredRetrievalHit,
} from "./knowledge-replay-reporting";

export class KnowledgeService {
  private readonly retrieval: KnowledgeRetrievalService;
  private readonly sources: KnowledgeSourceService;
  private readonly uploads: KnowledgeUploadService;

  constructor(
    private readonly repository: RomeoRepository,
    ragProvider: RagProvider = disabledRagProvider,
    objectStore: ObjectStore = memoryObjectStore,
    binaryExtractor: KnowledgeBinaryExtractor = disabledKnowledgeBinaryExtractor,
    embeddingFetch?: typeof fetch,
    webhooks?: WebhookEmitter,
    retrievalPosture: KnowledgeRetrievalPosture = defaultRetrievalPosture(),
    vectorStore?: KnowledgeVectorStore,
    quotaCoordinator?: QuotaCoordinator,
  ) {
    this.retrieval = new KnowledgeRetrievalService(
      repository,
      ragProvider,
      retrievalPosture,
      embeddingFetch,
      vectorStore,
    );
    this.sources = new KnowledgeSourceService(
      repository,
      objectStore,
      vectorStore,
      quotaCoordinator,
      webhooks,
    );
    this.uploads = new KnowledgeUploadService(
      repository,
      objectStore,
      binaryExtractor,
      embeddingFetch,
      vectorStore,
      quotaCoordinator,
      webhooks,
    );
  }

  async list(
    workspaceId: string,
    subject: AuthSubject,
  ): Promise<KnowledgeBase[]> {
    assertKnowledgeWorkspaceAccess(subject, workspaceId, "knowledge:read");
    const knowledgeBases = (
      await this.repository.listKnowledgeBases(workspaceId)
    ).filter((knowledgeBase) => canAccessOrg(subject, knowledgeBase.orgId));
    const [sourcesByBase, agents, grants] = await Promise.all([
      Promise.all(
        knowledgeBases.map((knowledgeBase) =>
          this.repository.listKnowledgeSources(knowledgeBase.id),
        ),
      ),
      this.repository.listAgents(workspaceId),
      this.repository.listResourceGrants(subject.orgId),
    ]);
    const bindings = (
      await Promise.all(
        agents.map((agent) =>
          this.repository.listAgentKnowledgeBindings(agent.id),
        ),
      )
    ).flat();
    const visibleBases =
      subject.isAdmin === true
        ? knowledgeBases
        : knowledgeBases.filter((knowledgeBase) =>
            canSeeKnowledgeBase(subject, grants, knowledgeBase.id),
          );
    return visibleBases.map((knowledgeBase) => {
      const index = knowledgeBases.findIndex(
        (item) => item.id === knowledgeBase.id,
      );
      const sources = sourcesByBase[index] ?? [];
      return {
        ...knowledgeBase,
        dependentAgentCount: new Set(
          bindings
            .filter(
              (binding) =>
                binding.enabled && binding.knowledgeBaseId === knowledgeBase.id,
            )
            .map((binding) => binding.agentId),
        ).size,
        grantCount: grants.filter(
          (grant) =>
            grant.resourceType === "knowledge_base" &&
            grant.resourceId === knowledgeBase.id,
        ).length,
        indexedSourceCount: sources.filter(
          (source) => source.status === "indexed",
        ).length,
        sourceCount: sources.length,
        totalSizeBytes: sources.reduce(
          (total, source) => total + source.sizeBytes,
          0,
        ),
      };
    });
  }

  async create(input: {
    workspaceId: string;
    name: string;
    description?: string;
    /**
     * user_private | workspace | org | shared — org/shared require admin and
     * assign the base in org RAG policy tier lists.
     */
    scope?: "user_private" | "workspace" | "org" | "shared";
    subject: AuthSubject;
  }): Promise<KnowledgeBase> {
    assertKnowledgeWorkspaceAccess(
      input.subject,
      input.workspaceId,
      "knowledge:write",
    );
    await assertWorkspaceActive(this.repository, {
      orgId: input.subject.orgId,
      workspaceId: input.workspaceId,
    });
    const scope = input.scope ?? "workspace";
    if (
      (scope === "org" || scope === "shared") &&
      input.subject.isAdmin !== true
    ) {
      throw new ApiError(
        "knowledge_scope_forbidden",
        "Only administrators can create organization or shared knowledge bases.",
        403,
      );
    }
    return this.repository.transaction(async (repository) => {
      const now = new Date().toISOString();
      const draft: KnowledgeBase = {
        id: createId("kb"),
        orgId: input.subject.orgId,
        workspaceId: input.workspaceId,
        name: input.name,
        createdBy: await persistedSubjectActorId(repository, input.subject, {
          kind: "service_account_knowledge_owner",
          name: "Service Account Knowledge Owner",
        }),
        createdAt: now,
        updatedAt: now,
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
      };
      const knowledgeBase = await repository.createKnowledgeBase(draft);
      await createKnowledgeOwnerGrants(
        repository,
        input.subject,
        knowledgeBase.id,
      );
      if (scope === "org" || scope === "shared") {
        await assignKnowledgeBaseTier(repository, {
          orgId: input.subject.orgId,
          knowledgeBaseId: knowledgeBase.id,
          tier: scope,
          actorId: input.subject.id,
          now,
        });
      }
      await this.audit(
        input.subject,
        "knowledge_base.create",
        knowledgeBase,
        { scope },
        repository,
      );
      return knowledgeBase;
    });
  }

  get(knowledgeBaseId: string, subject: AuthSubject): Promise<KnowledgeBase> {
    return getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId,
      subject,
      scope: "knowledge:read",
      permission: "read",
    });
  }

  async update(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    name?: string;
    description?: string | null;
  }): Promise<KnowledgeBase> {
    const knowledgeBase = await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: input.knowledgeBaseId,
      subject: input.subject,
      scope: "knowledge:write",
      permission: "write",
    });
    await assertWorkspaceActive(this.repository, {
      orgId: knowledgeBase.orgId,
      workspaceId: knowledgeBase.workspaceId,
    });
    const changedFields: string[] = [];
    const next: KnowledgeBase = {
      ...knowledgeBase,
      updatedAt: new Date().toISOString(),
    };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length === 0) {
        throw new ApiError(
          "invalid_knowledge_base_update",
          "A non-empty knowledge base name is required.",
          400,
        );
      }
      next.name = name;
      if (name !== knowledgeBase.name) changedFields.push("name");
    }
    if (input.description !== undefined) {
      const description = input.description?.trim() ?? "";
      if (description.length > 0) next.description = description;
      else delete next.description;
      if (next.description !== knowledgeBase.description) {
        changedFields.push("description");
      }
    }
    if (changedFields.length === 0) return knowledgeBase;
    return this.repository.transaction(async (repository) => {
      const updated = await repository.updateKnowledgeBase(next);
      await this.audit(
        input.subject,
        "knowledge_base.update",
        updated,
        { changedFields },
        repository,
      );
      return updated;
    });
  }

  listSources(
    knowledgeBaseId: string,
    subject: AuthSubject,
  ): Promise<KnowledgeSource[]> {
    return this.sources.list(knowledgeBaseId, subject);
  }

  deleteSource(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    sourceId: string;
  }): Promise<KnowledgeSource> {
    return this.sources.delete(input);
  }

  reindexSource(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    sourceId: string;
    content: string;
    sizeBytes?: number;
  }): Promise<KnowledgeSource> {
    return this.sources.reindex(input);
  }

  createSource(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    fileName: string;
    metadata?: Record<string, unknown>;
    mimeType: string;
    sizeBytes: number;
    content?: string;
  }): Promise<KnowledgeSource> {
    return this.sources.create(input);
  }

  createUpload(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<{ source: KnowledgeSource; upload: PresignedUpload }> {
    return this.uploads.create(input);
  }

  completeUpload(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    sourceId: string;
  }): Promise<KnowledgeSource> {
    return this.uploads.complete(input);
  }

  extractUpload(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    sourceId: string;
  }): Promise<KnowledgeExtractionJobResult> {
    return this.uploads.extract(input);
  }

  indexEmbeddings(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    providerId: string;
    model: string;
    batchSize?: number;
  }): Promise<KnowledgeEmbeddingIndexResult> {
    return this.uploads.indexEmbeddings(input);
  }

  query(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    query: string;
    maxResults?: number;
  }): Promise<RetrievalHit[]> {
    return this.retrieval.query(input);
  }

  queryTiered(input: {
    subject: AuthSubject;
    knowledgeBaseIds: string[];
    query: string;
    maxResultsPerTier?: Partial<
      Record<KnowledgeRetrievalTier, number | undefined>
    >;
  }): Promise<TieredKnowledgeQueryResult> {
    return this.retrieval.queryTiered(input);
  }

  replayTiered(input: {
    subject: AuthSubject;
    cases: KnowledgeRetrievalReplayCaseInput[];
  }): Promise<KnowledgeRetrievalReplayReport> {
    return this.retrieval.replay(input);
  }

  compareTieredReplay(input: {
    subject: AuthSubject;
    baselineCases: KnowledgeRetrievalReplayCaseInput[];
    candidateCases: KnowledgeRetrievalReplayCaseInput[];
  }): Promise<KnowledgeRetrievalReplayComparisonReport> {
    return this.retrieval.compareReplay(input);
  }

  private async audit(
    subject: AuthSubject,
    action: string,
    knowledgeBase: KnowledgeBase,
    metadata: { changedFields?: string[]; scope?: string },
    repository: RomeoRepository,
  ): Promise<void> {
    const actorId =
      subject.type === "user"
        ? subject.id
        : (
            await ensureSystemAuditActor(repository, {
              kind: "service_account_knowledge_base",
              name: "Service Account Knowledge Base Audit",
              orgId: subject.orgId,
            })
          ).id;
    await repository.createAuditLog({
      id: createId("audit"),
      orgId: subject.orgId,
      actorId,
      action,
      resourceType: "knowledge_base",
      resourceId: knowledgeBase.id,
      outcome: "success",
      metadata: {
        actorSubjectType: subject.type,
        descriptionConfigured: knowledgeBase.description !== undefined,
        ...(metadata.changedFields === undefined
          ? {}
          : { changedFields: metadata.changedFields }),
        ...(metadata.scope === undefined ? {} : { scope: metadata.scope }),
        workspaceId: knowledgeBase.workspaceId,
        ...(subject.type === "service_account"
          ? { serviceAccountId: subject.id }
          : {}),
      },
      createdAt: new Date().toISOString(),
    });
  }
}

async function assignKnowledgeBaseTier(
  repository: RomeoRepository,
  input: {
    orgId: string;
    knowledgeBaseId: string;
    tier: "org" | "shared";
    actorId: string;
    now: string;
  },
): Promise<void> {
  const { applyPolicyPatch, defaultStoredPolicy } = await import(
    "./rag-policy-normalization"
  );
  const { readStoredRagPolicy, settingKey } = await import(
    "./rag-policy-storage"
  );
  const { serializeStoredPolicy } = await import("./rag-policy-reporting");
  const existing = await readStoredRagPolicy(repository, input.orgId);
  const base = existing ?? defaultStoredPolicy(input.orgId);
  const org = [...base.knowledgeBaseTierAssignments.org].filter(
    (id) => id !== input.knowledgeBaseId,
  );
  const shared = [...base.knowledgeBaseTierAssignments.shared].filter(
    (id) => id !== input.knowledgeBaseId,
  );
  if (input.tier === "org") org.push(input.knowledgeBaseId);
  else shared.push(input.knowledgeBaseId);
  const updated = applyPolicyPatch(
    base,
    { knowledgeBaseTierAssignments: { org, shared } },
    input.now,
    input.actorId,
  );
  await repository.upsertSystemSetting({
    key: settingKey(input.orgId),
    value: serializeStoredPolicy(updated),
    updatedAt: input.now,
  });
}
