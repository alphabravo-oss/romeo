import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const requiredChecks = [
  "app_database_purge_executed",
  "app_object_store_purge_executed",
  "external_vector_store_reviewed",
  "backup_retention_reviewed",
  "operational_log_retention_reviewed",
  "support_bundle_retention_reviewed",
  "external_secret_store_reviewed",
  "tenant_purge_redaction_reviewed",
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
const tenantCount = nonNegativeInteger(argValue("--tenant-count"), {
  fallback: "1",
  label: "--tenant-count",
});
const databasePurgedTenantCount = nonNegativeInteger(
  argValue("--database-purged-tenant-count"),
  { fallback: "1", label: "--database-purged-tenant-count" },
);
const objectStorePurgedTenantCount = nonNegativeInteger(
  argValue("--object-store-purged-tenant-count"),
  { fallback: "1", label: "--object-store-purged-tenant-count" },
);
const externalVectorReviewedTenantCount = nonNegativeInteger(
  argValue("--external-vector-reviewed-tenant-count"),
  { fallback: "1", label: "--external-vector-reviewed-tenant-count" },
);
const backupRetentionReviewedTenantCount = nonNegativeInteger(
  argValue("--backup-retention-reviewed-tenant-count"),
  { fallback: "1", label: "--backup-retention-reviewed-tenant-count" },
);
const operationalLogRetentionReviewedTenantCount = nonNegativeInteger(
  argValue("--operational-log-retention-reviewed-tenant-count"),
  { fallback: "1", label: "--operational-log-retention-reviewed-tenant-count" },
);
const supportBundleReviewedTenantCount = nonNegativeInteger(
  argValue("--support-bundle-reviewed-tenant-count"),
  { fallback: "1", label: "--support-bundle-reviewed-tenant-count" },
);
const externalSecretReviewedTenantCount = nonNegativeInteger(
  argValue("--external-secret-reviewed-tenant-count"),
  { fallback: "1", label: "--external-secret-reviewed-tenant-count" },
);
const postgresRecordCount = nonNegativeInteger(
  argValue("--postgres-record-count"),
  { fallback: "1", label: "--postgres-record-count" },
);
const objectStoreObjectCount = nonNegativeInteger(
  argValue("--object-store-object-count"),
  { fallback: "1", label: "--object-store-object-count" },
);
const externalVectorNamespaceCount = nonNegativeInteger(
  argValue("--external-vector-namespace-count"),
  { fallback: "1", label: "--external-vector-namespace-count" },
);
const backupSystemCount = nonNegativeInteger(
  argValue("--backup-system-count"),
  {
    fallback: "1",
    label: "--backup-system-count",
  },
);
const operationalLogSystemCount = nonNegativeInteger(
  argValue("--operational-log-system-count"),
  { fallback: "1", label: "--operational-log-system-count" },
);
const supportBundleSystemCount = nonNegativeInteger(
  argValue("--support-bundle-system-count"),
  { fallback: "1", label: "--support-bundle-system-count" },
);
const secretStoreCount = nonNegativeInteger(argValue("--secret-store-count"), {
  fallback: "1",
  label: "--secret-store-count",
});
const backupRetentionDays = nonNegativeInteger(
  argValue("--backup-retention-days"),
  { fallback: "90", label: "--backup-retention-days" },
);
const operationalLogRetentionDays = nonNegativeInteger(
  argValue("--operational-log-retention-days"),
  { fallback: "30", label: "--operational-log-retention-days" },
);
const supportBundleRetentionDays = nonNegativeInteger(
  argValue("--support-bundle-retention-days"),
  { fallback: "30", label: "--support-bundle-retention-days" },
);
const failureCodes = argValues("--failure-code");

const failures = validationFailures();
if (status === "passed" && failures.length > 0) {
  throw new Error(
    `Passed tenant purge evidence is invalid: ${failures.join(", ")}`,
  );
}
if (status === "passed" && failureCodes.length > 0) {
  throw new Error("--failure-code can only be supplied with failed/planned.");
}

const evidence = {
  schemaVersion: "romeo.tenant-purge-evidence.v1",
  generatedAt: new Date().toISOString(),
  status,
  mode,
  deployment,
  checks: [...requiredChecks],
  purge: {
    tenantCount,
    databasePurgedTenantCount,
    objectStorePurgedTenantCount,
    externalVectorReviewedTenantCount,
    backupRetentionReviewedTenantCount,
    operationalLogRetentionReviewedTenantCount,
    supportBundleReviewedTenantCount,
    externalSecretReviewedTenantCount,
  },
  storage: {
    postgresRecordCount,
    objectStoreObjectCount,
    externalVectorNamespaceCount,
    backupSystemCount,
    operationalLogSystemCount,
    supportBundleSystemCount,
    secretStoreCount,
  },
  retention: {
    backupRetentionDays,
    operationalLogRetentionDays,
    supportBundleRetentionDays,
  },
  failures:
    status === "passed" ? [] : [...new Set([...failureCodes, ...failures])],
  redaction: {
    backupLocationsReturned: false,
    evidenceFileBodiesReturned: false,
    objectStoreKeysReturned: false,
    operationalLogBodiesReturned: false,
    rawEvidencePathsReturned: false,
    secretValuesReturned: false,
    supportBundleBodiesReturned: false,
    vectorValuesReturned: false,
  },
};

writeJson(resolve(process.cwd(), output), evidence);
console.log(`Wrote tenant purge evidence to ${output}`);

function validationFailures() {
  const failures = [];
  if (mode !== "live") failures.push("live_mode_required");
  if (tenantCount <= 0 || databasePurgedTenantCount <= 0) {
    failures.push("database_purge_missing");
  }
  if (objectStorePurgedTenantCount <= 0) {
    failures.push("object_store_purge_missing");
  }
  if (externalVectorReviewedTenantCount <= 0) {
    failures.push("external_vector_review_missing");
  }
  if (backupRetentionReviewedTenantCount <= 0) {
    failures.push("backup_retention_review_missing");
  }
  if (operationalLogRetentionReviewedTenantCount <= 0) {
    failures.push("operational_log_retention_review_missing");
  }
  if (supportBundleReviewedTenantCount <= 0) {
    failures.push("support_bundle_review_missing");
  }
  if (externalSecretReviewedTenantCount <= 0) {
    failures.push("external_secret_store_review_missing");
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
