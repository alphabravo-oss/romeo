import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { parseAllDocuments } from "yaml";

import { checkCloudNativePgExamples } from "./lib/cloudnativepg-example-checks.mjs";
import { checkKedaExamples } from "./lib/keda-example-checks.mjs";

const chartPath = "deploy/helm";
const namespace = argValue("--namespace") ?? "romeo";
const releaseName = argValue("--release-name") ?? "romeo";
const outputPath = argValue("--output");

const variants = [
  {
    name: "default",
    args: [],
    expectedDatabaseSecret: "romeo-secret",
    expectedDatabaseSecretKey: "DATABASE_URL",
    expectedWorkerCronJobs: [],
    expectedBackup: false,
    expectedHpa: false,
    expectedIngress: false,
    expectedNetworkPolicy: false,
  },
  {
    name: "external_postgres",
    args: ["-f", "deploy/helm/external-postgres-values.example.yaml"],
    expectedDatabaseSecret: "romeo-postgres",
    expectedDatabaseSecretKey: "DATABASE_URL",
    expectedRuntimeSecret: "romeo-runtime",
    expectedValkeySecret: "romeo-valkey",
    expectedWorkerApiKeySecret: "romeo-worker-api-key",
    expectedWorkerCronJobs: [
      "data-connector-sync",
      "workflow-resume",
      "webhook-retry",
      "notification-retry",
      "retention-enforce",
      "billing-entitlement-reconcile",
      "billing-lifecycle-enforce",
    ],
    expectedBackup: true,
    expectedHpa: false,
    expectedIngress: false,
    expectedNetworkPolicy: false,
  },
  {
    name: "cloudnativepg",
    args: ["-f", "deploy/helm/cloudnativepg-values.example.yaml"],
    expectedDatabaseSecret: "romeo-pg-app",
    expectedDatabaseSecretKey: "uri",
    expectedRuntimeSecret: "romeo-runtime",
    expectedValkeySecret: "romeo-valkey",
    expectedWorkerApiKeySecret: "romeo-worker-api-key",
    expectedWorkerCronJobs: [
      "data-connector-sync",
      "workflow-resume",
      "webhook-retry",
      "notification-retry",
      "retention-enforce",
      "billing-entitlement-reconcile",
      "billing-lifecycle-enforce",
    ],
    expectedBackup: false,
    expectedHpa: false,
    expectedIngress: false,
    expectedNetworkPolicy: false,
  },
  {
    name: "enterprise_surface",
    args: [
      "-f",
      "deploy/helm/external-postgres-values.example.yaml",
      "--set",
      "networkPolicy.enabled=true",
      "--set",
      "ingress.enabled=true",
      "--set",
      "ingress.className=nginx",
      "--set",
      "workers.knowledgeExtraction.enabled=true",
      "--set",
      "workers.knowledgeExtraction.knowledgeBaseId=kb_default",
      "--set",
      "workers.voiceCatalogSync.enabled=true",
      "--set",
      "workers.toolDispatch.enabled=true",
      "--set",
      "workers.toolDispatch.maxJobs=5",
      "--set",
      "workers.toolDispatch.secretResolverDriver=cloud",
      "--set",
      "workers.toolDispatch.payloadSecret.name=romeo-tool-dispatch-payloads",
      "--set",
      "workers.toolDispatch.networkPolicy.enabled=true",
      "--set",
      "workers.browserAutomation.enabled=true",
      "--set-string",
      "workers.browserAutomation.runnerUrl=https://browser-runner.example.com/tasks",
      "--set",
      "workers.browserAutomation.networkPolicy.enabled=true",
      "--set",
      "evidenceMount.enabled=true",
      "--set-string",
      "evidenceMount.configMapName=romeo-evidence",
      "--set-string",
      "env.VECTOR_ISOLATION_MODE=pgvector_partitioned_by_org",
      "--set-string",
      "env.PGVECTOR_PHYSICAL_ISOLATION_EVIDENCE_PATH=/var/run/romeo/evidence/pgvector-isolation.json",
      "--set-string",
      "env.QDRANT_LIVE_EVIDENCE_PATH=/var/run/romeo/evidence/qdrant-live.json",
      "--set-string",
      "env.VAULT_ADDR=https://vault.example.com",
      "--set-string",
      "env.AWS_REGION=us-east-1",
      "--set-string",
      "env.GCP_SECRET_MANAGER_PROJECT=romeo-prod",
      "--set-string",
      "env.AZURE_KEY_VAULT_URL=https://romeo.vault.azure.net",
      "--set",
      "autoscaling.enabled=true",
      "--set",
      "autoscaling.minReplicas=2",
      "--set",
      "autoscaling.maxReplicas=6",
    ],
    expectedDatabaseSecret: "romeo-postgres",
    expectedDatabaseSecretKey: "DATABASE_URL",
    expectedRuntimeSecret: "romeo-runtime",
    expectedValkeySecret: "romeo-valkey",
    expectedWorkerApiKeySecret: "romeo-worker-api-key",
    expectedWorkerCronJobs: [
      "data-connector-sync",
      "workflow-resume",
      "webhook-retry",
      "notification-retry",
      "retention-enforce",
      "billing-entitlement-reconcile",
      "billing-lifecycle-enforce",
      "knowledge-extraction",
      "voice-catalog-sync",
      "tool-dispatch",
      "browser-automation",
    ],
    expectedBrowserAutomationRunnerUrl:
      "https://browser-runner.example.com/tasks",
    expectedBrowserAutomationNetworkPolicy: true,
    expectedBrowserAutomationNetworkPolicyEgress: "deny-all",
    expectedToolDispatchPayloadSecret: "romeo-tool-dispatch-payloads",
    expectedToolDispatchSecretResolver: "cloud",
    expectedToolDispatchSecretEnvSecret: "romeo-runtime",
    expectedVectorIsolationMode: "pgvector_partitioned_by_org",
    expectedPgvectorEvidencePath:
      "/var/run/romeo/evidence/pgvector-isolation.json",
    expectedQdrantEvidencePath: "/var/run/romeo/evidence/qdrant-live.json",
    expectedEvidenceMount: {
      name: "romeo-evidence",
      mountPath: "/var/run/romeo/evidence",
      configMapName: "romeo-evidence",
    },
    expectedBackup: true,
    expectedHpa: true,
    expectedIngress: true,
    expectedNetworkPolicy: true,
    expectedNetworkPolicyEgress: "deny-all",
    expectedToolDispatchNetworkPolicy: true,
    expectedToolDispatchNetworkPolicyEgress: "deny-all",
  },
  {
    name: "network_policy_egress",
    args: [
      "-f",
      "deploy/helm/external-postgres-values.example.yaml",
      "-f",
      "deploy/helm/networkpolicy-egress-values.example.yaml",
    ],
    expectedDatabaseSecret: "romeo-postgres",
    expectedDatabaseSecretKey: "DATABASE_URL",
    expectedRuntimeSecret: "romeo-runtime",
    expectedValkeySecret: "romeo-valkey",
    expectedWorkerApiKeySecret: "romeo-worker-api-key",
    expectedWorkerCronJobs: [
      "data-connector-sync",
      "workflow-resume",
      "webhook-retry",
      "notification-retry",
      "retention-enforce",
      "billing-entitlement-reconcile",
      "billing-lifecycle-enforce",
      "tool-dispatch",
    ],
    expectedBackup: true,
    expectedHpa: false,
    expectedIngress: false,
    expectedNetworkPolicy: true,
    expectedNetworkPolicyEgress: "explicit",
    expectedToolDispatchNetworkPolicy: true,
    expectedToolDispatchNetworkPolicyEgress: "explicit",
  },
];

run("helm", ["lint", chartPath]);
assertHelmSchemaRejectsInvalidPostgresMode();
assertHelmSchemaRejectsInvalidPostgresPoolMax();
assertHelmSchemaRejectsInvalidProviderStreamTimeout();
assertHelmSchemaRejectsInvalidProviderResilience();
assertHelmSchemaRejectsInvalidProviderRouting();
assertHelmSchemaRejectsInvalidQuotaCoordination();
assertHelmSchemaRejectsInvalidEdgeSecurity();
assertHelmSchemaRejectsInvalidFileLimits();
assertHelmSchemaRejectsInvalidHttpRateLimit();
assertHelmSchemaRejectsInvalidDataConnectorRetry();
assertHelmSchemaRejectsInvalidVectorIsolation();
assertHelmSchemaRejectsInvalidBackupUploadTimeout();
assertHelmSchemaRejectsInvalidToolDispatchBounds();
assertHelmSchemaRejectsInvalidToolDispatchSecretResolver();
assertHelmRejectsInvalidEvidenceMount();

const evidence = {
  schemaVersion: "romeo.kubernetes-render-smoke.v1",
  generatedAt: new Date().toISOString(),
  releaseName,
  namespace,
  status: "passed",
  checks: [
    "helm_lint",
    "helm_values_schema_rejects_invalid_postgres_mode",
    "helm_values_schema_rejects_invalid_postgres_pool_max",
    "helm_values_schema_rejects_invalid_provider_stream_timeout",
    "helm_values_schema_rejects_invalid_provider_resilience",
    "helm_values_schema_rejects_invalid_provider_routing",
    "helm_values_schema_rejects_invalid_quota_coordination",
    "helm_values_schema_rejects_invalid_edge_security",
    "helm_values_schema_rejects_invalid_file_limits",
    "helm_values_schema_rejects_invalid_http_rate_limit",
    "helm_values_schema_rejects_invalid_data_connector_retry",
    "helm_values_schema_rejects_invalid_vector_isolation",
    "helm_values_schema_rejects_invalid_backup_upload_timeout",
    "helm_values_schema_rejects_invalid_tool_dispatch_bounds",
    "helm_values_schema_rejects_invalid_tool_dispatch_secret_resolver",
    "helm_rejects_invalid_evidence_mount",
    "default_render_contract",
    "external_postgres_render_contract",
    "cloudnativepg_render_contract",
    "enterprise_surface_render_contract",
    "secret_refs_not_inline_sensitive_values",
    "restricted_pod_security_contexts",
    "writable_node_cache_env_render",
    "worker_cronjobs_bounded_and_scoped",
    "rag_vector_evidence_env_render",
    "evidence_mount_render",
    "app_hpa_render",
    "network_policy_and_ingress_render",
    "tool_dispatch_network_policy_render",
    "browser_automation_network_policy_render",
    "network_policy_explicit_egress_examples",
    "cloudnativepg_operator_examples",
    "keda_worker_scaledjob_examples",
  ],
  variants: variants.map((variant) => checkVariant(variant)),
  cloudNativePgExamples: checkCloudNativePgExamples(),
  kedaExamples: checkKedaExamples(),
};

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
if (outputPath !== undefined) writeFileSync(outputPath, serialized);
process.stdout.write(serialized);

function checkVariant(variant) {
  const manifest = run("helm", [
    "template",
    releaseName,
    chartPath,
    "--namespace",
    namespace,
    ...variant.args,
  ]).stdout;
  const resources = parseManifest(manifest);
  const byKind = groupByKind(resources);
  const appName = releaseName;

  const deployment = requireResource(
    byKind,
    "Deployment",
    appName,
    variant.name,
  );
  const service = requireResource(byKind, "Service", appName, variant.name);
  const migration = requireResource(
    byKind,
    "Job",
    `${appName}-migrate`,
    variant.name,
  );
  const configMap = requireResource(
    byKind,
    "ConfigMap",
    `${appName}-config`,
    variant.name,
  );
  const appServiceAccount = requireResource(
    byKind,
    "ServiceAccount",
    appName,
    variant.name,
  );
  const workerServiceAccount = requireResource(
    byKind,
    "ServiceAccount",
    `${appName}-worker`,
    variant.name,
  );

  assertService(service, variant.name);
  assertServiceAccount(appServiceAccount, variant.name);
  assertServiceAccount(workerServiceAccount, variant.name);
  assertConfigMap(configMap, variant);
  assertNoSecretResourceForExistingSecretMode(resources, variant.name);
  assertDeployment(deployment, variant);
  assertMigrationJob(migration, variant);
  assertPodDisruptionBudget(byKind, appName, variant.name);
  assertOptionalHpa(byKind, deployment, variant);
  assertWorkerCronJobs(byKind, variant);
  assertBackupCronJob(byKind, variant);
  assertOptionalIngress(byKind, variant);
  assertOptionalNetworkPolicy(byKind, variant);
  assertOptionalToolDispatchNetworkPolicy(byKind, variant);
  assertOptionalBrowserAutomationNetworkPolicy(byKind, variant);

  return {
    name: variant.name,
    resourceCount: resources.length,
    kinds: resourceKindCounts(resources),
    workerCronJobs: (byKind.get("CronJob") ?? [])
      .map((item) => item.metadata?.name)
      .filter((name) => typeof name === "string")
      .sort(),
    networkPolicyEgressRules: optionalResource(byKind, "NetworkPolicy", "romeo")
      ?.spec?.egress?.length,
    toolDispatchNetworkPolicyEgressRules: optionalResource(
      byKind,
      "NetworkPolicy",
      "romeo-tool-dispatch",
    )?.spec?.egress?.length,
    browserAutomationNetworkPolicyEgressRules: optionalResource(
      byKind,
      "NetworkPolicy",
      "romeo-browser-automation",
    )?.spec?.egress?.length,
  };
}

function assertHelmSchemaRejectsInvalidPostgresMode() {
  const result = spawnSync(
    "helm",
    ["template", releaseName, chartPath, "--set", "postgres.mode=bogus"],
    { encoding: "utf8" },
  );
  if (result.status === 0) {
    throw new Error("Helm schema accepted invalid postgres.mode=bogus.");
  }
  const text = `${result.stdout}\n${result.stderr}`;
  if (!text.includes("postgres.mode") && !text.includes("/postgres/mode")) {
    throw new Error(
      `Helm schema rejected invalid values without naming postgres.mode: ${text}`,
    );
  }
}

function assertHelmSchemaRejectsInvalidPostgresPoolMax() {
  const result = spawnSync(
    "helm",
    [
      "template",
      releaseName,
      chartPath,
      "--set-string",
      "env.POSTGRES_POOL_MAX=0",
    ],
    { encoding: "utf8" },
  );
  if (result.status === 0) {
    throw new Error("Helm schema accepted invalid env.POSTGRES_POOL_MAX=0.");
  }
  const text = `${result.stdout}\n${result.stderr}`;
  if (
    !text.includes("POSTGRES_POOL_MAX") &&
    !text.includes("/env/POSTGRES_POOL_MAX")
  ) {
    throw new Error(
      `Helm schema rejected invalid values without naming POSTGRES_POOL_MAX: ${text}`,
    );
  }
}

function assertHelmSchemaRejectsInvalidProviderStreamTimeout() {
  const result = spawnSync(
    "helm",
    [
      "template",
      releaseName,
      chartPath,
      "--set-string",
      "env.MODEL_PROVIDER_STREAM_TIMEOUT_MS=0",
    ],
    { encoding: "utf8" },
  );
  if (result.status === 0) {
    throw new Error(
      "Helm schema accepted invalid env.MODEL_PROVIDER_STREAM_TIMEOUT_MS=0.",
    );
  }
  const text = `${result.stdout}\n${result.stderr}`;
  if (
    !text.includes("MODEL_PROVIDER_STREAM_TIMEOUT_MS") &&
    !text.includes("/env/MODEL_PROVIDER_STREAM_TIMEOUT_MS")
  ) {
    throw new Error(
      `Helm schema rejected invalid values without naming MODEL_PROVIDER_STREAM_TIMEOUT_MS: ${text}`,
    );
  }
}

function assertHelmSchemaRejectsInvalidProviderResilience() {
  for (const key of [
    "MODEL_PROVIDER_RETRY_ATTEMPTS",
    "MODEL_PROVIDER_RETRY_BACKOFF_MS",
    "MODEL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD",
    "MODEL_PROVIDER_CIRCUIT_COOLDOWN_MS",
  ]) {
    const result = spawnSync(
      "helm",
      ["template", releaseName, chartPath, "--set-string", `env.${key}=-1`],
      { encoding: "utf8" },
    );
    if (result.status === 0) {
      throw new Error(`Helm schema accepted invalid env.${key}=-1.`);
    }
    const text = `${result.stdout}\n${result.stderr}`;
    if (!text.includes(key) && !text.includes(`/env/${key}`)) {
      throw new Error(
        `Helm schema rejected invalid values without naming ${key}: ${text}`,
      );
    }
  }
}

function assertHelmSchemaRejectsInvalidProviderRouting() {
  for (const [key, value] of [
    ["MODEL_PROVIDER_DISABLED_IDS", "provider one"],
    ["MODEL_PROVIDER_FALLBACK_MODEL_ID", "model/fallback"],
  ]) {
    const result = spawnSync(
      "helm",
      [
        "template",
        releaseName,
        chartPath,
        "--set-string",
        `env.${key}=${value}`,
      ],
      { encoding: "utf8" },
    );
    if (result.status === 0) {
      throw new Error(`Helm schema accepted invalid env.${key}=${value}.`);
    }
    const text = `${result.stdout}\n${result.stderr}`;
    if (!text.includes(key) && !text.includes(`/env/${key}`)) {
      throw new Error(
        `Helm schema rejected invalid values without naming ${key}: ${text}`,
      );
    }
  }
}

function assertHelmSchemaRejectsInvalidQuotaCoordination() {
  for (const [key, value] of [
    ["QUOTA_COORDINATION_DRIVER", "redis"],
    ["QUOTA_COORDINATION_KEY_PREFIX", "romeo quota"],
    ["QUOTA_COORDINATION_TIMEOUT_MS", "0"],
  ]) {
    const result = spawnSync(
      "helm",
      [
        "template",
        releaseName,
        chartPath,
        "--set-string",
        `env.${key}=${value}`,
      ],
      { encoding: "utf8" },
    );
    if (result.status === 0) {
      throw new Error(`Helm schema accepted invalid env.${key}=${value}.`);
    }
    const text = `${result.stdout}\n${result.stderr}`;
    if (!text.includes(key) && !text.includes(`/env/${key}`)) {
      throw new Error(
        `Helm schema rejected invalid values without naming ${key}: ${text}`,
      );
    }
  }
}

function assertHelmSchemaRejectsInvalidEdgeSecurity() {
  for (const [key, value] of [
    ["EDGE_TLS_TERMINATION", "sidecar"],
    ["EDGE_TRUSTED_PROXY_MODE", "all"],
    ["EDGE_WAF_MODE", "detect"],
    ["EDGE_HSTS_ENABLED", "yes"],
    ["EDGE_HSTS_MAX_AGE_SECONDS", "-1"],
    ["EDGE_HSTS_INCLUDE_SUBDOMAINS", "yes"],
    ["EDGE_HSTS_PRELOAD", "yes"],
    ["REQUEST_BODY_MAX_BYTES", "0"],
    ["REQUEST_BODY_MAX_BYTES", "250000001"],
  ]) {
    const result = spawnSync(
      "helm",
      [
        "template",
        releaseName,
        chartPath,
        "--set-string",
        `env.${key}=${value}`,
      ],
      { encoding: "utf8" },
    );
    if (result.status === 0) {
      throw new Error(`Helm schema accepted invalid env.${key}=${value}.`);
    }
    const text = `${result.stdout}\n${result.stderr}`;
    if (!text.includes(key) && !text.includes(`/env/${key}`)) {
      throw new Error(
        `Helm schema rejected invalid values without naming ${key}: ${text}`,
      );
    }
  }
}

function assertHelmSchemaRejectsInvalidFileLimits() {
  for (const [key, value] of [
    ["FILE_INLINE_MAX_BYTES", "0"],
    ["FILE_INLINE_MAX_BYTES", "250000001"],
    ["FILE_DIRECT_UPLOAD_MAX_BYTES", "0"],
    ["FILE_DIRECT_UPLOAD_MAX_BYTES", "1000000001"],
    ["MESSAGE_ATTACHMENT_MAX_BYTES", "0"],
    ["MESSAGE_ATTACHMENT_MAX_BYTES", "100000001"],
  ]) {
    const result = spawnSync(
      "helm",
      [
        "template",
        releaseName,
        chartPath,
        "--set-string",
        `env.${key}=${value}`,
      ],
      { encoding: "utf8" },
    );
    if (result.status === 0) {
      throw new Error(`Helm schema accepted invalid env.${key}=${value}.`);
    }
    const text = `${result.stdout}\n${result.stderr}`;
    if (!text.includes(key) && !text.includes(`/env/${key}`)) {
      throw new Error(
        `Helm schema rejected invalid values without naming ${key}: ${text}`,
      );
    }
  }
}

function assertHelmSchemaRejectsInvalidHttpRateLimit() {
  for (const [key, value] of [
    ["HTTP_RATE_LIMIT_DRIVER", "redis"],
    ["HTTP_RATE_LIMIT_KEY_PREFIX", "romeo rate limit"],
    ["HTTP_RATE_LIMIT_WINDOW_SECONDS", "0"],
    ["HTTP_RATE_LIMIT_WINDOW_SECONDS", "86401"],
    ["HTTP_RATE_LIMIT_AUTH_MAX", "0"],
    ["HTTP_RATE_LIMIT_AUTH_MAX", "100001"],
    ["HTTP_RATE_LIMIT_PUBLIC_MAX", "0"],
    ["HTTP_RATE_LIMIT_PUBLIC_MAX", "100001"],
    ["HTTP_RATE_LIMIT_AUTHENTICATED_MAX", "0"],
    ["HTTP_RATE_LIMIT_AUTHENTICATED_MAX", "250001"],
    ["HTTP_RATE_LIMIT_WEBHOOK_MAX", "0"],
    ["HTTP_RATE_LIMIT_WEBHOOK_MAX", "250001"],
  ]) {
    const result = spawnSync(
      "helm",
      [
        "template",
        releaseName,
        chartPath,
        "--set-string",
        `env.${key}=${value}`,
      ],
      { encoding: "utf8" },
    );
    if (result.status === 0) {
      throw new Error(`Helm schema accepted invalid env.${key}=${value}.`);
    }
    const text = `${result.stdout}\n${result.stderr}`;
    if (!text.includes(key) && !text.includes(`/env/${key}`)) {
      throw new Error(
        `Helm schema rejected invalid values without naming ${key}: ${text}`,
      );
    }
  }
}

function assertHelmSchemaRejectsInvalidDataConnectorRetry() {
  for (const [key, value] of [
    ["DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS", "6"],
    ["DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS", "60001"],
  ]) {
    const result = spawnSync(
      "helm",
      [
        "template",
        releaseName,
        chartPath,
        "--set-string",
        `env.${key}=${value}`,
      ],
      { encoding: "utf8" },
    );
    if (result.status === 0) {
      throw new Error(`Helm schema accepted invalid env.${key}=${value}.`);
    }
    const text = `${result.stdout}\n${result.stderr}`;
    if (!text.includes(key) && !text.includes(`/env/${key}`)) {
      throw new Error(
        `Helm schema rejected invalid values without naming ${key}: ${text}`,
      );
    }
  }
}

function assertHelmSchemaRejectsInvalidVectorIsolation() {
  for (const [key, value] of [["VECTOR_ISOLATION_MODE", "tenant_database"]]) {
    const result = spawnSync(
      "helm",
      [
        "template",
        releaseName,
        chartPath,
        "--set-string",
        `env.${key}=${value}`,
      ],
      { encoding: "utf8" },
    );
    if (result.status === 0) {
      throw new Error(`Helm schema accepted invalid env.${key}=${value}.`);
    }
    const text = `${result.stdout}\n${result.stderr}`;
    if (!text.includes(key) && !text.includes(`/env/${key}`)) {
      throw new Error(
        `Helm schema rejected invalid values without naming ${key}: ${text}`,
      );
    }
  }
}

function assertHelmSchemaRejectsInvalidBackupUploadTimeout() {
  const result = spawnSync(
    "helm",
    ["template", releaseName, chartPath, "--set", "backup.uploadTimeoutMs=0"],
    { encoding: "utf8" },
  );
  if (result.status === 0) {
    throw new Error("Helm schema accepted invalid backup.uploadTimeoutMs=0.");
  }
  const text = `${result.stdout}\n${result.stderr}`;
  if (
    !text.includes("uploadTimeoutMs") &&
    !text.includes("/backup/uploadTimeoutMs")
  ) {
    throw new Error(
      `Helm schema rejected invalid values without naming backup.uploadTimeoutMs: ${text}`,
    );
  }
}

function assertHelmSchemaRejectsInvalidToolDispatchBounds() {
  const result = spawnSync(
    "helm",
    [
      "template",
      releaseName,
      chartPath,
      "--set",
      "workers.toolDispatch.maxJobs=0",
    ],
    { encoding: "utf8" },
  );
  if (result.status === 0) {
    throw new Error(
      "Helm schema accepted invalid workers.toolDispatch.maxJobs=0.",
    );
  }
  const text = `${result.stdout}\n${result.stderr}`;
  if (
    !text.includes("toolDispatch") &&
    !text.includes("/workers/toolDispatch/maxJobs")
  ) {
    throw new Error(
      `Helm schema rejected invalid values without naming workers.toolDispatch.maxJobs: ${text}`,
    );
  }
}

function assertHelmSchemaRejectsInvalidToolDispatchSecretResolver() {
  const result = spawnSync(
    "helm",
    [
      "template",
      releaseName,
      chartPath,
      "--set-string",
      "workers.toolDispatch.secretResolverDriver=bogus",
    ],
    { encoding: "utf8" },
  );
  if (result.status === 0) {
    throw new Error(
      "Helm schema accepted invalid workers.toolDispatch.secretResolverDriver=bogus.",
    );
  }
  const text = `${result.stdout}\n${result.stderr}`;
  if (
    !text.includes("secretResolverDriver") &&
    !text.includes("/workers/toolDispatch/secretResolverDriver")
  ) {
    throw new Error(
      `Helm schema rejected invalid values without naming workers.toolDispatch.secretResolverDriver: ${text}`,
    );
  }
}

function assertHelmRejectsInvalidEvidenceMount() {
  for (const scenario of [
    {
      label: "missing source",
      args: ["--set", "evidenceMount.enabled=true"],
      expected: "evidenceMount.enabled requires",
    },
    {
      label: "multiple sources",
      args: [
        "--set",
        "evidenceMount.enabled=true",
        "--set-string",
        "evidenceMount.configMapName=romeo-evidence",
        "--set-string",
        "evidenceMount.secretName=romeo-evidence",
      ],
      expected: "evidenceMount supports exactly one",
    },
    {
      label: "relative path",
      args: [
        "--set",
        "evidenceMount.enabled=true",
        "--set-string",
        "evidenceMount.configMapName=romeo-evidence",
        "--set-string",
        "evidenceMount.mountPath=relative",
      ],
      expected: "evidenceMount.mountPath",
    },
  ]) {
    const result = spawnSync(
      "helm",
      ["template", releaseName, chartPath, ...scenario.args],
      { encoding: "utf8" },
    );
    if (result.status === 0) {
      throw new Error(`Helm accepted invalid evidenceMount ${scenario.label}.`);
    }
    const text = `${result.stdout}\n${result.stderr}`;
    if (!text.includes(scenario.expected) && !text.includes("evidenceMount")) {
      throw new Error(
        `Helm rejected invalid evidenceMount ${scenario.label} without naming the field: ${text}`,
      );
    }
  }
}

function parseManifest(manifest) {
  return parseAllDocuments(manifest)
    .map((document) => document.toJSON())
    .filter((resource) => resource !== null && resource !== undefined);
}

function groupByKind(resources) {
  const grouped = new Map();
  for (const resource of resources) {
    const kind = resource.kind;
    if (typeof kind !== "string") continue;
    grouped.set(kind, [...(grouped.get(kind) ?? []), resource]);
  }
  return grouped;
}

function requireResource(byKind, kind, name, variantName) {
  const match = (byKind.get(kind) ?? []).find(
    (resource) => resource.metadata?.name === name,
  );
  if (match === undefined) {
    throw new Error(`${variantName} did not render ${kind}/${name}.`);
  }
  return match;
}

function optionalResource(byKind, kind, name) {
  return (byKind.get(kind) ?? []).find(
    (resource) => resource.metadata?.name === name,
  );
}

function assertService(service, variantName) {
  const port = service.spec?.ports?.[0];
  if (service.spec?.type !== "ClusterIP") {
    throw new Error(`${variantName} service is not ClusterIP.`);
  }
  if (
    port?.name !== "http" ||
    port.port !== 3000 ||
    port.targetPort !== "http"
  ) {
    throw new Error(`${variantName} service does not expose named HTTP port.`);
  }
}

function assertServiceAccount(serviceAccount, variantName) {
  if (serviceAccount.automountServiceAccountToken !== false) {
    throw new Error(
      `${variantName} ServiceAccount/${serviceAccount.metadata?.name} automounts API tokens.`,
    );
  }
}

function assertConfigMap(configMap, variant) {
  const variantName = variant.name;
  const data = configMap.data ?? {};
  if (data.REPOSITORY_DRIVER !== "postgres") {
    throw new Error(`${variantName} ConfigMap does not force postgres repo.`);
  }
  if (data.DEV_SEEDED_LOGIN !== "false") {
    throw new Error(`${variantName} ConfigMap enables seeded login.`);
  }
  if (data.POSTGRES_POOL_MAX !== "10") {
    throw new Error(`${variantName} ConfigMap database pool max drifted.`);
  }
  if (data.TENANCY_MODE !== "single") {
    throw new Error(`${variantName} ConfigMap tenancy mode drifted.`);
  }
  if (data.REQUEST_BODY_MAX_BYTES !== "50000000") {
    throw new Error(`${variantName} ConfigMap request body limit drifted.`);
  }
  if (data.FILE_INLINE_MAX_BYTES !== "25000000") {
    throw new Error(`${variantName} ConfigMap inline file limit drifted.`);
  }
  if (data.FILE_DIRECT_UPLOAD_MAX_BYTES !== "100000000") {
    throw new Error(
      `${variantName} ConfigMap direct upload file limit drifted.`,
    );
  }
  if (data.MESSAGE_ATTACHMENT_MAX_BYTES !== "5000000") {
    throw new Error(
      `${variantName} ConfigMap message attachment limit drifted.`,
    );
  }
  if (data.HTTP_RATE_LIMIT_DRIVER !== "memory") {
    throw new Error(`${variantName} ConfigMap rate limit driver drifted.`);
  }
  if (data.HTTP_RATE_LIMIT_KEY_PREFIX !== "romeo:http-rate-limit:v1") {
    throw new Error(`${variantName} ConfigMap rate limit prefix drifted.`);
  }
  if (data.HTTP_RATE_LIMIT_WINDOW_SECONDS !== "60") {
    throw new Error(`${variantName} ConfigMap rate limit window drifted.`);
  }
  if (data.HTTP_RATE_LIMIT_AUTH_MAX !== "60") {
    throw new Error(`${variantName} ConfigMap auth rate limit drifted.`);
  }
  if (data.HTTP_RATE_LIMIT_PUBLIC_MAX !== "600") {
    throw new Error(`${variantName} ConfigMap public rate limit drifted.`);
  }
  if (data.HTTP_RATE_LIMIT_AUTHENTICATED_MAX !== "6000") {
    throw new Error(
      `${variantName} ConfigMap authenticated rate limit drifted.`,
    );
  }
  if (data.HTTP_RATE_LIMIT_WEBHOOK_MAX !== "1200") {
    throw new Error(`${variantName} ConfigMap webhook rate limit drifted.`);
  }
  if (data.MODEL_PROVIDER_STREAM_TIMEOUT_MS !== "60000") {
    throw new Error(
      `${variantName} ConfigMap provider stream timeout drifted.`,
    );
  }
  if (data.MODEL_PROVIDER_RETRY_ATTEMPTS !== "1") {
    throw new Error(
      `${variantName} ConfigMap provider retry attempts drifted.`,
    );
  }
  if (data.MODEL_PROVIDER_RETRY_BACKOFF_MS !== "250") {
    throw new Error(`${variantName} ConfigMap provider retry backoff drifted.`);
  }
  if (data.MODEL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD !== "5") {
    throw new Error(
      `${variantName} ConfigMap provider circuit threshold drifted.`,
    );
  }
  if (data.MODEL_PROVIDER_CIRCUIT_COOLDOWN_MS !== "60000") {
    throw new Error(
      `${variantName} ConfigMap provider circuit cooldown drifted.`,
    );
  }
  if (data.MODEL_PROVIDER_DISABLED_IDS !== "") {
    throw new Error(`${variantName} ConfigMap provider disabled IDs drifted.`);
  }
  if (data.MODEL_PROVIDER_FALLBACK_MODEL_ID !== "") {
    throw new Error(
      `${variantName} ConfigMap provider fallback model drifted.`,
    );
  }
  if (data.QUOTA_COORDINATION_DRIVER !== "disabled") {
    throw new Error(
      `${variantName} ConfigMap quota coordination driver drifted.`,
    );
  }
  if (data.QUOTA_COORDINATION_KEY_PREFIX !== "romeo:quota:v1") {
    throw new Error(
      `${variantName} ConfigMap quota coordination prefix drifted.`,
    );
  }
  if (data.QUOTA_COORDINATION_TIMEOUT_MS !== "2000") {
    throw new Error(
      `${variantName} ConfigMap quota coordination timeout drifted.`,
    );
  }
  const expectedVectorIsolationMode =
    variant.expectedVectorIsolationMode ?? "shared_row_scope";
  if (data.VECTOR_ISOLATION_MODE !== expectedVectorIsolationMode) {
    throw new Error(`${variantName} ConfigMap vector isolation mode drifted.`);
  }
  const expectedPgvectorEvidencePath =
    variant.expectedPgvectorEvidencePath ?? "";
  if (
    data.PGVECTOR_PHYSICAL_ISOLATION_EVIDENCE_PATH !==
    expectedPgvectorEvidencePath
  ) {
    throw new Error(`${variantName} ConfigMap pgvector evidence path drifted.`);
  }
  const expectedQdrantEvidencePath = variant.expectedQdrantEvidencePath ?? "";
  if (data.QDRANT_LIVE_EVIDENCE_PATH !== expectedQdrantEvidencePath) {
    throw new Error(`${variantName} ConfigMap Qdrant evidence path drifted.`);
  }
  for (const key of [
    "DATABASE_URL",
    "VALKEY_URL",
    "SESSION_SECRET",
    "SESSION_SECRET_PREVIOUS",
    "LOCAL_AUTH_SECRET_ENCRYPTION_KEY",
    "MANAGED_SECRET_ENCRYPTION_KEY",
    "WEBHOOK_SIGNING_KEY",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "ROMEO_API_KEY",
    "DELEGATED_OAUTH_GITHUB_CLIENT_SECRET",
    "DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY",
  ]) {
    if (Object.hasOwn(data, key)) {
      throw new Error(
        `${variantName} ConfigMap contains sensitive key ${key}.`,
      );
    }
  }
}

function assertNoSecretResourceForExistingSecretMode(resources, variantName) {
  const secretNames = resources
    .filter((resource) => resource.kind === "Secret")
    .map((resource) => resource.metadata?.name);
  if (secretNames.length > 0) {
    throw new Error(
      `${variantName} rendered inline Secret resources instead of existingSecret references: ${secretNames.join(", ")}`,
    );
  }
}

function assertDeployment(deployment, variant) {
  const template = deployment.spec?.template;
  const podSpec = template?.spec;
  const container = podSpec?.containers?.find((item) => item.name === "app");
  if (container === undefined) {
    throw new Error(`${variant.name} deployment has no app container.`);
  }
  assertPodSecurityContext(podSpec?.securityContext, variant.name, "app pod");
  assertContainerSecurityContext(
    container.securityContext,
    variant.name,
    "app container",
  );
  if (podSpec.serviceAccountName !== "romeo") {
    throw new Error(`${variant.name} app uses unexpected ServiceAccount.`);
  }
  for (const probe of ["startupProbe", "readinessProbe", "livenessProbe"]) {
    if (container[probe]?.httpGet?.path !== "/api/v1/health") {
      throw new Error(`${variant.name} app missing ${probe} health check.`);
    }
  }
  assertResources(container.resources, variant.name, "app container");
  assertWritableNodeEnv(container, variant.name, "app container");
  assertEnvFromSecret(container, variant);
  assertSecretEnv(
    container,
    "DATABASE_URL",
    variant.expectedDatabaseSecret,
    variant.name,
  );
  if (variant.expectedValkeySecret !== undefined) {
    assertSecretEnv(
      container,
      "VALKEY_URL",
      variant.expectedValkeySecret,
      variant.name,
    );
  }
  if (variant.expectedEvidenceMount !== undefined) {
    const expected = variant.expectedEvidenceMount;
    const volume = podSpec.volumes?.find((item) => item.name === expected.name);
    if (volume?.configMap?.name !== expected.configMapName) {
      throw new Error(
        `${variant.name} app evidence volume is not ConfigMap-backed as expected.`,
      );
    }
    const mount = container.volumeMounts?.find(
      (item) => item.name === expected.name,
    );
    if (mount?.mountPath !== expected.mountPath || mount.readOnly !== true) {
      throw new Error(
        `${variant.name} app evidence mount is not read-only at ${expected.mountPath}.`,
      );
    }
  }
}

function assertMigrationJob(job, variant) {
  const podSpec = job.spec?.template?.spec;
  const container = podSpec?.containers?.find(
    (item) => item.name === "migrate",
  );
  if (podSpec?.restartPolicy !== "Never") {
    throw new Error(
      `${variant.name} migration job is not restartPolicy Never.`,
    );
  }
  if (job.spec?.backoffLimit !== 1 || job.spec?.activeDeadlineSeconds !== 600) {
    throw new Error(`${variant.name} migration job is not tightly bounded.`);
  }
  if (
    JSON.stringify(container?.command) !==
    JSON.stringify(["pnpm", "migrate:postgres"])
  ) {
    throw new Error(`${variant.name} migration job command drifted.`);
  }
  assertPodSecurityContext(
    podSpec?.securityContext,
    variant.name,
    "migration pod",
  );
  assertContainerSecurityContext(
    container?.securityContext,
    variant.name,
    "migration container",
  );
  assertResources(container?.resources, variant.name, "migration container");
  assertWritableNodeEnv(container, variant.name, "migration container");
  assertSecretEnv(
    container,
    "DATABASE_URL",
    variant.expectedDatabaseSecret,
    variant.name,
  );
}

function assertPodDisruptionBudget(byKind, appName, variantName) {
  const pdb = requireResource(
    byKind,
    "PodDisruptionBudget",
    appName,
    variantName,
  );
  if (pdb.spec?.minAvailable !== 1) {
    throw new Error(`${variantName} PDB does not require minAvailable=1.`);
  }
}

function assertWorkerCronJobs(byKind, variant) {
  const cronJobs = byKind.get("CronJob") ?? [];
  for (const component of variant.expectedWorkerCronJobs) {
    const cronJob = cronJobs.find(
      (resource) =>
        resource.metadata?.labels?.["app.kubernetes.io/component"] ===
        component,
    );
    if (cronJob === undefined) {
      throw new Error(`${variant.name} did not render ${component} CronJob.`);
    }
    assertCronJob(cronJob, variant, component);
  }
}

function assertBackupCronJob(byKind, variant) {
  const backup = optionalResource(byKind, "CronJob", "romeo-postgres-backup");
  if (variant.expectedBackup) {
    if (backup === undefined) {
      throw new Error(
        `${variant.name} did not render postgres backup CronJob.`,
      );
    }
    assertCronJob(backup, variant, "postgres-backup");
    const container = cronJobContainer(backup);
    assertSecretEnv(
      container,
      "DATABASE_URL",
      variant.expectedDatabaseSecret,
      variant.name,
    );
    for (const name of [
      "POSTGRES_BACKUP_UPLOAD_URL",
      "POSTGRES_BACKUP_MANIFEST_UPLOAD_URL",
    ]) {
      const env = findEnv(container, name);
      if (env?.valueFrom?.secretKeyRef === undefined) {
        throw new Error(`${variant.name} backup ${name} is not secret-backed.`);
      }
    }
    if (
      findEnv(container, "POSTGRES_BACKUP_UPLOAD_TIMEOUT_MS")?.value !== "30000"
    ) {
      throw new Error(`${variant.name} backup upload timeout env drifted.`);
    }
  } else if (backup !== undefined) {
    throw new Error(`${variant.name} unexpectedly rendered backup CronJob.`);
  }
}

function assertCronJob(cronJob, variant, component) {
  if (cronJob.spec?.concurrencyPolicy !== "Forbid") {
    throw new Error(`${variant.name} ${component} CronJob allows concurrency.`);
  }
  const podSpec = cronJob.spec?.jobTemplate?.spec?.template?.spec;
  if (podSpec?.restartPolicy !== "Never") {
    throw new Error(
      `${variant.name} ${component} CronJob is not restartPolicy Never.`,
    );
  }
  if (podSpec.serviceAccountName !== "romeo-worker") {
    throw new Error(
      `${variant.name} ${component} CronJob uses unexpected ServiceAccount.`,
    );
  }
  assertPodSecurityContext(
    podSpec.securityContext,
    variant.name,
    `${component} pod`,
  );
  const container = cronJobContainer(cronJob);
  assertContainerSecurityContext(
    container.securityContext,
    variant.name,
    `${component} container`,
  );
  assertResources(container.resources, variant.name, `${component} container`);
  assertWritableNodeEnv(container, variant.name, `${component} container`);
  if (component !== "postgres-backup") {
    const apiKey = findEnv(container, "ROMEO_API_KEY");
    const secretRef = apiKey?.valueFrom?.secretKeyRef;
    if (secretRef?.name !== variant.expectedWorkerApiKeySecret) {
      throw new Error(
        `${variant.name} ${component} API key is not worker-secret backed.`,
      );
    }
  }
  if (component === "knowledge-extraction") {
    const tmp = podSpec.volumes?.find((volume) => volume.name === "tmp");
    if (tmp?.emptyDir?.sizeLimit !== "1Gi") {
      throw new Error(
        `${variant.name} knowledge extraction tmp volume is not bounded.`,
      );
    }
  }
  if (component === "tool-dispatch") {
    const args = JSON.stringify(container.args ?? []);
    if (!args.includes("workers tool-dispatch")) {
      throw new Error(`${variant.name} tool-dispatch command drifted.`);
    }
    if (findEnv(container, "TOOL_DISPATCH_MAX_JOBS")?.value !== "5") {
      throw new Error(`${variant.name} tool-dispatch max jobs drifted.`);
    }
    if (
      findEnv(container, "TOOL_DISPATCH_ALLOW_PRIVATE_NETWORK")?.value !==
      "false"
    ) {
      throw new Error(
        `${variant.name} tool-dispatch private-network default drifted.`,
      );
    }
    if (
      findEnv(container, "TOOL_DISPATCH_SECRET_RESOLVER_DRIVER")?.value !==
      (variant.expectedToolDispatchSecretResolver ?? "disabled")
    ) {
      throw new Error(
        `${variant.name} tool-dispatch secret resolver default drifted.`,
      );
    }
    if (variant.expectedToolDispatchSecretResolver === "cloud") {
      assertToolDispatchCloudResolverEnv(
        container,
        variant.expectedToolDispatchSecretEnvSecret,
        variant.name,
      );
    }
    if (variant.expectedToolDispatchPayloadSecret !== undefined) {
      const volume = podSpec.volumes?.find(
        (item) => item.name === "tool-dispatch-payloads",
      );
      if (
        volume?.secret?.secretName !== variant.expectedToolDispatchPayloadSecret
      ) {
        throw new Error(
          `${variant.name} tool-dispatch payload Secret is not mounted.`,
        );
      }
      const mount = container.volumeMounts?.find(
        (item) => item.name === "tool-dispatch-payloads",
      );
      if (
        mount?.mountPath !== "/var/run/romeo-tool-dispatch" ||
        mount.readOnly !== true
      ) {
        throw new Error(
          `${variant.name} tool-dispatch payload mount is not read-only.`,
        );
      }
    }
  }
  if (component === "browser-automation") {
    const args = JSON.stringify(container.args ?? []);
    if (!args.includes("workers browser-automation")) {
      throw new Error(`${variant.name} browser-automation command drifted.`);
    }
    if (
      findEnv(container, "BROWSER_AUTOMATION_RUNNER_URL")?.value !==
      variant.expectedBrowserAutomationRunnerUrl
    ) {
      throw new Error(`${variant.name} browser automation runner URL drifted.`);
    }
    if (findEnv(container, "BROWSER_AUTOMATION_MAX_JOBS")?.value !== "5") {
      throw new Error(`${variant.name} browser automation max jobs drifted.`);
    }
  }
}

function assertToolDispatchCloudResolverEnv(
  container,
  secretName,
  variantName,
) {
  for (const [name, value] of [
    ["VAULT_ADDR", "https://vault.example.com"],
    ["AWS_REGION", "us-east-1"],
    ["GCP_SECRET_MANAGER_PROJECT", "romeo-prod"],
    ["AZURE_KEY_VAULT_URL", "https://romeo.vault.azure.net"],
  ]) {
    if (findEnv(container, name)?.value !== value) {
      throw new Error(`${variantName} tool-dispatch ${name} env drifted.`);
    }
  }
  for (const name of [
    "VAULT_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "GCP_ACCESS_TOKEN",
    "AZURE_ACCESS_TOKEN",
  ]) {
    const secretRef = findEnv(container, name)?.valueFrom?.secretKeyRef;
    if (secretRef?.name !== secretName || secretRef.optional !== true) {
      throw new Error(
        `${variantName} tool-dispatch ${name} is not optional secret-backed.`,
      );
    }
  }
}

function cronJobContainer(cronJob) {
  const containers =
    cronJob.spec?.jobTemplate?.spec?.template?.spec?.containers ?? [];
  if (containers.length !== 1) {
    throw new Error(
      `${cronJob.metadata?.name} should have exactly one container.`,
    );
  }
  return containers[0];
}

function assertOptionalIngress(byKind, variant) {
  const ingress = optionalResource(byKind, "Ingress", "romeo");
  if (variant.expectedIngress) {
    if (ingress === undefined) {
      throw new Error(`${variant.name} did not render Ingress.`);
    }
    if (ingress.spec?.ingressClassName !== "nginx") {
      throw new Error(`${variant.name} Ingress did not preserve className.`);
    }
    if (
      ingress.spec?.rules?.[0]?.http?.paths?.[0]?.backend?.service?.name !==
      "romeo"
    ) {
      throw new Error(`${variant.name} Ingress does not route to app service.`);
    }
  } else if (ingress !== undefined) {
    throw new Error(`${variant.name} unexpectedly rendered Ingress.`);
  }
}

function assertOptionalHpa(byKind, deployment, variant) {
  const hpa = optionalResource(byKind, "HorizontalPodAutoscaler", "romeo");
  if (variant.expectedHpa) {
    if (hpa === undefined) {
      throw new Error(
        `${variant.name} did not render HorizontalPodAutoscaler.`,
      );
    }
    if (deployment.spec?.replicas !== undefined) {
      throw new Error(
        `${variant.name} Deployment still sets replicas with HPA enabled.`,
      );
    }
    if (hpa.spec?.scaleTargetRef?.name !== "romeo") {
      throw new Error(
        `${variant.name} HPA does not target the app Deployment.`,
      );
    }
    if (hpa.spec?.minReplicas !== 2 || hpa.spec?.maxReplicas !== 6) {
      throw new Error(`${variant.name} HPA min/max replicas are incorrect.`);
    }
    const metrics = hpa.spec?.metrics ?? [];
    const metricNames = metrics.map((metric) => metric.resource?.name);
    if (!metricNames.includes("cpu") || !metricNames.includes("memory")) {
      throw new Error(
        `${variant.name} HPA does not include CPU and memory metrics.`,
      );
    }
  } else {
    if (hpa !== undefined) {
      throw new Error(`${variant.name} unexpectedly rendered HPA.`);
    }
    if (deployment.spec?.replicas !== 2) {
      throw new Error(
        `${variant.name} Deployment replicas drifted without HPA.`,
      );
    }
  }
}

function assertOptionalNetworkPolicy(byKind, variant) {
  const policy = optionalResource(byKind, "NetworkPolicy", "romeo");
  if (variant.expectedNetworkPolicy) {
    if (policy === undefined) {
      throw new Error(`${variant.name} did not render NetworkPolicy.`);
    }
    if (
      !policy.spec?.policyTypes?.includes("Ingress") ||
      !policy.spec?.policyTypes?.includes("Egress")
    ) {
      throw new Error(
        `${variant.name} NetworkPolicy is missing ingress/egress policy types.`,
      );
    }
    const egress = policy.spec?.egress;
    if (!Array.isArray(egress)) {
      throw new Error(`${variant.name} NetworkPolicy egress is not an array.`);
    }
    if (
      (variant.expectedNetworkPolicyEgress ?? "deny-all") === "deny-all" &&
      egress.length !== 0
    ) {
      throw new Error(
        `${variant.name} default NetworkPolicy egress is not deny-all.`,
      );
    }
    if (variant.expectedNetworkPolicyEgress === "explicit") {
      assertExplicitNetworkPolicyEgress(policy, variant.name);
    }
  } else if (policy !== undefined) {
    throw new Error(`${variant.name} unexpectedly rendered NetworkPolicy.`);
  }
}

function assertOptionalToolDispatchNetworkPolicy(byKind, variant) {
  const policy = optionalResource(
    byKind,
    "NetworkPolicy",
    "romeo-tool-dispatch",
  );
  if (variant.expectedToolDispatchNetworkPolicy) {
    if (policy === undefined) {
      throw new Error(
        `${variant.name} did not render tool-dispatch NetworkPolicy.`,
      );
    }
    const selector = policy.spec?.podSelector?.matchLabels ?? {};
    if (
      selector["app.kubernetes.io/name"] !== "romeo" ||
      selector["app.kubernetes.io/instance"] !== "romeo" ||
      selector["app.kubernetes.io/component"] !== "tool-dispatch"
    ) {
      throw new Error(
        `${variant.name} tool-dispatch NetworkPolicy selector is not component-scoped.`,
      );
    }
    if (
      policy.spec?.policyTypes?.includes("Egress") !== true ||
      policy.spec?.policyTypes?.includes("Ingress") === true
    ) {
      throw new Error(
        `${variant.name} tool-dispatch NetworkPolicy must be egress-only.`,
      );
    }
    const egress = policy.spec?.egress;
    if (!Array.isArray(egress)) {
      throw new Error(
        `${variant.name} tool-dispatch NetworkPolicy egress is not an array.`,
      );
    }
    if (
      (variant.expectedToolDispatchNetworkPolicyEgress ?? "deny-all") ===
        "deny-all" &&
      egress.length !== 0
    ) {
      throw new Error(
        `${variant.name} tool-dispatch NetworkPolicy default egress is not deny-all.`,
      );
    }
    if (variant.expectedToolDispatchNetworkPolicyEgress === "explicit") {
      assertToolDispatchNetworkPolicyEgress(policy, variant.name);
    }
  } else if (policy !== undefined) {
    throw new Error(
      `${variant.name} unexpectedly rendered tool-dispatch NetworkPolicy.`,
    );
  }
}

function assertOptionalBrowserAutomationNetworkPolicy(byKind, variant) {
  const policy = optionalResource(
    byKind,
    "NetworkPolicy",
    "romeo-browser-automation",
  );
  if (variant.expectedBrowserAutomationNetworkPolicy) {
    if (policy === undefined) {
      throw new Error(
        `${variant.name} did not render browser-automation NetworkPolicy.`,
      );
    }
    const selector = policy.spec?.podSelector?.matchLabels ?? {};
    if (
      selector["app.kubernetes.io/name"] !== "romeo" ||
      selector["app.kubernetes.io/instance"] !== "romeo" ||
      selector["app.kubernetes.io/component"] !== "browser-automation"
    ) {
      throw new Error(
        `${variant.name} browser-automation NetworkPolicy selector is not component-scoped.`,
      );
    }
    if (
      policy.spec?.policyTypes?.includes("Egress") !== true ||
      policy.spec?.policyTypes?.includes("Ingress") === true
    ) {
      throw new Error(
        `${variant.name} browser-automation NetworkPolicy must be egress-only.`,
      );
    }
    const egress = policy.spec?.egress;
    if (!Array.isArray(egress)) {
      throw new Error(
        `${variant.name} browser-automation NetworkPolicy egress is not an array.`,
      );
    }
    if (
      (variant.expectedBrowserAutomationNetworkPolicyEgress ?? "deny-all") ===
        "deny-all" &&
      egress.length !== 0
    ) {
      throw new Error(
        `${variant.name} browser-automation NetworkPolicy default egress is not deny-all.`,
      );
    }
  } else if (policy !== undefined) {
    throw new Error(
      `${variant.name} unexpectedly rendered browser-automation NetworkPolicy.`,
    );
  }
}

function assertToolDispatchNetworkPolicyEgress(policy, variantName) {
  const egress = policy.spec?.egress ?? [];
  const ports = egress.flatMap((rule) => rule.ports ?? []);
  for (const [port, protocol] of [
    [53, "UDP"],
    [53, "TCP"],
    [3000, "TCP"],
    [443, "TCP"],
  ]) {
    if (
      !ports.some(
        (item) => item.port === port && (item.protocol ?? "TCP") === protocol,
      )
    ) {
      throw new Error(
        `${variantName} tool-dispatch NetworkPolicy missing ${protocol}/${port} egress.`,
      );
    }
  }
  const selectors = egress.flatMap((rule) => rule.to ?? []);
  if (
    !selectors.some(
      (item) =>
        item.namespaceSelector?.matchLabels?.["kubernetes.io/metadata.name"] ===
        "kube-system",
    )
  ) {
    throw new Error(
      `${variantName} tool-dispatch NetworkPolicy missing kube-system DNS egress.`,
    );
  }
  if (
    !selectors.some(
      (item) =>
        item.podSelector?.matchLabels?.["app.kubernetes.io/component"] ===
        "app",
    )
  ) {
    throw new Error(
      `${variantName} tool-dispatch NetworkPolicy missing app pod egress.`,
    );
  }
  if (!selectors.some((item) => item.ipBlock?.cidr === "203.0.113.0/24")) {
    throw new Error(
      `${variantName} tool-dispatch NetworkPolicy missing external HTTPS egress.`,
    );
  }
}

function assertExplicitNetworkPolicyEgress(policy, variantName) {
  const egress = policy.spec?.egress ?? [];
  const ports = egress.flatMap((rule) => rule.ports ?? []);
  for (const [port, protocol] of [
    [53, "UDP"],
    [53, "TCP"],
    [5432, "TCP"],
    [6379, "TCP"],
    [443, "TCP"],
    [4317, "TCP"],
  ]) {
    if (
      !ports.some(
        (item) => item.port === port && (item.protocol ?? "TCP") === protocol,
      )
    ) {
      throw new Error(
        `${variantName} NetworkPolicy missing ${protocol}/${port} egress.`,
      );
    }
  }
  const selectors = egress.flatMap((rule) => rule.to ?? []);
  for (const namespace of ["kube-system", "data", "storage"]) {
    if (
      !selectors.some(
        (item) =>
          item.namespaceSelector?.matchLabels?.[
            "kubernetes.io/metadata.name"
          ] === namespace,
      )
    ) {
      throw new Error(
        `${variantName} NetworkPolicy missing ${namespace} namespace egress.`,
      );
    }
  }
  for (const cidr of ["203.0.113.0/24", "198.51.100.0/24"]) {
    if (!selectors.some((item) => item.ipBlock?.cidr === cidr)) {
      throw new Error(`${variantName} NetworkPolicy missing ${cidr} egress.`);
    }
  }
}

function assertEnvFromSecret(container, variant) {
  if (variant.expectedRuntimeSecret === undefined) return;
  const secretRef = container.envFrom?.find(
    (entry) => entry.secretRef?.name === variant.expectedRuntimeSecret,
  );
  if (secretRef === undefined) {
    throw new Error(`${variant.name} app does not reference runtime Secret.`);
  }
}

function assertSecretEnv(container, envName, secretName, variantName) {
  const variant = variants.find((item) => item.name === variantName);
  const expectedKey =
    envName === "DATABASE_URL"
      ? (variant?.expectedDatabaseSecretKey ?? envName)
      : envName;
  const env = findEnv(container, envName);
  const secretRef = env?.valueFrom?.secretKeyRef;
  if (secretRef?.name !== secretName || secretRef?.key !== expectedKey) {
    throw new Error(
      `${variantName} ${envName} is not sourced from Secret ${secretName}/${expectedKey}.`,
    );
  }
  if (env.value !== undefined) {
    throw new Error(`${variantName} ${envName} is inlined as a value.`);
  }
}

function assertWritableNodeEnv(container, variantName, label) {
  for (const [name, value] of [
    ["HOME", "/tmp"],
    ["XDG_CACHE_HOME", "/tmp/.cache"],
    ["COREPACK_HOME", "/tmp/.cache/corepack"],
    ["PNPM_HOME", "/tmp/.local/share/pnpm"],
  ]) {
    if (findEnv(container, name)?.value !== value) {
      throw new Error(
        `${variantName} ${label} does not set ${name} to writable ${value}.`,
      );
    }
  }
}

function findEnv(container, envName) {
  return container?.env?.find((entry) => entry.name === envName);
}

function assertPodSecurityContext(securityContext, variantName, label) {
  if (securityContext?.runAsNonRoot !== true) {
    throw new Error(`${variantName} ${label} is not runAsNonRoot.`);
  }
  if (securityContext?.seccompProfile?.type !== "RuntimeDefault") {
    throw new Error(
      `${variantName} ${label} is not using RuntimeDefault seccomp.`,
    );
  }
}

function assertContainerSecurityContext(securityContext, variantName, label) {
  if (securityContext?.allowPrivilegeEscalation !== false) {
    throw new Error(`${variantName} ${label} allows privilege escalation.`);
  }
  if (!securityContext?.capabilities?.drop?.includes("ALL")) {
    throw new Error(`${variantName} ${label} does not drop all capabilities.`);
  }
}

function assertResources(resources, variantName, label) {
  if (
    resources?.requests?.cpu === undefined ||
    resources.requests.memory === undefined ||
    resources?.limits?.cpu === undefined ||
    resources.limits.memory === undefined
  ) {
    throw new Error(`${variantName} ${label} is missing CPU/memory resources.`);
  }
}

function resourceKindCounts(resources) {
  return resources.reduce((counts, resource) => {
    counts[resource.kind] = (counts[resource.kind] ?? 0) + 1;
    return counts;
  }, {});
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
  return result;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
