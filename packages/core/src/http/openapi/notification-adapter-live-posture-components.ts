const falseBoolean = { type: "boolean", enum: [false] };
const nonNegativeInteger = { type: "integer", minimum: 0 };

const deliveryDrivers = [
  "configured",
  "disabled",
  "fcm-mobile-push",
  "pagerduty-events",
  "resend-email",
  "slack-webhook",
  "smtp-email",
  "teams-webhook",
  "webhook",
] as const;

const notificationAdapterLiveChecks = [
  "live_notification_delivery_verified",
  "mixed_channel_type_delivery_verified",
  "secret_ref_resolution_verified",
  "notification_egress_policy_verified",
  "provider_payload_redaction_verified",
  "channel_type_isolation_verified",
  "retry_and_dead_letter_verified",
  "notification_log_redaction",
  "notification_evidence_redaction_reviewed",
] as const;

const notificationAdapterLiveWarnings = [
  "notification_adapter_live_channel_isolation_missing",
  "notification_adapter_live_channel_mix_missing",
  "notification_adapter_live_delivery_missing",
  "notification_adapter_live_deployment_invalid",
  "notification_adapter_live_egress_missing",
  "notification_adapter_live_evidence_failed",
  "notification_adapter_live_evidence_invalid",
  "notification_adapter_live_evidence_not_configured",
  "notification_adapter_live_evidence_not_live",
  "notification_adapter_live_log_redaction_missing",
  "notification_adapter_live_policy_invalid",
  "notification_adapter_live_provider_credential_missing",
  "notification_adapter_live_redaction_missing",
  "notification_adapter_live_required_checks_missing",
  "notification_adapter_live_retry_dead_letter_missing",
  "notification_adapter_live_runtime_disabled",
  "notification_adapter_live_secret_resolution_missing",
] as const;

export const notificationAdapterLivePostureSchemas = {
  NotificationAdapterLivePostureReport: {
    type: "object",
    required: [
      "schema",
      "generatedAt",
      "orgId",
      "status",
      "runtime",
      "evidence",
      "checks",
      "delivery",
      "channels",
      "secrets",
      "policy",
      "egress",
      "logRedaction",
      "redaction",
      "warnings",
    ],
    additionalProperties: false,
    properties: {
      schema: {
        type: "string",
        enum: ["romeo.notification-adapter-live-posture.v1"],
      },
      generatedAt: { type: "string", format: "date-time" },
      orgId: { type: "string" },
      status: { type: "string", enum: ["attention_required", "ready"] },
      runtime: {
        type: "object",
        required: [
          "deliveryDriver",
          "emailDeliveryDriver",
          "fcmConfigured",
          "liveEvidencePathConfigured",
          "pagerDutyConfigured",
          "providerEndpointCount",
          "resendConfigured",
          "secretResolverConfigured",
          "smtpConfigured",
        ],
        additionalProperties: false,
        properties: {
          deliveryDriver: { type: "string", enum: [...deliveryDrivers] },
          emailDeliveryDriver: { type: "string", enum: ["resend", "smtp"] },
          fcmConfigured: { type: "boolean" },
          liveEvidencePathConfigured: { type: "boolean" },
          pagerDutyConfigured: { type: "boolean" },
          providerEndpointCount: nonNegativeInteger,
          resendConfigured: { type: "boolean" },
          secretResolverConfigured: { type: "boolean" },
          smtpConfigured: { type: "boolean" },
        },
      },
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
            enum: ["romeo.notification-adapter-live-evidence.v1"],
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
          total: nonNegativeInteger,
          requiredTotal: nonNegativeInteger,
          requiredPresent: nonNegativeInteger,
          missingRequired: {
            type: "array",
            items: { type: "string", enum: [...notificationAdapterLiveChecks] },
          },
        },
      },
      delivery: {
        type: "object",
        required: [
          "attemptedCount",
          "deliveryDriver",
          "failedCount",
          "providerFamilyCount",
          "providerPayloadRedacted",
          "successfulCount",
        ],
        additionalProperties: false,
        properties: {
          attemptedCount: nonNegativeInteger,
          deliveryDriver: {
            type: "string",
            enum: [...deliveryDrivers, "unknown"],
          },
          failedCount: nonNegativeInteger,
          providerFamilyCount: nonNegativeInteger,
          providerPayloadRedacted: { type: "boolean" },
          successfulCount: nonNegativeInteger,
        },
      },
      channels: countSummarySchema(
        [
          "emailCount",
          "mobilePushCount",
          "pagerDutyCount",
          "slackCount",
          "teamsCount",
          "total",
          "webhookCount",
        ],
        {
          mixedChannelTypesVerified: { type: "boolean" },
        },
      ),
      secrets: {
        type: "object",
        required: [
          "secretRefResolutionCount",
          "secretResolverBoundaryVerified",
        ],
        additionalProperties: false,
        properties: {
          secretRefResolutionCount: nonNegativeInteger,
          secretResolverBoundaryVerified: { type: "boolean" },
        },
      },
      policy: {
        type: "object",
        required: [
          "channelTypeIsolationVerified",
          "deadLetterCount",
          "retrySuccessCount",
          "suppressionVerified",
        ],
        additionalProperties: false,
        properties: {
          channelTypeIsolationVerified: { type: "boolean" },
          deadLetterCount: nonNegativeInteger,
          retrySuccessCount: nonNegativeInteger,
          suppressionVerified: { type: "boolean" },
        },
      },
      egress: booleanSummarySchema([
        "hostAllowlistEnforced",
        "networkPolicyEnforced",
        "privateNetworkDenied",
        "providerEndpointAccessVerified",
      ]),
      logRedaction: {
        type: "object",
        required: [
          "appLogRedactionVerified",
          "appLogScanCount",
          "bodySentinelHitCount",
          "destinationSentinelHitCount",
          "podLogRedactionVerified",
          "podLogScanCount",
          "secretSentinelHitCount",
          "tokenSentinelHitCount",
        ],
        additionalProperties: false,
        properties: {
          appLogRedactionVerified: { type: "boolean" },
          appLogScanCount: nonNegativeInteger,
          bodySentinelHitCount: nonNegativeInteger,
          destinationSentinelHitCount: nonNegativeInteger,
          podLogRedactionVerified: { type: "boolean" },
          podLogScanCount: nonNegativeInteger,
          secretSentinelHitCount: nonNegativeInteger,
          tokenSentinelHitCount: nonNegativeInteger,
        },
      },
      redaction: {
        type: "object",
        required: [
          "evidenceFileBodyReturned",
          "rawDestinationsReturned",
          "rawEndpointUrlsReturned",
          "rawEvidencePathsReturned",
          "rawLogLinesReturned",
          "rawMessageBodiesReturned",
          "rawProviderResponsesReturned",
          "rawSecretRefsReturned",
          "secretValuesReturned",
          "tokenValuesReturned",
        ],
        additionalProperties: false,
        properties: {
          evidenceFileBodyReturned: falseBoolean,
          rawDestinationsReturned: falseBoolean,
          rawEndpointUrlsReturned: falseBoolean,
          rawEvidencePathsReturned: falseBoolean,
          rawLogLinesReturned: falseBoolean,
          rawMessageBodiesReturned: falseBoolean,
          rawProviderResponsesReturned: falseBoolean,
          rawSecretRefsReturned: falseBoolean,
          secretValuesReturned: falseBoolean,
          tokenValuesReturned: falseBoolean,
        },
      },
      warnings: {
        type: "array",
        items: { type: "string", enum: [...notificationAdapterLiveWarnings] },
      },
    },
  },
};

function countSummarySchema(
  countFields: string[],
  extraProperties: Record<string, unknown>,
) {
  return {
    type: "object",
    required: [...countFields, ...Object.keys(extraProperties)],
    additionalProperties: false,
    properties: {
      ...Object.fromEntries(
        countFields.map((field) => [field, nonNegativeInteger]),
      ),
      ...extraProperties,
    },
  };
}

function booleanSummarySchema(fields: string[]) {
  return {
    type: "object",
    required: fields,
    additionalProperties: false,
    properties: Object.fromEntries(
      fields.map((field) => [field, { type: "boolean" }]),
    ),
  };
}
