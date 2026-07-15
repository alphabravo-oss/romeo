import {
  assertScope,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";

import type { KnowledgeBase } from "../domain/entities";
import {
  ragPolicyTiers,
  type RagPolicyExternalVectorMode,
  type RagPolicyPhysicalVectorIsolationMode,
  type RagPolicyBudgetMap,
  type RagPolicyTier,
} from "../domain/rag-policy";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { readRagPolicy } from "./rag-policy-service";
import type { KnowledgeRetrievalRoute } from "./knowledge-retrieval-route";

export const knowledgeRetrievalTiers = ragPolicyTiers;

export type KnowledgeRetrievalTier = RagPolicyTier;

export type KnowledgeRetrievalPermissionReason =
  | "admin_override"
  | "direct_use_grant"
  | "group_use_grant"
  | "service_account_use_grant";

export type KnowledgeRetrievalSkippedReason =
  | "missing_use_grant"
  | "not_found"
  | "outside_organization"
  | "outside_workspace"
  | "tier_disabled_by_policy";

export interface KnowledgeRetrievalPlanEntry {
  knowledgeBaseId: string;
  orgId: string;
  workspaceId: string;
  tier: KnowledgeRetrievalTier;
  permissionReason: KnowledgeRetrievalPermissionReason;
  maxResults: number;
  sourceFilter: {
    mode: "authorized_visible_sources";
    connectorOwnerFiltered: boolean;
  };
  retrievalRoute?: KnowledgeRetrievalRoute;
  vectorScope: {
    driver: "pgvector" | "qdrant";
    isolationMode: RagPolicyPhysicalVectorIsolationMode;
    orgId: string;
    workspaceId: string;
    knowledgeBaseId: string;
  };
}

export interface KnowledgeRetrievalPlan {
  entries: KnowledgeRetrievalPlanEntry[];
  posture: KnowledgeRetrievalPosture;
  policy: {
    source: "default" | "org";
    enabledTiers: KnowledgeRetrievalTier[];
    defaultMaxResultsPerTier: RagPolicyBudgetMap;
    maxResultsPerTier: RagPolicyBudgetMap;
    knowledgeBaseTierAssignments: {
      org: string[];
      shared: string[];
    };
    externalVectorStoreMode: RagPolicyExternalVectorMode;
  };
  requestedCount: number;
  authorizedCount: number;
  skipped: {
    count: number;
    reasons: Array<{ reason: KnowledgeRetrievalSkippedReason; count: number }>;
  };
}

export interface KnowledgeRetrievalPosture {
  vectorDriver: "pgvector" | "qdrant";
  isolationMode: RagPolicyPhysicalVectorIsolationMode;
  externalVectorStoreDriver: "disabled" | "qdrant";
  externalVectorStoreConfigured: boolean;
  externalVectorStoreRoutingActive: boolean;
  namespaceConfigured: boolean;
  namespacePolicy: "knowledge_base" | "none" | "org" | "workspace";
  partitioningConfigured: boolean;
  partitioningPolicy: "knowledge_base" | "none" | "org" | "workspace";
}

export interface CompileKnowledgeRetrievalPlanInput {
  knowledgeBaseIds: string[];
  maxResultsPerTier?: Partial<
    Record<KnowledgeRetrievalTier, number | undefined>
  >;
  posture?: KnowledgeRetrievalPosture;
  subject: AuthSubject;
}

const tierOrder: Record<KnowledgeRetrievalTier, number> = {
  user_private: 0,
  workspace: 1,
  org: 2,
  shared: 3,
};

export async function compileKnowledgeRetrievalPlan(
  repository: RomeoRepository,
  input: CompileKnowledgeRetrievalPlanInput,
): Promise<KnowledgeRetrievalPlan> {
  assertScope(input.subject, "knowledge:query");

  const requestedIds = [
    ...new Set(input.knowledgeBaseIds.map((id) => id.trim())),
  ].filter((id) => id.length > 0);
  if (requestedIds.length === 0) {
    throw new ApiError(
      "knowledge_retrieval_plan_empty",
      "No knowledge bases were submitted for tiered retrieval.",
      400,
    );
  }

  const grantsByOrg = new Map<string, ResourceGrant[]>([
    [
      input.subject.orgId,
      await repository.listResourceGrants(input.subject.orgId),
    ],
  ]);
  const ragPolicy = await readRagPolicy(repository, input.subject.orgId);
  const posture = input.posture ?? defaultRetrievalPosture();
  const skipped = new Map<KnowledgeRetrievalSkippedReason, number>();
  const entries: KnowledgeRetrievalPlanEntry[] = [];

  for (const knowledgeBaseId of requestedIds) {
    const knowledgeBase = await repository.getKnowledgeBase(knowledgeBaseId);
    if (knowledgeBase === undefined) {
      addSkipped(skipped, "not_found");
      continue;
    }

    const tier = classifyRetrievalTier(input.subject, knowledgeBase, ragPolicy);
    const grants = await grantsForOrg(
      repository,
      grantsByOrg,
      knowledgeBase.orgId,
    );
    const deniedReason = deniedRetrievalReason(
      input.subject,
      grants,
      knowledgeBase,
      tier,
    );
    if (deniedReason !== undefined) {
      addSkipped(skipped, deniedReason);
      continue;
    }

    if (!ragPolicy.enabledTiers.includes(tier)) {
      addSkipped(skipped, "tier_disabled_by_policy");
      continue;
    }
    const maxResults =
      input.maxResultsPerTier?.[tier] ??
      ragPolicy.defaultMaxResultsPerTier[tier];
    entries.push({
      knowledgeBaseId: knowledgeBase.id,
      orgId: knowledgeBase.orgId,
      workspaceId: knowledgeBase.workspaceId,
      tier,
      permissionReason: retrievalPermissionReason(
        input.subject,
        grants,
        knowledgeBase,
      ),
      maxResults: Math.min(maxResults, ragPolicy.maxResultsPerTier[tier]),
      sourceFilter: {
        mode: "authorized_visible_sources",
        connectorOwnerFiltered: true,
      },
      vectorScope: {
        driver: posture.vectorDriver,
        isolationMode: posture.isolationMode,
        orgId: knowledgeBase.orgId,
        workspaceId: knowledgeBase.workspaceId,
        knowledgeBaseId: knowledgeBase.id,
      },
    });
  }

  entries.sort(
    (left, right) =>
      tierOrder[left.tier] - tierOrder[right.tier] ||
      left.workspaceId.localeCompare(right.workspaceId) ||
      left.knowledgeBaseId.localeCompare(right.knowledgeBaseId),
  );

  const plan: KnowledgeRetrievalPlan = {
    entries,
    posture,
    policy: {
      source: ragPolicy.source,
      enabledTiers: ragPolicy.enabledTiers,
      defaultMaxResultsPerTier: ragPolicy.defaultMaxResultsPerTier,
      maxResultsPerTier: ragPolicy.maxResultsPerTier,
      knowledgeBaseTierAssignments: ragPolicy.knowledgeBaseTierAssignments,
      externalVectorStoreMode: ragPolicy.externalVectorStore.mode,
    },
    requestedCount: requestedIds.length,
    authorizedCount: entries.length,
    skipped: skippedSummary(skipped),
  };

  if (entries.length === 0) {
    throw new ApiError(
      "knowledge_retrieval_plan_empty",
      "No authorized knowledge bases are available for this tiered query.",
      403,
      {
        skipped: plan.skipped,
      },
    );
  }

  return plan;
}

export function defaultRetrievalPosture(): KnowledgeRetrievalPosture {
  return {
    vectorDriver: "pgvector",
    isolationMode: "shared_row_scope",
    externalVectorStoreDriver: "disabled",
    externalVectorStoreConfigured: false,
    externalVectorStoreRoutingActive: false,
    namespaceConfigured: false,
    namespacePolicy: "none",
    partitioningConfigured: false,
    partitioningPolicy: "none",
  };
}

async function grantsForOrg(
  repository: RomeoRepository,
  grantsByOrg: Map<string, ResourceGrant[]>,
  orgId: string,
): Promise<ResourceGrant[]> {
  const existing = grantsByOrg.get(orgId);
  if (existing !== undefined) return existing;
  const grants = await repository.listResourceGrants(orgId);
  grantsByOrg.set(orgId, grants);
  return grants;
}

function deniedRetrievalReason(
  subject: AuthSubject,
  grants: ResourceGrant[],
  knowledgeBase: KnowledgeBase,
  tier: KnowledgeRetrievalTier,
): KnowledgeRetrievalSkippedReason | undefined {
  if (knowledgeBase.orgId !== subject.orgId && tier !== "shared") {
    return "outside_organization";
  }
  if (
    requiresWorkspaceAccess(tier) &&
    !hasWorkspaceAccess(subject, knowledgeBase.workspaceId)
  ) {
    return "outside_workspace";
  }
  if (!hasGrant(subject, grants, "knowledge_base", knowledgeBase.id, "use")) {
    return "missing_use_grant";
  }
  return undefined;
}

function classifyRetrievalTier(
  subject: AuthSubject,
  knowledgeBase: KnowledgeBase,
  policy: Awaited<ReturnType<typeof readRagPolicy>>,
): KnowledgeRetrievalTier {
  if (policy.knowledgeBaseTierAssignments.shared.includes(knowledgeBase.id)) {
    return "shared";
  }
  if (policy.knowledgeBaseTierAssignments.org.includes(knowledgeBase.id)) {
    return "org";
  }
  return knowledgeBase.createdBy === subject.id ? "user_private" : "workspace";
}

function requiresWorkspaceAccess(tier: KnowledgeRetrievalTier): boolean {
  return tier === "user_private" || tier === "workspace";
}

function retrievalPermissionReason(
  subject: AuthSubject,
  grants: ResourceGrant[],
  knowledgeBase: KnowledgeBase,
): KnowledgeRetrievalPermissionReason {
  if (subject.isAdmin === true) return "admin_override";

  const grant = grants.find(
    (candidate) =>
      candidate.resourceType === "knowledge_base" &&
      candidate.resourceId === knowledgeBase.id &&
      candidate.permission === "use" &&
      ((candidate.principalType === subject.type &&
        candidate.principalId === subject.id) ||
        (candidate.principalType === "group" &&
          subject.groupIds.includes(candidate.principalId))),
  );

  if (grant?.principalType === "group") return "group_use_grant";
  if (grant?.principalType === "service_account")
    return "service_account_use_grant";
  return "direct_use_grant";
}

function addSkipped(
  skipped: Map<KnowledgeRetrievalSkippedReason, number>,
  reason: KnowledgeRetrievalSkippedReason,
): void {
  skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
}

function skippedSummary(
  skipped: Map<KnowledgeRetrievalSkippedReason, number>,
): {
  count: number;
  reasons: Array<{ reason: KnowledgeRetrievalSkippedReason; count: number }>;
} {
  const reasons = [...skipped.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => left.reason.localeCompare(right.reason));
  return {
    count: reasons.reduce((total, item) => total + item.count, 0),
    reasons,
  };
}
