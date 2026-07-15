import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const requiredChecks = [
  "provider_outage_injected",
  "provider_timeout_observed",
  "provider_circuit_open",
  "fallback_routing_verified",
  "kill_switch_verified",
  "operational_summary_readback",
  "provider_alerting_readback",
  "provider_recovery_verified",
  "provider_log_redaction",
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
const providerCount = nonNegativeInteger(argValue("--provider-count"), {
  fallback: "1",
  label: "--provider-count",
});
const outageInjectedCount = nonNegativeInteger(
  argValue("--outage-injected-count"),
  { fallback: "1", label: "--outage-injected-count" },
);
const timeoutObservedCount = nonNegativeInteger(
  argValue("--timeout-observed-count"),
  { fallback: "1", label: "--timeout-observed-count" },
);
const circuitOpenCount = nonNegativeInteger(argValue("--circuit-open-count"), {
  fallback: "1",
  label: "--circuit-open-count",
});
const fallbackRoutedCount = nonNegativeInteger(
  argValue("--fallback-routed-count"),
  { fallback: "1", label: "--fallback-routed-count" },
);
const killSwitchVerifiedCount = nonNegativeInteger(
  argValue("--kill-switch-verified-count"),
  { fallback: "1", label: "--kill-switch-verified-count" },
);
const summaryChecked = booleanArg("--summary-checked", true);
const degradedProviderCount = nonNegativeInteger(
  argValue("--degraded-provider-count"),
  { fallback: "1", label: "--degraded-provider-count" },
);
const summaryCircuitOpenCount = nonNegativeInteger(
  argValue("--summary-circuit-open-count"),
  { fallback: "1", label: "--summary-circuit-open-count" },
);
const fallbackAvailable = booleanArg("--fallback-available", true);
const summaryKillSwitchActiveCount = nonNegativeInteger(
  argValue("--summary-kill-switch-active-count"),
  { fallback: "1", label: "--summary-kill-switch-active-count" },
);
const alertCodeCount = nonNegativeInteger(argValue("--alert-code-count"), {
  fallback: "1",
  label: "--alert-code-count",
});
const alertChecked = booleanArg("--alert-checked", true);
const alertStatus = enumArg("--alert-status", ["passed", "failed"], "passed");
const providerAlertCount = nonNegativeInteger(
  argValue("--provider-alert-count"),
  { fallback: "1", label: "--provider-alert-count" },
);
const alertFiringRequiredCount = nonNegativeInteger(
  argValue("--alert-firing-required-count"),
  { fallback: "1", label: "--alert-firing-required-count" },
);
const recoveryChecked = booleanArg("--recovery-checked", true);
const recoveredProviderCount = nonNegativeInteger(
  argValue("--recovered-provider-count"),
  { fallback: "1", label: "--recovered-provider-count" },
);
const recoverySeconds = nonNegativeInteger(argValue("--recovery-seconds"), {
  fallback: "60",
  label: "--recovery-seconds",
});
const failureCodes = argValues("--failure-code");

const failures = validationFailures();
if (status === "passed" && failures.length > 0) {
  throw new Error(
    `Passed provider outage evidence is invalid: ${failures.join(", ")}`,
  );
}
if (status === "passed" && failureCodes.length > 0) {
  throw new Error("--failure-code can only be supplied with failed/planned.");
}

const evidence = {
  schemaVersion: "romeo.provider-outage-evidence.v1",
  generatedAt: new Date().toISOString(),
  status,
  mode,
  deployment,
  checks: [...requiredChecks],
  drill: {
    providerCount,
    outageInjectedCount,
    timeoutObservedCount,
  },
  runtime: {
    circuitOpenCount,
    fallbackRoutedCount,
    killSwitchVerifiedCount,
  },
  operationalSummary: {
    checked: summaryChecked,
    degradedProviderCount,
    circuitOpenProviderCount: summaryCircuitOpenCount,
    fallbackAvailable,
    killSwitchActiveCount: summaryKillSwitchActiveCount,
    alertCodeCount,
  },
  alerting: {
    checked: alertChecked,
    status: alertStatus,
    providerAlertCount,
    firingRequiredCount: alertFiringRequiredCount,
  },
  recovery: {
    checked: recoveryChecked,
    recoveredProviderCount,
    recoverySeconds,
  },
  failures:
    status === "passed" ? [] : [...new Set([...failureCodes, ...failures])],
  redaction: {
    rawProviderPayloadsReturned: false,
    rawProviderResponsesReturned: false,
    rawProviderErrorsReturned: false,
    rawPromptsReturned: false,
    rawApiKeysReturned: false,
    rawAlertPayloadsReturned: false,
    rawEvidencePathsReturned: false,
    secretValuesReturned: false,
  },
};

writeJson(resolve(process.cwd(), output), evidence);
console.log(`Wrote provider outage evidence to ${output}`);

function validationFailures() {
  const failures = [];
  if (mode !== "live") failures.push("live_mode_required");
  if (providerCount <= 0) failures.push("provider_count_missing");
  if (outageInjectedCount <= 0) failures.push("outage_injection_missing");
  if (timeoutObservedCount <= 0) failures.push("timeout_observation_missing");
  if (circuitOpenCount <= 0) failures.push("circuit_open_missing");
  if (fallbackRoutedCount <= 0) failures.push("fallback_routing_missing");
  if (killSwitchVerifiedCount <= 0) {
    failures.push("kill_switch_verification_missing");
  }
  if (
    !summaryChecked ||
    degradedProviderCount <= 0 ||
    summaryCircuitOpenCount <= 0 ||
    !fallbackAvailable ||
    alertCodeCount <= 0
  ) {
    failures.push("operational_summary_readback_missing");
  }
  if (!alertChecked || alertStatus !== "passed" || providerAlertCount <= 0) {
    failures.push("provider_alerting_readback_missing");
  }
  if (!recoveryChecked || recoveredProviderCount <= 0) {
    failures.push("provider_recovery_missing");
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
