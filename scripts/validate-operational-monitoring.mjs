import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parseAllDocuments } from "yaml";

import {
  buildOperationalMetrics,
  createOperationalMonitoringServer,
  probeOperationalReadiness,
  renderPrometheus,
} from "./operational-monitoring-exporter.mjs";

const outputPath = argValue("--output");
const rawSentinel = `RAW_MONITORING_SENTINEL_${process.pid}`;
const metrics = buildOperationalMetrics(fixtureInput(rawSentinel));
const rendered = renderPrometheus(metrics);
const metricNames = [...new Set(metrics.map((metric) => metric.name))].sort();
const ruleDocs = readYamlDocuments("deploy/monitoring/prometheus-rules.yaml");
const exporterDocs = readYamlDocuments(
  "deploy/monitoring/operational-exporter.deployment.example.yaml",
);
const alertRules = collectAlertRules(ruleDocs);
const referencedMetricNames = metricNamesFromRules(alertRules);
const missingMetricRefs = [...referencedMetricNames].filter(
  (name) => !metricNames.includes(name),
);

assertMetricNames(metricNames);
assertNoSentinelLeak(rendered, rawSentinel);
assertApiDeprecationMetrics(metrics);
assertCapabilityAssignmentMetrics(metrics);
assertCapabilityFlagMetrics(metrics);
assertIdempotencyMetrics(metrics);
assertPrometheusRule(ruleDocs, alertRules);
assertExporterDeployment(exporterDocs);
await assertReadinessProbeBehavior();
await assertExporterHttpBehavior();
if (missingMetricRefs.length > 0) {
  throw new Error(
    `Prometheus rules reference unknown metrics: ${missingMetricRefs.join(", ")}`,
  );
}

const evidence = {
  schemaVersion: "romeo.operational-monitoring-validation.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  checks: [
    "provider_operational_metrics",
    "background_job_operational_metrics",
    "prometheus_text_redaction",
    "prometheus_rules_parse",
    "prometheus_rules_metric_references",
    "kubernetes_exporter_example_contract",
    "dependency_aware_exporter_readiness",
    "api_deprecation_metadata_only_metrics",
    "capability_assignment_metadata_only_metrics",
    "capability_flag_metadata_only_metrics",
    "idempotency_metadata_only_metrics",
  ],
  metricCount: metrics.length,
  metricNames,
  alertNames: alertRules.map((rule) => rule.alert).sort(),
  referencedMetricNames: [...referencedMetricNames].sort(),
  redaction: {
    rawProviderPayloadReturned: false,
    rawJobPayloadReturned: false,
    rawProviderUrlsReturned: false,
    prometheusTextReturned: false,
    environmentReturned: false,
    deprecatedRequestDataReturned: false,
    capabilityFlagSubjectDataReturned: false,
    capabilityAssignmentContextReturned: false,
    idempotencyKeyOrBodyReturned: false,
  },
};

writeEvidence(evidence);

function fixtureInput(sentinel) {
  return {
    providerSummary: {
      generatedAt: "2026-06-30T00:00:00.000Z",
      status: "critical",
      rawProviderPayload: sentinel,
      fallback: {
        available: false,
        configured: true,
        modelId: "model_fallback",
        providerId: "provider_disabled",
        reason: "provider_disabled",
      },
      policy: {
        circuitCooldownMs: 60_000,
        circuitFailureThreshold: 5,
        disabledProviderIds: ["provider_disabled"],
        fallbackModelId: "model_fallback",
        retryAttempts: 1,
        retryBackoffMs: 250,
        streamTimeoutMs: 60_000,
      },
      providers: [
        {
          providerId: "provider_primary",
          type: "openai-compatible",
          enabled: true,
          killSwitchActive: false,
          modelCount: 2,
          enabledModelCount: 2,
          status: "unavailable",
          reasons: ["provider_circuit_open"],
          circuit: { state: "open", consecutiveFailures: 5 },
          baseUrl: `https://provider.example/${sentinel}`,
        },
        {
          providerId: "provider_disabled",
          type: "ollama",
          enabled: true,
          killSwitchActive: true,
          modelCount: 1,
          enabledModelCount: 1,
          status: "unavailable",
          reasons: ["provider_kill_switch"],
          circuit: { state: "closed", consecutiveFailures: 0 },
        },
      ],
      alerts: [
        {
          id: "provider_circuit_open_provider_primary",
          code: "provider_circuit_open",
          providerId: "provider_primary",
          severity: "critical",
        },
        {
          id: "provider_kill_switch_provider_disabled",
          code: "provider_kill_switch",
          providerId: "provider_disabled",
          severity: "critical",
        },
        {
          id: "provider_fallback_unavailable",
          code: "fallback_unavailable",
          providerId: "provider_disabled",
          severity: "critical",
        },
      ],
      runtime: {
        capabilityFlagAllowlist: sentinel,
        apiDeprecations: {
          generatedAt: "2026-06-30T00:15:00.000Z",
          observationScope: "process",
          observationStartedAt: "2026-06-30T00:00:00.000Z",
          observationWindowSeconds: 900,
          operations: [
            {
              firstUsedAt: "2026-06-30T00:05:00.000Z",
              lastUsedAt: "2026-06-30T00:10:00.000Z",
              operationId: "example.getV1",
              requestCount: 2,
              responseClasses: {
                "1xx": 0,
                "2xx": 1,
                "3xx": 0,
                "4xx": 1,
                "5xx": 0,
                other: 0,
              },
              zeroUsageWindowSeconds: 300,
              zeroUsageWindowStartedAt: "2026-06-30T00:10:00.000Z",
            },
          ],
        },
        capabilityFlags: {
          observationScope: "process",
          total: 2,
          resolutions: [
            {
              flagId: "image_jobs_v2",
              effectiveState: "disabled",
              reasonCode: "preview_not_allowlisted",
              count: 2,
            },
          ],
        },
        capabilityAssignmentContext: sentinel,
        capabilityAssignments: {
          observationScope: "process",
          total: 3,
          resolutions: [
            {
              capabilityId: "web_retrieval",
              status: "not_allowed",
              count: 3,
            },
          ],
        },
        idempotencyKey: sentinel,
        idempotency: {
          observationScope: "process",
          outcomes: [
            { operation: "images.generate", outcome: "replay", count: 3 },
          ],
        },
        contextInputTokensAverage: 4096,
        lookbackSeconds: 900,
        objectStoreFailureCount: 2,
        providerErrorCount: 5,
        queueWaitP95Ms: 32000,
        recoveryCount: 2,
        sseDisconnectCount: 3,
        sseReconnectCount: 4,
        sse: {
          activeStreams: 2,
          bufferedBytesHighWater: 8192,
          connectionCount: 7,
          cursorQueryCount: 12,
          cursorQueryRowCount: 42,
          heartbeatFailureCount: 1,
          lookbackSeconds: 900,
          notifierLagAverageMs: 18,
          notifierLagP95Ms: 75,
          notifierUnavailableCount: 1,
          observationScope: "process",
          reconnectCount: 4,
          replayedRowCount: 9,
          slowConsumerDropCount: 1,
          terminalCloseLatencyAverageMs: 4,
          terminalCloseLatencyP95Ms: 12,
        },
        timeToFirstTokenAverageMs: 1200,
        timeToFirstTokenP95Ms: 11000,
        uploadPipelineAverageMs: 230,
        webRetrievalAverageMs: 420,
        outputThroughputAverage: 32,
      },
    },
    jobSummary: {
      generatedAt: "2026-06-30T00:00:00.000Z",
      status: "critical",
      rawJobPayload: sentinel,
      thresholds: {
        deadLetterCriticalCount: 5,
        deadLetterWarningCount: 1,
        queuedWarningSeconds: 300,
        queuedCriticalSeconds: 900,
        runningWarningSeconds: 900,
        runningCriticalSeconds: 3600,
        failedLookbackSeconds: 3600,
        failedWarningCount: 1,
        failedCriticalCount: 5,
      },
      totals: {
        total: 4,
        queued: 1,
        running: 1,
        completed: 1,
        failed: 1,
        deadLettered: 1,
        recentFailed: 1,
      },
      byType: [
        {
          type: "temporary_chat.cleanup",
          total: 1,
          queued: 0,
          running: 0,
          completed: 0,
          failed: 1,
          deadLettered: 0,
          recentFailed: 1,
        },
        {
          type: "webhook.retry_due",
          total: 3,
          queued: 1,
          running: 1,
          completed: 0,
          failed: 1,
          deadLettered: 1,
          recentFailed: 1,
          oldestQueuedAgeSeconds: 1200,
          oldestQueuedJobId: "job_queued",
          longestRunningAgeSeconds: 4200,
          longestRunningJobId: "job_running",
        },
        {
          type: "tool.operation.dispatch_request",
          total: 1,
          queued: 0,
          running: 0,
          completed: 1,
          failed: 0,
          deadLettered: 0,
          recentFailed: 0,
        },
      ],
      alerts: [
        {
          id: "job_queued_lag_webhook_retry_due",
          metric: "queued_lag_seconds",
          severity: "critical",
          type: "webhook.retry_due",
          value: 1200,
          threshold: 900,
          jobId: "job_queued",
        },
        {
          id: "job_running_stale_webhook_retry_due",
          metric: "running_stale_seconds",
          severity: "critical",
          type: "webhook.retry_due",
          value: 4200,
          threshold: 3600,
          jobId: "job_running",
        },
        {
          id: "job_dead_letters_webhook_retry_due",
          metric: "dead_letter_jobs",
          severity: "warning",
          type: "webhook.retry_due",
          value: 1,
          threshold: 1,
        },
      ],
    },
    scrape: { providerUp: 1, jobUp: 1 },
  };
}

function assertMetricNames(metricNames) {
  const required = [
    "romeo_api_deprecated_last_use_timestamp_seconds",
    "romeo_api_deprecated_requests_total",
    "romeo_api_deprecation_observation_window_seconds",
    "romeo_api_deprecation_zero_usage_window_seconds",
    "romeo_capability_resolution_total",
    "romeo_capability_resolutions_total",
    "romeo_background_job_alert",
    "romeo_background_job_dead_letter_jobs",
    "romeo_background_job_longest_running_seconds",
    "romeo_background_job_oldest_queued_seconds",
    "romeo_background_job_recent_failed_jobs",
    "romeo_background_job_status_count",
    "romeo_operational_exporter_up",
    "romeo_operational_source_up",
    "romeo_operational_summary_status",
    "romeo_object_store_error_total",
    "romeo_provider_alert",
    "romeo_provider_circuit_consecutive_failures",
    "romeo_provider_circuit_state",
    "romeo_provider_enabled_model_count",
    "romeo_provider_fallback_available",
    "romeo_provider_fallback_configured",
    "romeo_provider_kill_switch_active",
    "romeo_provider_model_count",
    "romeo_provider_status",
    "romeo_provider_error_total",
    "romeo_run_context_input_tokens",
    "romeo_run_output_tokens_per_second",
    "romeo_run_queue_wait_milliseconds",
    "romeo_run_recovery_total",
    "romeo_run_time_to_first_token_milliseconds",
    "romeo_sse_disconnect_total",
    "romeo_sse_reconnect_total",
    "romeo_sse_active_streams",
    "romeo_sse_buffered_bytes_high_water",
    "romeo_sse_connection_count",
    "romeo_sse_cursor_query_count",
    "romeo_sse_cursor_query_rows",
    "romeo_sse_heartbeat_failures",
    "romeo_sse_notifier_lag_milliseconds",
    "romeo_sse_notifier_unavailable_count",
    "romeo_sse_replayed_rows",
    "romeo_sse_slow_consumer_drops",
    "romeo_sse_terminal_close_latency_milliseconds",
    "romeo_web_retrieval_milliseconds",
    "romeo_file_upload_pipeline_milliseconds",
  ];
  const missing = required.filter((name) => !metricNames.includes(name));
  if (missing.length > 0) {
    throw new Error(`Missing required metrics: ${missing.join(", ")}`);
  }
}

function assertNoSentinelLeak(rendered, sentinel) {
  if (rendered.includes(sentinel)) {
    throw new Error("Operational monitoring metrics leaked a raw sentinel.");
  }
}

function assertCapabilityFlagMetrics(metrics) {
  const total = metrics.find(
    (candidate) => candidate.name === "romeo_capability_flag_resolutions_total",
  );
  const resolution = metrics.find(
    (candidate) => candidate.name === "romeo_capability_flag_resolution_total",
  );
  if (total?.value !== 2 || resolution?.value !== 2)
    throw new Error("Capability flag operational counters are incomplete.");
  if (
    resolution.labels?.flag !== "image_jobs_v2" ||
    resolution.labels?.state !== "disabled" ||
    resolution.labels?.reason !== "preview_not_allowlisted"
  )
    throw new Error("Capability flag metrics use unexpected labels.");
}

function assertCapabilityAssignmentMetrics(metrics) {
  const total = metrics.find(
    (candidate) => candidate.name === "romeo_capability_resolutions_total",
  );
  const resolution = metrics.find(
    (candidate) => candidate.name === "romeo_capability_resolution_total",
  );
  if (total?.value !== 3 || resolution?.value !== 3)
    throw new Error("Generic capability operational counters are incomplete.");
  if (
    resolution.labels?.capability !== "web_retrieval" ||
    resolution.labels?.status !== "not_allowed"
  )
    throw new Error("Generic capability metrics use unexpected labels.");
}

function assertIdempotencyMetrics(metrics) {
  const replay = metrics.find(
    (candidate) => candidate.name === "romeo_idempotency_outcome_total",
  );
  if (
    replay?.value !== 3 ||
    replay.labels?.operation !== "images.generate" ||
    replay.labels?.outcome !== "replay"
  )
    throw new Error("Idempotency operational counters are incomplete.");
}

function assertApiDeprecationMetrics(allMetrics) {
  const deprecationMetrics = allMetrics.filter((metric) =>
    metric.name.startsWith("romeo_api_deprecat"),
  );
  if (deprecationMetrics.length === 0)
    throw new Error("API deprecation metrics are missing.");
  const forbidden = new Set([
    "tenant",
    "tenant_id",
    "org_id",
    "subject",
    "user_id",
    "path",
    "resource_id",
    "query",
  ]);
  for (const metric of deprecationMetrics)
    for (const label of Object.keys(metric.labels ?? {}))
      if (forbidden.has(label))
        throw new Error(`API deprecation metric has forbidden label ${label}.`);
  const requests = deprecationMetrics.filter(
    (metric) => metric.name === "romeo_api_deprecated_requests_total",
  );
  if (requests.reduce((sum, metric) => sum + metric.value, 0) !== 2)
    throw new Error("API deprecation request totals are inconsistent.");
}

function assertPrometheusRule(docs, alertRules) {
  const rule = docs.find((doc) => doc.kind === "PrometheusRule");
  if (rule === undefined) {
    throw new Error(
      "deploy/monitoring/prometheus-rules.yaml is missing a PrometheusRule.",
    );
  }
  if (alertRules.length < 6) {
    throw new Error("PrometheusRule should include the core Romeo alerts.");
  }
  for (const alert of alertRules) {
    if (typeof alert.alert !== "string" || alert.alert.length === 0) {
      throw new Error("Prometheus alert is missing an alert name.");
    }
    if (typeof alert.expr !== "string" || alert.expr.length === 0) {
      throw new Error(`${alert.alert} is missing an expression.`);
    }
    if (
      typeof alert.labels?.severity !== "string" ||
      !["critical", "warning"].includes(alert.labels.severity)
    ) {
      throw new Error(
        `${alert.alert} is missing a warning/critical severity label.`,
      );
    }
  }
}

function assertExporterDeployment(docs) {
  const deployment = docs.find((doc) => doc.kind === "Deployment");
  const service = docs.find((doc) => doc.kind === "Service");
  if (deployment === undefined || service === undefined) {
    throw new Error(
      "Operational exporter example must contain Deployment and Service.",
    );
  }
  const container = deployment.spec?.template?.spec?.containers?.[0];
  if (container === undefined) {
    throw new Error(
      "Operational exporter Deployment is missing its container.",
    );
  }
  const commandText = JSON.stringify([container.command, container.args]);
  if (
    !commandText.includes("monitoring:export") ||
    !commandText.includes("--listen")
  ) {
    throw new Error(
      "Operational exporter Deployment must run the monitoring exporter in listen mode.",
    );
  }
  if (!String(container.image).startsWith("romeo/ops:")) {
    throw new Error(
      "Operational exporter Deployment must use the script-bearing ops image.",
    );
  }
  if (
    !container.env?.some(
      (env) =>
        env.name === "ROMEO_API_KEY" &&
        env.valueFrom?.secretKeyRef?.name !== undefined,
    )
  ) {
    throw new Error(
      "Operational exporter Deployment must read ROMEO_API_KEY from a Secret.",
    );
  }
  const securityContext = container.securityContext ?? {};
  if (
    securityContext.allowPrivilegeEscalation !== false ||
    securityContext.readOnlyRootFilesystem !== true ||
    securityContext.runAsNonRoot !== true
  ) {
    throw new Error(
      "Operational exporter container must use restricted security settings.",
    );
  }
  if (!service.spec?.ports?.some((port) => port.name === "metrics")) {
    throw new Error("Operational exporter Service must expose a metrics port.");
  }
  if (container.readinessProbe?.httpGet?.path !== "/ready") {
    throw new Error(
      "Operational exporter readiness must use the dependency-aware /ready endpoint.",
    );
  }
  if (container.livenessProbe?.httpGet?.path !== "/health") {
    throw new Error(
      "Operational exporter liveness must use the process-only /health endpoint.",
    );
  }
  if (
    !commandText.includes("--timeout-ms") ||
    Number(container.readinessProbe?.timeoutSeconds) <= 0
  ) {
    throw new Error(
      "Operational exporter readiness must bound both the upstream request and Kubernetes probe.",
    );
  }
}

async function assertReadinessProbeBehavior() {
  const ready = await probeOperationalReadiness({}, async () => []);
  const unavailable = await probeOperationalReadiness({}, async () => {
    throw new Error("synthetic upstream failure");
  });
  if (!ready || unavailable) {
    throw new Error(
      "Operational exporter readiness must pass only when its summary scrape succeeds.",
    );
  }
}

async function assertExporterHttpBehavior() {
  let upstreamAvailable = true;
  const server = createOperationalMonitoringServer(
    {},
    {
      scrape: async () => {
        if (!upstreamAvailable) throw new Error("synthetic upstream failure");
        return metrics;
      },
    },
  );
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Operational exporter test server has no TCP address.");
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${origin}/health`);
    const ready = await fetch(`${origin}/ready`);
    upstreamAvailable = false;
    const unavailable = await fetch(`${origin}/ready`);
    const failureMetrics = await fetch(`${origin}/metrics`);
    const failureBody = await failureMetrics.text();
    if (
      health.status !== 200 ||
      ready.status !== 200 ||
      unavailable.status !== 503 ||
      failureMetrics.status !== 200 ||
      !failureBody.includes("romeo_operational_exporter_up 0")
    ) {
      throw new Error(
        "Operational exporter HTTP endpoints do not preserve liveness/readiness/failure-metric semantics.",
      );
    }
  } finally {
    await new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => {
        if (error === undefined) resolvePromise();
        else rejectPromise(error);
      });
    });
  }
}

function collectAlertRules(docs) {
  return docs
    .filter((doc) => doc.kind === "PrometheusRule")
    .flatMap((doc) => doc.spec?.groups ?? [])
    .flatMap((group) => group.rules ?? [])
    .filter((rule) => rule.alert !== undefined);
}

function metricNamesFromRules(alertRules) {
  const names = new Set();
  for (const rule of alertRules) {
    for (const match of String(rule.expr).matchAll(
      /\bromeo_[a-zA-Z0-9_:]+/gu,
    )) {
      names.add(match[0]);
    }
  }
  return names;
}

function readYamlDocuments(path) {
  return parseAllDocuments(readFileSync(path, "utf8"))
    .map((doc) => doc.toJSON())
    .filter((doc) => doc !== null);
}

function writeEvidence(value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (outputPath === undefined) {
    process.stdout.write(body);
    return;
  }
  const resolved = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, body, "utf8");
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
