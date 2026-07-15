import type { AuthSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { compileKnowledgeRetrievalPlan } from "./knowledge-retrieval-plan";

describe("knowledge retrieval plan", () => {
  it("orders authorized tiers and applies per-tier budgets before retrieval", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = new Date().toISOString();
    const subject: AuthSubject = {
      id: "user_plan_viewer",
      type: "user",
      orgId: "org_default",
      workspaceIds: ["workspace_default"],
      groupIds: ["group_rag"],
      scopes: ["knowledge:query"],
      isAdmin: false,
    };
    await repository.createKnowledgeBase({
      id: "kb_workspace_plan",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Workspace plan",
      createdBy: "user_other",
      createdAt: now,
      updatedAt: now,
    });
    await repository.createKnowledgeBase({
      id: "kb_private_plan",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Private plan",
      createdBy: subject.id,
      createdAt: now,
      updatedAt: now,
    });
    await repository.createKnowledgeBase({
      id: "kb_denied_plan",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Denied plan",
      createdBy: "user_other",
      createdAt: now,
      updatedAt: now,
    });
    await Promise.all([
      repository.createResourceGrant({
        id: "grant_workspace_plan_use",
        resourceType: "knowledge_base",
        resourceId: "kb_workspace_plan",
        principalType: "group",
        principalId: "group_rag",
        permission: "use",
      }),
      repository.createResourceGrant({
        id: "grant_private_plan_use",
        resourceType: "knowledge_base",
        resourceId: "kb_private_plan",
        principalType: "user",
        principalId: subject.id,
        permission: "use",
      }),
    ]);

    const plan = await compileKnowledgeRetrievalPlan(repository, {
      subject,
      knowledgeBaseIds: [
        "kb_workspace_plan",
        "kb_denied_plan",
        "kb_private_plan",
        "kb_missing_plan",
      ],
      maxResultsPerTier: { user_private: 2, workspace: 4 },
    });

    expect(plan.entries.map((entry) => entry.knowledgeBaseId)).toEqual([
      "kb_private_plan",
      "kb_workspace_plan",
    ]);
    expect(plan.entries.map((entry) => [entry.tier, entry.maxResults])).toEqual(
      [
        ["user_private", 2],
        ["workspace", 4],
      ],
    );
    expect(plan.entries.map((entry) => entry.permissionReason)).toEqual([
      "direct_use_grant",
      "group_use_grant",
    ]);
    expect(plan.skipped).toEqual({
      count: 2,
      reasons: [
        { reason: "missing_use_grant", count: 1 },
        { reason: "not_found", count: 1 },
      ],
    });
    expect(plan.posture).toEqual({
      vectorDriver: "pgvector",
      isolationMode: "shared_row_scope",
      externalVectorStoreDriver: "disabled",
      externalVectorStoreConfigured: false,
      externalVectorStoreRoutingActive: false,
      namespaceConfigured: false,
      namespacePolicy: "none",
      partitioningConfigured: false,
      partitioningPolicy: "none",
    });
    expect(plan.policy).toMatchObject({
      source: "default",
      enabledTiers: ["user_private", "workspace", "org", "shared"],
      defaultMaxResultsPerTier: {
        user_private: 5,
        workspace: 5,
        org: 5,
        shared: 5,
      },
      maxResultsPerTier: {
        user_private: 20,
        workspace: 20,
        org: 20,
        shared: 20,
      },
    });
  });

  it("reports active external vector driver and partitioning posture per plan entry", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = new Date().toISOString();
    const subject: AuthSubject = {
      id: "user_plan_qdrant",
      type: "user",
      orgId: "org_default",
      workspaceIds: ["workspace_default"],
      groupIds: [],
      scopes: ["knowledge:query"],
      isAdmin: false,
    };
    await repository.createKnowledgeBase({
      id: "kb_qdrant_plan",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Qdrant plan",
      createdBy: subject.id,
      createdAt: now,
      updatedAt: now,
    });
    await repository.createResourceGrant({
      id: "grant_qdrant_plan_use",
      resourceType: "knowledge_base",
      resourceId: "kb_qdrant_plan",
      principalType: "user",
      principalId: subject.id,
      permission: "use",
    });

    const plan = await compileKnowledgeRetrievalPlan(repository, {
      subject,
      knowledgeBaseIds: ["kb_qdrant_plan"],
      posture: {
        vectorDriver: "qdrant",
        isolationMode: "external_namespace_per_org",
        externalVectorStoreDriver: "qdrant",
        externalVectorStoreConfigured: true,
        externalVectorStoreRoutingActive: true,
        namespaceConfigured: true,
        namespacePolicy: "org",
        partitioningConfigured: true,
        partitioningPolicy: "workspace",
      },
    });

    expect(plan.posture).toMatchObject({
      vectorDriver: "qdrant",
      externalVectorStoreDriver: "qdrant",
      externalVectorStoreConfigured: true,
      externalVectorStoreRoutingActive: true,
      namespaceConfigured: true,
      namespacePolicy: "org",
      partitioningConfigured: true,
      partitioningPolicy: "workspace",
    });
    expect(plan.entries[0]).toMatchObject({
      knowledgeBaseId: "kb_qdrant_plan",
      vectorScope: {
        driver: "qdrant",
        isolationMode: "external_namespace_per_org",
        orgId: "org_default",
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_qdrant_plan",
      },
    });
  });

  it("applies org RAG policy tier disables and result budget caps", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = new Date().toISOString();
    const subject: AuthSubject = {
      id: "user_plan_policy",
      type: "user",
      orgId: "org_default",
      workspaceIds: ["workspace_default"],
      groupIds: [],
      scopes: ["knowledge:query"],
      isAdmin: false,
    };
    await repository.upsertSystemSetting({
      key: "rag_policy.org.v1:org_default",
      updatedAt: now,
      value: {
        version: 1,
        orgId: "org_default",
        enabledTiers: ["workspace"],
        defaultMaxResultsPerTier: {
          user_private: 3,
          workspace: 3,
          org: 3,
          shared: 3,
        },
        maxResultsPerTier: {
          user_private: 3,
          workspace: 2,
          org: 3,
          shared: 3,
        },
        allowedEmbeddingProviderModels: [],
        dataResidencyTags: [],
        updatedAt: now,
        updatedBy: "user_admin",
      },
    });
    await repository.createKnowledgeBase({
      id: "kb_policy_private",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Private policy",
      createdBy: subject.id,
      createdAt: now,
      updatedAt: now,
    });
    await repository.createKnowledgeBase({
      id: "kb_policy_workspace",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Workspace policy",
      createdBy: "user_other",
      createdAt: now,
      updatedAt: now,
    });
    await Promise.all([
      repository.createResourceGrant({
        id: "grant_policy_private",
        resourceType: "knowledge_base",
        resourceId: "kb_policy_private",
        principalType: "user",
        principalId: subject.id,
        permission: "use",
      }),
      repository.createResourceGrant({
        id: "grant_policy_workspace",
        resourceType: "knowledge_base",
        resourceId: "kb_policy_workspace",
        principalType: "user",
        principalId: subject.id,
        permission: "use",
      }),
    ]);

    const plan = await compileKnowledgeRetrievalPlan(repository, {
      subject,
      knowledgeBaseIds: ["kb_policy_private", "kb_policy_workspace"],
      maxResultsPerTier: { workspace: 20 },
    });

    const [entry] = plan.entries;
    expect(entry).toMatchObject({
      knowledgeBaseId: "kb_policy_workspace",
      tier: "workspace",
      maxResults: 2,
    });
    expect(plan.policy.source).toBe("org");
    expect(plan.skipped).toEqual({
      count: 1,
      reasons: [{ reason: "tier_disabled_by_policy", count: 1 }],
    });
  });

  it("classifies policy-assigned org and shared tiers while preserving grant checks", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = new Date().toISOString();
    const subject: AuthSubject = {
      id: "user_plan_org_shared",
      type: "user",
      orgId: "org_default",
      workspaceIds: ["workspace_default"],
      groupIds: ["group_rag"],
      scopes: ["knowledge:query"],
      isAdmin: false,
    };
    await repository.upsertSystemSetting({
      key: "rag_policy.org.v1:org_default",
      updatedAt: now,
      value: {
        version: 1,
        orgId: "org_default",
        enabledTiers: ["workspace", "org", "shared"],
        defaultMaxResultsPerTier: {
          user_private: 3,
          workspace: 3,
          org: 4,
          shared: 5,
        },
        maxResultsPerTier: {
          user_private: 3,
          workspace: 3,
          org: 4,
          shared: 5,
        },
        allowedEmbeddingProviderModels: [],
        knowledgeBaseTierAssignments: {
          org: ["kb_org_policy_plan"],
          shared: ["kb_shared_policy_plan"],
        },
        dataResidencyTags: [],
        updatedAt: now,
        updatedBy: "user_admin",
      },
    });
    await Promise.all([
      repository.createKnowledgeBase({
        id: "kb_workspace_policy_plan",
        orgId: "org_default",
        workspaceId: "workspace_default",
        name: "Team policy",
        createdBy: "user_other",
        createdAt: now,
        updatedAt: now,
      }),
      repository.createKnowledgeBase({
        id: "kb_org_policy_plan",
        orgId: "org_default",
        workspaceId: "workspace_library",
        name: "Org policy",
        createdBy: "user_other",
        createdAt: now,
        updatedAt: now,
      }),
      repository.createKnowledgeBase({
        id: "kb_shared_policy_plan",
        orgId: "org_default",
        workspaceId: "workspace_library",
        name: "Shared policy",
        createdBy: "user_other",
        createdAt: now,
        updatedAt: now,
      }),
      repository.createKnowledgeBase({
        id: "kb_outside_workspace_unassigned",
        orgId: "org_default",
        workspaceId: "workspace_library",
        name: "Unassigned library",
        createdBy: "user_other",
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    await Promise.all(
      [
        "kb_workspace_policy_plan",
        "kb_org_policy_plan",
        "kb_shared_policy_plan",
        "kb_outside_workspace_unassigned",
      ].map((knowledgeBaseId) =>
        repository.createResourceGrant({
          id: `grant_${knowledgeBaseId}`,
          resourceType: "knowledge_base",
          resourceId: knowledgeBaseId,
          principalType: "group",
          principalId: "group_rag",
          permission: "use",
        }),
      ),
    );

    const plan = await compileKnowledgeRetrievalPlan(repository, {
      subject,
      knowledgeBaseIds: [
        "kb_shared_policy_plan",
        "kb_outside_workspace_unassigned",
        "kb_org_policy_plan",
        "kb_workspace_policy_plan",
      ],
    });

    expect(
      plan.entries.map((entry) => [
        entry.knowledgeBaseId,
        entry.tier,
        entry.maxResults,
      ]),
    ).toEqual([
      ["kb_workspace_policy_plan", "workspace", 3],
      ["kb_org_policy_plan", "org", 4],
      ["kb_shared_policy_plan", "shared", 5],
    ]);
    expect(plan.policy.knowledgeBaseTierAssignments).toEqual({
      org: ["kb_org_policy_plan"],
      shared: ["kb_shared_policy_plan"],
    });
    expect(plan.skipped).toEqual({
      count: 1,
      reasons: [{ reason: "outside_workspace", count: 1 }],
    });
  });

  it("allows non-admin cross-org shared libraries only with subject policy assignment and owner grant", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = new Date().toISOString();
    const subject: AuthSubject = {
      id: "user_cross_org_rag",
      type: "user",
      orgId: "org_default",
      workspaceIds: ["workspace_default"],
      groupIds: [],
      scopes: ["knowledge:query"],
      isAdmin: false,
    };

    await repository.createWorkspace({
      id: "workspace_library_cross",
      orgId: "org_library",
      name: "Library",
      slug: "library",
    });
    await repository.upsertSystemSetting({
      key: "rag_policy.org.v1:org_default",
      updatedAt: now,
      value: {
        version: 1,
        orgId: "org_default",
        enabledTiers: ["workspace", "org", "shared"],
        defaultMaxResultsPerTier: {
          user_private: 3,
          workspace: 3,
          org: 3,
          shared: 7,
        },
        maxResultsPerTier: {
          user_private: 3,
          workspace: 3,
          org: 3,
          shared: 7,
        },
        allowedEmbeddingProviderModels: [],
        knowledgeBaseTierAssignments: {
          org: [],
          shared: [
            "kb_cross_org_shared_granted",
            "kb_cross_org_shared_ungranted",
          ],
        },
        dataResidencyTags: [],
        updatedAt: now,
        updatedBy: "user_admin",
      },
    });
    await Promise.all([
      repository.createKnowledgeBase({
        id: "kb_cross_org_shared_granted",
        orgId: "org_library",
        workspaceId: "workspace_library_cross",
        name: "Granted library",
        createdBy: "user_library_admin",
        createdAt: now,
        updatedAt: now,
      }),
      repository.createKnowledgeBase({
        id: "kb_cross_org_shared_ungranted",
        orgId: "org_library",
        workspaceId: "workspace_library_cross",
        name: "Ungranted library",
        createdBy: "user_library_admin",
        createdAt: now,
        updatedAt: now,
      }),
      repository.createKnowledgeBase({
        id: "kb_cross_org_unassigned_granted",
        orgId: "org_library",
        workspaceId: "workspace_library_cross",
        name: "Unassigned library",
        createdBy: "user_library_admin",
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    await Promise.all([
      repository.createResourceGrant({
        id: "grant_cross_org_shared_granted",
        resourceType: "knowledge_base",
        resourceId: "kb_cross_org_shared_granted",
        principalType: "user",
        principalId: subject.id,
        permission: "use",
      }),
      repository.createResourceGrant({
        id: "grant_cross_org_unassigned",
        resourceType: "knowledge_base",
        resourceId: "kb_cross_org_unassigned_granted",
        principalType: "user",
        principalId: subject.id,
        permission: "use",
      }),
    ]);

    const plan = await compileKnowledgeRetrievalPlan(repository, {
      subject,
      knowledgeBaseIds: [
        "kb_cross_org_shared_granted",
        "kb_cross_org_shared_ungranted",
        "kb_cross_org_unassigned_granted",
      ],
    });

    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]).toMatchObject({
      knowledgeBaseId: "kb_cross_org_shared_granted",
      orgId: "org_library",
      workspaceId: "workspace_library_cross",
      tier: "shared",
      permissionReason: "direct_use_grant",
      maxResults: 7,
      vectorScope: {
        orgId: "org_library",
        workspaceId: "workspace_library_cross",
        knowledgeBaseId: "kb_cross_org_shared_granted",
      },
    });
    expect(plan.skipped).toEqual({
      count: 2,
      reasons: [
        { reason: "missing_use_grant", count: 1 },
        { reason: "outside_organization", count: 1 },
      ],
    });
  });
});
