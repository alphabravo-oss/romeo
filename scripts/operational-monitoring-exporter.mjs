import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultBaseUrl = "http://127.0.0.1:3000";
const defaultTimeoutMs = 10_000;
const providerSummaryPath = "/api/v1/providers/operational-summary";
const jobSummaryPath = "/api/v1/jobs/operational-summary";

export async function scrapeOperationalMetrics(options = {}) {
  const baseUrl =
    options.baseUrl ?? process.env.ROMEO_BASE_URL ?? defaultBaseUrl;
  const apiKey = options.apiKey ?? process.env.ROMEO_API_KEY;
  const timeoutMs = positiveInteger(
    options.timeoutMs ?? defaultTimeoutMs,
    "timeoutMs",
  );

  if (options.fixtureFile !== undefined) {
    const fixture = JSON.parse(readFileSync(options.fixtureFile, "utf8"));
    return buildOperationalMetrics({
      providerSummary:
        fixture.providerOperationalSummary ?? fixture.providers ?? fixture,
      jobSummary: fixture.jobOperationalSummary ?? fixture.jobs ?? fixture,
      scrape: { providerUp: 1, jobUp: 1 },
    });
  }

  const [providerSummary, jobSummary] = await Promise.all([
    fetchSummary({ apiKey, baseUrl, path: providerSummaryPath, timeoutMs }),
    fetchSummary({ apiKey, baseUrl, path: jobSummaryPath, timeoutMs }),
  ]);

  return buildOperationalMetrics({
    providerSummary,
    jobSummary,
    scrape: { providerUp: 1, jobUp: 1 },
  });
}

export function buildOperationalMetrics({
  providerSummary,
  jobSummary,
  scrape,
}) {
  const metrics = [
    metric(
      "romeo_operational_exporter_up",
      "Romeo operational exporter scrape success by source.",
      "gauge",
      scrape.providerUp === 1 && scrape.jobUp === 1 ? 1 : 0,
    ),
    metric(
      "romeo_operational_source_up",
      "Romeo operational summary source scrape success.",
      "gauge",
      scrape.providerUp,
      { source: "providers" },
    ),
    metric(
      "romeo_operational_source_up",
      "Romeo operational summary source scrape success.",
      "gauge",
      scrape.jobUp,
      { source: "jobs" },
    ),
    ...statusMetrics("providers", providerSummary?.status),
    ...statusMetrics("jobs", jobSummary?.status),
  ];

  metrics.push(...providerMetrics(providerSummary));
  metrics.push(...jobMetrics(jobSummary));
  return metrics;
}

export function buildFailureMetrics(source) {
  const providerUp = source === "providers" || source === "all" ? 0 : 1;
  const jobUp = source === "jobs" || source === "all" ? 0 : 1;
  return buildOperationalMetrics({
    providerSummary: undefined,
    jobSummary: undefined,
    scrape: { providerUp, jobUp },
  });
}

export function renderPrometheus(metrics) {
  const definitions = new Map();
  for (const item of metrics) {
    if (!definitions.has(item.name)) {
      definitions.set(item.name, { help: item.help, type: item.type });
    }
  }

  const lines = [];
  for (const [name, definition] of [...definitions.entries()].sort()) {
    lines.push(`# HELP ${name} ${definition.help}`);
    lines.push(`# TYPE ${name} ${definition.type}`);
    for (const item of metrics
      .filter((metricItem) => metricItem.name === name)
      .sort(compareMetrics)) {
      lines.push(renderMetricLine(item));
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function probeOperationalReadiness(
  options = {},
  scrape = scrapeOperationalMetrics,
) {
  try {
    await scrape(options);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const options = {
    apiKey: argValue("--api-key"),
    baseUrl: argValue("--base-url"),
    fixtureFile: argValue("--fixture-file"),
    timeoutMs: optionalPositiveInteger(
      argValue("--timeout-ms"),
      "--timeout-ms",
    ),
  };
  const listen = argValue("--listen");
  if (listen !== undefined) {
    serveMetrics({ ...options, listen });
    return;
  }

  try {
    const metrics = await scrapeOperationalMetrics(options);
    writeOutput(renderPrometheus(metrics));
  } catch {
    writeOutput(renderPrometheus(buildFailureMetrics("all")));
    process.exitCode = 1;
  }
}

function serveMetrics(options) {
  const endpoint = parseListen(options.listen);
  const server = createOperationalMonitoringServer(options);
  server.listen(endpoint.port, endpoint.host, () => {
    console.log(
      `Romeo operational monitoring exporter listening on ${endpoint.host}:${endpoint.port}`,
    );
  });
}

export function createOperationalMonitoringServer(
  options = {},
  dependencies = {},
) {
  const scrape = dependencies.scrape ?? scrapeOperationalMetrics;
  const server = createServer(async (request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("ok\n");
      return;
    }
    if (request.url === "/ready") {
      const ready = await probeOperationalReadiness(options, scrape);
      response.writeHead(ready ? 200 : 503, {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      });
      response.end(ready ? "ready\n" : "not ready\n");
      return;
    }
    if (request.url !== "/metrics") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found\n");
      return;
    }

    try {
      const body = renderPrometheus(await scrape(options));
      response.writeHead(200, {
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
      });
      response.end(body);
    } catch {
      response.writeHead(200, {
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
      });
      response.end(renderPrometheus(buildFailureMetrics("all")));
    }
  });
  return server;
}

async function fetchSummary({ apiKey, baseUrl, path, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetch(new URL(path, normalizedBaseUrl(baseUrl)), {
      headers:
        apiKey === undefined || apiKey.length === 0
          ? {}
          : { authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`summary request failed`);
    const body = await response.json();
    return body?.data ?? body;
  } finally {
    clearTimeout(timeout);
  }
}

function providerMetrics(summary) {
  const metrics = [
    metric(
      "romeo_provider_fallback_available",
      "Whether the configured Romeo provider fallback model is available.",
      "gauge",
      boolNumber(summary?.fallback?.available),
    ),
    metric(
      "romeo_provider_fallback_configured",
      "Whether Romeo has a provider fallback model configured.",
      "gauge",
      boolNumber(summary?.fallback?.configured),
    ),
    metric(
      "romeo_provider_alert_total",
      "Romeo provider operational alert count by code and severity.",
      "gauge",
      Array.isArray(summary?.alerts) ? summary.alerts.length : 0,
    ),
  ];

  for (const alert of array(summary?.alerts)) {
    metrics.push(
      metric(
        "romeo_provider_alert",
        "Romeo provider operational alert presence.",
        "gauge",
        1,
        {
          code: stringLabel(alert.code),
          provider_id: stringLabel(alert.providerId ?? "global"),
          severity: stringLabel(alert.severity),
        },
      ),
    );
  }

  for (const provider of array(summary?.providers)) {
    const labels = {
      provider_id: stringLabel(provider.providerId),
      provider_type: stringLabel(provider.type),
    };
    metrics.push(
      metric(
        "romeo_provider_enabled",
        "Whether a Romeo provider is enabled.",
        "gauge",
        boolNumber(provider.enabled),
        labels,
      ),
      metric(
        "romeo_provider_kill_switch_active",
        "Whether a Romeo provider kill switch is active.",
        "gauge",
        boolNumber(provider.killSwitchActive),
        labels,
      ),
      metric(
        "romeo_provider_model_count",
        "Configured Romeo model count by provider.",
        "gauge",
        numberValue(provider.modelCount),
        labels,
      ),
      metric(
        "romeo_provider_enabled_model_count",
        "Enabled Romeo model count by provider.",
        "gauge",
        numberValue(provider.enabledModelCount),
        labels,
      ),
      metric(
        "romeo_provider_circuit_consecutive_failures",
        "Romeo provider circuit consecutive failure count.",
        "gauge",
        numberValue(provider.circuit?.consecutiveFailures),
        labels,
      ),
      ...providerStatusMetrics(provider),
      ...providerCircuitStateMetrics(provider),
    );
  }

  const runtime = summary?.runtime;
  const apiDeprecations = runtime?.apiDeprecations;
  const capabilityAssignments = runtime?.capabilityAssignments;
  const capabilityFlags = runtime?.capabilityFlags;
  const idempotency = runtime?.idempotency;
  const sse = runtime?.sse;
  const sseLabels = {
    scope: stringLabel(sse?.observationScope ?? "process"),
  };
  metrics.push(
    metric(
      "romeo_api_deprecation_observation_window_seconds",
      "Age of the process-local Romeo API deprecation observation window.",
      "gauge",
      apiDeprecations?.observationWindowSeconds,
      { scope: stringLabel(apiDeprecations?.observationScope ?? "process") },
    ),
    metric(
      "romeo_run_time_to_first_token_milliseconds",
      "Recent Romeo run time to first token.",
      "gauge",
      runtime?.timeToFirstTokenAverageMs,
      { statistic: "average" },
    ),
    metric(
      "romeo_run_time_to_first_token_milliseconds",
      "Recent Romeo run time to first token.",
      "gauge",
      runtime?.timeToFirstTokenP95Ms,
      { statistic: "p95" },
    ),
    metric(
      "romeo_run_output_tokens_per_second",
      "Recent Romeo estimated output-token throughput.",
      "gauge",
      runtime?.outputThroughputAverage,
    ),
    metric(
      "romeo_run_context_input_tokens",
      "Recent Romeo estimated input context size.",
      "gauge",
      runtime?.contextInputTokensAverage,
      { statistic: "average" },
    ),
    metric(
      "romeo_run_queue_wait_milliseconds",
      "Recent Romeo queued-turn wait time.",
      "gauge",
      runtime?.queueWaitP95Ms,
      { statistic: "p95" },
    ),
    metric(
      "romeo_run_recovery_total",
      "Recent Romeo run recovery count.",
      "gauge",
      runtime?.recoveryCount,
    ),
    metric(
      "romeo_sse_reconnect_total",
      "Recent Romeo SSE reconnect count.",
      "gauge",
      runtime?.sseReconnectCount,
    ),
    metric(
      "romeo_sse_disconnect_total",
      "Recent Romeo SSE disconnect count.",
      "gauge",
      runtime?.sseDisconnectCount,
    ),
    metric(
      "romeo_sse_active_streams",
      "Active Romeo run SSE streams on the observed process.",
      "gauge",
      sse?.activeStreams,
      sseLabels,
    ),
    metric(
      "romeo_sse_connection_count",
      "Romeo run SSE connections during the process observation window.",
      "gauge",
      sse?.connectionCount,
      sseLabels,
    ),
    metric(
      "romeo_sse_replayed_rows",
      "Romeo run-event rows replayed for reconnecting SSE clients during the process observation window.",
      "gauge",
      sse?.replayedRowCount,
      sseLabels,
    ),
    metric(
      "romeo_sse_cursor_query_count",
      "Romeo run-event cursor queries during the process observation window.",
      "gauge",
      sse?.cursorQueryCount,
      sseLabels,
    ),
    metric(
      "romeo_sse_cursor_query_rows",
      "Romeo run-event rows returned by cursor queries during the process observation window.",
      "gauge",
      sse?.cursorQueryRowCount,
      sseLabels,
    ),
    metric(
      "romeo_sse_notifier_lag_milliseconds",
      "Romeo run-event notifier-to-cursor delivery lag.",
      "gauge",
      sse?.notifierLagAverageMs,
      { ...sseLabels, statistic: "average" },
    ),
    metric(
      "romeo_sse_notifier_lag_milliseconds",
      "Romeo run-event notifier-to-cursor delivery lag.",
      "gauge",
      sse?.notifierLagP95Ms,
      { ...sseLabels, statistic: "p95" },
    ),
    metric(
      "romeo_sse_notifier_unavailable_count",
      "Romeo run SSE subscriptions that entered bounded polling fallback during the process observation window.",
      "gauge",
      sse?.notifierUnavailableCount,
      sseLabels,
    ),
    metric(
      "romeo_sse_buffered_bytes_high_water",
      "Highest observed Romeo run SSE stream buffer occupancy during the process observation window.",
      "gauge",
      sse?.bufferedBytesHighWater,
      sseLabels,
    ),
    metric(
      "romeo_sse_slow_consumer_drops",
      "Romeo run SSE streams dropped for sustained backpressure during the process observation window.",
      "gauge",
      sse?.slowConsumerDropCount,
      sseLabels,
    ),
    metric(
      "romeo_sse_heartbeat_failures",
      "Romeo run SSE heartbeat enqueue failures during the process observation window.",
      "gauge",
      sse?.heartbeatFailureCount,
      sseLabels,
    ),
    metric(
      "romeo_sse_terminal_close_latency_milliseconds",
      "Romeo run SSE latency from terminal-event enqueue to stream close.",
      "gauge",
      sse?.terminalCloseLatencyAverageMs,
      { ...sseLabels, statistic: "average" },
    ),
    metric(
      "romeo_sse_terminal_close_latency_milliseconds",
      "Romeo run SSE latency from terminal-event enqueue to stream close.",
      "gauge",
      sse?.terminalCloseLatencyP95Ms,
      { ...sseLabels, statistic: "p95" },
    ),
    metric(
      "romeo_provider_error_total",
      "Recent sanitized Romeo provider error count.",
      "gauge",
      runtime?.providerErrorCount,
    ),
    metric(
      "romeo_object_store_error_total",
      "Recent metadata-only Romeo object-store failure count.",
      "gauge",
      runtime?.objectStoreFailureCount,
    ),
    metric(
      "romeo_web_retrieval_milliseconds",
      "Recent Romeo governed web retrieval latency.",
      "gauge",
      runtime?.webRetrievalAverageMs,
      { statistic: "average" },
    ),
    metric(
      "romeo_file_upload_pipeline_milliseconds",
      "Recent Romeo file upload pipeline latency.",
      "gauge",
      runtime?.uploadPipelineAverageMs,
      { statistic: "average" },
    ),
  );

  for (const operation of array(apiDeprecations?.operations)) {
    const labels = { operation: stringLabel(operation.operationId) };
    for (const responseClass of ["1xx", "2xx", "3xx", "4xx", "5xx", "other"]) {
      metrics.push(
        metric(
          "romeo_api_deprecated_requests_total",
          "Requests to deprecated Romeo API operations by bounded response class.",
          "counter",
          operation.responseClasses?.[responseClass],
          { ...labels, response_class: responseClass },
        ),
      );
    }
    metrics.push(
      metric(
        "romeo_api_deprecated_last_use_timestamp_seconds",
        "Unix timestamp of the last deprecated Romeo API operation request in this process, or zero when unused.",
        "gauge",
        isoTimestampSeconds(operation.lastUsedAt),
        labels,
      ),
      metric(
        "romeo_api_deprecation_zero_usage_window_seconds",
        "Current process-local zero-usage window for a deprecated Romeo API operation.",
        "gauge",
        operation.zeroUsageWindowSeconds,
        labels,
      ),
    );
  }
  metrics.push(
    metric(
      "romeo_capability_flag_resolutions_total",
      "Process-local capability flag resolutions across the bounded registry.",
      "counter",
      capabilityFlags?.total,
      { scope: stringLabel(capabilityFlags?.observationScope ?? "process") },
    ),
  );
  for (const resolution of array(capabilityFlags?.resolutions)) {
    metrics.push(
      metric(
        "romeo_capability_flag_resolution_total",
        "Capability flag resolutions by bounded flag, state, and reason.",
        "counter",
        resolution.count,
        {
          flag: stringLabel(resolution.flagId),
          state: stringLabel(resolution.effectiveState),
          reason: stringLabel(resolution.reasonCode),
        },
      ),
    );
  }
  metrics.push(
    metric(
      "romeo_capability_resolutions_total",
      "Process-local generic capability resolutions across the bounded registry.",
      "counter",
      capabilityAssignments?.total,
      {
        scope: stringLabel(
          capabilityAssignments?.observationScope ?? "process",
        ),
      },
    ),
  );
  for (const resolution of array(capabilityAssignments?.resolutions)) {
    metrics.push(
      metric(
        "romeo_capability_resolution_total",
        "Generic capability resolutions by bounded capability and effective status.",
        "counter",
        resolution.count,
        {
          capability: stringLabel(resolution.capabilityId),
          status: stringLabel(resolution.status),
        },
      ),
    );
  }
  for (const outcome of array(idempotency?.outcomes)) {
    metrics.push(
      metric(
        "romeo_idempotency_outcome_total",
        "Durable command idempotency outcomes by bounded operation and result.",
        "counter",
        outcome.count,
        {
          operation: stringLabel(outcome.operation),
          outcome: stringLabel(outcome.outcome),
        },
      ),
    );
  }

  return metrics;
}

function providerStatusMetrics(provider) {
  return ["available", "degraded", "unavailable"].map((status) =>
    metric(
      "romeo_provider_status",
      "Romeo provider operational status.",
      "gauge",
      provider.status === status ? 1 : 0,
      {
        provider_id: stringLabel(provider.providerId),
        provider_type: stringLabel(provider.type),
        status,
      },
    ),
  );
}

function providerCircuitStateMetrics(provider) {
  return ["closed", "half_open", "open"].map((state) =>
    metric(
      "romeo_provider_circuit_state",
      "Romeo provider circuit state.",
      "gauge",
      provider.circuit?.state === state ? 1 : 0,
      {
        provider_id: stringLabel(provider.providerId),
        provider_type: stringLabel(provider.type),
        state,
      },
    ),
  );
}

function jobMetrics(summary) {
  const metrics = [
    ...jobStatusCounts("all", summary?.totals),
    metric(
      "romeo_background_job_recent_failed_jobs",
      "Romeo background jobs failed inside the configured recent lookback.",
      "gauge",
      numberValue(summary?.totals?.recentFailed),
      { type: "all" },
    ),
    metric(
      "romeo_background_job_dead_letter_jobs",
      "Romeo background jobs currently marked as dead letters.",
      "gauge",
      numberValue(summary?.totals?.deadLettered),
      { type: "all" },
    ),
    metric(
      "romeo_background_job_alert_total",
      "Romeo background job operational alert count by metric and severity.",
      "gauge",
      Array.isArray(summary?.alerts) ? summary.alerts.length : 0,
    ),
  ];

  for (const typeSummary of array(summary?.byType)) {
    const type = stringLabel(typeSummary.type);
    metrics.push(
      ...jobStatusCounts(type, typeSummary),
      metric(
        "romeo_background_job_recent_failed_jobs",
        "Romeo background jobs failed inside the configured recent lookback.",
        "gauge",
        numberValue(typeSummary.recentFailed),
        { type },
      ),
      metric(
        "romeo_background_job_dead_letter_jobs",
        "Romeo background jobs currently marked as dead letters.",
        "gauge",
        numberValue(typeSummary.deadLettered),
        { type },
      ),
      metric(
        "romeo_background_job_oldest_queued_seconds",
        "Oldest queued Romeo background job age in seconds.",
        "gauge",
        numberValue(typeSummary.oldestQueuedAgeSeconds),
        { type },
      ),
      metric(
        "romeo_background_job_longest_running_seconds",
        "Longest running Romeo background job age in seconds.",
        "gauge",
        numberValue(typeSummary.longestRunningAgeSeconds),
        { type },
      ),
    );
  }

  for (const alert of array(summary?.alerts)) {
    metrics.push(
      metric(
        "romeo_background_job_alert",
        "Romeo background job operational alert presence.",
        "gauge",
        1,
        {
          metric: stringLabel(alert.metric),
          severity: stringLabel(alert.severity),
          type: stringLabel(alert.type),
        },
      ),
    );
  }

  return metrics;
}

function jobStatusCounts(type, counts) {
  return ["total", "queued", "running", "completed", "failed"].map((status) =>
    metric(
      "romeo_background_job_status_count",
      "Romeo background job count by status.",
      "gauge",
      numberValue(counts?.[status]),
      { status, type },
    ),
  );
}

function statusMetrics(surface, status) {
  return ["healthy", "degraded", "critical"].map((candidate) =>
    metric(
      "romeo_operational_summary_status",
      "Romeo operational summary status by surface.",
      "gauge",
      status === candidate ? 1 : 0,
      { status: candidate, surface },
    ),
  );
}

function metric(name, help, type, value, labels = {}) {
  return { name, help, type, value: numberValue(value), labels };
}

function renderMetricLine(item) {
  const labelEntries = Object.entries(item.labels);
  const labels =
    labelEntries.length === 0
      ? ""
      : `{${labelEntries
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
          .join(",")}}`;
  return `${item.name}${labels} ${item.value}`;
}

function compareMetrics(left, right) {
  return renderMetricLine(left).localeCompare(renderMetricLine(right));
}

function stringLabel(value) {
  return String(value ?? "unknown");
}

function escapeLabelValue(value) {
  return String(value)
    .replace(/\\/gu, "\\\\")
    .replace(/\n/gu, "\\n")
    .replace(/"/gu, '\\"');
}

function boolNumber(value) {
  return value === true ? 1 : 0;
}

function numberValue(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function isoTimestampSeconds(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed / 1_000 : 0;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedBaseUrl(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return number;
}

function optionalPositiveInteger(value, label) {
  return value === undefined ? undefined : positiveInteger(value, label);
}

function parseListen(value) {
  if (/^[0-9]+$/u.test(value)) {
    return { host: "0.0.0.0", port: positiveInteger(value, "--listen") };
  }
  const [host, port] = value.split(":");
  if (host === undefined || host.length === 0 || port === undefined) {
    throw new Error("--listen must be a port or host:port.");
  }
  return { host, port: positiveInteger(port, "--listen port") };
}

function writeOutput(body) {
  const outputPath = argValue("--output");
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
