import { z } from "@hono/zod-openapi";

export const ProviderKindSchema = z.enum([
  "anthropic",
  "openai-compatible",
  "openai-responses-compatible",
  "ollama",
]);

const modelModality = z.enum([
  "audio-input",
  "audio-output",
  "embeddings",
  "text",
  "vision",
]);

export const ProviderCapabilitiesSchema = z
  .strictObject({
    streaming: z.boolean(),
    toolCalling: z.boolean(),
    vision: z.boolean(),
    audioInput: z.boolean(),
    structuredJson: z.boolean(),
    reasoning: z.boolean(),
    imageGeneration: z.boolean().optional(),
    modalities: z.array(modelModality),
    deployment: z.strictObject({
      mode: z.enum(["hosted-api", "local-runtime"]),
      networkAccess: z.enum(["external-http", "local-http"]),
      credentialRequired: z.boolean(),
    }),
  })
  .openapi("ProviderCapabilities");

export const ProviderImagePricingSchema = z.strictObject({
  "1024x1024": z.number().nonnegative(),
  "1024x1536": z.number().nonnegative(),
  "1536x1024": z.number().nonnegative(),
});
