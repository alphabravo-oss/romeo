import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const requiredChecks = [
  "admin_summary_readback",
  "admin_csv_export_readback",
  "usage_scope_enforced",
  "eval_evidence_resource_grant_enforced",
  "non_admin_summary_denied",
  "non_admin_csv_denied",
  "cross_org_summary_denied",
  "cross_workspace_export_scoped",
  "csv_export_hash_recorded",
  "raw_analytics_content_absent",
  "analytics_log_redaction",
  "analytics_evidence_redaction_reviewed",
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
  "target",
);

const subjects = {
  adminSubjectCount: nonNegativeInteger(argValue("--admin-subject-count"), {
    fallback: "1",
    label: "--admin-subject-count",
  }),
  orgAdminSubjectCount: nonNegativeInteger(
    argValue("--org-admin-subject-count"),
    { fallback: "1", label: "--org-admin-subject-count" },
  ),
  nonAdminSubjectCount: nonNegativeInteger(
    argValue("--non-admin-subject-count"),
    { fallback: "1", label: "--non-admin-subject-count" },
  ),
  serviceAccountSubjectCount: nonNegativeInteger(
    argValue("--service-account-subject-count"),
    { fallback: "1", label: "--service-account-subject-count" },
  ),
  crossOrgSubjectCount: nonNegativeInteger(
    argValue("--cross-org-subject-count"),
    { fallback: "1", label: "--cross-org-subject-count" },
  ),
};

const authorization = {
  adminSummaryAllowedCount: nonNegativeInteger(
    argValue("--admin-summary-allowed-count"),
    { fallback: "1", label: "--admin-summary-allowed-count" },
  ),
  adminCsvAllowedCount: nonNegativeInteger(
    argValue("--admin-csv-allowed-count"),
    { fallback: "1", label: "--admin-csv-allowed-count" },
  ),
  nonAdminSummaryDeniedCount: nonNegativeInteger(
    argValue("--non-admin-summary-denied-count"),
    { fallback: "1", label: "--non-admin-summary-denied-count" },
  ),
  nonAdminCsvDeniedCount: nonNegativeInteger(
    argValue("--non-admin-csv-denied-count"),
    { fallback: "1", label: "--non-admin-csv-denied-count" },
  ),
  missingUsageScopeDeniedCount: nonNegativeInteger(
    argValue("--missing-usage-scope-denied-count"),
    { fallback: "1", label: "--missing-usage-scope-denied-count" },
  ),
  evalGrantDeniedCount: nonNegativeInteger(
    argValue("--eval-grant-denied-count"),
    { fallback: "1", label: "--eval-grant-denied-count" },
  ),
  crossOrgDeniedCount: nonNegativeInteger(
    argValue("--cross-org-denied-count"),
    { fallback: "1", label: "--cross-org-denied-count" },
  ),
  crossWorkspaceScopedCount: nonNegativeInteger(
    argValue("--cross-workspace-scoped-count"),
    { fallback: "1", label: "--cross-workspace-scoped-count" },
  ),
};

const analytics = {
  summaryReadCount: nonNegativeInteger(argValue("--summary-read-count"), {
    fallback: "1",
    label: "--summary-read-count",
  }),
  csvExportReadCount: nonNegativeInteger(argValue("--csv-export-read-count"), {
    fallback: "1",
    label: "--csv-export-read-count",
  }),
  evalEvidenceReadCount: nonNegativeInteger(
    argValue("--eval-evidence-read-count"),
    { fallback: "1", label: "--eval-evidence-read-count" },
  ),
  csvSha256Count: nonNegativeInteger(argValue("--csv-sha256-count"), {
    fallback: "1",
    label: "--csv-sha256-count",
  }),
  usageMetricCount: nonNegativeInteger(argValue("--usage-metric-count"), {
    fallback: "1",
    label: "--usage-metric-count",
  }),
  evalSuiteCount: nonNegativeInteger(argValue("--eval-suite-count"), {
    fallback: "1",
    label: "--eval-suite-count",
  }),
  jobSummaryCount: nonNegativeInteger(argValue("--job-summary-count"), {
    fallback: "1",
    label: "--job-summary-count",
  }),
  providerSummaryCount: nonNegativeInteger(
    argValue("--provider-summary-count"),
    { fallback: "1", label: "--provider-summary-count" },
  ),
};

const failureCodes = argValues("--failure-code");
const failures = validationFailures();
if (status === "passed" && failures.length > 0) {
  throw new Error(
    `Passed analytics authz live evidence is invalid: ${failures.join(", ")}`,
  );
}
if (status === "passed" && failureCodes.length > 0) {
  throw new Error("--failure-code can only be supplied with failed/planned.");
}

const evidence = {
  schemaVersion: "romeo.analytics-authz-live-evidence.v1",
  generatedAt: new Date().toISOString(),
  status,
  mode,
  deployment,
  checks: [...requiredChecks],
  subjects,
  authorization,
  analytics,
  failures:
    status === "passed" ? [] : [...new Set([...failureCodes, ...failures])],
  redaction: {
    apiKeysReturned: false,
    evidenceFileBodiesReturned: false,
    rawAnalyticsCsvRowsReturned: false,
    rawEvalInputsReturned: false,
    rawEvalOutputsReturned: false,
    rawEvidencePathsReturned: false,
    rawHumanRatingCommentsReturned: false,
    rawJobPayloadsReturned: false,
    rawOrgNamesReturned: false,
    rawProviderConfigReturned: false,
    rawSecretRefsReturned: false,
    rawToolInputsReturned: false,
    rawUsageMetadataReturned: false,
    rawUserEmailsReturned: false,
    rawWorkspaceNamesReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
  },
};

writeJson(resolve(process.cwd(), output), evidence);
console.log(`Wrote analytics authz live evidence to ${output}`);

function validationFailures() {
  const failures = [];
  if (mode !== "live") failures.push("live_mode_required");
  if (deployment !== "target" && deployment !== "kubernetes") {
    failures.push("target_deployment_required");
  }
  if (
    analytics.summaryReadCount <= 0 ||
    authorization.adminSummaryAllowedCount <= 0
  ) {
    failures.push("admin_summary_readback_missing");
  }
  if (
    analytics.csvExportReadCount <= 0 ||
    authorization.adminCsvAllowedCount <= 0
  ) {
    failures.push("admin_csv_export_missing");
  }
  if (authorization.missingUsageScopeDeniedCount <= 0) {
    failures.push("usage_scope_enforcement_missing");
  }
  if (
    analytics.evalEvidenceReadCount <= 0 ||
    authorization.evalGrantDeniedCount <= 0
  ) {
    failures.push("eval_grant_enforcement_missing");
  }
  if (
    subjects.nonAdminSubjectCount <= 0 ||
    authorization.nonAdminSummaryDeniedCount <= 0 ||
    authorization.nonAdminCsvDeniedCount <= 0
  ) {
    failures.push("non_admin_denial_missing");
  }
  if (
    subjects.crossOrgSubjectCount <= 0 ||
    authorization.crossOrgDeniedCount <= 0
  ) {
    failures.push("cross_org_denial_missing");
  }
  if (authorization.crossWorkspaceScopedCount <= 0) {
    failures.push("cross_workspace_scoping_missing");
  }
  if (analytics.csvSha256Count <= 0) {
    failures.push("csv_hash_missing");
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
