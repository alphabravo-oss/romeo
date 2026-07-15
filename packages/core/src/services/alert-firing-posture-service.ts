import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const alertFiringEvidenceSchema = "romeo.live-alert-firing.v1";
const requiredAlertCategories = ["provider", "queue", "backup"] as const;
const requiredAlertFiringChecks = [
  "required_alert_names_defined",
  "provider_queue_and_backup_categories_present",
  "prometheus_alerts_endpoint_read",
  "required_prometheus_alerts_firing",
  "alert_evidence_redaction_flags",
] as const;
const alertFiringRedactionFields = [
  "bearerTokensReturned",
  "rawPrometheusResponseReturned",
  "rawAlertmanagerResponseReturned",
  "rawPrometheusUrlReturned",
  "rawAlertmanagerUrlReturned",
  "rawAlertPayloadsReturned",
] as const;

type AlertCategory = (typeof requiredAlertCategories)[number] | "custom";
type AlertFiringInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export interface AlertFiringPostureReport {
  schema: "romeo.alert-firing-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: typeof alertFiringEvidenceSchema;
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    invalidReason?: AlertFiringInvalidReason;
    redactionPassed: boolean;
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<(typeof requiredAlertFiringChecks)[number]>;
  };
  requiredAlerts: {
    total: number;
    providerCategoryCount: number;
    queueCategoryCount: number;
    backupCategoryCount: number;
    customCategoryCount: number;
    requiredCategoriesMissing: Array<(typeof requiredAlertCategories)[number]>;
  };
  prometheus: {
    checked: boolean;
    status: "failed" | "passed" | "unknown";
    originConfigured: boolean;
    firingAlertCount: number;
    requiredFiringCount: number;
    requiredFiringMissingCount: number;
  };
  alertmanager: {
    checked: boolean;
    status: "failed" | "passed" | "unknown";
    originConfigured: boolean;
    activeAlertCount: number;
    requiredActiveCount: number;
  };
  redaction: {
    bearerTokensReturned: false;
    evidenceFileBodyReturned: false;
    rawAlertPayloadsReturned: false;
    rawAlertmanagerResponseReturned: false;
    rawAlertmanagerUrlReturned: false;
    rawEvidencePathReturned: false;
    rawPrometheusResponseReturned: false;
    rawPrometheusUrlReturned: false;
    secretValuesReturned: false;
  };
  warnings: Array<
    | "alert_firing_alertmanager_readback_failed"
    | "alert_firing_evidence_failed"
    | "alert_firing_evidence_invalid"
    | "alert_firing_evidence_not_configured"
    | "alert_firing_evidence_not_live"
    | "alert_firing_prometheus_readback_missing"
    | "alert_firing_redaction_missing"
    | "alert_firing_required_alerts_missing"
    | "alert_firing_required_checks_missing"
    | "alert_firing_required_categories_missing"
  >;
}

export class AlertFiringPostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<AlertFiringPostureReport> {
    assertScope(subject, "admin:read");
    const generatedAt = new Date().toISOString();
    const evidence = await readAlertFiringEvidence(
      this.env.ALERT_FIRING_EVIDENCE_PATH,
    );
    if (evidence.status === "not_configured") {
      return emptyReport({
        generatedAt,
        orgId: subject.orgId,
        warnings: ["alert_firing_evidence_not_configured"],
      });
    }
    if (evidence.status === "invalid") {
      return emptyReport({
        generatedAt,
        invalidReason: evidence.invalidReason,
        orgId: subject.orgId,
        warnings: ["alert_firing_evidence_invalid"],
      });
    }

    const summary = summarizeAlertFiringEvidence(evidence.data);
    return {
      schema: "romeo.alert-firing-posture.v1",
      generatedAt,
      orgId: subject.orgId,
      status: summary.warnings.length === 0 ? "ready" : "attention_required",
      ...summary,
    };
  }
}

type ReadEvidenceResult =
  | { status: "not_configured" }
  | { status: "invalid"; invalidReason: AlertFiringInvalidReason }
  | { status: "valid"; data: Record<string, unknown> };

async function readAlertFiringEvidence(
  evidencePath: string,
): Promise<ReadEvidenceResult> {
  const configuredPath = evidencePath.trim();
  if (configuredPath.length === 0) return { status: "not_configured" };
  let raw: string;
  try {
    raw = await readFile(configuredPath, "utf8");
  } catch {
    return { status: "invalid", invalidReason: "read_failed" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", invalidReason: "invalid_json" };
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== alertFiringEvidenceSchema) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }
  return { status: "valid", data: parsed };
}

function emptyReport(input: {
  generatedAt: string;
  invalidReason?: AlertFiringInvalidReason;
  orgId: string;
  warnings: AlertFiringPostureReport["warnings"];
}): AlertFiringPostureReport {
  return {
    schema: "romeo.alert-firing-posture.v1",
    generatedAt: input.generatedAt,
    orgId: input.orgId,
    status: "attention_required",
    evidence: {
      configured: input.invalidReason !== undefined,
      source:
        input.invalidReason === undefined
          ? "not_configured"
          : "configured_file",
      status: input.invalidReason === undefined ? "not_configured" : "invalid",
      ...(input.invalidReason === undefined
        ? {}
        : { invalidReason: input.invalidReason }),
      redactionPassed: false,
      failureCodes:
        input.invalidReason === undefined ? [] : [input.invalidReason],
    },
    checks: {
      total: 0,
      requiredTotal: requiredAlertFiringChecks.length,
      requiredPresent: 0,
      missingRequired: [...requiredAlertFiringChecks],
    },
    requiredAlerts: {
      total: 0,
      providerCategoryCount: 0,
      queueCategoryCount: 0,
      backupCategoryCount: 0,
      customCategoryCount: 0,
      requiredCategoriesMissing: [...requiredAlertCategories],
    },
    prometheus: {
      checked: false,
      status: "unknown",
      originConfigured: false,
      firingAlertCount: 0,
      requiredFiringCount: 0,
      requiredFiringMissingCount: 0,
    },
    alertmanager: {
      checked: false,
      status: "unknown",
      originConfigured: false,
      activeAlertCount: 0,
      requiredActiveCount: 0,
    },
    redaction: reportRedaction(),
    warnings: input.warnings,
  };
}

function summarizeAlertFiringEvidence(
  data: Record<string, unknown>,
): Omit<
  AlertFiringPostureReport,
  "generatedAt" | "orgId" | "schema" | "status"
> {
  const checks = summarizeChecks(data.checks);
  const requiredAlerts = summarizeRequiredAlerts(data.requiredAlerts);
  const alertmanager = summarizeAlertmanager(data.alertmanager);
  const requiredPrometheusAlertMissingCount =
    requiredPrometheusAlertMissingCountFrom(data);
  const prometheus = summarizePrometheus(
    data.prometheus,
    requiredPrometheusAlertMissingCount,
  );
  const redactionPassed = evidenceRedactionPassed(data.redaction);
  const evidenceStatus = statusValue(data.status);
  const mode = modeValue(data.mode);
  const failureCodes = failureCodesForEvidence({
    alertmanager,
    checks,
    evidenceStatus,
    mode,
    prometheus,
    redactionPassed,
    requiredPrometheusAlertMissingCount,
    requiredAlerts,
  });
  const warnings = warningsForFailureCodes(failureCodes, {
    configuredRequiredAlerts: requiredAlerts.total,
    evidenceStatus,
    mode,
    redactionPassed,
  });
  const postureStatus =
    evidenceStatus === "planned" || mode === "dry-run"
      ? "planned"
      : failureCodes.length > 0
        ? "failed"
        : "satisfied";

  return {
    evidence: {
      configured: true,
      source: "configured_file",
      status: postureStatus,
      schemaVersion: alertFiringEvidenceSchema,
      ...(typeof data.generatedAt === "string"
        ? { generatedAt: data.generatedAt }
        : {}),
      evidenceStatus,
      mode,
      redactionPassed,
      failureCodes,
    },
    checks,
    requiredAlerts,
    prometheus,
    alertmanager,
    redaction: reportRedaction(),
    warnings,
  };
}

function summarizeChecks(value: unknown): AlertFiringPostureReport["checks"] {
  const present = new Set(
    array(value).filter((item): item is string => typeof item === "string"),
  );
  const missingRequired = requiredAlertFiringChecks.filter(
    (check) => !present.has(check),
  );
  return {
    total: present.size,
    requiredTotal: requiredAlertFiringChecks.length,
    requiredPresent: requiredAlertFiringChecks.length - missingRequired.length,
    missingRequired,
  };
}

function summarizeRequiredAlerts(
  value: unknown,
): AlertFiringPostureReport["requiredAlerts"] {
  const categories = array(value).map((item) => {
    if (!isRecord(item)) return "custom";
    return alertCategory(item.category);
  });
  const countByCategory = (category: AlertCategory) =>
    categories.filter((item) => item === category).length;
  return {
    total: categories.length,
    providerCategoryCount: countByCategory("provider"),
    queueCategoryCount: countByCategory("queue"),
    backupCategoryCount: countByCategory("backup"),
    customCategoryCount: countByCategory("custom"),
    requiredCategoriesMissing: requiredAlertCategories.filter(
      (category) => countByCategory(category) === 0,
    ),
  };
}

function summarizePrometheus(
  value: unknown,
  requiredFiringMissingCount: number,
): AlertFiringPostureReport["prometheus"] {
  if (!isRecord(value)) {
    return {
      checked: false,
      status: "unknown",
      originConfigured: false,
      firingAlertCount: 0,
      requiredFiringCount: 0,
      requiredFiringMissingCount,
    };
  }
  return {
    checked: true,
    status: statusValue(value.status) === "passed" ? "passed" : "failed",
    originConfigured:
      typeof value.origin === "string" && value.origin.length > 0,
    firingAlertCount: numberValue(value.firingAlertCount),
    requiredFiringCount: array(value.requiredAlertsFiring).length,
    requiredFiringMissingCount,
  };
}

function summarizeAlertmanager(
  value: unknown,
): AlertFiringPostureReport["alertmanager"] {
  if (!isRecord(value)) {
    return {
      checked: false,
      status: "unknown",
      originConfigured: false,
      activeAlertCount: 0,
      requiredActiveCount: 0,
    };
  }
  const checked = value.checked === true;
  return {
    checked,
    status:
      checked && statusValue(value.status) === "passed"
        ? "passed"
        : checked
          ? "failed"
          : "unknown",
    originConfigured:
      typeof value.origin === "string" && value.origin.length > 0,
    activeAlertCount: numberValue(value.activeAlertCount),
    requiredActiveCount: array(value.requiredAlertsActive).length,
  };
}

function failureCodesForEvidence(input: {
  alertmanager: AlertFiringPostureReport["alertmanager"];
  checks: AlertFiringPostureReport["checks"];
  evidenceStatus: AlertFiringPostureReport["evidence"]["evidenceStatus"];
  mode: AlertFiringPostureReport["evidence"]["mode"];
  prometheus: AlertFiringPostureReport["prometheus"];
  redactionPassed: boolean;
  requiredPrometheusAlertMissingCount: number;
  requiredAlerts: AlertFiringPostureReport["requiredAlerts"];
}): string[] {
  const failures: string[] = [];
  if (input.mode !== "live") failures.push("alert_firing_not_live");
  if (input.evidenceStatus !== "passed") {
    failures.push("alert_firing_not_passed");
  }
  for (const check of input.checks.missingRequired) {
    failures.push(`alert_firing_missing_check:${check}`);
  }
  if (input.prometheus.status !== "passed") {
    failures.push("prometheus_alert_readback_missing");
  }
  if (input.requiredAlerts.total === 0) {
    failures.push("required_alerts_missing");
  }
  for (const category of input.requiredAlerts.requiredCategoriesMissing) {
    failures.push(`missing_${category}_alert_category`);
  }
  if (
    input.prometheus.requiredFiringCount < input.requiredAlerts.total ||
    input.requiredPrometheusAlertMissingCount > 0 ||
    input.requiredAlerts.total === 0
  ) {
    failures.push("required_prometheus_alerts_not_firing");
  }
  if (input.alertmanager.checked && input.alertmanager.status !== "passed") {
    failures.push("alertmanager_readback_failed");
  }
  if (!input.redactionPassed) failures.push("alert_firing_redaction_missing");
  return [...new Set(failures)];
}

function requiredPrometheusAlertMissingCountFrom(
  data: Record<string, unknown>,
): number {
  const required = array(data.requiredAlerts);
  const prometheus = isRecord(data.prometheus) ? data.prometheus : {};
  const firing = new Set(alertNameList(prometheus.requiredAlertsFiring));
  return required.filter((item) => {
    const name = isRecord(item) ? item.name : undefined;
    return !(typeof name === "string" && name.length > 0 && firing.has(name));
  }).length;
}

function alertNameList(value: unknown): string[] {
  return array(value)
    .map((item) => (isRecord(item) ? item.name : undefined))
    .filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    );
}

function warningsForFailureCodes(
  failureCodes: string[],
  input: {
    configuredRequiredAlerts: number;
    evidenceStatus: AlertFiringPostureReport["evidence"]["evidenceStatus"];
    mode: AlertFiringPostureReport["evidence"]["mode"];
    redactionPassed: boolean;
  },
): AlertFiringPostureReport["warnings"] {
  const warnings = new Set<AlertFiringPostureReport["warnings"][number]>();
  if (input.mode !== "live") warnings.add("alert_firing_evidence_not_live");
  if (input.evidenceStatus !== "passed")
    warnings.add("alert_firing_evidence_failed");
  if (
    failureCodes.some((code) => code.startsWith("alert_firing_missing_check:"))
  ) {
    warnings.add("alert_firing_required_checks_missing");
  }
  if (failureCodes.includes("prometheus_alert_readback_missing"))
    warnings.add("alert_firing_prometheus_readback_missing");
  if (input.configuredRequiredAlerts === 0)
    warnings.add("alert_firing_required_alerts_missing");
  if (failureCodes.includes("required_prometheus_alerts_not_firing")) {
    warnings.add("alert_firing_required_alerts_missing");
  }
  if (
    failureCodes.some(
      (code) =>
        code === "missing_provider_alert_category" ||
        code === "missing_queue_alert_category" ||
        code === "missing_backup_alert_category",
    )
  )
    warnings.add("alert_firing_required_categories_missing");
  if (failureCodes.includes("alertmanager_readback_failed"))
    warnings.add("alert_firing_alertmanager_readback_failed");
  if (!input.redactionPassed) warnings.add("alert_firing_redaction_missing");
  return [...warnings].sort();
}

function evidenceRedactionPassed(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return alertFiringRedactionFields.every((field) => value[field] === false);
}

function reportRedaction(): AlertFiringPostureReport["redaction"] {
  return {
    bearerTokensReturned: false,
    evidenceFileBodyReturned: false,
    rawAlertPayloadsReturned: false,
    rawAlertmanagerResponseReturned: false,
    rawAlertmanagerUrlReturned: false,
    rawEvidencePathReturned: false,
    rawPrometheusResponseReturned: false,
    rawPrometheusUrlReturned: false,
    secretValuesReturned: false,
  };
}

function alertCategory(value: unknown): AlertCategory {
  if (
    value === "provider" ||
    value === "queue" ||
    value === "backup" ||
    value === "custom"
  ) {
    return value;
  }
  return "custom";
}

function statusValue(
  value: unknown,
): "failed" | "passed" | "planned" | "unknown" {
  if (value === "failed" || value === "passed" || value === "planned") {
    return value;
  }
  return "unknown";
}

function modeValue(value: unknown): "dry-run" | "live" | "unknown" {
  if (value === "dry-run" || value === "live") return value;
  return "unknown";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
