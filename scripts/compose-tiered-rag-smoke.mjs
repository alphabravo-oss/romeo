import { randomBytes } from "node:crypto";

import {
  apiJson,
  argValue,
  assertComposeLogsRedacted,
  assertReadinessReady,
  cleanupComposeHarness,
  compose,
  createAdminApiKey,
  createComposeHarness,
  expectUnauthorizedMe,
  randomProjectName,
  waitForHealth,
  writeComposeEnv,
  writeJsonEvidence,
} from "./lib/compose-smoke-support.mjs";

const keep = process.argv.includes("--keep");
const projectName =
  argValue("--project-name") ?? randomProjectName("romeo_tiered_rag_smoke");
const timeoutMs = Number.parseInt(argValue("--timeout-ms") ?? "180000", 10);
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
  throw new Error("--timeout-ms must be a positive integer.");
}

const harness = await createComposeHarness({ projectName, timeoutMs });
const runId = randomBytes(8).toString("hex");
const sentinels = {
  user: `compose_tiered_rag_user_${runId}`,
  workspace: `compose_tiered_rag_workspace_${runId}`,
  org: `compose_tiered_rag_org_${runId}`,
  shared: `compose_tiered_rag_shared_${runId}`,
  denied: `compose_tiered_rag_denied_${runId}`,
};

let adminToken;
let serviceAccountToken;

try {
  writeComposeEnv(harness, { devSeededLogin: true });
  compose(harness, ["up", "-d", "--build", "app"]);
  await waitForHealth(harness);
  compose(harness, [
    "run",
    "--rm",
    "migrate",
    "pnpm",
    "seed:postgres",
    "--",
    "--confirm-development-seed",
  ]);

  adminToken = await createAdminApiKey(harness);
  writeComposeEnv(harness, { devSeededLogin: false });
  compose(harness, ["up", "-d", "--force-recreate", "app"]);
  await waitForHealth(harness);
  await expectUnauthorizedMe(harness);
  await assertReadinessReady(harness, adminToken);

  const me = await apiJson(harness, "/api/v1/me", { token: adminToken });
  assertEqual(
    me.deployment?.tenancyMode,
    "single",
    "/me did not expose the Compose tenancy mode.",
  );

  const alphaWorkspace = await createWorkspace(
    "Compose RAG Alpha",
    "rag-alpha",
  );
  const betaWorkspace = await createWorkspace("Compose RAG Beta", "rag-beta");

  const serviceAccount = await createServiceAccount();
  serviceAccountToken = await createServiceAccountApiKey(serviceAccount.id);

  const userPrivate = await createKnowledgeCorpus({
    token: adminToken,
    workspaceId: "workspace_default",
    name: "Compose user private corpus",
    fileName: "compose-user-private.md",
    content: `Romeo compose tiered RAG evidence for the user-private tier ${sentinels.user}.`,
  });
  const workspace = await createKnowledgeCorpus({
    token: serviceAccountToken,
    workspaceId: alphaWorkspace.id,
    name: "Compose workspace corpus",
    fileName: "compose-workspace.md",
    content: `Romeo compose tiered RAG evidence for the workspace tier ${sentinels.workspace}.`,
  });
  await shareKnowledgeBase(serviceAccountToken, workspace.id, {
    principalType: "user",
    principalId: "user_dev_admin",
    permissions: ["read", "use"],
  });
  const org = await createKnowledgeCorpus({
    token: adminToken,
    workspaceId: betaWorkspace.id,
    name: "Compose org corpus",
    fileName: "compose-org.md",
    content: `Romeo compose tiered RAG evidence for the org tier ${sentinels.org}.`,
  });
  const shared = await createKnowledgeCorpus({
    token: adminToken,
    workspaceId: alphaWorkspace.id,
    name: "Compose shared corpus",
    fileName: "compose-shared.md",
    content: `Romeo compose tiered RAG evidence for the shared tier ${sentinels.shared}.`,
  });
  const denied = await createKnowledgeCorpus({
    token: serviceAccountToken,
    workspaceId: betaWorkspace.id,
    name: "Compose denied corpus",
    fileName: "compose-denied.md",
    content: `Romeo compose tiered RAG evidence for the denied tier ${sentinels.denied}.`,
  });

  await apiJson(harness, "/api/v1/admin/rag/policy", {
    method: "PATCH",
    token: adminToken,
    body: {
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
  });

  const query = await apiJson(harness, "/api/v1/knowledge-bases/query", {
    method: "POST",
    token: adminToken,
    body: {
      knowledgeBaseIds: [
        denied.id,
        userPrivate.id,
        workspace.id,
        org.id,
        shared.id,
      ],
      query: "Romeo compose tiered RAG evidence",
      maxResultsPerTier: {
        user_private: 2,
        workspace: 2,
        org: 2,
        shared: 2,
      },
    },
  });
  assertTieredQuery(query.data, {
    deniedKnowledgeBaseId: denied.id,
    deniedSentinel: sentinels.denied,
    expected: [
      {
        knowledgeBaseId: userPrivate.id,
        tier: "user_private",
        workspaceId: "workspace_default",
        sentinel: sentinels.user,
      },
      {
        knowledgeBaseId: workspace.id,
        tier: "workspace",
        workspaceId: alphaWorkspace.id,
        sentinel: sentinels.workspace,
      },
      {
        knowledgeBaseId: org.id,
        tier: "org",
        workspaceId: betaWorkspace.id,
        sentinel: sentinels.org,
      },
      {
        knowledgeBaseId: shared.id,
        tier: "shared",
        workspaceId: alphaWorkspace.id,
        sentinel: sentinels.shared,
      },
    ],
  });

  const audit = await apiJson(
    harness,
    "/api/v1/audit-logs?action=knowledge.query.tiered&limit=10",
    { token: adminToken },
  );
  assertTieredAudit(audit.data, {
    authorizedKnowledgeBaseIds: [
      userPrivate.id,
      workspace.id,
      org.id,
      shared.id,
    ],
    deniedKnowledgeBaseId: denied.id,
    deniedSentinel: sentinels.denied,
  });

  const usage = await apiJson(harness, "/api/v1/usage/events", {
    token: adminToken,
  });
  assertServiceAccountUsageActors(usage.data, [
    workspace.sourceId,
    denied.sourceId,
  ]);

  assertComposeLogsRedacted(harness, [
    adminToken,
    serviceAccountToken,
    harness.postgresPassword,
    harness.s3Secret,
    harness.sessionSecret,
    harness.webhookSigningKey,
    ...Object.values(sentinels),
  ]);

  writeJsonEvidence({
    schemaVersion: "romeo.compose-tiered-rag-smoke.v1",
    generatedAt: new Date().toISOString(),
    projectName,
    status: "passed",
    tenancyMode: me.deployment.tenancyMode,
    checks: [
      "compose_build_and_start",
      "migration_service",
      "explicit_development_seed",
      "secure_recreate_with_seeded_login_disabled",
      "unauthenticated_api_denied",
      "me_deployment_tenancy_mode_exposed",
      "admin_readiness_ready",
      "workspace_create_api",
      "single_org_multiple_workspace_setup",
      "service_account_owned_workspace_corpus",
      "service_account_usage_system_actor",
      "tiered_rag_user_private_workspace_org_shared_hits",
      "denied_corpus_skipped_without_id_or_content_leak",
      "tiered_rag_audit_metadata_only",
      "compose_logs_redacted",
    ],
    workspaces: [
      "workspace_default",
      alphaWorkspace.id,
      betaWorkspace.id,
    ].sort(),
    authorizedTierCount: 4,
    skippedDeniedCount: 1,
  });
} finally {
  if (!keep) {
    cleanupComposeHarness(harness);
  } else {
    process.stderr.write(
      `Keeping Compose project ${projectName} and env file ${harness.envPath} for inspection.\n`,
    );
  }
}

async function createWorkspace(name, slug) {
  const response = await apiJson(harness, "/api/v1/workspaces", {
    method: "POST",
    token: adminToken,
    body: { name, slug },
    expectedStatus: 201,
  });
  if (typeof response.data?.id !== "string") {
    throw new Error("Workspace creation did not return an id.");
  }
  return response.data;
}

async function createServiceAccount() {
  const response = await apiJson(harness, "/api/v1/service-accounts", {
    method: "POST",
    token: adminToken,
    body: {
      name: "Compose tiered RAG corpus owner",
      scopes: ["knowledge:read", "knowledge:write", "knowledge:query"],
    },
    expectedStatus: 201,
  });
  if (typeof response.data?.id !== "string") {
    throw new Error("Service account creation did not return an id.");
  }
  return response.data;
}

async function createServiceAccountApiKey(serviceAccountId) {
  const response = await apiJson(
    harness,
    `/api/v1/service-accounts/${encodeURIComponent(serviceAccountId)}/api-keys`,
    {
      method: "POST",
      token: adminToken,
      body: {
        name: "Compose tiered RAG corpus key",
        scopes: ["knowledge:read", "knowledge:write", "knowledge:query"],
      },
      expectedStatus: 201,
    },
  );
  if (typeof response.data?.token !== "string") {
    throw new Error("Service account API key creation did not return a token.");
  }
  return response.data.token;
}

async function createKnowledgeCorpus(input) {
  const created = await apiJson(harness, "/api/v1/knowledge-bases", {
    method: "POST",
    token: input.token,
    body: {
      workspaceId: input.workspaceId,
      name: input.name,
    },
    expectedStatus: 201,
  });
  if (typeof created.data?.id !== "string") {
    throw new Error("Knowledge base creation did not return an id.");
  }
  const source = await apiJson(
    harness,
    `/api/v1/knowledge-bases/${created.data.id}/sources`,
    {
      method: "POST",
      token: input.token,
      body: {
        fileName: input.fileName,
        mimeType: "text/markdown",
        sizeBytes: Buffer.byteLength(input.content, "utf8"),
        content: input.content,
      },
      expectedStatus: 202,
    },
  );
  return { ...created.data, sourceId: source.data.id };
}

async function shareKnowledgeBase(token, knowledgeBaseId, share) {
  await apiJson(harness, `/api/v1/knowledge-bases/${knowledgeBaseId}/shares`, {
    method: "POST",
    token,
    body: share,
    expectedStatus: 201,
  });
}

function assertTieredQuery(data, input) {
  assertEqual(data?.plan?.requestedCount, 5, "Tiered query requested count.");
  assertEqual(data.plan.authorizedCount, 4, "Tiered query authorized count.");
  assertEqual(data.plan.skipped?.count, 1, "Tiered query skipped count.");
  assertSkippedReason(data.plan.skipped, "missing_use_grant", 1);
  assertEqual(data.plan.posture?.vectorDriver, "pgvector", "Vector driver.");
  assertEqual(
    data.plan.posture?.isolationMode,
    "shared_row_scope",
    "Vector isolation mode.",
  );
  assertEqual(
    data.plan.posture?.externalVectorStoreDriver,
    "disabled",
    "External vector driver.",
  );

  const entries = new Map(
    data.plan.entries.map((entry) => [entry.knowledgeBaseId, entry]),
  );
  for (const expected of input.expected) {
    const entry = entries.get(expected.knowledgeBaseId);
    if (entry === undefined) {
      throw new Error(`Missing retrieval plan entry for ${expected.tier}.`);
    }
    assertEqual(entry.tier, expected.tier, `${expected.tier} plan tier.`);
    assertEqual(
      entry.workspaceId,
      expected.workspaceId,
      `${expected.tier} workspace id.`,
    );
  }

  const hits = Array.isArray(data.hits) ? data.hits : [];
  for (const expected of input.expected) {
    const hit = hits.find(
      (candidate) =>
        candidate.knowledgeBaseId === expected.knowledgeBaseId &&
        candidate.tier === expected.tier &&
        typeof candidate.content === "string" &&
        candidate.content.includes(expected.sentinel),
    );
    if (hit === undefined) {
      throw new Error(`Missing ${expected.tier} retrieval hit.`);
    }
  }

  const serialized = JSON.stringify(data);
  if (serialized.includes(input.deniedKnowledgeBaseId)) {
    throw new Error(
      "Tiered query response leaked the denied knowledge base id.",
    );
  }
  if (serialized.includes(input.deniedSentinel)) {
    throw new Error("Tiered query response leaked denied corpus content.");
  }
}

function assertTieredAudit(auditLogs, input) {
  if (!Array.isArray(auditLogs) || auditLogs.length === 0) {
    throw new Error("Tiered query audit log was not returned.");
  }
  const event = auditLogs.find(
    (candidate) => candidate.action === "knowledge.query.tiered",
  );
  if (event === undefined) {
    throw new Error("Tiered query audit event was not recorded.");
  }
  assertEqual(event.metadata?.requestedCount, 5, "Audit requested count.");
  assertEqual(event.metadata?.authorizedCount, 4, "Audit authorized count.");
  assertSkippedReason(event.metadata?.skipped, "missing_use_grant", 1);
  for (const knowledgeBaseId of input.authorizedKnowledgeBaseIds) {
    if (!event.metadata?.knowledgeBaseIds?.includes(knowledgeBaseId)) {
      throw new Error(`Audit omitted authorized KB ${knowledgeBaseId}.`);
    }
  }
  const serialized = JSON.stringify(event);
  if (serialized.includes(input.deniedKnowledgeBaseId)) {
    throw new Error("Tiered query audit leaked the denied knowledge base id.");
  }
  if (serialized.includes(input.deniedSentinel)) {
    throw new Error("Tiered query audit leaked denied corpus content.");
  }
}

function assertServiceAccountUsageActors(usageEvents, sourceIds) {
  if (!Array.isArray(usageEvents)) {
    throw new Error("Usage events were not returned.");
  }
  for (const sourceId of sourceIds) {
    const event = usageEvents.find(
      (candidate) =>
        candidate.sourceId === sourceId &&
        candidate.metric === "storage.source_registered",
    );
    if (event === undefined) {
      throw new Error(`Missing source registration usage for ${sourceId}.`);
    }
    if (
      typeof event.actorId !== "string" ||
      !event.actorId.startsWith("system_service_account_usage_")
    ) {
      throw new Error(
        `Service account source ${sourceId} used unexpected usage actor ${event.actorId}.`,
      );
    }
  }
}

function assertSkippedReason(skipped, reason, count) {
  const item = skipped?.reasons?.find(
    (candidate) => candidate.reason === reason,
  );
  if (item?.count !== count) {
    throw new Error(
      `Expected skipped reason ${reason}=${count}, got ${JSON.stringify(skipped)}.`,
    );
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected}, got ${actual}.`);
  }
}
