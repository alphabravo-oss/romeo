import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const identityLiveEvidenceSchema = "romeo.identity-live-evidence.v1";

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
] as const;

const redactionFields = [
  "evidenceFileBodiesReturned",
  "rawDirectoryEntriesReturned",
  "rawEmailAddressesReturned",
  "rawEvidencePathsReturned",
  "rawGroupNamesReturned",
  "rawIdpResponsesReturned",
  "rawLdapDnsReturned",
  "rawProviderEndpointsReturned",
  "rawSamlAssertionsReturned",
  "rawSecretRefsReturned",
  "secretValuesReturned",
  "tokenValuesReturned",
] as const;

type IdentityLiveInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export type IdentityLivePostureWarning =
  | "identity_live_access_review_missing"
  | "identity_live_directory_lookup_missing"
  | "identity_live_directory_sync_missing"
  | "identity_live_deployment_invalid"
  | "identity_live_directory_missing"
  | "identity_live_evidence_failed"
  | "identity_live_evidence_invalid"
  | "identity_live_evidence_not_configured"
  | "identity_live_evidence_not_live"
  | "identity_live_evidence_not_passed"
  | "identity_live_failure_codes_present"
  | "identity_live_group_mapping_missing"
  | "identity_live_lifecycle_missing"
  | "identity_live_login_missing"
  | "identity_live_policy_violations_present"
  | "identity_live_redaction_missing"
  | "identity_live_required_checks_missing"
  | "identity_live_secret_backend_missing";

export interface IdentityLivePostureReport {
  schema: "romeo.identity-live-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: typeof identityLiveEvidenceSchema;
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: IdentityLiveInvalidReason;
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<(typeof requiredChecks)[number]>;
  };
  identityProviders: {
    configuredProviderCount: number;
    liveLoginProviderCount: number;
    oidcProviderCount: number;
    oauth2ProviderCount: number;
    ldapProviderCount: number;
    samlProviderCount: number;
    localFallbackVerified: boolean;
    mfaFallbackVerified: boolean;
  };
  secretBackends: {
    managedSecretBackendCount: number;
    vaultSecretWriteCount: number;
    externalSecretReferenceCount: number;
    secretResolutionCheckCount: number;
  };
  directory: {
    directoryProviderCount: number;
    directoryLookupCount: number;
    mappedGroupCount: number;
    workspaceMappingCount: number;
    directorySyncPreviewChangeCount: number;
    directorySyncAppliedChangeCount: number;
    policyViolationCount: number;
  };
  lifecycle: {
    deprovisionedUserCount: number;
    scimUserLifecycleCount: number;
    scimGroupLifecycleCount: number;
    disabledUserCount: number;
    revokedSessionCount: number;
  };
  accessReview: {
    checked: boolean;
    reportUserCount: number;
    reportGroupCount: number;
    reportGrantCount: number;
    exportedCsv: boolean;
  };
  redaction: {
    evidenceFileBodiesReturned: false;
    rawDirectoryEntriesReturned: false;
    rawEmailAddressesReturned: false;
    rawEvidencePathsReturned: false;
    rawGroupNamesReturned: false;
    rawIdpResponsesReturned: false;
    rawLdapDnsReturned: false;
    rawProviderEndpointsReturned: false;
    rawSamlAssertionsReturned: false;
    rawSecretRefsReturned: false;
    secretValuesReturned: false;
    tokenValuesReturned: false;
  };
  warnings: IdentityLivePostureWarning[];
}

export class IdentityLivePostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<IdentityLivePostureReport> {
    assertScope(subject, "admin:read");
    const generatedAt = new Date().toISOString();
    const evidence = await readEvidence(this.env.IDENTITY_LIVE_EVIDENCE_PATH);

    if (evidence.status === "not_configured") {
      return emptyReport({
        generatedAt,
        orgId: subject.orgId,
        warnings: ["identity_live_evidence_not_configured"],
      });
    }
    if (evidence.status === "invalid") {
      return emptyReport({
        generatedAt,
        invalidReason: evidence.invalidReason,
        orgId: subject.orgId,
        warnings: ["identity_live_evidence_invalid"],
      });
    }

    const summary = summarizeEvidence(evidence.data);
    return {
      schema: "romeo.identity-live-posture.v1",
      generatedAt,
      orgId: subject.orgId,
      status: summary.warnings.length === 0 ? "ready" : "attention_required",
      ...summary,
    };
  }
}

type ReadEvidenceResult =
  | { status: "not_configured" }
  | { status: "invalid"; invalidReason: IdentityLiveInvalidReason }
  | { status: "valid"; data: Record<string, unknown> };

async function readEvidence(evidencePath: string): Promise<ReadEvidenceResult> {
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

  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== identityLiveEvidenceSchema
  ) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }
  return { status: "valid", data: parsed };
}

function emptyReport(input: {
  generatedAt: string;
  invalidReason?: IdentityLiveInvalidReason;
  orgId: string;
  warnings: IdentityLivePostureReport["warnings"];
}): IdentityLivePostureReport {
  return {
    schema: "romeo.identity-live-posture.v1",
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
      failureCodes:
        input.invalidReason === undefined ? [] : [input.invalidReason],
    },
    checks: {
      total: 0,
      requiredTotal: requiredChecks.length,
      requiredPresent: 0,
      missingRequired: [...requiredChecks],
    },
    identityProviders: {
      configuredProviderCount: 0,
      liveLoginProviderCount: 0,
      oidcProviderCount: 0,
      oauth2ProviderCount: 0,
      ldapProviderCount: 0,
      samlProviderCount: 0,
      localFallbackVerified: false,
      mfaFallbackVerified: false,
    },
    secretBackends: {
      managedSecretBackendCount: 0,
      vaultSecretWriteCount: 0,
      externalSecretReferenceCount: 0,
      secretResolutionCheckCount: 0,
    },
    directory: {
      directoryProviderCount: 0,
      directoryLookupCount: 0,
      mappedGroupCount: 0,
      workspaceMappingCount: 0,
      directorySyncPreviewChangeCount: 0,
      directorySyncAppliedChangeCount: 0,
      policyViolationCount: 0,
    },
    lifecycle: {
      deprovisionedUserCount: 0,
      scimUserLifecycleCount: 0,
      scimGroupLifecycleCount: 0,
      disabledUserCount: 0,
      revokedSessionCount: 0,
    },
    accessReview: {
      checked: false,
      reportUserCount: 0,
      reportGroupCount: 0,
      reportGrantCount: 0,
      exportedCsv: false,
    },
    redaction: postureRedaction(),
    warnings: input.warnings,
  };
}

function summarizeEvidence(
  data: Record<string, unknown>,
): Omit<
  IdentityLivePostureReport,
  "generatedAt" | "orgId" | "schema" | "status"
> {
  const checks = summarizeChecks(data.checks);
  const identityProviders = summarizeIdentityProviders(data.identityProviders);
  const secretBackends = summarizeSecretBackends(data.secretBackends);
  const directory = summarizeDirectory(data.directory);
  const lifecycle = summarizeLifecycle(data.lifecycle);
  const accessReview = summarizeAccessReview(data.accessReview);
  const evidenceStatus = statusValue(data.status);
  const mode = modeValue(data.mode);
  const deployment = deploymentValue(data.deployment);
  const generatedAt = stringValue(data.generatedAt);
  const redactionPassed = allRedactionFlagsFalse(data.redaction);
  const hasEvidenceFailureCodes = asArray(data.failures).length > 0;
  const failureCodes = Array.from(
    new Set([
      ...failureCodesForEvidence({
        accessReview,
        checks,
        deployment,
        directory,
        evidenceStatus,
        hasEvidenceFailureCodes,
        identityProviders,
        lifecycle,
        mode,
        redactionPassed,
        secretBackends,
      }),
    ]),
  );
  const warnings = warningsForFailureCodes(failureCodes, {
    evidenceStatus,
    mode,
  });

  return {
    evidence: {
      configured: true,
      source: "configured_file",
      status:
        evidenceStatus === "planned" || mode === "dry-run"
          ? "planned"
          : failureCodes.length > 0
            ? "failed"
            : "satisfied",
      schemaVersion: identityLiveEvidenceSchema,
      ...(generatedAt === undefined ? {} : { generatedAt }),
      evidenceStatus,
      mode,
      deployment,
      failureCodes,
    },
    checks,
    identityProviders,
    secretBackends,
    directory,
    lifecycle,
    accessReview,
    redaction: postureRedaction(),
    warnings,
  };
}

function summarizeChecks(input: unknown): IdentityLivePostureReport["checks"] {
  const checkIds = asArray(input)
    .map((check) => {
      if (typeof check === "string") return check;
      if (isRecord(check) && typeof check.id === "string") return check.id;
      return undefined;
    })
    .filter((check): check is string => check !== undefined);
  const present = new Set(checkIds);
  const missingRequired = requiredChecks.filter((check) => !present.has(check));
  return {
    total: checkIds.length,
    requiredTotal: requiredChecks.length,
    requiredPresent: requiredChecks.length - missingRequired.length,
    missingRequired,
  };
}

function summarizeIdentityProviders(
  input: unknown,
): IdentityLivePostureReport["identityProviders"] {
  const value = recordValue(input);
  return {
    configuredProviderCount: safeCount(value.configuredProviderCount),
    liveLoginProviderCount: safeCount(value.liveLoginProviderCount),
    oidcProviderCount: safeCount(value.oidcProviderCount),
    oauth2ProviderCount: safeCount(value.oauth2ProviderCount),
    ldapProviderCount: safeCount(value.ldapProviderCount),
    samlProviderCount: safeCount(value.samlProviderCount),
    localFallbackVerified: value.localFallbackVerified === true,
    mfaFallbackVerified: value.mfaFallbackVerified === true,
  };
}

function summarizeSecretBackends(
  input: unknown,
): IdentityLivePostureReport["secretBackends"] {
  const value = recordValue(input);
  return {
    managedSecretBackendCount: safeCount(value.managedSecretBackendCount),
    vaultSecretWriteCount: safeCount(value.vaultSecretWriteCount),
    externalSecretReferenceCount: safeCount(value.externalSecretReferenceCount),
    secretResolutionCheckCount: safeCount(value.secretResolutionCheckCount),
  };
}

function summarizeDirectory(
  input: unknown,
): IdentityLivePostureReport["directory"] {
  const value = recordValue(input);
  return {
    directoryProviderCount: safeCount(value.directoryProviderCount),
    directoryLookupCount: safeCount(value.directoryLookupCount),
    mappedGroupCount: safeCount(value.mappedGroupCount),
    workspaceMappingCount: safeCount(value.workspaceMappingCount),
    directorySyncPreviewChangeCount: safeCount(
      value.directorySyncPreviewChangeCount,
    ),
    directorySyncAppliedChangeCount: safeCount(
      value.directorySyncAppliedChangeCount,
    ),
    policyViolationCount: safeCount(value.policyViolationCount),
  };
}

function summarizeLifecycle(
  input: unknown,
): IdentityLivePostureReport["lifecycle"] {
  const value = recordValue(input);
  return {
    deprovisionedUserCount: safeCount(value.deprovisionedUserCount),
    scimUserLifecycleCount: safeCount(value.scimUserLifecycleCount),
    scimGroupLifecycleCount: safeCount(value.scimGroupLifecycleCount),
    disabledUserCount: safeCount(value.disabledUserCount),
    revokedSessionCount: safeCount(value.revokedSessionCount),
  };
}

function summarizeAccessReview(
  input: unknown,
): IdentityLivePostureReport["accessReview"] {
  const value = recordValue(input);
  return {
    checked: value.checked === true,
    reportUserCount: safeCount(value.reportUserCount),
    reportGroupCount: safeCount(value.reportGroupCount),
    reportGrantCount: safeCount(value.reportGrantCount),
    exportedCsv: value.exportedCsv === true,
  };
}

function failureCodesForEvidence(input: {
  accessReview: IdentityLivePostureReport["accessReview"];
  checks: IdentityLivePostureReport["checks"];
  deployment: IdentityLivePostureReport["evidence"]["deployment"];
  directory: IdentityLivePostureReport["directory"];
  evidenceStatus: "failed" | "passed" | "planned" | "unknown";
  hasEvidenceFailureCodes: boolean;
  identityProviders: IdentityLivePostureReport["identityProviders"];
  lifecycle: IdentityLivePostureReport["lifecycle"];
  mode: "dry-run" | "live" | "unknown";
  redactionPassed: boolean;
  secretBackends: IdentityLivePostureReport["secretBackends"];
}): string[] {
  const failures: string[] = [];
  if (input.evidenceStatus !== "passed") {
    failures.push("identity_live_not_passed");
  }
  if (input.mode !== "live") failures.push("identity_live_not_live");
  if (
    input.deployment !== "compose" &&
    input.deployment !== "kubernetes" &&
    input.deployment !== "target"
  ) {
    failures.push("identity_live_deployment_invalid");
  }
  if (input.checks.missingRequired.length > 0) {
    for (const check of input.checks.missingRequired) {
      failures.push(`identity_live_missing_check:${check}`);
    }
  }
  if (
    input.secretBackends.managedSecretBackendCount <= 0 ||
    input.secretBackends.secretResolutionCheckCount <= 0
  ) {
    failures.push("identity_live_secret_backend_missing");
  }
  if (
    input.identityProviders.configuredProviderCount <= 0 ||
    input.identityProviders.liveLoginProviderCount <= 0 ||
    input.identityProviders.localFallbackVerified !== true ||
    input.identityProviders.mfaFallbackVerified !== true
  ) {
    failures.push("identity_live_provider_login_missing");
  }
  if (
    input.directory.directoryProviderCount <= 0 ||
    input.directory.directoryLookupCount <= 0 ||
    input.directory.mappedGroupCount <= 0 ||
    input.directory.workspaceMappingCount <= 0 ||
    input.directory.directorySyncPreviewChangeCount <= 0 ||
    input.directory.directorySyncAppliedChangeCount <= 0 ||
    input.directory.policyViolationCount !== 0
  ) {
    failures.push("identity_live_directory_missing");
  }
  if (
    input.lifecycle.deprovisionedUserCount +
      input.lifecycle.scimUserLifecycleCount +
      input.lifecycle.scimGroupLifecycleCount +
      input.lifecycle.disabledUserCount <=
    0
  ) {
    failures.push("identity_live_lifecycle_missing");
  }
  if (
    !input.accessReview.checked ||
    input.accessReview.reportUserCount <= 0 ||
    input.accessReview.reportGroupCount <= 0 ||
    input.accessReview.reportGrantCount <= 0
  ) {
    failures.push("identity_live_access_review_missing");
  }
  if (input.hasEvidenceFailureCodes) {
    failures.push("identity_live_failure_codes_present");
  }
  if (!input.redactionPassed) failures.push("identity_live_redaction_missing");
  return Array.from(new Set(failures));
}

function warningsForFailureCodes(
  failureCodes: string[],
  input: {
    evidenceStatus: "failed" | "passed" | "planned" | "unknown";
    mode: "dry-run" | "live" | "unknown";
  },
): IdentityLivePostureReport["warnings"] {
  const warnings = new Set<IdentityLivePostureWarning>();
  if (input.evidenceStatus === "failed") {
    warnings.add("identity_live_evidence_failed");
  }
  if (input.evidenceStatus !== "passed") {
    warnings.add("identity_live_evidence_not_passed");
  }
  if (input.mode !== "live") warnings.add("identity_live_evidence_not_live");
  for (const code of failureCodes) {
    if (code.startsWith("identity_live_missing_check:")) {
      warnings.add("identity_live_required_checks_missing");
    } else if (code === "identity_live_deployment_invalid") {
      warnings.add("identity_live_deployment_invalid");
    } else if (code === "identity_live_secret_backend_missing") {
      warnings.add("identity_live_secret_backend_missing");
    } else if (
      code === "identity_live_login_missing" ||
      code === "identity_live_provider_login_missing"
    ) {
      warnings.add("identity_live_login_missing");
    } else if (code === "identity_live_directory_missing") {
      warnings.add("identity_live_directory_missing");
    } else if (code === "identity_live_directory_lookup_missing") {
      warnings.add("identity_live_directory_lookup_missing");
    } else if (code === "identity_live_group_mapping_missing") {
      warnings.add("identity_live_group_mapping_missing");
    } else if (code === "identity_live_directory_sync_missing") {
      warnings.add("identity_live_directory_sync_missing");
    } else if (code === "identity_live_policy_violations_present") {
      warnings.add("identity_live_policy_violations_present");
    } else if (code === "identity_live_lifecycle_missing") {
      warnings.add("identity_live_lifecycle_missing");
    } else if (code === "identity_live_access_review_missing") {
      warnings.add("identity_live_access_review_missing");
    } else if (code === "identity_live_failure_codes_present") {
      warnings.add("identity_live_failure_codes_present");
    } else if (code === "identity_live_redaction_missing") {
      warnings.add("identity_live_redaction_missing");
    }
  }
  return Array.from(warnings);
}

function allRedactionFlagsFalse(input: unknown): boolean {
  const value = recordValue(input);
  return redactionFields.every((field) => value[field] === false);
}

function postureRedaction(): IdentityLivePostureReport["redaction"] {
  return {
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
  };
}

function statusValue(
  input: unknown,
): "failed" | "passed" | "planned" | "unknown" {
  if (input === "failed" || input === "passed" || input === "planned") {
    return input;
  }
  return "unknown";
}

function modeValue(input: unknown): "dry-run" | "live" | "unknown" {
  if (input === "dry-run" || input === "live") return input;
  return "unknown";
}

function deploymentValue(
  input: unknown,
): "compose" | "kubernetes" | "target" | "unknown" {
  if (input === "compose" || input === "kubernetes" || input === "target") {
    return input;
  }
  return "unknown";
}

function safeCount(input: unknown): number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0
    ? input
    : 0;
}

function stringValue(input: unknown): string | undefined {
  return typeof input === "string" && input.length > 0 ? input : undefined;
}

function recordValue(input: unknown): Record<string, unknown> {
  return isRecord(input) ? input : {};
}

function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
