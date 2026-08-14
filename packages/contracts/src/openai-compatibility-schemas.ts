import { z } from "@hono/zod-openapi";

const content = z.string().max(200_000);
const systemMessage = z
  .object({ role: z.literal("system"), content })
  .passthrough();
const userMessage = z
  .object({ role: z.literal("user"), content })
  .passthrough();
const assistantMessage = z
  .object({
    role: z.literal("assistant"),
    content: content.nullable().optional(),
    tool_calls: z.array(z.unknown()).max(64).optional(),
  })
  .passthrough()
  .transform((message) => ({
    role: message.role,
    content: message.content ?? "",
    ...(message.tool_calls === undefined
      ? {}
      : { toolCalls: message.tool_calls }),
  }));
const toolMessage = z
  .object({
    role: z.literal("tool"),
    content,
    name: z.string().min(1).max(160).optional(),
    tool_call_id: z.string().min(1).max(200).optional(),
  })
  .passthrough()
  .transform((message) => ({
    role: message.role,
    content: message.content,
    ...(message.name === undefined ? {} : { name: message.name }),
    ...(message.tool_call_id === undefined
      ? {}
      : { toolCallId: message.tool_call_id }),
  }));
const chatTool = z
  .object({
    type: z.literal("function"),
    function: z.object({
      name: z
        .string()
        .min(1)
        .max(160)
        .regex(/^[A-Za-z0-9_.:/-]+$/u),
      description: z.string().max(2_000).optional(),
      parameters: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .passthrough();

export const OpenAiChatCompletionRequestSchema = z
  .object({
    model: z.string().min(1).max(200),
    messages: z
      .array(
        z.discriminatedUnion("role", [
          systemMessage,
          userMessage,
          assistantMessage,
          toolMessage,
        ]),
      )
      .min(1)
      .max(128),
    stream: z.boolean().optional(),
    stream_options: z
      .object({ include_usage: z.boolean().optional() })
      .passthrough()
      .optional(),
    tools: z.array(chatTool).max(64).optional(),
  })
  .passthrough()
  .transform((request) => ({
    model: request.model,
    messages: request.messages,
    ...(request.stream === undefined ? {} : { stream: request.stream }),
    ...(request.stream_options?.include_usage === undefined
      ? {}
      : {
          streamOptions: { includeUsage: request.stream_options.include_usage },
        }),
    ...(request.tools === undefined ? {} : { tools: request.tools }),
    ...openAiChatParameters(request as Record<string, unknown>),
  }))
  .openapi("OpenAiChatCompletionRequest");

function openAiChatParameters(request: Record<string, unknown>) {
  const sampling = {
    ...(finiteNumber(request.temperature)
      ? { temperature: request.temperature }
      : {}),
    ...(finiteNumber(request.top_p) ? { topP: request.top_p } : {}),
    ...(finiteNumber(request.max_tokens)
      ? { maxTokens: request.max_tokens }
      : {}),
  };
  const reasoning = reasoningEffort(request.reasoning_effort)
    ? { effort: request.reasoning_effort }
    : undefined;
  const structuredOutput = openAiStructuredOutput(request.response_format);
  return {
    ...(Object.keys(sampling).length === 0 ? {} : { sampling }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(structuredOutput === undefined ? {} : { structuredOutput }),
  };
}

function openAiStructuredOutput(value: unknown) {
  const format = objectRecord(value);
  if (format?.type === "json_object") return { type: "json_object" as const };
  const definition = objectRecord(format?.json_schema);
  const schema = objectRecord(definition?.schema);
  if (
    format?.type !== "json_schema" ||
    typeof definition?.name !== "string" ||
    schema === undefined ||
    (definition.strict !== undefined && typeof definition.strict !== "boolean")
  ) {
    return undefined;
  }
  return {
    type: "json_schema" as const,
    name: definition.name,
    schema,
    ...(definition.strict === undefined ? {} : { strict: definition.strict }),
  };
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function reasoningEffort(value: unknown): value is "high" | "low" | "medium" {
  return value === "high" || value === "low" || value === "medium";
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export const OpenAiEmbeddingRequestSchema = z
  .object({
    model: z.string().min(1).max(200),
    input: z.union([
      z.string().min(1).max(200_000),
      z.array(z.string().min(1).max(200_000)).min(1).max(128),
    ]),
    encoding_format: z.literal("float").optional(),
  })
  .passthrough()
  .transform((request) => ({
    model: request.model,
    input: Array.isArray(request.input) ? request.input : [request.input],
  }))
  .openapi("OpenAiEmbeddingRequest");

export const OpenAiModelSchema = z
  .strictObject({
    id: z.string(),
    object: z.literal("model"),
    created: z.number().int(),
    owned_by: z.string(),
  })
  .openapi("OpenAiModel");
export const OpenAiModelListResponseSchema = z
  .strictObject({ object: z.literal("list"), data: z.array(OpenAiModelSchema) })
  .openapi("OpenAiModelListResponse");

const usageFields = {
  prompt_tokens: z.number().int().optional(),
  total_tokens: z.number().int().optional(),
};
const usage = z
  .strictObject({
    ...usageFields,
    completion_tokens: z.number().int().optional(),
    prompt_tokens_details: z
      .strictObject({ cached_tokens: z.number().int().nonnegative() })
      .optional(),
    completion_tokens_details: z
      .strictObject({ reasoning_tokens: z.number().int().nonnegative() })
      .optional(),
  })
  .nullable();
const toolCall = z.strictObject({
  id: z.string(),
  type: z.literal("function"),
  function: z.strictObject({ name: z.string(), arguments: z.string() }),
});
export const OpenAiChatCompletionResponseSchema = z
  .strictObject({
    id: z.string(),
    object: z.literal("chat.completion"),
    created: z.number().int(),
    model: z.string(),
    choices: z.array(
      z.strictObject({
        index: z.number().int(),
        finish_reason: z.enum(["stop", "tool_calls"]),
        message: z.strictObject({
          role: z.literal("assistant"),
          content: z.string().nullable(),
          tool_calls: z.array(toolCall).optional(),
        }),
      }),
    ),
    usage,
  })
  .openapi("OpenAiChatCompletionResponse");

export const OpenAiEmbeddingResponseSchema = z
  .strictObject({
    object: z.literal("list"),
    model: z.string(),
    data: z.array(
      z.strictObject({
        object: z.literal("embedding"),
        index: z.number().int(),
        embedding: z.array(z.number()),
      }),
    ),
    usage: z.strictObject(usageFields).nullable(),
  })
  .openapi("OpenAiEmbeddingResponse");

export type OpenAiChatCompletionRequest = z.infer<
  typeof OpenAiChatCompletionRequestSchema
>;
export type OpenAiChatMessageInput =
  OpenAiChatCompletionRequest["messages"][number];
export type OpenAiChatToolInput = NonNullable<
  OpenAiChatCompletionRequest["tools"]
>[number];
export type OpenAiChatCompletionResponse = z.infer<
  typeof OpenAiChatCompletionResponseSchema
>;
export type OpenAiChatCompletionChoice =
  OpenAiChatCompletionResponse["choices"][number];
export type OpenAiCompletionUsage = NonNullable<
  OpenAiChatCompletionResponse["usage"]
>;
export type OpenAiToolCall = NonNullable<
  OpenAiChatCompletionChoice["message"]["tool_calls"]
>[number];
export type OpenAiEmbeddingRequest = z.infer<
  typeof OpenAiEmbeddingRequestSchema
>;
export type OpenAiEmbeddingResponse = z.infer<
  typeof OpenAiEmbeddingResponseSchema
>;

export const openAiModelParams = z.strictObject({
  model: z.string().trim().min(1).max(200),
});
