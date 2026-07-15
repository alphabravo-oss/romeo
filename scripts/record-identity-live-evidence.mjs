import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const requiredChecks = [
  "managed_secret_backend_live",
  "configured_idp_login_live",
  "directory_lookup_live",
  "group_mapping_validation_live",
  "directory_sync_preview_live",
  "directory_sync_apply_live",
  "deprovision_or_scim_lifecycle_live",
  "access_review_readback",
  "identity_log_redaction",
  "identity_evidence_redaction_reviewed",
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

const identityProviders = {
  configuredProviderCount: nonNegativeInteger(
    argValue("--configured-provider-count"),
    { fallback: "2", label: "--configured-provider-count" },
  ),
  liveLoginProviderCount: nonNegativeInteger(
    argValue("--live-login-provider-count"),
    { fallback: "2", label: "--live-login-provider-count" },
  ),
  oidcProviderCount: nonNegativeInteger(argValue("--oidc-provider-count"), {
    fallback: "1",
    label: "--oidc-provider-count",
  }),
  oauth2ProviderCount: nonNegativeInteger(argValue("--oauth2-provider-count"), {
    fallback: "0",
    label: "--oauth2-provider-count",
  }),
  ldapProviderCount: nonNegativeInteger(argValue("--ldap-provider-count"), {
    fallback: "1",
    label: "--ldap-provider-count",
  }),
  samlProviderCount: nonNegativeInteger(argValue("--saml-provider-count"), {
    fallback: "0",
    label: "--saml-provider-count",
  }),
  localFallbackVerified: booleanArg("--local-fallback-verified", true),
  mfaFallbackVerified: booleanArg("--mfa-fallback-verified", true),
};

const secretBackends = {
  managedSecretBackendCount: nonNegativeInteger(
    argValue("--managed-secret-backend-count"),
    { fallback: "1", label: "--managed-secret-backend-count" },
  ),
  vaultSecretWriteCount: nonNegativeInteger(
    argValue("--vault-secret-write-count"),
    { fallback: "1", label: "--vault-secret-write-count" },
  ),
  externalSecretReferenceCount: nonNegativeInteger(
    argValue("--external-secret-reference-count"),
    { fallback: "1", label: "--external-secret-reference-count" },
  ),
  secretResolutionCheckCount: nonNegativeInteger(
    argValue("--secret-resolution-check-count"),
    { fallback: "1", label: "--secret-resolution-check-count" },
  ),
};

const directory = {
  directoryProviderCount: nonNegativeInteger(
    argValue("--directory-provider-count"),
    { fallback: "1", label: "--directory-provider-count" },
  ),
  directoryLookupCount: nonNegativeInteger(
    argValue("--directory-lookup-count"),
    {
      fallback: "1",
      label: "--directory-lookup-count",
    },
  ),
  mappedGroupCount: nonNegativeInteger(argValue("--mapped-group-count"), {
    fallback: "1",
    label: "--mapped-group-count",
  }),
  workspaceMappingCount: nonNegativeInteger(
    argValue("--workspace-mapping-count"),
    { fallback: "1", label: "--workspace-mapping-count" },
  ),
  directorySyncPreviewChangeCount: nonNegativeInteger(
    argValue("--directory-sync-preview-change-count"),
    { fallback: "1", label: "--directory-sync-preview-change-count" },
  ),
  directorySyncAppliedChangeCount: nonNegativeInteger(
    argValue("--directory-sync-applied-change-count"),
    { fallback: "1", label: "--directory-sync-applied-change-count" },
  ),
  policyViolationCount: nonNegativeInteger(
    argValue("--policy-violation-count"),
    { fallback: "0", label: "--policy-violation-count" },
  ),
};

const lifecycle = {
  deprovisionedUserCount: nonNegativeInteger(
    argValue("--deprovisioned-user-count"),
    { fallback: "1", label: "--deprovisioned-user-count" },
  ),
  scimUserLifecycleCount: nonNegativeInteger(
    argValue("--scim-user-lifecycle-count"),
    { fallback: "1", label: "--scim-user-lifecycle-count" },
  ),
  scimGroupLifecycleCount: nonNegativeInteger(
    argValue("--scim-group-lifecycle-count"),
    { fallback: "1", label: "--scim-group-lifecycle-count" },
  ),
  disabledUserCount: nonNegativeInteger(argValue("--disabled-user-count"), {
    fallback: "1",
    label: "--disabled-user-count",
  }),
  revokedSessionCount: nonNegativeInteger(argValue("--revoked-session-count"), {
    fallback: "1",
    label: "--revoked-session-count",
  }),
};

const accessReview = {
  checked: booleanArg("--access-review-checked", true),
  reportUserCount: nonNegativeInteger(argValue("--access-review-user-count"), {
    fallback: "1",
    label: "--access-review-user-count",
  }),
  reportGroupCount: nonNegativeInteger(
    argValue("--access-review-group-count"),
    {
      fallback: "1",
      label: "--access-review-group-count",
    },
  ),
  reportGrantCount: nonNegativeInteger(
    argValue("--access-review-grant-count"),
    {
      fallback: "1",
      label: "--access-review-grant-count",
    },
  ),
  exportedCsv: booleanArg("--access-review-exported-csv", true),
};

const failureCodes = argValues("--failure-code");
const failures = validationFailures();
if (status === "passed" && failures.length > 0) {
  throw new Error(
    `Passed identity live evidence is invalid: ${failures.join(", ")}`,
  );
}
if (status === "passed" && failureCodes.length > 0) {
  throw new Error("--failure-code can only be supplied with failed/planned.");
}

const evidence = {
  schemaVersion: "romeo.identity-live-evidence.v1",
  generatedAt: new Date().toISOString(),
  status,
  mode,
  deployment,
  checks: [...requiredChecks],
  identityProviders,
  secretBackends,
  directory,
  lifecycle,
  accessReview,
  failures:
    status === "passed" ? [] : [...new Set([...failureCodes, ...failures])],
  redaction: {
    evidenceFileBodiesReturned: false,
    rawDirectoryEntriesReturned: false,
    rawEmailAddressesReturned: false,
    rawEvidencePathsReturned: false,
    rawGroupNamesReturned: false,
    rawIdpResponsesReturned: false,
    rawLdapDnsReturned: false,
    rawProviderEndpointsReturned: false,
    rawSamlAssertionsReturned: false,
    rawSecretRefsReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
  },
};

writeJson(resolve(process.cwd(), output), evidence);
console.log(`Wrote identity live evidence to ${output}`);

function validationFailures() {
  const failures = [];
  if (mode !== "live") failures.push("live_mode_required");
  if (
    secretBackends.managedSecretBackendCount <= 0 ||
    secretBackends.secretResolutionCheckCount <= 0
  ) {
    failures.push("managed_secret_backend_missing");
  }
  if (
    identityProviders.configuredProviderCount <= 0 ||
    identityProviders.liveLoginProviderCount <= 0
  ) {
    failures.push("idp_login_missing");
  }
  if (
    directory.directoryProviderCount <= 0 ||
    directory.directoryLookupCount <= 0
  ) {
    failures.push("directory_lookup_missing");
  }
  if (directory.mappedGroupCount <= 0 || directory.workspaceMappingCount <= 0) {
    failures.push("group_mapping_missing");
  }
  if (
    directory.directorySyncPreviewChangeCount <= 0 ||
    directory.directorySyncAppliedChangeCount <= 0
  ) {
    failures.push("directory_sync_missing");
  }
  if (directory.policyViolationCount > 0) {
    failures.push("policy_violations_present");
  }
  if (
    lifecycle.deprovisionedUserCount +
      lifecycle.scimUserLifecycleCount +
      lifecycle.scimGroupLifecycleCount +
      lifecycle.disabledUserCount <=
    0
  ) {
    failures.push("identity_lifecycle_missing");
  }
  if (
    !accessReview.checked ||
    accessReview.reportUserCount <= 0 ||
    accessReview.reportGroupCount <= 0 ||
    accessReview.reportGrantCount <= 0
  ) {
    failures.push("access_review_missing");
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
