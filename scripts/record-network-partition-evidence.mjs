import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const requiredChecks = [
  "network_partition_injected",
  "dependency_partition_verified",
  "api_fail_closed_or_degraded",
  "worker_backpressure_verified",
  "recovery_after_partition_verified",
  "alerting_readback",
  "network_policy_or_cni_context_recorded",
  "partition_log_redaction",
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
const partitionInjected = booleanArg("--partition-injected", true);
const partitionedDependencyCount = nonNegativeInteger(
  argValue("--partitioned-dependency-count"),
  { fallback: "1", label: "--partitioned-dependency-count" },
);
const partitionedServiceCount = nonNegativeInteger(
  argValue("--partitioned-service-count"),
  { fallback: "1", label: "--partitioned-service-count" },
);
const partitionDurationSeconds = nonNegativeInteger(
  argValue("--partition-duration-seconds"),
  { fallback: "60", label: "--partition-duration-seconds" },
);
const apiDegraded = booleanArg("--api-degraded", true);
const failClosedCount = nonNegativeInteger(argValue("--fail-closed-count"), {
  fallback: "1",
  label: "--fail-closed-count",
});
const backpressureObserved = booleanArg("--backpressure-observed", true);
const workerStormPrevented = booleanArg("--worker-storm-prevented", true);
const recoveryChecked = booleanArg("--recovery-checked", true);
const recoveredDependencyCount = nonNegativeInteger(
  argValue("--recovered-dependency-count"),
  { fallback: "1", label: "--recovered-dependency-count" },
);
const recoverySeconds = nonNegativeInteger(argValue("--recovery-seconds"), {
  fallback: "60",
  label: "--recovery-seconds",
});
const postRecoveryReadbackPassed = booleanArg(
  "--post-recovery-readback-passed",
  true,
);
const alertChecked = booleanArg("--alert-checked", true);
const alertStatus = enumArg("--alert-status", ["passed", "failed"], "passed");
const partitionAlertCount = nonNegativeInteger(
  argValue("--partition-alert-count"),
  { fallback: "1", label: "--partition-alert-count" },
);
const alertFiringRequiredCount = nonNegativeInteger(
  argValue("--alert-firing-required-count"),
  { fallback: "1", label: "--alert-firing-required-count" },
);
const cniConfirmed = booleanArg("--cni-confirmed", true);
const networkPolicyApplied = booleanArg("--network-policy-applied", true);
const namespaceScoped = booleanArg("--namespace-scoped", true);
const egressPolicyCount = nonNegativeInteger(
  argValue("--egress-policy-count"),
  {
    fallback: "1",
    label: "--egress-policy-count",
  },
);
const failureCodes = argValues("--failure-code");

const failures = validationFailures();
if (status === "passed" && failures.length > 0) {
  throw new Error(
    `Passed network partition evidence is invalid: ${failures.join(", ")}`,
  );
}
if (status === "passed" && failureCodes.length > 0) {
  throw new Error("--failure-code can only be supplied with failed/planned.");
}

const evidence = {
  schemaVersion: "romeo.network-partition-evidence.v1",
  generatedAt: new Date().toISOString(),
  status,
  mode,
  deployment,
  checks: [...requiredChecks],
  drill: {
    partitionInjected,
    partitionedDependencyCount,
    partitionedServiceCount,
    partitionDurationSeconds,
  },
  runtime: {
    apiDegraded,
    failClosedCount,
    backpressureObserved,
    workerStormPrevented,
  },
  recovery: {
    checked: recoveryChecked,
    recoveredDependencyCount,
    recoverySeconds,
    postRecoveryReadbackPassed,
  },
  alerting: {
    checked: alertChecked,
    status: alertStatus,
    partitionAlertCount,
    firingRequiredCount: alertFiringRequiredCount,
  },
  networkContext: {
    cniConfirmed,
    networkPolicyApplied,
    namespaceScoped,
    egressPolicyCount,
  },
  failures:
    status === "passed" ? [] : [...new Set([...failureCodes, ...failures])],
  redaction: {
    rawNetworkEndpointsReturned: false,
    rawPodIpsReturned: false,
    rawPacketCapturesReturned: false,
    rawLogLinesReturned: false,
    rawEvidencePathsReturned: false,
    secretValuesReturned: false,
  },
};

writeJson(resolve(process.cwd(), output), evidence);
console.log(`Wrote network partition evidence to ${output}`);

function validationFailures() {
  const failures = [];
  if (mode !== "live") failures.push("live_mode_required");
  if (!partitionInjected) failures.push("partition_injection_missing");
  if (partitionedDependencyCount <= 0) {
    failures.push("partitioned_dependency_missing");
  }
  if (partitionedServiceCount <= 0)
    failures.push("partitioned_service_missing");
  if (!apiDegraded || failClosedCount <= 0) {
    failures.push("api_fail_closed_or_degraded_missing");
  }
  if (!backpressureObserved || !workerStormPrevented) {
    failures.push("worker_backpressure_missing");
  }
  if (
    !recoveryChecked ||
    recoveredDependencyCount <= 0 ||
    !postRecoveryReadbackPassed
  ) {
    failures.push("recovery_readback_missing");
  }
  if (!alertChecked || alertStatus !== "passed" || partitionAlertCount <= 0) {
    failures.push("alerting_readback_missing");
  }
  if (
    !cniConfirmed ||
    !networkPolicyApplied ||
    !namespaceScoped ||
    egressPolicyCount <= 0
  ) {
    failures.push("network_context_missing");
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
