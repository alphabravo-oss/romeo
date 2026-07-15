import type { RomeoApi } from "../context";
import {
  createRagPolicyChangeRequestSchema,
  createManagedSecretSchema,
  deprovisionSsoOidcUserSchema,
  reviewRagPolicyChangeRequestSchema,
  secretRewrapExecuteSchema,
  secretRewrapPreviewSchema,
  testAuthProviderConnectionSchema,
  updateAuthProviderSettingsSchema,
  updateRagPolicySchema,
  updateSsoSettingsSchema,
} from "../schemas";
import {
  ragPolicyTiers,
  type RagPolicyChangeEvidenceSummary,
  type RagPolicyKnowledgeBaseTierAssignments,
  type RagPolicyProviderModel,
  type RagPolicyTier,
  type UpdateRagPolicyExternalVectorStoreRequest,
  type UpdateRagPolicyPhysicalVectorIsolationRequest,
  type UpdateRagPolicyRequest,
} from "../../domain/rag-policy";

export function registerReadinessRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/readiness", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").readiness.report(subject);
    return context.json({ data });
  });

  app.get("/api/v1/admin/rag/posture", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").ragPosture.report(subject);
    return context.json({ data });
  });

  app.get("/api/v1/admin/rag/policy", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").ragPolicy.report(subject);
    return context.json({ data });
  });

  app.patch("/api/v1/admin/rag/policy", async (context) => {
    const subject = context.get("subject");
    const body = updateRagPolicySchema.parse(await context.req.json());
    const policy = cleanRagPolicyPatch(body);
    const data = await context
      .get("services")
      .ragPolicy.update({ subject, policy });
    return context.json({ data });
  });

  app.get("/api/v1/admin/rag/policy/change-request", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").ragPolicy.changeRequest(subject);
    return context.json({ data });
  });

  app.post("/api/v1/admin/rag/policy/change-requests", async (context) => {
    const subject = context.get("subject");
    const body = createRagPolicyChangeRequestSchema.parse(
      await context.req.json(),
    );
    const evidenceSummary = cleanRagPolicyChangeEvidenceSummary(
      body.evidenceSummary,
    );
    const data = await context.get("services").ragPolicy.createChangeRequest({
      subject,
      change: {
        policy: cleanRagPolicyPatch(body.policy),
        ...(body.justificationCode === undefined
          ? {}
          : { justificationCode: body.justificationCode }),
        ...(evidenceSummary === undefined ? {} : { evidenceSummary }),
      },
    });
    return context.json({ data }, 201);
  });

  app.post(
    "/api/v1/admin/rag/policy/change-requests/:requestId/approve",
    async (context) => {
      const subject = context.get("subject");
      const requestId = context.req.param("requestId");
      const body = reviewRagPolicyChangeRequestSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .ragPolicy.approveChangeRequest({
          subject,
          requestId,
          confirmRequestId: body.confirmRequestId,
        });
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/admin/rag/policy/change-requests/:requestId/reject",
    async (context) => {
      const subject = context.get("subject");
      const requestId = context.req.param("requestId");
      const body = reviewRagPolicyChangeRequestSchema.parse(
        await context.req.json(),
      );
      const data = await context.get("services").ragPolicy.rejectChangeRequest({
        subject,
        requestId,
        confirmRequestId: body.confirmRequestId,
        ...(body.reasonCode === undefined
          ? {}
          : { reasonCode: body.reasonCode }),
      });
      return context.json({ data });
    },
  );

  app.get("/api/v1/admin/sso-settings", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").ssoSettings.report(subject);
    return context.json({ data });
  });

  app.get("/api/v1/admin/auth-providers/catalog", async (context) => {
    const subject = context.get("subject");
    const data = context
      .get("services")
      .ssoSettings.authProviderCatalog(subject);
    return context.json({ data });
  });

  app.get("/api/v1/admin/auth-providers/settings", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .authProviderSettings.report(subject);
    return context.json({ data });
  });

  app.patch("/api/v1/admin/auth-providers/settings", async (context) => {
    const subject = context.get("subject");
    const body = updateAuthProviderSettingsSchema.parse(
      await context.req.json(),
    );
    const data = await context
      .get("services")
      .authProviderSettings.update({ subject, settings: body });
    return context.json({ data });
  });

  app.post("/api/v1/admin/auth-providers/settings/test", async (context) => {
    const subject = context.get("subject");
    const body = testAuthProviderConnectionSchema.parse(
      await context.req.json(),
    );
    const data = await context
      .get("services")
      .authProviderSettings.connectionTest({ subject, test: body });
    return context.json({ data });
  });

  app.post("/api/v1/admin/secrets", async (context) => {
    const subject = context.get("subject");
    const body = createManagedSecretSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .managedSecrets.create({ subject, request: body });
    return context.json({ data }, 201);
  });

  app.post("/api/v1/admin/secret-rotation/rewrap/preview", async (context) => {
    const subject = context.get("subject");
    const body = secretRewrapPreviewSchema.parse(await optionalJson(context));
    const data = await context
      .get("services")
      .secretRotation.preview({ subject, request: body });
    return context.json({ data });
  });

  app.post("/api/v1/admin/secret-rotation/rewrap", async (context) => {
    const subject = context.get("subject");
    const body = secretRewrapExecuteSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .secretRotation.execute({ subject, request: body });
    return context.json({ data });
  });

  app.patch("/api/v1/admin/sso-settings", async (context) => {
    const subject = context.get("subject");
    const body = updateSsoSettingsSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .ssoSettings.update({ subject, oidc: body.oidc });
    return context.json({ data });
  });

  app.post("/api/v1/admin/sso-settings/test", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .ssoSettings.connectionTest(subject);
    return context.json({ data });
  });

  app.post("/api/v1/admin/sso/oidc/deprovision", async (context) => {
    const subject = context.get("subject");
    const body = deprovisionSsoOidcUserSchema.parse(await context.req.json());
    const data = await context.get("services").ssoSettings.deprovisionOidcUser({
      subject,
      oidcSubject: body.oidcSubject,
      confirmOidcSubject: body.confirmOidcSubject,
      ...(body.issuerUrl === undefined ? {} : { issuerUrl: body.issuerUrl }),
    });
    return context.json({ data });
  });
}

async function optionalJson(context: {
  req: { text(): Promise<string> };
}): Promise<unknown> {
  const text = await context.req.text();
  return text.trim().length === 0 ? {} : JSON.parse(text);
}

type RagPolicyBudgetPatchBody = {
  [tier in RagPolicyTier]?: number | undefined;
};

interface RagPolicyTierAssignmentsPatchBody {
  org?: string[] | undefined;
  shared?: string[] | undefined;
}

type RagPolicyExternalVectorStorePatchBody = {
  [key in keyof UpdateRagPolicyExternalVectorStoreRequest]?:
    | UpdateRagPolicyExternalVectorStoreRequest[key]
    | undefined;
};

type RagPolicyPhysicalVectorIsolationPatchBody = {
  [key in keyof UpdateRagPolicyPhysicalVectorIsolationRequest]?:
    | UpdateRagPolicyPhysicalVectorIsolationRequest[key]
    | undefined;
};

interface RagPolicyPatchBody {
  enabledTiers?: RagPolicyTier[] | undefined;
  defaultMaxResultsPerTier?: RagPolicyBudgetPatchBody | undefined;
  maxResultsPerTier?: RagPolicyBudgetPatchBody | undefined;
  allowedEmbeddingProviderModels?: RagPolicyProviderModel[] | undefined;
  knowledgeBaseTierAssignments?: RagPolicyTierAssignmentsPatchBody | undefined;
  dataResidencyTags?: string[] | undefined;
  externalVectorStore?: RagPolicyExternalVectorStorePatchBody | undefined;
  physicalVectorIsolation?:
    | RagPolicyPhysicalVectorIsolationPatchBody
    | undefined;
}

function cleanRagPolicyPatch(body: RagPolicyPatchBody): UpdateRagPolicyRequest {
  const defaultMaxResultsPerTier = cleanRagPolicyBudget(
    body.defaultMaxResultsPerTier,
  );
  const maxResultsPerTier = cleanRagPolicyBudget(body.maxResultsPerTier);
  const knowledgeBaseTierAssignments =
    cleanRagPolicyKnowledgeBaseTierAssignments(
      body.knowledgeBaseTierAssignments,
    );
  const externalVectorStore = cleanRagPolicyExternalVectorStore(
    body.externalVectorStore,
  );
  const physicalVectorIsolation = cleanRagPolicyPhysicalVectorIsolation(
    body.physicalVectorIsolation,
  );
  return {
    ...(body.enabledTiers === undefined
      ? {}
      : { enabledTiers: body.enabledTiers }),
    ...(defaultMaxResultsPerTier === undefined
      ? {}
      : { defaultMaxResultsPerTier }),
    ...(maxResultsPerTier === undefined ? {} : { maxResultsPerTier }),
    ...(body.allowedEmbeddingProviderModels === undefined
      ? {}
      : {
          allowedEmbeddingProviderModels: body.allowedEmbeddingProviderModels,
        }),
    ...(knowledgeBaseTierAssignments === undefined
      ? {}
      : { knowledgeBaseTierAssignments }),
    ...(body.dataResidencyTags === undefined
      ? {}
      : { dataResidencyTags: body.dataResidencyTags }),
    ...(externalVectorStore === undefined ? {} : { externalVectorStore }),
    ...(physicalVectorIsolation === undefined
      ? {}
      : { physicalVectorIsolation }),
  };
}

function cleanRagPolicyChangeEvidenceSummary(
  value:
    | {
        replayCaseCount?: number | undefined;
        averagePrecision?: number | undefined;
        averageRecall?: number | undefined;
        averageLatencyMs?: number | undefined;
        beforeAfterComparisonAttached?: boolean | undefined;
      }
    | undefined,
): RagPolicyChangeEvidenceSummary | undefined {
  if (value === undefined) return undefined;
  const summary: RagPolicyChangeEvidenceSummary = {};
  if (value.replayCaseCount !== undefined) {
    summary.replayCaseCount = value.replayCaseCount;
  }
  if (value.averagePrecision !== undefined) {
    summary.averagePrecision = value.averagePrecision;
  }
  if (value.averageRecall !== undefined)
    summary.averageRecall = value.averageRecall;
  if (value.averageLatencyMs !== undefined) {
    summary.averageLatencyMs = value.averageLatencyMs;
  }
  if (value.beforeAfterComparisonAttached !== undefined) {
    summary.beforeAfterComparisonAttached = value.beforeAfterComparisonAttached;
  }
  return Object.keys(summary).length === 0 ? undefined : summary;
}

function cleanRagPolicyExternalVectorStore(
  value:
    | {
        mode?: "deployment_managed" | "disabled" | undefined;
        namespacePolicy?:
          | "knowledge_base"
          | "none"
          | "org"
          | "workspace"
          | undefined;
        partitioningPolicy?:
          | "knowledge_base"
          | "none"
          | "org"
          | "workspace"
          | undefined;
        drStrategy?: "postgres_authoritative_reindex" | undefined;
        exportPolicy?: "metadata_only" | undefined;
      }
    | undefined,
): UpdateRagPolicyExternalVectorStoreRequest | undefined {
  if (value === undefined) return undefined;
  const policy: UpdateRagPolicyExternalVectorStoreRequest = {};
  if (value.mode !== undefined) policy.mode = value.mode;
  if (value.namespacePolicy !== undefined)
    policy.namespacePolicy = value.namespacePolicy;
  if (value.partitioningPolicy !== undefined)
    policy.partitioningPolicy = value.partitioningPolicy;
  if (value.drStrategy !== undefined) policy.drStrategy = value.drStrategy;
  if (value.exportPolicy !== undefined)
    policy.exportPolicy = value.exportPolicy;
  return policy;
}

function cleanRagPolicyPhysicalVectorIsolation(
  value:
    | {
        mode?:
          | "dedicated_vector_store_per_org"
          | "external_collection_per_org"
          | "external_namespace_per_org"
          | "pgvector_partitioned_by_org"
          | "shared_row_scope"
          | undefined;
        enforcement?: "advisory" | "required" | undefined;
      }
    | undefined,
): UpdateRagPolicyPhysicalVectorIsolationRequest | undefined {
  if (value === undefined) return undefined;
  const policy: UpdateRagPolicyPhysicalVectorIsolationRequest = {};
  if (value.mode !== undefined) policy.mode = value.mode;
  if (value.enforcement !== undefined) policy.enforcement = value.enforcement;
  return policy;
}

function cleanRagPolicyBudget(
  value:
    | {
        user_private?: number | undefined;
        workspace?: number | undefined;
        org?: number | undefined;
        shared?: number | undefined;
      }
    | undefined,
): Partial<Record<RagPolicyTier, number>> | undefined {
  if (value === undefined) return undefined;
  const budget: Partial<Record<RagPolicyTier, number>> = {};
  for (const tier of ragPolicyTiers) {
    const amount = value[tier];
    if (amount !== undefined) budget[tier] = amount;
  }
  return budget;
}

function cleanRagPolicyKnowledgeBaseTierAssignments(
  value:
    | {
        org?: string[] | undefined;
        shared?: string[] | undefined;
      }
    | undefined,
): Partial<RagPolicyKnowledgeBaseTierAssignments> | undefined {
  if (value === undefined) return undefined;
  const assignments: Partial<RagPolicyKnowledgeBaseTierAssignments> = {};
  if (value.org !== undefined) assignments.org = value.org;
  if (value.shared !== undefined) assignments.shared = value.shared;
  return assignments;
}
