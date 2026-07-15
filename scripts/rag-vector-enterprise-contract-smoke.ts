import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { scopeValues } from "../packages/auth/src/index";
import { readEnv } from "../packages/config/src/index";
import { createRomeoApi } from "../packages/core/src/api";
import { InMemoryRomeoRepository } from "../packages/core/src/repositories/in-memory";
import { EnvironmentSecretResolver } from "../packages/core/src/services/secret-resolver";

type Api = ReturnType<typeof createRomeoApi>;

const output = argValue("--output");
const pid = process.pid;
const rawSentinels = {
  deniedCorpus: `raw-rag-denied-corpus-${pid}`,
  qdrantCollection: `romeo-secret-vector-collection-${pid}`,
  qdrantCrossChunk: `cross-tenant-vector-chunk-${pid}`,
  qdrantCrossKnowledgeBase: `cross-tenant-vector-kb-${pid}`,
  qdrantCrossOrg: `cross-tenant-vector-org-${pid}`,
  qdrantCrossSource: `cross-tenant-vector-source-${pid}`,
  qdrantSecretRef: `env://QDRANT_ACCEPTANCE_SECRET_${pid}`,
  qdrantSecretValue: `RAW_QDRANT_ACCEPTANCE_SECRET_${pid}`,
  qdrantUrl: `https://qdrant-${pid}.vectors.example.com`,
  sharedCorpus: `raw-rag-shared-corpus-${pid}`,
  userCorpus: `raw-rag-user-private-corpus-${pid}`,
  workspaceCorpus: `raw-rag-workspace-corpus-${pid}`,
  orgCorpus: `raw-rag-org-corpus-${pid}`,
};

const defaultRepository = new InMemoryRomeoRepository();
const defaultApi = createRomeoApi(defaultRepository, {
  env: readEnv({ DEV_SEEDED_LOGIN: "true", TENANCY_MODE: "single" }),
});

const defaultMe = await requestJson<BootstrapResponse>(
  defaultApi,
  "/api/v1/me",
);
assertStatus(defaultMe.response, 200, "/me bootstrap");
if (defaultMe.body.deployment.tenancyMode !== "single") {
  throw new Error("/me did not expose the single-tenant deployment mode.");
}

const defaultPolicy = await requestJson<RagPolicyResponse>(
  defaultApi,
  "/api/v1/admin/rag/policy",
);
assertStatus(defaultPolicy.response, 200, "default RAG policy");
assertDefaultRagPolicy(defaultPolicy.body.data);

const alphaWorkspace = await createWorkspace(defaultApi, {
  name: "RAG Contract Alpha",
  slug: `rag-contract-alpha-${pid}`,
});
const betaWorkspace = await createWorkspace(defaultApi, {
  name: "RAG Contract Beta",
  slug: `rag-contract-beta-${pid}`,
});
const adminToken = await createUserApiKey(defaultApi);
const serviceAccount = await postJson<{ data: { id: string } }>(
  defaultApi,
  "/api/v1/service-accounts",
  {
    name: "RAG contract corpus owner",
    scopes: ["me:read", "knowledge:read", "knowledge:write", "knowledge:query"],
  },
  adminToken,
);
assertStatus(serviceAccount.response, 201, "service account create");
const serviceToken = await createServiceAccountApiKey(
  defaultApi,
  serviceAccount.body.data.id,
  adminToken,
);

const userPrivate = await createKnowledgeCorpus(defaultApi, {
  token: adminToken,
  workspaceId: "workspace_default",
  name: "RAG contract user-private corpus",
  fileName: "user-private.md",
  content: `Romeo tiered RAG user-private evidence ${rawSentinels.userCorpus}.`,
});
const workspace = await createKnowledgeCorpus(defaultApi, {
  token: serviceToken,
  workspaceId: alphaWorkspace.id,
  name: "RAG contract workspace corpus",
  fileName: "workspace.md",
  content: `Romeo tiered RAG workspace evidence ${rawSentinels.workspaceCorpus}.`,
});
await shareKnowledgeBase(defaultApi, {
  token: serviceToken,
  knowledgeBaseId: workspace.id,
  principalType: "user",
  principalId: "user_dev_admin",
  permissions: ["read", "use"],
});
const org = await createKnowledgeCorpus(defaultApi, {
  token: adminToken,
  workspaceId: betaWorkspace.id,
  name: "RAG contract org corpus",
  fileName: "org.md",
  content: `Romeo tiered RAG org evidence ${rawSentinels.orgCorpus}.`,
});
const shared = await createKnowledgeCorpus(defaultApi, {
  token: adminToken,
  workspaceId: alphaWorkspace.id,
  name: "RAG contract shared corpus",
  fileName: "shared.md",
  content: `Romeo tiered RAG shared evidence ${rawSentinels.sharedCorpus}.`,
});
const denied = await createKnowledgeCorpus(defaultApi, {
  token: serviceToken,
  workspaceId: betaWorkspace.id,
  name: "RAG contract denied corpus",
  fileName: "denied.md",
  content: `Romeo tiered RAG denied evidence ${rawSentinels.deniedCorpus}.`,
});

const tierPolicy = await patchJson<RagPolicyResponse>(
  defaultApi,
  "/api/v1/admin/rag/policy",
  {
    defaultMaxResultsPerTier: {
      user_private: 2,
      workspace: 2,
      org: 2,
      shared: 2,
    },
    knowledgeBaseTierAssignments: {
      org: [org.id],
      shared: [shared.id],
    },
  },
  adminToken,
);
assertStatus(tierPolicy.response, 200, "tiered RAG policy update");

const tieredQuery = await postJson<TieredQueryResponse>(
  defaultApi,
  "/api/v1/knowledge-bases/query",
  {
    knowledgeBaseIds: [
      denied.id,
      userPrivate.id,
      workspace.id,
      org.id,
      shared.id,
    ],
    query: "Romeo tiered RAG evidence",
    maxResultsPerTier: {
      user_private: 2,
      workspace: 2,
      org: 2,
      shared: 2,
    },
  },
  adminToken,
);
assertStatus(tieredQuery.response, 200, "tiered RAG query");
assertTieredQuery(tieredQuery.body.data, {
  expectedHits: [
    { knowledgeBaseId: userPrivate.id, tier: "user_private" },
    { knowledgeBaseId: workspace.id, tier: "workspace" },
    { knowledgeBaseId: org.id, tier: "org" },
    { knowledgeBaseId: shared.id, tier: "shared" },
  ],
  deniedKnowledgeBaseId: denied.id,
});

const audit = await requestJson<{ data: unknown[] }>(
  defaultApi,
  "/api/v1/audit-logs?action=knowledge.query.tiered&limit=10",
  adminToken,
);
assertStatus(audit.response, 200, "tiered RAG audit readback");
assertNotContains(
  JSON.stringify(audit.body),
  rawSentinels.deniedCorpus,
  "tiered RAG audit",
);
assertNotContains(
  JSON.stringify(audit.body),
  denied.id,
  "tiered RAG audit denied corpus id",
);

const physicalIsolationPolicy = await patchJson<RagPolicyResponse>(
  defaultApi,
  "/api/v1/admin/rag/policy",
  {
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
  },
  adminToken,
);
assertStatus(
  physicalIsolationPolicy.response,
  200,
  "physical isolation policy update",
);
const mismatchPosture = await requestJson<RagPostureResponse>(
  defaultApi,
  "/api/v1/admin/rag/posture",
  adminToken,
);
assertStatus(mismatchPosture.response, 200, "RAG posture mismatch readback");
assertPhysicalIsolationMismatch(mismatchPosture.body.data);

const qdrantState: {
  apiKeyHeaderSeen: number;
  queryBodies: unknown[];
  upsertBodies: unknown[];
  authorizedPayload?: Record<string, unknown>;
} = {
  apiKeyHeaderSeen: 0,
  queryBodies: [],
  upsertBodies: [],
};
const qdrantRepository = new InMemoryRomeoRepository();
const qdrantApi = createRomeoApi(qdrantRepository, {
  embeddingFetch,
  env: readEnv({
    DEV_SEEDED_LOGIN: "true",
    EXTERNAL_VECTOR_STORE_DRIVER: "qdrant",
    QDRANT_API_KEY_REF: rawSentinels.qdrantSecretRef,
    QDRANT_COLLECTION: rawSentinels.qdrantCollection,
    QDRANT_URL: rawSentinels.qdrantUrl,
    VECTOR_ISOLATION_MODE: "external_namespace_per_org",
    VECTOR_NAMESPACE_POLICY: "knowledge_base",
    VECTOR_PARTITIONING_POLICY: "org",
  }),
  qdrantFetch: qdrantFetch(qdrantState),
  secretResolver: new EnvironmentSecretResolver({
    [envVarName(rawSentinels.qdrantSecretRef)]: rawSentinels.qdrantSecretValue,
  }),
});
const qdrantToken = await createUserApiKey(qdrantApi);
const qdrantPosture = await requestJson<RagPostureResponse>(
  qdrantApi,
  "/api/v1/admin/rag/posture",
  qdrantToken,
);
assertStatus(qdrantPosture.response, 200, "Qdrant RAG posture");
assertQdrantPosture(qdrantPosture.body.data);
assertNoSensitive("Qdrant posture", JSON.stringify(qdrantPosture.body), [
  rawSentinels.qdrantUrl,
  rawSentinels.qdrantCollection,
  rawSentinels.qdrantSecretRef,
  rawSentinels.qdrantSecretValue,
]);

const qdrantSource = await postJson<{ data: { id: string } }>(
  qdrantApi,
  "/api/v1/knowledge-bases/kb_default/sources",
  {
    fileName: "qdrant-authorized.md",
    mimeType: "text/markdown",
    sizeBytes: rawSentinels.userCorpus.length,
    content: `Romeo authorized external-vector evidence ${rawSentinels.userCorpus}.`,
  },
  qdrantToken,
);
assertStatus(qdrantSource.response, 202, "Qdrant source create");
const qdrantIndex = await postJson<{ data: { embeddingCount: number } }>(
  qdrantApi,
  "/api/v1/knowledge-bases/kb_default/embeddings",
  { providerId: "provider_ollama", model: "nomic-embed-text" },
  qdrantToken,
);
assertStatus(qdrantIndex.response, 200, "Qdrant embedding index");
if (qdrantIndex.body.data.embeddingCount < 1) {
  throw new Error("Qdrant indexing produced no embeddings.");
}
const qdrantQuery = await postJson<TieredQueryResponse>(
  qdrantApi,
  "/api/v1/knowledge-bases/query",
  {
    knowledgeBaseIds: ["kb_default"],
    query: "authorized external-vector evidence",
    maxResultsPerTier: { user_private: 2 },
  },
  qdrantToken,
);
assertStatus(qdrantQuery.response, 200, "Qdrant tiered query");
assertQdrantTieredQuery(qdrantQuery.body.data);
assertQdrantFilter(qdrantState.queryBodies[0]);
if (qdrantState.apiKeyHeaderSeen < 2) {
  throw new Error("Qdrant API key was not resolved for upsert and query.");
}

const evidence = {
  schemaVersion: "romeo.rag-vector-enterprise-contract-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  checks: [
    "me_exposes_single_tenancy_mode",
    "default_rag_policy_uses_pgvector_shared_row_scope",
    "tiered_rag_user_workspace_org_shared_hits",
    "denied_corpus_skipped_without_id_or_content_leak",
    "tiered_rag_audit_is_metadata_only",
    "rag_policy_exposes_external_vector_and_physical_isolation_controls",
    "physical_vector_isolation_required_mismatch_warns",
    "qdrant_posture_is_sanitized_and_deployment_managed",
    "qdrant_tiered_plan_reports_vector_scope_and_partitioning",
    "qdrant_upsert_and_query_use_secret_resolver_boundary",
    "qdrant_query_uses_scope_filters_and_postgres_post_filtering",
  ],
  endpoints: {
    me: "/api/v1/me",
    ragPolicy: "/api/v1/admin/rag/policy",
    ragPosture: "/api/v1/admin/rag/posture",
    tieredQuery: "/api/v1/knowledge-bases/query",
    knowledgeSources: "/api/v1/knowledge-bases/{knowledgeBaseId}/sources",
    knowledgeEmbeddings: "/api/v1/knowledge-bases/{knowledgeBaseId}/embeddings",
  },
  defaultPgvector: {
    tenancyMode: defaultMe.body.deployment.tenancyMode,
    vectorDriver: tieredQuery.body.data.plan.posture.vectorDriver,
    isolationMode: tieredQuery.body.data.plan.posture.isolationMode,
    requestedKnowledgeBaseCount: tieredQuery.body.data.plan.requestedCount,
    authorizedTierCount: tieredQuery.body.data.plan.authorizedCount,
    skippedDeniedCount: tieredQuery.body.data.plan.skipped.count,
    tierCounts: countBy(tieredQuery.body.data.hits.map((hit) => hit.tier)),
    physicalIsolationMismatch:
      mismatchPosture.body.data.vector.physicalIsolation.status ===
      "deployment_mismatch",
  },
  externalVector: {
    vectorDriver: qdrantQuery.body.data.plan.posture.vectorDriver,
    isolationMode: qdrantQuery.body.data.plan.posture.isolationMode,
    externalVectorStoreDriver:
      qdrantQuery.body.data.plan.posture.externalVectorStoreDriver,
    externalVectorStoreRoutingActive:
      qdrantQuery.body.data.plan.posture.externalVectorStoreRoutingActive,
    namespacePolicy: qdrantQuery.body.data.plan.posture.namespacePolicy,
    partitioningPolicy: qdrantQuery.body.data.plan.posture.partitioningPolicy,
    vectorScopeDriver:
      qdrantQuery.body.data.plan.entries[0]?.vectorScope.driver,
    vectorScopeIsolationMode:
      qdrantQuery.body.data.plan.entries[0]?.vectorScope.isolationMode,
    qdrantUpsertCount: qdrantState.upsertBodies.length,
    qdrantQueryCount: qdrantState.queryBodies.length,
    qdrantApiKeyResolved: qdrantState.apiKeyHeaderSeen >= 2,
    crossTenantHitsReturned: 0,
    vectorsReturned: false,
  },
  redaction: {
    rawCorpusReturned: false,
    deniedCorpusIdReturned: false,
    deniedCorpusContentReturned: false,
    qdrantEndpointReturned: false,
    qdrantCollectionReturned: false,
    qdrantSecretRefReturned: false,
    qdrantSecretValueReturned: false,
    crossTenantVectorPayloadReturned: false,
  },
  evidenceHashes: {
    enabledTiersSha256: sha256(
      tierPolicy.body.data.enabledTiers.slice().sort().join(","),
    ),
    qdrantCheckCodesSha256: sha256(
      [
        qdrantQuery.body.data.plan.posture.vectorDriver,
        qdrantQuery.body.data.plan.posture.externalVectorStoreDriver,
        qdrantQuery.body.data.plan.posture.namespacePolicy,
        qdrantQuery.body.data.plan.posture.partitioningPolicy,
        qdrantQuery.body.data.plan.entries[0]?.vectorScope.driver ?? "",
      ].join(":"),
    ),
  },
};

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
assertNoSensitive("RAG/vector enterprise evidence", serialized);
assertNotContains(serialized, denied.id, "RAG/vector enterprise evidence");

if (output === undefined) process.stdout.write(serialized);
else {
  const outputPath = resolve(process.env.INIT_CWD ?? process.cwd(), output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, "utf8");
  console.log(`Wrote RAG/vector enterprise contract smoke to ${outputPath}`);
}

interface BootstrapResponse {
  deployment: { tenancyMode: "multi" | "single" };
}

interface RagPolicyResponse {
  data: {
    enabledTiers: string[];
    externalVectorStore: {
      mode: string;
      namespacePolicy: string;
      partitioningPolicy: string;
      configured: boolean;
      restoreValidation: string;
    };
    physicalVectorIsolation: {
      mode: string;
      enforcement: string;
      configured: boolean;
      liveEvidenceRequired: boolean;
    };
  };
}

interface RagPostureResponse {
  data: {
    status: string;
    vector: {
      driver: string;
      authoritativeStore: string;
      isolationMode: string;
      externalVectorStoreConfigured: boolean;
      qdrantConfigured: boolean;
      namespaceConfigured: boolean;
      partitioningConfigured: boolean;
      externalStore: {
        driver: string;
        namespacePolicy: string;
        partitioningPolicy: string;
        credentialRefConfigured: boolean;
        credentialRefScheme?: string;
        configured: boolean;
        routingActive: boolean;
      };
      physicalIsolation: {
        deploymentMatched: boolean;
        status: string;
      };
    };
    readiness: {
      warnings: Array<{ code: string; severity: string }>;
    };
  };
}

interface TieredQueryResponse {
  data: {
    hits: Array<{
      content: string;
      knowledgeBaseId: string;
      retrievalRoute?: { mode: string; vectorStoreDriver?: string };
      tier: string;
    }>;
    plan: {
      requestedCount: number;
      authorizedCount: number;
      entries: Array<{
        knowledgeBaseId: string;
        retrievalRoute?: { mode: string; vectorStoreDriver?: string };
        tier: string;
        vectorScope: {
          driver: string;
          isolationMode: string;
        };
      }>;
      posture: {
        externalVectorStoreDriver: string;
        externalVectorStoreRoutingActive: boolean;
        isolationMode: string;
        namespaceConfigured: boolean;
        namespacePolicy: string;
        partitioningConfigured: boolean;
        partitioningPolicy: string;
        vectorDriver: string;
      };
      skipped: {
        count: number;
        reasons: Array<{ count: number; reason: string }>;
      };
    };
  };
}

async function createWorkspace(
  api: Api,
  input: { name: string; slug: string },
): Promise<{ id: string }> {
  const response = await postJson<{ data: { id: string } }>(
    api,
    "/api/v1/workspaces",
    input,
  );
  assertStatus(response.response, 201, "workspace create");
  return response.body.data;
}

async function createUserApiKey(api: Api): Promise<string> {
  const response = await postJson<{ data: { token: string } }>(
    api,
    "/api/v1/api-keys",
    { name: "RAG contract user key", scopes: [...scopeValues] },
  );
  assertStatus(response.response, 201, "user API key create");
  return response.body.data.token;
}

async function createServiceAccountApiKey(
  api: Api,
  serviceAccountId: string,
  adminToken: string,
): Promise<string> {
  const response = await postJson<{ data: { token: string } }>(
    api,
    `/api/v1/service-accounts/${encodeURIComponent(serviceAccountId)}/api-keys`,
    {
      name: "RAG contract service key",
      scopes: [
        "me:read",
        "knowledge:read",
        "knowledge:write",
        "knowledge:query",
      ],
    },
    adminToken,
  );
  assertStatus(response.response, 201, "service account API key create");
  return response.body.data.token;
}

async function createKnowledgeCorpus(
  api: Api,
  input: {
    content: string;
    fileName: string;
    name: string;
    token: string;
    workspaceId: string;
  },
): Promise<{ id: string; sourceId: string }> {
  const created = await postJson<{ data: { id: string } }>(
    api,
    "/api/v1/knowledge-bases",
    { workspaceId: input.workspaceId, name: input.name },
    input.token,
  );
  assertStatus(created.response, 201, "knowledge base create");
  const source = await postJson<{ data: { id: string } }>(
    api,
    `/api/v1/knowledge-bases/${encodeURIComponent(created.body.data.id)}/sources`,
    {
      fileName: input.fileName,
      mimeType: "text/markdown",
      sizeBytes: Buffer.byteLength(input.content, "utf8"),
      content: input.content,
    },
    input.token,
  );
  assertStatus(source.response, 202, "knowledge source create");
  return { id: created.body.data.id, sourceId: source.body.data.id };
}

async function shareKnowledgeBase(
  api: Api,
  input: {
    knowledgeBaseId: string;
    permissions: string[];
    principalId: string;
    principalType: string;
    token: string;
  },
): Promise<void> {
  const response = await postJson<{ data: unknown[] }>(
    api,
    `/api/v1/knowledge-bases/${encodeURIComponent(input.knowledgeBaseId)}/shares`,
    {
      principalType: input.principalType,
      principalId: input.principalId,
      permissions: input.permissions,
    },
    input.token,
  );
  assertStatus(response.response, 201, "knowledge base share");
}

function assertDefaultRagPolicy(policy: RagPolicyResponse["data"]): void {
  if (
    policy.externalVectorStore.mode !== "disabled" ||
    policy.externalVectorStore.configured !== false ||
    policy.physicalVectorIsolation.mode !== "shared_row_scope" ||
    policy.physicalVectorIsolation.enforcement !== "advisory"
  ) {
    throw new Error("Default RAG policy posture changed unexpectedly.");
  }
}

function assertTieredQuery(
  data: TieredQueryResponse["data"],
  input: {
    deniedKnowledgeBaseId: string;
    expectedHits: Array<{ knowledgeBaseId: string; tier: string }>;
  },
): void {
  if (data.plan.requestedCount !== 5 || data.plan.authorizedCount !== 4) {
    throw new Error("Tiered RAG plan counts did not match expectations.");
  }
  assertSkippedReason(data.plan.skipped, "missing_use_grant", 1);
  if (
    data.plan.posture.vectorDriver !== "pgvector" ||
    data.plan.posture.isolationMode !== "shared_row_scope" ||
    data.plan.posture.externalVectorStoreDriver !== "disabled" ||
    data.plan.posture.namespacePolicy !== "none" ||
    data.plan.posture.partitioningPolicy !== "none"
  ) {
    throw new Error("Default tiered RAG posture did not use pgvector.");
  }
  for (const expected of input.expectedHits) {
    const entry = data.plan.entries.find(
      (candidate) => candidate.knowledgeBaseId === expected.knowledgeBaseId,
    );
    if (entry?.tier !== expected.tier) {
      throw new Error(`Missing ${expected.tier} retrieval plan entry.`);
    }
    const hit = data.hits.find(
      (candidate) =>
        candidate.knowledgeBaseId === expected.knowledgeBaseId &&
        candidate.tier === expected.tier,
    );
    if (hit === undefined) {
      throw new Error(`Missing ${expected.tier} retrieval hit.`);
    }
  }
  const serialized = JSON.stringify(data);
  assertNotContains(
    serialized,
    input.deniedKnowledgeBaseId,
    "tiered RAG query",
  );
  assertNotContains(serialized, rawSentinels.deniedCorpus, "tiered RAG query");
}

function assertPhysicalIsolationMismatch(
  data: RagPostureResponse["data"],
): void {
  if (
    data.vector.physicalIsolation.status !== "deployment_mismatch" ||
    data.vector.physicalIsolation.deploymentMatched !== false
  ) {
    throw new Error(
      "RAG posture did not report the physical isolation mismatch.",
    );
  }
  if (
    !data.readiness.warnings.some(
      (warning) =>
        warning.code === "physical_vector_isolation_mismatch" &&
        warning.severity === "warning",
    )
  ) {
    throw new Error("RAG posture omitted the physical isolation warning.");
  }
}

function assertQdrantPosture(data: RagPostureResponse["data"]): void {
  if (
    data.vector.driver !== "qdrant" ||
    data.vector.authoritativeStore !== "postgres" ||
    data.vector.externalStore.driver !== "qdrant" ||
    data.vector.externalStore.credentialRefScheme !== "env" ||
    data.vector.externalStore.routingActive !== true ||
    data.vector.externalStore.namespacePolicy !== "knowledge_base" ||
    data.vector.externalStore.partitioningPolicy !== "org"
  ) {
    throw new Error("Qdrant RAG posture did not expose the expected metadata.");
  }
}

function assertQdrantTieredQuery(data: TieredQueryResponse["data"]): void {
  if (
    data.plan.posture.vectorDriver !== "qdrant" ||
    data.plan.posture.externalVectorStoreDriver !== "qdrant" ||
    data.plan.posture.externalVectorStoreRoutingActive !== true ||
    data.plan.posture.namespaceConfigured !== true ||
    data.plan.posture.namespacePolicy !== "knowledge_base" ||
    data.plan.posture.partitioningConfigured !== true ||
    data.plan.posture.partitioningPolicy !== "org"
  ) {
    throw new Error(
      "Tiered Qdrant query did not report active external routing.",
    );
  }
  const hit = data.hits[0];
  if (data.hits.length !== 1 || hit === undefined) {
    throw new Error("Qdrant post-filtering did not return exactly one hit.");
  }
  if (!hit.content.includes(rawSentinels.userCorpus)) {
    throw new Error("Qdrant query did not return the authorized corpus.");
  }
  const entry = data.plan.entries[0];
  if (
    entry?.retrievalRoute?.mode !== "external_vector" ||
    entry.retrievalRoute.vectorStoreDriver !== "qdrant" ||
    entry.vectorScope.driver !== "qdrant" ||
    entry.vectorScope.isolationMode !== "external_namespace_per_org"
  ) {
    throw new Error("Qdrant retrieval route was not reported.");
  }
  const serialized = JSON.stringify(data);
  for (const raw of [
    rawSentinels.qdrantCrossChunk,
    rawSentinels.qdrantCrossKnowledgeBase,
    rawSentinels.qdrantCrossOrg,
    rawSentinels.qdrantCrossSource,
  ]) {
    assertNotContains(serialized, raw, "Qdrant tiered query");
  }
}

function assertQdrantFilter(body: unknown): void {
  const filter = (body as { filter?: { must?: unknown[] } } | undefined)
    ?.filter;
  const must = Array.isArray(filter?.must) ? filter.must : [];
  const serialized = JSON.stringify(must);
  for (const key of [
    "romeoNamespace",
    "romeoPartition",
    "orgId",
    "workspaceId",
    "knowledgeBaseId",
    "sourceId",
  ]) {
    if (!serialized.includes(key)) {
      throw new Error(`Qdrant query filter omitted ${key}.`);
    }
  }
  if (JSON.stringify(body).includes('"with_vector":true')) {
    throw new Error("Qdrant query requested vector readback.");
  }
}

function qdrantFetch(state: {
  apiKeyHeaderSeen: number;
  queryBodies: unknown[];
  upsertBodies: unknown[];
  authorizedPayload?: Record<string, unknown>;
}): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body =
      init?.body === undefined ? undefined : JSON.parse(String(init.body));
    if (
      headerValue(init?.headers, "api-key") === rawSentinels.qdrantSecretValue
    ) {
      state.apiKeyHeaderSeen += 1;
    }
    if (url.endsWith("/points?wait=true")) {
      state.upsertBodies.push(body);
      const points = (body as { points?: Array<{ payload?: unknown }> }).points;
      const payload = points?.[0]?.payload;
      if (payload !== undefined && typeof payload === "object") {
        state.authorizedPayload = payload as Record<string, unknown>;
      }
      return jsonResponse({ status: "ok" });
    }
    if (url.endsWith("/points/query")) {
      state.queryBodies.push(body);
      return jsonResponse({
        result: {
          points: [
            {
              id: "cross-tenant-point",
              score: 0.999,
              payload: {
                chunkId: rawSentinels.qdrantCrossChunk,
                dimensions: 1536,
                embeddingModel: "nomic-embed-text",
                embeddingProvider: "provider_ollama",
                knowledgeBaseId: rawSentinels.qdrantCrossKnowledgeBase,
                orgId: rawSentinels.qdrantCrossOrg,
                sourceId: rawSentinels.qdrantCrossSource,
                workspaceId: "cross-tenant-workspace",
              },
            },
            {
              id: "authorized-point",
              score: 0.7,
              payload: state.authorizedPayload,
            },
          ],
        },
        status: "ok",
      });
    }
    return jsonResponse({ result: { status: "green" }, status: "ok" });
  };
}

async function embeddingFetch(
  _input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const body = JSON.parse(String(init?.body)) as {
    input?: string[];
    model?: string;
  };
  const input = body.input ?? [];
  return jsonResponse({
    model: body.model ?? "nomic-embed-text",
    embeddings: input.map(vectorForText),
  });
}

async function requestJson<T>(
  api: Api,
  path: string,
  token?: string,
): Promise<{ body: T; response: Response }> {
  const response = await api.request(path, {
    headers: authHeaders(token),
  });
  return { body: (await response.json()) as T, response };
}

async function postJson<T>(
  api: Api,
  path: string,
  body: unknown,
  token?: string,
): Promise<{ body: T; response: Response }> {
  const response = await api.request(path, {
    method: "POST",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { body: (await response.json()) as T, response };
}

async function patchJson<T>(
  api: Api,
  path: string,
  body: unknown,
  token?: string,
): Promise<{ body: T; response: Response }> {
  const response = await api.request(path, {
    method: "PATCH",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { body: (await response.json()) as T, response };
}

function authHeaders(token: string | undefined): Record<string, string> {
  return token === undefined ? {} : { authorization: `Bearer ${token}` };
}

function assertStatus(
  response: Response,
  expected: number,
  label: string,
): void {
  if (response.status !== expected) {
    throw new Error(
      `${label} returned ${response.status}; expected ${expected}.`,
    );
  }
}

function assertSkippedReason(
  skipped: TieredQueryResponse["data"]["plan"]["skipped"],
  reason: string,
  count: number,
): void {
  const item = skipped.reasons.find((candidate) => candidate.reason === reason);
  if (item?.count !== count) {
    throw new Error(`Expected skipped reason ${reason}=${count}.`);
  }
}

function assertNoSensitive(
  label: string,
  value: string,
  rawValues: string[] = Object.values(rawSentinels),
): void {
  for (const raw of rawValues) {
    assertNotContains(value, raw, label);
  }
}

function assertNotContains(value: string, raw: string, label: string): void {
  if (value.includes(raw)) throw new Error(`${label} leaked raw content.`);
}

function headerValue(
  headers: HeadersInit | undefined,
  key: string,
): string | undefined {
  if (headers === undefined) return undefined;
  if (headers instanceof Headers) return headers.get(key) ?? undefined;
  if (Array.isArray(headers)) {
    const match = headers.find(
      ([name]) => name.toLowerCase() === key.toLowerCase(),
    );
    return match?.[1];
  }
  return headers[key];
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function envVarName(secretRef: string): string {
  return secretRef.replace(/^env:\/\//u, "");
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function vectorForText(text: string): number[] {
  const vector = Array.from({ length: 1536 }, () => 0);
  if (text.includes("authorized") || text.includes("Romeo")) vector[0] = 1;
  else vector[1] = 1;
  return vector;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
