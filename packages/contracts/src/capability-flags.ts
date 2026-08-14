import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();

export const CapabilityFlagIdSchema = z
  .enum([
    "stream_transport_v2",
    "router_query_hydration_v1",
    "server_table_v2",
    "virtual_transcript_v1",
    "provider_capabilities_v2",
    "reasoning_policy_v1",
    "content_firewall_v2",
    "knowledge_acl_v2",
    "multimodal_parts_v2",
    "image_jobs_v2",
    "realtime_voice_v1",
    "compute_artifacts_v1",
    "compare_consensus_v1",
    "trust_plane_v1",
  ])
  .openapi("CapabilityFlagId");
export const CapabilityFlagStateSchema = z
  .enum(["disabled", "preview", "enabled"])
  .openapi("CapabilityFlagState");
export const CapabilityFlagSubjectSchema = z
  .strictObject({
    subjectType: z.enum(["user", "service_account"]),
    subjectId: identifier,
  })
  .openapi("CapabilityFlagSubject");

export const OrganizationCapabilityFlagSchema = z
  .strictObject({
    id: identifier,
    orgId: identifier,
    flagId: CapabilityFlagIdSchema,
    state: CapabilityFlagStateSchema,
    allowlistedSubjects: z.array(CapabilityFlagSubjectSchema).max(100),
    version: z.number().int().positive(),
    supersedesId: identifier.optional(),
    actorId: identifier,
    reason: z.string().trim().min(1).max(1_000),
    revokedAt: timestamp.optional(),
    createdAt: timestamp,
  })
  .openapi("OrganizationCapabilityFlag");

export const CapabilityFlagDefinitionSchema = z
  .strictObject({
    id: CapabilityFlagIdSchema,
    defaultState: CapabilityFlagStateSchema.exclude(["preview"]),
    consumerStatus: z.enum(["enforced", "reserved"]),
    platformCapabilityId: identifier.optional(),
  })
  .openapi("CapabilityFlagDefinition");

export const EffectiveCapabilityFlagSchema = z
  .strictObject({
    flagId: CapabilityFlagIdSchema,
    configuredState: CapabilityFlagStateSchema,
    effectiveState: z.enum(["disabled", "enabled"]),
    reasonCode: z.enum([
      "enabled",
      "disabled",
      "preview_allowlisted",
      "preview_not_allowlisted",
      "platform_disabled",
    ]),
    version: z.number().int().positive().optional(),
  })
  .openapi("EffectiveCapabilityFlag");

export const CapabilityFlagAdminReportSchema = z
  .strictObject({
    definitions: z.array(CapabilityFlagDefinitionSchema),
    configured: z.array(OrganizationCapabilityFlagSchema),
    platformDisabledFlagIds: z.array(CapabilityFlagIdSchema),
  })
  .openapi("CapabilityFlagAdminReport");

export const UpdateCapabilityFlagSchema = z
  .strictObject({
    state: CapabilityFlagStateSchema,
    allowlistedSubjects: z
      .array(CapabilityFlagSubjectSchema)
      .max(100)
      .default([]),
    reason: z.string().trim().min(1).max(1_000),
    expectedVersion: z.number().int().nonnegative().optional(),
  })
  .openapi("UpdateCapabilityFlagRequest");

const metadata = {
  tags: ["Capability Flags"],
  security: authenticationSecurity,
};
const flagPath = z.strictObject({ flagId: CapabilityFlagIdSchema });

export const listEffectiveCapabilityFlagsRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/capability-flags/effective",
  operationId: "capabilityFlags.listEffective",
  summary: "List the caller's effective organization capability flags",
  responses: {
    200: jsonResponse(
      "Effective capability flags",
      dataEnvelope(z.array(EffectiveCapabilityFlagSchema)),
    ),
    ...standardErrorResponses,
  },
});

export const getCapabilityFlagAdminReportRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/capability-flags",
  operationId: "capabilityFlags.getAdminReport",
  summary: "Get organization capability flag configuration",
  responses: {
    200: jsonResponse(
      "Capability flag report",
      dataEnvelope(CapabilityFlagAdminReportSchema),
    ),
    ...standardErrorResponses,
  },
});

export const getCapabilityFlagHistoryRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/capability-flags/{flagId}/history",
  operationId: "capabilityFlags.getHistory",
  summary: "Get capability flag revision history",
  request: { params: flagPath },
  responses: {
    200: jsonResponse(
      "Capability flag history",
      dataEnvelope(z.array(OrganizationCapabilityFlagSchema)),
    ),
    ...standardErrorResponses,
  },
});

export const updateCapabilityFlagRoute = createRoute({
  ...metadata,
  method: "put",
  path: "/api/v1/admin/capability-flags/{flagId}",
  operationId: "capabilityFlags.update",
  summary: "Replace an organization capability flag revision",
  request: {
    params: flagPath,
    body: {
      content: { "application/json": { schema: UpdateCapabilityFlagSchema } },
      required: true,
    },
  },
  responses: {
    200: jsonResponse(
      "Updated capability flag",
      dataEnvelope(OrganizationCapabilityFlagSchema),
    ),
    ...standardErrorResponses,
    409: standardErrorResponses[409],
  },
});

export const capabilityFlagRoutes = [
  listEffectiveCapabilityFlagsRoute,
  getCapabilityFlagAdminReportRoute,
  getCapabilityFlagHistoryRoute,
  updateCapabilityFlagRoute,
] as const;

export type CapabilityFlagId = z.infer<typeof CapabilityFlagIdSchema>;
export type CapabilityFlagState = z.infer<typeof CapabilityFlagStateSchema>;
export type CapabilityFlagSubject = z.infer<typeof CapabilityFlagSubjectSchema>;
