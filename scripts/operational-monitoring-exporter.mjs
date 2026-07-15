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
  const server = createServer(async (request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("ok\n");
      return;
    }
    if (request.url !== "/metrics") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found\n");
      return;
    }

    try {
      response.writeHead(200, {
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
      });
      response.end(renderPrometheus(await scrapeOperationalMetrics(options)));
    } catch {
      response.writeHead(200, {
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
      });
      response.end(renderPrometheus(buildFailureMetrics("all")));
    }
  });
  server.listen(endpoint.port, endpoint.host, () => {
    console.log(
      `Romeo operational monitoring exporter listening on ${endpoint.host}:${endpoint.port}`,
    );
  });
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
