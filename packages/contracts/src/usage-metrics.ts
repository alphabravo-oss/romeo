import { z } from "@hono/zod-openapi";

/**
 * Versioned public usage metric vocabulary. Semantics such as unit, source,
 * aggregation, measurement provenance, and overlap policy are enforced by the
 * core taxonomy registry; this list keeps OpenAPI and generated SDKs exact.
 */
export const UsageMetricCodes = [
  "audio.input_byte",
  "audio.input_second",
  "audio.output_character",
  "audio.output_second",
  "chat.message.feedback",
  "compute.cpu_millisecond",
  "compute.memory_byte_millisecond",
  "file.upload.pipeline_duration",
  "image.cost.micro_usd",
  "image.generated",
  "image.input",
  "llm.cached_input_token.reported",
  "llm.input_token.estimated",
  "llm.input_token.reported",
  "llm.output_token.estimated",
  "llm.output_token.reported",
  "llm.reasoning_token.reported",
  "llm.total_token.reported",
  "provider.error",
  "queue.wait",
  "retrieval.unit",
  "run.cancelled",
  "run.completed",
  "run.duration",
  "run.failed",
  "run.output_throughput",
  "run.recovery",
  "run.started",
  "run.time_to_first_token",
  "sse.connection",
  "sse.disconnect",
  "sse.reconnect",
  "storage.byte",
  "storage.embedding_indexed",
  "storage.source_completed",
  "storage.source_deleted",
  "storage.source_extracted",
  "storage.source_registered",
  "storage.source_reindexed",
  "tool.call.failure",
  "tool.call.success",
  "trace.span",
  "video.input_second",
  "voice.message.generated",
  "voice.preview.generated",
  "voice.transcription.generated",
  "web.search.request",
  "web.url.fetch",
] as const;

export type UsageMetricCode = (typeof UsageMetricCodes)[number];

export const UsageMetricCodeSchema = z
  .enum(UsageMetricCodes)
  .openapi("UsageMetricCode");

export const UsageUnitCodes = [
  "byte",
  "byte_millisecond",
  "call",
  "character",
  "connection",
  "cpu_millisecond",
  "embedding",
  "error",
  "event",
  "feedback",
  "image",
  "micro_usd",
  "millisecond",
  "recovery",
  "request",
  "retrieval_unit",
  "run",
  "second",
  "token",
  "token_per_second",
  "url",
] as const;

export type UsageUnitCode = (typeof UsageUnitCodes)[number];

export const UsageUnitCodeSchema = z
  .enum(UsageUnitCodes)
  .openapi("UsageUnitCode");

export const UsageMetricDefinitionSchema = z
  .strictObject({
    metric: UsageMetricCodeSchema,
    category: z.enum([
      "activity",
      "audio",
      "compute",
      "cost",
      "image",
      "latency",
      "retrieval",
      "storage",
      "text_token",
      "video",
    ]),
    unit: UsageUnitCodeSchema,
    sourceTypes: z
      .array(z.enum(["chat", "retrieval", "run", "storage", "tool", "voice"]))
      .min(1)
      .max(6),
    aggregation: z.enum(["maximum", "sum"]),
    measurement: z.enum(["activity", "estimated", "measured", "reported"]),
    overlapPolicy: z.enum(["component_of_total", "exclusive", "non_additive"]),
    billable: z.boolean(),
  })
  .openapi("UsageMetricDefinition");

export type UsageMetricDefinition = z.infer<typeof UsageMetricDefinitionSchema>;
