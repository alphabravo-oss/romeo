import {
  approveRagPolicyChangeRequestRoute,
  createManagedSecretRoute,
  createRagPolicyChangeRequestRoute,
  deprovisionSsoOidcUserRoute,
  executeSecretRewrapRoute,
  getAuthProviderSettingsRoute,
  getRagPolicyChangeRequestRoute,
  getRagPolicyRoute,
  getRagPostureRoute,
  getReadinessReportRoute,
  getSsoSettingsRoute,
  listAuthProviderCatalogRoute,
  previewSecretRewrapRoute,
  rejectRagPolicyChangeRequestRoute,
  testAuthProviderConnectionRoute,
  testSsoSettingsRoute,
  updateAuthProviderSettingsRoute,
  updateRagPolicyRoute,
  updateSsoSettingsRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";
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
  app.openapi(getReadinessReportRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").readiness.report(subject);
    return context.json({ data }, 200);
  });

  app.openapi(getRagPostureRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").ragPosture.report(subject);
    return context.json({ data }, 200);
  });

  app.openapi(getRagPolicyRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").ragPolicy.report(subject);
    return context.json({ data }, 200);
  });

  app.openapi(updateRagPolicyRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const policy = cleanRagPolicyPatch(body);
    const data = await context
      .get("services")
      .ragPolicy.update({ subject, policy });
    return context.json({ data }, 200);
  });

  app.openapi(getRagPolicyChangeRequestRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").ragPolicy.changeRequest(subject);
    return context.json({ data }, 200);
  });

  app.openapi(createRagPolicyChangeRequestRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
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

  app.openapi(approveRagPolicyChangeRequestRoute, async (context) => {
    const subject = context.get("subject");
    const { requestId } = context.req.valid("param");
    const body = context.req.valid("json");
    const data = await context.get("services").ragPolicy.approveChangeRequest({
      subject,
      requestId,
      confirmRequestId: body.confirmRequestId,
    });
    return context.json({ data }, 200);
  });

  app.openapi(rejectRagPolicyChangeRequestRoute, async (context) => {
    const subject = context.get("subject");
    const { requestId } = context.req.valid("param");
    const body = context.req.valid("json");
    const data = await context.get("services").ragPolicy.rejectChangeRequest({
      subject,
      requestId,
      confirmRequestId: body.confirmRequestId,
      ...(body.reasonCode === undefined ? {} : { reasonCode: body.reasonCode }),
    });
    return context.json({ data }, 200);
  });

  app.openapi(getSsoSettingsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").ssoSettings.report(subject);
    return context.json({ data }, 200);
  });

  app.openapi(listAuthProviderCatalogRoute, async (context) => {
    const subject = context.get("subject");
    const data = context
      .get("services")
      .ssoSettings.authProviderCatalog(subject);
    return context.json({ data }, 200);
  });

  app.openapi(getAuthProviderSettingsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .authProviderSettings.report(subject);
    return context.json({ data }, 200);
  });

  app.openapi(updateAuthProviderSettingsRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .authProviderSettings.update({ subject, settings: body });
    return context.json({ data }, 200);
  });

  app.openapi(testAuthProviderConnectionRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .authProviderSettings.connectionTest({ subject, test: body });
    return context.json({ data }, 200);
  });

  app.openapi(createManagedSecretRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .managedSecrets.create({ subject, request: body });
    return context.json({ data }, 201);
  });

  app.openapi(previewSecretRewrapRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json") ?? {};
    const data = await context
      .get("services")
      .secretRotation.preview({ subject, request: body });
    return context.json({ data }, 200);
  });

  app.openapi(executeSecretRewrapRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .secretRotation.execute({ subject, request: body });
    return context.json({ data }, 200);
  });

  app.openapi(updateSsoSettingsRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .ssoSettings.update({ subject, oidc: body.oidc });
    return context.json({ data }, 200);
  });

  app.openapi(testSsoSettingsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .ssoSettings.connectionTest(subject);
    return context.json({ data }, 200);
  });

  app.openapi(deprovisionSsoOidcUserRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").ssoSettings.deprovisionOidcUser({
      subject,
      oidcSubject: body.oidcSubject,
      confirmOidcSubject: body.confirmOidcSubject,
      ...(body.issuerUrl === undefined ? {} : { issuerUrl: body.issuerUrl }),
    });
    return context.json({ data }, 200);
  });
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
