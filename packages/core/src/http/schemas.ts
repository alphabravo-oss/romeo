import { scopeValues } from "@romeo/auth";
import { z } from "@hono/zod-openapi";

import { webhookEventTypes } from "../domain/webhooks";
import { dataConnectorTypes } from "../domain/data-connectors";
import { ssoOidcProviderPresetIds } from "../domain/sso-provider-presets";
import { authProviderIds } from "../domain/auth-providers";
import {
  ragPolicyChangeJustificationCodes,
  ragPolicyChangeRejectReasonCodes,
  ragPolicyExternalVectorDrStrategies,
  ragPolicyExternalVectorExportPolicies,
  ragPolicyExternalVectorModes,
  ragPolicyPhysicalVectorIsolationEnforcements,
  ragPolicyPhysicalVectorIsolationModes,
  ragPolicyTiers,
  ragVectorIsolationPolicies,
} from "../domain/rag-policy";

export const createProviderSchema = z.object({
  type: z.enum(["openai-compatible", "openai-responses-compatible", "ollama"]),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  credentialRef: z.string().min(1).max(500).optional(),
});

export const updateModelPricingSchema = z.object({
  inputTokenUsd: z.number().nonnegative(),
  outputTokenUsd: z.number().nonnegative(),
});

export const createApiKeySchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.enum(scopeValues)).min(1),
});

export const createDeviceAuthorizationSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.enum(scopeValues)).min(1).max(32),
  ttlDays: z.number().int().min(1).max(365).optional(),
});

export const refreshDeviceAuthorizationSchema = z.object({
  refreshToken: z.string().regex(/^rmr_[a-f0-9]{48}$/),
});

export const createSessionSchema = z.object({
  name: z.string().min(1).max(120).default("Local session"),
  ttlHours: z.number().int().min(1).max(720).optional(),
});

export const localLoginSchema = z
  .object({
    email: z.string().email().max(320),
    orgId: z.string().min(1).max(120).optional(),
    password: z.string().min(1).max(256),
    recoveryCode: z
      .string()
      .regex(/^rmfa-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}$/u)
      .optional(),
    totpCode: z
      .string()
      .regex(/^\d{6}$/u)
      .optional(),
  })
  .refine(
    (value) => value.totpCode === undefined || value.recoveryCode === undefined,
    {
      message: "Provide one MFA method.",
    },
  );

export const ldapLoginSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
  orgId: z.string().min(1).max(120).optional(),
  password: z.string().min(1).max(256),
  providerId: z.enum(["ldap", "active-directory"]),
});

export const localMfaVerifySchema = z
  .object({
    challengeToken: z.string().min(1).max(4_000),
    code: z
      .string()
      .regex(/^\d{6}$/u)
      .optional(),
    recoveryCode: z
      .string()
      .regex(/^rmfa-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}$/u)
      .optional(),
  })
  .refine(
    (value) =>
      (value.code === undefined) !== (value.recoveryCode === undefined),
    { message: "Provide exactly one MFA method." },
  );

export const setLocalPasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256).optional(),
  newPassword: z.string().min(12).max(256),
});

export const updateMyProfileSchema = z
  .object({
    email: z.string().email().max(320).optional(),
    name: z.string().min(1).max(120).optional(),
  })
  .refine((value) => value.email !== undefined || value.name !== undefined, {
    message: "At least one profile field is required.",
  });

export const adminSetLocalPasswordSchema = z.object({
  confirmUserId: z.string().min(1).max(120),
  newPassword: z.string().min(12).max(256),
});

export const createTenantOrganizationSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(80).optional(),
  defaultWorkspace: z
    .object({
      name: z.string().min(1).max(120).optional(),
      slug: z.string().min(1).max(80).optional(),
    })
    .optional(),
  initialAdmin: z
    .object({
      email: z.string().email().max(320),
      name: z.string().min(1).max(120),
      password: z.string().min(12).max(256).optional(),
    })
    .optional(),
});

export const updateTenantOrganizationSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    slug: z.string().min(1).max(80).optional(),
  })
  .refine((value) => value.name !== undefined || value.slug !== undefined, {
    message: "At least one organization field is required.",
  });

export const tenantOrganizationConfirmationSchema = z.object({
  confirmOrgId: z.string().min(1).max(120),
});

export const tenantOrganizationReasonSchema =
  tenantOrganizationConfirmationSchema.extend({
    reasonCode: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9_.:/@-]+$/u),
  });

export const tenantDeletionFinalizationEvidenceSchema =
  tenantOrganizationConfirmationSchema.extend({
    controls: z
      .array(
        z.object({
          control: z.enum([
            "backup_retention_review",
            "external_secret_store_review",
            "external_vector_purge_review",
            "object_store_purge_plan_review",
            "operational_log_retention_review",
            "postgres_purge_plan_review",
            "support_bundle_retention_review",
          ]),
          evidenceRefHash: z
            .string()
            .regex(/^[a-f0-9]{64}$/iu)
            .optional(),
          status: z.enum(["failed", "not_applicable", "passed"]),
        }),
      )
      .min(1)
      .max(12),
  });

export const tenantDeletionFinalizationExecuteSchema =
  tenantOrganizationConfirmationSchema.extend({
    confirmPermanentDeletion: z.literal(true),
  });

export const totpEnrollmentSchema = z.object({
  name: z.string().min(1).max(120).optional(),
});

export const totpConfirmSchema = z.object({
  factorId: z.string().min(1).max(120),
  code: z.string().regex(/^\d{6}$/u),
});

export const recoveryCodesGenerateSchema = z.object({
  totpCode: z.string().regex(/^\d{6}$/u),
});

export const totpDisableSchema = z.object({
  code: z
    .string()
    .regex(/^\d{6}$/u)
    .optional(),
});

export const updateUserRoleSchema = z.object({
  confirmUserId: z.string().min(1).max(120),
  role: z.enum(["user", "org_admin", "global_admin"]),
});

export const directorySyncSchema = z.object({
  allowAdminUserDisable: z.boolean().optional(),
  confirmApply: z.literal("apply-directory-sync").optional(),
  disableMissingUsers: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  groupMemberships: z
    .array(
      z.object({
        groupId: z.string().min(1).max(120),
        presentUserIds: z.array(z.string().min(1).max(120)).max(10_000),
      }),
    )
    .max(500)
    .optional(),
  maxMembershipRemovals: z.number().int().min(0).max(10_000).optional(),
  maxUserDisables: z.number().int().min(0).max(1_000).optional(),
  presentUserEmails: z
    .array(z.string().email().max(320))
    .max(10_000)
    .optional(),
  presentUserIds: z.array(z.string().min(1).max(120)).max(10_000).optional(),
  preserveAdminUsers: z.boolean().optional(),
  reason: z.string().min(1).max(500).optional(),
  removeMissingGroupMembers: z.boolean().optional(),
  source: z.enum([
    "active-directory",
    "ldap",
    "manual",
    "oidc",
    "saml",
    "scim",
  ]),
});

const authProviderIdSchema = z.enum(authProviderIds);
const authProviderOidcStringMapSchema = z.record(
  z.string().min(1).max(200),
  z.string().min(1).max(200),
);
const authProviderOidcPatchSchema = z.object({
  issuerUrl: z
    .union([z.string().url(), z.literal("")])
    .nullable()
    .optional(),
  clientId: z.string().max(200).nullable().optional(),
  groupClaim: z.string().min(1).max(100).nullable().optional(),
  adminGroups: z
    .array(z.string().min(1).max(200))
    .max(100)
    .nullable()
    .optional(),
  groupMap: authProviderOidcStringMapSchema.nullable().optional(),
  workspaceGroupMap: authProviderOidcStringMapSchema.nullable().optional(),
  workspaceGroupPrefix: z.string().max(200).nullable().optional(),
});
const authProviderOAuth2StringMapSchema = z.record(
  z.string().min(1).max(240),
  z.string().min(1).max(200),
);
const authProviderOAuth2PatchSchema = z.object({
  adminTeams: z
    .array(z.string().min(1).max(200))
    .max(100)
    .nullable()
    .optional(),
  clientId: z.string().max(200).nullable().optional(),
  groupMap: authProviderOAuth2StringMapSchema.nullable().optional(),
  requiredOrganizations: z
    .array(z.string().min(1).max(100))
    .max(100)
    .nullable()
    .optional(),
  requiredTeams: z
    .array(z.string().min(1).max(200))
    .max(100)
    .nullable()
    .optional(),
  scopes: z.array(z.string().min(1).max(100)).max(20).nullable().optional(),
  workspaceTeamMap: authProviderOAuth2StringMapSchema.nullable().optional(),
  workspaceTeamPrefix: z.string().max(200).nullable().optional(),
});
const authProviderLdapStringMapSchema = z.record(
  z.string().min(1).max(240),
  z.string().min(1).max(200),
);
const ldapDnSchema = z.string().min(1).max(500);
const ldapFilterSchema = z.string().min(1).max(500);
const ldapAttributeSchema = z.string().min(1).max(80);
const authProviderLdapPatchSchema = z.object({
  adminGroups: z
    .array(z.string().min(1).max(240))
    .max(100)
    .nullable()
    .optional(),
  baseDn: ldapDnSchema.nullable().optional(),
  bindDn: ldapDnSchema.nullable().optional(),
  emailAttribute: ldapAttributeSchema.nullable().optional(),
  groupMap: authProviderLdapStringMapSchema.nullable().optional(),
  groupNameAttribute: ldapAttributeSchema.nullable().optional(),
  groupSearchBaseDn: ldapDnSchema.nullable().optional(),
  groupSearchFilter: ldapFilterSchema.nullable().optional(),
  nameAttribute: ldapAttributeSchema.nullable().optional(),
  requiredGroups: z
    .array(z.string().min(1).max(240))
    .max(100)
    .nullable()
    .optional(),
  startTls: z.boolean().nullable().optional(),
  url: z.string().min(1).max(500).nullable().optional(),
  userIdAttribute: ldapAttributeSchema.nullable().optional(),
  userSearchFilter: ldapFilterSchema.nullable().optional(),
  workspaceGroupMap: authProviderLdapStringMapSchema.nullable().optional(),
  workspaceGroupPrefix: z.string().max(200).nullable().optional(),
});
const authProviderSamlStringMapSchema = z.record(
  z.string().min(1).max(240),
  z.string().min(1).max(200),
);
const samlAttributeSchema = z.string().min(1).max(200);
const authProviderSamlPatchSchema = z.object({
  acceptedClockSkewMs: z
    .number()
    .int()
    .min(0)
    .max(300_000)
    .nullable()
    .optional(),
  adminGroups: z
    .array(z.string().min(1).max(240))
    .max(100)
    .nullable()
    .optional(),
  emailAttribute: samlAttributeSchema.nullable().optional(),
  entryPoint: z.string().min(1).max(500).nullable().optional(),
  groupMap: authProviderSamlStringMapSchema.nullable().optional(),
  groupsAttribute: samlAttributeSchema.nullable().optional(),
  idpIssuer: z.string().min(1).max(500).nullable().optional(),
  maxAssertionAgeMs: z
    .number()
    .int()
    .min(0)
    .max(3_600_000)
    .nullable()
    .optional(),
  nameAttribute: samlAttributeSchema.nullable().optional(),
  requiredGroups: z
    .array(z.string().min(1).max(240))
    .max(100)
    .nullable()
    .optional(),
  spEntityId: z.string().min(1).max(500).nullable().optional(),
  subjectAttribute: samlAttributeSchema.nullable().optional(),
  wantAuthnResponseSigned: z.boolean().nullable().optional(),
  workspaceGroupMap: authProviderSamlStringMapSchema.nullable().optional(),
  workspaceGroupPrefix: z.string().max(200).nullable().optional(),
});
const authProviderSharedPatchSchema = z.object({
  providerId: authProviderIdSchema,
  clear: z.boolean().optional(),
  enabled: z.boolean().nullable().optional(),
  displayName: z.string().min(1).max(100).nullable().optional(),
  loginOrder: z.number().int().min(0).max(1000).nullable().optional(),
  allowedEmailDomains: z
    .array(z.string().min(1).max(253))
    .max(100)
    .nullable()
    .optional(),
  disabledReason: z.string().min(1).max(200).nullable().optional(),
  ldap: authProviderLdapPatchSchema.nullable().optional(),
  oauth2: authProviderOAuth2PatchSchema.nullable().optional(),
  oidc: authProviderOidcPatchSchema.nullable().optional(),
  saml: authProviderSamlPatchSchema.nullable().optional(),
  secretRef: z.string().min(1).max(500).nullable().optional(),
});

const authProviderGlobalPatchSchema = authProviderSharedPatchSchema.extend({
  enabled: z.boolean().optional(),
  orgOverridesAllowed: z.boolean().optional(),
});

export const createManagedSecretSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  orgId: z.string().min(1).max(120).optional(),
  purpose: z.enum([
    "auth_provider_client_secret",
    "data_connector_credential",
    "model_provider_credential",
    "tool_connector_credential",
  ]),
  scope: z.enum(["global", "org"]).optional(),
  storageDriver: z.enum(["local", "vault"]).optional(),
  targetSecretRef: z.string().min(1).max(500).optional(),
  value: z.string().min(1).max(20_000),
});

export const secretRewrapPreviewSchema = z.object({
  includeDisabledMfaFactors: z.boolean().optional(),
  includeGlobalManagedSecrets: z.boolean().optional(),
  targetOrgId: z.string().trim().min(1).max(120).optional(),
});

export const secretRewrapExecuteSchema = secretRewrapPreviewSchema.extend({
  confirmRewrap: z.literal("rewrap-secret-envelopes"),
});

export const updateAuthProviderSettingsSchema = z.object({
  confirmDisableLocalFallback: z.boolean().optional(),
  global: z
    .object({
      providers: z.array(authProviderGlobalPatchSchema).min(1).max(50),
    })
    .optional(),
  orgOverride: z
    .object({
      orgId: z.string().min(1).max(120).optional(),
      providers: z.array(authProviderSharedPatchSchema).min(1).max(50),
    })
    .optional(),
});

const ragPolicyTierSchema = z.enum(ragPolicyTiers);
const ragPolicyBudgetSchema = z
  .object({
    user_private: z.number().int().positive().max(20).optional(),
    workspace: z.number().int().positive().max(20).optional(),
    org: z.number().int().positive().max(20).optional(),
    shared: z.number().int().positive().max(20).optional(),
  })
  .strict();
const ragPolicyKnowledgeBaseIdsSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(500);
const ragPolicyKnowledgeBaseTierAssignmentsSchema = z
  .object({
    org: ragPolicyKnowledgeBaseIdsSchema.optional(),
    shared: ragPolicyKnowledgeBaseIdsSchema.optional(),
  })
  .strict();
const ragPolicyExternalVectorStoreSchema = z
  .object({
    mode: z.enum(ragPolicyExternalVectorModes).optional(),
    namespacePolicy: z.enum(ragVectorIsolationPolicies).optional(),
    partitioningPolicy: z.enum(ragVectorIsolationPolicies).optional(),
    drStrategy: z.enum(ragPolicyExternalVectorDrStrategies).optional(),
    exportPolicy: z.enum(ragPolicyExternalVectorExportPolicies).optional(),
  })
  .strict();
const ragPolicyPhysicalVectorIsolationSchema = z
  .object({
    mode: z.enum(ragPolicyPhysicalVectorIsolationModes).optional(),
    enforcement: z
      .enum(ragPolicyPhysicalVectorIsolationEnforcements)
      .optional(),
  })
  .strict();

export const updateRagPolicySchema = z
  .object({
    enabledTiers: z.array(ragPolicyTierSchema).max(4).optional(),
    defaultMaxResultsPerTier: ragPolicyBudgetSchema.optional(),
    maxResultsPerTier: ragPolicyBudgetSchema.optional(),
    allowedEmbeddingProviderModels: z
      .array(
        z
          .object({
            providerId: z.string().trim().min(1).max(120),
            model: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    knowledgeBaseTierAssignments:
      ragPolicyKnowledgeBaseTierAssignmentsSchema.optional(),
    dataResidencyTags: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(80)
          .regex(/^[A-Za-z0-9_.:-]+$/u),
      )
      .max(50)
      .optional(),
    externalVectorStore: ragPolicyExternalVectorStoreSchema.optional(),
    physicalVectorIsolation: ragPolicyPhysicalVectorIsolationSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.enabledTiers !== undefined ||
      value.defaultMaxResultsPerTier !== undefined ||
      value.maxResultsPerTier !== undefined ||
      value.allowedEmbeddingProviderModels !== undefined ||
      value.knowledgeBaseTierAssignments !== undefined ||
      value.dataResidencyTags !== undefined ||
      value.externalVectorStore !== undefined ||
      value.physicalVectorIsolation !== undefined,
    { message: "At least one RAG policy field is required." },
  );

const ragPolicyChangeEvidenceSummarySchema = z
  .object({
    replayCaseCount: z.number().int().nonnegative().max(100_000).optional(),
    averagePrecision: z.number().min(0).max(1).optional(),
    averageRecall: z.number().min(0).max(1).optional(),
    averageLatencyMs: z.number().nonnegative().max(3_600_000).optional(),
    beforeAfterComparisonAttached: z.boolean().optional(),
  })
  .strict();

export const createRagPolicyChangeRequestSchema = z
  .object({
    policy: updateRagPolicySchema,
    justificationCode: z.enum(ragPolicyChangeJustificationCodes).optional(),
    evidenceSummary: ragPolicyChangeEvidenceSummarySchema.optional(),
  })
  .strict();

export const reviewRagPolicyChangeRequestSchema = z
  .object({
    confirmRequestId: z.string().min(1).max(120),
    reasonCode: z.enum(ragPolicyChangeRejectReasonCodes).optional(),
  })
  .strict();

export const createSupportSessionSchema = z.object({
  targetUserId: z.string().min(1).max(120),
  confirmTargetUserId: z.string().min(1).max(120),
  reason: z.string().min(10).max(500),
  ticketRef: z.string().min(1).max(200).optional(),
  ttlMinutes: z.number().int().min(5).max(60).optional(),
});

export const createSupportSessionRequestSchema = createSupportSessionSchema;

export const createServiceAccountSchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.enum(scopeValues)).min(1),
});

export const bulkRevokeApiKeysSchema = z.object({
  apiKeyIds: z.array(z.string().min(1)).min(1).max(200),
});

export const bulkDisableServiceAccountsSchema = z.object({
  serviceAccountIds: z.array(z.string().min(1)).min(1).max(200),
});

export const createGroupSchema = z.object({
  name: z.string().min(1).max(160),
  slug: z.string().min(1).max(80).optional(),
});

export const addGroupMemberSchema = z.object({
  userId: z.string().min(1).max(120),
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
  baseModelId: z.string().min(1),
  systemPrompt: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()).optional(),
  memoryPolicy: agentMemoryPolicySchema.optional(),
  safetySettings: agentSafetySettingsSchema.optional(),
});

export const cloneAgentSchema = z.object({
  name: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
});

const importAgentDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  agent: z.object({
    name: z.string().min(1),
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

export const createChatSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().min(1),
});

export const forkChatSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  throughMessageId: z.string().min(1).max(160).optional(),
  includeAttachments: z.boolean().optional(),
});

export const updateMessageFeedbackSchema = z
  .object({
    rating: z.enum(["positive", "negative", "none"]),
    reasonCode: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9_.:-]+$/u)
      .optional(),
  })
  .refine(
    (input) => input.rating !== "none" || input.reasonCode === undefined,
    "reasonCode is only valid when recording positive or negative feedback.",
  );

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).optional(),
});

export const updateChatSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
  })
  .refine(
    (input) => Object.keys(input).length > 0,
    "At least one chat field is required.",
  );

export const updateChatLegalHoldSchema = z.object({
  legalHoldUntil: z.string().datetime().nullable().optional(),
  legalHoldReason: z.string().max(500).optional(),
});

export const createChatCommentSchema = z.object({
  body: z.string().min(1).max(5_000),
});

export const createPromptTemplateSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(160),
  description: z.string().min(1).max(500).optional(),
  body: z.string().min(1).max(20_000),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  visibility: z
    .enum(["private", "workspace", "marketplace"])
    .default("private"),
});

export const updatePromptTemplateSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    description: z.string().min(1).max(500).nullable().optional(),
    body: z.string().min(1).max(20_000).optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
    visibility: z.enum(["private", "workspace", "marketplace"]).optional(),
  })
  .refine(
    (input) => Object.keys(input).length > 0,
    "At least one prompt template field is required.",
  );

export const createKnowledgeBaseSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
});

export const updateKnowledgeBaseSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().min(1).max(2_000).nullable().optional(),
  })
  .refine(
    (input) => Object.keys(input).length > 0,
    "At least one knowledge base field is required.",
  );

export const createKnowledgeSourceSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  content: z.string().min(1).max(200_000).optional(),
});

export const createKnowledgeUploadSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

export const reindexKnowledgeSourceSchema = z.object({
  content: z.string().min(1).max(200_000),
  sizeBytes: z.number().int().positive().optional(),
});

export const queryKnowledgeBaseSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().positive().max(20).optional(),
});

const knowledgeRetrievalTierBudgetSchema = z
  .object({
    user_private: z.number().int().positive().max(20).optional(),
    workspace: z.number().int().positive().max(20).optional(),
    org: z.number().int().positive().max(20).optional(),
    shared: z.number().int().positive().max(20).optional(),
  })
  .strict();

export const queryTieredKnowledgeSchema = z.object({
  knowledgeBaseIds: z.array(z.string().min(1)).min(1).max(25),
  query: z.string().min(1),
  maxResultsPerTier: knowledgeRetrievalTierBudgetSchema.optional(),
});

const replayTieredKnowledgeCaseSchema = z
  .object({
    id: z.string().min(1).max(120).optional(),
    knowledgeBaseIds: z.array(z.string().min(1)).min(1).max(25),
    query: z.string().min(1).max(4_000),
    expectedChunkIds: z.array(z.string().min(1)).max(50).optional(),
    maxResultsPerTier: knowledgeRetrievalTierBudgetSchema.optional(),
  })
  .strict();

export const replayTieredKnowledgeSchema = z.object({
  cases: z.array(replayTieredKnowledgeCaseSchema).min(1).max(50),
});

export const compareTieredKnowledgeReplaySchema = z
  .object({
    baseline: z.array(replayTieredKnowledgeCaseSchema).min(1).max(50),
    candidate: z.array(replayTieredKnowledgeCaseSchema).min(1).max(50),
  })
  .strict();

export const indexKnowledgeEmbeddingsSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1).max(200),
  batchSize: z.number().int().positive().max(64).optional(),
});

export const createVoiceProfileSchema = z.object({
  name: z.string().min(1),
  providerVoiceId: z.string().min(1),
  language: z.string().min(2),
  styleTags: z.array(z.string().min(1)).default([]),
});

export const previewVoiceSchema = z.object({
  text: z.string().min(1).max(500),
});

export const generateMessageSpeechSchema = z.object({
  voiceProfileId: z.string().min(1),
});

export const transcribeVoiceSchema = z.object({
  audioBase64: z.string().min(1).max(14_000_000),
  contentType: z.string().min(1).max(120),
  fileName: z.string().min(1).max(200).optional(),
  language: z.string().min(2).max(20).optional(),
  prompt: z.string().min(1).max(500).optional(),
});

export const bindAgentVoiceSchema = z.object({
  voiceProfileId: z.string().min(1),
});

const ssoStringMapSchema = z.record(
  z.string().min(1).max(200),
  z.string().min(1).max(200),
);

export const updateSsoSettingsSchema = z.object({
  oidc: z.object({
    enabled: z.boolean().optional(),
    issuerUrl: z.union([z.string().url(), z.literal("")]).optional(),
    clientId: z.string().max(200).optional(),
    groupClaim: z.string().min(1).max(100).optional(),
    adminGroups: z.array(z.string().min(1).max(200)).max(100).optional(),
    groupMap: ssoStringMapSchema.optional(),
    workspaceGroupMap: ssoStringMapSchema.optional(),
    workspaceGroupPrefix: z.string().max(200).optional(),
    providerPreset: z.enum(ssoOidcProviderPresetIds).optional(),
  }),
});

export const testAuthProviderConnectionSchema = z.object({
  providerId: z.enum(authProviderIds),
  orgId: z.string().trim().min(1).max(200).optional(),
  oidc: z
    .object({
      issuerUrl: z.union([z.string().url(), z.literal("")]).optional(),
      clientId: z.string().max(200).optional(),
    })
    .optional(),
  oauth2: z
    .object({
      clientId: z.string().max(200).optional(),
      secretRef: z.string().min(1).max(500).optional(),
    })
    .optional(),
  ldap: z
    .object({
      baseDn: ldapDnSchema.optional(),
      bindDn: ldapDnSchema.optional(),
      groupSearchBaseDn: ldapDnSchema.optional(),
      groupSearchFilter: ldapFilterSchema.optional(),
      secretRef: z.string().min(1).max(500).optional(),
      startTls: z.boolean().optional(),
      url: z.string().min(1).max(500).optional(),
      userSearchFilter: ldapFilterSchema.optional(),
    })
    .optional(),
  saml: z
    .object({
      entryPoint: z.string().max(500).optional(),
      idpCertificateRef: z.string().min(1).max(500).optional(),
      spEntityId: z.string().max(500).optional(),
    })
    .optional(),
});

export const deprovisionSsoOidcUserSchema = z.object({
  issuerUrl: z.string().url().optional(),
  oidcSubject: z.string().trim().min(1).max(200),
  confirmOidcSubject: z.string().trim().min(1).max(200),
});

export const updateAgentToolBindingSchema = z
  .object({
    enabled: z.boolean().optional(),
    approvalRequired: z.boolean().optional(),
  })
  .refine(
    (input) =>
      input.enabled !== undefined || input.approvalRequired !== undefined,
    "At least one tool binding field is required.",
  );

export const updateAgentKnowledgeBindingSchema = z.object({
  enabled: z.boolean(),
});

export const importOpenApiToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  spec: z.record(z.string(), z.unknown()),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
  approvalPolicy: z
    .enum([
      "never",
      "write_operations",
      "external_side_effects",
      "always",
      "admin_only",
    ])
    .optional(),
});

export const createWebhookToolSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url().max(1000),
  description: z.string().min(1).max(500).optional(),
  operationName: z.string().min(1).max(120).optional(),
  bodySchema: z.record(z.string(), z.unknown()).optional(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
  approvalPolicy: z
    .enum([
      "never",
      "write_operations",
      "external_side_effects",
      "always",
      "admin_only",
    ])
    .optional(),
});

export const createMcpToolSchema = z.object({
  name: z.string().min(1).max(120),
  serverUrl: z.string().url().max(1000),
  description: z.string().min(1).max(500).optional(),
  protocolVersion: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u)
    .optional(),
  tools: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .max(120)
          .regex(/^[A-Za-z0-9_.:/-]+$/u),
        description: z.string().min(1).max(500).optional(),
        inputSchema: z.record(z.string(), z.unknown()).optional(),
        riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
        approvalPolicy: z
          .enum([
            "never",
            "write_operations",
            "external_side_effects",
            "always",
            "admin_only",
          ])
          .optional(),
      }),
    )
    .min(1)
    .max(100),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
  approvalPolicy: z
    .enum([
      "never",
      "write_operations",
      "external_side_effects",
      "always",
      "admin_only",
    ])
    .optional(),
});

export const updateToolConnectorAuthSchema = z
  .object({
    type: z.enum(["none", "api_key", "bearer", "oauth2_client_credentials"]),
    secretRef: z.string().min(1).optional(),
    apiKeyIn: z.enum(["header", "query"]).optional(),
    apiKeyName: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9_.-]+$/u)
      .optional(),
    oauthTokenUrl: z.string().url().optional(),
    oauthScopes: z
      .array(
        z
          .string()
          .min(1)
          .max(120)
          .regex(/^[A-Za-z0-9_:./-]+$/u),
      )
      .max(20)
      .optional(),
    oauthClientAuthMethod: z
      .enum(["client_secret_basic", "client_secret_post"])
      .optional(),
  })
  .refine(
    (input) => input.type === "none" || input.secretRef !== undefined,
    "Connector auth requires a secret reference.",
  );

export const updateToolConnectorNetworkPolicySchema = z
  .object({
    mode: z.enum(["deny_all", "allow_hosts"]),
    allowedHosts: z.array(z.string().min(1).max(253)).max(25).default([]),
    allowPrivateNetwork: z.boolean().default(false),
  })
  .refine(
    (input) => input.mode === "deny_all" || input.allowedHosts.length > 0,
    "Host allowlist requires at least one host.",
  );

export const updateToolConnectorSchema = z.object({
  enabled: z.boolean(),
});

export const updateToolOperationSchema = z.object({
  enabled: z.boolean(),
});

export const testToolOperationSchema = z.object({
  parameters: z.record(z.string(), z.unknown()).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
});

export const dispatchToolOperationSchema = testToolOperationSchema.extend({
  approved: z.boolean().optional(),
  approvalRequestId: z.string().min(1).optional(),
});

export const enqueueToolOperationDispatchSchema =
  dispatchToolOperationSchema.extend({
    idempotencyKey: z.string().min(1).max(200).optional(),
  });

export const claimToolOperationDispatchRequestSchema = z.object({
  leaseSeconds: z.number().int().min(30).max(3600).default(300),
  payloadStorage: z
    .enum([
      "external_worker_secret_store_required",
      "managed_encrypted_object_store",
    ])
    .optional(),
});

export const expireToolOperationDispatchRequestsSchema = z.object({
  queuedTimeoutSeconds: z.number().int().min(60).max(2_592_000).default(86_400),
  runningTimeoutSeconds: z.number().int().min(60).max(2_592_000).default(3_600),
  limit: z.number().int().min(1).max(500).default(100),
});

const toolOperationResponseValidationSchema = z.object({
  status: z.enum(["failed", "not_applicable", "passed", "skipped"]),
  errorCode: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_.-]+$/u)
    .optional(),
});

export const completeToolOperationDispatchRequestSchema = z.object({
  response: z.object({
    ok: z.boolean(),
    status: z.number().int().min(100).max(599),
    contentType: z.string().min(1).max(120).optional(),
    bodyBytes: z.number().int().nonnegative().max(1_000_000_000),
    truncated: z.boolean(),
    schemaValidation: toolOperationResponseValidationSchema,
  }),
});

export const failToolOperationDispatchRequestSchema = z.object({
  errorCode: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_.-]+$/u),
});

export const cancelToolOperationDispatchRequestSchema = z.object({
  reasonCode: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_.-]+$/u)
    .optional(),
});

export const createQuotaBucketSchema = z.object({
  scopeType: z.enum([
    "org",
    "user",
    "workspace",
    "provider",
    "agent",
    "api_key",
  ]),
  scopeId: z.string().min(1).optional(),
  metric: z.enum(["run.started", "tool.call", "storage.byte"]),
  limit: z.number().int().nonnegative(),
  resetInterval: z.enum(["none", "daily", "monthly"]).default("none"),
});

export const updateQuotaBucketSchema = z
  .object({
    limit: z.number().int().nonnegative().optional(),
    resetInterval: z.enum(["none", "daily", "monthly"]).optional(),
    resetUsage: z.boolean().optional(),
  })
  .refine(
    (input) =>
      input.limit !== undefined ||
      input.resetInterval !== undefined ||
      input.resetUsage === true,
    "At least one quota update field is required.",
  );

const billingLifecycleSchema = z.object({
  cancelAt: z.string().datetime().optional(),
  canceledAt: z.string().datetime().optional(),
  currentPeriodEndsAt: z.string().datetime().optional(),
  pastDueGraceEndsAt: z.string().datetime().optional(),
  trialEndsAt: z.string().datetime().optional(),
});

export const applyBillingPlanSchema = z.object({
  code: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  status: z
    .enum(["active", "canceled", "past_due", "trialing"])
    .default("active"),
  source: z.enum(["external", "manual"]).default("manual"),
  externalCustomerId: z.string().min(1).max(200).optional(),
  externalSubscriptionId: z.string().min(1).max(200).optional(),
  quotaTemplates: z
    .array(
      z.object({
        metric: z.enum(["run.started", "tool.call", "storage.byte"]),
        limit: z.number().int().nonnegative(),
        resetInterval: z.enum(["none", "daily", "monthly"]).default("monthly"),
      }),
    )
    .min(1)
    .max(25)
    .refine(
      (templates) =>
        new Set(templates.map((template) => template.metric)).size ===
        templates.length,
      "Quota template metrics must be unique.",
    ),
  metadata: z.record(z.string(), z.unknown()).default({}),
  lifecycle: billingLifecycleSchema.optional(),
});

export const syncExternalBillingEventSchema = z.object({
  provider: z.string().min(1).max(80),
  eventType: z.enum([
    "customer.updated",
    "invoice.paid",
    "invoice.payment_failed",
    "subscription.canceled",
    "subscription.created",
    "subscription.updated",
  ]),
  externalCustomerId: z.string().min(1).max(200).optional(),
  externalSubscriptionId: z.string().min(1).max(200).optional(),
  externalInvoiceId: z.string().min(1).max(200).optional(),
  invoiceStatus: z.string().min(1).max(80).optional(),
  lifecycle: billingLifecycleSchema.optional(),
  amountCents: z.number().int().nonnegative().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  occurredAt: z.string().datetime().optional(),
  planCode: z.string().min(1).max(120).optional(),
  planName: z.string().min(1).max(200).optional(),
  status: z.enum(["active", "canceled", "past_due", "trialing"]).optional(),
  quotaTemplates: applyBillingPlanSchema.shape.quotaTemplates.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const abuseControlIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.:/@-]+$/u);

export const updateAbuseControlPolicySchema = z
  .object({
    suspension: z
      .object({
        suspended: z.boolean().optional(),
        reasonCode: abuseControlIdSchema.nullable().optional(),
      })
      .optional(),
    entitlements: z
      .object({
        enforceBillingStatus: z.boolean().optional(),
        denyWhenBillingPlanMissing: z.boolean().optional(),
        allowedBillingStatuses: z
          .array(z.enum(["active", "canceled", "past_due", "trialing"]))
          .min(1)
          .max(4)
          .optional(),
      })
      .optional(),
    killSwitches: z
      .object({
        connectorIds: z.array(abuseControlIdSchema).max(250).optional(),
        providerIds: z.array(abuseControlIdSchema).max(250).optional(),
        toolIds: z.array(abuseControlIdSchema).max(250).optional(),
        workerClasses: z.array(abuseControlIdSchema).max(250).optional(),
      })
      .optional(),
  })
  .refine(
    (input) =>
      input.suspension !== undefined ||
      input.entitlements !== undefined ||
      input.killSwitches !== undefined,
    "At least one abuse control update field is required.",
  );

export const startRunSchema = z.object({
  chatId: z.string().min(1),
  agentId: z.string().min(1),
  content: z.string().min(1),
  modelId: z.string().min(1).optional(),
  historyBoundaryMessageId: z.string().min(1).optional(),
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

export const createFileSchema = z.object({
  workspaceId: z.string().min(1),
  fileName: z.string().min(1).max(160),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive().max(25_000_000),
  dataBase64: z.string().min(1).max(34_000_000),
  purpose: z
    .enum([
      "browser_artifact",
      "chat_attachment",
      "connector_import",
      "export_bundle",
      "general",
      "generated_image",
      "knowledge_source",
      "voice_artifact",
    ])
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const createFileUploadSessionSchema = z.object({
  workspaceId: z.string().min(1),
  fileName: z.string().min(1).max(160),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive().max(1_000_000_000),
  sha256: z.string().regex(/^[A-Fa-f0-9]{64}$/u),
  purpose: z
    .enum([
      "browser_artifact",
      "chat_attachment",
      "connector_import",
      "export_bundle",
      "general",
      "generated_image",
      "knowledge_source",
      "voice_artifact",
    ])
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const createFileResumableUploadSessionSchema =
  createFileUploadSessionSchema.extend({
    partSizeBytes: z.number().int().positive().max(100_000_000).optional(),
  });

export const executeToolSchema = z.object({
  agentId: z.string().min(1),
  runId: z.string().min(1).optional(),
  approved: z.boolean().optional(),
  approvalRequestId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
  modelToolCallId: z.string().min(1).max(200).optional(),
  input: z.unknown(),
});

export const executeRunToolSchema = z.object({
  approved: z.boolean().optional(),
  approvalRequestId: z.string().min(1).optional(),
  modelToolCallId: z.string().min(1).max(200).optional(),
  input: z.unknown(),
});

export const createWebhookSubscriptionSchema = z.object({
  url: z.string().url(),
  eventTypes: z.array(z.enum(webhookEventTypes)).min(1).max(25),
});

export const testWebhookSchema = z.object({
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const bulkDisableWebhooksSchema = z.object({
  webhookIds: z.array(z.string()).min(1).max(100),
});

export const updateRetentionPolicySchema = z.object({
  auditLogRetentionDays: z.number().int().min(30).max(3650),
});

export const previewDataDeletionSchema = z.object({
  resourceType: z.enum(["chat", "file_object", "knowledge_source"]),
  resourceId: z.string().min(1).max(200),
});

export const executeDataDeletionSchema = previewDataDeletionSchema.extend({
  confirmResourceId: z.string().min(1).max(200),
});

export const deleteChatSchema = z.object({
  confirmChatId: z.string().min(1).max(200),
});

export const assignChatTagSchema = z.object({
  name: z.string().trim().min(1).max(160),
});

const channelUserIdsSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(500)
  .optional();
const channelGroupIdsSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(100)
  .optional();

export const createChannelSchema = z.object({
  description: z.string().trim().max(1_000).nullable().optional(),
  groupIds: channelGroupIdsSchema,
  name: z.string().max(128),
  private: z.boolean().optional(),
  type: z.enum(["standard", "group", "dm"]).optional(),
  userIds: channelUserIdsSchema,
  workspaceId: z.string().trim().min(1).max(120).optional(),
});

export const updateChannelSchema = z
  .object({
    description: z.string().trim().max(1_000).nullable().optional(),
    groupIds: channelGroupIdsSchema,
    name: z.string().trim().min(1).max(128).optional(),
    private: z.boolean().optional(),
    userIds: channelUserIdsSchema,
  })
  .refine(
    (value) =>
      value.description !== undefined ||
      value.groupIds !== undefined ||
      value.name !== undefined ||
      value.private !== undefined ||
      value.userIds !== undefined,
    { message: "At least one channel field is required." },
  );

export const createDirectMessageChannelSchema = z.object({
  userId: z.string().trim().min(1).max(120),
});

export const addChannelMembersSchema = z
  .object({
    groupIds: channelGroupIdsSchema,
    userIds: channelUserIdsSchema,
  })
  .refine(
    (value) => value.groupIds !== undefined || value.userIds !== undefined,
    { message: "At least one user or group is required." },
  );

export const createChannelMessageSchema = z.object({
  clientMessageId: z.string().trim().min(1).max(200).optional(),
  content: z.string().trim().min(1).max(50_000),
  parentMessageId: z.string().trim().min(1).max(200).optional(),
  replyToMessageId: z.string().trim().min(1).max(200).optional(),
});

export const pinChannelMessageSchema = z.object({
  pinned: z.boolean(),
});

export const channelMessageReactionSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const dataExportSchema = z
  .object({
    scope: z.enum(["org", "workspace"]),
    workspaceId: z.string().min(1).max(200).optional(),
    includeContent: z.boolean().optional(),
    includeObjectBytes: z.boolean().optional(),
    maxObjectBytes: z.number().int().min(0).max(5_000_000).optional(),
  })
  .refine((value) => value.scope !== "workspace" || value.workspaceId, {
    message: "workspaceId is required when scope is workspace.",
  })
  .refine((value) => value.scope !== "org" || value.workspaceId === undefined, {
    message: "workspaceId is only valid when scope is workspace.",
  });

export const deleteDataExportPackageSchema = z.object({
  confirmPackageId: z.string().min(1).max(200),
});

const evalToolArgumentSchema = z.union([
  z.string().max(1000),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const createEvalSuiteSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1),
  cases: z
    .array(
      z.object({
        input: z.string().min(1).max(10_000),
        expectedContains: z.string().min(1).optional(),
        rubric: z
          .object({
            mustContain: z.array(z.string().min(1).max(500)).max(25).optional(),
            mustNotContain: z
              .array(z.string().min(1).max(500))
              .max(25)
              .optional(),
            minLength: z.number().int().min(0).max(100_000).optional(),
            maxLength: z.number().int().min(1).max(100_000).optional(),
            requiredCitations: z
              .array(z.string().min(1).max(500))
              .max(25)
              .optional(),
            expectedToolCalls: z
              .array(
                z.object({
                  name: z.string().min(1).max(200),
                  arguments: z
                    .record(z.string().min(1).max(200), evalToolArgumentSchema)
                    .optional(),
                }),
              )
              .max(25)
              .optional(),
            expectedToolOutcomes: z
              .array(
                z.object({
                  name: z.string().min(1).max(200),
                  status: z.enum(["failure", "success"]).optional(),
                  outputKeys: z
                    .array(z.string().min(1).max(200))
                    .max(25)
                    .optional(),
                  errorCode: z
                    .string()
                    .min(1)
                    .max(120)
                    .regex(/^[a-z0-9][a-z0-9_.:-]*$/i)
                    .optional(),
                }),
              )
              .max(25)
              .optional(),
          })
          .refine(
            (rubric) =>
              rubric.minLength === undefined ||
              rubric.maxLength === undefined ||
              rubric.minLength <= rubric.maxLength,
            {
              message: "minLength must be less than or equal to maxLength.",
            },
          )
          .optional(),
        requiresCitation: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(100),
});

export const runEvalSuiteSchema = z.object({
  modelId: z.string().min(1).optional(),
});

export const compareEvalModelsSchema = z.object({
  modelIds: z
    .array(z.string().min(1))
    .min(2)
    .max(5)
    .refine((modelIds) => new Set(modelIds).size === modelIds.length, {
      message: "modelIds must be unique.",
    }),
});

export const rateEvalResultSchema = z.object({
  rating: z.enum(["pass", "neutral", "fail"]),
  comment: z.string().min(1).max(2_000).optional(),
});

const workflowStepConditionSchema = z.object({
  inputKey: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_.-]+$/),
  equals: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]),
});

const workflowStepRetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(3),
});

const workflowStepRecoveryPolicySchema = z.object({
  onFailure: z.enum(["fail", "continue"]),
});

const workflowStepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agent_run"),
    name: z.string().min(1).max(120),
    agentId: z.string().min(1),
    retryPolicy: workflowStepRetryPolicySchema.optional(),
    recoveryPolicy: workflowStepRecoveryPolicySchema.optional(),
  }),
  z.object({
    type: z.literal("agent_handoff"),
    name: z.string().min(1).max(120),
    agentId: z.string().min(1),
    handoffFromStepId: z
      .string()
      .min(1)
      .max(120)
      .regex(/^step_[1-9][0-9]*$/)
      .optional(),
    handoffPrompt: z.string().min(1).max(1_000).optional(),
    retryPolicy: workflowStepRetryPolicySchema.optional(),
    recoveryPolicy: workflowStepRecoveryPolicySchema.optional(),
  }),
  z.object({
    type: z.literal("agent_room"),
    name: z.string().min(1).max(120),
    agentIds: z
      .array(z.string().min(1))
      .min(2)
      .max(5)
      .refine((agentIds) => new Set(agentIds).size === agentIds.length, {
        message: "agentIds must be unique.",
      }),
    roomPrompt: z.string().min(1).max(1_000).optional(),
    recoveryPolicy: workflowStepRecoveryPolicySchema.optional(),
  }),
  z.object({
    type: z.literal("approval"),
    name: z.string().min(1).max(120),
    approvalPrompt: z.string().min(1).max(1_000).optional(),
  }),
  z.object({
    type: z.literal("tool_approval"),
    name: z.string().min(1).max(120),
    toolChainName: z.string().min(1).max(120).optional(),
    riskLevel: z.enum(["low", "medium", "high"]).optional(),
    approvalPrompt: z.string().min(1).max(1_000).optional(),
    inputKeys: z
      .array(
        z
          .string()
          .min(1)
          .max(120)
          .regex(/^[A-Za-z0-9_.-]+$/),
      )
      .max(25)
      .optional(),
  }),
  z.object({
    type: z.literal("browser_task"),
    name: z.string().min(1).max(120),
    targetUrl: z.string().url().max(2_000),
    task: z.string().min(1).max(1_000),
    approvalPrompt: z.string().min(1).max(1_000).optional(),
  }),
  z.object({
    type: z.literal("notification"),
    name: z.string().min(1).max(120),
    message: z.string().max(1_000).optional(),
    condition: workflowStepConditionSchema.optional(),
  }),
]);

const workflowScheduleSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(5).max(43_200),
  nextRunAt: z.string().datetime().optional(),
});

export const createWorkflowSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1_000).optional(),
  steps: z.array(workflowStepSchema).min(1).max(25),
  schedule: workflowScheduleSchema.optional(),
});

export const createWorkflowFromTemplateSchema = z.object({
  workspaceId: z.string().min(1),
  agentId: z.string().min(1).optional(),
  name: z.string().min(1).max(120).optional(),
  schedule: workflowScheduleSchema.optional(),
});

export const startWorkflowRunSchema = z.object({
  input: z.record(z.string(), z.unknown()).optional(),
});

export const approveWorkflowRunSchema = z.object({
  comment: z.string().min(1).max(1_000).optional(),
});

export const claimBrowserAutomationTaskSchema = z.object({
  leaseSeconds: z.number().int().min(30).max(3600).default(300),
});

const browserAutomationArtifactSchema = z.object({
  artifactId: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[A-Za-z0-9_.:-]+$/u),
  type: z.enum(["download", "screenshot", "trace"]),
  contentType: z.string().min(1).max(120).optional(),
  sizeBytes: z.number().int().nonnegative().max(1_000_000_000).optional(),
});

export const createBrowserAutomationArtifactUploadSchema = z.object({
  type: z.enum(["screenshot", "trace"]),
  contentType: z.string().min(1).max(120),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024),
});

export const completeBrowserAutomationTaskSchema = z.object({
  result: z.object({
    artifactCount: z.number().int().nonnegative().max(100).optional(),
    artifacts: z.array(browserAutomationArtifactSchema).max(20).optional(),
    capturedBytes: z.number().int().nonnegative().max(1_000_000_000).optional(),
    durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
    finalOrigin: z.string().url().max(2_000).optional(),
    navigationCount: z.number().int().nonnegative().max(10_000).optional(),
    networkDeniedCount: z.number().int().nonnegative().max(10_000).optional(),
    outputKeys: z
      .array(
        z
          .string()
          .min(1)
          .max(120)
          .regex(/^[A-Za-z0-9_.:-]+$/u),
      )
      .max(50)
      .optional(),
    redactionApplied: z.boolean().optional(),
  }),
});

export const failBrowserAutomationTaskSchema = z.object({
  errorCode: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_.-]+$/u),
});

export const expireBrowserAutomationTasksSchema = z.object({
  queuedTimeoutSeconds: z.number().int().min(60).max(2_592_000).default(86_400),
  runningTimeoutSeconds: z.number().int().min(60).max(2_592_000).default(3_600),
  limit: z.number().int().min(1).max(500).default(100),
});

export const shareResourceSchema = z.object({
  principalType: z.enum(["group", "service_account", "user"]),
  principalId: z.string().min(1),
  permissions: z
    .array(z.enum(["read", "write", "use", "run"]))
    .min(1)
    .max(4),
});

export const createFavoriteSchema = z.object({
  resourceType: z.enum(["agent", "chat", "knowledge_base"]),
  resourceId: z.string().min(1),
});

export const createFolderSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(120),
  parentId: z.string().min(1).max(200).nullable().optional(),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  isExpanded: z.boolean().optional(),
});

export const updateFolderSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    parentId: z.string().min(1).max(200).nullable().optional(),
    meta: z.record(z.string(), z.unknown()).nullable().optional(),
    data: z.record(z.string(), z.unknown()).nullable().optional(),
    isExpanded: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.parentId !== undefined ||
      value.meta !== undefined ||
      value.data !== undefined ||
      value.isExpanded !== undefined,
    { message: "At least one folder field is required." },
  );

export const createFolderItemSchema = z.object({
  resourceType: z.enum(["agent", "chat", "knowledge_base"]),
  resourceId: z.string().min(1),
});

const notificationTypeSchema = z.enum([
  "chat_mention",
  "support_impersonation_request_created",
  "support_impersonation_request_approved",
  "support_impersonation_request_rejected",
  "support_impersonation_session_created",
  "support_impersonation_session_revoked",
]);
const notificationChannelPreferenceSchema = z.object({
  enabledNotificationTypes: z.array(notificationTypeSchema).max(20).optional(),
});

export const createNotificationChannelSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("email"),
    name: z.string().min(1).max(120),
    config: notificationChannelPreferenceSchema.extend({
      to: z.string().email().max(254),
    }),
  }),
  z.object({
    type: z.literal("mobile_push"),
    name: z.string().min(1).max(120),
    config: notificationChannelPreferenceSchema.extend({
      tokenRef: z.string().min(1).max(512),
      platform: z.enum(["android", "ios", "web"]).optional(),
      collapseKey: z.string().min(1).max(64).optional(),
    }),
  }),
  z.object({
    type: z.literal("pagerduty"),
    name: z.string().min(1).max(120),
    config: notificationChannelPreferenceSchema.extend({
      routingKeyRef: z.string().min(1).max(512),
      severity: z.enum(["critical", "error", "info", "warning"]).optional(),
    }),
  }),
  z.object({
    type: z.literal("slack"),
    name: z.string().min(1).max(120),
    config: notificationChannelPreferenceSchema.extend({
      url: z.string().url(),
    }),
  }),
  z.object({
    type: z.literal("teams"),
    name: z.string().min(1).max(120),
    config: notificationChannelPreferenceSchema.extend({
      url: z.string().url(),
    }),
  }),
  z.object({
    type: z.literal("webhook"),
    name: z.string().min(1).max(120),
    config: notificationChannelPreferenceSchema.extend({
      url: z.string().url(),
    }),
  }),
]);

export const updateNotificationPolicySchema = z
  .object({
    deliveryEnabled: z.boolean().optional(),
    allowedChannelTypes: z
      .array(
        z.enum([
          "email",
          "mobile_push",
          "pagerduty",
          "slack",
          "teams",
          "webhook",
        ]),
      )
      .max(6)
      .optional(),
    allowedWebhookHosts: z
      .array(z.string().min(1).max(253))
      .max(100)
      .optional(),
    allowedSlackHosts: z.array(z.string().min(1).max(253)).max(100).optional(),
    allowedTeamsHosts: z.array(z.string().min(1).max(253)).max(100).optional(),
    allowedEmailDomains: z
      .array(z.string().min(1).max(253))
      .max(100)
      .optional(),
    suppressedNotificationTypes: z
      .array(notificationTypeSchema)
      .max(20)
      .optional(),
  })
  .refine(
    (value) =>
      value.deliveryEnabled !== undefined ||
      value.allowedChannelTypes !== undefined ||
      value.allowedWebhookHosts !== undefined ||
      value.allowedSlackHosts !== undefined ||
      value.allowedEmailDomains !== undefined ||
      value.suppressedNotificationTypes !== undefined,
    { message: "At least one notification policy field is required." },
  );

export const createDataConnectorSchema = z.object({
  workspaceId: z.string().min(1),
  knowledgeBaseId: z.string().min(1),
  type: z.enum(dataConnectorTypes),
  name: z.string().min(1),
  syncIntervalMinutes: z.number().int().min(5).max(43_200).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const startDelegatedOAuthSchema = z.object({
  providerId: z.literal("github"),
  workspaceId: z.string().min(1),
  connectorType: z.enum(dataConnectorTypes),
  scopes: z.array(z.string().min(1).max(120)).max(20).optional(),
  returnTo: z.string().max(500).optional(),
});

export const syncDataConnectorSchema = z.object({
  items: z
    .array(
      z.object({
        fileName: z.string().min(1),
        mimeType: z.string().min(1),
        content: z.string().min(1).max(200_000),
        sizeBytes: z.number().int().positive().optional(),
      }),
    )
    .max(20)
    .optional(),
});
