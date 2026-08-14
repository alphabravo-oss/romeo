import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const identifier = z.string().trim().min(1).max(300);
const metadata = { security: authenticationSecurity };
const requestBody = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});

export const probeModelRoute = createRoute({
  ...metadata,
  tags: ["Providers"],
  method: "post",
  path: "/api/v1/models/{modelId}/probe",
  operationId: "models.probe",
  summary: "Probe advertised model capabilities with synthetic inputs",
  request: {
    params: z.strictObject({ modelId: identifier }),
    body: requestBody(
      z.strictObject({
        features: z
          .array(
            z.enum(["streaming", "tools", "json", "vision", "audio", "reasoning"]),
          )
          .min(1)
          .max(8),
      }),
    ),
  },
  responses: {
    200: jsonResponse(
      "Model probe",
      dataEnvelope(
        z.strictObject({
          modelId: identifier,
          probedAt: z.iso.datetime(),
          results: z.array(
            z.strictObject({
              feature: z.enum([
                "streaming",
                "tools",
                "json",
                "vision",
                "audio",
                "reasoning",
              ]),
              advertised: z.boolean(),
              probed: z.boolean(),
              outcome: z.enum(["match", "mismatch"]),
              code: z.literal("provider_probe_mismatch").optional(),
            }),
          ),
        }),
      ),
    ),
    ...standardErrorResponses,
  },
});

export const updateModelCapabilityOverridesRoute = createRoute({
  ...metadata,
  tags: ["Providers"],
  method: "patch",
  path: "/api/v1/models/{modelId}/capability-overrides",
  operationId: "models.capabilityOverrides.update",
  summary: "Set an expiring administrator capability override",
  request: {
    params: z.strictObject({ modelId: identifier }),
    body: requestBody(
      z.strictObject({
        tools: z.boolean().optional(),
        reasoning: z.boolean().optional(),
        vision: z.boolean().optional(),
        imageOutput: z.boolean().optional(),
        reason: z.string().trim().min(1).max(300),
        expiresAt: z.iso.datetime().optional(),
      }),
    ),
  },
  responses: {
    200: jsonResponse(
      "Capability override",
      dataEnvelope(
        z.strictObject({
          modelId: identifier,
          source: z.literal("override"),
          updatedAt: z.iso.datetime(),
        }),
      ),
    ),
    ...standardErrorResponses,
  },
});

export const previewModelCompatibilityRoute = createRoute({
  ...metadata,
  tags: ["Providers"],
  method: "post",
  path: "/api/v1/models/compatibility/preview",
  operationId: "models.compatibility.preview",
  summary: "Preview whether a model satisfies turn requirements without executing",
  request: {
    body: requestBody(
      z.strictObject({
        modelId: identifier,
        required: z.strictObject({
          attachments: z.boolean(),
          tools: z.boolean(),
          reasoning: z.boolean(),
          imageOutput: z.boolean(),
          localOnly: z.boolean(),
        }),
      }),
    ),
  },
  responses: {
    200: jsonResponse(
      "Compatibility preview",
      dataEnvelope(
        z.strictObject({
          modelId: identifier,
          outcome: z.enum(["available", "unavailable"]),
          constraint: z
            .enum([
              "tools_unsupported",
              "reasoning_unsupported",
              "image_output_unsupported",
              "local_only_policy",
              "region_outside_residency",
              "not_entitled",
            ])
            .optional(),
        }),
      ),
    ),
    ...standardErrorResponses,
  },
});

export const modelCapabilityProbeRoutes = [
  probeModelRoute,
  updateModelCapabilityOverridesRoute,
  previewModelCompatibilityRoute,
] as const;
