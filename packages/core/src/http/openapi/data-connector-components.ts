const booleanFalse = { type: "boolean", enum: [false] };
const nonNegativeInteger = { type: "integer", minimum: 0 };
const nullableDateTime = {
  oneOf: [{ type: "string", format: "date-time" }, { type: "null" }],
};

export const dataConnectorPostureSchemas = {
  DataConnectorPostureReport: {
    type: "object",
    required: [
      "schema",
      "generatedAt",
      "orgId",
      "status",
      "runtime",
      "deployment",
      "connectors",
      "syncs",
      "liveEvidence",
      "redaction",
      "warnings",
    ],
    additionalProperties: false,
    properties: {
      schema: { type: "string", enum: ["romeo.data-connector-posture.v1"] },
      generatedAt: { type: "string", format: "date-time" },
      orgId: { type: "string" },
      status: { type: "string", enum: ["attention_required", "ready"] },
      runtime: {
        type: "object",
        required: [
          "executionDriver",
          "egressPolicy",
          "managedFetchEnabled",
          "allowedHostRuleCount",
          "fetchLimits",
          "secretResolver",
          "credentialPosture",
        ],
        additionalProperties: false,
        properties: {
          executionDriver: {
            type: "string",
            enum: [
              "disabled",
              "website-fetch",
              "github-fetch",
              "s3-fetch",
              "atlassian-fetch",
              "notion-fetch",
              "linear-fetch",
              "slack-fetch",
              "managed-fetch",
            ],
          },
          egressPolicy: {
            type: "string",
            enum: ["allow_public", "require_allowlist"],
          },
          managedFetchEnabled: { type: "boolean" },
          allowedHostRuleCount: nonNegativeInteger,
          fetchLimits: {
            type: "object",
            required: [
              "maxBytes",
              "retryAttempts",
              "retryBackoffMs",
              "timeoutMs",
            ],
            additionalProperties: false,
            properties: {
              maxBytes: { type: "integer", minimum: 1 },
              retryAttempts: nonNegativeInteger,
              retryBackoffMs: nonNegativeInteger,
              timeoutMs: { type: "integer", minimum: 1 },
            },
          },
          secretResolver: {
            type: "object",
            required: [
              "driver",
              "managedSecretConfigured",
              "externalValueResolverConfigured",
            ],
            additionalProperties: false,
            properties: {
              driver: {
                type: "string",
                enum: [
                  "disabled",
                  "env",
                  "vault",
                  "aws-sm",
                  "gcp-sm",
                  "azure-kv",
                  "cloud",
                ],
              },
              managedSecretConfigured: { type: "boolean" },
              externalValueResolverConfigured: { type: "boolean" },
            },
          },
          credentialPosture: {
            type: "object",
            required: [
              "delegatedOAuthGithubConfigured",
              "githubDeploymentTokenConfigured",
              "s3DeploymentCredentialsConfigured",
              "s3EndpointConfigured",
            ],
            additionalProperties: false,
            properties: {
              delegatedOAuthGithubConfigured: { type: "boolean" },
              githubDeploymentTokenConfigured: { type: "boolean" },
              s3DeploymentCredentialsConfigured: { type: "boolean" },
              s3EndpointConfigured: { type: "boolean" },
            },
          },
        },
      },
      deployment: {
        type: "object",
        required: [
          "liveEvidencePathConfigured",
          "networkPolicyConfigured",
          "workerEnabled",
        ],
        additionalProperties: false,
        properties: {
          liveEvidencePathConfigured: { type: "boolean" },
          networkPolicyConfigured: { type: "boolean" },
          workerEnabled: { type: "boolean" },
        },
      },
      connectors: {
        type: "object",
        required: [
          "active",
          "disabled",
          "due",
          "managed",
          "scheduled",
          "total",
          "byType",
        ],
        additionalProperties: false,
        properties: {
          active: nonNegativeInteger,
          disabled: nonNegativeInteger,
          due: nonNegativeInteger,
          managed: nonNegativeInteger,
          scheduled: nonNegativeInteger,
          total: nonNegativeInteger,
          byType: {
            type: "object",
            required: [
              "local_import",
              "github",
              "s3",
              "website",
              "rss",
              "confluence",
              "jira",
              "notion",
              "linear",
              "slack",
            ],
            additionalProperties: false,
            properties: {
              local_import: nonNegativeInteger,
              github: nonNegativeInteger,
              s3: nonNegativeInteger,
              website: nonNegativeInteger,
              rss: nonNegativeInteger,
              confluence: nonNegativeInteger,
              jira: nonNegativeInteger,
              notion: nonNegativeInteger,
              linear: nonNegativeInteger,
              slack: nonNegativeInteger,
            },
          },
        },
      },
      syncs: {
        type: "object",
        required: [
          "completed",
          "failed",
          "latestCompletedAt",
          "latestFailedAt",
          "running",
          "total",
        ],
        additionalProperties: false,
        properties: {
          completed: nonNegativeInteger,
          failed: nonNegativeInteger,
          latestCompletedAt: nullableDateTime,
          latestFailedAt: nullableDateTime,
          running: nonNegativeInteger,
          total: nonNegativeInteger,
        },
      },
      liveEvidence: {
        type: "object",
        required: [
          "configured",
          "source",
          "status",
          "checks",
          "failureCodes",
          "summary",
          "redaction",
        ],
        additionalProperties: false,
        properties: {
          configured: { type: "boolean" },
          source: {
            type: "string",
            enum: ["configured_file", "not_configured"],
          },
          status: {
            type: "string",
            enum: ["failed", "invalid", "not_configured", "satisfied"],
          },
          schemaVersion: {
            type: "string",
            enum: ["romeo.data-connector-live-evidence.v1"],
          },
          evidenceStatus: {
            type: "string",
            enum: ["failed", "passed", "planned", "unknown"],
          },
          mode: { type: "string", enum: ["dry-run", "live", "unknown"] },
          deployment: {
            type: "string",
            enum: ["compose", "kubernetes", "target", "unknown"],
          },
          generatedAt: { type: "string", format: "date-time" },
          invalidReason: {
            type: "string",
            enum: ["invalid_json", "read_failed", "schema_mismatch"],
          },
          checks: {
            type: "object",
            required: [
              "managed_connector_sync_exercised",
              "worker_cni_egress_enforced",
              "dns_private_address_denied",
              "secret_ref_resolution_verified",
              "worker_crash_retry_or_requeue_verified",
              "sync_log_redaction",
              "sanitized_readback_verified",
            ],
            additionalProperties: false,
            properties: {
              managed_connector_sync_exercised: { type: "boolean" },
              worker_cni_egress_enforced: { type: "boolean" },
              dns_private_address_denied: { type: "boolean" },
              secret_ref_resolution_verified: { type: "boolean" },
              worker_crash_retry_or_requeue_verified: { type: "boolean" },
              sync_log_redaction: { type: "boolean" },
              sanitized_readback_verified: { type: "boolean" },
            },
          },
          failureCodes: { type: "array", items: { type: "string" } },
          summary: {
            type: "object",
            required: [
              "delegatedOAuthConnectorCount",
              "deniedPrivateTargetCount",
              "failedSyncCount",
              "managedConnectorTypeCount",
              "podLogScanCount",
              "requeuedSyncCount",
              "secretRefConnectorCount",
              "successfulSyncCount",
              "syncAttemptCount",
              "workerLogScanCount",
            ],
            additionalProperties: false,
            properties: {
              delegatedOAuthConnectorCount: nonNegativeInteger,
              deniedPrivateTargetCount: nonNegativeInteger,
              failedSyncCount: nonNegativeInteger,
              managedConnectorTypeCount: nonNegativeInteger,
              podLogScanCount: nonNegativeInteger,
              requeuedSyncCount: nonNegativeInteger,
              secretRefConnectorCount: nonNegativeInteger,
              successfulSyncCount: nonNegativeInteger,
              syncAttemptCount: nonNegativeInteger,
              workerLogScanCount: nonNegativeInteger,
            },
          },
          redaction: dataConnectorRedactionSchema({ strictFalse: false }),
        },
      },
      redaction: dataConnectorRedactionSchema({ strictFalse: true }),
      warnings: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "data_connector_driver_disabled",
            "data_connector_failed_syncs_present",
            "data_connector_live_evidence_invalid",
            "data_connector_live_evidence_required",
            "data_connector_network_policy_not_configured",
            "data_connector_scheduled_syncs_without_worker",
            "data_connector_worker_not_enabled",
          ],
        },
      },
    },
  },
};

function dataConnectorRedactionSchema({
  strictFalse,
}: {
  strictFalse: boolean;
}) {
  const valueSchema = strictFalse ? booleanFalse : { type: "boolean" };
  return {
    type: "object",
    required: [
      "rawAllowedHostsReturned",
      "rawConnectorConfigReturned",
      "rawConnectorContentReturned",
      "rawEndpointUrlsReturned",
      "rawEvidencePathsReturned",
      "rawSecretRefsReturned",
      "secretValuesReturned",
      "tokenValuesReturned",
      ...(strictFalse
        ? ["evidenceFileBodiesReturned"]
        : ["rawLogLinesReturned"]),
    ],
    additionalProperties: false,
    properties: {
      ...(strictFalse ? { evidenceFileBodiesReturned: booleanFalse } : {}),
      rawAllowedHostsReturned: valueSchema,
      rawConnectorConfigReturned: valueSchema,
      rawConnectorContentReturned: valueSchema,
      rawEndpointUrlsReturned: valueSchema,
      rawEvidencePathsReturned: valueSchema,
      ...(strictFalse ? {} : { rawLogLinesReturned: valueSchema }),
      rawSecretRefsReturned: valueSchema,
      secretValuesReturned: valueSchema,
      tokenValuesReturned: valueSchema,
    },
  };
}
