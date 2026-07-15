import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const requiredChecks = [
  "entitlement_reconcile_worker_cadence",
  "billing_lifecycle_worker_cadence",
  "entitlement_api_readback",
  "lifecycle_api_readback",
  "worker_log_redaction",
  "billing_alerting_readback",
];

const output = argValue("--output");
if (output === undefined || output.length === 0) {
  throw new Error("--output is required.");
}

const status = enumArg("--status", ["passed", "failed", "planned"], "passed");
const mode = enumArg("--mode", ["live", "dry-run"], "live");
const deployment = enumArg(
  "--deployment",
  ["compose", "kubernetes", "target"],
  "kubernetes",
);
const windowMinutes = positiveInteger(argValue("--window-minutes"), {
  fallback: "120",
  label: "--window-minutes",
});
const expectedRunCount = nonNegativeInteger(argValue("--expected-run-count"), {
  fallback: "2",
  label: "--expected-run-count",
});
const observedRunCount = nonNegativeInteger(argValue("--observed-run-count"), {
  fallback: "2",
  label: "--observed-run-count",
});
const missedRunCount = nonNegativeInteger(argValue("--missed-run-count"), {
  fallback: "0",
  label: "--missed-run-count",
});
const entitlementSuccessCount = nonNegativeInteger(
  argValue("--entitlement-success-count"),
  { fallback: "1", label: "--entitlement-success-count" },
);
const entitlementFailureCount = nonNegativeInteger(
  argValue("--entitlement-failure-count"),
  { fallback: "0", label: "--entitlement-failure-count" },
);
const lifecycleSuccessCount = nonNegativeInteger(
  argValue("--lifecycle-success-count"),
  { fallback: "1", label: "--lifecycle-success-count" },
);
const lifecycleFailureCount = nonNegativeInteger(
  argValue("--lifecycle-failure-count"),
  { fallback: "0", label: "--lifecycle-failure-count" },
);
const entitlementScheduleConfigured = booleanArg(
  "--entitlement-schedule-configured",
  true,
);
const lifecycleScheduleConfigured = booleanArg(
  "--lifecycle-schedule-configured",
  true,
);
const entitlementAlertConfigured = booleanArg(
  "--entitlement-alert-configured",
  true,
);
const lifecycleAlertConfigured = booleanArg(
  "--lifecycle-alert-configured",
  true,
);
const entitlementReportHealthy = booleanArg(
  "--entitlement-report-healthy",
  true,
);
const lifecycleReportHealthy = booleanArg("--lifecycle-report-healthy", true);
const mismatchCount = nonNegativeInteger(argValue("--mismatch-count"), {
  fallback: "0",
  label: "--mismatch-count",
});
const dueTransitionCount = nonNegativeInteger(
  argValue("--due-transition-count"),
  { fallback: "0", label: "--due-transition-count" },
);
const alertChecked = booleanArg("--alert-checked", true);
const alertStatus = enumArg("--alert-status", ["passed", "failed"], "passed");
const alertRuleCount = nonNegativeInteger(argValue("--alert-rule-count"), {
  fallback: "2",
  label: "--alert-rule-count",
});
const alertFiringRequiredCount = nonNegativeInteger(
  argValue("--alert-firing-required-count"),
  { fallback: "0", label: "--alert-firing-required-count" },
);
const failureCodes = argValues("--failure-code");

const failures = validationFailures();
if (status === "passed" && failures.length > 0) {
  throw new Error(
    `Passed billing operations evidence is invalid: ${failures.join(", ")}`,
  );
}
if (status === "passed" && failureCodes.length > 0) {
  throw new Error("--failure-code can only be supplied with failed/planned.");
}

const evidence = {
  schemaVersion: "romeo.billing-operations-evidence.v1",
  generatedAt: new Date().toISOString(),
  status,
  mode,
  deployment,
  checks: [...requiredChecks],
  cadence: {
    windowMinutes,
    expectedRunCount,
    observedRunCount,
    missedRunCount,
  },
  workers: {
    entitlementReconcile: {
      configured: entitlementScheduleConfigured,
      scheduleConfigured: entitlementScheduleConfigured,
      lastRunStatus:
        entitlementFailureCount > 0 && entitlementSuccessCount === 0
          ? "failed"
          : "passed",
      successCount: entitlementSuccessCount,
      failureCount: entitlementFailureCount,
      alertConfigured: entitlementAlertConfigured,
    },
    lifecycleEnforce: {
      configured: lifecycleScheduleConfigured,
      scheduleConfigured: lifecycleScheduleConfigured,
      lastRunStatus:
        lifecycleFailureCount > 0 && lifecycleSuccessCount === 0
          ? "failed"
          : "passed",
      successCount: lifecycleSuccessCount,
      failureCount: lifecycleFailureCount,
      alertConfigured: lifecycleAlertConfigured,
    },
  },
  apiReadback: {
    entitlementReportHealthy,
    lifecycleReportHealthy,
    mismatchCount,
    dueTransitionCount,
  },
  alerting: {
    checked: alertChecked,
    status: alertStatus,
    configuredRuleCount: alertRuleCount,
    firingRequiredCount: alertFiringRequiredCount,
  },
  failures:
    status === "passed" ? [] : [...new Set([...failureCodes, ...failures])],
  redaction: {
    rawBillingProviderPayloadsReturned: false,
    rawWorkerLogsReturned: false,
    rawApiKeysReturned: false,
    rawAlertPayloadsReturned: false,
    rawCustomerIdentifiersReturned: false,
    rawEvidencePathsReturned: false,
    secretValuesReturned: false,
  },
};

writeJson(resolve(process.cwd(), output), evidence);
console.log(`Wrote billing operations evidence to ${output}`);

function validationFailures() {
  const failures = [];
  if (mode !== "live") failures.push("live_mode_required");
  if (!entitlementScheduleConfigured) {
    failures.push("entitlement_schedule_missing");
  }
  if (!lifecycleScheduleConfigured) failures.push("lifecycle_schedule_missing");
  if (entitlementSuccessCount <= 0) {
    failures.push("entitlement_success_readback_missing");
  }
  if (lifecycleSuccessCount <= 0) {
    failures.push("lifecycle_success_readback_missing");
  }
  if (observedRunCount < expectedRunCount || missedRunCount > 0) {
    failures.push("billing_cadence_missed");
  }
  if (!entitlementReportHealthy) {
    failures.push("entitlement_api_readback_unhealthy");
  }
  if (!lifecycleReportHealthy)
    failures.push("lifecycle_api_readback_unhealthy");
  if (!alertChecked || alertStatus !== "passed" || alertRuleCount <= 0) {
    failures.push("billing_alerting_readback_missing");
  }
  if (!entitlementAlertConfigured || !lifecycleAlertConfigured) {
    failures.push("billing_worker_alert_missing");
  }
  return failures;
}

function enumArg(name, allowedValues, fallback) {
  const value = argValue(name) ?? fallback;
  if (value === undefined || !allowedValues.includes(value)) {
    throw new Error(`${name} must be one of: ${allowedValues.join(", ")}.`);
  }
  return value;
}

function booleanArg(name, fallback) {
  const value = argValue(name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function positiveInteger(value, options) {
  const resolved = value ?? options.fallback;
  if (resolved === undefined) throw new Error(`${options.label} is required.`);
  const parsed = Number.parseInt(resolved, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${options.label} must be a positive integer.`);
  }
  return parsed;
}

function nonNegativeInteger(value, options) {
  const resolved = value ?? options.fallback;
  if (resolved === undefined) return undefined;
  const parsed = Number.parseInt(resolved, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${options.label} must be a non-negative integer.`);
  }
  return parsed;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1] !== undefined) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
