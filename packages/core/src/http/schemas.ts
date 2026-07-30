import { scopeValues } from "@romeo/auth";
import { z } from "@hono/zod-openapi";

export const createProviderSchema = z.object({
  type: z.enum([
    "anthropic",
    "openai-compatible",
    "openai-responses-compatible",
    "ollama",
  ]),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  credentialRef: z.string().min(1).max(500).optional(),
  modelIds: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
});

export const updateProviderSchema = createProviderSchema
  .omit({ type: true })
  .extend({ enabled: z.boolean().optional() })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required",
  );

const providerCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  toolCalling: z.boolean(),
  vision: z.boolean(),
  audioInput: z.boolean(),
  structuredJson: z.boolean(),
  reasoning: z.boolean(),
  imageGeneration: z.boolean().default(false),
  modalities: z.array(
    z.enum(["audio-input", "audio-output", "embeddings", "text", "vision"]),
  ),
  deployment: z.object({
    mode: z.enum(["hosted-api", "local-runtime"]),
    networkAccess: z.enum(["external-http", "local-http"]),
    credentialRequired: z.boolean(),
  }),
});

export const updateModelCapabilitiesSchema = z.object({
  capabilities: providerCapabilitiesSchema,
  contextWindow: z.number().int().positive().max(10_000_000),
});

export const updateModelEnabledSchema = z.object({ enabled: z.boolean() });

export const updateModelPricingSchema = z.object({
  inputTokenUsd: z.number().nonnegative(),
  outputTokenUsd: z.number().nonnegative(),
  imageGenerationUsd: z
    .object({
      "1024x1024": z.number().nonnegative(),
      "1024x1536": z.number().nonnegative(),
      "1536x1024": z.number().nonnegative(),
    })
    .optional(),
});

export const pullOllamaModelSchema = z.object({
  model: z.string().trim().min(1).max(300),
});

const agentSafetySettingsSchema = z
  .object({
    maxUserInputLength: z.number().int().min(1).max(200_000).optional(),
    blockedTerms: z
      .array(z.string().trim().min(1).max(120))
      .max(100)
      .optional(),
    promptInjectionGuard: z
      .object({
        mode: z.enum(["disabled", "block"]),
        scanUserInput: z.boolean().optional(),
        scanRetrievedContext: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const agentMemoryPolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("disabled") }).strict(),
  z
    .object({
      mode: z.literal("recent_messages"),
      maxMessages: z.number().int().min(1).max(20).optional(),
    })
    .strict(),
]);

export const createAgentSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().max(1_000).optional(),
  icon: z.string().max(16).optional(),
  avatarUrl: z.union([z.literal(""), z.url().max(2_000)]).optional(),
  baseModelId: z.string().min(1),
  systemPrompt: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()).optional(),
  memoryPolicy: agentMemoryPolicySchema.optional(),
  safetySettings: agentSafetySettingsSchema.optional(),
});

export const cloneAgentSchema = z.object({
  includeKnowledgeBindings: z.boolean().optional(),
  name: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
});

export const updateManagedModelCustomizationPolicySchema = z
  .object({
    allowCommunicationStyle: z.boolean().optional(),
    allowResponseLength: z.boolean().optional(),
    allowLanguage: z.boolean().optional(),
    allowCustomInstructions: z.boolean().optional(),
    allowPersonalMemory: z.boolean().optional(),
    allowVoiceSelection: z.boolean().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one customization-policy field is required.",
  );

export const updateManagedModelPreferencesSchema = z
  .object({
    communicationStyle: z
      .enum(["balanced", "concise", "detailed", "formal", "friendly"])
      .optional(),
    responseLength: z.enum(["short", "standard", "long"]).optional(),
    language: z.string().trim().min(1).max(40).optional(),
    customInstructions: z.string().trim().max(2_000).optional(),
    personalMemoryEnabled: z.boolean().optional(),
    voiceProfileId: z.string().trim().max(160).optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one managed-model preference is required.",
  );

const importAgentDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  agent: z.object({
    name: z.string().min(1),
    description: z.string().max(1_000).optional(),
    icon: z.string().max(16).optional(),
    avatarUrl: z.union([z.literal(""), z.url().max(2_000)]).optional(),
    baseModelId: z.string().min(1),
    systemPrompt: z.string().min(1),
    parameters: z.record(z.string(), z.unknown()).default({}),
    memoryPolicy: agentMemoryPolicySchema.default({ mode: "disabled" }),
    safetySettings: agentSafetySettingsSchema.default({}),
    voiceProfileId: z.string().min(1).optional(),
    accessGrants: z
      .array(
        z.object({
          principalType: z.enum(["group", "service_account", "user"]),
          principalId: z.string().min(1).max(160),
          permissions: z
            .array(z.enum(["read", "run", "write"]))
            .min(1)
            .max(3),
        }),
      )
      .max(50)
      .default([]),
    knowledgeBaseBindings: z
      .array(
        z.object({
          knowledgeBaseId: z.string().min(1),
          enabled: z.boolean().default(true),
        }),
      )
      .max(50)
      .default([]),
    toolBindings: z
      .array(
        z.object({
          toolId: z.string().min(1),
          enabled: z.boolean().default(true),
          approvalRequired: z.boolean().default(false),
        }),
      )
      .max(100)
      .default([]),
  }),
});

export const importAgentSchema = z.object({
  workspaceId: z.string().min(1),
  document: importAgentDocumentSchema,
});

export const updateAgentSchema = z
  .object({
    name: z.string().min(1).optional(),
    baseModelId: z.string().min(1).optional(),
    systemPrompt: z.string().min(1).optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    memoryPolicy: agentMemoryPolicySchema.optional(),
    safetySettings: agentSafetySettingsSchema.optional(),
  })
  .refine(
    (input) => Object.keys(input).length > 0,
    "At least one agent field is required.",
  );

export const updateAgentKnowledgeBindingSchema = z.object({
  enabled: z.boolean(),
});

export const startRunSchema = z.object({
  chatId: z.string().min(1),
  agentId: z.string().min(1),
  content: z.string().min(1),
  modelId: z.string().min(1).optional(),
  historyBoundaryMessageId: z.string().min(1).optional(),
  fileIds: z.array(z.string().min(1).max(160)).max(8).optional(),
  webSearch: z.boolean().optional(),
  urls: z.array(z.string().url()).max(5).optional(),
  attachments: z
    .array(
      z.object({
        fileName: z.string().min(1).max(160),
        mimeType: z.enum([
          "image/gif",
          "image/jpeg",
          "image/png",
          "image/webp",
        ]),
        sizeBytes: z.number().int().positive().max(5_000_000),
        dataBase64: z.string().min(1).max(7_000_000),
      }),
    )
    .max(4)
    .optional(),
});

export const inspectRunContextSchema = startRunSchema
  .omit({ attachments: true, historyBoundaryMessageId: true })
  .extend({ imageCount: z.number().int().min(0).max(4).optional() });

export const enqueueRunSchema = startRunSchema
  .omit({
    attachments: true,
    fileIds: true,
    historyBoundaryMessageId: true,
  })
  .extend({ idempotencyKey: z.string().min(1).max(200).optional() });
