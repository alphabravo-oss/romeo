import { z } from "@hono/zod-openapi";

import { ProviderKindSchema as providerKind } from "./provider-capability-schemas";

const identifier = z.string().trim().min(1).max(300);

export const ProviderOperationalSummarySchema = z
  .strictObject({
    alerts: z.array(
      z.strictObject({
        code: z.enum([
          "fallback_unavailable",
          "no_available_providers",
          "provider_circuit_open",
          "provider_disabled",
          "provider_kill_switch",
          "provider_without_enabled_models",
          "object_store_failures_recent",
          "provider_errors_recent",
          "queue_wait_high",
          "sse_disconnects_recent",
          "sse_heartbeat_failures_recent",
          "sse_notifier_lag_high",
          "sse_notifier_unavailable_recent",
          "sse_slow_consumers_recent",
          "sse_terminal_close_slow",
          "time_to_first_token_high",
        ]),
        id: identifier,
        modelId: identifier.optional(),
        providerId: identifier.optional(),
        severity: z.enum(["critical", "warning"]),
      }),
    ),
    fallback: z.strictObject({
      available: z.boolean(),
      configured: z.boolean(),
      modelId: identifier.optional(),
      providerId: identifier.optional(),
      reason: z
        .enum(["model_disabled", "model_missing", "provider_disabled"])
        .optional(),
    }),
    generatedAt: z.iso.datetime(),
    policy: z.strictObject({
      circuitCooldownMs: z.number().nonnegative(),
      circuitFailureThreshold: z.number().int().nonnegative(),
      disabledProviderIds: z.array(identifier),
      fallbackModelId: identifier.optional(),
      retryAttempts: z.number().int().nonnegative(),
      retryBackoffMs: z.number().nonnegative(),
      streamTimeoutMs: z.number().nonnegative(),
    }),
    providers: z.array(
      z.strictObject({
        circuit: z.strictObject({
          consecutiveFailures: z.number().int().nonnegative(),
          state: z.enum(["closed", "half_open", "open"]),
        }),
        enabled: z.boolean(),
        enabledModelCount: z.number().int().nonnegative(),
        killSwitchActive: z.boolean(),
        modelCount: z.number().int().nonnegative(),
        providerId: identifier,
        reasons: z.array(z.string()),
        status: z.enum(["available", "degraded", "unavailable"]),
        type: providerKind,
      }),
    ),
    runtime: z.strictObject({
      apiDeprecations: z.strictObject({
        generatedAt: z.iso.datetime(),
        observationScope: z.literal("process"),
        observationStartedAt: z.iso.datetime(),
        observationWindowSeconds: z.number().int().nonnegative(),
        operations: z.array(
          z.strictObject({
            firstUsedAt: z.iso.datetime().optional(),
            lastUsedAt: z.iso.datetime().optional(),
            operationId: identifier,
            requestCount: z.number().int().nonnegative(),
            responseClasses: z.strictObject({
              "1xx": z.number().int().nonnegative(),
              "2xx": z.number().int().nonnegative(),
              "3xx": z.number().int().nonnegative(),
              "4xx": z.number().int().nonnegative(),
              "5xx": z.number().int().nonnegative(),
              other: z.number().int().nonnegative(),
            }),
            zeroUsageWindowSeconds: z.number().int().nonnegative(),
            zeroUsageWindowStartedAt: z.iso.datetime(),
          }),
        ),
      }),
      capabilityFlags: z.strictObject({
        observationScope: z.literal("process"),
        total: z.number().int().nonnegative(),
        resolutions: z.array(
          z.strictObject({
            flagId: z.string().min(1).max(100),
            effectiveState: z.enum(["disabled", "enabled"]),
            reasonCode: z.enum([
              "enabled",
              "disabled",
              "preview_allowlisted",
              "preview_not_allowlisted",
              "platform_disabled",
            ]),
            count: z.number().int().nonnegative(),
          }),
        ),
      }),
      capabilityAssignments: z.strictObject({
        observationScope: z.literal("process"),
        total: z.number().int().nonnegative(),
        resolutions: z.array(
          z.strictObject({
            capabilityId: z.enum([
              "image_generation",
              "reasoning_policy",
              "voice_processing",
              "web_retrieval",
            ]),
            status: z.enum([
              "enabled",
              "disabled",
              "required",
              "normalized",
              "not_configured",
              "not_entitled",
              "not_allowed",
              "unsupported",
              "unhealthy",
            ]),
            count: z.number().int().nonnegative(),
          }),
        ),
      }),
      idempotency: z.strictObject({
        observationScope: z.literal("process"),
        outcomes: z.array(
          z.strictObject({
            operation: z.enum(["images.generate", "runs.start"]),
            outcome: z.enum([
              "owner",
              "replay",
              "conflict",
              "in_progress",
              "failed",
            ]),
            count: z.number().int().nonnegative(),
          }),
        ),
      }),
      contextInputTokensAverage: z.number(),
      lookbackSeconds: z.number().nonnegative(),
      objectStoreFailureCount: z.number().nonnegative(),
      providerErrorCount: z.number().nonnegative(),
      queueWaitP95Ms: z.number().nonnegative(),
      recoveryCount: z.number().nonnegative(),
      sseDisconnectCount: z.number().nonnegative(),
      sseReconnectCount: z.number().nonnegative(),
      sse: z
        .strictObject({
          activeStreams: z.number().int().nonnegative(),
          bufferedBytesHighWater: z.number().int().nonnegative(),
          connectionCount: z.number().int().nonnegative(),
          cursorQueryCount: z.number().int().nonnegative(),
          cursorQueryRowCount: z.number().int().nonnegative(),
          heartbeatFailureCount: z.number().int().nonnegative(),
          lookbackSeconds: z.number().int().positive(),
          notifierLagAverageMs: z.number().nonnegative(),
          notifierLagP95Ms: z.number().nonnegative(),
          notifierUnavailableCount: z.number().int().nonnegative(),
          observationScope: z.literal("process"),
          reconnectCount: z.number().int().nonnegative(),
          replayedRowCount: z.number().int().nonnegative(),
          slowConsumerDropCount: z.number().int().nonnegative(),
          terminalCloseLatencyAverageMs: z.number().nonnegative(),
          terminalCloseLatencyP95Ms: z.number().nonnegative(),
        })
        .optional(),
      timeToFirstTokenAverageMs: z.number().nonnegative(),
      timeToFirstTokenP95Ms: z.number().nonnegative(),
      uploadPipelineAverageMs: z.number().nonnegative(),
      webRetrievalAverageMs: z.number().nonnegative(),
      outputThroughputAverage: z.number(),
    }),
    status: z.enum(["critical", "degraded", "healthy"]),
  })
  .openapi("ProviderOperationalSummary");
