const booleanFalseSchema = { type: "boolean", enum: [false] };

const evidenceStatusSchema = {
  type: "string",
  enum: ["failed", "invalid", "not_configured", "planned", "satisfied"],
};

const runStatusSchema = {
  type: "string",
  enum: ["failed", "passed", "unknown"],
};

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

const warningValues = [
  "secret_rotation_alerting_missing",
  "secret_rotation_dependency_review_missing",
  "secret_rotation_drill_deployment_invalid",
  "secret_rotation_drill_failure_codes_present",
  "secret_rotation_evidence_failed",
  "secret_rotation_evidence_invalid",
  "secret_rotation_evidence_not_configured",
  "secret_rotation_evidence_not_live",
  "secret_rotation_evidence_not_passed",
  "secret_rotation_new_secret_acceptance_missing",
  "secret_rotation_old_secret_retirement_missing",
  "secret_rotation_readiness_missing",
  "secret_rotation_redaction_missing",
  "secret_rotation_required_checks_missing",
  "secret_rotation_rewrap_missing",
  "secret_rotation_staged_cutover_missing",
];

export const secretRotationDrillPostureSchemas = {
  SecretRotationDrillPostureReport: {
    type: "object",
    required: [
      "schema",
      "generatedAt",
      "orgId",
      "status",
      "evidence",
      "checks",
      "stagedCutover",
      "rewrap",
      "acceptance",
      "dependencies",
      "readiness",
      "alerting",
      "redaction",
      "warnings",
    ],
    additionalProperties: false,
    properties: {
      schema: {
        type: "string",
        enum: ["romeo.secret-rotation-drill-posture.v1"],
      },
      generatedAt: { type: "string", format: "date-time" },
      orgId: { type: "string" },
      status: { type: "string", enum: ["attention_required", "ready"] },
      evidence: evidenceSchema(),
      checks: checksSchema(),
      stagedCutover: stagedCutoverSchema(),
      rewrap: rewrapSchema(),
      acceptance: acceptanceSchema(),
      dependencies: dependenciesSchema(),
      readiness: readinessSchema(),
      alerting: alertingSchema(),
      redaction: redactionSchema(),
      warnings: {
        type: "array",
        items: { type: "string", enum: warningValues },
      },
    },
  },
};

function evidenceSchema() {
  return {
    type: "object",
    required: ["configured", "source", "status", "failureCodes"],
    additionalProperties: false,
    properties: {
      configured: { type: "boolean" },
      source: { type: "string", enum: ["configured_file", "not_configured"] },
      status: evidenceStatusSchema,
      schemaVersion: {
        type: "string",
        enum: ["romeo.secret-rotation-drill-evidence.v1"],
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
  };
}

function checksSchema() {
  return {
    type: "object",
    required: ["total", "requiredTotal", "requiredPresent", "missingRequired"],
    additionalProperties: false,
    properties: {
      total: { type: "integer", minimum: 0 },
      requiredTotal: { type: "integer", minimum: 0 },
      requiredPresent: { type: "integer", minimum: 0 },
      missingRequired: {
        type: "array",
        items: { type: "string", enum: requiredChecks },
      },
    },
  };
}

function stagedCutoverSchema() {
  return {
    type: "object",
    required: [
      "sessionSecretStaged",
      "webhookSigningKeyCutover",
      "apiOrServiceKeyContinuityVerified",
    ],
    additionalProperties: false,
    properties: {
      sessionSecretStaged: { type: "boolean" },
      webhookSigningKeyCutover: { type: "boolean" },
      apiOrServiceKeyContinuityVerified: { type: "boolean" },
    },
  };
}

function rewrapSchema() {
  return {
    type: "object",
    required: [
      "localMfaPreviewPassed",
      "localMfaRewrappedCount",
      "managedSecretsPreviewPassed",
      "managedSecretsRewrappedCount",
      "failureCount",
    ],
    additionalProperties: false,
    properties: {
      localMfaPreviewPassed: { type: "boolean" },
      localMfaRewrappedCount: { type: "integer", minimum: 0 },
      managedSecretsPreviewPassed: { type: "boolean" },
      managedSecretsRewrappedCount: { type: "integer", minimum: 0 },
      failureCount: { type: "integer", minimum: 0 },
    },
  };
}

function acceptanceSchema() {
  return {
    type: "object",
    required: ["oldSecretRetiredOrRejectedCount", "newSecretAcceptedCount"],
    additionalProperties: false,
    properties: {
      oldSecretRetiredOrRejectedCount: { type: "integer", minimum: 0 },
      newSecretAcceptedCount: { type: "integer", minimum: 0 },
    },
  };
}

function dependenciesSchema() {
  return {
    type: "object",
    required: [
      "databaseCredentialsReviewed",
      "objectStoreCredentialsReviewed",
      "providerCredentialCount",
      "connectorCredentialCount",
    ],
    additionalProperties: false,
    properties: {
      databaseCredentialsReviewed: { type: "boolean" },
      objectStoreCredentialsReviewed: { type: "boolean" },
      providerCredentialCount: { type: "integer", minimum: 0 },
      connectorCredentialCount: { type: "integer", minimum: 0 },
    },
  };
}

function readinessSchema() {
  return {
    type: "object",
    required: [
      "checked",
      "readinessPassed",
      "postRotationLoginPassed",
      "postRotationWebhookPassed",
    ],
    additionalProperties: false,
    properties: {
      checked: { type: "boolean" },
      readinessPassed: { type: "boolean" },
      postRotationLoginPassed: { type: "boolean" },
      postRotationWebhookPassed: { type: "boolean" },
    },
  };
}

function alertingSchema() {
  return {
    type: "object",
    required: [
      "checked",
      "status",
      "rotationAlertCount",
      "firingRequiredCount",
    ],
    additionalProperties: false,
    properties: {
      checked: { type: "boolean" },
      status: runStatusSchema,
      rotationAlertCount: { type: "integer", minimum: 0 },
      firingRequiredCount: { type: "integer", minimum: 0 },
    },
  };
}

function redactionSchema() {
  return {
    type: "object",
    required: [
      "evidenceFileBodyReturned",
      "keyMaterialReturned",
      "rawApiKeysReturned",
      "rawEvidencePathsReturned",
      "rawLogLinesReturned",
      "rawSecretRefsReturned",
      "rawSecretValuesReturned",
      "rawTokensReturned",
      "webhookSigningSecretsReturned",
    ],
    additionalProperties: false,
    properties: {
      evidenceFileBodyReturned: booleanFalseSchema,
      keyMaterialReturned: booleanFalseSchema,
      rawApiKeysReturned: booleanFalseSchema,
      rawEvidencePathsReturned: booleanFalseSchema,
      rawLogLinesReturned: booleanFalseSchema,
      rawSecretRefsReturned: booleanFalseSchema,
      rawSecretValuesReturned: booleanFalseSchema,
      rawTokensReturned: booleanFalseSchema,
      webhookSigningSecretsReturned: booleanFalseSchema,
    },
  };
}
