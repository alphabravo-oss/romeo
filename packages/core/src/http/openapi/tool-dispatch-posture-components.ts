const booleanFalse = { type: "boolean", enum: [false] };
const nonNegativeInteger = { type: "integer", minimum: 0 };
const nullableNonNegativeInteger = {
  oneOf: [nonNegativeInteger, { type: "null" }],
};

const toolDispatchLiveEvidenceChecks = [
  "worker_claim_execution_verified",
  "managed_payload_read_verified",
  "mcp_streamable_http_tools_call_verified",
  "worker_cni_egress_enforced",
  "dns_private_address_denied",
  "secret_resolution_verified",
  "worker_crash_retry_or_reclaim_verified",
  "response_schema_validation_verified",
  "worker_log_redaction",
  "sanitized_readback_verified",
] as const;

const toolDispatchWarnings = [
  "tool_dispatch_dead_letters_present",
  "tool_dispatch_execution_disabled",
  "tool_dispatch_failed_jobs_present",
  "tool_dispatch_live_evidence_invalid",
  "tool_dispatch_live_evidence_required",
  "tool_dispatch_managed_payload_store_disabled",
  "tool_dispatch_network_policy_not_configured",
  "tool_dispatch_stale_jobs_present",
  "tool_dispatch_worker_not_enabled",
] as const;

export const toolDispatchPostureSchemas = {
  ToolDispatchPostureReport: {
    type: "object",
    required: [
      "schema",
      "generatedAt",
      "orgId",
      "status",
      "backend",
      "deployment",
      "queue",
      "payloadStorage",
      "liveEvidence",
      "redaction",
      "warnings",
    ],
    additionalProperties: false,
    properties: {
      schema: { type: "string", enum: ["romeo.tool-dispatch-posture.v1"] },
      generatedAt: { type: "string", format: "date-time" },
      orgId: { type: "string" },
      status: { type: "string", enum: ["attention_required", "ready"] },
      backend: {
        type: "object",
        required: [
          "activeLeaseRequiredForPayloadReadback",
          "jobType",
          "maxAttempts",
          "requiredWorkerScope",
          "terminalReadbackRejectsReplay",
          "workerQueue",
        ],
        additionalProperties: false,
        properties: {
          activeLeaseRequiredForPayloadReadback: {
            type: "boolean",
            enum: [true],
          },
          jobType: {
            type: "string",
            enum: ["tool.operation.dispatch_request"],
          },
          maxAttempts: { type: "integer", minimum: 1 },
          requiredWorkerScope: { type: "string", enum: ["tools:manage"] },
          terminalReadbackRejectsReplay: { type: "boolean", enum: [true] },
          workerQueue: { type: "string", enum: ["external_tool_operations"] },
        },
      },
      deployment: {
        type: "object",
        required: [
          "externalOperationExecutionEnabled",
          "liveEvidencePathConfigured",
          "networkPolicyConfigured",
          "operationExecutionDriver",
          "payloadEncryptionKeyConfigured",
          "payloadStoreConfigured",
          "payloadStoreDriver",
          "workerEnabled",
        ],
        additionalProperties: false,
        properties: {
          externalOperationExecutionEnabled: { type: "boolean" },
          liveEvidencePathConfigured: { type: "boolean" },
          networkPolicyConfigured: { type: "boolean" },
          operationExecutionDriver: {
            type: "string",
            enum: ["disabled", "http-fetch"],
          },
          payloadEncryptionKeyConfigured: { type: "boolean" },
          payloadStoreConfigured: { type: "boolean" },
          payloadStoreDriver: {
            type: "string",
            enum: ["disabled", "object-store"],
          },
          workerEnabled: { type: "boolean" },
        },
      },
      queue: {
        type: "object",
        required: [
          "cancelled",
          "completed",
          "deadLettered",
          "expired",
          "failed",
          "oldestQueuedAgeSeconds",
          "queued",
          "running",
          "staleQueued",
          "staleRunning",
          "total",
        ],
        additionalProperties: false,
        properties: {
          cancelled: nonNegativeInteger,
          completed: nonNegativeInteger,
          deadLettered: nonNegativeInteger,
          expired: nonNegativeInteger,
          failed: nonNegativeInteger,
          oldestQueuedAgeSeconds: nullableNonNegativeInteger,
          queued: nonNegativeInteger,
          running: nonNegativeInteger,
          staleQueued: nonNegativeInteger,
          staleRunning: nonNegativeInteger,
          total: nonNegativeInteger,
        },
      },
      payloadStorage: {
        type: "object",
        required: [
          "externalWorkerSecretStoreRequired",
          "managedEncryptedObjectStore",
          "unknown",
        ],
        additionalProperties: false,
        properties: {
          externalWorkerSecretStoreRequired: nonNegativeInteger,
          managedEncryptedObjectStore: nonNegativeInteger,
          unknown: nonNegativeInteger,
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
          "mcp",
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
            enum: ["romeo.tool-dispatch-live-evidence.v1"],
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
            required: [...toolDispatchLiveEvidenceChecks],
            additionalProperties: false,
            properties: Object.fromEntries(
              toolDispatchLiveEvidenceChecks.map((check) => [
                check,
                { type: "boolean" },
              ]),
            ),
          },
          failureCodes: { type: "array", items: { type: "string" } },
          summary: {
            type: "object",
            required: [
              "completedDispatchCount",
              "deniedPrivateTargetCount",
              "dispatchRequestCount",
              "failedDispatchCount",
              "managedPayloadReadCount",
              "podLogScanCount",
              "reclaimedDispatchCount",
              "schemaValidationCount",
              "secretResolutionCount",
              "workerLogScanCount",
            ],
            additionalProperties: false,
            properties: {
              completedDispatchCount: nonNegativeInteger,
              deniedPrivateTargetCount: nonNegativeInteger,
              dispatchRequestCount: nonNegativeInteger,
              failedDispatchCount: nonNegativeInteger,
              managedPayloadReadCount: nonNegativeInteger,
              podLogScanCount: nonNegativeInteger,
              reclaimedDispatchCount: nonNegativeInteger,
              schemaValidationCount: nonNegativeInteger,
              secretResolutionCount: nonNegativeInteger,
              workerLogScanCount: nonNegativeInteger,
            },
          },
          mcp: {
            type: "object",
            required: [
              "callCount",
              "jsonRpcEnvelopeVerified",
              "outputRedacted",
              "payloadArgumentsRedacted",
              "protocolHeadersVerified",
              "streamableHttpToolsCallVerified",
            ],
            additionalProperties: false,
            properties: {
              callCount: nonNegativeInteger,
              jsonRpcEnvelopeVerified: { type: "boolean" },
              outputRedacted: { type: "boolean" },
              payloadArgumentsRedacted: { type: "boolean" },
              protocolHeadersVerified: { type: "boolean" },
              streamableHttpToolsCallVerified: { type: "boolean" },
            },
          },
          redaction: toolDispatchRedactionSchema({ strictFalse: false }),
        },
      },
      redaction: toolDispatchRedactionSchema({ strictFalse: true }),
      warnings: {
        type: "array",
        items: { type: "string", enum: [...toolDispatchWarnings] },
      },
    },
  },
};

function toolDispatchRedactionSchema({
  strictFalse,
}: {
  strictFalse: boolean;
}) {
  const valueSchema = strictFalse ? booleanFalse : { type: "boolean" };
  return {
    type: "object",
    required: [
      "rawEvidencePathsReturned",
      "rawObjectStoreKeysReturned",
      "rawOperationHostsReturned",
      "rawPayloadValuesReturned",
      "rawResponseBodiesReturned",
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
      rawEvidencePathsReturned: valueSchema,
      ...(strictFalse ? {} : { rawLogLinesReturned: valueSchema }),
      rawObjectStoreKeysReturned: valueSchema,
      rawOperationHostsReturned: valueSchema,
      rawPayloadValuesReturned: valueSchema,
      rawResponseBodiesReturned: valueSchema,
      rawSecretRefsReturned: valueSchema,
      secretValuesReturned: valueSchema,
      tokenValuesReturned: valueSchema,
    },
  };
}
