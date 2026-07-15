import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { collectGaTargetPreflight } from "./lib/ga-target-preflight.mjs";
import {
  loadGaTargetEnvFile,
  withGaTargetProcessEnv,
} from "./lib/ga-target-env-file.mjs";

const outputPath = argValue("--output");
const tempDir = mkdtempSync(join(tmpdir(), "romeo-ga-target-preflight-"));
const originalCwd = process.cwd();
const originalEnv = {
  NODE_AUTH_TOKEN: process.env.NODE_AUTH_TOKEN,
  NPM_TOKEN: process.env.NPM_TOKEN,
  OCI_REGISTRY_TOKEN: process.env.OCI_REGISTRY_TOKEN,
  HELM_REPOSITORY_TOKEN: process.env.HELM_REPOSITORY_TOKEN,
  RELEASE_ASSET_TOKEN: process.env.RELEASE_ASSET_TOKEN,
  RELEASE_READBACK_PLAN_FILE: process.env.RELEASE_READBACK_PLAN_FILE,
  KUBERNETES_DR_APP_IMAGE: process.env.KUBERNETES_DR_APP_IMAGE,
  KUBERNETES_DR_PLAN_FILE: process.env.KUBERNETES_DR_PLAN_FILE,
  KUBERNETES_DR_SKIP_BUILD: process.env.KUBERNETES_DR_SKIP_BUILD,
  PATH: process.env.PATH,
  PROMETHEUS_URL: process.env.PROMETHEUS_URL,
  ALERTMANAGER_URL: process.env.ALERTMANAGER_URL,
  ALERT_FIRING_REQUIRED_ALERTS: process.env.ALERT_FIRING_REQUIRED_ALERTS,
  EDGE_ENFORCEMENT_BODY_LIMIT_BYTES:
    process.env.EDGE_ENFORCEMENT_BODY_LIMIT_BYTES,
  EDGE_ENFORCEMENT_BODY_LIMIT_EXPECTED_STATUSES:
    process.env.EDGE_ENFORCEMENT_BODY_LIMIT_EXPECTED_STATUSES,
  EDGE_ENFORCEMENT_BODY_LIMIT_PATH:
    process.env.EDGE_ENFORCEMENT_BODY_LIMIT_PATH,
  EDGE_ENFORCEMENT_HEADER_PATH: process.env.EDGE_ENFORCEMENT_HEADER_PATH,
  EDGE_ENFORCEMENT_RATE_LIMIT_ATTEMPTS:
    process.env.EDGE_ENFORCEMENT_RATE_LIMIT_ATTEMPTS,
  EDGE_ENFORCEMENT_RATE_LIMIT_EXPECTED_STATUS:
    process.env.EDGE_ENFORCEMENT_RATE_LIMIT_EXPECTED_STATUS,
  EDGE_ENFORCEMENT_RATE_LIMIT_PATH:
    process.env.EDGE_ENFORCEMENT_RATE_LIMIT_PATH,
  EDGE_ENFORCEMENT_REQUIRE_ADMIN_POSTURE:
    process.env.EDGE_ENFORCEMENT_REQUIRE_ADMIN_POSTURE,
  EDGE_ENFORCEMENT_REQUIRE_HSTS: process.env.EDGE_ENFORCEMENT_REQUIRE_HSTS,
  EDGE_ENFORCEMENT_REQUIRE_WAF_BLOCK_MODE:
    process.env.EDGE_ENFORCEMENT_REQUIRE_WAF_BLOCK_MODE,
  EDGE_ENFORCEMENT_TIMEOUT_MS: process.env.EDGE_ENFORCEMENT_TIMEOUT_MS,
  EDGE_ENFORCEMENT_WAF_EXPECTED_HEADER:
    process.env.EDGE_ENFORCEMENT_WAF_EXPECTED_HEADER,
  EDGE_ENFORCEMENT_WAF_EXPECTED_STATUSES:
    process.env.EDGE_ENFORCEMENT_WAF_EXPECTED_STATUSES,
  EDGE_ENFORCEMENT_WAF_PROBE_HEADER_NAME:
    process.env.EDGE_ENFORCEMENT_WAF_PROBE_HEADER_NAME,
  EDGE_ENFORCEMENT_WAF_PROBE_HEADER_VALUE:
    process.env.EDGE_ENFORCEMENT_WAF_PROBE_HEADER_VALUE,
  EDGE_ENFORCEMENT_WAF_PROBE_PATH: process.env.EDGE_ENFORCEMENT_WAF_PROBE_PATH,
  KUBERNETES_NETWORKPOLICY_CLIENT_IMAGE:
    process.env.KUBERNETES_NETWORKPOLICY_CLIENT_IMAGE,
  KUBERNETES_NETWORKPOLICY_CONFIRM_CNI_ENFORCEMENT:
    process.env.KUBERNETES_NETWORKPOLICY_CONFIRM_CNI_ENFORCEMENT,
  KUBERNETES_NETWORKPOLICY_NAMESPACE:
    process.env.KUBERNETES_NETWORKPOLICY_NAMESPACE,
  KUBERNETES_NETWORKPOLICY_POLICY_PROPAGATION_MS:
    process.env.KUBERNETES_NETWORKPOLICY_POLICY_PROPAGATION_MS,
  KUBERNETES_NETWORKPOLICY_SERVER_IMAGE:
    process.env.KUBERNETES_NETWORKPOLICY_SERVER_IMAGE,
  KUBERNETES_NETWORKPOLICY_TIMEOUT_MS:
    process.env.KUBERNETES_NETWORKPOLICY_TIMEOUT_MS,
  KUBERNETES_LOAD_SOAK_BASE_URL: process.env.KUBERNETES_LOAD_SOAK_BASE_URL,
  KUBERNETES_LOAD_SOAK_DEPLOYMENT_NAME:
    process.env.KUBERNETES_LOAD_SOAK_DEPLOYMENT_NAME,
  KUBERNETES_LOAD_SOAK_INTERVAL_SECONDS:
    process.env.KUBERNETES_LOAD_SOAK_INTERVAL_SECONDS,
  KUBERNETES_LOAD_SOAK_ITERATIONS: process.env.KUBERNETES_LOAD_SOAK_ITERATIONS,
  KUBERNETES_LOAD_SOAK_NAMESPACE: process.env.KUBERNETES_LOAD_SOAK_NAMESPACE,
  KUBERNETES_LOAD_SOAK_RELEASE_NAME:
    process.env.KUBERNETES_LOAD_SOAK_RELEASE_NAME,
  KUBERNETES_LOAD_SOAK_SELECTOR: process.env.KUBERNETES_LOAD_SOAK_SELECTOR,
  KUBERNETES_LOAD_SOAK_SERVICE_NAME:
    process.env.KUBERNETES_LOAD_SOAK_SERVICE_NAME,
  KUBERNETES_LOAD_SOAK_SERVICE_PORT:
    process.env.KUBERNETES_LOAD_SOAK_SERVICE_PORT,
  KUBERNETES_LOAD_SOAK_SOAK_SECONDS:
    process.env.KUBERNETES_LOAD_SOAK_SOAK_SECONDS,
  KUBERNETES_LOAD_SOAK_TIER: process.env.KUBERNETES_LOAD_SOAK_TIER,
  KUBERNETES_LOAD_SOAK_TIMEOUT_MS: process.env.KUBERNETES_LOAD_SOAK_TIMEOUT_MS,
  KUBERNETES_LIVE_SMOKE_APP_IMAGE: process.env.KUBERNETES_LIVE_SMOKE_APP_IMAGE,
  KUBERNETES_LIVE_SMOKE_NAMESPACE: process.env.KUBERNETES_LIVE_SMOKE_NAMESPACE,
  KUBERNETES_LIVE_SMOKE_OBJECT_STORE_CLIENT_IMAGE:
    process.env.KUBERNETES_LIVE_SMOKE_OBJECT_STORE_CLIENT_IMAGE,
  KUBERNETES_LIVE_SMOKE_POSTGRES_IMAGE:
    process.env.KUBERNETES_LIVE_SMOKE_POSTGRES_IMAGE,
  KUBERNETES_LIVE_SMOKE_RELEASE_NAME:
    process.env.KUBERNETES_LIVE_SMOKE_RELEASE_NAME,
  KUBERNETES_LIVE_SMOKE_RUSTFS_IMAGE:
    process.env.KUBERNETES_LIVE_SMOKE_RUSTFS_IMAGE,
  KUBERNETES_LIVE_SMOKE_SKIP_BUILD:
    process.env.KUBERNETES_LIVE_SMOKE_SKIP_BUILD,
  KUBERNETES_LIVE_SMOKE_TIMEOUT_MS:
    process.env.KUBERNETES_LIVE_SMOKE_TIMEOUT_MS,
  KUBERNETES_LIVE_SMOKE_VALKEY_IMAGE:
    process.env.KUBERNETES_LIVE_SMOKE_VALKEY_IMAGE,
  DATABASE_URL: process.env.DATABASE_URL,
  POSTGRES_ARCHIVAL_DECISION: process.env.POSTGRES_ARCHIVAL_DECISION,
  POSTGRES_MAX_BLOCKED_SESSIONS: process.env.POSTGRES_MAX_BLOCKED_SESSIONS,
  POSTGRES_MAX_DEADLOCKS: process.env.POSTGRES_MAX_DEADLOCKS,
  POSTGRES_OPERATIONAL_MODE: process.env.POSTGRES_OPERATIONAL_MODE,
  POSTGRES_OPERATIONAL_TARGET_TIER:
    process.env.POSTGRES_OPERATIONAL_TARGET_TIER,
  POSTGRES_SLOW_QUERY_THRESHOLD_MS:
    process.env.POSTGRES_SLOW_QUERY_THRESHOLD_MS,
  POSTGRES_TELEMETRY_WINDOW_MINUTES:
    process.env.POSTGRES_TELEMETRY_WINDOW_MINUTES,
  KEDA_NAMESPACE: process.env.KEDA_NAMESPACE,
  KEDA_SCALEDJOB_NAME: process.env.KEDA_SCALEDJOB_NAME,
  KEDA_TRIGGERAUTHENTICATION_NAME: process.env.KEDA_TRIGGERAUTHENTICATION_NAME,
  BROWSER_AUTOMATION_LIVE_EVIDENCE_REVIEWED:
    process.env.BROWSER_AUTOMATION_LIVE_EVIDENCE_REVIEWED,
  TENANT_PURGE_EVIDENCE_REVIEWED: process.env.TENANT_PURGE_EVIDENCE_REVIEWED,
  SUPPORT_BUNDLE_EVIDENCE_REVIEWED:
    process.env.SUPPORT_BUNDLE_EVIDENCE_REVIEWED,
  CI_GOVERNANCE_EVIDENCE_REVIEWED: process.env.CI_GOVERNANCE_EVIDENCE_REVIEWED,
  GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GH_TOKEN: process.env.GH_TOKEN,
  GITHUB_CI_RUN_ID: process.env.GITHUB_CI_RUN_ID,
  GITHUB_CI_HEAD_SHA: process.env.GITHUB_CI_HEAD_SHA,
  GITHUB_API_URL: process.env.GITHUB_API_URL,
  GITHUB_BRANCH: process.env.GITHUB_BRANCH,
  DATA_CONNECTOR_LIVE_EVIDENCE_REVIEWED:
    process.env.DATA_CONNECTOR_LIVE_EVIDENCE_REVIEWED,
  TOOL_DISPATCH_LIVE_EVIDENCE_REVIEWED:
    process.env.TOOL_DISPATCH_LIVE_EVIDENCE_REVIEWED,
  ROMEO_API_KEY: process.env.ROMEO_API_KEY,
  ROMEO_DEPLOYMENT_NAME: process.env.ROMEO_DEPLOYMENT_NAME,
  ROMEO_BASE_URL: process.env.ROMEO_BASE_URL,
  ROMEO_NAMESPACE: process.env.ROMEO_NAMESPACE,
  ROMEO_RELEASE_NAME: process.env.ROMEO_RELEASE_NAME,
  ROMEO_SERVICE_NAME: process.env.ROMEO_SERVICE_NAME,
  TARGET_QUALITY_AGENT_IDS: process.env.TARGET_QUALITY_AGENT_IDS,
  TARGET_QUALITY_FORBIDDEN_STRINGS:
    process.env.TARGET_QUALITY_FORBIDDEN_STRINGS,
  TARGET_QUALITY_REPLAY_FILE: process.env.TARGET_QUALITY_REPLAY_FILE,
  QDRANT_API_KEY: process.env.QDRANT_API_KEY,
  QDRANT_DR_RUN_SECRET: process.env.QDRANT_DR_RUN_SECRET,
  QDRANT_COLLECTION: process.env.QDRANT_COLLECTION,
  QDRANT_LIVE_EVIDENCE_REVIEWED: process.env.QDRANT_LIVE_EVIDENCE_REVIEWED,
  QDRANT_URL: process.env.QDRANT_URL,
  RESTORE_QDRANT_API_KEY: process.env.RESTORE_QDRANT_API_KEY,
  RESTORE_QDRANT_COLLECTION: process.env.RESTORE_QDRANT_COLLECTION,
  RESTORE_QDRANT_URL: process.env.RESTORE_QDRANT_URL,
  SOURCE_QDRANT_API_KEY: process.env.SOURCE_QDRANT_API_KEY,
  SOURCE_QDRANT_COLLECTION: process.env.SOURCE_QDRANT_COLLECTION,
  SOURCE_QDRANT_URL: process.env.SOURCE_QDRANT_URL,
  VECTOR_NAMESPACE_POLICY: process.env.VECTOR_NAMESPACE_POLICY,
  VECTOR_PARTITIONING_POLICY: process.env.VECTOR_PARTITIONING_POLICY,
};
const secretSentinels = [
  "SECRET_PREFLIGHT_API_KEY",
  "SECRET_PREFLIGHT_NPM_TOKEN",
  "SECRET_PREFLIGHT_OCI_TOKEN",
  "SECRET_PREFLIGHT_HELM_TOKEN",
  "SECRET_PREFLIGHT_ASSET_TOKEN",
  "SECRET_PREFLIGHT_GITHUB_TOKEN",
  "secret-owner/secret-repo",
  "SECRET_RELEASE_ASSET_PATH",
  "secret-kubernetes-dr-source-secret",
  "secret-kubernetes-dr-restore-secret",
  "SECRET_QDRANT_LIVE_API_KEY",
  "SECRET_QDRANT_LIVE_COLLECTION",
  "SECRET_QDRANT_DR_RUN_SECRET",
  "SECRET_RESTORE_QDRANT_API_KEY",
  "SECRET_RESTORE_QDRANT_COLLECTION",
  "SECRET_SOURCE_QDRANT_API_KEY",
  "SECRET_SOURCE_QDRANT_COLLECTION",
  "SECRET_TARGET_QUALITY_AGENT",
  "SECRET_TARGET_QUALITY_FORBIDDEN",
  "SECRET_TARGET_QUALITY_REPLAY_QUERY",
  "SECRET_ALERTMANAGER_TOKEN",
  "SECRET_EDGE_HEADER_VALUE",
  "SECRET_EDGE_PROBE_QUERY",
  "SECRET_POSTGRES_PASSWORD",
  "token-query-sentinel",
];

try {
  writeJson("dist/ci/checklist.json", checklist());
  for (const path of [
    "dist/release/release-manifest.json",
    "dist/release/release-channel.json",
    "dist/release/security-evidence.json",
    "dist/release/sbom.cdx.json",
  ]) {
    writeJson(path, { status: "synthetic" });
  }
  writeJson("evidence/target-quality-replay.json", {
    cases: [
      {
        id: "target_quality_preflight_case",
        knowledgeBaseIds: ["kb_preflight"],
        query: "SECRET_TARGET_QUALITY_REPLAY_QUERY",
        expectedChunkIds: ["chunk_preflight"],
      },
    ],
  });
  writeJson("evidence/target-quality-replay-compare.json", {
    baseline: [
      {
        id: "target_quality_preflight_baseline",
        knowledgeBaseIds: ["kb_preflight"],
        query: "SECRET_TARGET_QUALITY_REPLAY_QUERY",
        expectedChunkIds: ["chunk_preflight"],
      },
    ],
    candidate: [
      {
        id: "target_quality_preflight_candidate",
        knowledgeBaseIds: ["kb_preflight"],
        query: "SECRET_TARGET_QUALITY_REPLAY_QUERY",
        expectedChunkIds: ["chunk_preflight"],
      },
    ],
  });
  writeJson("dist/release/release-readback-plan.json", releaseReadbackPlan());
  writeJson("dist/ci/kubernetes-dr-plan.json", kubernetesDrPlan());
  writeText("deploy/monitoring/prometheus-rules.yaml", prometheusRuleFixture());

  process.chdir(tempDir);
  process.env.ROMEO_BASE_URL = "https://romeo.example.com/internal";
  process.env.ROMEO_API_KEY = "SECRET_PREFLIGHT_API_KEY";
  process.env.PROMETHEUS_URL = "https://prometheus.example.com";
  process.env.NPM_TOKEN = "SECRET_PREFLIGHT_NPM_TOKEN";
  process.env.OCI_REGISTRY_TOKEN = "SECRET_PREFLIGHT_OCI_TOKEN";
  process.env.HELM_REPOSITORY_TOKEN = "SECRET_PREFLIGHT_HELM_TOKEN";
  process.env.RELEASE_ASSET_TOKEN = "SECRET_PREFLIGHT_ASSET_TOKEN";
  process.env.RELEASE_READBACK_PLAN_FILE =
    "dist/release/release-readback-plan.json";
  process.env.TARGET_QUALITY_AGENT_IDS =
    "SECRET_TARGET_QUALITY_AGENT,agent_contract";
  process.env.TARGET_QUALITY_FORBIDDEN_STRINGS =
    "SECRET_TARGET_QUALITY_FORBIDDEN";
  process.env.TARGET_QUALITY_REPLAY_FILE =
    "evidence/target-quality-replay.json";
  setReadyEdgeEnv();
  delete process.env.NODE_AUTH_TOKEN;

  const ready = collectGaTargetPreflight({
    checklistPath: "dist/ci/checklist.json",
  });
  assertEqual(ready.status, "ready", "ready preflight status");
  assertEqual(ready.summary.ready, 2, "ready preflight gate count");
  assertReleaseReadbackPreflightReady(ready);
  assertTargetQualityPreflightReady(ready);
  assertRedacted("ready preflight", ready);

  writeText(
    "dist/ci/ga-target.env.private",
    [
      "# Synthetic private GA target env file",
      "ROMEO_BASE_URL=https://romeo.example.com/internal",
      "ROMEO_API_KEY=SECRET_PREFLIGHT_API_KEY",
      "NPM_TOKEN=SECRET_PREFLIGHT_NPM_TOKEN",
      "NODE_AUTH_TOKEN=",
      "RELEASE_READBACK_PLAN_FILE=dist/release/release-readback-plan.json",
      "TARGET_QUALITY_AGENT_IDS=SECRET_TARGET_QUALITY_AGENT,agent_contract",
      "TARGET_QUALITY_FORBIDDEN_STRINGS=SECRET_TARGET_QUALITY_FORBIDDEN",
      "TARGET_QUALITY_REPLAY_FILE=evidence/target-quality-replay.json",
      "",
    ].join("\n"),
  );
  for (const name of [
    "ROMEO_BASE_URL",
    "ROMEO_API_KEY",
    "NPM_TOKEN",
    "NODE_AUTH_TOKEN",
    "RELEASE_READBACK_PLAN_FILE",
    "TARGET_QUALITY_AGENT_IDS",
    "TARGET_QUALITY_FORBIDDEN_STRINGS",
    "TARGET_QUALITY_REPLAY_FILE",
  ]) {
    delete process.env[name];
  }
  const envFile = loadGaTargetEnvFile("dist/ci/ga-target.env.private");
  const envFileReady = withGaTargetProcessEnv(envFile.env, () =>
    collectGaTargetPreflight({
      checklistPath: "dist/ci/checklist.json",
    }),
  );
  envFileReady.envFile = envFile.evidence;
  envFileReady.redaction = {
    ...envFileReady.redaction,
    rawEnvFileValuesReturned: false,
    rawEnvFileBodyReturned: false,
  };
  assertEqual(envFileReady.status, "ready", "env-file preflight status");
  assertEqual(envFileReady.summary.ready, 2, "env-file ready gate count");
  assertEqual(envFileReady.envFile.variableCount, 8, "env-file variable count");
  assertEqual(
    envFileReady.envFile.populatedVariableCount,
    7,
    "env-file populated count",
  );
  assertEqual(
    envFileReady.envFile.blankVariableCount,
    1,
    "env-file blank count",
  );
  assertEqual(
    envFileReady.envFile.rawValuesReturned,
    false,
    "env-file values redacted",
  );
  assertEqual(
    envFileReady.envFile.rawFileBodyReturned,
    false,
    "env-file body redacted",
  );
  assertReleaseReadbackPreflightReady(envFileReady);
  assertTargetQualityPreflightReady(envFileReady);
  assertRedacted("env-file ready preflight", envFileReady);

  process.env.ROMEO_BASE_URL = "https://romeo.example.com/internal";
  process.env.ROMEO_API_KEY = "SECRET_PREFLIGHT_API_KEY";
  process.env.NPM_TOKEN = "SECRET_PREFLIGHT_NPM_TOKEN";
  process.env.RELEASE_READBACK_PLAN_FILE =
    "dist/release/release-readback-plan.json";
  process.env.TARGET_QUALITY_AGENT_IDS =
    "SECRET_TARGET_QUALITY_AGENT,agent_contract";
  process.env.TARGET_QUALITY_FORBIDDEN_STRINGS =
    "SECRET_TARGET_QUALITY_FORBIDDEN";
  process.env.TARGET_QUALITY_REPLAY_FILE =
    "evidence/target-quality-replay.json";
  delete process.env.NODE_AUTH_TOKEN;

  process.env.TARGET_QUALITY_REQUIRE_VECTOR_COMPARISON = "true";
  const vectorComparisonBlocked = collectGaTargetPreflight({
    checklistPath: "dist/ci/checklist.json",
  });
  assertEqual(
    vectorComparisonBlocked.status,
    "blocked",
    "vector comparison preflight blocks single replay fixture",
  );
  assertTargetQualityVectorComparisonBlocked(vectorComparisonBlocked);
  assertRedacted(
    "vector comparison blocked preflight",
    vectorComparisonBlocked,
  );

  process.env.TARGET_QUALITY_REPLAY_FILE =
    "evidence/target-quality-replay-compare.json";
  process.env.TARGET_QUALITY_CANDIDATE_VECTOR_ROUTE_MODE = "qdrant";
  const vectorComparisonReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/checklist.json",
  });
  assertEqual(
    vectorComparisonReady.status,
    "ready",
    "vector comparison preflight ready",
  );
  assertTargetQualityVectorComparisonReady(vectorComparisonReady);
  assertRedacted("vector comparison ready preflight", vectorComparisonReady);
  delete process.env.TARGET_QUALITY_REQUIRE_VECTOR_COMPARISON;
  delete process.env.TARGET_QUALITY_CANDIDATE_VECTOR_ROUTE_MODE;
  process.env.TARGET_QUALITY_REPLAY_FILE =
    "evidence/target-quality-replay.json";

  delete process.env.RELEASE_READBACK_PLAN_FILE;
  const missingReleasePlan = collectGaTargetPreflight({
    checklistPath: "dist/ci/checklist.json",
  });
  assertEqual(
    missingReleasePlan.status,
    "blocked",
    "missing release plan preflight",
  );
  assertEqual(
    missingReleasePlan.summary.blocked,
    1,
    "missing release plan blocked gate count",
  );
  assertRedacted("missing release plan preflight", missingReleasePlan);
  process.env.RELEASE_READBACK_PLAN_FILE =
    "dist/release/release-readback-plan.json";

  process.env.ROMEO_BASE_URL =
    "https://romeo.example.com/internal?token=token-query-sentinel";
  const unsafeTargetUrl = collectGaTargetPreflight({
    checklistPath: "dist/ci/checklist.json",
  });
  assertEqual(unsafeTargetUrl.status, "blocked", "unsafe target URL preflight");
  assertGateCheckReason(
    unsafeTargetUrl,
    "phase32.target_quality_evidence",
    "target_api",
    "url_contains_unsafe_parts",
  );
  assertRedacted("unsafe target URL preflight", unsafeTargetUrl);
  process.env.ROMEO_BASE_URL = "https://romeo.example.com/internal";

  writeJson("dist/ci/prometheus-checklist.json", prometheusChecklist());
  process.env.PROMETHEUS_URL =
    "https://prometheus.example.com/api?token=token-query-sentinel";
  const unsafePrometheusUrl = collectGaTargetPreflight({
    checklistPath: "dist/ci/prometheus-checklist.json",
  });
  assertEqual(
    unsafePrometheusUrl.status,
    "blocked",
    "unsafe Prometheus URL preflight",
  );
  assertGateCheckReason(
    unsafePrometheusUrl,
    "phase34.live_alert_firing",
    "prometheus",
    "url_contains_unsafe_parts",
  );
  assertRedacted("unsafe Prometheus URL preflight", unsafePrometheusUrl);

  process.env.PROMETHEUS_URL = "https://prometheus.example.com";
  process.env.ALERTMANAGER_URL = "https://alertmanager.example.com";
  delete process.env.ALERT_FIRING_REQUIRED_ALERTS;
  const alertDefaultReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/prometheus-checklist.json",
  });
  assertEqual(
    alertDefaultReady.status,
    "ready",
    "ready default alert preflight",
  );
  assertAlertPreflightReady(alertDefaultReady);
  assertRedacted("ready default alert preflight", alertDefaultReady);

  process.env.ALERT_FIRING_REQUIRED_ALERTS =
    "RomeoProviderCircuitOpen,RomeoBackgroundJobQueuedLag";
  const alertMissingCategory = collectGaTargetPreflight({
    checklistPath: "dist/ci/prometheus-checklist.json",
  });
  assertEqual(
    alertMissingCategory.status,
    "blocked",
    "missing category alert preflight",
  );
  assertGateCheckReason(
    alertMissingCategory,
    "phase34.live_alert_firing",
    "alerts:required_categories",
    "required_category_missing",
  );
  assertRedacted("missing category alert preflight", alertMissingCategory);

  delete process.env.ALERT_FIRING_REQUIRED_ALERTS;
  process.env.ALERTMANAGER_URL =
    "https://alertmanager.example.com/api?token=token-query-sentinel";
  const unsafeAlertmanagerUrl = collectGaTargetPreflight({
    checklistPath: "dist/ci/prometheus-checklist.json",
  });
  assertEqual(
    unsafeAlertmanagerUrl.status,
    "blocked",
    "unsafe Alertmanager URL preflight",
  );
  assertGateCheckReason(
    unsafeAlertmanagerUrl,
    "phase34.live_alert_firing",
    "alertmanager",
    "url_contains_unsafe_parts",
  );
  assertRedacted("unsafe Alertmanager URL preflight", unsafeAlertmanagerUrl);
  delete process.env.ALERTMANAGER_URL;
  delete process.env.PROMETHEUS_URL;

  writeJson("dist/ci/edge-checklist.json", edgeChecklist());
  process.env.ROMEO_BASE_URL = "https://romeo.example.com";
  process.env.ROMEO_API_KEY = "SECRET_PREFLIGHT_API_KEY";
  setReadyEdgeEnv();
  const edgeReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/edge-checklist.json",
  });
  assertEqual(edgeReady.status, "ready", "ready edge preflight");
  assertEdgePreflightReady(edgeReady);
  assertRedacted("ready edge preflight", edgeReady);

  process.env.EDGE_ENFORCEMENT_REQUIRE_WAF_BLOCK_MODE = "false";
  const edgeMissingWafBlockMode = collectGaTargetPreflight({
    checklistPath: "dist/ci/edge-checklist.json",
  });
  assertEqual(
    edgeMissingWafBlockMode.status,
    "blocked",
    "missing WAF block-mode edge preflight",
  );
  assertGateCheckReason(
    edgeMissingWafBlockMode,
    "phase33.live_edge_enforcement",
    "edge:required_controls",
    "waf_block_mode_not_true",
  );
  assertRedacted(
    "missing WAF block-mode edge preflight",
    edgeMissingWafBlockMode,
  );
  process.env.EDGE_ENFORCEMENT_REQUIRE_WAF_BLOCK_MODE = "true";

  process.env.EDGE_ENFORCEMENT_WAF_EXPECTED_STATUSES = "200";
  const edgeBadWafStatuses = collectGaTargetPreflight({
    checklistPath: "dist/ci/edge-checklist.json",
  });
  assertEqual(
    edgeBadWafStatuses.status,
    "blocked",
    "bad WAF status edge preflight",
  );
  assertGateCheckReason(
    edgeBadWafStatuses,
    "phase33.live_edge_enforcement",
    "edge:status_expectations",
    "waf_statuses_not_ga_compatible",
  );
  assertRedacted("bad WAF status edge preflight", edgeBadWafStatuses);
  process.env.EDGE_ENFORCEMENT_WAF_EXPECTED_STATUSES = "403,406,429";

  process.env.EDGE_ENFORCEMENT_WAF_PROBE_PATH =
    "https://waf.example.com/api/v1/health?romeo_edge_probe=SECRET_EDGE_PROBE_QUERY";
  const edgeUnsafeProbePath = collectGaTargetPreflight({
    checklistPath: "dist/ci/edge-checklist.json",
  });
  assertEqual(
    edgeUnsafeProbePath.status,
    "blocked",
    "unsafe edge WAF probe path preflight",
  );
  assertGateCheckReason(
    edgeUnsafeProbePath,
    "phase33.live_edge_enforcement",
    "edge:probe_paths",
    "waf_probe_path_absolute_url_not_allowed",
  );
  assertRedacted("unsafe edge WAF probe path preflight", edgeUnsafeProbePath);
  setReadyEdgeEnv();

  delete process.env.TARGET_QUALITY_REPLAY_FILE;
  const missingReplay = collectGaTargetPreflight({
    checklistPath: "dist/ci/checklist.json",
  });
  assertEqual(
    missingReplay.status,
    "blocked",
    "missing replay target-quality preflight",
  );
  assertEqual(
    missingReplay.summary.blocked,
    1,
    "missing replay blocked gate count",
  );
  assertRedacted("missing replay preflight", missingReplay);
  process.env.TARGET_QUALITY_REPLAY_FILE =
    "evidence/target-quality-replay.json";

  delete process.env.NPM_TOKEN;
  process.env.ROMEO_BASE_URL = "";
  const blocked = collectGaTargetPreflight({
    checklistPath: "dist/ci/checklist.json",
  });
  assertEqual(blocked.status, "blocked", "blocked preflight status");
  assertEqual(blocked.summary.blocked, 2, "blocked preflight gate count");
  assertRedacted("blocked preflight", blocked);

  writeJson("dist/ci/keda-checklist.json", kedaChecklist());
  process.env.ROMEO_API_KEY = "SECRET_PREFLIGHT_API_KEY";
  const keda = collectGaTargetPreflight({
    checklistPath: "dist/ci/keda-checklist.json",
  });
  const kedaGate = keda.gates.find(
    (gate) => gate.id === "phase21.kubernetes_keda_scaler",
  );
  if (kedaGate === undefined) {
    throw new Error("KEDA preflight gate was not returned.");
  }
  if (!kedaGate.command?.includes("pnpm smoke:kubernetes:keda")) {
    throw new Error(
      "KEDA preflight gate did not expose the KEDA smoke command.",
    );
  }
  if (
    !kedaGate.command.includes("--api-key $ROMEO_API_KEY") ||
    kedaGate.command.includes("SCOPED_ADMIN_OR_OPERATOR_KEY")
  ) {
    throw new Error("KEDA preflight command did not use checked API key env.");
  }
  if (!kedaGate.checks.some((check) => check.name === "env:ROMEO_API_KEY")) {
    throw new Error("KEDA preflight gate did not check ROMEO_API_KEY.");
  }
  assertRedacted("keda preflight", keda);

  writeJson(
    "dist/ci/browser-automation-checklist.json",
    browserAutomationChecklist(),
  );
  delete process.env.BROWSER_AUTOMATION_LIVE_EVIDENCE_REVIEWED;
  const browserAutomationBlocked = collectGaTargetPreflight({
    checklistPath: "dist/ci/browser-automation-checklist.json",
  });
  assertEqual(
    browserAutomationBlocked.status,
    "blocked",
    "blocked browser automation preflight",
  );
  assertGateCheckReason(
    browserAutomationBlocked,
    "phase31.browser_automation_live_runner",
    "browser_automation:live_review",
    "browser_automation_live_evidence_reviewed_missing",
  );
  process.env.BROWSER_AUTOMATION_LIVE_EVIDENCE_REVIEWED = "true";
  const browserAutomationReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/browser-automation-checklist.json",
  });
  assertEqual(
    browserAutomationReady.status,
    "ready",
    "ready browser automation preflight",
  );
  const browserAutomationGate = browserAutomationReady.gates.find(
    (gate) => gate.id === "phase31.browser_automation_live_runner",
  );
  if (browserAutomationGate === undefined) {
    throw new Error("Browser automation preflight gate was not returned.");
  }
  if (
    !browserAutomationGate.command?.includes(
      "pnpm evidence:browser-automation-live",
    )
  ) {
    throw new Error(
      "Browser automation preflight gate did not expose the evidence command.",
    );
  }
  if (
    !browserAutomationGate.checks.some(
      (check) => check.name === "browser_automation:live_review",
    )
  ) {
    throw new Error(
      "Browser automation preflight gate did not include live review check.",
    );
  }
  assertRedacted("browser automation preflight", browserAutomationReady);

  writeJson("dist/ci/identity-live-checklist.json", identityLiveChecklist());
  delete process.env.IDENTITY_LIVE_EVIDENCE_REVIEWED;
  const identityLiveBlocked = collectGaTargetPreflight({
    checklistPath: "dist/ci/identity-live-checklist.json",
  });
  assertEqual(
    identityLiveBlocked.status,
    "blocked",
    "blocked identity live preflight",
  );
  assertGateCheckReason(
    identityLiveBlocked,
    "phase23.identity_live",
    "identity_live:review",
    "identity_live_evidence_reviewed_missing",
  );
  process.env.IDENTITY_LIVE_EVIDENCE_REVIEWED = "true";
  const identityLiveReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/identity-live-checklist.json",
  });
  assertEqual(
    identityLiveReady.status,
    "ready",
    "ready identity live preflight",
  );
  const identityLiveGate = identityLiveReady.gates.find(
    (gate) => gate.id === "phase23.identity_live",
  );
  if (identityLiveGate === undefined) {
    throw new Error("Identity live preflight gate was not returned.");
  }
  if (!identityLiveGate.command?.includes("pnpm evidence:identity-live")) {
    throw new Error(
      "Identity live preflight gate did not expose the evidence command.",
    );
  }
  if (
    !identityLiveGate.checks.some(
      (check) => check.name === "identity_live:review",
    )
  ) {
    throw new Error(
      "Identity live preflight gate did not include live review check.",
    );
  }
  assertRedacted("identity live preflight", identityLiveReady);

  writeJson(
    "dist/ci/analytics-authz-live-checklist.json",
    analyticsAuthzLiveChecklist(),
  );
  delete process.env.ANALYTICS_AUTHZ_EVIDENCE_REVIEWED;
  const analyticsAuthzLiveBlocked = collectGaTargetPreflight({
    checklistPath: "dist/ci/analytics-authz-live-checklist.json",
  });
  assertEqual(
    analyticsAuthzLiveBlocked.status,
    "blocked",
    "blocked analytics authz live preflight",
  );
  assertGateCheckReason(
    analyticsAuthzLiveBlocked,
    "phase32.analytics_authz_live",
    "analytics_authz:live_review",
    "analytics_authz_evidence_reviewed_missing",
  );
  process.env.ANALYTICS_AUTHZ_EVIDENCE_REVIEWED = "true";
  const analyticsAuthzLiveReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/analytics-authz-live-checklist.json",
  });
  assertEqual(
    analyticsAuthzLiveReady.status,
    "ready",
    "ready analytics authz live preflight",
  );
  const analyticsAuthzLiveGate = analyticsAuthzLiveReady.gates.find(
    (gate) => gate.id === "phase32.analytics_authz_live",
  );
  if (analyticsAuthzLiveGate === undefined) {
    throw new Error("Analytics authz live preflight gate was not returned.");
  }
  if (
    !analyticsAuthzLiveGate.command?.includes(
      "pnpm evidence:analytics-authz-live",
    )
  ) {
    throw new Error(
      "Analytics authz live preflight gate did not expose the evidence command.",
    );
  }
  if (
    !analyticsAuthzLiveGate.checks.some(
      (check) => check.name === "analytics_authz:live_review",
    )
  ) {
    throw new Error(
      "Analytics authz live preflight gate did not include live review check.",
    );
  }
  assertRedacted("analytics authz live preflight", analyticsAuthzLiveReady);

  writeJson(
    "dist/ci/data-connector-live-checklist.json",
    dataConnectorLiveChecklist(),
  );
  delete process.env.DATA_CONNECTOR_LIVE_EVIDENCE_REVIEWED;
  const dataConnectorLiveBlocked = collectGaTargetPreflight({
    checklistPath: "dist/ci/data-connector-live-checklist.json",
  });
  assertEqual(
    dataConnectorLiveBlocked.status,
    "blocked",
    "blocked data connector live preflight",
  );
  assertGateCheckReason(
    dataConnectorLiveBlocked,
    "phase31.data_connector_live_worker",
    "data_connector:live_review",
    "data_connector_live_evidence_reviewed_missing",
  );
  process.env.DATA_CONNECTOR_LIVE_EVIDENCE_REVIEWED = "true";
  const dataConnectorLiveReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/data-connector-live-checklist.json",
  });
  assertEqual(
    dataConnectorLiveReady.status,
    "ready",
    "ready data connector live preflight",
  );
  const dataConnectorLiveGate = dataConnectorLiveReady.gates.find(
    (gate) => gate.id === "phase31.data_connector_live_worker",
  );
  if (dataConnectorLiveGate === undefined) {
    throw new Error("Data connector live preflight gate was not returned.");
  }
  if (
    !dataConnectorLiveGate.command?.includes(
      "pnpm evidence:data-connector-live",
    )
  ) {
    throw new Error(
      "Data connector live preflight gate did not expose the evidence command.",
    );
  }
  if (
    !dataConnectorLiveGate.checks.some(
      (check) => check.name === "data_connector:live_review",
    )
  ) {
    throw new Error(
      "Data connector live preflight gate did not include live review check.",
    );
  }
  assertRedacted("data connector live preflight", dataConnectorLiveReady);

  writeJson(
    "dist/ci/tool-dispatch-live-checklist.json",
    toolDispatchLiveChecklist(),
  );
  delete process.env.TOOL_DISPATCH_LIVE_EVIDENCE_REVIEWED;
  const toolDispatchLiveBlocked = collectGaTargetPreflight({
    checklistPath: "dist/ci/tool-dispatch-live-checklist.json",
  });
  assertEqual(
    toolDispatchLiveBlocked.status,
    "blocked",
    "blocked tool-dispatch live preflight",
  );
  assertGateCheckReason(
    toolDispatchLiveBlocked,
    "phase25.tool_dispatch_live_worker",
    "tool_dispatch:live_review",
    "tool_dispatch_live_evidence_reviewed_missing",
  );
  process.env.TOOL_DISPATCH_LIVE_EVIDENCE_REVIEWED = "true";
  const toolDispatchLiveReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/tool-dispatch-live-checklist.json",
  });
  assertEqual(
    toolDispatchLiveReady.status,
    "ready",
    "ready tool-dispatch live preflight",
  );
  const toolDispatchLiveGate = toolDispatchLiveReady.gates.find(
    (gate) => gate.id === "phase25.tool_dispatch_live_worker",
  );
  if (toolDispatchLiveGate === undefined) {
    throw new Error("Tool-dispatch live preflight gate was not returned.");
  }
  if (
    !toolDispatchLiveGate.command?.includes("pnpm evidence:tool-dispatch-live")
  ) {
    throw new Error(
      "Tool-dispatch live preflight gate did not expose the evidence command.",
    );
  }
  if (
    !toolDispatchLiveGate.checks.some(
      (check) => check.name === "tool_dispatch:live_review",
    )
  ) {
    throw new Error(
      "Tool-dispatch live preflight gate did not include live review check.",
    );
  }
  assertRedacted("tool-dispatch live preflight", toolDispatchLiveReady);

  writeJson(
    "dist/ci/data-rights-retention-live-checklist.json",
    dataRightsRetentionLiveChecklist(),
  );
  delete process.env.DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_EVIDENCE_REVIEWED;
  delete process.env.DATA_RIGHTS_BACKUP_RETENTION_EVIDENCE_REVIEWED;
  delete process.env.DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_DAYS;
  delete process.env.DATA_RIGHTS_BACKUP_RETENTION_DAYS;
  const dataRightsRetentionBlocked = collectGaTargetPreflight({
    checklistPath: "dist/ci/data-rights-retention-live-checklist.json",
  });
  assertEqual(
    dataRightsRetentionBlocked.status,
    "blocked",
    "blocked data-rights retention live preflight",
  );
  assertGateCheckReason(
    dataRightsRetentionBlocked,
    "phase33.data_rights_retention_live",
    "data_rights_retention:live_review",
    "data_rights_operational_log_retention_evidence_reviewed_missing",
  );
  process.env.DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_EVIDENCE_REVIEWED = "true";
  process.env.DATA_RIGHTS_BACKUP_RETENTION_EVIDENCE_REVIEWED = "true";
  process.env.DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_DAYS = "30";
  process.env.DATA_RIGHTS_BACKUP_RETENTION_DAYS = "90";
  const dataRightsRetentionReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/data-rights-retention-live-checklist.json",
  });
  assertEqual(
    dataRightsRetentionReady.status,
    "ready",
    "ready data-rights retention live preflight",
  );
  const dataRightsRetentionGate = dataRightsRetentionReady.gates.find(
    (gate) => gate.id === "phase33.data_rights_retention_live",
  );
  if (dataRightsRetentionGate === undefined) {
    throw new Error("Data-rights retention preflight gate was not returned.");
  }
  if (
    !dataRightsRetentionGate.command?.includes(
      "pnpm evidence:data-rights-retention",
    )
  ) {
    throw new Error(
      "Data-rights retention preflight gate did not expose the evidence command.",
    );
  }
  if (
    !dataRightsRetentionGate.checks.some(
      (check) => check.name === "data_rights_retention:live_review",
    )
  ) {
    throw new Error(
      "Data-rights retention preflight gate did not include live review check.",
    );
  }
  assertRedacted(
    "data-rights retention live preflight",
    dataRightsRetentionReady,
  );

  writeJson(
    "dist/ci/billing-operations-live-checklist.json",
    billingOperationsLiveChecklist(),
  );
  delete process.env.BILLING_OPERATIONS_EVIDENCE_REVIEWED;
  const billingOperationsBlocked = collectGaTargetPreflight({
    checklistPath: "dist/ci/billing-operations-live-checklist.json",
  });
  assertEqual(
    billingOperationsBlocked.status,
    "blocked",
    "blocked billing operations live preflight",
  );
  assertGateCheckReason(
    billingOperationsBlocked,
    "phase33.billing_operations_live",
    "billing_operations:live_review",
    "billing_operations_evidence_reviewed_missing",
  );
  process.env.BILLING_OPERATIONS_EVIDENCE_REVIEWED = "true";
  const billingOperationsReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/billing-operations-live-checklist.json",
  });
  assertEqual(
    billingOperationsReady.status,
    "ready",
    "ready billing operations live preflight",
  );
  const billingOperationsGate = billingOperationsReady.gates.find(
    (gate) => gate.id === "phase33.billing_operations_live",
  );
  if (billingOperationsGate === undefined) {
    throw new Error("Billing operations preflight gate was not returned.");
  }
  if (
    !billingOperationsGate.command?.includes("pnpm evidence:billing-operations")
  ) {
    throw new Error(
      "Billing operations preflight gate did not expose the evidence command.",
    );
  }
  if (
    !billingOperationsGate.checks.some(
      (check) => check.name === "billing_operations:live_review",
    )
  ) {
    throw new Error(
      "Billing operations preflight gate did not include live review check.",
    );
  }
  assertRedacted("billing operations live preflight", billingOperationsReady);

  writeJson(
    "dist/ci/audit-integrity-live-checklist.json",
    auditIntegrityLiveChecklist(),
  );
  delete process.env.AUDIT_INTEGRITY_EVIDENCE_REVIEWED;
  const auditIntegrityBlocked = collectGaTargetPreflight({
    checklistPath: "dist/ci/audit-integrity-live-checklist.json",
  });
  assertEqual(
    auditIntegrityBlocked.status,
    "blocked",
    "blocked audit-integrity live preflight",
  );
  assertGateCheckReason(
    auditIntegrityBlocked,
    "phase33.audit_integrity_live",
    "audit_integrity:live_review",
    "audit_integrity_evidence_reviewed_missing",
  );
  process.env.AUDIT_INTEGRITY_EVIDENCE_REVIEWED = "true";
  const auditIntegrityReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/audit-integrity-live-checklist.json",
  });
  assertEqual(
    auditIntegrityReady.status,
    "ready",
    "ready audit-integrity live preflight",
  );
  const auditIntegrityGate = auditIntegrityReady.gates.find(
    (gate) => gate.id === "phase33.audit_integrity_live",
  );
  if (auditIntegrityGate === undefined) {
    throw new Error("Audit-integrity preflight gate was not returned.");
  }
  if (!auditIntegrityGate.command?.includes("pnpm evidence:audit-integrity")) {
    throw new Error(
      "Audit-integrity preflight gate did not expose the evidence command.",
    );
  }
  if (
    !auditIntegrityGate.checks.some(
      (check) => check.name === "audit_integrity:live_review",
    )
  ) {
    throw new Error(
      "Audit-integrity preflight gate did not include live review check.",
    );
  }
  assertRedacted("audit-integrity live preflight", auditIntegrityReady);

  writeJson(
    "dist/ci/tenant-purge-live-checklist.json",
    tenantPurgeLiveChecklist(),
  );
  delete process.env.TENANT_PURGE_EVIDENCE_REVIEWED;
  const tenantPurgeBlocked = collectGaTargetPreflight({
    checklistPath: "dist/ci/tenant-purge-live-checklist.json",
  });
  assertEqual(
    tenantPurgeBlocked.status,
    "blocked",
    "blocked tenant purge live preflight",
  );
  assertGateCheckReason(
    tenantPurgeBlocked,
    "phase33.tenant_purge_live",
    "tenant_purge:live_review",
    "tenant_purge_evidence_reviewed_missing",
  );
  process.env.TENANT_PURGE_EVIDENCE_REVIEWED = "true";
  const tenantPurgeReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/tenant-purge-live-checklist.json",
  });
  assertEqual(
    tenantPurgeReady.status,
    "ready",
    "ready tenant purge live preflight",
  );
  const tenantPurgeGate = tenantPurgeReady.gates.find(
    (gate) => gate.id === "phase33.tenant_purge_live",
  );
  if (tenantPurgeGate === undefined) {
    throw new Error("Tenant purge preflight gate was not returned.");
  }
  if (!tenantPurgeGate.command?.includes("pnpm evidence:tenant-purge")) {
    throw new Error(
      "Tenant purge preflight gate did not expose the evidence command.",
    );
  }
  if (
    !tenantPurgeGate.checks.some(
      (check) => check.name === "tenant_purge:live_review",
    )
  ) {
    throw new Error(
      "Tenant purge preflight gate did not include live review check.",
    );
  }
  assertRedacted("tenant purge live preflight", tenantPurgeReady);

  writeJson(
    "dist/ci/support-bundle-live-checklist.json",
    supportBundleLiveChecklist(),
  );
  delete process.env.SUPPORT_BUNDLE_EVIDENCE_REVIEWED;
  const supportBundleBlocked = collectGaTargetPreflight({
    checklistPath: "dist/ci/support-bundle-live-checklist.json",
  });
  assertEqual(
    supportBundleBlocked.status,
    "blocked",
    "blocked support bundle live preflight",
  );
  assertGateCheckReason(
    supportBundleBlocked,
    "phase35.support_bundle_live",
    "support_bundle:live_review",
    "support_bundle_evidence_reviewed_missing",
  );
  process.env.SUPPORT_BUNDLE_EVIDENCE_REVIEWED = "true";
  const supportBundleReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/support-bundle-live-checklist.json",
  });
  assertEqual(
    supportBundleReady.status,
    "ready",
    "ready support bundle live preflight",
  );
  const supportBundleGate = supportBundleReady.gates.find(
    (gate) => gate.id === "phase35.support_bundle_live",
  );
  if (supportBundleGate === undefined) {
    throw new Error("Support bundle preflight gate was not returned.");
  }
  if (!supportBundleGate.command?.includes("pnpm support:bundle")) {
    throw new Error(
      "Support bundle preflight gate did not expose the evidence command.",
    );
  }
  if (
    !supportBundleGate.checks.some(
      (check) => check.name === "support_bundle:live_review",
    )
  ) {
    throw new Error(
      "Support bundle preflight gate did not include live review check.",
    );
  }
  assertRedacted("support bundle live preflight", supportBundleReady);

  writeJson(
    "dist/ci/ci-governance-live-checklist.json",
    ciGovernanceLiveChecklist(),
  );
  delete process.env.CI_GOVERNANCE_EVIDENCE_REVIEWED;
  delete process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_CI_RUN_ID;
  delete process.env.GITHUB_CI_HEAD_SHA;
  const ciGovernanceBlocked = collectGaTargetPreflight({
    checklistPath: "dist/ci/ci-governance-live-checklist.json",
  });
  assertEqual(
    ciGovernanceBlocked.status,
    "blocked",
    "blocked CI governance live preflight",
  );
  assertGateCheckReason(
    ciGovernanceBlocked,
    "phase22.ci_governance_live",
    "ci_governance:live_review",
    "ci_governance_evidence_reviewed_missing",
  );
  assertCiGovernancePreflightBlocked(ciGovernanceBlocked);

  process.env.CI_GOVERNANCE_EVIDENCE_REVIEWED = "true";
  process.env.GITHUB_REPOSITORY = "secret-owner/secret-repo";
  process.env.GITHUB_TOKEN = "SECRET_PREFLIGHT_GITHUB_TOKEN";
  process.env.GITHUB_CI_HEAD_SHA = "abcdef1234567890";
  const ciGovernanceReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/ci-governance-live-checklist.json",
  });
  assertEqual(
    ciGovernanceReady.status,
    "ready",
    "ready CI governance live preflight",
  );
  assertCiGovernancePreflightReady(ciGovernanceReady);
  assertRedacted("CI governance live preflight", ciGovernanceReady);

  writeJson(
    "dist/ci/target-resilience-drills-checklist.json",
    targetResilienceDrillsChecklist(),
  );
  delete process.env.PROVIDER_OUTAGE_EVIDENCE_REVIEWED;
  delete process.env.MIGRATION_DRILL_EVIDENCE_REVIEWED;
  delete process.env.NETWORK_PARTITION_EVIDENCE_REVIEWED;
  delete process.env.SECRET_ROTATION_DRILL_EVIDENCE_REVIEWED;
  const targetResilienceBlocked = collectGaTargetPreflight({
    checklistPath: "dist/ci/target-resilience-drills-checklist.json",
  });
  assertEqual(
    targetResilienceBlocked.status,
    "blocked",
    "blocked target resilience drills preflight",
  );
  assertGateCheckReason(
    targetResilienceBlocked,
    "phase34.target_resilience_drills",
    "target_resilience_drills:review",
    "provider_outage_evidence_reviewed_missing",
  );
  process.env.PROVIDER_OUTAGE_EVIDENCE_REVIEWED = "true";
  process.env.MIGRATION_DRILL_EVIDENCE_REVIEWED = "true";
  process.env.NETWORK_PARTITION_EVIDENCE_REVIEWED = "true";
  process.env.SECRET_ROTATION_DRILL_EVIDENCE_REVIEWED = "true";
  const targetResilienceReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/target-resilience-drills-checklist.json",
  });
  assertEqual(
    targetResilienceReady.status,
    "ready",
    "ready target resilience drills preflight",
  );
  const targetResilienceGate = targetResilienceReady.gates.find(
    (gate) => gate.id === "phase34.target_resilience_drills",
  );
  if (targetResilienceGate === undefined) {
    throw new Error(
      "Target resilience drills preflight gate was not returned.",
    );
  }
  if (
    !targetResilienceGate.command?.includes("pnpm evidence:provider-outage") ||
    !targetResilienceGate.command?.includes("pnpm evidence:migration-drill") ||
    !targetResilienceGate.command?.includes(
      "pnpm evidence:network-partition",
    ) ||
    !targetResilienceGate.command?.includes(
      "pnpm evidence:secret-rotation-drill",
    )
  ) {
    throw new Error(
      "Target resilience drills preflight gate did not expose every evidence command.",
    );
  }
  if (
    !targetResilienceGate.checks.some(
      (check) => check.name === "target_resilience_drills:review",
    )
  ) {
    throw new Error(
      "Target resilience drills preflight gate did not include live review check.",
    );
  }
  assertRedacted("target resilience drills preflight", targetResilienceReady);

  writeJson(
    "dist/ci/postgres-operations-checklist.json",
    postgresOperationsChecklist(),
  );
  installFakePsql();
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_OPERATIONAL_TARGET_TIER;
  delete process.env.POSTGRES_OPERATIONAL_MODE;
  delete process.env.POSTGRES_TELEMETRY_WINDOW_MINUTES;
  delete process.env.POSTGRES_SLOW_QUERY_THRESHOLD_MS;
  delete process.env.POSTGRES_MAX_BLOCKED_SESSIONS;
  delete process.env.POSTGRES_MAX_DEADLOCKS;
  delete process.env.POSTGRES_ARCHIVAL_DECISION;
  const postgresOperationsBlocked = collectGaTargetPreflight({
    checklistPath: "dist/ci/postgres-operations-checklist.json",
  });
  assertEqual(
    postgresOperationsBlocked.status,
    "blocked",
    "blocked Postgres operations preflight",
  );
  assertGateCheckReason(
    postgresOperationsBlocked,
    "phase34.postgres_operations_live",
    "postgres_operations:target",
    "target_tier_missing",
  );
  assertRedacted(
    "blocked Postgres operations preflight",
    postgresOperationsBlocked,
  );

  setReadyPostgresOperationsEnv();
  const postgresOperationsReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/postgres-operations-checklist.json",
  });
  assertEqual(
    postgresOperationsReady.status,
    "ready",
    "ready Postgres operations preflight",
  );
  assertPostgresOperationsPreflightReady(postgresOperationsReady);
  assertRedacted(
    "ready Postgres operations preflight",
    postgresOperationsReady,
  );

  process.env.DATABASE_URL =
    "postgres://romeo:SECRET_POSTGRES_PASSWORD@db.example.com:5432/romeo?sslmode=require";
  const postgresOperationsWeakTls = collectGaTargetPreflight({
    checklistPath: "dist/ci/postgres-operations-checklist.json",
  });
  assertEqual(
    postgresOperationsWeakTls.status,
    "blocked",
    "weak-TLS Postgres operations preflight",
  );
  assertGateCheckReason(
    postgresOperationsWeakTls,
    "phase34.postgres_operations_live",
    "postgres_operations:target",
    "hosted_tls_verify_full_required",
  );
  assertRedacted(
    "weak-TLS Postgres operations preflight",
    postgresOperationsWeakTls,
  );
  setReadyPostgresOperationsEnv();

  writeJson("dist/ci/qdrant-checklist.json", qdrantChecklist());
  process.env.SOURCE_QDRANT_URL =
    "https://source-qdrant.example.com/collections?token=token-query-sentinel";
  process.env.SOURCE_QDRANT_COLLECTION = "SECRET_SOURCE_QDRANT_COLLECTION";
  process.env.SOURCE_QDRANT_API_KEY = "SECRET_SOURCE_QDRANT_API_KEY";
  process.env.RESTORE_QDRANT_URL = "https://restore-qdrant.example.com";
  process.env.RESTORE_QDRANT_COLLECTION = "SECRET_RESTORE_QDRANT_COLLECTION";
  process.env.RESTORE_QDRANT_API_KEY = "SECRET_RESTORE_QDRANT_API_KEY";
  process.env.QDRANT_DR_RUN_SECRET = "SECRET_QDRANT_DR_RUN_SECRET_0123456789";
  process.env.VECTOR_NAMESPACE_POLICY = "org";
  process.env.VECTOR_PARTITIONING_POLICY = "workspace";
  const qdrantBlocked = collectGaTargetPreflight({
    checklistPath: "dist/ci/qdrant-checklist.json",
  });
  assertEqual(qdrantBlocked.status, "blocked", "blocked Qdrant preflight");
  const blockedQdrantGate = qdrantGate(qdrantBlocked);
  if (
    !blockedQdrantGate.checks.some(
      (check) =>
        check.name === "qdrant_dr:source" &&
        check.reason === "url_contains_unsafe_parts",
    )
  ) {
    throw new Error("Qdrant preflight did not reject unsafe source URL.");
  }
  assertRedacted("blocked qdrant preflight", qdrantBlocked);

  process.env.SOURCE_QDRANT_URL = "https://source-qdrant.example.com";
  const qdrantReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/qdrant-checklist.json",
  });
  assertEqual(qdrantReady.status, "ready", "ready Qdrant preflight");
  const readyQdrantGate = qdrantGate(qdrantReady);
  if (
    !readyQdrantGate.command?.includes("pnpm smoke:qdrant:dr") ||
    !readyQdrantGate.command.includes("--phase prepare-source") ||
    !readyQdrantGate.command.includes("--phase verify-restore") ||
    !readyQdrantGate.command.includes("--phase cleanup-source") ||
    !readyQdrantGate.command.includes("--api-key $SOURCE_QDRANT_API_KEY") ||
    !readyQdrantGate.command.includes("--api-key $RESTORE_QDRANT_API_KEY") ||
    !readyQdrantGate.command.includes("--run-secret $QDRANT_DR_RUN_SECRET") ||
    !readyQdrantGate.command.includes(
      "--source-evidence dist/ci/qdrant-dr-source.json",
    ) ||
    !readyQdrantGate.command.includes(
      "--output dist/ci/qdrant-dr-source-cleanup.json",
    )
  ) {
    throw new Error(
      "Qdrant preflight gate did not expose the runnable three-phase Qdrant DR commands.",
    );
  }
  if (
    readyQdrantGate.command.includes("then verify-restore") ||
    readyQdrantGate.command.includes("QDRANT_DR_RUN_SECRET=") ||
    readyQdrantGate.command.includes("SOURCE_QDRANT_API_KEY=") ||
    readyQdrantGate.command.includes("RESTORE_QDRANT_API_KEY=")
  ) {
    throw new Error(
      "Qdrant preflight gate used a placeholder or env-prefix secret handoff.",
    );
  }
  for (const name of [
    "env:QDRANT_DR_RUN_SECRET",
    "env:VECTOR_NAMESPACE_POLICY",
    "env:VECTOR_PARTITIONING_POLICY",
    "qdrant_dr:source",
    "qdrant_dr:restore",
    "qdrant_dr:run_secret",
    "qdrant_dr:namespace_policy",
  ]) {
    if (!readyQdrantGate.checks.some((check) => check.name === name)) {
      throw new Error(`Qdrant preflight gate did not check ${name}.`);
    }
  }
  assertRedacted("ready qdrant preflight", qdrantReady);

  delete process.env.VECTOR_PARTITIONING_POLICY;
  const qdrantMissingPartitioningPolicy = collectGaTargetPreflight({
    checklistPath: "dist/ci/qdrant-checklist.json",
  });
  assertEqual(
    qdrantMissingPartitioningPolicy.status,
    "blocked",
    "missing-partitioning-policy Qdrant preflight",
  );
  assertGateCheckReason(
    qdrantMissingPartitioningPolicy,
    "phase32.qdrant_dr_consistency",
    "qdrant_dr:namespace_policy",
    "partitioning_policy_missing",
  );
  assertRedacted(
    "missing-partitioning-policy Qdrant preflight",
    qdrantMissingPartitioningPolicy,
  );
  process.env.VECTOR_PARTITIONING_POLICY = "workspace";

  writeJson("dist/ci/qdrant-live-checklist.json", qdrantLiveChecklist());
  process.env.QDRANT_LIVE_EVIDENCE_REVIEWED = "true";
  process.env.QDRANT_URL =
    "https://live-qdrant.example.com/collections?token=token-query-sentinel";
  process.env.QDRANT_COLLECTION = "SECRET_QDRANT_LIVE_COLLECTION";
  process.env.QDRANT_API_KEY = "SECRET_QDRANT_LIVE_API_KEY";
  process.env.VECTOR_NAMESPACE_POLICY = "org";
  process.env.VECTOR_PARTITIONING_POLICY = "workspace";
  const qdrantLiveBlocked = collectGaTargetPreflight({
    checklistPath: "dist/ci/qdrant-live-checklist.json",
  });
  assertEqual(
    qdrantLiveBlocked.status,
    "blocked",
    "blocked Qdrant live preflight",
  );
  const blockedQdrantLiveGate = qdrantLiveGate(qdrantLiveBlocked);
  if (
    !blockedQdrantLiveGate.checks.some(
      (check) =>
        check.name === "qdrant_live:target" &&
        check.reason === "url_contains_unsafe_parts",
    )
  ) {
    throw new Error("Qdrant live preflight did not reject unsafe target URL.");
  }
  assertRedacted("blocked qdrant live preflight", qdrantLiveBlocked);

  process.env.QDRANT_URL = "https://live-qdrant.example.com";
  const qdrantLiveReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/qdrant-live-checklist.json",
  });
  assertEqual(qdrantLiveReady.status, "ready", "ready Qdrant live preflight");
  const readyQdrantLiveGate = qdrantLiveGate(qdrantLiveReady);
  if (
    !readyQdrantLiveGate.command?.includes("pnpm smoke:qdrant:live") ||
    !readyQdrantLiveGate.command.includes("--api-key $QDRANT_API_KEY") ||
    !readyQdrantLiveGate.command.includes("--confirm-mutation") ||
    !readyQdrantLiveGate.command.includes(
      "--namespace-policy $VECTOR_NAMESPACE_POLICY",
    ) ||
    !readyQdrantLiveGate.command.includes(
      "--partitioning-policy $VECTOR_PARTITIONING_POLICY",
    )
  ) {
    throw new Error(
      "Qdrant live preflight gate did not expose the live evidence command.",
    );
  }
  if (readyQdrantLiveGate.command.includes("QDRANT_API_KEY=")) {
    throw new Error(
      "Qdrant live preflight gate used env-prefix API-key handoff.",
    );
  }
  for (const name of [
    "qdrant_live:review",
    "qdrant_live:target",
    "qdrant_live:credentials",
    "qdrant_live:namespace_policy",
  ]) {
    if (!readyQdrantLiveGate.checks.some((check) => check.name === name)) {
      throw new Error(`Qdrant live preflight gate did not check ${name}.`);
    }
  }
  assertRedacted("ready qdrant live preflight", qdrantLiveReady);

  process.env.VECTOR_NAMESPACE_POLICY = "none";
  const qdrantLiveNoNamespace = collectGaTargetPreflight({
    checklistPath: "dist/ci/qdrant-live-checklist.json",
  });
  assertEqual(
    qdrantLiveNoNamespace.status,
    "blocked",
    "namespace-less Qdrant live preflight",
  );
  assertGateCheckReason(
    qdrantLiveNoNamespace,
    "phase32.qdrant_live_evidence",
    "qdrant_live:namespace_policy",
    "namespace_policy_none",
  );
  assertRedacted("namespace-less qdrant live preflight", qdrantLiveNoNamespace);
  process.env.VECTOR_NAMESPACE_POLICY = "org";

  installFakeKubectl();
  process.env.ROMEO_API_KEY = "SECRET_PREFLIGHT_API_KEY";
  process.env.ROMEO_NAMESPACE = "romeo";
  setReadyLiveSmokeEnv();
  writeJson("dist/ci/kubernetes-live-checklist.json", liveSmokeChecklist());
  const liveSmokeReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/kubernetes-live-checklist.json",
  });
  assertEqual(
    liveSmokeReady.status,
    "ready",
    "ready Kubernetes live-smoke preflight",
  );
  assertLiveSmokePreflightReady(liveSmokeReady);
  assertRedacted("ready Kubernetes live-smoke preflight", liveSmokeReady);

  process.env.KUBERNETES_LIVE_SMOKE_SKIP_BUILD = "false";
  const liveSmokeMissingSkipBuild = collectGaTargetPreflight({
    checklistPath: "dist/ci/kubernetes-live-checklist.json",
  });
  assertEqual(
    liveSmokeMissingSkipBuild.status,
    "blocked",
    "missing skip-build live-smoke preflight",
  );
  assertGateCheckReason(
    liveSmokeMissingSkipBuild,
    "phase21.kubernetes_live_smoke",
    "kubernetes_live_smoke:plan",
    "kubernetes_live_smoke_skip_build_not_true",
  );
  assertRedacted(
    "missing skip-build live-smoke preflight",
    liveSmokeMissingSkipBuild,
  );

  setReadyLiveSmokeEnv();
  process.env.KUBERNETES_LIVE_SMOKE_APP_IMAGE = `registry.example.com/romeo/app:latest@sha256:${"f".repeat(64)}`;
  const liveSmokeMutableAppImage = collectGaTargetPreflight({
    checklistPath: "dist/ci/kubernetes-live-checklist.json",
  });
  assertEqual(
    liveSmokeMutableAppImage.status,
    "blocked",
    "mutable app image live-smoke preflight",
  );
  assertGateCheckReason(
    liveSmokeMutableAppImage,
    "phase21.kubernetes_live_smoke",
    "kubernetes_live_smoke:plan",
    "app_image_latest_tag_rejected",
  );
  assertRedacted(
    "mutable app image live-smoke preflight",
    liveSmokeMutableAppImage,
  );

  setReadyLiveSmokeEnv();
  process.env.KUBERNETES_LIVE_SMOKE_APP_IMAGE =
    "registry.example.com/romeo/app:1.2.3";
  const liveSmokeTagOnlyAppImage = collectGaTargetPreflight({
    checklistPath: "dist/ci/kubernetes-live-checklist.json",
  });
  assertEqual(
    liveSmokeTagOnlyAppImage.status,
    "blocked",
    "tag-only app image live-smoke preflight",
  );
  assertGateCheckReason(
    liveSmokeTagOnlyAppImage,
    "phase21.kubernetes_live_smoke",
    "kubernetes_live_smoke:plan",
    "app_image_digest_pin_required",
  );
  assertRedacted(
    "tag-only app image live-smoke preflight",
    liveSmokeTagOnlyAppImage,
  );
  setReadyLiveSmokeEnv();

  setReadyNetworkPolicyEnv();
  setReadyLoadSoakEnv();
  writeJson(
    "dist/ci/kubernetes-networkpolicy-checklist.json",
    networkPolicyChecklist(),
  );
  const networkPolicyReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/kubernetes-networkpolicy-checklist.json",
  });
  assertEqual(
    networkPolicyReady.status,
    "ready",
    "ready Kubernetes NetworkPolicy preflight",
  );
  assertNetworkPolicyPreflightReady(networkPolicyReady);
  assertRedacted(
    "ready Kubernetes NetworkPolicy preflight",
    networkPolicyReady,
  );

  process.env.KUBERNETES_NETWORKPOLICY_CONFIRM_CNI_ENFORCEMENT = "false";
  const networkPolicyMissingCniConfirmation = collectGaTargetPreflight({
    checklistPath: "dist/ci/kubernetes-networkpolicy-checklist.json",
  });
  assertEqual(
    networkPolicyMissingCniConfirmation.status,
    "blocked",
    "missing CNI confirmation NetworkPolicy preflight",
  );
  assertGateCheckReason(
    networkPolicyMissingCniConfirmation,
    "phase21.kubernetes_networkpolicy_enforcement",
    "kubernetes_networkpolicy:cni_confirmation",
    "networkpolicy_cni_enforcement_not_true",
  );
  assertRedacted(
    "missing CNI confirmation NetworkPolicy preflight",
    networkPolicyMissingCniConfirmation,
  );

  setReadyNetworkPolicyEnv();
  process.env.KUBERNETES_NETWORKPOLICY_CLIENT_IMAGE =
    "registry.example.com/romeo/curl:latest";
  const networkPolicyMutableImage = collectGaTargetPreflight({
    checklistPath: "dist/ci/kubernetes-networkpolicy-checklist.json",
  });
  assertEqual(
    networkPolicyMutableImage.status,
    "blocked",
    "mutable image NetworkPolicy preflight",
  );
  assertGateCheckReason(
    networkPolicyMutableImage,
    "phase21.kubernetes_networkpolicy_enforcement",
    "kubernetes_networkpolicy:images",
    "client_image_latest_tag_rejected",
  );
  assertRedacted(
    "mutable image NetworkPolicy preflight",
    networkPolicyMutableImage,
  );
  setReadyNetworkPolicyEnv();

  writeJson("dist/ci/kubernetes-load-soak-checklist.json", loadSoakChecklist());
  const loadSoakReady = collectGaTargetPreflight({
    checklistPath: "dist/ci/kubernetes-load-soak-checklist.json",
  });
  assertEqual(loadSoakReady.status, "ready", "ready load/soak preflight");
  assertLoadSoakPreflightReady(loadSoakReady);
  assertRedacted("ready load/soak preflight", loadSoakReady);

  process.env.KUBERNETES_LOAD_SOAK_TIER = "local";
  const loadSoakLocalTier = collectGaTargetPreflight({
    checklistPath: "dist/ci/kubernetes-load-soak-checklist.json",
  });
  assertEqual(
    loadSoakLocalTier.status,
    "blocked",
    "local-tier load/soak preflight",
  );
  assertGateCheckReason(
    loadSoakLocalTier,
    "phase34.kubernetes_load_soak",
    "kubernetes_load_soak:parameters",
    "tier_not_ga_scale",
  );
  assertRedacted("local-tier load/soak preflight", loadSoakLocalTier);

  setReadyLoadSoakEnv();
  process.env.KUBERNETES_LOAD_SOAK_SOAK_SECONDS = "0";
  const loadSoakShortDuration = collectGaTargetPreflight({
    checklistPath: "dist/ci/kubernetes-load-soak-checklist.json",
  });
  assertEqual(
    loadSoakShortDuration.status,
    "blocked",
    "short-duration load/soak preflight",
  );
  assertGateCheckReason(
    loadSoakShortDuration,
    "phase34.kubernetes_load_soak",
    "kubernetes_load_soak:parameters",
    "load_soak_soak_seconds_out_of_bounds",
  );
  assertRedacted("short-duration load/soak preflight", loadSoakShortDuration);
  setReadyLoadSoakEnv();

  process.env.KUBERNETES_DR_PLAN_FILE = "dist/ci/kubernetes-dr-plan.json";
  process.env.KUBERNETES_DR_SKIP_BUILD = "true";
  process.env.KUBERNETES_DR_APP_IMAGE = `registry.example.com/romeo/app:1.2.3@sha256:${"f".repeat(64)}`;
  writeJson("dist/ci/kubernetes-dr-checklist.json", {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [kubernetesGate("phase21.kubernetes_dr_modes", "21")],
  });
  const kubernetesDr = collectGaTargetPreflight({
    checklistPath: "dist/ci/kubernetes-dr-checklist.json",
  });
  assertEqual(kubernetesDr.status, "ready", "ready Kubernetes DR preflight");
  assertKubernetesDrPreflightReady(kubernetesDr);
  assertRedacted("ready Kubernetes DR preflight", kubernetesDr);

  writeJson("dist/ci/kubernetes-existing-release-checklist.json", {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 3, satisfied: 0, total: 3 },
    gates: [
      kubernetesGate("phase25.kubernetes_workers_smoke", "25"),
      kubernetesGate("phase32.kubernetes_tiered_rag_smoke", "32"),
      kubernetesGate("phase34.kubernetes_load_soak", "34"),
    ],
  });
  const kubernetesExistingRelease = collectGaTargetPreflight({
    checklistPath: "dist/ci/kubernetes-existing-release-checklist.json",
  });
  assertEqual(
    kubernetesExistingRelease.status,
    "ready",
    "ready Kubernetes existing-release preflight",
  );
  assertEqual(
    kubernetesExistingRelease.summary.ready,
    3,
    "ready Kubernetes existing-release gate count",
  );
  for (const gate of kubernetesExistingRelease.gates) {
    assertCommandUsesCheckedRomeoApiKey(gate);
    for (const name of [
      "kubernetes_namespace:romeo",
      "kubernetes_app_deployment:romeo:romeo",
      "kubernetes_app_service:romeo:romeo",
    ]) {
      if (!gate.checks.some((check) => check.name === name)) {
        throw new Error(`${gate.id} preflight did not include ${name} check.`);
      }
    }
  }
  assertRedacted(
    "ready Kubernetes existing-release preflight",
    kubernetesExistingRelease,
  );

  process.env.ROMEO_NAMESPACE = "romeo-prod";
  process.env.ROMEO_RELEASE_NAME = "platform";
  delete process.env.ROMEO_SERVICE_NAME;
  delete process.env.ROMEO_DEPLOYMENT_NAME;
  process.env.KEDA_NAMESPACE = "keda-prod";
  process.env.KEDA_SCALEDJOB_NAME = "platform-webhook-retry";
  process.env.KEDA_TRIGGERAUTHENTICATION_NAME = "platform-webhook-retry-pg";
  writeJson("dist/ci/kubernetes-custom-release-checklist.json", {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 2, satisfied: 0, total: 2 },
    gates: [
      kubernetesGate("phase25.kubernetes_workers_smoke", "25"),
      kubernetesGate("phase21.kubernetes_keda_scaler", "21"),
    ],
  });
  const customKubernetesRelease = collectGaTargetPreflight({
    checklistPath: "dist/ci/kubernetes-custom-release-checklist.json",
  });
  assertEqual(
    customKubernetesRelease.status,
    "ready",
    "ready custom Kubernetes release preflight",
  );
  const customWorkerGate = customKubernetesRelease.gates.find(
    (gate) => gate.id === "phase25.kubernetes_workers_smoke",
  );
  for (const name of [
    "kubernetes_namespace:romeo-prod",
    "kubernetes_app_deployment:platform-romeo:romeo-prod",
    "kubernetes_app_service:platform-romeo:romeo-prod",
  ]) {
    if (!customWorkerGate?.checks.some((check) => check.name === name)) {
      throw new Error(`Custom release preflight did not include ${name}.`);
    }
  }
  const customKedaGate = customKubernetesRelease.gates.find(
    (gate) => gate.id === "phase21.kubernetes_keda_scaler",
  );
  for (const name of [
    "keda_namespace:keda-prod",
    "kubernetes_app_service:platform-romeo:romeo-prod",
    "keda_scaledjob:platform-webhook-retry:romeo-prod",
    "keda_triggerauthentication:platform-webhook-retry-pg:romeo-prod",
  ]) {
    if (!customKedaGate?.checks.some((check) => check.name === name)) {
      throw new Error(`Custom KEDA preflight did not include ${name}.`);
    }
  }
  if (
    !customWorkerGate.command.includes("--api-key $ROMEO_API_KEY") ||
    !customWorkerGate?.command?.includes("--namespace romeo-prod") ||
    !customWorkerGate.command.includes("--release-name platform") ||
    !customWorkerGate.command.includes("--service platform-romeo")
  ) {
    throw new Error("Custom worker preflight command did not use overrides.");
  }
  assertRedacted(
    "custom Kubernetes release preflight",
    customKubernetesRelease,
  );

  writeEvidence({
    schemaVersion: "romeo.ga-target-preflight-contract-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    checks: [
      "ready_target_quality_and_release_readback_preflight",
      "release_readback_preflight_requires_complete_plan",
      "target_quality_preflight_requires_replay_and_agent_inputs",
      "unsafe_target_and_prometheus_urls_blocked",
      "alert_firing_preflight_requires_defined_provider_queue_backup_alerts",
      "alert_firing_preflight_rejects_unsafe_alertmanager_url",
      "edge_preflight_requires_admin_waf_body_rate_inputs",
      "edge_preflight_rejects_missing_waf_block_mode",
      "edge_preflight_rejects_ga_incompatible_statuses",
      "edge_preflight_rejects_unsafe_probe_paths",
      "networkpolicy_preflight_requires_cni_confirmation_and_pinned_images",
      "networkpolicy_preflight_rejects_missing_cni_confirmation",
      "networkpolicy_preflight_rejects_mutable_probe_images",
      "load_soak_preflight_requires_ga_tier_repeated_runs_and_duration",
      "load_soak_preflight_rejects_local_tier",
      "load_soak_preflight_rejects_short_duration",
      "kubernetes_live_preflight_requires_reviewed_images_and_skip_build",
      "kubernetes_live_preflight_rejects_missing_skip_build",
      "kubernetes_live_preflight_rejects_mutable_app_image",
      "kubernetes_live_preflight_rejects_tag_without_digest",
      "blocked_missing_target_and_release_inputs_preflight",
      "keda_required_preflight_maps_to_keda_smoke",
      "browser_automation_required_preflight_maps_to_live_evidence",
      "identity_live_required_preflight_maps_to_live_evidence",
      "analytics_authz_live_required_preflight_maps_to_live_evidence",
      "tool_dispatch_required_preflight_maps_to_live_evidence",
      "billing_operations_required_preflight_maps_to_live_evidence",
      "tenant_purge_required_preflight_maps_to_live_evidence",
      "support_bundle_required_preflight_maps_to_live_evidence",
      "ci_governance_live_required_preflight_maps_to_live_evidence",
      "postgres_operations_required_preflight_maps_to_live_evidence",
      "postgres_operations_preflight_requires_verify_full_for_hosted_postgres",
      "qdrant_dr_required_preflight_maps_to_three_phase_smoke",
      "qdrant_dr_preflight_emits_runnable_three_phase_commands",
      "qdrant_dr_preflight_requires_explicit_namespace_partition_policy",
      "qdrant_live_preflight_uses_checked_api_key_argument",
      "qdrant_dr_preflight_rejects_unsafe_url",
      "qdrant_dr_preflight_redacts_target_secrets",
      "kubernetes_dr_preflight_requires_both_modes_and_cloudnativepg_secrets",
      "kubernetes_existing_release_preflight_checks_namespace_deployment_service",
      "kubernetes_preflight_honors_release_and_resource_overrides",
      "target_preflight_commands_use_checked_romeo_api_key",
      "unsafe_evidence_paths_redacted",
      "raw_environment_values_redacted",
      "query_values_redacted_from_origins",
    ],
    ready: evidenceSummary(ready),
    missingReleasePlan: evidenceSummary(missingReleasePlan),
    unsafeTargetUrl: evidenceSummary(unsafeTargetUrl),
    unsafePrometheusUrl: evidenceSummary(unsafePrometheusUrl),
    alertDefaultReady: evidenceSummary(alertDefaultReady),
    alertMissingCategory: evidenceSummary(alertMissingCategory),
    unsafeAlertmanagerUrl: evidenceSummary(unsafeAlertmanagerUrl),
    edge: {
      ready: evidenceSummary(edgeReady),
      missingWafBlockMode: evidenceSummary(edgeMissingWafBlockMode),
      badWafStatuses: evidenceSummary(edgeBadWafStatuses),
      unsafeProbePath: evidenceSummary(edgeUnsafeProbePath),
    },
    targetQualityVectorComparison: {
      blocked: evidenceSummary(vectorComparisonBlocked),
      ready: evidenceSummary(vectorComparisonReady),
    },
    missingReplay: evidenceSummary(missingReplay),
    blocked: evidenceSummary(blocked),
    keda: evidenceSummary(keda),
    browserAutomation: {
      blocked: evidenceSummary(browserAutomationBlocked),
      ready: evidenceSummary(browserAutomationReady),
    },
    identityLive: {
      blocked: evidenceSummary(identityLiveBlocked),
      ready: evidenceSummary(identityLiveReady),
    },
    analyticsAuthzLive: {
      blocked: evidenceSummary(analyticsAuthzLiveBlocked),
      ready: evidenceSummary(analyticsAuthzLiveReady),
    },
    dataConnectorLive: {
      blocked: evidenceSummary(dataConnectorLiveBlocked),
      ready: evidenceSummary(dataConnectorLiveReady),
    },
    toolDispatchLive: {
      blocked: evidenceSummary(toolDispatchLiveBlocked),
      ready: evidenceSummary(toolDispatchLiveReady),
    },
    billingOperationsLive: {
      blocked: evidenceSummary(billingOperationsBlocked),
      ready: evidenceSummary(billingOperationsReady),
    },
    auditIntegrityLive: {
      blocked: evidenceSummary(auditIntegrityBlocked),
      ready: evidenceSummary(auditIntegrityReady),
    },
    tenantPurgeLive: {
      blocked: evidenceSummary(tenantPurgeBlocked),
      ready: evidenceSummary(tenantPurgeReady),
    },
    supportBundleLive: {
      blocked: evidenceSummary(supportBundleBlocked),
      ready: evidenceSummary(supportBundleReady),
    },
    ciGovernanceLive: {
      blocked: evidenceSummary(ciGovernanceBlocked),
      ready: evidenceSummary(ciGovernanceReady),
    },
    postgresOperations: {
      blocked: evidenceSummary(postgresOperationsBlocked),
      ready: evidenceSummary(postgresOperationsReady),
      weakTls: evidenceSummary(postgresOperationsWeakTls),
    },
    qdrant: {
      blocked: evidenceSummary(qdrantBlocked),
      ready: evidenceSummary(qdrantReady),
    },
    networkPolicy: {
      ready: evidenceSummary(networkPolicyReady),
      missingCniConfirmation: evidenceSummary(
        networkPolicyMissingCniConfirmation,
      ),
      mutableImage: evidenceSummary(networkPolicyMutableImage),
    },
    loadSoak: {
      ready: evidenceSummary(loadSoakReady),
      localTier: evidenceSummary(loadSoakLocalTier),
      shortDuration: evidenceSummary(loadSoakShortDuration),
    },
    liveSmoke: {
      ready: evidenceSummary(liveSmokeReady),
      missingSkipBuild: evidenceSummary(liveSmokeMissingSkipBuild),
      mutableAppImage: evidenceSummary(liveSmokeMutableAppImage),
    },
    kubernetesDr: evidenceSummary(kubernetesDr),
    kubernetesExistingRelease: evidenceSummary(kubernetesExistingRelease),
    customKubernetesRelease: evidenceSummary(customKubernetesRelease),
    redaction: {
      commandOutputReturned: false,
      rawEnvironmentValuesReturned: false,
      rawTokensReturned: false,
      unsafeAbsoluteEvidencePathsReturned: false,
    },
  });
} finally {
  process.chdir(originalCwd);
  restoreEnv();
  rmSync(tempDir, { force: true, recursive: true });
}

function checklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 2, satisfied: 0, total: 2 },
    gates: [
      {
        id: "phase22.credentialed_release_readback",
        phase: "22",
        title: "Credentialed release publish and readback",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          { path: "/tmp/raw-release-readback.json", status: "missing" },
        ],
      },
      {
        id: "phase32.target_quality_evidence",
        phase: "32",
        title: "Target-deployment quality evidence",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: false,
        evidence: [
          { path: "../unsafe-target-quality-evidence.json", status: "missing" },
        ],
      },
    ],
  };
}

function releaseReadbackPlan() {
  const imageDigest = "a".repeat(64);
  const chartDigest = "b".repeat(64);
  const assetDigest = "c".repeat(64);
  const assetNames = [
    "release-channel",
    "security-evidence",
    "sbom",
    "provenance",
    "approval",
  ];
  return {
    schemaVersion: "romeo.release-readback-plan.v1",
    helm: {
      repositoryUrl: "https://charts.example.com/romeo/",
    },
    images: [
      {
        readback: `registry.example.com/romeo/app:1.2.3@sha256:${imageDigest}`,
        required: "registry.example.com/romeo/app:1.2.3",
      },
    ],
    charts: [
      {
        readback: `romeo:1.2.3@sha256:${chartDigest}`,
        required: "romeo:1.2.3",
      },
    ],
    assets: assetNames.map((name) => ({
      readback: `${name}=https://releases.example.com/SECRET_RELEASE_ASSET_PATH/${name}.json@sha256:${assetDigest}`,
      required: `${name}@sha256:${assetDigest}`,
    })),
  };
}

function kubernetesDrPlan() {
  return {
    schemaVersion: "romeo.kubernetes-dr-plan.v1",
    modes: {
      "external-postgres": {
        sourceNamespace: "romeo-dr-source",
        restoreNamespace: "romeo-dr-restore",
        releaseName: "dr-external",
        image: "registry.example.com/romeo/app:1.2.3",
      },
      cloudnativepg: {
        sourceNamespace: "romeo-cnpg-source",
        restoreNamespace: "romeo-cnpg-restore",
        releaseName: "dr-cnpg",
        image: "registry.example.com/romeo/app:1.2.3",
        sourceDatabaseUrlSecret:
          "secret-kubernetes-dr-source-secret:DATABASE_URL",
        restoreDatabaseUrlSecret:
          "secret-kubernetes-dr-restore-secret:DATABASE_URL",
      },
    },
  };
}

function prometheusRuleFixture() {
  return `apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: romeo-operational-alerts
spec:
  groups:
    - name: romeo
      rules:
        - alert: RomeoProviderCircuitOpen
          expr: vector(1)
          labels:
            severity: warning
        - alert: RomeoBackgroundJobQueuedLag
          expr: vector(1)
          labels:
            severity: warning
        - alert: RomeoBackgroundJobDeadLetters
          expr: vector(1)
          labels:
            severity: critical
        - alert: RomeoPostgresBackupJobFailed
          expr: vector(1)
          labels:
            severity: critical
`;
}

function kedaChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase21.kubernetes_keda_scaler",
        phase: "21",
        title: "Kubernetes KEDA webhook-retry scaler evidence",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: false,
        evidence: [
          { path: "dist/ci/kubernetes-keda-smoke.json", status: "missing" },
        ],
      },
    ],
  };
}

function browserAutomationChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase31.browser_automation_live_runner",
        phase: "31",
        title: "Live browser automation runner and sandbox evidence",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          {
            path: "dist/ci/browser-automation-live-evidence.json",
            status: "missing",
          },
        ],
      },
    ],
  };
}

function identityLiveChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase23.identity_live",
        phase: "23",
        title:
          "Target enterprise identity, directory, and access-review evidence",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          {
            path: "dist/ci/identity-live-evidence.json",
            status: "missing",
          },
        ],
      },
    ],
  };
}

function analyticsAuthzLiveChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase32.analytics_authz_live",
        phase: "32",
        title: "Target analytics authorization and export evidence",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          {
            path: "dist/ci/analytics-authz-live-evidence.json",
            status: "missing",
          },
        ],
      },
    ],
  };
}

function dataConnectorLiveChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase31.data_connector_live_worker",
        phase: "31",
        title: "Live outbound data connector worker and CNI evidence",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          {
            path: "dist/ci/data-connector-live-evidence.json",
            status: "missing",
          },
        ],
      },
    ],
  };
}

function toolDispatchLiveChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase25.tool_dispatch_live_worker",
        phase: "25",
        title: "Live tool-dispatch worker and egress evidence",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          {
            path: "dist/ci/tool-dispatch-live-evidence.json",
            status: "missing",
          },
        ],
      },
    ],
  };
}

function dataRightsRetentionLiveChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase33.data_rights_retention_live",
        phase: "33",
        title: "Target data-rights retention evidence",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          {
            path: "dist/ci/data-rights-operational-log-retention-evidence.json",
            status: "missing",
          },
          {
            path: "dist/ci/data-rights-backup-retention-evidence.json",
            status: "missing",
          },
        ],
      },
    ],
  };
}

function billingOperationsLiveChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase33.billing_operations_live",
        phase: "33",
        title: "Target billing operations worker cadence and alerting",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          {
            path: "dist/ci/billing-operations-evidence.json",
            status: "missing",
          },
        ],
      },
    ],
  };
}

function auditIntegrityLiveChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase33.audit_integrity_live",
        phase: "33",
        title: "Target audit integrity, SIEM export, and WORM evidence",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          {
            path: "dist/ci/audit-integrity-evidence.json",
            status: "missing",
          },
        ],
      },
    ],
  };
}

function tenantPurgeLiveChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase33.tenant_purge_live",
        phase: "33",
        title: "Target tenant purge and external storage-class evidence",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          {
            path: "dist/ci/tenant-purge-evidence.json",
            status: "missing",
          },
        ],
      },
    ],
  };
}

function supportBundleLiveChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase35.support_bundle_live",
        phase: "35",
        title: "Target support bundle evidence",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          {
            path: "dist/ci/support-bundle.json",
            status: "missing",
          },
        ],
      },
    ],
  };
}

function ciGovernanceLiveChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase22.ci_governance_live",
        phase: "22",
        title: "Hosted CI and branch-protection governance evidence",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          {
            path: "dist/ci/branch-protection-plan.json",
            status: "missing",
          },
          {
            path: "dist/ci/hosted-ci-run-verification.json",
            status: "missing",
          },
          {
            path: "dist/ci/branch-protection-verification.json",
            status: "missing",
          },
        ],
      },
    ],
  };
}

function targetResilienceDrillsChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase34.target_resilience_drills",
        phase: "34",
        title:
          "Target provider outage, migration, network, and secret-rotation drills",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          {
            path: "dist/ci/provider-outage-evidence.json",
            status: "missing",
          },
          {
            path: "dist/ci/migration-drill-evidence.json",
            status: "missing",
          },
          {
            path: "dist/ci/network-partition-evidence.json",
            status: "missing",
          },
          {
            path: "dist/ci/secret-rotation-drill-evidence.json",
            status: "missing",
          },
        ],
      },
    ],
  };
}

function postgresOperationsChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase34.postgres_operations_live",
        phase: "34",
        title: "Target Postgres operational evidence",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          {
            path: "dist/ci/postgres-query-plan-review.json",
            status: "missing",
          },
          {
            path: "dist/ci/postgres-slow-query-telemetry.json",
            status: "missing",
          },
          {
            path: "dist/ci/postgres-lock-telemetry.json",
            status: "missing",
          },
          {
            path: "dist/ci/postgres-archival-partitioning-decision.json",
            status: "missing",
          },
        ],
      },
    ],
  };
}

function qdrantChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase32.qdrant_dr_consistency",
        phase: "32",
        title: "Qdrant external-vector restored-stack consistency",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          { path: "dist/ci/qdrant-dr-source.json", status: "missing" },
          { path: "dist/ci/qdrant-dr-restore.json", status: "missing" },
          {
            path: "dist/ci/qdrant-dr-source-cleanup.json",
            status: "missing",
          },
        ],
      },
    ],
  };
}

function qdrantLiveChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase32.qdrant_live_evidence",
        phase: "32",
        title: "Live Qdrant external-vector isolation evidence",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          { path: "dist/ci/qdrant-live-evidence.json", status: "missing" },
        ],
      },
    ],
  };
}

function prometheusChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase34.live_alert_firing",
        phase: "34",
        title:
          "Live provider, queue-lag, dead-letter, and backup-failure alert firing",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: false,
        evidence: [
          { path: "dist/ci/live-alert-firing.json", status: "missing" },
        ],
      },
    ],
  };
}

function edgeChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase33.live_edge_enforcement",
        phase: "33",
        title: "Live edge, WAF, body-limit, and rate-limit enforcement",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          { path: "dist/ci/live-edge-enforcement.json", status: "missing" },
        ],
      },
    ],
  };
}

function networkPolicyChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase21.kubernetes_networkpolicy_enforcement",
        phase: "21",
        title: "Kubernetes NetworkPolicy/CNI enforcement",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          {
            path: "dist/ci/kubernetes-networkpolicy-smoke.json",
            status: "missing",
          },
        ],
      },
    ],
  };
}

function liveSmokeChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase21.kubernetes_live_smoke",
        phase: "21",
        title: "Kubernetes live namespace smoke",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: true,
        evidence: [
          { path: "dist/ci/kubernetes-live-smoke.json", status: "missing" },
        ],
      },
    ],
  };
}

function loadSoakChecklist() {
  return {
    schemaVersion: "romeo.ga-checklist.v1",
    generatedAt: new Date().toISOString(),
    status: "blocked",
    summary: { blocked: 1, satisfied: 0, total: 1 },
    gates: [
      {
        id: "phase34.kubernetes_load_soak",
        phase: "34",
        title: "Kubernetes selected-tier load and soak evidence",
        status: "blocked",
        requiredForGa: true,
        environmentRequired: true,
        securityCritical: false,
        evidence: [
          { path: "dist/ci/kubernetes-load-soak.json", status: "missing" },
        ],
      },
    ],
  };
}

function kubernetesGate(id, phase) {
  return {
    id,
    phase,
    title: `Synthetic ${id}`,
    status: "blocked",
    requiredForGa: true,
    environmentRequired: true,
    securityCritical: true,
    evidence: [{ path: `dist/ci/${id}.json`, status: "missing" }],
  };
}

function evidenceSummary(evidence) {
  return {
    status: evidence.status,
    summary: evidence.summary,
    redaction: evidence.redaction,
    gateStatuses: evidence.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
    })),
  };
}

function assertRedacted(label, value) {
  const serialized = JSON.stringify(value);
  for (const sentinel of secretSentinels) {
    if (serialized.includes(sentinel)) {
      throw new Error(`${label} leaked ${sentinel}.`);
    }
  }
  if (serialized.includes("/tmp/raw-release-readback.json")) {
    throw new Error(`${label} leaked unsafe absolute evidence path.`);
  }
  if (serialized.includes("../unsafe-target-quality-evidence.json")) {
    throw new Error(`${label} leaked unsafe relative evidence path.`);
  }
}

function qdrantGate(evidence) {
  const gate = evidence.gates.find(
    (item) => item.id === "phase32.qdrant_dr_consistency",
  );
  if (gate === undefined) {
    throw new Error("Qdrant DR preflight gate was not returned.");
  }
  return gate;
}

function qdrantLiveGate(evidence) {
  const gate = evidence.gates.find(
    (item) => item.id === "phase32.qdrant_live_evidence",
  );
  if (gate === undefined) {
    throw new Error("Qdrant live preflight gate was not returned.");
  }
  return gate;
}

function assertTargetQualityPreflightReady(evidence) {
  const gate = evidence.gates.find(
    (item) => item.id === "phase32.target_quality_evidence",
  );
  if (gate === undefined) {
    throw new Error("Target-quality preflight gate was not returned.");
  }
  for (const name of [
    "env:TARGET_QUALITY_AGENT_IDS",
    "env:TARGET_QUALITY_REPLAY_FILE",
    "target_quality:agent_ids",
    "target_quality:replay_file",
    "target_quality:vector_comparison",
  ]) {
    if (!gate.checks.some((check) => check.name === name)) {
      throw new Error(`Target-quality preflight did not include ${name}.`);
    }
  }
  const replayCheck = gate.checks.find(
    (check) => check.name === "target_quality:replay_file",
  );
  if (replayCheck?.status !== "ready" || replayCheck.caseCount !== 1) {
    throw new Error("Target-quality replay preflight did not validate shape.");
  }
  if (
    !gate.command?.includes("--require-eval-passed") ||
    !gate.command.includes("--api-key $ROMEO_API_KEY") ||
    !gate.command.includes("TARGET_QUALITY_REQUIRE_VECTOR_COMPARISON") ||
    !gate.command.includes("--replay-file $TARGET_QUALITY_REPLAY_FILE") ||
    !gate.command.includes("--agent-ids $TARGET_QUALITY_AGENT_IDS") ||
    gate.command.includes("SCOPED_ADMIN_OR_OPERATOR_KEY")
  ) {
    throw new Error(
      "Target-quality preflight command did not include required GA inputs.",
    );
  }
}

function assertTargetQualityVectorComparisonBlocked(evidence) {
  const gate = targetQualityGate(evidence);
  const check = gate.checks.find(
    (item) => item.name === "target_quality:vector_comparison",
  );
  if (
    check?.status !== "blocked" ||
    check.reason !== "comparison_replay_required"
  ) {
    throw new Error(
      "Target-quality vector comparison preflight did not block single replay.",
    );
  }
}

function assertTargetQualityVectorComparisonReady(evidence) {
  const gate = targetQualityGate(evidence);
  const check = gate.checks.find(
    (item) => item.name === "target_quality:vector_comparison",
  );
  if (
    check?.status !== "ready" ||
    check.baselineRouteMode !== "pgvector" ||
    check.candidateRouteMode !== "external_vector" ||
    check.baselineCaseCount !== 1 ||
    check.candidateCaseCount !== 1
  ) {
    throw new Error(
      "Target-quality vector comparison preflight did not validate compare shape.",
    );
  }
}

function targetQualityGate(evidence) {
  const gate = evidence.gates.find(
    (item) => item.id === "phase32.target_quality_evidence",
  );
  if (gate === undefined) {
    throw new Error("Target-quality preflight gate was not returned.");
  }
  return gate;
}

function assertReleaseReadbackPreflightReady(evidence) {
  const gate = evidence.gates.find(
    (item) => item.id === "phase22.credentialed_release_readback",
  );
  if (gate === undefined) {
    throw new Error("Release readback preflight gate was not returned.");
  }
  for (const name of [
    "env:RELEASE_READBACK_PLAN_FILE",
    "env_any:NPM_TOKEN|NODE_AUTH_TOKEN",
    "release_readback:plan",
  ]) {
    if (!gate.checks.some((check) => check.name === name)) {
      throw new Error(`Release readback preflight did not include ${name}.`);
    }
  }
  const planCheck = gate.checks.find(
    (check) => check.name === "release_readback:plan",
  );
  if (
    planCheck?.status !== "ready" ||
    planCheck.imageCount !== 1 ||
    planCheck.chartCount !== 1 ||
    planCheck.assetCount !== 5 ||
    !Array.isArray(planCheck.requiredAssetNames) ||
    planCheck.requiredAssetNames.length !== 5
  ) {
    throw new Error("Release readback plan preflight did not validate shape.");
  }
  if (
    !gate.command?.includes("--readback-plan-file $RELEASE_READBACK_PLAN_FILE")
  ) {
    throw new Error(
      "Release readback preflight command did not use the plan file.",
    );
  }
}

function assertCiGovernancePreflightBlocked(evidence) {
  const gate = ciGovernanceGate(evidence);
  for (const name of [
    "env:CI_GOVERNANCE_EVIDENCE_REVIEWED",
    "env:GITHUB_REPOSITORY",
    "env_any:GITHUB_TOKEN|GH_TOKEN",
    "env_any:GITHUB_CI_RUN_ID|GITHUB_CI_HEAD_SHA",
    "github:repository_target",
    "github:ci_run_selector",
  ]) {
    const check = gate.checks.find((item) => item.name === name);
    if (check?.status !== "blocked") {
      throw new Error(`CI governance blocked preflight did not block ${name}.`);
    }
  }
}

function assertCiGovernancePreflightReady(evidence) {
  const gate = ciGovernanceGate(evidence);
  for (const name of [
    "env:CI_GOVERNANCE_EVIDENCE_REVIEWED",
    "env:GITHUB_REPOSITORY",
    "env_any:GITHUB_TOKEN|GH_TOKEN",
    "env_any:GITHUB_CI_RUN_ID|GITHUB_CI_HEAD_SHA",
    "ci_governance:live_review",
    "github:repository_target",
    "github:ci_run_selector",
  ]) {
    const check = gate.checks.find((item) => item.name === name);
    if (check?.status !== "ready") {
      throw new Error(`CI governance ready preflight did not ready ${name}.`);
    }
  }
  const review = gate.checks.find(
    (item) => item.name === "ci_governance:live_review",
  );
  if (
    review?.rawApiResponsesReturned !== false ||
    review.rawJobLogsReturned !== false ||
    review.rawRepositorySlugReturned !== false ||
    review.rawRunUrlsReturned !== false ||
    review.rawWorkflowBodiesReturned !== false ||
    review.secretValuesReturned !== false ||
    review.tokenValuesReturned !== false
  ) {
    throw new Error("CI governance preflight did not expose redaction proof.");
  }
  if (
    !gate.command?.includes("pnpm ci:branch-protection-plan") ||
    !gate.command.includes("pnpm ci:hosted-run-verify") ||
    !gate.command.includes("--head-sha $GITHUB_CI_HEAD_SHA") ||
    !gate.command.includes("pnpm ci:branch-protection-verify")
  ) {
    throw new Error("CI governance preflight command was incomplete.");
  }
}

function ciGovernanceGate(evidence) {
  const gate = evidence.gates.find(
    (item) => item.id === "phase22.ci_governance_live",
  );
  if (gate === undefined) {
    throw new Error("CI governance preflight gate was not returned.");
  }
  return gate;
}

function assertKubernetesDrPreflightReady(evidence) {
  const gate = evidence.gates.find(
    (item) => item.id === "phase21.kubernetes_dr_modes",
  );
  if (gate === undefined) {
    throw new Error("Kubernetes DR preflight gate was not returned.");
  }
  for (const name of [
    "env:KUBERNETES_DR_PLAN_FILE",
    "env:KUBERNETES_DR_SKIP_BUILD",
    "env:KUBERNETES_DR_APP_IMAGE",
    "kubernetes_dr:runtime_plan",
    "kubernetes_dr:plan",
    "kubernetes_dr:cloudnativepg:source_secret",
    "kubernetes_dr:cloudnativepg:restore_secret",
  ]) {
    if (!gate.checks.some((check) => check.name === name)) {
      throw new Error(`Kubernetes DR preflight did not include ${name}.`);
    }
  }
  const planCheck = gate.checks.find(
    (check) => check.name === "kubernetes_dr:plan",
  );
  const runtimePlanCheck = gate.checks.find(
    (check) => check.name === "kubernetes_dr:runtime_plan",
  );
  if (
    runtimePlanCheck?.status !== "ready" ||
    runtimePlanCheck.skipBuildRequired !== true ||
    runtimePlanCheck.appImageReviewed !== true ||
    runtimePlanCheck.rawImageRefsReturned !== false
  ) {
    throw new Error(
      "Kubernetes DR runtime preflight did not validate image plan.",
    );
  }
  if (
    planCheck?.status !== "ready" ||
    planCheck.modeCount !== 2 ||
    planCheck.namespacePairCount !== 2 ||
    planCheck.cloudnativepgSecretRefsConfigured !== true ||
    planCheck.secretNamesReturned !== false
  ) {
    throw new Error("Kubernetes DR plan preflight did not validate shape.");
  }
  for (const name of [
    "kubernetes_dr:cloudnativepg:source_secret",
    "kubernetes_dr:cloudnativepg:restore_secret",
  ]) {
    const check = gate.checks.find((item) => item.name === name);
    if (
      check?.status !== "ready" ||
      check.secretNameReturned !== false ||
      check.secretKeyReturned !== false ||
      check.secretValueReturned !== false
    ) {
      throw new Error(`${name} preflight leaked or missed Secret posture.`);
    }
  }
  if (
    !gate.command?.includes("--mode external-postgres") ||
    !gate.command.includes("--mode cloudnativepg") ||
    !gate.command.includes("--skip-build") ||
    !gate.command.includes("--image $KUBERNETES_DR_APP_IMAGE") ||
    !gate.command.includes("--dr-plan-file $KUBERNETES_DR_PLAN_FILE")
  ) {
    throw new Error("Kubernetes DR preflight command did not use the plan.");
  }
  if (gate.checks.some((check) => check.name === "command:docker")) {
    throw new Error("Kubernetes DR preflight should not require Docker.");
  }
}

function assertNetworkPolicyPreflightReady(evidence) {
  const gate = evidence.gates.find(
    (item) => item.id === "phase21.kubernetes_networkpolicy_enforcement",
  );
  if (gate === undefined) {
    throw new Error(
      "Kubernetes NetworkPolicy preflight gate was not returned.",
    );
  }
  for (const name of [
    "env:KUBERNETES_NETWORKPOLICY_CONFIRM_CNI_ENFORCEMENT",
    "env:KUBERNETES_NETWORKPOLICY_CLIENT_IMAGE",
    "env:KUBERNETES_NETWORKPOLICY_SERVER_IMAGE",
    "env:KUBERNETES_NETWORKPOLICY_POLICY_PROPAGATION_MS",
    "kubernetes_networkpolicy:api",
    "kubernetes_networkpolicy:cni_confirmation",
    "kubernetes_networkpolicy:images",
    "kubernetes_networkpolicy:probe_config",
  ]) {
    if (!gate.checks.some((check) => check.name === name)) {
      throw new Error(`NetworkPolicy preflight did not include ${name}.`);
    }
  }
  const api = gate.checks.find(
    (check) => check.name === "kubernetes_networkpolicy:api",
  );
  if (
    api?.status !== "ready" ||
    api.apiGroup !== "networking.k8s.io" ||
    api.rawApiResourcesReturned !== false
  ) {
    throw new Error("NetworkPolicy preflight did not validate API posture.");
  }
  const confirmation = gate.checks.find(
    (check) => check.name === "kubernetes_networkpolicy:cni_confirmation",
  );
  if (
    confirmation?.status !== "ready" ||
    confirmation.operatorConfirmedCniEnforcement !== true
  ) {
    throw new Error(
      "NetworkPolicy preflight did not require CNI confirmation.",
    );
  }
  const images = gate.checks.find(
    (check) => check.name === "kubernetes_networkpolicy:images",
  );
  if (
    images?.status !== "ready" ||
    images.imageCount !== 2 ||
    images.digestPinned !== true ||
    images.latestTagsRejected !== true ||
    images.rawImageRefsReturned !== false
  ) {
    throw new Error("NetworkPolicy preflight did not validate probe images.");
  }
  const probeConfig = gate.checks.find(
    (check) => check.name === "kubernetes_networkpolicy:probe_config",
  );
  if (
    probeConfig?.status !== "ready" ||
    probeConfig.namespace !== "romeo-cni-contract" ||
    probeConfig.policyPropagationMs !== 5000 ||
    probeConfig.rawPodIpsReturned !== false ||
    probeConfig.rawPodLogsReturned !== false
  ) {
    throw new Error("NetworkPolicy preflight did not validate probe config.");
  }
  if (
    !gate.command?.includes("pnpm smoke:kubernetes:networkpolicy") ||
    !gate.command.includes("--namespace romeo-cni-contract") ||
    !gate.command.includes(
      "--client-image $KUBERNETES_NETWORKPOLICY_CLIENT_IMAGE",
    ) ||
    !gate.command.includes(
      "--server-image $KUBERNETES_NETWORKPOLICY_SERVER_IMAGE",
    )
  ) {
    throw new Error(
      "NetworkPolicy preflight command did not include required inputs.",
    );
  }
}

function assertLiveSmokePreflightReady(evidence) {
  const gate = evidence.gates.find(
    (item) => item.id === "phase21.kubernetes_live_smoke",
  );
  if (gate === undefined) {
    throw new Error("Kubernetes live-smoke preflight gate was not returned.");
  }
  for (const name of [
    "env:KUBERNETES_LIVE_SMOKE_SKIP_BUILD",
    "env:KUBERNETES_LIVE_SMOKE_NAMESPACE",
    "env:KUBERNETES_LIVE_SMOKE_RELEASE_NAME",
    "env:KUBERNETES_LIVE_SMOKE_APP_IMAGE",
    "env:KUBERNETES_LIVE_SMOKE_POSTGRES_IMAGE",
    "env:KUBERNETES_LIVE_SMOKE_VALKEY_IMAGE",
    "env:KUBERNETES_LIVE_SMOKE_RUSTFS_IMAGE",
    "env:KUBERNETES_LIVE_SMOKE_OBJECT_STORE_CLIENT_IMAGE",
    "env:KUBERNETES_LIVE_SMOKE_TIMEOUT_MS",
    "kubernetes_live_smoke:plan",
    "kubernetes_live_smoke:namespace_available",
  ]) {
    if (!gate.checks.some((check) => check.name === name)) {
      throw new Error(`Kubernetes live-smoke preflight missed ${name}.`);
    }
  }
  const plan = gate.checks.find(
    (check) => check.name === "kubernetes_live_smoke:plan",
  );
  if (
    plan?.status !== "ready" ||
    plan.namespace !== "romeo-live-contract" ||
    plan.releaseName !== "live-contract" ||
    plan.skipBuildRequired !== true ||
    plan.appImageReviewed !== true ||
    plan.dependencyImageCount !== 4 ||
    plan.dependencyImagesDigestPinned !== true ||
    plan.rawImageRefsReturned !== false
  ) {
    throw new Error("Kubernetes live-smoke preflight did not validate plan.");
  }
  const namespace = gate.checks.find(
    (check) => check.name === "kubernetes_live_smoke:namespace_available",
  );
  if (namespace?.status !== "ready") {
    throw new Error(
      "Kubernetes live-smoke preflight did not require a free namespace.",
    );
  }
  if (
    !gate.command?.includes("pnpm smoke:kubernetes:live") ||
    !gate.command.includes("--skip-build") ||
    !gate.command.includes("--namespace romeo-live-contract") ||
    !gate.command.includes("--image $KUBERNETES_LIVE_SMOKE_APP_IMAGE") ||
    !gate.command.includes(
      "--postgres-image $KUBERNETES_LIVE_SMOKE_POSTGRES_IMAGE",
    )
  ) {
    throw new Error(
      "Kubernetes live-smoke preflight command did not include required inputs.",
    );
  }
  if (gate.checks.some((check) => check.name === "command:docker")) {
    throw new Error(
      "Kubernetes live-smoke preflight should not require Docker.",
    );
  }
}

function assertLoadSoakPreflightReady(evidence) {
  const gate = evidence.gates.find(
    (item) => item.id === "phase34.kubernetes_load_soak",
  );
  if (gate === undefined) {
    throw new Error("Kubernetes load/soak preflight gate was not returned.");
  }
  for (const name of [
    "env:ROMEO_API_KEY",
    "env:KUBERNETES_LOAD_SOAK_TIER",
    "env:KUBERNETES_LOAD_SOAK_ITERATIONS",
    "env:KUBERNETES_LOAD_SOAK_SOAK_SECONDS",
    "env:KUBERNETES_LOAD_SOAK_INTERVAL_SECONDS",
    "env:KUBERNETES_LOAD_SOAK_TIMEOUT_MS",
    "kubernetes_load_soak:parameters",
    "kubernetes_load_soak:target",
  ]) {
    if (!gate.checks.some((check) => check.name === name)) {
      throw new Error(`Load/soak preflight did not include ${name}.`);
    }
  }
  const parameters = gate.checks.find(
    (check) => check.name === "kubernetes_load_soak:parameters",
  );
  if (
    parameters?.status !== "ready" ||
    parameters.tier !== "small" ||
    parameters.iterations !== 2 ||
    parameters.requestedSoakSeconds !== 60 ||
    parameters.intervalSeconds !== 15 ||
    parameters.gaCompatible !== true
  ) {
    throw new Error("Load/soak preflight did not validate GA parameters.");
  }
  const target = gate.checks.find(
    (check) => check.name === "kubernetes_load_soak:target",
  );
  if (
    target?.status !== "ready" ||
    target.mode !== "port_forward" ||
    target.rawSelectorReturned !== false ||
    target.rawBaseUrlReturned !== false
  ) {
    throw new Error("Load/soak preflight did not validate target posture.");
  }
  if (
    !gate.command?.includes("pnpm smoke:kubernetes:load-soak") ||
    !gate.command.includes("--api-key $ROMEO_API_KEY") ||
    !gate.command.includes("--tier $KUBERNETES_LOAD_SOAK_TIER") ||
    !gate.command.includes("--iterations $KUBERNETES_LOAD_SOAK_ITERATIONS") ||
    !gate.command.includes(
      "--soak-seconds $KUBERNETES_LOAD_SOAK_SOAK_SECONDS",
    ) ||
    gate.command.includes("SCOPED_ADMIN_OR_OPERATOR_KEY")
  ) {
    throw new Error("Load/soak preflight command did not include GA inputs.");
  }
}

function assertAlertPreflightReady(evidence) {
  const gate = evidence.gates.find(
    (item) => item.id === "phase34.live_alert_firing",
  );
  if (gate === undefined) {
    throw new Error("Alert firing preflight gate was not returned.");
  }
  for (const name of [
    "prometheus",
    "alertmanager",
    "alerts:rules_defined",
    "alerts:required_categories",
  ]) {
    if (!gate.checks.some((check) => check.name === name)) {
      throw new Error(`Alert preflight did not include ${name}.`);
    }
  }
  const rules = gate.checks.find(
    (check) => check.name === "alerts:rules_defined",
  );
  const categories = gate.checks.find(
    (check) => check.name === "alerts:required_categories",
  );
  if (
    rules?.status !== "ready" ||
    rules.requiredAlertCount < 4 ||
    rules.missingAlertCount !== 0 ||
    categories?.status !== "ready" ||
    categories.providerConfigured !== true ||
    categories.queueConfigured !== true ||
    categories.backupConfigured !== true
  ) {
    throw new Error("Alert preflight did not validate required alerts.");
  }
}

function assertEdgePreflightReady(evidence) {
  const gate = evidence.gates.find(
    (item) => item.id === "phase33.live_edge_enforcement",
  );
  if (gate === undefined) {
    throw new Error("Edge preflight gate was not returned.");
  }
  for (const name of [
    "env:ROMEO_BASE_URL",
    "env:ROMEO_API_KEY",
    "env:EDGE_ENFORCEMENT_REQUIRE_ADMIN_POSTURE",
    "env:EDGE_ENFORCEMENT_REQUIRE_WAF_BLOCK_MODE",
    "env:EDGE_ENFORCEMENT_BODY_LIMIT_PATH",
    "env:EDGE_ENFORCEMENT_BODY_LIMIT_BYTES",
    "env:EDGE_ENFORCEMENT_BODY_LIMIT_EXPECTED_STATUSES",
    "env:EDGE_ENFORCEMENT_RATE_LIMIT_PATH",
    "env:EDGE_ENFORCEMENT_RATE_LIMIT_ATTEMPTS",
    "env:EDGE_ENFORCEMENT_RATE_LIMIT_EXPECTED_STATUS",
    "env:EDGE_ENFORCEMENT_WAF_PROBE_PATH",
    "env:EDGE_ENFORCEMENT_WAF_EXPECTED_STATUSES",
    "edge:required_controls",
    "edge:status_expectations",
    "edge:probe_paths",
  ]) {
    if (!gate.checks.some((check) => check.name === name)) {
      throw new Error(`Edge preflight did not include ${name}.`);
    }
  }
  const requiredControls = gate.checks.find(
    (check) => check.name === "edge:required_controls",
  );
  if (
    requiredControls?.status !== "ready" ||
    requiredControls.adminPostureRequired !== true ||
    requiredControls.wafBlockModeRequired !== true ||
    requiredControls.bodyLimitBytesWithinBounds !== true ||
    requiredControls.rateLimitAttempts !== 8 ||
    requiredControls.rawValuesReturned !== false
  ) {
    throw new Error("Edge preflight did not validate required controls.");
  }
  const statusExpectations = gate.checks.find(
    (check) => check.name === "edge:status_expectations",
  );
  if (
    statusExpectations?.status !== "ready" ||
    statusExpectations.bodyLimitStatusCount !== 1 ||
    statusExpectations.wafStatusCount !== 3 ||
    statusExpectations.rateLimitExpectedStatusConfigured !== true ||
    statusExpectations.gaCompatible !== true ||
    statusExpectations.rawValuesReturned !== false
  ) {
    throw new Error("Edge preflight did not validate status expectations.");
  }
  const probePaths = gate.checks.find(
    (check) => check.name === "edge:probe_paths",
  );
  if (
    probePaths?.status !== "ready" ||
    probePaths.pathCount !== 4 ||
    probePaths.wafProbePayloadConfigured !== true ||
    probePaths.wafExpectedHeaderConfigured !== true ||
    probePaths.wafProbeHeaderValueConfigured !== true ||
    probePaths.rawPathsReturned !== false ||
    probePaths.rawQueryValuesReturned !== false ||
    probePaths.rawHeaderValuesReturned !== false
  ) {
    throw new Error("Edge preflight did not validate probe path posture.");
  }
  if (
    !gate.command?.includes("pnpm smoke:edge:live") ||
    !gate.command.includes("--api-key $ROMEO_API_KEY") ||
    !gate.command.includes("--require-admin-posture") ||
    !gate.command.includes("--require-waf-block-mode") ||
    !gate.command.includes(
      "--body-limit-bytes $EDGE_ENFORCEMENT_BODY_LIMIT_BYTES",
    ) ||
    !gate.command.includes(
      "--rate-limit-path $EDGE_ENFORCEMENT_RATE_LIMIT_PATH",
    ) ||
    !gate.command.includes(
      "--waf-probe-path $EDGE_ENFORCEMENT_WAF_PROBE_PATH",
    ) ||
    gate.command.includes("SCOPED_ADMIN_OR_OPERATOR_KEY")
  ) {
    throw new Error("Edge preflight command did not include required inputs.");
  }
}

function assertCommandUsesCheckedRomeoApiKey(gate) {
  if (!gate.checks.some((check) => check.name === "env:ROMEO_API_KEY")) return;
  if (typeof gate.command !== "string") {
    throw new Error(`${gate.id} preflight did not expose a command.`);
  }
  if (
    !gate.command.includes("--api-key $ROMEO_API_KEY") ||
    gate.command.includes("SCOPED_ADMIN_OR_OPERATOR_KEY")
  ) {
    throw new Error(
      `${gate.id} preflight command did not use the checked ROMEO_API_KEY env.`,
    );
  }
}

function assertPostgresOperationsPreflightReady(evidence) {
  const gate = evidence.gates.find(
    (item) => item.id === "phase34.postgres_operations_live",
  );
  if (gate === undefined) {
    throw new Error("Postgres operations preflight gate was not returned.");
  }
  for (const name of [
    "command:psql",
    "env:DATABASE_URL",
    "env:POSTGRES_OPERATIONAL_TARGET_TIER",
    "env:POSTGRES_OPERATIONAL_MODE",
    "env:POSTGRES_TELEMETRY_WINDOW_MINUTES",
    "env:POSTGRES_SLOW_QUERY_THRESHOLD_MS",
    "env:POSTGRES_MAX_BLOCKED_SESSIONS",
    "env:POSTGRES_MAX_DEADLOCKS",
    "env:POSTGRES_ARCHIVAL_DECISION",
    "postgres_operations:target",
    "postgres_operations:telemetry_thresholds",
    "postgres_operations:archival_decision",
  ]) {
    if (!gate.checks.some((check) => check.name === name)) {
      throw new Error(`Postgres operations preflight did not include ${name}.`);
    }
  }
  const target = gate.checks.find(
    (check) => check.name === "postgres_operations:target",
  );
  if (
    target?.status !== "ready" ||
    target.deploymentTier !== "enterprise" ||
    target.postgresMode !== "external-hosted-postgres" ||
    target.hostedTlsVerifyFull !== true ||
    target.rawDatabaseUrlReturned !== false ||
    target.rawDatabaseHostReturned !== false
  ) {
    throw new Error(
      "Postgres operations target preflight did not validate safely.",
    );
  }
  const thresholds = gate.checks.find(
    (check) => check.name === "postgres_operations:telemetry_thresholds",
  );
  if (
    thresholds?.status !== "ready" ||
    thresholds.windowMinutes !== 60 ||
    thresholds.slowThresholdMs !== 1000 ||
    thresholds.maxBlockedSessions !== 0 ||
    thresholds.maxDeadlocks !== 0 ||
    thresholds.pgStatStatementsRequired !== true ||
    thresholds.rawSqlReturned !== false
  ) {
    throw new Error(
      "Postgres operations preflight did not validate telemetry thresholds.",
    );
  }
  const archival = gate.checks.find(
    (check) => check.name === "postgres_operations:archival_decision",
  );
  if (
    archival?.status !== "ready" ||
    archival.decision !== "no_runtime_partitioning_enabled" ||
    archival.acceptedDecisionRequired !== true ||
    archival.rawSqlReturned !== false ||
    archival.rawTableRowsReturned !== false
  ) {
    throw new Error(
      "Postgres operations preflight did not validate archival decision.",
    );
  }
  if (
    !gate.command?.includes("pnpm review:postgres-query-plans") ||
    !gate.command.includes("--representative-volume") ||
    !gate.command.includes("--target-tier $POSTGRES_OPERATIONAL_TARGET_TIER") ||
    !gate.command.includes("--postgres-mode $POSTGRES_OPERATIONAL_MODE") ||
    !gate.command.includes("pnpm collect:postgres-telemetry") ||
    !gate.command.includes(
      "--window-minutes $POSTGRES_TELEMETRY_WINDOW_MINUTES",
    ) ||
    !gate.command.includes("pnpm decide:postgres-archival") ||
    !gate.command.includes("--accept-decision")
  ) {
    throw new Error(
      "Postgres operations preflight command did not include required inputs.",
    );
  }
}

function assertGateCheckReason(evidence, gateId, checkName, reason) {
  const gate = evidence.gates.find((item) => item.id === gateId);
  if (gate === undefined) {
    throw new Error(`${gateId} preflight gate was not returned.`);
  }
  if (
    !gate.checks.some(
      (check) => check.name === checkName && check.reason === reason,
    )
  ) {
    throw new Error(
      `${gateId} preflight did not include ${checkName} reason ${reason}.`,
    );
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected}, got ${actual}.`);
  }
}

function setReadyEdgeEnv() {
  process.env.EDGE_ENFORCEMENT_REQUIRE_ADMIN_POSTURE = "true";
  process.env.EDGE_ENFORCEMENT_REQUIRE_WAF_BLOCK_MODE = "true";
  process.env.EDGE_ENFORCEMENT_REQUIRE_HSTS = "true";
  process.env.EDGE_ENFORCEMENT_BODY_LIMIT_PATH =
    "/api/v1/billing/webhooks/generic";
  process.env.EDGE_ENFORCEMENT_BODY_LIMIT_BYTES = "1048576";
  process.env.EDGE_ENFORCEMENT_BODY_LIMIT_EXPECTED_STATUSES = "413";
  process.env.EDGE_ENFORCEMENT_HEADER_PATH = "/api/v1/health";
  process.env.EDGE_ENFORCEMENT_RATE_LIMIT_PATH =
    "/api/v1/health?rate_limit_probe=SECRET_EDGE_PROBE_QUERY";
  process.env.EDGE_ENFORCEMENT_RATE_LIMIT_ATTEMPTS = "8";
  process.env.EDGE_ENFORCEMENT_RATE_LIMIT_EXPECTED_STATUS = "429";
  process.env.EDGE_ENFORCEMENT_WAF_PROBE_PATH =
    "/api/v1/health?romeo_edge_probe=SECRET_EDGE_PROBE_QUERY";
  process.env.EDGE_ENFORCEMENT_WAF_EXPECTED_STATUSES = "403,406,429";
  process.env.EDGE_ENFORCEMENT_WAF_EXPECTED_HEADER = "x-romeo-waf-blocked";
  process.env.EDGE_ENFORCEMENT_WAF_PROBE_HEADER_NAME = "x-romeo-edge-probe";
  process.env.EDGE_ENFORCEMENT_WAF_PROBE_HEADER_VALUE =
    "SECRET_EDGE_HEADER_VALUE";
}

function setReadyNetworkPolicyEnv() {
  const clientDigest = "d".repeat(64);
  const serverDigest = "e".repeat(64);
  process.env.KUBERNETES_NETWORKPOLICY_CONFIRM_CNI_ENFORCEMENT = "true";
  process.env.KUBERNETES_NETWORKPOLICY_NAMESPACE = "romeo-cni-contract";
  process.env.KUBERNETES_NETWORKPOLICY_CLIENT_IMAGE = `registry.example.com/romeo/curl@sha256:${clientDigest}`;
  process.env.KUBERNETES_NETWORKPOLICY_SERVER_IMAGE = `registry.example.com/romeo/nginx-unprivileged@sha256:${serverDigest}`;
  process.env.KUBERNETES_NETWORKPOLICY_POLICY_PROPAGATION_MS = "5000";
  process.env.KUBERNETES_NETWORKPOLICY_TIMEOUT_MS = "180000";
}

function setReadyLiveSmokeEnv() {
  process.env.KUBERNETES_LIVE_SMOKE_SKIP_BUILD = "true";
  process.env.KUBERNETES_LIVE_SMOKE_NAMESPACE = "romeo-live-contract";
  process.env.KUBERNETES_LIVE_SMOKE_RELEASE_NAME = "live-contract";
  process.env.KUBERNETES_LIVE_SMOKE_APP_IMAGE = `registry.example.com/romeo/app:1.2.3@sha256:${"f".repeat(64)}`;
  process.env.KUBERNETES_LIVE_SMOKE_POSTGRES_IMAGE = `registry.example.com/romeo/pgvector@sha256:${"a".repeat(64)}`;
  process.env.KUBERNETES_LIVE_SMOKE_VALKEY_IMAGE = `registry.example.com/romeo/valkey@sha256:${"b".repeat(64)}`;
  process.env.KUBERNETES_LIVE_SMOKE_RUSTFS_IMAGE = `registry.example.com/romeo/rustfs@sha256:${"c".repeat(64)}`;
  process.env.KUBERNETES_LIVE_SMOKE_OBJECT_STORE_CLIENT_IMAGE = `registry.example.com/romeo/mc@sha256:${"d".repeat(64)}`;
  process.env.KUBERNETES_LIVE_SMOKE_TIMEOUT_MS = "300000";
}

function setReadyLoadSoakEnv() {
  delete process.env.KUBERNETES_LOAD_SOAK_BASE_URL;
  process.env.KUBERNETES_LOAD_SOAK_TIER = "small";
  process.env.KUBERNETES_LOAD_SOAK_ITERATIONS = "2";
  process.env.KUBERNETES_LOAD_SOAK_SOAK_SECONDS = "60";
  process.env.KUBERNETES_LOAD_SOAK_INTERVAL_SECONDS = "15";
  process.env.KUBERNETES_LOAD_SOAK_TIMEOUT_MS = "300000";
  delete process.env.KUBERNETES_LOAD_SOAK_NAMESPACE;
  delete process.env.KUBERNETES_LOAD_SOAK_RELEASE_NAME;
  delete process.env.KUBERNETES_LOAD_SOAK_SERVICE_NAME;
  delete process.env.KUBERNETES_LOAD_SOAK_DEPLOYMENT_NAME;
  delete process.env.KUBERNETES_LOAD_SOAK_SELECTOR;
  delete process.env.KUBERNETES_LOAD_SOAK_SERVICE_PORT;
}

function setReadyPostgresOperationsEnv() {
  process.env.DATABASE_URL =
    "postgres://romeo:SECRET_POSTGRES_PASSWORD@db.example.com:5432/romeo?sslmode=verify-full";
  process.env.POSTGRES_OPERATIONAL_TARGET_TIER = "enterprise";
  process.env.POSTGRES_OPERATIONAL_MODE = "external-hosted-postgres";
  process.env.POSTGRES_TELEMETRY_WINDOW_MINUTES = "60";
  process.env.POSTGRES_SLOW_QUERY_THRESHOLD_MS = "1000";
  process.env.POSTGRES_MAX_BLOCKED_SESSIONS = "0";
  process.env.POSTGRES_MAX_DEADLOCKS = "0";
  process.env.POSTGRES_ARCHIVAL_DECISION = "no_runtime_partitioning_enabled";
}

function writeJson(path, value) {
  const resolved = join(tempDir, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(path, value) {
  const resolved = join(tempDir, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, value, "utf8");
}

function writeEvidence(value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (outputPath === undefined) {
    process.stdout.write(body);
    return;
  }
  const resolved = resolve(originalCwd, outputPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, body, "utf8");
  console.log(`Wrote GA target preflight contract smoke to ${resolved}`);
}

function installFakePsql() {
  const binDir = join(tempDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const psqlPath = join(binDir, "psql");
  writeFileSync(
    psqlPath,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "psql (PostgreSQL) 16.0"
  exit 0
fi
exit 1
`,
    "utf8",
  );
  chmodSync(psqlPath, 0o755);
  process.env.PATH = `${binDir}:${originalEnv.PATH ?? ""}`;
}

function installFakeKubectl() {
  const binDir = join(tempDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const helmPath = join(binDir, "helm");
  writeFileSync(
    helmPath,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "version.BuildInfo{Version:\\"v3.99.0\\"}"
  exit 0
fi
exit 1
`,
    "utf8",
  );
  chmodSync(helmPath, 0o755);
  const kubectlPath = join(binDir, "kubectl");
  writeFileSync(
    kubectlPath,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "Client Version: fake"
  exit 0
fi
if [ "$1" = "config" ] && [ "$2" = "current-context" ]; then
  echo "romeo-fake-context"
  exit 0
fi
if [ "$1" = "cluster-info" ]; then
  echo "Kubernetes control plane is running"
  exit 0
fi
if [ "$1" = "api-resources" ]; then
  echo "networkpolicies"
  exit 0
fi
if [ "$1" = "get" ] && [ "$2" = "namespace" ] && [ "$3" = "romeo-live-contract" ]; then
  exit 1
fi
if [ "$1" = "get" ]; then
  echo "{}"
  exit 0
fi
exit 1
`,
    "utf8",
  );
  chmodSync(kubectlPath, 0o755);
  process.env.PATH = `${binDir}:${originalEnv.PATH ?? ""}`;
}

function restoreEnv() {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
