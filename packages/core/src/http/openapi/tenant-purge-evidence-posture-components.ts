const falseBoolean = { type: "boolean", enum: [false] };

const tenantPurgeEvidenceChecks = [
  "app_database_purge_executed",
  "app_object_store_purge_executed",
  "external_vector_store_reviewed",
  "backup_retention_reviewed",
  "operational_log_retention_reviewed",
  "support_bundle_retention_reviewed",
  "external_secret_store_reviewed",
  "tenant_purge_redaction_reviewed",
] as const;

const tenantPurgeWarnings = [
  "tenant_purge_app_database_missing",
  "tenant_purge_app_object_store_missing",
  "tenant_purge_backup_retention_missing",
  "tenant_purge_deployment_invalid",
  "tenant_purge_evidence_failed",
  "tenant_purge_evidence_invalid",
  "tenant_purge_evidence_not_configured",
  "tenant_purge_evidence_not_live",
  "tenant_purge_evidence_not_passed",
  "tenant_purge_external_secret_store_missing",
  "tenant_purge_external_vector_missing",
  "tenant_purge_failure_codes_present",
  "tenant_purge_operational_log_retention_missing",
  "tenant_purge_redaction_missing",
  "tenant_purge_required_checks_missing",
  "tenant_purge_retention_days_missing",
  "tenant_purge_storage_review_missing",
  "tenant_purge_support_bundle_retention_missing",
] as const;

export const tenantPurgeEvidencePostureSchemas = {
  TenantPurgeEvidencePostureReport: {
    type: "object",
    required: [
      "schema",
      "generatedAt",
      "orgId",
      "status",
      "evidence",
      "checks",
      "purge",
      "storage",
      "retention",
      "redaction",
      "warnings",
    ],
    additionalProperties: false,
    properties: {
      schema: {
        type: "string",
        enum: ["romeo.tenant-purge-evidence-posture.v1"],
      },
      generatedAt: { type: "string", format: "date-time" },
      orgId: { type: "string" },
      status: { type: "string", enum: ["attention_required", "ready"] },
      evidence: {
        type: "object",
        required: ["configured", "source", "status", "failureCodes"],
        additionalProperties: false,
        properties: {
          configured: { type: "boolean" },
          source: {
            type: "string",
            enum: ["configured_file", "not_configured"],
          },
          status: {
            type: "string",
            enum: [
              "failed",
              "invalid",
              "not_configured",
              "planned",
              "satisfied",
            ],
          },
          schemaVersion: {
            type: "string",
            enum: ["romeo.tenant-purge-evidence.v1"],
          },
          generatedAt: { type: "string", format: "date-time" },
          evidenceStatus: {
            type: "string",
            enum: ["failed", "passed", "planned", "unknown"],
          },
          mode: { type: "string", enum: ["dry-run", "live", "unknown"] },
          deployment: {
            type: "string",
            enum: ["compose", "kubernetes", "target", "unknown"],
          },
          invalidReason: {
            type: "string",
            enum: ["invalid_json", "read_failed", "schema_mismatch"],
          },
          failureCodes: { type: "array", items: { type: "string" } },
        },
      },
      checks: {
        type: "object",
        required: [
          "total",
          "requiredTotal",
          "requiredPresent",
          "missingRequired",
        ],
        additionalProperties: false,
        properties: {
          total: { type: "integer", minimum: 0 },
          requiredTotal: { type: "integer", minimum: 0 },
          requiredPresent: { type: "integer", minimum: 0 },
          missingRequired: {
            type: "array",
            items: { type: "string", enum: [...tenantPurgeEvidenceChecks] },
          },
        },
      },
      purge: integerObject([
        "tenantCount",
        "databasePurgedTenantCount",
        "objectStorePurgedTenantCount",
        "externalVectorReviewedTenantCount",
        "backupRetentionReviewedTenantCount",
        "operationalLogRetentionReviewedTenantCount",
        "supportBundleReviewedTenantCount",
        "externalSecretReviewedTenantCount",
      ]),
      storage: integerObject([
        "postgresRecordCount",
        "objectStoreObjectCount",
        "externalVectorNamespaceCount",
        "backupSystemCount",
        "operationalLogSystemCount",
        "supportBundleSystemCount",
        "secretStoreCount",
      ]),
      retention: {
        type: "object",
        additionalProperties: false,
        properties: {
          backupRetentionDays: { type: "integer", minimum: 0 },
          operationalLogRetentionDays: { type: "integer", minimum: 0 },
          supportBundleRetentionDays: { type: "integer", minimum: 0 },
        },
      },
      redaction: {
        type: "object",
        required: [
          "backupLocationsReturned",
          "evidenceFileBodiesReturned",
          "objectStoreKeysReturned",
          "operationalLogBodiesReturned",
          "rawEvidencePathsReturned",
          "secretValuesReturned",
          "supportBundleBodiesReturned",
          "vectorValuesReturned",
        ],
        additionalProperties: false,
        properties: {
          backupLocationsReturned: falseBoolean,
          evidenceFileBodiesReturned: falseBoolean,
          objectStoreKeysReturned: falseBoolean,
          operationalLogBodiesReturned: falseBoolean,
          rawEvidencePathsReturned: falseBoolean,
          secretValuesReturned: falseBoolean,
          supportBundleBodiesReturned: falseBoolean,
          vectorValuesReturned: falseBoolean,
        },
      },
      warnings: {
        type: "array",
        items: { type: "string", enum: [...tenantPurgeWarnings] },
      },
    },
  },
};

function integerObject(keys: string[]) {
  return {
    type: "object",
    required: keys,
    additionalProperties: false,
    properties: Object.fromEntries(
      keys.map((key) => [key, { type: "integer", minimum: 0 }]),
    ),
  };
}
