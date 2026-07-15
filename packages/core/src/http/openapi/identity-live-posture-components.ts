const falseBoolean = { type: "boolean", enum: [false] };

const identityLiveChecks = [
  "access_review_readback",
  "configured_idp_login_live",
  "deprovision_or_scim_lifecycle_live",
  "directory_lookup_live",
  "directory_sync_apply_live",
  "directory_sync_preview_live",
  "group_mapping_validation_live",
  "identity_evidence_redaction_reviewed",
  "identity_log_redaction",
  "managed_secret_backend_live",
] as const;

const identityLiveWarnings = [
  "identity_live_access_review_missing",
  "identity_live_directory_lookup_missing",
  "identity_live_directory_sync_missing",
  "identity_live_deployment_invalid",
  "identity_live_directory_missing",
  "identity_live_evidence_failed",
  "identity_live_evidence_invalid",
  "identity_live_evidence_not_configured",
  "identity_live_evidence_not_live",
  "identity_live_evidence_not_passed",
  "identity_live_failure_codes_present",
  "identity_live_group_mapping_missing",
  "identity_live_lifecycle_missing",
  "identity_live_login_missing",
  "identity_live_policy_violations_present",
  "identity_live_redaction_missing",
  "identity_live_required_checks_missing",
  "identity_live_secret_backend_missing",
] as const;

export const identityLivePostureSchemas = {
  IdentityLivePostureReport: {
    type: "object",
    required: [
      "schema",
      "generatedAt",
      "orgId",
      "status",
      "evidence",
      "checks",
      "identityProviders",
      "secretBackends",
      "directory",
      "lifecycle",
      "accessReview",
      "redaction",
      "warnings",
    ],
    additionalProperties: false,
    properties: {
      schema: { type: "string", enum: ["romeo.identity-live-posture.v1"] },
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
            enum: ["romeo.identity-live-evidence.v1"],
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
            items: { type: "string", enum: [...identityLiveChecks] },
          },
        },
      },
      identityProviders: {
        type: "object",
        required: [
          "configuredProviderCount",
          "liveLoginProviderCount",
          "oidcProviderCount",
          "oauth2ProviderCount",
          "ldapProviderCount",
          "samlProviderCount",
          "localFallbackVerified",
          "mfaFallbackVerified",
        ],
        additionalProperties: false,
        properties: {
          ...integerProperties([
            "configuredProviderCount",
            "liveLoginProviderCount",
            "oidcProviderCount",
            "oauth2ProviderCount",
            "ldapProviderCount",
            "samlProviderCount",
          ]),
          localFallbackVerified: { type: "boolean" },
          mfaFallbackVerified: { type: "boolean" },
        },
      },
      secretBackends: integerObject([
        "managedSecretBackendCount",
        "vaultSecretWriteCount",
        "externalSecretReferenceCount",
        "secretResolutionCheckCount",
      ]),
      directory: integerObject([
        "directoryProviderCount",
        "directoryLookupCount",
        "mappedGroupCount",
        "workspaceMappingCount",
        "directorySyncPreviewChangeCount",
        "directorySyncAppliedChangeCount",
        "policyViolationCount",
      ]),
      lifecycle: integerObject([
        "deprovisionedUserCount",
        "scimUserLifecycleCount",
        "scimGroupLifecycleCount",
        "disabledUserCount",
        "revokedSessionCount",
      ]),
      accessReview: {
        type: "object",
        required: [
          "checked",
          "reportUserCount",
          "reportGroupCount",
          "reportGrantCount",
          "exportedCsv",
        ],
        additionalProperties: false,
        properties: {
          checked: { type: "boolean" },
          ...integerProperties([
            "reportUserCount",
            "reportGroupCount",
            "reportGrantCount",
          ]),
          exportedCsv: { type: "boolean" },
        },
      },
      redaction: {
        type: "object",
        required: [
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
        ],
        additionalProperties: false,
        properties: {
          evidenceFileBodiesReturned: falseBoolean,
          rawDirectoryEntriesReturned: falseBoolean,
          rawEmailAddressesReturned: falseBoolean,
          rawEvidencePathsReturned: falseBoolean,
          rawGroupNamesReturned: falseBoolean,
          rawIdpResponsesReturned: falseBoolean,
          rawLdapDnsReturned: falseBoolean,
          rawProviderEndpointsReturned: falseBoolean,
          rawSamlAssertionsReturned: falseBoolean,
          rawSecretRefsReturned: falseBoolean,
          secretValuesReturned: falseBoolean,
          tokenValuesReturned: falseBoolean,
        },
      },
      warnings: {
        type: "array",
        items: { type: "string", enum: [...identityLiveWarnings] },
      },
    },
  },
};

function integerObject(keys: string[]) {
  return {
    type: "object",
    required: keys,
    additionalProperties: false,
    properties: integerProperties(keys),
  };
}

function integerProperties(keys: string[]) {
  return Object.fromEntries(
    keys.map((key) => [key, { type: "integer", minimum: 0 }]),
  );
}
