import { z } from "@hono/zod-openapi";

import { dataEnvelope } from "./common";

export const managedModelIdentifier = z.string().trim().min(1).max(300);
export const managedModelTimestamp = z.iso.datetime();
export const parameters = z.record(z.string(), z.unknown());

export const ManagedModelMemoryPolicySchema = z
  .discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("disabled") }),
    z.strictObject({
      mode: z.literal("recent_messages"),
      maxMessages: z.number().int().min(1).max(20).optional(),
    }),
  ])
  .openapi("ManagedModelMemoryPolicy");

export const ManagedModelSafetySettingsSchema = z
  .strictObject({
    maxUserInputLength: z.number().int().min(1).max(200_000).optional(),
    blockedTerms: z
      .array(z.string().trim().min(1).max(120))
      .max(100)
      .optional(),
    promptInjectionGuard: z
      .strictObject({
        mode: z.enum(["disabled", "block"]),
        scanUserInput: z.boolean().optional(),
        scanRetrievedContext: z.boolean().optional(),
      })
      .optional(),
  })
  .openapi("ManagedModelSafetySettings");

export const ManagedModelSchema = z
  .strictObject({
    id: managedModelIdentifier,
    orgId: managedModelIdentifier,
    workspaceId: managedModelIdentifier,
    name: z.string().min(1).max(200),
    createdBy: managedModelIdentifier,
    baseModelId: managedModelIdentifier,
    systemPrompt: z.string(),
    parameters,
    memoryPolicy: ManagedModelMemoryPolicySchema,
    safetySettings: ManagedModelSafetySettingsSchema,
    voiceProfileId: managedModelIdentifier.optional(),
    publishedVersionId: managedModelIdentifier.optional(),
    archivedAt: managedModelTimestamp.optional(),
    updatedAt: managedModelTimestamp,
  })
  .openapi("ManagedModel");

export const knowledgeBinding = z.strictObject({
  knowledgeBaseId: managedModelIdentifier,
  enabled: z.boolean(),
});
export const toolBinding = z.strictObject({
  toolId: managedModelIdentifier,
  enabled: z.boolean(),
  approvalRequired: z.boolean(),
});

export const ManagedModelVersionEvalSuiteSchema = z.strictObject({
  suiteId: managedModelIdentifier,
  runId: managedModelIdentifier.nullable(),
  status: z.enum(["failed", "missing", "passed"]),
  score: z.number().nullable(),
  completedAt: managedModelTimestamp.nullable(),
});

export const ManagedModelVersionEvalSummarySchema = z.strictObject({
  status: z.enum(["failed", "missing", "not_required", "passed"]),
  suiteCount: z.number().int().nonnegative(),
  passedSuiteCount: z.number().int().nonnegative(),
  failedSuiteCount: z.number().int().nonnegative(),
  missingSuiteCount: z.number().int().nonnegative(),
  averageScore: z.number().nullable(),
  evaluatedAt: managedModelTimestamp.nullable(),
  suites: z.array(ManagedModelVersionEvalSuiteSchema),
});

export const ManagedModelVersionSchema = z
  .strictObject({
    id: managedModelIdentifier,
    agentId: managedModelIdentifier,
    orgId: managedModelIdentifier,
    workspaceId: managedModelIdentifier,
    version: z.number().int().positive(),
    status: z.literal("published"),
    baseModelId: managedModelIdentifier,
    systemPrompt: z.string(),
    parameters,
    memoryPolicy: ManagedModelMemoryPolicySchema,
    safetySettings: ManagedModelSafetySettingsSchema,
    voiceProfileId: managedModelIdentifier.optional(),
    knowledgeBaseBindings: z.array(knowledgeBinding).optional(),
    toolBindings: z.array(toolBinding).optional(),
    createdBy: managedModelIdentifier,
    createdAt: managedModelTimestamp,
    publishedAt: managedModelTimestamp,
    evalSummary: ManagedModelVersionEvalSummarySchema.optional(),
  })
  .openapi("ManagedModelVersion");

export const ManagedModelCustomizationPolicySchema = z
  .strictObject({
    allowCommunicationStyle: z.boolean(),
    allowResponseLength: z.boolean(),
    allowLanguage: z.boolean(),
    allowCustomInstructions: z.boolean(),
    allowPersonalMemory: z.boolean(),
    allowVoiceSelection: z.boolean(),
  })
  .openapi("ManagedModelCustomizationPolicy");

export const ManagedModelPreferencesSchema = z
  .strictObject({
    communicationStyle: z
      .enum(["balanced", "concise", "detailed", "formal", "friendly"])
      .optional(),
    responseLength: z.enum(["short", "standard", "long"]).optional(),
    language: z.string().trim().min(1).max(40).optional(),
    customInstructions: z.string().trim().max(2_000).optional(),
    personalMemoryEnabled: z.boolean().optional(),
    voiceProfileId: z.string().trim().min(1).max(160).optional(),
  })
  .openapi("ManagedModelPreferences");

export const CreateManagedModelSchema = z
  .strictObject({
    workspaceId: managedModelIdentifier,
    name: z.string().trim().min(1).max(200),
    baseModelId: managedModelIdentifier,
    systemPrompt: z.string().min(1).max(200_000),
    parameters: parameters.optional(),
    memoryPolicy: ManagedModelMemoryPolicySchema.optional(),
    safetySettings: ManagedModelSafetySettingsSchema.optional(),
  })
  .openapi("CreateManagedModelRequest");

export const UpdateManagedModelSchema = CreateManagedModelSchema.omit({
  workspaceId: true,
})
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one managed-model field is required.",
  })
  .openapi("UpdateManagedModelRequest");

export const CloneManagedModelSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200).optional(),
    systemPrompt: z.string().min(1).max(200_000).optional(),
  })
  .openapi("CloneManagedModelRequest");

export const UpdateManagedModelCustomizationPolicySchema =
  ManagedModelCustomizationPolicySchema.partial()
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one customization-policy field is required.",
    })
    .openapi("UpdateManagedModelCustomizationPolicyRequest");

export const UpdateManagedModelPreferencesSchema =
  ManagedModelPreferencesSchema.partial()
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one managed-model preference is required.",
    })
    .openapi("UpdateManagedModelPreferencesRequest");

export const portableGrant = z.strictObject({
  principalType: z.enum(["group", "service_account", "user"]),
  principalId: managedModelIdentifier,
  permissions: z
    .array(z.enum(["read", "run", "write"]))
    .min(1)
    .max(3),
});

export const ManagedModelExportDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    exportedAt: managedModelTimestamp,
    agent: z.strictObject({
      name: z.string().min(1),
      baseModelId: managedModelIdentifier,
      systemPrompt: z.string().min(1),
      parameters,
      memoryPolicy: ManagedModelMemoryPolicySchema,
      safetySettings: ManagedModelSafetySettingsSchema,
      voiceProfileId: managedModelIdentifier.optional(),
      accessGrants: z.array(portableGrant).max(50).optional(),
      knowledgeBaseBindings: z.array(knowledgeBinding).max(50).optional(),
      toolBindings: z.array(toolBinding).max(100).optional(),
    }),
  })
  .openapi("ManagedModelExportDocument");

export const ImportManagedModelSchema = z
  .strictObject({
    workspaceId: managedModelIdentifier,
    document: z.strictObject({
      schemaVersion: z.literal(1),
      exportedAt: managedModelTimestamp.optional(),
      agent: ManagedModelExportDocumentSchema.shape.agent.extend({
        parameters: parameters.default({}),
        memoryPolicy: ManagedModelMemoryPolicySchema.default({
          mode: "disabled",
        }),
        safetySettings: ManagedModelSafetySettingsSchema.default({}),
        accessGrants: z.array(portableGrant).max(50).default([]),
        knowledgeBaseBindings: z.array(knowledgeBinding).max(50).default([]),
        toolBindings: z.array(toolBinding).max(100).default([]),
      }),
    }),
  })
  .openapi("ImportManagedModelRequest");

export const agentPath = z.strictObject({ agentId: managedModelIdentifier });
export const versionPath = z.strictObject({
  agentId: managedModelIdentifier,
  versionId: managedModelIdentifier,
});
export const workspaceQuery = z.strictObject({
  workspaceId: managedModelIdentifier.optional(),
});

export const modelResponse = dataEnvelope(ManagedModelSchema);
export const modelsResponse = dataEnvelope(z.array(ManagedModelSchema));
export const policyResponse = dataEnvelope(
  ManagedModelCustomizationPolicySchema,
);
export const preferencesResponse = dataEnvelope(ManagedModelPreferencesSchema);
export const versionResponse = dataEnvelope(ManagedModelVersionSchema);
export const versionsResponse = dataEnvelope(
  z.array(ManagedModelVersionSchema),
);
export const exportResponse = dataEnvelope(ManagedModelExportDocumentSchema);

export const versionDiffSchema = z.strictObject({
  agentId: managedModelIdentifier,
  leftVersionId: managedModelIdentifier,
  rightVersionId: managedModelIdentifier,
  changes: z.array(
    z.strictObject({
      field: z.enum([
        "baseModelId",
        "knowledgeBaseBindings",
        "memoryPolicy",
        "safetySettings",
        "systemPrompt",
        "parameters",
        "toolBindings",
        "voiceProfileId",
      ]),
      left: z.unknown(),
      right: z.unknown(),
    }),
  ),
});

export const ManagedModelGrantSchema = z
  .strictObject({
    id: managedModelIdentifier,
    resourceType: z.literal("agent"),
    resourceId: managedModelIdentifier,
    principalType: z.enum(["group", "service_account", "user"]),
    principalId: managedModelIdentifier,
    permission: z.enum(["read", "run", "write"]),
  })
  .openapi("ManagedModelGrant");

export const ShareManagedModelSchema = z
  .strictObject({
    principalType: z.enum(["group", "service_account", "user"]),
    principalId: managedModelIdentifier,
    permissions: z
      .array(z.enum(["read", "run", "write"]))
      .min(1)
      .max(3),
  })
  .openapi("ShareManagedModelRequest");

export const ManagedModelGalleryItemSchema = ManagedModelSchema.extend({
  favorite: z.boolean(),
}).openapi("ManagedModelGalleryItem");

export const ManagedModelKnowledgeBaseSchema = z.strictObject({
  id: managedModelIdentifier,
  orgId: managedModelIdentifier,
  workspaceId: managedModelIdentifier,
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  createdBy: managedModelIdentifier,
  createdAt: managedModelTimestamp,
  updatedAt: managedModelTimestamp,
});

export const ManagedModelKnowledgeBindingSchema = z
  .strictObject({
    id: managedModelIdentifier,
    orgId: managedModelIdentifier,
    agentId: managedModelIdentifier,
    knowledgeBaseId: managedModelIdentifier,
    enabled: z.boolean(),
    createdAt: managedModelTimestamp,
    updatedAt: managedModelTimestamp,
    knowledgeBase: ManagedModelKnowledgeBaseSchema,
  })
  .openapi("ManagedModelKnowledgeBinding");

export const UpdateManagedModelKnowledgeBindingSchema = z
  .strictObject({ enabled: z.boolean() })
  .openapi("UpdateManagedModelKnowledgeBindingRequest");

export const BindManagedModelVoiceSchema = z
  .strictObject({ voiceProfileId: managedModelIdentifier })
  .openapi("BindManagedModelVoiceRequest");
