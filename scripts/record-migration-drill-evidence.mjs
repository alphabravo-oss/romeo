import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const requiredChecks = [
  "failed_migration_injected",
  "migration_failure_detected",
  "migration_job_failed_closed",
  "app_cutover_blocked",
  "rollback_or_retry_verified",
  "schema_validation_after_recovery",
  "migration_log_redaction",
  "operator_runbook_reviewed",
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
const attemptedMigrationCount = nonNegativeInteger(
  argValue("--attempted-migration-count"),
  { fallback: "1", label: "--attempted-migration-count" },
);
const failedMigrationCount = nonNegativeInteger(
  argValue("--failed-migration-count"),
  { fallback: "1", label: "--failed-migration-count" },
);
const failureInjected = booleanArg("--failure-injected", true);
const cutoverBlocked = booleanArg("--cutover-blocked", true);
const migrationJobObserved = booleanArg("--migration-job-observed", true);
const failedClosed = booleanArg("--failed-closed", true);
const retryAttemptCount = nonNegativeInteger(
  argValue("--retry-attempt-count"),
  {
    fallback: "1",
    label: "--retry-attempt-count",
  },
);
const rollbackAttemptCount = nonNegativeInteger(
  argValue("--rollback-attempt-count"),
  { fallback: "0", label: "--rollback-attempt-count" },
);
const rollbackOrRetryVerified = booleanArg(
  "--rollback-or-retry-verified",
  true,
);
const schemaValidationPassed = booleanArg("--schema-validation-passed", true);
const appReadinessPassed = booleanArg("--app-readiness-passed", true);
const postRecoveryMigrationCount = nonNegativeInteger(
  argValue("--post-recovery-migration-count"),
  { fallback: "1", label: "--post-recovery-migration-count" },
);
const runbookReviewed = booleanArg("--runbook-reviewed", true);
const recoveryDocumented = booleanArg("--recovery-documented", true);
const reviewerCount = nonNegativeInteger(argValue("--reviewer-count"), {
  fallback: "1",
  label: "--reviewer-count",
});
const failureCodes = argValues("--failure-code");

const failures = validationFailures();
if (status === "passed" && failures.length > 0) {
  throw new Error(
    `Passed migration drill evidence is invalid: ${failures.join(", ")}`,
  );
}
if (status === "passed" && failureCodes.length > 0) {
  throw new Error("--failure-code can only be supplied with failed/planned.");
}

const evidence = {
  schemaVersion: "romeo.migration-drill-evidence.v1",
  generatedAt: new Date().toISOString(),
  status,
  mode,
  deployment,
  checks: [...requiredChecks],
  drill: {
    attemptedMigrationCount,
    failedMigrationCount,
    failureInjected,
    cutoverBlocked,
  },
  job: {
    migrationJobObserved,
    failedClosed,
    retryAttemptCount,
    rollbackAttemptCount,
  },
  validation: {
    rollbackOrRetryVerified,
    schemaValidationPassed,
    appReadinessPassed,
    postRecoveryMigrationCount,
  },
  runbook: {
    reviewed: runbookReviewed,
    recoveryDocumented,
    reviewerCount,
  },
  failures:
    status === "passed" ? [] : [...new Set([...failureCodes, ...failures])],
  redaction: {
    databaseUrlsReturned: false,
    migrationSqlReturned: false,
    migrationLogsReturned: false,
    rawErrorStacksReturned: false,
    rawEvidencePathsReturned: false,
    secretValuesReturned: false,
  },
};

writeJson(resolve(process.cwd(), output), evidence);
console.log(`Wrote migration drill evidence to ${output}`);

function validationFailures() {
  const failures = [];
  if (mode !== "live") failures.push("live_mode_required");
  if (attemptedMigrationCount <= 0) failures.push("migration_attempt_missing");
  if (failedMigrationCount <= 0) failures.push("migration_failure_missing");
  if (!failureInjected) failures.push("failure_injection_missing");
  if (!migrationJobObserved) failures.push("migration_job_readback_missing");
  if (!failedClosed) failures.push("migration_job_fail_closed_missing");
  if (!cutoverBlocked) failures.push("app_cutover_block_missing");
  if (
    !rollbackOrRetryVerified ||
    retryAttemptCount + rollbackAttemptCount <= 0
  ) {
    failures.push("rollback_or_retry_missing");
  }
  if (!schemaValidationPassed) failures.push("schema_validation_missing");
  if (!appReadinessPassed) failures.push("app_readiness_missing");
  if (postRecoveryMigrationCount <= 0) {
    failures.push("post_recovery_migration_missing");
  }
  if (!runbookReviewed || !recoveryDocumented || reviewerCount <= 0) {
    failures.push("operator_runbook_review_missing");
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
