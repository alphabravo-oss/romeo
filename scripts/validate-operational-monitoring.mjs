import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parseAllDocuments } from "yaml";

import {
  buildOperationalMetrics,
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
assertPrometheusRule(ruleDocs, alertRules);
assertExporterDeployment(exporterDocs);
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
    "romeo_background_job_alert",
    "romeo_background_job_dead_letter_jobs",
    "romeo_background_job_longest_running_seconds",
    "romeo_background_job_oldest_queued_seconds",
    "romeo_background_job_recent_failed_jobs",
    "romeo_background_job_status_count",
    "romeo_operational_exporter_up",
    "romeo_operational_source_up",
    "romeo_operational_summary_status",
    "romeo_provider_alert",
    "romeo_provider_circuit_consecutive_failures",
    "romeo_provider_circuit_state",
    "romeo_provider_enabled_model_count",
    "romeo_provider_fallback_available",
    "romeo_provider_fallback_configured",
    "romeo_provider_kill_switch_active",
    "romeo_provider_model_count",
    "romeo_provider_status",
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
