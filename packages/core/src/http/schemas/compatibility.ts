import { z } from "@hono/zod-openapi";

const chatMessageContentSchema = z.string().max(200_000);

const systemMessageSchema = z
  .object({
    role: z.literal("system"),
    content: chatMessageContentSchema,
  })
  .passthrough();

const userMessageSchema = z
  .object({
    role: z.literal("user"),
    content: chatMessageContentSchema,
  })
  .passthrough();

const assistantMessageSchema = z
  .object({
    role: z.literal("assistant"),
    content: chatMessageContentSchema.nullable().optional(),
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

const toolMessageSchema = z
  .object({
    role: z.literal("tool"),
    content: chatMessageContentSchema,
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

const chatToolSchema = z
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

export const openAiChatCompletionRequestSchema = z
  .object({
    model: z.string().min(1).max(200),
    messages: z
      .array(
        z.discriminatedUnion("role", [
          systemMessageSchema,
          userMessageSchema,
          assistantMessageSchema,
          toolMessageSchema,
        ]),
      )
      .min(1)
      .max(128),
    stream: z.boolean().optional(),
    stream_options: z
      .object({ include_usage: z.boolean().optional() })
      .passthrough()
      .optional(),
    tools: z.array(chatToolSchema).max(64).optional(),
  })
  .passthrough()
  .transform((request) => ({
    model: request.model,
    messages: request.messages,
    ...(request.stream === undefined ? {} : { stream: request.stream }),
    ...(request.stream_options?.include_usage === undefined
      ? {}
      : {
          streamOptions: {
            includeUsage: request.stream_options.include_usage,
          },
        }),
    ...(request.tools === undefined ? {} : { tools: request.tools }),
  }));

const embeddingInputTextSchema = z.string().min(1).max(200_000);

export const openAiEmbeddingRequestSchema = z
  .object({
    model: z.string().min(1).max(200),
    input: z.union([
      embeddingInputTextSchema,
      z.array(embeddingInputTextSchema).min(1).max(128),
    ]),
    encoding_format: z.enum(["float"]).optional(),
  })
  .passthrough()
  .transform((request) => ({
    model: request.model,
    input: Array.isArray(request.input) ? request.input : [request.input],
  }));
