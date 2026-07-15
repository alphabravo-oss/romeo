import { describe, expect, it } from "vitest";
import { createApiKeyToken, hashApiKey } from "@romeo/auth";
import { readEnv } from "@romeo/config";
import { MemoryObjectStore } from "@romeo/storage";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { EnvironmentSecretResolver } from "./services/secret-resolver";

describe("Romeo knowledge ingestion", () => {
  it("indexes inline text sources and returns cited retrieval hits", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const content =
      "Romeo access controls require scoped grants for knowledge bases and provider models.";
    const sourceResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/sources",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "access.md",
          mimeType: "text/markdown",
          sizeBytes: content.length,
          content,
        }),
      },
    );
    const source = await sourceResponse.json();

    const queryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "knowledge scoped grants",
          maxResults: 2,
        }),
      },
    );
    const query = await queryResponse.json();

    const usageResponse = await api.request("/api/v1/usage/events");
    const usage = await usageResponse.json();

    expect(sourceResponse.status).toBe(202);
    expect(source.data.status).toBe("indexed");
    expect(source.data.chunkCount).toBe(1);
    expect(queryResponse.status).toBe(200);
    expect(query.data[0].content).toContain("scoped grants");
    expect(query.data[0].citation.documentId).toBe(source.data.id);
    expect(query.data[0].citation.title).toBe("access.md");
    expect(query.data[0].metadata.embedding).toBeUndefined();
    expect(usage.data[0].metadata.chunkCount).toBe(1);
  });

  it("creates service-account knowledge bases without user foreign-key leakage", async () => {
    const repository = new InMemoryRomeoRepository();
    const token = createApiKeyToken();
    await repository.createServiceAccount({
      id: "service_account_kb_owner",
      orgId: "org_default",
      name: "KB owner",
      scopes: ["knowledge:read", "knowledge:write", "knowledge:query"],
      createdBy: "user_dev_admin",
      createdAt: new Date().toISOString(),
    });
    await repository.createApiKey({
      id: "key_service_account_kb_owner",
      orgId: "org_default",
      serviceAccountId: "service_account_kb_owner",
      name: "KB owner key",
      hashedToken: await hashApiKey(token),
      scopes: ["knowledge:read", "knowledge:write", "knowledge:query"],
      createdAt: new Date().toISOString(),
    });
    const api = createRomeoApi(repository, {
      env: readEnv({ DEV_SEEDED_LOGIN: "false" }),
    });

    const response = await api.request("/api/v1/knowledge-bases", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        name: "Service account corpus",
      }),
    });
    const body = await response.json();
    const content = "Service account corpora should index with FK-safe usage.";
    const sourceResponse = await api.request(
      `/api/v1/knowledge-bases/${body.data.id}/sources`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          fileName: "service-account.md",
          mimeType: "text/markdown",
          sizeBytes: content.length,
          content,
        }),
      },
    );
    const sourceBody = await sourceResponse.json();
    const shareResponse = await api.request(
      `/api/v1/knowledge-bases/${body.data.id}/shares`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          principalType: "user",
          principalId: "user_dev_admin",
          permissions: ["read", "use"],
        }),
      },
    );
    const creator = await repository.getCurrentUser(body.data.createdBy);
    const usageEvents = await repository.listUsageEvents("org_default");
    const sourceUsage = usageEvents.find(
      (event) =>
        event.sourceId === sourceBody.data.id &&
        event.metric === "storage.source_registered",
    );
    const usageActor =
      sourceUsage === undefined
        ? undefined
        : await repository.getCurrentUser(sourceUsage.actorId);
    const grants = await repository.listResourceGrants("org_default");

    expect(response.status).toBe(201);
    expect(sourceResponse.status).toBe(202);
    expect(shareResponse.status).toBe(201);
    expect(sourceBody.data.status).toBe("indexed");
    expect(body.data.createdBy).toMatch(
      /^system_service_account_knowledge_owner_/u,
    );
    expect(sourceUsage?.actorId).toMatch(/^system_service_account_usage_/u);
    expect(usageActor).toMatchObject({
      disabledAt: expect.any(String),
      email: expect.stringContaining("@system.romeo.local"),
    });
    expect(creator).toMatchObject({
      disabledAt: expect.any(String),
      email: expect.stringContaining("@system.romeo.local"),
    });
    expect(grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceType: "knowledge_base",
          resourceId: body.data.id,
          principalType: "service_account",
          principalId: "service_account_kb_owner",
          permission: "read",
        }),
        expect.objectContaining({
          resourceType: "knowledge_base",
          resourceId: body.data.id,
          principalType: "service_account",
          principalId: "service_account_kb_owner",
          permission: "write",
        }),
        expect.objectContaining({
          resourceType: "knowledge_base",
          resourceId: body.data.id,
          principalType: "service_account",
          principalId: "service_account_kb_owner",
          permission: "use",
        }),
      ]),
    );
  });

  it("queries authorized tiers with sanitized retrieval-plan audit metadata", async () => {
    const repository = new InMemoryRomeoRepository();
    const setupApi = createRomeoApi(repository);
    const now = new Date().toISOString();
    await repository.createUser({
      id: "user_rag_viewer",
      orgId: "org_default",
      email: "rag.viewer@romeo.local",
      name: "RAG Viewer",
      role: "user",
    });
    await repository.createGroupMembership({
      groupId: "group_admins",
      userId: "user_rag_viewer",
      orgId: "org_default",
      createdAt: now,
    });
    const token = createApiKeyToken();
    await repository.createApiKey({
      id: "key_rag_viewer",
      orgId: "org_default",
      userId: "user_rag_viewer",
      name: "RAG viewer key",
      hashedToken: await hashApiKey(token),
      scopes: ["audit:read", "knowledge:query"],
      createdAt: now,
    });
    await repository.createKnowledgeBase({
      id: "kb_private_viewer",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Viewer private corpus",
      createdBy: "user_rag_viewer",
      createdAt: now,
      updatedAt: now,
    });
    await repository.createKnowledgeBase({
      id: "kb_workspace_controls",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Workspace controls",
      createdBy: "user_corpus_owner",
      createdAt: now,
      updatedAt: now,
    });
    await repository.createKnowledgeBase({
      id: "kb_org_controls",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Org controls",
      createdBy: "user_org_corpus_owner",
      createdAt: now,
      updatedAt: now,
    });
    await repository.createKnowledgeBase({
      id: "kb_shared_controls",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Shared controls",
      createdBy: "user_shared_corpus_owner",
      createdAt: now,
      updatedAt: now,
    });
    await repository.upsertSystemSetting({
      key: "rag_policy.org.v1:org_default",
      updatedAt: now,
      value: {
        version: 1,
        orgId: "org_default",
        enabledTiers: ["user_private", "workspace", "org", "shared"],
        defaultMaxResultsPerTier: {
          user_private: 1,
          workspace: 1,
          org: 1,
          shared: 1,
        },
        maxResultsPerTier: {
          user_private: 1,
          workspace: 1,
          org: 1,
          shared: 1,
        },
        allowedEmbeddingProviderModels: [],
        knowledgeBaseTierAssignments: {
          org: ["kb_org_controls"],
          shared: ["kb_shared_controls"],
        },
        dataResidencyTags: [],
        updatedAt: now,
        updatedBy: "user_dev_admin",
      },
    });
    await Promise.all([
      repository.createResourceGrant({
        id: "grant_private_viewer_use",
        resourceType: "knowledge_base",
        resourceId: "kb_private_viewer",
        principalType: "user",
        principalId: "user_rag_viewer",
        permission: "use",
      }),
      repository.createResourceGrant({
        id: "grant_workspace_controls_use",
        resourceType: "knowledge_base",
        resourceId: "kb_workspace_controls",
        principalType: "group",
        principalId: "group_admins",
        permission: "use",
      }),
      repository.createResourceGrant({
        id: "grant_org_controls_use",
        resourceType: "knowledge_base",
        resourceId: "kb_org_controls",
        principalType: "group",
        principalId: "group_admins",
        permission: "use",
      }),
      repository.createResourceGrant({
        id: "grant_shared_controls_use",
        resourceType: "knowledge_base",
        resourceId: "kb_shared_controls",
        principalType: "group",
        principalId: "group_admins",
        permission: "use",
      }),
    ]);

    await setupApi.request(
      "/api/v1/knowledge-bases/kb_private_viewer/sources",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "private.md",
          mimeType: "text/markdown",
          sizeBytes: 80,
          content: "auditproof private retrieval plan notes for Romeo.",
        }),
      },
    );
    await setupApi.request("/api/v1/knowledge-bases/kb_org_controls/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "org.md",
        mimeType: "text/markdown",
        sizeBytes: 80,
        content: "auditproof org retrieval plan controls for Romeo.",
      }),
    });
    await setupApi.request(
      "/api/v1/knowledge-bases/kb_shared_controls/sources",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "shared.md",
          mimeType: "text/markdown",
          sizeBytes: 80,
          content: "auditproof shared retrieval plan controls for Romeo.",
        }),
      },
    );
    await setupApi.request(
      "/api/v1/knowledge-bases/kb_workspace_controls/sources",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "workspace.md",
          mimeType: "text/markdown",
          sizeBytes: 80,
          content: "auditproof workspace retrieval plan controls for Romeo.",
        }),
      },
    );

    const api = createRomeoApi(repository, {
      env: readEnv({ DEV_SEEDED_LOGIN: "false" }),
    });
    const authHeaders = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    const queryResponse = await api.request("/api/v1/knowledge-bases/query", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        knowledgeBaseIds: [
          "kb_workspace_controls",
          "kb_private_viewer",
          "kb_org_controls",
          "kb_shared_controls",
          "kb_missing_tiered",
        ],
        query: "auditproof",
        maxResultsPerTier: {
          user_private: 1,
          workspace: 1,
          org: 1,
          shared: 1,
        },
      }),
    });
    const query = await queryResponse.json();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=knowledge.query.tiered",
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    const audit = await auditResponse.json();
    const auditEvent = audit.data.find(
      (event: { action: string }) => event.action === "knowledge.query.tiered",
    );

    expect(queryResponse.status).toBe(200);
    expect(query.data.plan).toMatchObject({
      authorizedCount: 4,
      requestedCount: 5,
      skipped: { count: 1, reasons: [{ reason: "not_found", count: 1 }] },
      policy: {
        knowledgeBaseTierAssignments: {
          org: ["kb_org_controls"],
          shared: ["kb_shared_controls"],
        },
      },
      posture: {
        vectorDriver: "pgvector",
        isolationMode: "shared_row_scope",
        externalVectorStoreDriver: "disabled",
        externalVectorStoreConfigured: false,
        externalVectorStoreRoutingActive: false,
        namespaceConfigured: false,
        namespacePolicy: "none",
        partitioningConfigured: false,
        partitioningPolicy: "none",
      },
    });
    expect(
      query.data.plan.entries.map(
        (entry: {
          knowledgeBaseId: string;
          tier: string;
          permissionReason: string;
        }) => entry,
      ),
    ).toEqual([
      expect.objectContaining({
        knowledgeBaseId: "kb_private_viewer",
        tier: "user_private",
        permissionReason: "direct_use_grant",
        retrievalRoute: {
          mode: "lexical_fallback",
          vectorStoreDriver: "none",
          externalVectorStoreAttempted: false,
          externalVectorStoreUsed: false,
          fallbackReason: "missing_model_scope",
        },
      }),
      expect.objectContaining({
        knowledgeBaseId: "kb_workspace_controls",
        tier: "workspace",
        permissionReason: "group_use_grant",
        retrievalRoute: {
          mode: "lexical_fallback",
          vectorStoreDriver: "none",
          externalVectorStoreAttempted: false,
          externalVectorStoreUsed: false,
          fallbackReason: "missing_model_scope",
        },
      }),
      expect.objectContaining({
        knowledgeBaseId: "kb_org_controls",
        tier: "org",
        permissionReason: "group_use_grant",
        retrievalRoute: {
          mode: "lexical_fallback",
          vectorStoreDriver: "none",
          externalVectorStoreAttempted: false,
          externalVectorStoreUsed: false,
          fallbackReason: "missing_model_scope",
        },
      }),
      expect.objectContaining({
        knowledgeBaseId: "kb_shared_controls",
        tier: "shared",
        permissionReason: "group_use_grant",
        retrievalRoute: {
          mode: "lexical_fallback",
          vectorStoreDriver: "none",
          externalVectorStoreAttempted: false,
          externalVectorStoreUsed: false,
          fallbackReason: "missing_model_scope",
        },
      }),
    ]);
    expect(query.data.hits).toEqual([
      expect.objectContaining({
        knowledgeBaseId: "kb_private_viewer",
        tier: "user_private",
        content: expect.stringContaining("private retrieval plan"),
        retrievalRoute: expect.objectContaining({
          mode: "lexical_fallback",
          fallbackReason: "missing_model_scope",
        }),
      }),
      expect.objectContaining({
        knowledgeBaseId: "kb_workspace_controls",
        tier: "workspace",
        content: expect.stringContaining("workspace retrieval plan"),
        retrievalRoute: expect.objectContaining({
          mode: "lexical_fallback",
          fallbackReason: "missing_model_scope",
        }),
      }),
      expect.objectContaining({
        knowledgeBaseId: "kb_org_controls",
        tier: "org",
        content: expect.stringContaining("org retrieval plan"),
        retrievalRoute: expect.objectContaining({
          mode: "lexical_fallback",
          fallbackReason: "missing_model_scope",
        }),
      }),
      expect.objectContaining({
        knowledgeBaseId: "kb_shared_controls",
        tier: "shared",
        content: expect.stringContaining("shared retrieval plan"),
        retrievalRoute: expect.objectContaining({
          mode: "lexical_fallback",
          fallbackReason: "missing_model_scope",
        }),
      }),
    ]);
    expect(auditResponse.status).toBe(200);
    expect(auditEvent.metadata).toMatchObject({
      actorSubjectType: "user",
      authorizedCount: 4,
      knowledgeBaseIds: [
        "kb_private_viewer",
        "kb_workspace_controls",
        "kb_org_controls",
        "kb_shared_controls",
      ],
      retrievalFallbackReasons: { missing_model_scope: 4 },
      retrievalRouteModes: {
        external_vector: 0,
        legacy_rag_provider: 0,
        lexical_fallback: 4,
        pgvector: 0,
      },
      resultCountsByTier: { user_private: 1, workspace: 1, org: 1, shared: 1 },
      tierCounts: { user_private: 1, workspace: 1, org: 1, shared: 1 },
      vectorEmbeddingModels: [],
      vectorProviderIds: [],
    });
    expect(JSON.stringify(auditEvent.metadata)).not.toContain("auditproof");
    expect(JSON.stringify(auditEvent.metadata)).not.toContain("retrieval plan");
  });

  it("replays tiered retrieval cases with metrics and no raw corpus echo", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository);
    const content =
      "RAG_REPLAY_CORPUS_SENTINEL retrieval replay should measure expected chunks.";
    const sourceResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/sources",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "replay.md",
          mimeType: "text/markdown",
          sizeBytes: content.length,
          content,
        }),
      },
    );
    const source = await sourceResponse.json();
    const queryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "RAG_REPLAY_QUERY_SENTINEL",
          maxResults: 1,
        }),
      },
    );
    const query = await queryResponse.json();
    const expectedChunkId = query.data[0].citation.chunkId;

    const replayResponse = await api.request("/api/v1/admin/rag/replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cases: [
          {
            id: "case_replay",
            knowledgeBaseIds: ["kb_default"],
            query: "RAG_REPLAY_QUERY_SENTINEL",
            expectedChunkIds: [expectedChunkId],
          },
        ],
      }),
    });
    const replay = await replayResponse.json();
    const serialized = JSON.stringify(replay.data);
    const auditLogs = await repository.listAuditLogs("org_default");
    const replayAudit = auditLogs.find(
      (log) => log.action === "knowledge.replay.tiered",
    );

    expect(sourceResponse.status).toBe(202);
    expect(source.data.status).toBe("indexed");
    expect(replayResponse.status).toBe(200);
    expect(replay.data).toMatchObject({
      orgId: "org_default",
      caseCount: 1,
      status: "passed",
      metrics: {
        expectedChunkCount: 1,
        matchedExpectedChunkCount: 1,
      },
      redaction: {
        rawQueriesReturned: false,
        rawChunkTextReturned: false,
        rawExpectedChunkIdsReturned: false,
        rawHitIdsReturned: false,
        vectorValuesReturned: false,
      },
    });
    expect(replay.data.cases[0]).toMatchObject({
      caseId: "case_replay",
      status: "passed",
      expectedChunkCount: 1,
      matchedExpectedChunkCount: 1,
      recall: 1,
    });
    expect(replayAudit?.metadata).toMatchObject({
      caseCount: 1,
      expectedChunkCount: 1,
      matchedExpectedChunkCount: 1,
      status: "passed",
    });
    for (const rawValue of [
      "RAG_REPLAY_CORPUS_SENTINEL",
      "RAG_REPLAY_QUERY_SENTINEL",
      expectedChunkId,
    ]) {
      expect(serialized).not.toContain(rawValue);
      expect(JSON.stringify(replayAudit?.metadata)).not.toContain(rawValue);
    }
  });

  it("compares baseline and candidate tiered retrieval replay without raw corpus echo", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository);
    const content =
      "RAG_REPLAY_COMPARE_CORPUS_SENTINEL retrieval comparison should stay metadata only.";
    await api.request("/api/v1/knowledge-bases/kb_default/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "replay-compare.md",
        mimeType: "text/markdown",
        sizeBytes: content.length,
        content,
      }),
    });
    const queryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "RAG_REPLAY_COMPARE_QUERY_SENTINEL",
          maxResults: 1,
        }),
      },
    );
    const query = await queryResponse.json();
    const expectedChunkId = query.data[0].citation.chunkId;

    const response = await api.request("/api/v1/admin/rag/replay/compare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseline: [
          {
            id: "case_baseline_compare",
            knowledgeBaseIds: ["kb_default"],
            query: "RAG_REPLAY_COMPARE_QUERY_SENTINEL",
            expectedChunkIds: [expectedChunkId],
          },
        ],
        candidate: [
          {
            id: "case_candidate_compare",
            knowledgeBaseIds: ["kb_default"],
            query: "RAG_REPLAY_COMPARE_QUERY_SENTINEL",
            expectedChunkIds: [expectedChunkId],
            maxResultsPerTier: { user_private: 1 },
          },
        ],
      }),
    });
    const body = await response.json();
    const serialized = JSON.stringify(body.data);
    const auditLogs = await repository.listAuditLogs("org_default");
    const compareAudit = auditLogs.find(
      (log) => log.action === "knowledge.replay.compare",
    );
    const serializedAudit = JSON.stringify(compareAudit?.metadata);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      orgId: "org_default",
      baseline: {
        caseCount: 1,
        status: "passed",
        metrics: {
          expectedChunkCount: 1,
          matchedExpectedChunkCount: 1,
        },
      },
      candidate: {
        caseCount: 1,
        status: "passed",
        metrics: {
          expectedChunkCount: 1,
          matchedExpectedChunkCount: 1,
        },
      },
      deltas: {
        averagePrecision: 0,
        averageRecall: 0,
        expectedChunkCount: 0,
        matchedExpectedChunkCount: 0,
      },
      redaction: {
        rawQueriesReturned: false,
        rawChunkTextReturned: false,
        rawExpectedChunkIdsReturned: false,
        rawHitIdsReturned: false,
        vectorValuesReturned: false,
      },
    });
    expect(["improved", "regressed", "unchanged"]).toContain(body.data.outcome);
    expect(compareAudit?.metadata).toMatchObject({
      outcome: body.data.outcome,
      baseline: {
        caseCount: 1,
        expectedChunkCount: 1,
        matchedExpectedChunkCount: 1,
        status: "passed",
      },
      candidate: {
        caseCount: 1,
        expectedChunkCount: 1,
        matchedExpectedChunkCount: 1,
        status: "passed",
      },
      deltas: {
        expectedChunkCount: 0,
        matchedExpectedChunkCount: 0,
      },
    });
    for (const rawValue of [
      "RAG_REPLAY_COMPARE_CORPUS_SENTINEL",
      "RAG_REPLAY_COMPARE_QUERY_SENTINEL",
      expectedChunkId,
    ]) {
      expect(serialized).not.toContain(rawValue);
      expect(serializedAudit).not.toContain(rawValue);
    }
  });

  it("fails closed without echoing denied knowledge-base ids when no tier is authorized", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = new Date().toISOString();
    await repository.createUser({
      id: "user_rag_denied",
      orgId: "org_default",
      email: "rag.denied@romeo.local",
      name: "RAG Denied",
      role: "user",
    });
    const token = createApiKeyToken();
    await repository.createApiKey({
      id: "key_rag_denied",
      orgId: "org_default",
      userId: "user_rag_denied",
      name: "RAG denied key",
      hashedToken: await hashApiKey(token),
      scopes: ["knowledge:query"],
      createdAt: now,
    });
    await repository.createKnowledgeBase({
      id: "kb_denied_secret",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Denied secret corpus",
      createdBy: "user_other_owner",
      createdAt: now,
      updatedAt: now,
    });
    const api = createRomeoApi(repository, {
      env: readEnv({ DEV_SEEDED_LOGIN: "false" }),
    });

    const response = await api.request("/api/v1/knowledge-bases/query", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        knowledgeBaseIds: ["kb_denied_secret"],
        query: "should not be audited",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("knowledge_retrieval_plan_empty");
    expect(body.error.details).toEqual({
      skipped: {
        count: 1,
        reasons: [{ reason: "missing_use_grant", count: 1 }],
      },
    });
    expect(JSON.stringify(body.error)).not.toContain("kb_denied_secret");
    expect(JSON.stringify(body.error)).not.toContain("should not be audited");
  });

  it("reports sanitized admin RAG posture without corpus or job payload values", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository);
    const rawSentinel = "raw-rag-posture-secret-sentinel";
    const sourceResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/sources",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "posture-secret.md",
          mimeType: "text/markdown",
          sizeBytes: rawSentinel.length,
          content: rawSentinel,
        }),
      },
    );
    await repository.createBackgroundJob({
      id: "job_rag_posture_failed",
      orgId: "org_default",
      type: "knowledge.embedding.index",
      status: "failed",
      payload: {
        knowledgeBaseId: "kb_default",
        rawPayloadSentinel: rawSentinel,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    const response = await api.request("/api/v1/admin/rag/posture");
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(sourceResponse.status).toBe(202);
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      orgId: "org_default",
      status: "degraded",
      vector: {
        driver: "pgvector",
        authoritativeStore: "postgres",
        isolationMode: "shared_row_scope",
        pgvectorConfigured: true,
        externalVectorStoreConfigured: false,
        qdrantConfigured: false,
        namespaceConfigured: false,
        partitioningConfigured: false,
        postureSource: "deployment_default",
        externalStore: {
          driver: "disabled",
          endpointConfigured: false,
          collectionConfigured: false,
          credentialRefConfigured: false,
          credentialRefValid: false,
          namespacePolicy: "none",
          partitioningPolicy: "none",
          configured: false,
          routingActive: false,
          evidence: {
            configured: false,
            status: "not_configured",
          },
        },
      },
      corpus: {
        workspaceCount: 1,
        knowledgeBaseCount: 1,
        sourceCount: 1,
        indexedSourceCount: 1,
        failedSourceCount: 0,
        chunkCount: 1,
        embeddingCount: 0,
        embeddedChunkCount: 0,
        chunksMissingProviderEmbeddingCount: 1,
        providerModelIndexCount: 0,
      },
      jobs: {
        failedEmbeddingIndexJobCount: 1,
        failedExtractionJobCount: 0,
        failedReindexJobCount: 0,
      },
    });
    expect(body.data.fallback).toEqual({
      lexicalFallbackAvailable: true,
      degraded: true,
      reasonCodes: ["shared_pgvector_default", "no_provider_embeddings"],
    });
    expect(body.data.readiness.warnings).toEqual([
      { code: "failed_knowledge_jobs", count: 1, severity: "warning" },
      { code: "lexical_fallback_active", count: 1, severity: "info" },
    ]);
    expect(serialized).not.toContain(rawSentinel);
    expect(serialized).not.toContain("posture-secret.md");
    expect(serialized).not.toContain("job_rag_posture_failed");
  });

  it("reports Qdrant deployment posture without exposing endpoint or secret refs", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        EXTERNAL_VECTOR_STORE_DRIVER: "qdrant",
        QDRANT_URL: "https://qdrant.example.com",
        QDRANT_COLLECTION: "romeo-prod",
        QDRANT_API_KEY_REF: "vault://romeo/qdrant/api-key",
        VECTOR_NAMESPACE_POLICY: "org",
        VECTOR_PARTITIONING_POLICY: "workspace",
        VECTOR_ISOLATION_MODE: "external_namespace_per_org",
      }),
    });
    const response = await api.request("/api/v1/admin/rag/posture");
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.data.vector).toMatchObject({
      driver: "pgvector",
      authoritativeStore: "postgres",
      isolationMode: "external_namespace_per_org",
      pgvectorConfigured: true,
      externalVectorStoreConfigured: true,
      qdrantConfigured: true,
      namespaceConfigured: true,
      partitioningConfigured: true,
      postureSource: "deployment_default",
      externalStore: {
        driver: "qdrant",
        endpointConfigured: true,
        collectionConfigured: true,
        credentialRefConfigured: true,
        credentialRefValid: true,
        credentialRefScheme: "vault",
        namespacePolicy: "org",
        partitioningPolicy: "workspace",
        configured: true,
        routingActive: false,
        evidence: {
          configured: false,
          status: "not_configured",
        },
      },
      physicalIsolation: {
        policy: {
          mode: "shared_row_scope",
          enforcement: "advisory",
          configured: false,
          postgresAuthoritative: true,
          liveEvidenceRequired: false,
        },
        deploymentMode: "external_namespace_per_org",
        deploymentMatched: false,
        externalVectorEvidence: {
          configured: false,
          status: "not_configured",
        },
        status: "deployment_mismatch",
      },
    });
    expect(serialized).not.toContain("qdrant.example.com");
    expect(serialized).not.toContain("romeo-prod");
    expect(serialized).not.toContain("qdrant/api-key");
  });

  it("satisfies required external vector isolation with live Qdrant evidence", async () => {
    const evidencePath = writeQdrantLiveEvidence({
      status: "passed",
      mode: "live",
      namespacePolicy: "org",
      partitioningPolicy: "workspace",
    });
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        EXTERNAL_VECTOR_STORE_DRIVER: "qdrant",
        QDRANT_URL: "https://qdrant.example.com",
        QDRANT_COLLECTION: "romeo-prod",
        QDRANT_API_KEY_REF: "vault://romeo/qdrant/api-key",
        QDRANT_LIVE_EVIDENCE_PATH: evidencePath,
        SECRET_RESOLVER_DRIVER: "vault",
        VECTOR_NAMESPACE_POLICY: "org",
        VECTOR_PARTITIONING_POLICY: "workspace",
        VECTOR_ISOLATION_MODE: "external_namespace_per_org",
      }),
      secretResolver: new EnvironmentSecretResolver({
        VAULT_ROMEO_QDRANT_API_KEY: "qdrant-api-key-secret",
      }),
    });
    const updateResponse = await api.request("/api/v1/admin/rag/policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        physicalVectorIsolation: {
          mode: "external_namespace_per_org",
          enforcement: "required",
        },
      }),
    });
    const postureResponse = await api.request("/api/v1/admin/rag/posture");
    const posture = await postureResponse.json();
    const serialized = JSON.stringify(posture);

    expect(updateResponse.status).toBe(200);
    expect(postureResponse.status).toBe(200);
    expect(posture.data.vector.externalStore.evidence).toMatchObject({
      configured: true,
      status: "satisfied",
      evidenceStatus: "passed",
      evidenceMode: "live",
      namespacePolicy: "org",
      partitioningPolicy: "workspace",
      collectionHealthRead: true,
      scopedQueryReturnedExpectedPoint: true,
      namespaceTrapExcluded: true,
      partitionTrapExcluded: true,
      foreignOrgTrapExcluded: true,
      vectorsOmittedFromQuery: true,
      scopedDeleteVerified: true,
      cleanupAttempted: true,
    });
    expect(posture.data.vector.physicalIsolation).toMatchObject({
      policy: {
        mode: "external_namespace_per_org",
        enforcement: "required",
        configured: true,
        postgresAuthoritative: true,
        liveEvidenceRequired: true,
      },
      deploymentMode: "external_namespace_per_org",
      deploymentMatched: true,
      externalVectorEvidence: {
        configured: true,
        status: "satisfied",
      },
      status: "satisfied",
    });
    expect(posture.data.readiness.warnings).not.toContainEqual({
      code: "physical_vector_isolation_evidence_pending",
      count: 1,
      severity: "warning",
    });
    expect(serialized).not.toContain(evidencePath);
    expect(serialized).not.toContain("qdrant.example.com");
    expect(serialized).not.toContain("romeo-prod");
    expect(serialized).not.toContain("qdrant-api-key-secret");
    expect(serialized).not.toContain("org:org-qdrant-evidence-secret");
    expect(serialized).not.toContain("workspace-qdrant-evidence-secret");
    expect(serialized).not.toContain("chunk-qdrant-evidence-secret");
  });

  it("updates org RAG policy with metadata-only audit and enforces disabled tiers", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository);
    const providerId = "provider-rag-policy-secret";
    const model = "embedding-rag-policy-secret";
    const residencyTag = "itar-rag-policy-secret";
    const orgKnowledgeBaseId = "kb-rag-policy-org-secret";
    const sharedKnowledgeBaseId = "kb-rag-policy-shared-secret";

    const defaultPolicyResponse = await api.request("/api/v1/admin/rag/policy");
    const defaultPolicy = await defaultPolicyResponse.json();
    const updateResponse = await api.request("/api/v1/admin/rag/policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabledTiers: ["workspace"],
        defaultMaxResultsPerTier: { workspace: 2 },
        maxResultsPerTier: { workspace: 2 },
        allowedEmbeddingProviderModels: [{ providerId, model }],
        knowledgeBaseTierAssignments: {
          org: [orgKnowledgeBaseId],
          shared: [sharedKnowledgeBaseId],
        },
        dataResidencyTags: [residencyTag],
        externalVectorStore: {
          mode: "deployment_managed",
          namespacePolicy: "org",
          partitioningPolicy: "workspace",
          drStrategy: "postgres_authoritative_reindex",
          exportPolicy: "metadata_only",
        },
        physicalVectorIsolation: {
          mode: "external_namespace_per_org",
          enforcement: "required",
        },
      }),
    });
    const updated = await updateResponse.json();
    const deniedQueryResponse = await api.request(
      "/api/v1/knowledge-bases/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          knowledgeBaseIds: ["kb_default"],
          query: "rag policy disabled private tier secret",
          maxResultsPerTier: { user_private: 10 },
        }),
      },
    );
    const deniedQuery = await deniedQueryResponse.json();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=admin.rag_policy.update",
    );
    const audit = await auditResponse.json();
    const serializedAudit = JSON.stringify(audit);

    expect(defaultPolicyResponse.status).toBe(200);
    expect(defaultPolicy.data).toMatchObject({
      source: "default",
      enabledTiers: ["user_private", "workspace", "org", "shared"],
      defaultMaxResultsPerTier: { user_private: 5, workspace: 5 },
      maxResultsPerTier: { user_private: 20, workspace: 20 },
      knowledgeBaseTierAssignments: { org: [], shared: [] },
      externalVectorStore: {
        mode: "disabled",
        namespacePolicy: "none",
        partitioningPolicy: "none",
        configured: false,
        drStrategy: "postgres_authoritative_reindex",
        exportPolicy: "metadata_only",
        restoreValidation: "not_required",
      },
      physicalVectorIsolation: {
        mode: "shared_row_scope",
        enforcement: "advisory",
        configured: false,
        postgresAuthoritative: true,
        liveEvidenceRequired: false,
      },
      enforcement: { tierBudgets: "enforced" },
    });
    expect(updateResponse.status).toBe(200);
    expect(updated.data).toMatchObject({
      source: "org",
      enabledTiers: ["workspace"],
      defaultMaxResultsPerTier: { workspace: 2 },
      maxResultsPerTier: { workspace: 2 },
      allowedEmbeddingProviderModels: [{ providerId, model }],
      knowledgeBaseTierAssignments: {
        org: [orgKnowledgeBaseId],
        shared: [sharedKnowledgeBaseId],
      },
      dataResidencyTags: [residencyTag],
      externalVectorStore: {
        mode: "deployment_managed",
        namespacePolicy: "org",
        partitioningPolicy: "workspace",
        configured: true,
        drStrategy: "postgres_authoritative_reindex",
        exportPolicy: "metadata_only",
        restoreValidation: "required_when_enabled",
      },
      physicalVectorIsolation: {
        mode: "external_namespace_per_org",
        enforcement: "required",
        configured: true,
        postgresAuthoritative: true,
        liveEvidenceRequired: true,
      },
      enforcement: {
        embeddingProviderModelAllowlist: "enforced",
      },
    });
    expect(deniedQueryResponse.status).toBe(403);
    expect(deniedQuery.error).toMatchObject({
      code: "knowledge_retrieval_plan_empty",
      details: {
        skipped: {
          count: 1,
          reasons: [{ reason: "tier_disabled_by_policy", count: 1 }],
        },
      },
    });
    expect(JSON.stringify(deniedQuery.error)).not.toContain("kb_default");
    expect(JSON.stringify(deniedQuery.error)).not.toContain(
      "rag policy disabled private tier secret",
    );
    expect(audit.data[0].metadata).toMatchObject({
      changedFields: [
        "enabledTiers",
        "defaultMaxResultsPerTier",
        "maxResultsPerTier",
        "allowedEmbeddingProviderModels",
        "knowledgeBaseTierAssignments",
        "dataResidencyTags",
        "externalVectorStore",
        "physicalVectorIsolation",
      ],
      enabledTierCount: 1,
      allowedEmbeddingProviderModelCount: 1,
      assignedKnowledgeBaseCounts: { org: 1, shared: 1 },
      dataResidencyTagCount: 1,
      externalVectorStore: {
        mode: "deployment_managed",
        namespacePolicy: "org",
        partitioningPolicy: "workspace",
        drStrategy: "postgres_authoritative_reindex",
        exportPolicy: "metadata_only",
        restoreValidation: "required_when_enabled",
      },
      physicalVectorIsolation: {
        mode: "external_namespace_per_org",
        enforcement: "required",
        liveEvidenceRequired: true,
      },
      source: "org",
    });
    expect(serializedAudit).not.toContain(providerId);
    expect(serializedAudit).not.toContain(model);
    expect(serializedAudit).not.toContain(orgKnowledgeBaseId);
    expect(serializedAudit).not.toContain(sharedKnowledgeBaseId);
    expect(serializedAudit).not.toContain(residencyTag);
  });

  it("warns when required physical vector isolation is not satisfied by deployment posture", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository);
    const updateResponse = await api.request("/api/v1/admin/rag/policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        physicalVectorIsolation: {
          mode: "external_namespace_per_org",
          enforcement: "required",
        },
      }),
    });
    const postureResponse = await api.request("/api/v1/admin/rag/posture");
    const posture = await postureResponse.json();
    const serialized = JSON.stringify(posture);

    expect(updateResponse.status).toBe(200);
    expect(postureResponse.status).toBe(200);
    expect(posture.data.status).toBe("degraded");
    expect(posture.data.vector.physicalIsolation).toMatchObject({
      policy: {
        mode: "external_namespace_per_org",
        enforcement: "required",
        configured: true,
        postgresAuthoritative: true,
        liveEvidenceRequired: true,
      },
      deploymentMode: "shared_row_scope",
      deploymentMatched: false,
      status: "deployment_mismatch",
    });
    expect(posture.data.readiness.warnings).toContainEqual({
      code: "physical_vector_isolation_mismatch",
      count: 1,
      severity: "warning",
    });
    expect(serialized).not.toContain("qdrant.example.com");
    expect(serialized).not.toContain("romeo-prod");
    expect(serialized).not.toContain("vault://");
  });

  it("satisfies required pgvector physical isolation with live partition evidence", async () => {
    const evidencePath = writePgvectorIsolationEvidence({
      status: "passed",
      mode: "live",
      checks: {
        tableExists: true,
        tablePartitioned: true,
        partitionKeyIncludesOrgId: true,
        partitionCount: 16,
        hnswIndexCount: 16,
        queryPlanReviewed: true,
      },
    });
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository, {
      env: readEnv({
        VECTOR_ISOLATION_MODE: "pgvector_partitioned_by_org",
        PGVECTOR_PHYSICAL_ISOLATION_EVIDENCE_PATH: evidencePath,
      }),
    });
    const updateResponse = await api.request("/api/v1/admin/rag/policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        physicalVectorIsolation: {
          mode: "pgvector_partitioned_by_org",
          enforcement: "required",
        },
      }),
    });
    const postureResponse = await api.request("/api/v1/admin/rag/posture");
    const posture = await postureResponse.json();
    const serialized = JSON.stringify(posture);

    expect(updateResponse.status).toBe(200);
    expect(postureResponse.status).toBe(200);
    expect(posture.data.vector.physicalIsolation).toMatchObject({
      policy: {
        mode: "pgvector_partitioned_by_org",
        enforcement: "required",
        configured: true,
        postgresAuthoritative: true,
        liveEvidenceRequired: true,
      },
      deploymentMode: "pgvector_partitioned_by_org",
      deploymentMatched: true,
      evidence: {
        configured: true,
        status: "satisfied",
        evidenceStatus: "passed",
        evidenceMode: "live",
        tablePartitioned: true,
        partitionKeyIncludesOrgId: true,
        partitionCount: 16,
        hnswIndexCount: 16,
        queryPlanReviewed: true,
      },
      status: "satisfied",
    });
    expect(posture.data.readiness.warnings).not.toContainEqual({
      code: "physical_vector_isolation_evidence_pending",
      count: 1,
      severity: "warning",
    });
    expect(serialized).not.toContain(evidencePath);
  });

  it("governs org RAG policy changes through approval with metadata-only audit", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository);
    const providerId = "provider-rag-change-secret";
    const model = "embedding-rag-change-secret";
    const residencyTag = "rag-change-residency-secret";
    const orgKnowledgeBaseId = "kb-rag-change-org-secret";
    const sharedKnowledgeBaseId = "kb-rag-change-shared-secret";

    const emptyResponse = await api.request(
      "/api/v1/admin/rag/policy/change-request",
    );
    const empty = await emptyResponse.json();
    const createResponse = await api.request(
      "/api/v1/admin/rag/policy/change-requests",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          policy: {
            enabledTiers: ["workspace"],
            defaultMaxResultsPerTier: { workspace: 3 },
            maxResultsPerTier: { workspace: 3 },
            allowedEmbeddingProviderModels: [{ providerId, model }],
            knowledgeBaseTierAssignments: {
              org: [orgKnowledgeBaseId],
              shared: [sharedKnowledgeBaseId],
            },
            dataResidencyTags: [residencyTag],
          },
          justificationCode: "retrieval_replay_improvement",
          evidenceSummary: {
            replayCaseCount: 12,
            averagePrecision: 0.81,
            averageRecall: 0.76,
            averageLatencyMs: 42,
            beforeAfterComparisonAttached: true,
          },
        }),
      },
    );
    const created = await createResponse.json();
    const unchangedPolicyResponse = await api.request(
      "/api/v1/admin/rag/policy",
    );
    const unchangedPolicy = await unchangedPolicyResponse.json();
    const pendingResponse = await api.request(
      "/api/v1/admin/rag/policy/change-request",
    );
    const pending = await pendingResponse.json();
    const approveResponse = await api.request(
      `/api/v1/admin/rag/policy/change-requests/${created.data.requestId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmRequestId: created.data.requestId }),
      },
    );
    const approved = await approveResponse.json();
    const appliedPolicyResponse = await api.request("/api/v1/admin/rag/policy");
    const appliedPolicy = await appliedPolicyResponse.json();
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();
    const serializedAudit = JSON.stringify(audit.data);

    expect(emptyResponse.status).toBe(200);
    expect(empty.data).toBeNull();
    expect(createResponse.status).toBe(201);
    expect(created.data).toMatchObject({
      schema: "romeo.rag-policy-change-request.v1",
      status: "pending",
      justificationCode: "retrieval_replay_improvement",
      evidenceSummary: {
        replayCaseCount: 12,
        averagePrecision: 0.81,
        averageRecall: 0.76,
        averageLatencyMs: 42,
        beforeAfterComparisonAttached: true,
      },
      before: { source: "default" },
      proposed: {
        source: "org",
        enabledTiers: ["workspace"],
        defaultMaxResultsPerTier: { workspace: 3 },
        maxResultsPerTier: { workspace: 3 },
      },
      redaction: {
        rawQueriesReturned: false,
        rawCorpusReturned: false,
        rawChunkTextReturned: false,
        rawVectorValuesReturned: false,
        secretRefsReturned: false,
      },
    });
    expect(created.data.changedFields).toEqual([
      "enabledTiers",
      "defaultMaxResultsPerTier",
      "maxResultsPerTier",
      "allowedEmbeddingProviderModels",
      "knowledgeBaseTierAssignments",
      "dataResidencyTags",
    ]);
    expect(unchangedPolicy.data.source).toBe("default");
    expect(unchangedPolicy.data.enabledTiers).toEqual([
      "user_private",
      "workspace",
      "org",
      "shared",
    ]);
    expect(pending.data.requestId).toBe(created.data.requestId);
    expect(approveResponse.status).toBe(200);
    expect(approved.data).toMatchObject({
      requestId: created.data.requestId,
      status: "approved",
      applied: {
        source: "org",
        enabledTiers: ["workspace"],
        defaultMaxResultsPerTier: { workspace: 3 },
        maxResultsPerTier: { workspace: 3 },
      },
    });
    expect(appliedPolicyResponse.status).toBe(200);
    expect(appliedPolicy.data).toMatchObject({
      source: "org",
      enabledTiers: ["workspace"],
      defaultMaxResultsPerTier: { workspace: 3 },
      maxResultsPerTier: { workspace: 3 },
      allowedEmbeddingProviderModels: [{ providerId, model }],
      knowledgeBaseTierAssignments: {
        org: [orgKnowledgeBaseId],
        shared: [sharedKnowledgeBaseId],
      },
      dataResidencyTags: [residencyTag],
    });
    expect(
      audit.data.some(
        (entry: { action: string }) =>
          entry.action === "admin.rag_policy.change_request.create",
      ),
    ).toBe(true);
    expect(
      audit.data.some(
        (entry: { action: string }) =>
          entry.action === "admin.rag_policy.change_request.approve",
      ),
    ).toBe(true);
    expect(serializedAudit).not.toContain(providerId);
    expect(serializedAudit).not.toContain(model);
    expect(serializedAudit).not.toContain(orgKnowledgeBaseId);
    expect(serializedAudit).not.toContain(sharedKnowledgeBaseId);
    expect(serializedAudit).not.toContain(residencyTag);
  });

  it("rejects stale RAG policy change approvals after break-glass updates", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request(
      "/api/v1/admin/rag/policy/change-requests",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          policy: {
            enabledTiers: ["workspace"],
            defaultMaxResultsPerTier: { workspace: 2 },
            maxResultsPerTier: { workspace: 2 },
          },
          justificationCode: "manual_risk_reduction",
        }),
      },
    );
    const created = await createResponse.json();
    await api.request("/api/v1/admin/rag/policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabledTiers: ["org"],
        defaultMaxResultsPerTier: { org: 1 },
        maxResultsPerTier: { org: 1 },
      }),
    });
    const staleApproveResponse = await api.request(
      `/api/v1/admin/rag/policy/change-requests/${created.data.requestId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmRequestId: created.data.requestId }),
      },
    );
    const staleApprove = await staleApproveResponse.json();
    const rejectResponse = await api.request(
      `/api/v1/admin/rag/policy/change-requests/${created.data.requestId}/reject`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmRequestId: created.data.requestId,
          reasonCode: "superseded",
        }),
      },
    );
    const rejected = await rejectResponse.json();
    const secondApproveResponse = await api.request(
      `/api/v1/admin/rag/policy/change-requests/${created.data.requestId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmRequestId: created.data.requestId }),
      },
    );
    const secondApprove = await secondApproveResponse.json();
    const policyResponse = await api.request("/api/v1/admin/rag/policy");
    const policy = await policyResponse.json();

    expect(createResponse.status).toBe(201);
    expect(staleApproveResponse.status).toBe(409);
    expect(staleApprove.error.code).toBe("rag_policy_change_request_stale");
    expect(rejectResponse.status).toBe(200);
    expect(rejected.data).toMatchObject({
      requestId: created.data.requestId,
      status: "rejected",
      rejectReasonCode: "superseded",
    });
    expect(secondApproveResponse.status).toBe(409);
    expect(secondApprove.error.code).toBe(
      "rag_policy_change_request_not_pending",
    );
    expect(policy.data).toMatchObject({
      source: "org",
      enabledTiers: ["org"],
      defaultMaxResultsPerTier: { org: 1 },
      maxResultsPerTier: { org: 1 },
    });
  });

  it("rejects deployment-managed external vector policy without namespace isolation", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());

    const response = await api.request("/api/v1/admin/rag/policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        externalVectorStore: {
          mode: "deployment_managed",
          namespacePolicy: "none",
        },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_rag_external_vector_policy");
  });

  it("enforces the RAG embedding provider/model allowlist before provider or external vector calls", async () => {
    const repository = new InMemoryRomeoRepository();
    const disallowedModel = "nomic-disallowed-secret-model";
    const content =
      "Romeo RAG policy blocks disallowed embedding providers before provider egress.";
    let embeddingFetchCalls = 0;
    let qdrantFetchCalls = 0;
    const api = createRomeoApi(repository, {
      env: readEnv({
        EXTERNAL_VECTOR_STORE_DRIVER: "qdrant",
        QDRANT_URL: "https://qdrant.allowlist.example",
        QDRANT_COLLECTION: "romeo-allowlist",
        QDRANT_API_KEY_REF: "env://QDRANT_API_KEY",
        QDRANT_TIMEOUT_MS: "2500",
        VECTOR_NAMESPACE_POLICY: "knowledge_base",
      }),
      secretResolver: new EnvironmentSecretResolver({
        QDRANT_API_KEY: "qdrant-policy-key",
      }),
      embeddingFetch: async () => {
        embeddingFetchCalls += 1;
        return new Response("{}", { status: 500 });
      },
      qdrantFetch: async () => {
        qdrantFetchCalls += 1;
        return new Response("{}", { status: 500 });
      },
    });

    await api.request("/api/v1/admin/rag/policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        allowedEmbeddingProviderModels: [
          { providerId: "provider_ollama", model: "approved-embedding-model" },
        ],
      }),
    });
    await api.request("/api/v1/knowledge-bases/kb_default/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "allowlist.md",
        mimeType: "text/markdown",
        sizeBytes: content.length,
        content,
      }),
    });

    const response = await api.request(
      "/api/v1/knowledge-bases/kb_default/embeddings",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "provider_ollama",
          model: disallowedModel,
        }),
      },
    );
    const body = await response.json();
    const jobsResponse = await api.request("/api/v1/jobs");
    const jobs = await jobsResponse.json();

    expect(response.status).toBe(403);
    expect(body.error).toMatchObject({
      code: "rag_embedding_provider_model_forbidden",
      details: {
        allowedEmbeddingProviderModelCount: 1,
        ragPolicySource: "org",
      },
    });
    expect(JSON.stringify(body.error)).not.toContain(disallowedModel);
    expect(embeddingFetchCalls).toBe(0);
    expect(await repository.listKnowledgeChunkEmbeddings("kb_default")).toEqual(
      [],
    );
    expect(
      jobs.data.some(
        (job: { type: string }) => job.type === "knowledge.embedding.index",
      ),
    ).toBe(false);
    expect(qdrantFetchCalls).toBe(0);
  });

  it("rejects inline content for non-text source types", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const response = await api.request(
      "/api/v1/knowledge-bases/kb_default/sources",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "policy.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          content: "pdf text",
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(415);
    expect(body.error.code).toBe("unsupported_media_type");
  });

  it("registers presigned uploads without indexing content", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const response = await api.request(
      "/api/v1/knowledge-bases/kb_default/uploads",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "policy.pdf",
          mimeType: "application/pdf",
          sizeBytes: 256,
        }),
      },
    );
    const body = await response.json();
    const usageResponse = await api.request("/api/v1/usage/events");
    const usage = await usageResponse.json();

    expect(response.status).toBe(202);
    expect(body.data.source.status).toBe("pending");
    expect(body.data.source.objectKey).toContain("/policy.pdf");
    expect(body.data.upload.method).toBe("PUT");
    expect(body.data.upload.url).toMatch(/^memory:\/\/object-store\//);
    expect(usage.data[0].metadata.upload).toBe(true);
  });

  it("completes uploaded HTML sources through the extraction boundary", async () => {
    const objectStore = new MemoryObjectStore();
    const api = createRomeoApi(new InMemoryRomeoRepository(), { objectStore });
    const uploadResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/uploads",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "portal.html",
          mimeType: "text/html",
          sizeBytes: 96,
        }),
      },
    );
    const upload = await uploadResponse.json();
    expect(uploadResponse.status).toBe(202);
    await objectStore.putObject({
      key: upload.data.source.objectKey,
      body: new TextEncoder().encode(
        "<main><h1>Privacy Controls</h1><script>leak()</script><p>Romeo retention evidence.</p></main>",
      ),
      contentType: "text/html",
    });

    const completeResponse = await api.request(
      `/api/v1/knowledge-bases/kb_default/sources/${upload.data.source.id}/complete`,
      {
        method: "POST",
      },
    );
    const queryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "privacy retention evidence" }),
      },
    );
    const completed = await completeResponse.json();
    const query = await queryResponse.json();

    expect(completeResponse.status).toBe(200);
    expect(completed.data.status).toBe("indexed");
    expect(query.data[0].content).toContain("Privacy Controls");
    expect(query.data[0].content).not.toContain("leak");
    expect(query.data[0].metadata.extractor).toBe("html-text");
  });

  it("runs deferred extraction jobs for uploaded binary knowledge sources", async () => {
    const objectStore = new MemoryObjectStore();
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      objectStore,
      knowledgeExtractor: {
        async extract(input) {
          expect(input.mimeType).toBe("application/pdf");
          return {
            content: `Romeo PDF extraction worker indexed ${new TextDecoder().decode(input.bytes)}.`,
            metadata: {
              extractor: "test-pdf-worker",
              mimeType: input.mimeType,
            },
          };
        },
      },
    });
    const uploadResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/uploads",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "policy.pdf",
          mimeType: "application/pdf",
          sizeBytes: 64,
        }),
      },
    );
    const upload = await uploadResponse.json();
    await objectStore.putObject({
      key: upload.data.source.objectKey,
      body: new TextEncoder().encode("retention appendix"),
      contentType: "application/pdf",
    });

    const extractResponse = await api.request(
      `/api/v1/knowledge-bases/kb_default/sources/${upload.data.source.id}/extract`,
      { method: "POST" },
    );
    const extracted = await extractResponse.json();
    const queryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "pdf retention appendix" }),
      },
    );
    const query = await queryResponse.json();
    const jobsResponse = await api.request("/api/v1/jobs");
    const jobs = await jobsResponse.json();
    const usageResponse = await api.request("/api/v1/usage/events");
    const usage = await usageResponse.json();

    expect(extractResponse.status).toBe(200);
    expect(extracted.data.source.status).toBe("indexed");
    expect(extracted.data.source.chunkCount).toBe(1);
    expect(extracted.data.job).toMatchObject({
      type: "knowledge.extract",
      status: "completed",
    });
    expect(extracted.data.job.payload).toMatchObject({
      knowledgeBaseId: "kb_default",
      sourceId: upload.data.source.id,
      mimeType: "application/pdf",
    });
    expect(JSON.stringify(extracted.data.job.payload)).not.toContain(
      "retention appendix",
    );
    expect(query.data[0].content).toContain("PDF extraction worker");
    expect(query.data[0].metadata.extractor).toBe("test-pdf-worker");
    expect(jobs.data[0]).toMatchObject({
      type: "knowledge.extract",
      status: "completed",
    });
    expect(
      usage.data.some(
        (event: { metric: string; metadata: Record<string, unknown> }) =>
          event.metric === "storage.source_extracted" &&
          event.metadata.chunkCount === 1,
      ),
    ).toBe(true);
  });

  it("indexes provider embeddings for knowledge chunks through a metadata-only job", async () => {
    const repository = new InMemoryRomeoRepository();
    const content =
      "Romeo embedding jobs index provider vectors without storing chunk text in job metadata.";
    const api = createRomeoApi(repository, {
      embeddingFetch: async (input, init) => {
        expect(String(input)).toBe("http://localhost:11434/api/embed");
        const body = JSON.parse(String(init?.body)) as {
          input: string[];
          model: string;
        };
        expect(body.model).toBe("nomic-embed-text");
        expect(body.input).toEqual([content]);
        return new Response(
          JSON.stringify({
            model: body.model,
            embeddings: body.input.map(() =>
              Array.from({ length: 1536 }, (_, index) => index / 1536),
            ),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });
    const sourceResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/sources",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "embeddings.md",
          mimeType: "text/markdown",
          sizeBytes: content.length,
          content,
        }),
      },
    );
    const source = await sourceResponse.json();
    const indexResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/embeddings",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "provider_ollama",
          model: "nomic-embed-text",
          batchSize: 1,
        }),
      },
    );
    const indexed = await indexResponse.json();
    const jobsResponse = await api.request("/api/v1/jobs");
    const jobs = await jobsResponse.json();
    const usageResponse = await api.request("/api/v1/usage/events");
    const usage = await usageResponse.json();
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();
    const embeddings =
      await repository.listKnowledgeChunkEmbeddings("kb_default");

    expect(sourceResponse.status).toBe(202);
    expect(source.data.status).toBe("indexed");
    expect(indexResponse.status).toBe(200);
    expect(indexed.data.embeddingCount).toBe(1);
    expect(indexed.data.dimensions).toBe(1536);
    expect(indexed.data.job).toMatchObject({
      type: "knowledge.embedding.index",
      status: "completed",
    });
    expect(embeddings).toHaveLength(1);
    expect(embeddings[0]?.embedding).toHaveLength(1536);
    expect(embeddings[0]).toMatchObject({
      embeddingProvider: "provider_ollama",
      embeddingModel: "nomic-embed-text",
      dimensions: 1536,
    });
    expect(jobs.data[0]).toMatchObject({
      type: "knowledge.embedding.index",
      status: "completed",
    });
    expect(
      usage.data.some(
        (event: { metric: string; quantity: number }) =>
          event.metric === "storage.embedding_indexed" && event.quantity === 1,
      ),
    ).toBe(true);
    expect(
      audit.data.some(
        (event: { action: string; resourceId: string }) =>
          event.action === "knowledge.embedding.index" &&
          event.resourceId === "kb_default",
      ),
    ).toBe(true);
    expect(JSON.stringify(jobs.data)).not.toContain(content);
    expect(JSON.stringify(usage.data)).not.toContain(content);
    expect(JSON.stringify(audit.data)).not.toContain(content);
  });

  it("uses persisted provider embeddings for query-time vector retrieval", async () => {
    const repository = new InMemoryRomeoRepository();
    const relevant = "Romeo semantic controls live in the policy source.";
    const unrelated = "Release calendar notes for unrelated planning.";
    const embedInputs: string[][] = [];
    const api = createRomeoApi(repository, {
      embeddingFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          input: string[];
          model: string;
        };
        embedInputs.push(body.input);
        return new Response(
          JSON.stringify({
            model: body.model,
            embeddings: body.input.map(vectorForEmbeddingText),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    await api.request("/api/v1/knowledge-bases/kb_default/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "semantic.md",
        mimeType: "text/markdown",
        sizeBytes: relevant.length,
        content: relevant,
      }),
    });
    await api.request("/api/v1/knowledge-bases/kb_default/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "calendar.md",
        mimeType: "text/markdown",
        sizeBytes: unrelated.length,
        content: unrelated,
      }),
    });
    const indexResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/embeddings",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "provider_ollama",
          model: "nomic-embed-text",
        }),
      },
    );
    const queryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "latent-nearest-neighbor",
          maxResults: 1,
        }),
      },
    );
    const query = await queryResponse.json();

    expect(indexResponse.status).toBe(200);
    expect(queryResponse.status).toBe(200);
    expect(query.data).toHaveLength(1);
    expect(query.data[0].content).toBe(relevant);
    expect(query.data[0].citation.title).toBe("semantic.md");
    expect(query.data[0].metadata.embedding).toBeUndefined();
    expect(embedInputs).toContainEqual([relevant, unrelated]);
    expect(embedInputs).toContainEqual(["latent-nearest-neighbor"]);
  });

  it("routes provider embedding index, query, and delete through Qdrant when configured", async () => {
    const repository = new InMemoryRomeoRepository();
    const content =
      "Romeo Qdrant routing keeps tenant payload filters separate from raw knowledge text.";
    const qdrantApiKey = "qdrant-api-key-secret";
    const qdrantCalls: Array<{
      apiKey: string | null;
      body: unknown;
      method: string;
      url: string;
    }> = [];
    let qdrantPayload: Record<string, unknown> | undefined;

    const api = createRomeoApi(repository, {
      env: readEnv({
        EXTERNAL_VECTOR_STORE_DRIVER: "qdrant",
        QDRANT_URL: "https://qdrant.internal.example",
        QDRANT_COLLECTION: "romeo-prod",
        QDRANT_API_KEY_REF: "env://QDRANT_API_KEY",
        QDRANT_TIMEOUT_MS: "2500",
        VECTOR_NAMESPACE_POLICY: "workspace",
        VECTOR_PARTITIONING_POLICY: "workspace",
      }),
      secretResolver: new EnvironmentSecretResolver({
        QDRANT_API_KEY: qdrantApiKey,
      }),
      embeddingFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          input: string[];
          model: string;
        };
        return new Response(
          JSON.stringify({
            model: body.model,
            embeddings: body.input.map(vectorForEmbeddingText),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
      qdrantFetch: async (input, init) => {
        const url = String(input);
        const body =
          init?.body === undefined ? undefined : JSON.parse(String(init.body));
        const headers = new Headers(init?.headers);
        qdrantCalls.push({
          apiKey: headers.get("api-key"),
          body,
          method: init?.method ?? "GET",
          url,
        });

        if (url.endsWith("/points?wait=true")) {
          const requestBody = body as {
            points?: Array<{ payload: Record<string, unknown> }>;
          };
          qdrantPayload = requestBody.points?.[0]?.payload;
          return new Response(JSON.stringify({ status: "ok" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        if (url.endsWith("/points/query")) {
          return new Response(
            JSON.stringify({
              result: {
                points:
                  qdrantPayload === undefined
                    ? []
                    : [
                        {
                          id: "qdrant-point",
                          score: 0.98,
                          payload: qdrantPayload,
                        },
                      ],
              },
              status: "ok",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        if (url.endsWith("/points/delete?wait=true")) {
          return new Response(JSON.stringify({ status: "ok" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ status: "unexpected" }), {
          status: 404,
          statusText: "unexpected Qdrant path",
        });
      },
    });

    const sourceResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/sources",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "qdrant-routing.md",
          mimeType: "text/markdown",
          sizeBytes: content.length,
          content,
        }),
      },
    );
    const source = await sourceResponse.json();
    const indexResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/embeddings",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "provider_ollama",
          model: "nomic-embed-text",
        }),
      },
    );
    const postureResponse = await api.request("/api/v1/admin/rag/posture");
    const posture = await postureResponse.json();
    const queryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "latent-nearest-neighbor",
          maxResults: 1,
        }),
      },
    );
    const query = await queryResponse.json();
    const tieredQueryResponse = await api.request(
      "/api/v1/knowledge-bases/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          knowledgeBaseIds: ["kb_default"],
          query: "latent-nearest-neighbor",
          maxResultsPerTier: { workspace: 1 },
        }),
      },
    );
    const tieredQuery = await tieredQueryResponse.json();
    const reindexContent =
      "Romeo Qdrant reindex tombstones previous external source vectors after replacement chunks commit.";
    const reindexResponse = await api.request(
      `/api/v1/knowledge-bases/kb_default/sources/${source.data.id}/reindex`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: reindexContent,
          sizeBytes: reindexContent.length,
        }),
      },
    );
    const deleteResponse = await api.request(
      `/api/v1/knowledge-bases/kb_default/sources/${source.data.id}`,
      { method: "DELETE" },
    );
    const upsertCall = qdrantCalls.find((call) => call.method === "PUT");
    const queryCall = qdrantCalls.find((call) =>
      call.url.endsWith("/points/query"),
    );
    const deleteCalls = qdrantCalls.filter((call) =>
      call.url.endsWith("/points/delete?wait=true"),
    );
    const serializedApiBodies = JSON.stringify({
      index: await indexResponse.clone().json(),
      posture,
      query,
      reindex: await reindexResponse.clone().json(),
      delete: await deleteResponse.clone().json(),
    });

    expect(sourceResponse.status).toBe(202);
    expect(indexResponse.status).toBe(200);
    expect(postureResponse.status).toBe(200);
    expect(queryResponse.status).toBe(200);
    expect(tieredQueryResponse.status).toBe(200);
    expect(reindexResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(query.data[0].content).toBe(content);
    expect(tieredQuery.data.plan.entries[0].retrievalRoute).toMatchObject({
      mode: "external_vector",
      vectorStoreDriver: "qdrant",
      externalVectorStoreAttempted: true,
      externalVectorStoreUsed: true,
      providerId: "provider_ollama",
      embeddingModel: "nomic-embed-text",
      embeddingDimensions: 1536,
    });
    expect(tieredQuery.data.hits[0]).toMatchObject({
      knowledgeBaseId: "kb_default",
      retrievalRoute: {
        mode: "external_vector",
        vectorStoreDriver: "qdrant",
        externalVectorStoreUsed: true,
      },
    });
    expect(posture.data.vector.externalStore).toMatchObject({
      driver: "qdrant",
      configured: true,
      routingActive: true,
      credentialRefScheme: "env",
      namespacePolicy: "workspace",
      partitioningPolicy: "workspace",
    });
    expect(posture.data.vector).toMatchObject({
      driver: "qdrant",
      authoritativeStore: "postgres",
    });
    expect(qdrantCalls.map((call) => call.method)).toEqual([
      "PUT",
      "POST",
      "POST",
      "POST",
      "POST",
    ]);
    expect(qdrantCalls.every((call) => call.apiKey === qdrantApiKey)).toBe(
      true,
    );
    expect(upsertCall?.body).toMatchObject({
      points: [
        {
          payload: {
            dimensions: 1536,
            embeddingModel: "nomic-embed-text",
            embeddingProvider: "provider_ollama",
            knowledgeBaseId: "kb_default",
            orgId: "org_default",
            romeoNamespace: "workspace:org_default:workspace_default",
            romeoPartition: "workspace:org_default:workspace_default",
            sourceId: source.data.id,
            workspaceId: "workspace_default",
          },
        },
      ],
    });
    expect(queryCall?.body).toMatchObject({
      filter: {
        must: expect.arrayContaining([
          {
            key: "romeoNamespace",
            match: { value: "workspace:org_default:workspace_default" },
          },
          {
            key: "romeoPartition",
            match: { value: "workspace:org_default:workspace_default" },
          },
          { key: "orgId", match: { value: "org_default" } },
          { key: "workspaceId", match: { value: "workspace_default" } },
          { key: "knowledgeBaseId", match: { value: "kb_default" } },
          { key: "sourceId", match: { any: [source.data.id] } },
        ]),
      },
      limit: 1,
      with_payload: true,
      with_vector: false,
    });
    expect(deleteCalls).toHaveLength(2);
    for (const deleteCall of deleteCalls) {
      expect(deleteCall.body).toMatchObject({
        filter: {
          must: [
            {
              key: "romeoNamespace",
              match: { value: "workspace:org_default:workspace_default" },
            },
            {
              key: "romeoPartition",
              match: { value: "workspace:org_default:workspace_default" },
            },
            { key: "orgId", match: { value: "org_default" } },
            { key: "workspaceId", match: { value: "workspace_default" } },
            { key: "knowledgeBaseId", match: { value: "kb_default" } },
            { key: "sourceId", match: { value: source.data.id } },
          ],
        },
      });
    }
    expect(JSON.stringify(upsertCall?.body)).not.toContain(content);
    expect(JSON.stringify(upsertCall?.body)).not.toContain("qdrant-routing.md");
    expect(serializedApiBodies).not.toContain("qdrant.internal.example");
    expect(serializedApiBodies).not.toContain("romeo-prod");
    expect(serializedApiBodies).not.toContain("env://QDRANT_API_KEY");
    expect(serializedApiBodies).not.toContain(qdrantApiKey);
  });

  it("skips disallowed persisted embedding groups at query time", async () => {
    const repository = new InMemoryRomeoRepository();
    const content =
      "Romeo lexical fallback remains available after RAG allowlist rotation.";
    const embedInputs: string[][] = [];
    const qdrantCalls: Array<{ method: string; url: string }> = [];
    const api = createRomeoApi(repository, {
      env: readEnv({
        EXTERNAL_VECTOR_STORE_DRIVER: "qdrant",
        QDRANT_URL: "https://qdrant.allowlist.example",
        QDRANT_COLLECTION: "romeo-allowlist",
        QDRANT_API_KEY_REF: "env://QDRANT_API_KEY",
        QDRANT_TIMEOUT_MS: "2500",
        VECTOR_NAMESPACE_POLICY: "knowledge_base",
      }),
      secretResolver: new EnvironmentSecretResolver({
        QDRANT_API_KEY: "qdrant-policy-key",
      }),
      embeddingFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          input: string[];
          model: string;
        };
        embedInputs.push(body.input);
        return new Response(
          JSON.stringify({
            model: body.model,
            embeddings: body.input.map(vectorForEmbeddingText),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
      qdrantFetch: async (input, init) => {
        qdrantCalls.push({
          method: init?.method ?? "GET",
          url: String(input),
        });
        return new Response(
          JSON.stringify({ result: { points: [] }, status: "ok" }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    await api.request("/api/v1/admin/rag/policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        allowedEmbeddingProviderModels: [
          { providerId: "provider_ollama", model: "nomic-embed-text" },
        ],
      }),
    });
    await api.request("/api/v1/knowledge-bases/kb_default/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "allowlist-rotation.md",
        mimeType: "text/markdown",
        sizeBytes: content.length,
        content,
      }),
    });
    const indexResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/embeddings",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "provider_ollama",
          model: "nomic-embed-text",
        }),
      },
    );
    await api.request("/api/v1/admin/rag/policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        allowedEmbeddingProviderModels: [
          { providerId: "provider_ollama", model: "different-approved-model" },
        ],
      }),
    });
    expect(qdrantCalls.map((call) => call.method)).toEqual(["PUT"]);
    qdrantCalls.length = 0;
    embedInputs.length = 0;

    const queryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "lexical fallback allowlist rotation",
          maxResults: 1,
        }),
      },
    );
    const query = await queryResponse.json();

    expect(indexResponse.status).toBe(200);
    expect(queryResponse.status).toBe(200);
    expect(query.data[0].content).toBe(content);
    expect(query.data[0].citation.title).toBe("allowlist-rotation.md");
    expect(embedInputs).toEqual([]);
    expect(qdrantCalls).toEqual([]);
  });

  it("merges persisted vector hits with lexical hits for hybrid retrieval", async () => {
    const repository = new InMemoryRomeoRepository();
    const vectorOnly = "Romeo semantic controls live in the policy source.";
    const lexicalOnly = "Romeo audit reviews include exact phrase zebra.";
    const api = createRomeoApi(repository, {
      embeddingFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          input: string[];
          model: string;
        };
        return new Response(
          JSON.stringify({
            model: body.model,
            embeddings: body.input.map(hybridVectorForEmbeddingText),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    await api.request("/api/v1/knowledge-bases/kb_default/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "semantic.md",
        mimeType: "text/markdown",
        sizeBytes: vectorOnly.length,
        content: vectorOnly,
      }),
    });
    await api.request("/api/v1/knowledge-bases/kb_default/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "lexical.md",
        mimeType: "text/markdown",
        sizeBytes: lexicalOnly.length,
        content: lexicalOnly,
      }),
    });
    const indexResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/embeddings",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "provider_ollama",
          model: "nomic-embed-text",
        }),
      },
    );
    const queryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "hybrid-vector-query exact phrase zebra",
          maxResults: 2,
        }),
      },
    );
    const query = await queryResponse.json();

    expect(indexResponse.status).toBe(200);
    expect(queryResponse.status).toBe(200);
    expect(
      query.data
        .map((hit: { citation: { title: string } }) => hit.citation.title)
        .sort(),
    ).toEqual(["lexical.md", "semantic.md"]);
  });

  it("deletes sources, objects, and provider embeddings without leaking raw content", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const api = createRomeoApi(repository, {
      objectStore,
      embeddingFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          input: string[];
          model: string;
        };
        return new Response(
          JSON.stringify({
            model: body.model,
            embeddings: body.input.map(vectorForEmbeddingText),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });
    const content =
      "Romeo retention controls remove indexed chunks, stored objects, and provider embeddings.";
    const sourceResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/sources",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "retention.md",
          mimeType: "text/markdown",
          sizeBytes: content.length,
          content,
        }),
      },
    );
    const source = await sourceResponse.json();
    const objectKey = source.data.objectKey as string;
    const indexResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/embeddings",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "provider_ollama",
          model: "nomic-embed-text",
        }),
      },
    );
    const embeddingsBeforeDelete =
      await repository.listKnowledgeChunkEmbeddings("kb_default");
    const storedObjectBeforeDelete = await objectStore.getObject(objectKey);

    const deleteResponse = await api.request(
      `/api/v1/knowledge-bases/kb_default/sources/${source.data.id}`,
      { method: "DELETE" },
    );
    const queryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "retention chunks" }),
      },
    );
    const query = await queryResponse.json();
    const usageResponse = await api.request("/api/v1/usage/events");
    const usage = await usageResponse.json();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=knowledge.source.delete",
    );
    const audit = await auditResponse.json();
    const serializedOperationalMetadata = JSON.stringify({
      audit: audit.data,
      usage: usage.data,
    });

    expect(indexResponse.status).toBe(200);
    expect(embeddingsBeforeDelete).toHaveLength(1);
    expect(storedObjectBeforeDelete).toBeDefined();
    expect(await objectStore.getObject(objectKey)).toBeUndefined();
    expect(deleteResponse.status).toBe(200);
    expect(await repository.listKnowledgeChunkEmbeddings("kb_default")).toEqual(
      [],
    );
    expect(query.data).toEqual([]);
    expect(
      usage.data.some(
        (event: { metric: string; metadata: Record<string, unknown> }) =>
          event.metric === "storage.source_deleted" &&
          event.metadata.chunkCount === 1 &&
          event.metadata.embeddingCount === 1 &&
          event.metadata.deleteVectorsOnSourceDelete === true &&
          event.metadata.exportIncludesEmbeddingVectors === false &&
          event.metadata.objectDeleted === true,
      ),
    ).toBe(true);
    expect(audit.data[0].metadata).toMatchObject({
      actorSubjectType: "user",
      chunkCount: 1,
      deleteVectorsOnSourceDelete: true,
      embeddingCount: 1,
      exportIncludesEmbeddingVectors: false,
      knowledgeBaseId: "kb_default",
      objectDeleted: true,
      ragPolicySource: "default",
      workspaceId: "workspace_default",
    });
    expect(serializedOperationalMetadata).not.toContain(content);
    expect(serializedOperationalMetadata).not.toContain("retention.md");
    expect(serializedOperationalMetadata).not.toContain("knowledge/");
  });

  it("reindexes sources by replacing old chunks", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const original = "Romeo incident playbooks mention escalation rotations.";
    const sourceResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/sources",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "playbook.md",
          mimeType: "text/markdown",
          sizeBytes: original.length,
          content: original,
        }),
      },
    );
    const source = await sourceResponse.json();

    const replacement =
      "Romeo retention reviews require source reindex verification.";
    const reindexResponse = await api.request(
      `/api/v1/knowledge-bases/kb_default/sources/${source.data.id}/reindex`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: replacement,
          sizeBytes: replacement.length,
        }),
      },
    );
    const reindexed = await reindexResponse.json();

    const oldQueryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "escalation rotations" }),
      },
    );
    const oldQuery = await oldQueryResponse.json();
    const newQueryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "reindex verification" }),
      },
    );
    const newQuery = await newQueryResponse.json();
    const jobsResponse = await api.request("/api/v1/jobs");
    const jobs = await jobsResponse.json();

    expect(reindexResponse.status).toBe(200);
    expect(reindexed.data.status).toBe("indexed");
    expect(reindexed.data.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(reindexed.data.indexedAt).toBeDefined();
    expect(oldQuery.data).toEqual([]);
    expect(newQuery.data[0].content).toContain("reindex verification");
    expect(jobs.data[0]).toMatchObject({
      type: "knowledge.reindex",
      status: "completed",
    });
    expect(jobs.data[0].payload).toMatchObject({
      knowledgeBaseId: "kb_default",
      sourceId: source.data.id,
    });
    expect(JSON.stringify(jobs.data[0].payload)).not.toContain(
      "retention reviews",
    );
  });
});

function writePgvectorIsolationEvidence(input: {
  status: "failed" | "passed" | "planned";
  mode: "dry-run" | "live";
  checks: Record<string, unknown>;
}): string {
  const directory = mkdtempSync(join(tmpdir(), "romeo-pgvector-evidence-"));
  const path = join(directory, "pgvector-isolation.json");
  writeFileSync(
    path,
    JSON.stringify(
      {
        schemaVersion: "romeo.pgvector-physical-isolation-review.v1",
        generatedAt: "2026-07-02T00:00:00.000Z",
        status: input.status,
        mode: input.mode,
        target: {
          expectedIsolationMode: "pgvector_partitioned_by_org",
          table: "knowledge_chunk_embeddings",
        },
        checks: input.checks,
      },
      null,
      2,
    ),
    "utf8",
  );
  return path;
}

function writeQdrantLiveEvidence(input: {
  status: "failed" | "passed" | "planned";
  mode: "dry-run" | "live";
  namespacePolicy: "knowledge_base" | "none" | "org" | "workspace";
  partitioningPolicy: "knowledge_base" | "none" | "org" | "workspace";
}): string {
  const directory = mkdtempSync(join(tmpdir(), "romeo-qdrant-evidence-"));
  const path = join(directory, "qdrant-live-evidence.json");
  writeFileSync(
    path,
    JSON.stringify(
      {
        schemaVersion: "romeo.qdrant-live-evidence.v1",
        generatedAt: "2026-07-02T00:00:00.000Z",
        status: input.status,
        mode: input.mode,
        target: {
          driver: "qdrant",
          endpointConfigured: true,
          endpointValid: true,
          endpointScheme: "https",
          endpointHostSha256:
            "c17c302e15f4e7b9a6d2d64a3db87f4563cbb14d9b728db7ac4fd516f5b8c3dd",
          collectionConfigured: true,
          collectionSha256:
            "5c71f9989e6806562c0f44a50e430ef291c960f59087710059b9f8892e6c6624",
          credentialConfigured: true,
          unauthenticatedAllowed: false,
          namespacePolicy: input.namespacePolicy,
          partitioningPolicy: input.partitioningPolicy,
          dimensions: 8,
          timeoutMs: 15000,
        },
        collection: {
          status: "green",
          optimizerStatus: "ok",
          pointsCount: 10,
          vectorsCount: 10,
          indexedVectorsCount: 10,
          segmentsCount: 1,
        },
        mutation: {
          requiresConfirmMutation: true,
          confirmed: true,
          insertedPointCount: 4,
          cleanupAttempted: true,
        },
        isolation: {
          scopedQueryResultCount: 1,
          expectedHitReturned: true,
          namespaceTrapExcluded: true,
          partitionTrapExcluded: true,
          foreignOrgTrapExcluded: true,
          vectorsReturned: false,
          payloadReturned: true,
          filter: {
            orgFilterApplied: true,
            workspaceFilterApplied: true,
            knowledgeBaseFilterApplied: true,
            sourceFilterApplied: true,
            providerModelDimensionFilterApplied: true,
            namespaceFilterApplied: input.namespacePolicy !== "none",
            partitionFilterApplied: input.partitioningPolicy !== "none",
          },
        },
        deletion: {
          scopedDeleteIssued: true,
          postDeleteResultCount: 0,
          expectedHitRemoved: true,
          cleanupByPointIdAttempted: true,
        },
        redaction: {
          endpointReturned: false,
          collectionReturned: false,
          apiKeyReturned: false,
          evidenceFileBodyReturned: false,
          rawEvidencePathReturned: false,
          namespaceValuesReturned: false,
          partitionValuesReturned: false,
          payloadValuesReturned: false,
          pointIdsReturned: false,
          vectorValuesReturned: false,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return path;
}

function vectorForEmbeddingText(text: string): number[] {
  const vector = Array.from({ length: 1536 }, () => 0);
  if (text === "latent-nearest-neighbor" || text.includes("semantic controls"))
    vector[0] = 1;
  else vector[1] = 1;
  return vector;
}

function hybridVectorForEmbeddingText(text: string): number[] {
  const vector = Array.from({ length: 1536 }, () => 0);
  if (
    text === "hybrid-vector-query exact phrase zebra" ||
    text.includes("semantic controls")
  )
    vector[0] = 1;
  else vector[1] = 1;
  return vector;
}
