import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const requiredRedactionChecks = [
  "support_bundle_generation",
  "raw_log_content_not_included",
  "raw_evidence_content_not_included",
  "access_review_evidence_linked_without_raw_content",
  "environment_secret_values_not_included",
  "configured_secret_posture_recorded",
  "unrecognized_enum_values_not_included",
] as const;

const bundleRedactionFlags = [
  "rawContentIncluded",
  "secretValuesIncluded",
] as const;

const redactionEvidenceFlags = [
  "rawLogContentReturned",
  "rawEvidenceContentReturned",
  "accessReviewRawContentReturned",
  "environmentSecretValuesReturned",
  "unrecognizedEnumValuesReturned",
] as const;

type SupportBundleInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export type SupportBundlePostureWarning =
  | "support_bundle_evidence_not_configured"
  | "support_bundle_invalid"
  | "support_bundle_not_generated"
  | "support_bundle_redaction_failed"
  | "support_bundle_redaction_invalid"
  | "support_bundle_redaction_not_configured"
  | "support_bundle_redaction_required_checks_missing"
  | "support_bundle_redaction_unsafe";

export interface SupportBundlePostureReport {
  schema: "romeo.support-bundle-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  summary: {
    bundleGenerated: boolean;
    redactionPassed: boolean;
    evidenceFileCount: number;
    accessReviewEvidenceCount: number;
    logFileCount: number;
    migrationFileCount: number;
    deploymentFileCount: number;
    configuredSecretCount: number;
    redactionCheckCount: number;
    requiredRedactionCheckCount: number;
    missingRequiredRedactionCheckCount: number;
  };
  bundle: SupportBundleEvidencePosture;
  redactionEvidence: SupportBundleRedactionEvidencePosture;
  redaction: {
    accessReviewBodiesReturned: false;
    backupLocationsReturned: false;
    connectorPayloadsReturned: false;
    environmentValuesReturned: false;
    evidenceFileBodiesReturned: false;
    logBodiesReturned: false;
    objectStoreKeysReturned: false;
    packageEvidencePathsReturned: false;
    promptsReturned: false;
    providerPayloadsReturned: false;
    rawEvidencePathsReturned: false;
    reportBodiesReturned: false;
    secretValuesReturned: false;
    tokenValuesReturned: false;
    vectorValuesReturned: false;
  };
  warnings: SupportBundlePostureWarning[];
}

export interface SupportBundleEvidencePosture {
  configured: boolean;
  source: "configured_file" | "not_configured";
  status: "generated" | "invalid" | "not_configured" | "unsafe";
  schemaVersion?: "romeo.support-bundle.v1";
  generatedAt?: string;
  invalidReason?: SupportBundleInvalidReason;
  package: {
    nameConfigured: boolean;
    versionConfigured: boolean;
    packageManagerConfigured: boolean;
  };
  runtime: {
    nodeConfigured: boolean;
    platformConfigured: boolean;
    archConfigured: boolean;
  };
  configuration: {
    safeEnumCount: number;
    configuredSafeEnumCount: number;
    unrecognizedSafeEnumCount: number;
    safeNumberCount: number;
    configuredSecretCount: number;
    urlHostConfiguredCount: number;
  };
  deployment: {
    fileCount: number;
  };
  migrations: {
    count: number;
    greenfieldBaselineOnly: boolean;
  };
  evidence: {
    fileCount: number;
    schemaVersionCount: number;
    generatedStatusCount: number;
    releaseVersionCount: number;
  };
  complianceEvidence: {
    accessReviewStatus: "missing" | "present" | "unknown";
    accessReviewCount: number;
  };
  dataRights: {
    coverageApiPathConfigured: boolean;
    exportApisConfigured: boolean;
    deletionApisConfigured: boolean;
    supportedDeletionResourceTypeCount: number;
    retentionEvidenceSchemaConfigured: boolean;
    operationalLogEvidencePathConfigured: boolean;
    backupEvidencePathConfigured: boolean;
    externalRetentionControlCount: number;
  };
  logs: {
    count: number;
  };
  redactionSafe: boolean;
  failureCodes: string[];
}

export interface SupportBundleRedactionEvidencePosture {
  configured: boolean;
  source: "configured_file" | "not_configured";
  status: "failed" | "invalid" | "not_configured" | "passed";
  schemaVersion?: "romeo.support-bundle-redaction.v1";
  generatedAt?: string;
  invalidReason?: SupportBundleInvalidReason;
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: string[];
  };
  supportBundle: {
    schemaVersion?: "romeo.support-bundle.v1";
    evidenceCount: number;
    accessReviewEvidenceCount: number;
    logCount: number;
    migrationCount: number;
    configuredSecretCount: number;
  };
  redactionSafe: boolean;
  failureCodes: string[];
}

export class SupportBundlePostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<SupportBundlePostureReport> {
    assertScope(subject, "admin:read");

    const bundle = await summarizeBundle(this.env.SUPPORT_BUNDLE_PATH);
    const redactionEvidence = await summarizeRedactionEvidence(
      this.env.SUPPORT_BUNDLE_REDACTION_EVIDENCE_PATH,
    );
    const warnings = supportBundleWarnings(bundle, redactionEvidence);

    return {
      schema: "romeo.support-bundle-posture.v1",
      generatedAt: new Date().toISOString(),
      orgId: subject.orgId,
      status: warnings.length === 0 ? "ready" : "attention_required",
      summary: {
        bundleGenerated: bundle.status === "generated",
        redactionPassed: redactionEvidence.status === "passed",
        evidenceFileCount: bundle.evidence.fileCount,
        accessReviewEvidenceCount: bundle.complianceEvidence.accessReviewCount,
        logFileCount: bundle.logs.count,
        migrationFileCount: bundle.migrations.count,
        deploymentFileCount: bundle.deployment.fileCount,
        configuredSecretCount: Math.max(
          bundle.configuration.configuredSecretCount,
          redactionEvidence.supportBundle.configuredSecretCount,
        ),
        redactionCheckCount: redactionEvidence.checks.total,
        requiredRedactionCheckCount: redactionEvidence.checks.requiredTotal,
        missingRequiredRedactionCheckCount:
          redactionEvidence.checks.missingRequired.length,
      },
      bundle,
      redactionEvidence,
      redaction: supportBundlePostureRedaction(),
      warnings,
    };
  }
}

async function summarizeBundle(
  evidencePath: string,
): Promise<SupportBundleEvidencePosture> {
  const configuredPath = evidencePath.trim();
  if (configuredPath.length === 0) return emptyBundle("not_configured", []);

  const result = await readJson(configuredPath);
  if (result.status === "invalid") {
    return emptyBundle("invalid", [result.invalidReason], result.invalidReason);
  }

  const data = result.data;
  if (data.schemaVersion !== "romeo.support-bundle.v1") {
    return emptyBundle("invalid", ["schema_mismatch"], "schema_mismatch");
  }

  const generatedAt = stringValue(data.generatedAt);
  const redactionSafe = allRedactionFlagsFalse(
    data.redaction,
    bundleRedactionFlags,
  );
  const status =
    data.status === "generated" && redactionSafe ? "generated" : "unsafe";
  const packageSummary = recordValue(data.package);
  const runtime = recordValue(data.runtime);
  const configuration = recordValue(data.configuration);
  const safeEnums = recordValue(configuration.safeEnums);
  const safeNumbers = recordValue(configuration.safeNumbers);
  const configuredSecrets = recordValue(configuration.configuredSecrets);
  const urlHosts = recordValue(configuration.urlHosts);
  const migrations = recordValue(data.migrations);
  const evidence = recordArray(data.evidence);
  const compliance = recordValue(data.complianceEvidence);
  const accessReview = recordValue(compliance.accessReview);
  const dataRights = recordValue(data.dataRights);
  const retentionEvidence = recordValue(dataRights.retentionEvidence);

  return {
    configured: true,
    source: "configured_file",
    status,
    schemaVersion: "romeo.support-bundle.v1",
    ...(generatedAt === undefined ? {} : { generatedAt }),
    package: {
      nameConfigured: stringValue(packageSummary.name) !== undefined,
      versionConfigured: stringValue(packageSummary.version) !== undefined,
      packageManagerConfigured:
        stringValue(packageSummary.packageManager) !== undefined,
    },
    runtime: {
      nodeConfigured: stringValue(runtime.node) !== undefined,
      platformConfigured: stringValue(runtime.platform) !== undefined,
      archConfigured: stringValue(runtime.arch) !== undefined,
    },
    configuration: {
      safeEnumCount: Object.keys(safeEnums).length,
      configuredSafeEnumCount: configuredValueCount(safeEnums),
      unrecognizedSafeEnumCount: Object.values(safeEnums).filter(
        (value) => value === "configured_unrecognized",
      ).length,
      safeNumberCount: configuredValueCount(safeNumbers),
      configuredSecretCount: trueValueCount(configuredSecrets),
      urlHostConfiguredCount: configuredValueCount(urlHosts),
    },
    deployment: {
      fileCount: recordArray(data.deployment).length,
    },
    migrations: {
      count: numberValue(migrations.count) ?? 0,
      greenfieldBaselineOnly: migrations.greenfieldBaselineOnly === true,
    },
    evidence: {
      fileCount: evidence.length,
      schemaVersionCount: evidence.filter(
        (item) => stringValue(item.schemaVersion) !== undefined,
      ).length,
      generatedStatusCount: evidence.filter(
        (item) => stringValue(item.evidenceStatus) !== undefined,
      ).length,
      releaseVersionCount: evidence.filter(
        (item) => stringValue(item.releaseVersion) !== undefined,
      ).length,
    },
    complianceEvidence: {
      accessReviewStatus:
        accessReview.status === "present" || accessReview.status === "missing"
          ? accessReview.status
          : "unknown",
      accessReviewCount: numberValue(accessReview.count) ?? 0,
    },
    dataRights: {
      coverageApiPathConfigured:
        stringValue(dataRights.coverageApiPath) !== undefined,
      exportApisConfigured:
        stringValue(dataRights.exportPreviewApiPath) !== undefined &&
        stringValue(dataRights.exportExecuteApiPath) !== undefined,
      deletionApisConfigured:
        stringValue(dataRights.deletionPreviewApiPath) !== undefined &&
        stringValue(dataRights.deletionExecuteApiPath) !== undefined,
      supportedDeletionResourceTypeCount: arrayValue(
        dataRights.supportedDeletionResourceTypes,
      ).length,
      retentionEvidenceSchemaConfigured:
        retentionEvidence.schemaVersion ===
        "romeo.data-rights-retention-evidence.v1",
      operationalLogEvidencePathConfigured:
        retentionEvidence.operationalLogEvidencePathConfigured === true,
      backupEvidencePathConfigured:
        retentionEvidence.backupEvidencePathConfigured === true,
      externalRetentionControlCount: arrayValue(
        dataRights.externalRetentionControls,
      ).length,
    },
    logs: {
      count: recordArray(data.logs).length,
    },
    redactionSafe,
    failureCodes:
      data.status === "generated" && redactionSafe
        ? []
        : [
            ...(data.status === "generated"
              ? []
              : ["support_bundle_not_generated"]),
            ...(redactionSafe ? [] : ["support_bundle_redaction_unsafe"]),
          ],
  };
}

function emptyBundle(
  status: "invalid" | "not_configured",
  failureCodes: string[],
  invalidReason?: SupportBundleInvalidReason,
): SupportBundleEvidencePosture {
  return {
    configured: status !== "not_configured",
    source: status === "not_configured" ? "not_configured" : "configured_file",
    status,
    ...(invalidReason === undefined ? {} : { invalidReason }),
    package: {
      nameConfigured: false,
      versionConfigured: false,
      packageManagerConfigured: false,
    },
    runtime: {
      nodeConfigured: false,
      platformConfigured: false,
      archConfigured: false,
    },
    configuration: {
      safeEnumCount: 0,
      configuredSafeEnumCount: 0,
      unrecognizedSafeEnumCount: 0,
      safeNumberCount: 0,
      configuredSecretCount: 0,
      urlHostConfiguredCount: 0,
    },
    deployment: { fileCount: 0 },
    migrations: { count: 0, greenfieldBaselineOnly: false },
    evidence: {
      fileCount: 0,
      schemaVersionCount: 0,
      generatedStatusCount: 0,
      releaseVersionCount: 0,
    },
    complianceEvidence: {
      accessReviewStatus: "unknown",
      accessReviewCount: 0,
    },
    dataRights: {
      coverageApiPathConfigured: false,
      exportApisConfigured: false,
      deletionApisConfigured: false,
      supportedDeletionResourceTypeCount: 0,
      retentionEvidenceSchemaConfigured: false,
      operationalLogEvidencePathConfigured: false,
      backupEvidencePathConfigured: false,
      externalRetentionControlCount: 0,
    },
    logs: { count: 0 },
    redactionSafe: status === "not_configured",
    failureCodes,
  };
}

async function summarizeRedactionEvidence(
  evidencePath: string,
): Promise<SupportBundleRedactionEvidencePosture> {
  const configuredPath = evidencePath.trim();
  if (configuredPath.length === 0) {
    return emptyRedactionEvidence("not_configured", []);
  }

  const result = await readJson(configuredPath);
  if (result.status === "invalid") {
    return emptyRedactionEvidence(
      "invalid",
      [result.invalidReason],
      result.invalidReason,
    );
  }

  const data = result.data;
  if (data.schemaVersion !== "romeo.support-bundle-redaction.v1") {
    return emptyRedactionEvidence(
      "invalid",
      ["schema_mismatch"],
      "schema_mismatch",
    );
  }

  const generatedAt = stringValue(data.generatedAt);
  const checks = stringArray(data.checks);
  const missingRequired = requiredRedactionChecks.filter(
    (check) => !checks.includes(check),
  );
  const redactionSafe = allRedactionFlagsFalse(
    data.redaction,
    redactionEvidenceFlags,
  );
  const status =
    data.status === "passed" && missingRequired.length === 0 && redactionSafe
      ? "passed"
      : "failed";
  const supportBundle = recordValue(data.supportBundle);
  const configuredSecretKeys = stringArray(supportBundle.configuredSecretKeys);

  return {
    configured: true,
    source: "configured_file",
    status,
    schemaVersion: "romeo.support-bundle-redaction.v1",
    ...(generatedAt === undefined ? {} : { generatedAt }),
    checks: {
      total: checks.length,
      requiredTotal: requiredRedactionChecks.length,
      requiredPresent: requiredRedactionChecks.length - missingRequired.length,
      missingRequired,
    },
    supportBundle: {
      ...(supportBundle.schemaVersion === "romeo.support-bundle.v1"
        ? { schemaVersion: "romeo.support-bundle.v1" as const }
        : {}),
      evidenceCount: numberValue(supportBundle.evidenceCount) ?? 0,
      accessReviewEvidenceCount:
        numberValue(supportBundle.accessReviewEvidenceCount) ?? 0,
      logCount: numberValue(supportBundle.logCount) ?? 0,
      migrationCount: numberValue(supportBundle.migrationCount) ?? 0,
      configuredSecretCount: configuredSecretKeys.length,
    },
    redactionSafe,
    failureCodes:
      status === "passed"
        ? []
        : [
            ...(data.status === "passed"
              ? []
              : ["support_bundle_redaction_not_passed"]),
            ...(missingRequired.length === 0
              ? []
              : ["support_bundle_redaction_required_checks_missing"]),
            ...(redactionSafe ? [] : ["support_bundle_redaction_unsafe"]),
          ],
  };
}

function emptyRedactionEvidence(
  status: "invalid" | "not_configured",
  failureCodes: string[],
  invalidReason?: SupportBundleInvalidReason,
): SupportBundleRedactionEvidencePosture {
  return {
    configured: status !== "not_configured",
    source: status === "not_configured" ? "not_configured" : "configured_file",
    status,
    ...(invalidReason === undefined ? {} : { invalidReason }),
    checks: {
      total: 0,
      requiredTotal: requiredRedactionChecks.length,
      requiredPresent: 0,
      missingRequired: [...requiredRedactionChecks],
    },
    supportBundle: {
      evidenceCount: 0,
      accessReviewEvidenceCount: 0,
      logCount: 0,
      migrationCount: 0,
      configuredSecretCount: 0,
    },
    redactionSafe: status === "not_configured",
    failureCodes,
  };
}

function supportBundleWarnings(
  bundle: SupportBundleEvidencePosture,
  redactionEvidence: SupportBundleRedactionEvidencePosture,
): SupportBundlePostureWarning[] {
  const warnings: SupportBundlePostureWarning[] = [];

  if (bundle.status === "not_configured") {
    warnings.push("support_bundle_evidence_not_configured");
  } else if (bundle.status === "invalid") {
    warnings.push("support_bundle_invalid");
  } else if (bundle.status === "unsafe") {
    if (bundle.failureCodes.includes("support_bundle_not_generated")) {
      warnings.push("support_bundle_not_generated");
    }
    if (bundle.failureCodes.includes("support_bundle_redaction_unsafe")) {
      warnings.push("support_bundle_redaction_unsafe");
    }
  }

  if (redactionEvidence.status === "not_configured") {
    warnings.push("support_bundle_redaction_not_configured");
  } else if (redactionEvidence.status === "invalid") {
    warnings.push("support_bundle_redaction_invalid");
  } else if (redactionEvidence.status === "failed") {
    warnings.push("support_bundle_redaction_failed");
    if (redactionEvidence.checks.missingRequired.length > 0) {
      warnings.push("support_bundle_redaction_required_checks_missing");
    }
    if (!redactionEvidence.redactionSafe) {
      warnings.push("support_bundle_redaction_unsafe");
    }
  }

  return [...new Set(warnings)];
}

function supportBundlePostureRedaction(): SupportBundlePostureReport["redaction"] {
  return {
    accessReviewBodiesReturned: false,
    backupLocationsReturned: false,
    connectorPayloadsReturned: false,
    environmentValuesReturned: false,
    evidenceFileBodiesReturned: false,
    logBodiesReturned: false,
    objectStoreKeysReturned: false,
    packageEvidencePathsReturned: false,
    promptsReturned: false,
    providerPayloadsReturned: false,
    rawEvidencePathsReturned: false,
    reportBodiesReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
    vectorValuesReturned: false,
  };
}

type ReadJsonResult =
  | { status: "valid"; data: Record<string, unknown> }
  | { status: "invalid"; invalidReason: SupportBundleInvalidReason };

async function readJson(path: string): Promise<ReadJsonResult> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { status: "invalid", invalidReason: "read_failed" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", invalidReason: "invalid_json" };
  }

  if (!isRecord(parsed)) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }
  return { status: "valid", data: parsed };
}

function allRedactionFlagsFalse(
  value: unknown,
  flags: readonly string[],
): boolean {
  const redaction = recordValue(value);
  return flags.every((flag) => redaction[flag] === false);
}

function configuredValueCount(value: Record<string, unknown>): number {
  return Object.values(value).filter((item) => item !== undefined).length;
}

function trueValueCount(value: Record<string, unknown>): number {
  return Object.values(value).filter((item) => item === true).length;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => isRecord(item))
    : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
