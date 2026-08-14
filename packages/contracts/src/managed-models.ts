import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

import {
  managedModelIdentifier,
  CreateManagedModelSchema,
  UpdateManagedModelSchema,
  CloneManagedModelSchema,
  UpdateManagedModelCustomizationPolicySchema,
  UpdateManagedModelPreferencesSchema,
  ImportManagedModelSchema,
  agentPath,
  versionPath,
  workspaceQuery,
  modelResponse,
  modelsResponse,
  policyResponse,
  preferencesResponse,
  versionResponse,
  versionsResponse,
  exportResponse,
  versionDiffSchema,
  ManagedModelGalleryItemSchema,
  ManagedModelKnowledgeBindingSchema,
  UpdateManagedModelKnowledgeBindingSchema,
  BindManagedModelVoiceSchema,
  PublishManagedModelSchema,
} from "./managed-model-schemas";
import { getManagedModelReadinessRoute } from "./managed-model-readiness";
import {
  listManagedModelGrantsRoute,
  revokeManagedModelGrantRoute,
  shareManagedModelRoute,
} from "./managed-model-access";

export * from "./managed-model-schemas";
export { getManagedModelReadinessRoute } from "./managed-model-readiness";
export {
  listManagedModelGrantsRoute,
  revokeManagedModelGrantRoute,
  shareManagedModelRoute,
} from "./managed-model-access";

const authenticatedErrors = {
  401: standardErrorResponses[401],
  403: standardErrorResponses[403],
  500: standardErrorResponses[500],
} as const;
const managedModelErrors = {
  ...authenticatedErrors,
  404: standardErrorResponses[404],
} as const;
const managedModelMutationErrors = {
  400: standardErrorResponses[400],
  ...managedModelErrors,
  409: standardErrorResponses[409],
} as const;

const metadata = {
  tags: ["Managed Models"],
  security: authenticationSecurity,
};

export const listManagedModelsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/agents",
  operationId: "managedModels.list",
  summary: "List authorized managed models",
  request: { query: workspaceQuery },
  responses: {
    200: jsonResponse("Authorized managed models", modelsResponse),
    ...authenticatedErrors,
  },
});

export const createManagedModelRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/agents",
  operationId: "managedModels.create",
  summary: "Create a managed-model draft",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: CreateManagedModelSchema } },
    },
  },
  responses: {
    201: jsonResponse("Created managed model", modelResponse),
    ...managedModelMutationErrors,
  },
});

export const getManagedModelRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/agents/{agentId}",
  operationId: "managedModels.get",
  summary: "Get an authorized managed model",
  request: { params: agentPath },
  responses: {
    200: jsonResponse("Managed model", modelResponse),
    ...managedModelErrors,
  },
});

export const updateManagedModelRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/agents/{agentId}",
  operationId: "managedModels.update",
  summary: "Update a managed-model draft",
  request: {
    params: agentPath,
    body: {
      required: false,
      content: { "application/json": { schema: UpdateManagedModelSchema } },
    },
  },
  responses: {
    200: jsonResponse("Updated managed model", modelResponse),
    ...managedModelMutationErrors,
  },
});

export const deleteManagedModelRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/agents/{agentId}",
  operationId: "managedModels.delete",
  summary: "Archive a managed model",
  description:
    "Removes the managed model from selection while preserving immutable run and version history.",
  request: { params: agentPath },
  responses: {
    200: jsonResponse("Archived managed model", modelResponse),
    ...managedModelMutationErrors,
  },
});

export const cloneManagedModelRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/agents/{agentId}/clone",
  operationId: "managedModels.clone",
  summary: "Clone a managed model",
  request: {
    params: agentPath,
    body: {
      required: true,
      content: { "application/json": { schema: CloneManagedModelSchema } },
    },
  },
  responses: {
    201: jsonResponse("Cloned managed model", modelResponse),
    ...managedModelMutationErrors,
  },
});

export const getManagedModelCustomizationPolicyRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/agents/{agentId}/customization-policy",
  operationId: "managedModels.getCustomizationPolicy",
  summary: "Get the managed-model customization policy",
  request: { params: agentPath },
  responses: {
    200: jsonResponse("Customization policy", policyResponse),
    ...managedModelErrors,
  },
});

export const updateManagedModelCustomizationPolicyRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/agents/{agentId}/customization-policy",
  operationId: "managedModels.updateCustomizationPolicy",
  summary: "Update the managed-model customization policy",
  description:
    "Administrator-only. Disabling a control permanently removes its stored preference values.",
  request: {
    params: agentPath,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateManagedModelCustomizationPolicySchema,
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Updated customization policy", policyResponse),
    ...managedModelMutationErrors,
  },
});

export const getManagedModelPreferencesRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/agents/{agentId}/preferences",
  operationId: "managedModels.getPreferences",
  summary: "Get current-principal managed-model preferences",
  request: { params: agentPath },
  responses: {
    200: jsonResponse("Managed-model preferences", preferencesResponse),
    ...managedModelErrors,
  },
});

export const updateManagedModelPreferencesRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/agents/{agentId}/preferences",
  operationId: "managedModels.updatePreferences",
  summary: "Update exposed managed-model preferences",
  description:
    "Only administrator-exposed controls are retained. Custom instructions are encrypted when a deployment key is configured.",
  request: {
    params: agentPath,
    body: {
      required: true,
      content: {
        "application/json": { schema: UpdateManagedModelPreferencesSchema },
      },
    },
  },
  responses: {
    200: jsonResponse("Updated managed-model preferences", preferencesResponse),
    ...managedModelMutationErrors,
  },
});

export const clearManagedModelPreferencesRoute = createRoute({
  ...metadata,
  method: "delete",
  path: "/api/v1/agents/{agentId}/preferences",
  operationId: "managedModels.clearPreferences",
  summary: "Clear current-principal managed-model preferences",
  request: { params: agentPath },
  responses: {
    200: jsonResponse("Cleared managed-model preferences", preferencesResponse),
    ...managedModelErrors,
  },
});

export const exportManagedModelRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/agents/{agentId}/export",
  operationId: "managedModels.export",
  summary: "Export a portable managed-model definition",
  request: { params: agentPath },
  responses: {
    200: jsonResponse("Managed-model export document", exportResponse),
    ...managedModelErrors,
  },
});

export const importManagedModelRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/agents/import",
  operationId: "managedModels.import",
  summary: "Import a portable managed-model definition",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: ImportManagedModelSchema } },
    },
  },
  responses: {
    201: jsonResponse("Imported managed model", modelResponse),
    ...managedModelMutationErrors,
  },
});

export const listManagedModelVersionsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/agents/{agentId}/versions",
  operationId: "managedModels.listVersions",
  summary: "List published managed-model versions",
  request: { params: agentPath },
  responses: {
    200: jsonResponse("Managed-model versions", versionsResponse),
    ...managedModelErrors,
  },
});

export const publishManagedModelRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/agents/{agentId}/versions",
  operationId: "managedModels.publish",
  summary: "Publish a managed-model version",
  description:
    "Creates an immutable candidate snapshot or publishes a snapshot directly to production. Candidate snapshots do not change the live managed model until promoted with the rollback/promote endpoint.",
  request: {
    params: agentPath,
    body: {
      required: true,
      content: { "application/json": { schema: PublishManagedModelSchema } },
    },
  },
  responses: {
    201: jsonResponse("Published managed-model version", versionResponse),
    ...managedModelMutationErrors,
  },
});

export const diffManagedModelVersionRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/agents/{agentId}/versions/{versionId}/diff",
  operationId: "managedModels.diffVersion",
  summary: "Diff two published managed-model versions",
  request: {
    params: versionPath,
    query: z.strictObject({ compareTo: managedModelIdentifier }),
  },
  responses: {
    200: jsonResponse(
      "Managed-model version diff",
      dataEnvelope(versionDiffSchema),
    ),
    400: standardErrorResponses[400],
    ...managedModelErrors,
  },
});

export const rollbackManagedModelVersionRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/agents/{agentId}/versions/{versionId}/rollback",
  operationId: "managedModels.rollbackVersion",
  summary: "Restore a published version into the managed-model draft",
  request: { params: versionPath },
  responses: {
    200: jsonResponse("Restored managed-model draft", modelResponse),
    ...managedModelMutationErrors,
  },
});

export const listManagedModelGalleryRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/agent-gallery",
  operationId: "managedModels.listGallery",
  summary: "List published managed models available to the caller",
  request: { query: workspaceQuery },
  responses: {
    200: jsonResponse(
      "Managed-model gallery",
      dataEnvelope(z.array(ManagedModelGalleryItemSchema)),
    ),
    ...authenticatedErrors,
  },
});

export const listManagedModelKnowledgeBindingsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/agents/{agentId}/knowledge-bases",
  operationId: "managedModels.listKnowledgeBindings",
  summary: "List managed-model knowledge bindings",
  request: { params: agentPath },
  responses: {
    200: jsonResponse(
      "Managed-model knowledge bindings",
      dataEnvelope(z.array(ManagedModelKnowledgeBindingSchema)),
    ),
    ...managedModelErrors,
  },
});

export const updateManagedModelKnowledgeBindingRoute = createRoute({
  ...metadata,
  method: "patch",
  path: "/api/v1/agents/{agentId}/knowledge-bases/{knowledgeBaseId}",
  operationId: "managedModels.updateKnowledgeBinding",
  summary: "Enable or disable a managed-model knowledge binding",
  request: {
    params: z.strictObject({
      agentId: managedModelIdentifier,
      knowledgeBaseId: managedModelIdentifier,
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateManagedModelKnowledgeBindingSchema,
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Updated managed-model knowledge binding",
      dataEnvelope(ManagedModelKnowledgeBindingSchema),
    ),
    ...managedModelMutationErrors,
  },
});

export const bindManagedModelVoiceRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/agents/{agentId}/voice",
  operationId: "managedModels.bindVoice",
  summary: "Bind a default voice to a managed-model draft",
  request: {
    params: agentPath,
    body: {
      required: true,
      content: { "application/json": { schema: BindManagedModelVoiceSchema } },
    },
  },
  responses: {
    200: jsonResponse("Managed model with bound voice", modelResponse),
    ...managedModelMutationErrors,
  },
});

export const managedModelRoutes = [
  listManagedModelsRoute,
  createManagedModelRoute,
  getManagedModelRoute,
  updateManagedModelRoute,
  deleteManagedModelRoute,
  cloneManagedModelRoute,
  getManagedModelCustomizationPolicyRoute,
  updateManagedModelCustomizationPolicyRoute,
  getManagedModelPreferencesRoute,
  updateManagedModelPreferencesRoute,
  clearManagedModelPreferencesRoute,
  exportManagedModelRoute,
  importManagedModelRoute,
  listManagedModelVersionsRoute,
  publishManagedModelRoute,
  diffManagedModelVersionRoute,
  rollbackManagedModelVersionRoute,
  listManagedModelGrantsRoute,
  shareManagedModelRoute,
  revokeManagedModelGrantRoute,
  listManagedModelGalleryRoute,
  getManagedModelReadinessRoute,
  listManagedModelKnowledgeBindingsRoute,
  updateManagedModelKnowledgeBindingRoute,
  bindManagedModelVoiceRoute,
] as const;
