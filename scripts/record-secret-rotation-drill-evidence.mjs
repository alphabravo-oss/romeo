import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const requiredChecks = [
  "session_secret_staged_dual_read",
  "webhook_signing_key_cutover",
  "local_mfa_envelope_rewrap_verified",
  "managed_secret_envelope_rewrap_verified",
  "old_secret_rejected_or_retired",
  "new_secret_accepted",
  "post_rotation_readiness_verified",
  "dependency_credentials_reviewed",
  "secret_rotation_alerting_readback",
  "secret_rotation_log_redaction",
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
const sessionSecretStaged = booleanArg("--session-secret-staged", true);
const webhookSigningKeyCutover = booleanArg(
  "--webhook-signing-key-cutover",
  true,
);
const apiOrServiceKeyContinuityVerified = booleanArg(
  "--api-or-service-key-continuity-verified",
  true,
);
const localMfaPreviewPassed = booleanArg("--local-mfa-preview-passed", true);
const localMfaRewrappedCount = nonNegativeInteger(
  argValue("--local-mfa-rewrapped-count"),
  { fallback: "1", label: "--local-mfa-rewrapped-count" },
);
const managedSecretsPreviewPassed = booleanArg(
  "--managed-secrets-preview-passed",
  true,
);
const managedSecretsRewrappedCount = nonNegativeInteger(
  argValue("--managed-secrets-rewrapped-count"),
  { fallback: "1", label: "--managed-secrets-rewrapped-count" },
);
const rewrapFailureCount = nonNegativeInteger(
  argValue("--rewrap-failure-count"),
  { fallback: "0", label: "--rewrap-failure-count" },
);
const oldSecretRetiredOrRejectedCount = nonNegativeInteger(
  argValue("--old-secret-retired-or-rejected-count"),
  { fallback: "1", label: "--old-secret-retired-or-rejected-count" },
);
const newSecretAcceptedCount = nonNegativeInteger(
  argValue("--new-secret-accepted-count"),
  { fallback: "1", label: "--new-secret-accepted-count" },
);
const databaseCredentialsReviewed = booleanArg(
  "--database-credentials-reviewed",
  true,
);
const objectStoreCredentialsReviewed = booleanArg(
  "--object-store-credentials-reviewed",
  true,
);
const providerCredentialCount = nonNegativeInteger(
  argValue("--provider-credential-count"),
  { fallback: "1", label: "--provider-credential-count" },
);
const connectorCredentialCount = nonNegativeInteger(
  argValue("--connector-credential-count"),
  { fallback: "1", label: "--connector-credential-count" },
);
const readinessChecked = booleanArg("--readiness-checked", true);
const readinessPassed = booleanArg("--readiness-passed", true);
const postRotationLoginPassed = booleanArg(
  "--post-rotation-login-passed",
  true,
);
const postRotationWebhookPassed = booleanArg(
  "--post-rotation-webhook-passed",
  true,
);
const alertChecked = booleanArg("--alert-checked", true);
const alertStatus = enumArg("--alert-status", ["passed", "failed"], "passed");
const rotationAlertCount = nonNegativeInteger(
  argValue("--rotation-alert-count"),
  { fallback: "1", label: "--rotation-alert-count" },
);
const alertFiringRequiredCount = nonNegativeInteger(
  argValue("--alert-firing-required-count"),
  { fallback: "1", label: "--alert-firing-required-count" },
);
const failureCodes = argValues("--failure-code");

const failures = validationFailures();
if (status === "passed" && failures.length > 0) {
  throw new Error(
    `Passed secret rotation drill evidence is invalid: ${failures.join(", ")}`,
  );
}
if (status === "passed" && failureCodes.length > 0) {
  throw new Error("--failure-code can only be supplied with failed/planned.");
}

const evidence = {
  schemaVersion: "romeo.secret-rotation-drill-evidence.v1",
  generatedAt: new Date().toISOString(),
  status,
  mode,
  deployment,
  checks: [...requiredChecks],
  stagedCutover: {
    sessionSecretStaged,
    webhookSigningKeyCutover,
    apiOrServiceKeyContinuityVerified,
  },
  rewrap: {
    localMfaPreviewPassed,
    localMfaRewrappedCount,
    managedSecretsPreviewPassed,
    managedSecretsRewrappedCount,
    failureCount: rewrapFailureCount,
  },
  acceptance: {
    oldSecretRetiredOrRejectedCount,
    newSecretAcceptedCount,
  },
  dependencies: {
    databaseCredentialsReviewed,
    objectStoreCredentialsReviewed,
    providerCredentialCount,
    connectorCredentialCount,
  },
  readiness: {
    checked: readinessChecked,
    readinessPassed,
    postRotationLoginPassed,
    postRotationWebhookPassed,
  },
  alerting: {
    checked: alertChecked,
    status: alertStatus,
    rotationAlertCount,
    firingRequiredCount: alertFiringRequiredCount,
  },
  failures:
    status === "passed" ? [] : [...new Set([...failureCodes, ...failures])],
  redaction: {
    keyMaterialReturned: false,
    rawApiKeysReturned: false,
    rawEvidencePathsReturned: false,
    rawLogLinesReturned: false,
    rawSecretRefsReturned: false,
    rawSecretValuesReturned: false,
    rawTokensReturned: false,
    webhookSigningSecretsReturned: false,
  },
};

writeJson(resolve(process.cwd(), output), evidence);
console.log(`Wrote secret rotation drill evidence to ${output}`);

function validationFailures() {
  const failures = [];
  if (mode !== "live") failures.push("live_mode_required");
  if (
    !sessionSecretStaged ||
    !webhookSigningKeyCutover ||
    !apiOrServiceKeyContinuityVerified
  ) {
    failures.push("staged_cutover_missing");
  }
  if (
    !localMfaPreviewPassed ||
    !managedSecretsPreviewPassed ||
    rewrapFailureCount > 0
  ) {
    failures.push("envelope_rewrap_missing");
  }
  if (oldSecretRetiredOrRejectedCount <= 0) {
    failures.push("old_secret_retirement_missing");
  }
  if (newSecretAcceptedCount <= 0) {
    failures.push("new_secret_acceptance_missing");
  }
  if (!databaseCredentialsReviewed || !objectStoreCredentialsReviewed) {
    failures.push("dependency_credentials_review_missing");
  }
  if (
    !readinessChecked ||
    !readinessPassed ||
    !postRotationLoginPassed ||
    !postRotationWebhookPassed
  ) {
    failures.push("post_rotation_readiness_missing");
  }
  if (!alertChecked || alertStatus !== "passed" || rotationAlertCount <= 0) {
    failures.push("alerting_readback_missing");
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

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}
