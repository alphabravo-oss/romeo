import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RagProvider, RetrievalHit } from "@romeo/rag";

import type { KnowledgeBase } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";
import {
  compileKnowledgeRetrievalPlan,
  type KnowledgeRetrievalPlan,
  type KnowledgeRetrievalPosture,
  type KnowledgeRetrievalTier,
} from "./knowledge-retrieval-plan";
import {
  buildReplayComparisonReport,
  buildReplayReport,
  replayAuditMetadata,
  routeFallbackReasonCounts,
  routeModeCounts,
  scoreReplayCase,
  tierEntryCounts,
  tierHitCounts,
  vectorEmbeddingModels,
  vectorProviderIds,
  type KnowledgeRetrievalReplayCaseInput,
  type KnowledgeRetrievalReplayCaseResult,
  type KnowledgeRetrievalReplayComparisonReport,
  type KnowledgeRetrievalReplayReport,
  type TieredKnowledgeQueryResult,
  type TieredRetrievalHit,
} from "./knowledge-replay-reporting";
import {
  lexicalRetrievalRoute,
  type KnowledgeRetrievalRoute,
} from "./knowledge-retrieval-route";
import {
  filterKnowledgeChunksForSources,
  filterKnowledgeSourcesForSubject,
} from "./knowledge-source-access";
import type { KnowledgeVectorStore } from "./knowledge-vector-store";
import { retrievePersistedVectorHitsWithRoute } from "./knowledge-vector-retrieval";
import { ensureSystemAuditActor } from "./system-audit-actor";

export class KnowledgeRetrievalService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly ragProvider: RagProvider,
    private readonly retrievalPosture: KnowledgeRetrievalPosture,
    private readonly embeddingFetch?: typeof fetch,
    private readonly vectorStore?: KnowledgeVectorStore,
  ) {}

  async query(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    query: string;
    maxResults?: number;
  }): Promise<RetrievalHit[]> {
    const knowledgeBase = await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: input.knowledgeBaseId,
      subject: input.subject,
      scope: "knowledge:query",
      permission: "use",
    });
    return (
      await this.queryKnowledgeBase({
        subject: input.subject,
        knowledgeBase,
        query: input.query,
        ...(input.maxResults === undefined
          ? {}
          : { maxResults: input.maxResults }),
      })
    ).hits;
  }

  async queryTiered(input: {
    subject: AuthSubject;
    knowledgeBaseIds: string[];
    query: string;
    maxResultsPerTier?: Partial<
      Record<KnowledgeRetrievalTier, number | undefined>
    >;
  }): Promise<TieredKnowledgeQueryResult> {
    const startedAt = Date.now();
    const plan = await compileKnowledgeRetrievalPlan(this.repository, {
      subject: input.subject,
      knowledgeBaseIds: input.knowledgeBaseIds,
      ...(input.maxResultsPerTier === undefined
        ? {}
        : { maxResultsPerTier: input.maxResultsPerTier }),
      posture: this.retrievalPosture,
    });
    const groupedResults = await Promise.all(
      plan.entries.map(async (entry) => {
        const knowledgeBase = await this.repository.getKnowledgeBase(
          entry.knowledgeBaseId,
        );
        if (knowledgeBase === undefined) {
          return {
            entry,
            hits: [] as TieredRetrievalHit[],
            route: lexicalRetrievalRoute("no_visible_chunks"),
          };
        }
        const result = await this.queryKnowledgeBase({
          subject: input.subject,
          knowledgeBase,
          query: input.query,
          maxResults: entry.maxResults,
        });
        return {
          entry,
          route: result.route,
          hits: result.hits.map(
            (hit): TieredRetrievalHit => ({
              ...hit,
              knowledgeBaseId: entry.knowledgeBaseId,
              orgId: entry.orgId,
              permissionReason: entry.permissionReason,
              retrievalRoute: result.route,
              tier: entry.tier,
              workspaceId: entry.workspaceId,
            }),
          ),
        };
      }),
    );
    const routes = new Map(
      groupedResults.map((result) => [
        result.entry.knowledgeBaseId,
        result.route,
      ]),
    );
    const enrichedPlan: KnowledgeRetrievalPlan = {
      ...plan,
      entries: plan.entries.map((entry) => ({
        ...entry,
        retrievalRoute:
          routes.get(entry.knowledgeBaseId) ??
          lexicalRetrievalRoute("no_visible_chunks"),
      })),
    };
    const hits = groupedResults.flatMap((result) => result.hits);
    await this.auditQuery(
      input.subject,
      enrichedPlan,
      hits,
      Date.now() - startedAt,
    );
    return { plan: enrichedPlan, hits };
  }

  async replay(input: {
    subject: AuthSubject;
    cases: KnowledgeRetrievalReplayCaseInput[];
  }): Promise<KnowledgeRetrievalReplayReport> {
    assertScope(input.subject, "admin:read");
    const report = await this.runReplayCases(input.subject, input.cases);
    await this.auditReplay(input.subject, report);
    return report;
  }

  async compareReplay(input: {
    subject: AuthSubject;
    baselineCases: KnowledgeRetrievalReplayCaseInput[];
    candidateCases: KnowledgeRetrievalReplayCaseInput[];
  }): Promise<KnowledgeRetrievalReplayComparisonReport> {
    assertScope(input.subject, "admin:read");
    const [baseline, candidate] = await Promise.all([
      this.runReplayCases(input.subject, input.baselineCases),
      this.runReplayCases(input.subject, input.candidateCases),
    ]);
    const report = buildReplayComparisonReport(
      input.subject.orgId,
      baseline,
      candidate,
    );
    await this.auditReplayComparison(input.subject, report);
    return report;
  }

  private async runReplayCases(
    subject: AuthSubject,
    replayCases: KnowledgeRetrievalReplayCaseInput[],
  ): Promise<KnowledgeRetrievalReplayReport> {
    if (replayCases.length === 0) {
      throw new ApiError(
        "knowledge_replay_empty",
        "Retrieval replay requires at least one case.",
        400,
      );
    }
    const cases: KnowledgeRetrievalReplayCaseResult[] = [];
    for (const replayCase of replayCases) {
      const startedAt = Date.now();
      const result = await this.queryTiered({
        subject,
        knowledgeBaseIds: replayCase.knowledgeBaseIds,
        query: replayCase.query,
        ...(replayCase.maxResultsPerTier === undefined
          ? {}
          : { maxResultsPerTier: replayCase.maxResultsPerTier }),
      });
      cases.push(
        scoreReplayCase(
          replayCase,
          result,
          Math.max(0, Date.now() - startedAt),
        ),
      );
    }
    return buildReplayReport(subject.orgId, cases);
  }

  private async queryKnowledgeBase(input: {
    subject: AuthSubject;
    knowledgeBase: KnowledgeBase;
    query: string;
    maxResults?: number;
  }): Promise<{ hits: RetrievalHit[]; route: KnowledgeRetrievalRoute }> {
    const [sources, chunks] = await Promise.all([
      this.repository.listKnowledgeSources(input.knowledgeBase.id),
      this.repository.listKnowledgeChunks(input.knowledgeBase.id),
    ]);
    const visibleSources = filterKnowledgeSourcesForSubject(
      sources,
      input.subject,
    );
    const visibleChunks = filterKnowledgeChunksForSources(
      chunks,
      visibleSources,
    );
    if (visibleChunks.length > 0) {
      return retrievePersistedVectorHitsWithRoute({
        repository: this.repository,
        subject: input.subject,
        knowledgeBase: input.knowledgeBase,
        chunks: visibleChunks,
        sources: visibleSources,
        query: input.query,
        ...(input.maxResults === undefined
          ? {}
          : { maxResults: input.maxResults }),
        ...(this.embeddingFetch === undefined
          ? {}
          : { fetchImpl: this.embeddingFetch }),
        ...(this.vectorStore === undefined
          ? {}
          : { vectorStore: this.vectorStore }),
      });
    }
    const query = {
      orgId: input.knowledgeBase.orgId,
      workspaceId: input.knowledgeBase.workspaceId,
      query: input.query,
      ...(input.maxResults === undefined
        ? {}
        : { maxResults: input.maxResults }),
    };
    return {
      hits: await this.ragProvider.retrieve(query),
      route: {
        mode: "legacy_rag_provider",
        vectorStoreDriver: "none",
        externalVectorStoreAttempted: false,
        externalVectorStoreUsed: false,
        fallbackReason: "no_visible_chunks",
      },
    };
  }

  private async auditQuery(
    subject: AuthSubject,
    plan: KnowledgeRetrievalPlan,
    hits: TieredRetrievalHit[],
    latencyMs: number,
  ): Promise<void> {
    const actorId = await this.auditActorId(subject);
    await this.repository.createAuditLog({
      id: createId("audit"),
      orgId: subject.orgId,
      actorId,
      action: "knowledge.query.tiered",
      resourceType: "knowledge_retrieval_plan",
      resourceId: "tiered_query",
      outcome: "success",
      metadata: {
        actorSubjectType: subject.type,
        authorizedCount: plan.authorizedCount,
        externalVectorStoreConfigured:
          plan.posture.externalVectorStoreConfigured,
        externalVectorStoreDriver: plan.posture.externalVectorStoreDriver,
        externalVectorStoreRoutingActive:
          plan.posture.externalVectorStoreRoutingActive,
        isolationMode: plan.posture.isolationMode,
        knowledgeBaseIds: plan.entries.map((entry) => entry.knowledgeBaseId),
        latencyMs,
        namespaceConfigured: plan.posture.namespaceConfigured,
        namespacePolicy: plan.posture.namespacePolicy,
        partitioningConfigured: plan.posture.partitioningConfigured,
        partitioningPolicy: plan.posture.partitioningPolicy,
        ragPolicyEnabledTiers: plan.policy.enabledTiers,
        ragPolicySource: plan.policy.source,
        requestedCount: plan.requestedCount,
        retrievalFallbackReasons: routeFallbackReasonCounts(plan.entries),
        retrievalRouteModes: routeModeCounts(plan.entries),
        resultCountsByTier: tierHitCounts(hits),
        skipped: plan.skipped,
        tierCounts: tierEntryCounts(plan.entries),
        vectorDriver: plan.posture.vectorDriver,
        vectorEmbeddingModels: vectorEmbeddingModels(plan.entries),
        vectorProviderIds: vectorProviderIds(plan.entries),
        ...(subject.type === "service_account"
          ? { serviceAccountId: subject.id }
          : {}),
      },
      createdAt: new Date().toISOString(),
    });
  }

  private async auditReplay(
    subject: AuthSubject,
    report: KnowledgeRetrievalReplayReport,
  ): Promise<void> {
    await this.repository.createAuditLog({
      id: createId("audit"),
      orgId: subject.orgId,
      actorId: await this.auditActorId(subject),
      action: "knowledge.replay.tiered",
      resourceType: "knowledge_retrieval_replay",
      resourceId: "tiered_replay",
      outcome: "success",
      metadata: replayAuditMetadata(report),
      createdAt: report.generatedAt,
    });
  }

  private async auditReplayComparison(
    subject: AuthSubject,
    report: KnowledgeRetrievalReplayComparisonReport,
  ): Promise<void> {
    await this.repository.createAuditLog({
      id: createId("audit"),
      orgId: subject.orgId,
      actorId: await this.auditActorId(subject),
      action: "knowledge.replay.compare",
      resourceType: "knowledge_retrieval_replay",
      resourceId: "tiered_replay_compare",
      outcome: "success",
      metadata: {
        baseline: replayAuditMetadata(report.baseline),
        candidate: replayAuditMetadata(report.candidate),
        deltas: report.deltas,
        outcome: report.outcome,
        ...(subject.type === "service_account"
          ? { serviceAccountId: subject.id }
          : {}),
      },
      createdAt: report.generatedAt,
    });
  }

  private async auditActorId(subject: AuthSubject): Promise<string> {
    return subject.type === "user"
      ? subject.id
      : (
          await ensureSystemAuditActor(this.repository, {
            kind: "service_account_retrieval",
            name: "Service Account Retrieval Audit",
            orgId: subject.orgId,
          })
        ).id;
  }
}
