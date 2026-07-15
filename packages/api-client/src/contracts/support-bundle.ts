export type SupportBundleInvalidReason =
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
  bundle: {
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
    deployment: { fileCount: number };
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
    logs: { count: number };
    redactionSafe: boolean;
    failureCodes: string[];
  };
  redactionEvidence: {
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
  };
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
