import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  assertTextDoesNotContain,
  freePort,
  kubectl,
  kubectlJson,
  podLogs,
  startPortForward,
  waitForKubectlRollout,
} from "./lib/kubernetes-smoke-support.mjs";

const outputPath = argValue("--output");
const dryRun = process.argv.includes("--dry-run");
const keepPolicy = process.argv.includes("--keep-policy");
const namespace = argValue("--namespace") ?? process.env.ROMEO_NAMESPACE;
const releaseName = argValue("--release-name") ?? "romeo";
const serviceName = argValue("--service") ?? helmFullname(releaseName);
const deploymentName = argValue("--deployment") ?? serviceName;
const selector =
  argValue("--selector") ??
  `app.kubernetes.io/name=romeo,app.kubernetes.io/instance=${releaseName},app.kubernetes.io/component=app`;
const servicePort = parsePositiveInteger("--service-port", 3000);
const timeoutMs = parsePositiveInteger("--timeout-ms", 300000);
const apiKey = argValue("--api-key") ?? process.env.ROMEO_API_KEY;
const providedBaseUrl = argValue("--base-url");
const runId = randomBytes(8).toString("hex");
const sentinels = {
  user: `k8s_tiered_rag_user_${runId}`,
  workspace: `k8s_tiered_rag_workspace_${runId}`,
  org: `k8s_tiered_rag_org_${runId}`,
  shared: `k8s_tiered_rag_shared_${runId}`,
  denied: `k8s_tiered_rag_denied_${runId}`,
};

let portForward;
let baseUrl;
let originalRagPolicy;
let serviceAccountToken;
let restoredPolicy = false;

try {
  const evidence = dryRun ? plannedEvidence() : await liveEvidence();
  writeEvidence(evidence);
} finally {
  if (
    !dryRun &&
    originalRagPolicy !== undefined &&
    !keepPolicy &&
    !restoredPolicy
  ) {
    try {
      await updateRagPolicy(policyPatchFromReport(originalRagPolicy));
      restoredPolicy = true;
    } catch (error) {
      process.stderr.write(
        `Failed to restore prior RAG policy: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    }
  }
  if (portForward !== undefined) portForward.stop();
}

function plannedEvidence() {
  return {
    schemaVersion: "romeo.kubernetes-tiered-rag-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "planned",
    mode: "dry-run",
    target: {
      deployment: "kubernetes",
      namespace: namespace ?? "required_for_live_mode",
      releaseName,
      serviceName,
      deploymentName,
      selector,
      baseUrlMode: providedBaseUrl === undefined ? "port-forward" : "provided",
    },
    policyRestore: {
      requested: !keepPolicy,
      status: "not_run_in_dry_run",
    },
    checks: [
      "cluster_reachable_required_for_live_mode",
      "namespace_required_for_live_mode",
      "api_key_required_for_live_mode",
      "app_deployment_rollout_required_for_live_mode",
      "tiered_rag_api_readback_required_for_passed_evidence",
      "tiered_rag_vector_plan_posture_required_for_passed_evidence",
      "pod_log_redaction_required_for_passed_evidence",
    ],
  };
}

async function liveEvidence() {
  if (namespace === undefined || namespace.length === 0) {
    throw new Error("--namespace or ROMEO_NAMESPACE is required.");
  }
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("--api-key or ROMEO_API_KEY is required.");
  }

  kubectl(["cluster-info"]);
  const namespaceInfo = kubectlJson(["get", "namespace", namespace]);
  await waitForKubectlRollout(
    namespace,
    `deployment/${deploymentName}`,
    timeoutMs,
  );
  baseUrl = await resolveBaseUrl();
  await waitForHealth();
  await assertReadinessReady();
  const me = await apiJson("/api/v1/me");

  const alphaWorkspace = await createWorkspace(
    `Kubernetes RAG Alpha ${runId}`,
    `k8s-rag-alpha-${runId}`,
  );
  const betaWorkspace = await createWorkspace(
    `Kubernetes RAG Beta ${runId}`,
    `k8s-rag-beta-${runId}`,
  );
  const serviceAccount = await createServiceAccount();
  serviceAccountToken = await createServiceAccountApiKey(serviceAccount.id);

  const userPrivate = await createKnowledgeCorpus({
    token: apiKey,
    workspaceId: "workspace_default",
    name: `Kubernetes user private corpus ${runId}`,
    fileName: `kubernetes-user-private-${runId}.md`,
    content: `Romeo Kubernetes tiered RAG evidence for the user-private tier ${sentinels.user}.`,
  });
  const workspace = await createKnowledgeCorpus({
    token: serviceAccountToken,
    workspaceId: alphaWorkspace.id,
    name: `Kubernetes workspace corpus ${runId}`,
    fileName: `kubernetes-workspace-${runId}.md`,
    content: `Romeo Kubernetes tiered RAG evidence for the workspace tier ${sentinels.workspace}.`,
  });
  await shareKnowledgeBase(serviceAccountToken, workspace.id, {
    principalType: me.subject?.type ?? "user",
    principalId: me.subject?.id ?? "user_dev_admin",
    permissions: ["read", "use"],
  });
  const org = await createKnowledgeCorpus({
    token: apiKey,
    workspaceId: betaWorkspace.id,
    name: `Kubernetes org corpus ${runId}`,
    fileName: `kubernetes-org-${runId}.md`,
    content: `Romeo Kubernetes tiered RAG evidence for the org tier ${sentinels.org}.`,
  });
  const shared = await createKnowledgeCorpus({
    token: apiKey,
    workspaceId: alphaWorkspace.id,
    name: `Kubernetes shared corpus ${runId}`,
    fileName: `kubernetes-shared-${runId}.md`,
    content: `Romeo Kubernetes tiered RAG evidence for the shared tier ${sentinels.shared}.`,
  });
  const denied = await createKnowledgeCorpus({
    token: serviceAccountToken,
    workspaceId: betaWorkspace.id,
    name: `Kubernetes denied corpus ${runId}`,
    fileName: `kubernetes-denied-${runId}.md`,
    content: `Romeo Kubernetes tiered RAG evidence for the denied tier ${sentinels.denied}.`,
  });

  originalRagPolicy = await readRagPolicy();
  const temporaryPolicy = mergeRagPolicy(originalRagPolicy, {
    orgKnowledgeBaseId: org.id,
    sharedKnowledgeBaseId: shared.id,
  });
  const patchedPolicy = await updateRagPolicy(temporaryPolicy);

  const query = await apiJson("/api/v1/knowledge-bases/query", {
    method: "POST",
    body: {
      knowledgeBaseIds: [
        denied.id,
        userPrivate.id,
        workspace.id,
        org.id,
        shared.id,
      ],
      query: "Romeo Kubernetes tiered RAG evidence",
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
    "/api/v1/audit-logs?action=knowledge.query.tiered&limit=10",
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

  const usage = await apiJson("/api/v1/usage/events");
  assertServiceAccountUsageActors(usage.data, [
    workspace.sourceId,
    denied.sourceId,
  ]);

  if (!keepPolicy) {
    await updateRagPolicy(policyPatchFromReport(originalRagPolicy));
    restoredPolicy = true;
  }

  const pods = kubectlJson(["get", "pods", "-n", namespace, "-l", selector]);
  const logs = podLogs(namespace)
    .map((entry) => entry.text)
    .join("\n");
  assertTextDoesNotContain("Kubernetes tiered RAG pod logs", logs, [
    apiKey,
    serviceAccountToken,
    ...Object.values(sentinels),
  ]);

  return {
    schemaVersion: "romeo.kubernetes-tiered-rag-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    target: {
      deployment: "kubernetes",
      namespace,
      namespaceUid: namespaceInfo.metadata?.uid,
      releaseName,
      serviceName,
      deploymentName,
      selector,
      baseUrlMode: providedBaseUrl === undefined ? "port-forward" : "provided",
    },
    tenancyMode: me.deployment?.tenancyMode,
    workspaces: [
      "workspace_default",
      alphaWorkspace.id,
      betaWorkspace.id,
    ].sort(),
    authorizedTierCount: 4,
    skippedDeniedCount: 1,
    vectorPosture: {
      ...vectorPostureEvidence(query.data?.plan),
      physicalIsolationPolicy:
        patchedPolicy.physicalVectorIsolation?.mode ?? "unknown",
    },
    policyRestore: {
      requested: !keepPolicy,
      status: keepPolicy ? "kept_by_flag" : "restored",
    },
    logRedaction: {
      status: "passed",
      scannedPods: pods.items?.length ?? 0,
      rawCorpusSentinelsChecked: Object.keys(sentinels).length,
      apiKeysChecked: 2,
    },
    checks: [
      "cluster_reachable",
      "namespace_readable",
      "app_deployment_rollout_available",
      "admin_readiness_ready",
      "me_deployment_tenancy_mode_exposed",
      "workspace_create_api",
      "single_org_multiple_workspace_setup",
      "service_account_owned_workspace_corpus",
      "service_account_usage_system_actor",
      "rag_policy_temporarily_patched",
      "tiered_rag_user_private_workspace_org_shared_hits",
      "tiered_rag_vector_plan_posture_reported",
      "denied_corpus_skipped_without_id_or_content_leak",
      "tiered_rag_audit_metadata_only",
      "rag_policy_restored_or_explicitly_kept",
      "pod_logs_redacted",
    ],
  };
}

async function resolveBaseUrl() {
  if (providedBaseUrl !== undefined) return normalizeBaseUrl(providedBaseUrl);
  const localPort = await freePort();
  portForward = await startPortForward(
    namespace,
    serviceName,
    localPort,
    servicePort,
  );
  return `http://127.0.0.1:${localPort}/`;
}

async function waitForHealth() {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/api/v1/health", baseUrl));
      if (response.ok) {
        const body = await response.json();
        if (body?.data?.status === "ok") return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(
    `Timed out waiting for app health.${
      lastError instanceof Error ? ` Last error: ${lastError.message}` : ""
    }`,
  );
}

async function assertReadinessReady() {
  const readiness = await apiJson("/api/v1/admin/readiness");
  if (readiness.data?.status !== "ready") {
    throw new Error(
      `Readiness did not pass: ${JSON.stringify(readiness.data, null, 2)}`,
    );
  }
  const failed =
    readiness.data.checks?.filter((check) => check.status !== "pass") ?? [];
  if (failed.length > 0) {
    throw new Error(
      `Readiness checks are not all passing: ${JSON.stringify(failed, null, 2)}`,
    );
  }
}

async function apiJson(path, options = {}) {
  const headers = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  headers.authorization = `Bearer ${options.token ?? apiKey}`;
  const response = await fetch(new URL(path, baseUrl), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const body = text.length === 0 ? undefined : JSON.parse(text);
  const expectedStatus = options.expectedStatus ?? 200;
  if (response.status !== expectedStatus) {
    throw new Error(
      `${options.method ?? "GET"} ${path} returned ${response.status}, expected ${expectedStatus}: ${text}`,
    );
  }
  return body;
}

async function createWorkspace(name, slug) {
  const response = await apiJson("/api/v1/workspaces", {
    method: "POST",
    body: { name, slug },
    expectedStatus: 201,
  });
  if (typeof response.data?.id !== "string") {
    throw new Error("Workspace creation did not return an id.");
  }
  return response.data;
}

async function createServiceAccount() {
  const response = await apiJson("/api/v1/service-accounts", {
    method: "POST",
    body: {
      name: `Kubernetes tiered RAG corpus owner ${runId}`,
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
    `/api/v1/service-accounts/${encodeURIComponent(serviceAccountId)}/api-keys`,
    {
      method: "POST",
      body: {
        name: `Kubernetes tiered RAG corpus key ${runId}`,
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
  const created = await apiJson("/api/v1/knowledge-bases", {
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
  await apiJson(`/api/v1/knowledge-bases/${knowledgeBaseId}/shares`, {
    method: "POST",
    token,
    body: share,
    expectedStatus: 201,
  });
}

async function readRagPolicy() {
  const response = await apiJson("/api/v1/admin/rag/policy");
  return response.data;
}

async function updateRagPolicy(policy) {
  const response = await apiJson("/api/v1/admin/rag/policy", {
    method: "PATCH",
    body: policy,
  });
  return response.data;
}

function mergeRagPolicy(policy, input) {
  return {
    enabledTiers: unique([
      ...(policy.enabledTiers ?? []),
      "user_private",
      "workspace",
      "org",
      "shared",
    ]),
    defaultMaxResultsPerTier: {
      ...policy.defaultMaxResultsPerTier,
      user_private: 2,
      workspace: 2,
      org: 2,
      shared: 2,
    },
    knowledgeBaseTierAssignments: {
      org: unique([
        ...(policy.knowledgeBaseTierAssignments?.org ?? []),
        input.orgKnowledgeBaseId,
      ]),
      shared: unique([
        ...(policy.knowledgeBaseTierAssignments?.shared ?? []),
        input.sharedKnowledgeBaseId,
      ]),
    },
  };
}

function policyPatchFromReport(policy) {
  return {
    enabledTiers: policy.enabledTiers,
    defaultMaxResultsPerTier: policy.defaultMaxResultsPerTier,
    maxResultsPerTier: policy.maxResultsPerTier,
    allowedEmbeddingProviderModels: policy.allowedEmbeddingProviderModels,
    knowledgeBaseTierAssignments: policy.knowledgeBaseTierAssignments,
    dataResidencyTags: policy.dataResidencyTags,
    externalVectorStore: {
      mode: policy.externalVectorStore.mode,
      namespacePolicy: policy.externalVectorStore.namespacePolicy,
      partitioningPolicy: policy.externalVectorStore.partitioningPolicy,
      drStrategy: policy.externalVectorStore.drStrategy,
      exportPolicy: policy.externalVectorStore.exportPolicy,
    },
    physicalVectorIsolation: {
      mode: policy.physicalVectorIsolation.mode,
      enforcement: policy.physicalVectorIsolation.enforcement,
    },
  };
}

function assertTieredQuery(data, input) {
  assertEqual(data?.plan?.requestedCount, 5, "Tiered query requested count.");
  assertEqual(data.plan.authorizedCount, 4, "Tiered query authorized count.");
  assertEqual(data.plan.skipped?.count, 1, "Tiered query skipped count.");
  assertSkippedReason(data.plan.skipped, "missing_use_grant", 1);
  assertVectorPlanPosture(data.plan, input.expected.length);

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
    assertEqual(
      entry.vectorScope?.driver,
      data.plan.posture.vectorDriver,
      `${expected.tier} vector scope driver.`,
    );
    assertEqual(
      entry.vectorScope?.isolationMode,
      data.plan.posture.isolationMode,
      `${expected.tier} vector scope isolation mode.`,
    );
    assertEqual(
      entry.vectorScope?.workspaceId,
      expected.workspaceId,
      `${expected.tier} vector scope workspace id.`,
    );
    assertEqual(
      entry.vectorScope?.knowledgeBaseId,
      expected.knowledgeBaseId,
      `${expected.tier} vector scope knowledge base id.`,
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

function assertVectorPlanPosture(plan, expectedEntryCount) {
  const posture = plan?.posture ?? {};
  const entries = Array.isArray(plan?.entries) ? plan.entries : [];
  if (!["pgvector", "qdrant"].includes(posture.vectorDriver)) {
    throw new Error("Tiered query plan omitted a valid vector driver.");
  }
  if (
    ![
      "dedicated_vector_store_per_org",
      "external_collection_per_org",
      "external_namespace_per_org",
      "pgvector_partitioned_by_org",
      "shared_row_scope",
    ].includes(posture.isolationMode)
  ) {
    throw new Error("Tiered query plan omitted a valid isolation mode.");
  }
  if (!["disabled", "qdrant"].includes(posture.externalVectorStoreDriver)) {
    throw new Error(
      "Tiered query plan omitted external vector driver posture.",
    );
  }
  if (!validVectorPolicy(posture.namespacePolicy)) {
    throw new Error("Tiered query plan omitted namespace policy posture.");
  }
  if (!validVectorPolicy(posture.partitioningPolicy)) {
    throw new Error("Tiered query plan omitted partitioning policy posture.");
  }
  if (typeof posture.namespaceConfigured !== "boolean") {
    throw new Error("Tiered query plan omitted namespace configured posture.");
  }
  if (typeof posture.partitioningConfigured !== "boolean") {
    throw new Error(
      "Tiered query plan omitted partitioning configured posture.",
    );
  }
  if (entries.length < expectedEntryCount) {
    throw new Error("Tiered query plan omitted authorized plan entries.");
  }
  for (const entry of entries) {
    if (
      entry.vectorScope?.driver !== posture.vectorDriver ||
      entry.vectorScope?.isolationMode !== posture.isolationMode ||
      entry.vectorScope?.orgId !== entry.orgId ||
      entry.vectorScope?.workspaceId !== entry.workspaceId ||
      entry.vectorScope?.knowledgeBaseId !== entry.knowledgeBaseId
    ) {
      throw new Error("Tiered query plan vector scope did not match posture.");
    }
  }
  if (
    posture.vectorDriver === "qdrant" &&
    (posture.externalVectorStoreDriver !== "qdrant" ||
      posture.externalVectorStoreRoutingActive !== true ||
      posture.namespaceConfigured !== true ||
      posture.namespacePolicy === "none")
  ) {
    throw new Error(
      "Qdrant tiered query plan omitted active isolation posture.",
    );
  }
}

function vectorPostureEvidence(plan) {
  const posture = plan?.posture ?? {};
  const entries = Array.isArray(plan?.entries) ? plan.entries : [];
  return {
    driver: enumValue(posture.vectorDriver, ["pgvector", "qdrant"]),
    isolationMode: enumValue(posture.isolationMode, [
      "dedicated_vector_store_per_org",
      "external_collection_per_org",
      "external_namespace_per_org",
      "pgvector_partitioned_by_org",
      "shared_row_scope",
    ]),
    externalVectorStoreDriver: enumValue(posture.externalVectorStoreDriver, [
      "disabled",
      "qdrant",
    ]),
    externalVectorStoreRoutingActive:
      posture.externalVectorStoreRoutingActive === true,
    namespaceConfigured: posture.namespaceConfigured === true,
    namespacePolicy: validVectorPolicy(posture.namespacePolicy)
      ? posture.namespacePolicy
      : "unknown",
    partitioningConfigured: posture.partitioningConfigured === true,
    partitioningPolicy: validVectorPolicy(posture.partitioningPolicy)
      ? posture.partitioningPolicy
      : "unknown",
    planEntryCount: entries.length,
    vectorScopeDriverCounts: countBy(
      entries.map((entry) => entry.vectorScope?.driver),
      ["pgvector", "qdrant"],
    ),
  };
}

function validVectorPolicy(value) {
  return ["knowledge_base", "none", "org", "workspace"].includes(value);
}

function enumValue(value, allowed) {
  return allowed.includes(value) ? value : "unknown";
}

function countBy(values, allowed) {
  const counts = Object.fromEntries(allowed.map((value) => [value, 0]));
  for (const value of values) {
    if (Object.hasOwn(counts, value)) counts[value] += 1;
  }
  return counts;
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

function writeEvidence(value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (outputPath === undefined) {
    process.stdout.write(body);
    return;
  }
  const absolute = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, body, "utf8");
}

function unique(values) {
  return [...new Set(values)];
}

function helmFullname(value) {
  const chartName = "romeo";
  const name = value.includes(chartName) ? value : `${value}-${chartName}`;
  return name.slice(0, 63).replace(/-+$/u, "");
}

function normalizeBaseUrl(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function parsePositiveInteger(name, fallback) {
  const raw = argValue(name);
  const value = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
