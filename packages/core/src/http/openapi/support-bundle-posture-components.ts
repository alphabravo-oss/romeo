const configuredSourceSchema = {
  type: "string",
  enum: ["configured_file", "not_configured"],
};

const invalidReasonSchema = {
  type: "string",
  enum: ["invalid_json", "read_failed", "schema_mismatch"],
};

const bundleStatusSchema = {
  type: "string",
  enum: ["generated", "invalid", "not_configured", "unsafe"],
};

const redactionEvidenceStatusSchema = {
  type: "string",
  enum: ["failed", "invalid", "not_configured", "passed"],
};

const booleanFalseSchema = { type: "boolean", enum: [false] };

export const supportBundlePostureSchemas = {
  SupportBundlePostureReport: {
    type: "object",
    required: [
      "schema",
      "generatedAt",
      "orgId",
      "status",
      "summary",
      "bundle",
      "redactionEvidence",
      "redaction",
      "warnings",
    ],
    additionalProperties: false,
    properties: {
      schema: {
        type: "string",
        enum: ["romeo.support-bundle-posture.v1"],
      },
      generatedAt: { type: "string", format: "date-time" },
      orgId: { type: "string" },
      status: { type: "string", enum: ["attention_required", "ready"] },
      summary: summarySchema(),
      bundle: bundleSchema(),
      redactionEvidence: redactionEvidenceSchema(),
      redaction: redactionSchema(),
      warnings: { type: "array", items: { type: "string" } },
    },
  },
};

function summarySchema() {
  return {
    type: "object",
    required: [
      "bundleGenerated",
      "redactionPassed",
      "evidenceFileCount",
      "accessReviewEvidenceCount",
      "logFileCount",
      "migrationFileCount",
      "deploymentFileCount",
      "configuredSecretCount",
      "redactionCheckCount",
      "requiredRedactionCheckCount",
      "missingRequiredRedactionCheckCount",
    ],
    additionalProperties: false,
    properties: {
      bundleGenerated: { type: "boolean" },
      redactionPassed: { type: "boolean" },
      evidenceFileCount: { type: "integer", minimum: 0 },
      accessReviewEvidenceCount: { type: "integer", minimum: 0 },
      logFileCount: { type: "integer", minimum: 0 },
      migrationFileCount: { type: "integer", minimum: 0 },
      deploymentFileCount: { type: "integer", minimum: 0 },
      configuredSecretCount: { type: "integer", minimum: 0 },
      redactionCheckCount: { type: "integer", minimum: 0 },
      requiredRedactionCheckCount: { type: "integer", minimum: 0 },
      missingRequiredRedactionCheckCount: { type: "integer", minimum: 0 },
    },
  };
}

function bundleSchema() {
  return {
    type: "object",
    required: [
      "configured",
      "source",
      "status",
      "package",
      "runtime",
      "configuration",
      "deployment",
      "migrations",
      "evidence",
      "complianceEvidence",
      "dataRights",
      "logs",
      "redactionSafe",
      "failureCodes",
    ],
    additionalProperties: false,
    properties: {
      configured: { type: "boolean" },
      source: configuredSourceSchema,
      status: bundleStatusSchema,
      schemaVersion: { type: "string", enum: ["romeo.support-bundle.v1"] },
      generatedAt: { type: "string", format: "date-time" },
      invalidReason: invalidReasonSchema,
      package: boolMapSchema([
        "nameConfigured",
        "versionConfigured",
        "packageManagerConfigured",
      ]),
      runtime: boolMapSchema([
        "nodeConfigured",
        "platformConfigured",
        "archConfigured",
      ]),
      configuration: integerMapSchema([
        "safeEnumCount",
        "configuredSafeEnumCount",
        "unrecognizedSafeEnumCount",
        "safeNumberCount",
        "configuredSecretCount",
        "urlHostConfiguredCount",
      ]),
      deployment: integerMapSchema(["fileCount"]),
      migrations: {
        type: "object",
        required: ["count", "greenfieldBaselineOnly"],
        additionalProperties: false,
        properties: {
          count: { type: "integer", minimum: 0 },
          greenfieldBaselineOnly: { type: "boolean" },
        },
      },
      evidence: integerMapSchema([
        "fileCount",
        "schemaVersionCount",
        "generatedStatusCount",
        "releaseVersionCount",
      ]),
      complianceEvidence: {
        type: "object",
        required: ["accessReviewStatus", "accessReviewCount"],
        additionalProperties: false,
        properties: {
          accessReviewStatus: {
            type: "string",
            enum: ["missing", "present", "unknown"],
          },
          accessReviewCount: { type: "integer", minimum: 0 },
        },
      },
      dataRights: {
        type: "object",
        required: [
          "coverageApiPathConfigured",
          "exportApisConfigured",
          "deletionApisConfigured",
          "supportedDeletionResourceTypeCount",
          "retentionEvidenceSchemaConfigured",
          "operationalLogEvidencePathConfigured",
          "backupEvidencePathConfigured",
          "externalRetentionControlCount",
        ],
        additionalProperties: false,
        properties: {
          coverageApiPathConfigured: { type: "boolean" },
          exportApisConfigured: { type: "boolean" },
          deletionApisConfigured: { type: "boolean" },
          supportedDeletionResourceTypeCount: {
            type: "integer",
            minimum: 0,
          },
          retentionEvidenceSchemaConfigured: { type: "boolean" },
          operationalLogEvidencePathConfigured: { type: "boolean" },
          backupEvidencePathConfigured: { type: "boolean" },
          externalRetentionControlCount: { type: "integer", minimum: 0 },
        },
      },
      logs: integerMapSchema(["count"]),
      redactionSafe: { type: "boolean" },
      failureCodes: { type: "array", items: { type: "string" } },
    },
  };
}

function redactionEvidenceSchema() {
  return {
    type: "object",
    required: [
      "configured",
      "source",
      "status",
      "checks",
      "supportBundle",
      "redactionSafe",
      "failureCodes",
    ],
    additionalProperties: false,
    properties: {
      configured: { type: "boolean" },
      source: configuredSourceSchema,
      status: redactionEvidenceStatusSchema,
      schemaVersion: {
        type: "string",
        enum: ["romeo.support-bundle-redaction.v1"],
      },
      generatedAt: { type: "string", format: "date-time" },
      invalidReason: invalidReasonSchema,
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
          missingRequired: { type: "array", items: { type: "string" } },
        },
      },
      supportBundle: {
        type: "object",
        required: [
          "evidenceCount",
          "accessReviewEvidenceCount",
          "logCount",
          "migrationCount",
          "configuredSecretCount",
        ],
        additionalProperties: false,
        properties: {
          schemaVersion: {
            type: "string",
            enum: ["romeo.support-bundle.v1"],
          },
          evidenceCount: { type: "integer", minimum: 0 },
          accessReviewEvidenceCount: { type: "integer", minimum: 0 },
          logCount: { type: "integer", minimum: 0 },
          migrationCount: { type: "integer", minimum: 0 },
          configuredSecretCount: { type: "integer", minimum: 0 },
        },
      },
      redactionSafe: { type: "boolean" },
      failureCodes: { type: "array", items: { type: "string" } },
    },
  };
}

function boolMapSchema(keys: string[]) {
  return {
    type: "object",
    required: keys,
    additionalProperties: false,
    properties: Object.fromEntries(
      keys.map((key) => [key, { type: "boolean" }]),
    ),
  };
}

function integerMapSchema(keys: string[]) {
  return {
    type: "object",
    required: keys,
    additionalProperties: false,
    properties: Object.fromEntries(
      keys.map((key) => [key, { type: "integer", minimum: 0 }]),
    ),
  };
}

function redactionSchema() {
  const keys = [
    "accessReviewBodiesReturned",
    "backupLocationsReturned",
    "connectorPayloadsReturned",
    "environmentValuesReturned",
    "evidenceFileBodiesReturned",
    "logBodiesReturned",
    "objectStoreKeysReturned",
    "packageEvidencePathsReturned",
    "promptsReturned",
    "providerPayloadsReturned",
    "rawEvidencePathsReturned",
    "reportBodiesReturned",
    "secretValuesReturned",
    "tokenValuesReturned",
    "vectorValuesReturned",
  ];
  return {
    type: "object",
    required: keys,
    additionalProperties: false,
    properties: Object.fromEntries(
      keys.map((key) => [key, booleanFalseSchema]),
    ),
  };
}
