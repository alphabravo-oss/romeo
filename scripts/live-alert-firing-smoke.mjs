import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parseAllDocuments } from "yaml";

const outputPath = argValue("--output");
const dryRun = process.argv.includes("--dry-run");
const prometheusUrl =
  argValue("--prometheus-url") ?? process.env.PROMETHEUS_URL;
const alertmanagerUrl =
  argValue("--alertmanager-url") ?? process.env.ALERTMANAGER_URL;
const prometheusToken =
  argValue("--prometheus-bearer-token") ?? process.env.PROMETHEUS_BEARER_TOKEN;
const alertmanagerToken =
  argValue("--alertmanager-bearer-token") ??
  process.env.ALERTMANAGER_BEARER_TOKEN;
const timeoutMs = parsePositiveInteger("--timeout-ms", 10000);
const requiredAlerts = configuredRequiredAlerts();
const ruleAlerts = collectRuleAlerts();

const evidence = dryRun ? plannedEvidence() : await liveEvidence();
writeEvidence(evidence);

function plannedEvidence() {
  return {
    schemaVersion: "romeo.live-alert-firing.v1",
    generatedAt: new Date().toISOString(),
    status: "planned",
    mode: "dry-run",
    checks: [
      "prometheus_url_required_for_live_mode",
      "required_alert_names_defined",
      "provider_queue_and_backup_categories_required",
      "live_prometheus_firing_state_required_for_passed_evidence",
    ],
    requiredAlerts,
    ruleAlerts: ruleAlerts.map((alert) => ({
      name: alert.name,
      severity: alert.severity,
    })),
  };
}

async function liveEvidence() {
  if (prometheusUrl === undefined || prometheusUrl.length === 0) {
    throw new Error("--prometheus-url or PROMETHEUS_URL is required.");
  }
  assertRequiredAlertsDefined();
  assertRequiredCategories();

  const prometheusAlerts = await prometheusJson("/api/v1/alerts");
  const firingAlerts = collectPrometheusFiringAlerts(prometheusAlerts);
  const firingByName = groupByAlertName(firingAlerts);
  const missingFiring = requiredAlerts
    .map((alert) => alert.name)
    .filter((name) => !firingByName.has(name));
  if (missingFiring.length > 0) {
    throw new Error(
      `Required Prometheus alerts are not firing: ${missingFiring.join(", ")}`,
    );
  }

  const alertmanager =
    alertmanagerUrl === undefined
      ? { checked: false }
      : await alertmanagerEvidence();

  return {
    schemaVersion: "romeo.live-alert-firing.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    checks: [
      "required_alert_names_defined",
      "provider_queue_and_backup_categories_present",
      "prometheus_alerts_endpoint_read",
      "required_prometheus_alerts_firing",
      "alert_evidence_redaction_flags",
      ...(alertmanager.checked
        ? ["alertmanager_alerts_endpoint_read", "required_alerts_routed"]
        : []),
    ],
    requiredAlerts,
    prometheus: {
      status: "passed",
      origin: safeOrigin(prometheusUrl),
      requiredAlertsFiring: requiredAlerts.map((alert) => ({
        name: alert.name,
        category: alert.category,
        severity: firstSeverity(firingByName.get(alert.name)),
        activeAt: firstActiveAt(firingByName.get(alert.name)),
      })),
      firingAlertCount: firingAlerts.length,
    },
    alertmanager,
    redaction: {
      bearerTokensReturned: false,
      rawPrometheusResponseReturned: false,
      rawAlertmanagerResponseReturned: false,
      rawPrometheusUrlReturned: false,
      rawAlertmanagerUrlReturned: false,
      rawAlertPayloadsReturned: false,
    },
  };
}

async function alertmanagerEvidence() {
  const alerts = await fetchJson(alertmanagerUrl, "/api/v2/alerts", {
    token: alertmanagerToken,
  });
  const activeAlerts = array(alerts).filter((alert) => {
    const status = alert.status?.state;
    return status === undefined || status === "active";
  });
  const activeNames = new Set(
    activeAlerts
      .map((alert) => alert.labels?.alertname)
      .filter((name) => typeof name === "string" && name.length > 0),
  );
  const missing = requiredAlerts
    .map((alert) => alert.name)
    .filter((name) => !activeNames.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Required Alertmanager alerts are not active: ${missing.join(", ")}`,
    );
  }
  return {
    checked: true,
    status: "passed",
    origin: safeOrigin(alertmanagerUrl),
    requiredAlertsActive: requiredAlerts.map((alert) => ({
      name: alert.name,
      category: alert.category,
    })),
    activeAlertCount: activeAlerts.length,
  };
}

function configuredRequiredAlerts() {
  const explicit = repeatedArgValues("--required-alert");
  if (explicit.length > 0) {
    return explicit.map((name) => ({ name, category: categoryForAlert(name) }));
  }
  const envConfigured = splitCsv(process.env.ALERT_FIRING_REQUIRED_ALERTS);
  if (envConfigured.length > 0) {
    return envConfigured.map((name) => ({
      name,
      category: categoryForAlert(name),
    }));
  }
  return [
    { name: "RomeoProviderCircuitOpen", category: "provider" },
    { name: "RomeoBackgroundJobQueuedLag", category: "queue" },
    { name: "RomeoBackgroundJobDeadLetters", category: "queue" },
    { name: "RomeoPostgresBackupJobFailed", category: "backup" },
  ];
}

function collectRuleAlerts() {
  return parseAllDocuments(
    readFileSync("deploy/monitoring/prometheus-rules.yaml", "utf8"),
  )
    .map((doc) => doc.toJSON())
    .filter((doc) => doc?.kind === "PrometheusRule")
    .flatMap((doc) => doc.spec?.groups ?? [])
    .flatMap((group) => group.rules ?? [])
    .filter((rule) => typeof rule.alert === "string")
    .map((rule) => ({
      name: rule.alert,
      severity: rule.labels?.severity,
    }));
}

function assertRequiredAlertsDefined() {
  const definedNames = new Set(ruleAlerts.map((alert) => alert.name));
  const missing = requiredAlerts
    .map((alert) => alert.name)
    .filter((name) => !definedNames.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Required alert names are not defined in deploy/monitoring/prometheus-rules.yaml: ${missing.join(", ")}`,
    );
  }
}

function assertRequiredCategories() {
  const categories = new Set(requiredAlerts.map((alert) => alert.category));
  for (const category of ["provider", "queue", "backup"]) {
    if (!categories.has(category)) {
      throw new Error(`Required alert category is missing: ${category}`);
    }
  }
}

async function prometheusJson(path) {
  return fetchJson(prometheusUrl, path, { token: prometheusToken });
}

async function fetchJson(baseUrl, path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetch(new URL(path, normalizedBaseUrl(baseUrl)), {
      headers:
        options.token === undefined || options.token.length === 0
          ? { accept: "application/json" }
          : {
              accept: "application/json",
              authorization: `Bearer ${options.token}`,
            },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${path} returned HTTP ${response.status}.`);
    }
    const body = text.length === 0 ? undefined : JSON.parse(text);
    if (body?.status !== undefined && body.status !== "success") {
      throw new Error(`${path} returned status ${body.status}.`);
    }
    return body?.data ?? body;
  } finally {
    clearTimeout(timeout);
  }
}

function collectPrometheusFiringAlerts(input) {
  return array(input?.alerts)
    .filter((alert) => alert.state === "firing")
    .map((alert) => ({
      name: alert.labels?.alertname,
      severity: alert.labels?.severity,
      activeAt: alert.activeAt,
    }))
    .filter((alert) => typeof alert.name === "string" && alert.name.length > 0);
}

function groupByAlertName(alerts) {
  const byName = new Map();
  for (const alert of alerts) {
    const existing = byName.get(alert.name) ?? [];
    existing.push(alert);
    byName.set(alert.name, existing);
  }
  return byName;
}

function firstSeverity(alerts) {
  return alerts?.find((alert) => typeof alert.severity === "string")?.severity;
}

function firstActiveAt(alerts) {
  return alerts?.find((alert) => typeof alert.activeAt === "string")?.activeAt;
}

function categoryForAlert(name) {
  const normalized = name.toLowerCase();
  if (normalized.includes("backup")) return "backup";
  if (normalized.includes("job") || normalized.includes("queue")) {
    return "queue";
  }
  if (normalized.includes("provider")) return "provider";
  return "custom";
}

function safeOrigin(value) {
  return new URL(value).origin;
}

function normalizedBaseUrl(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function array(value) {
  return Array.isArray(value) ? value : [];
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

function parsePositiveInteger(name, fallback) {
  const raw = argValue(name);
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function repeatedArgValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) values.push(process.argv[index + 1]);
  }
  return values.filter(
    (value) => typeof value === "string" && value.length > 0,
  );
}

function splitCsv(value) {
  if (typeof value !== "string" || value.length === 0) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
