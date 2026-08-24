import { z } from "@hono/zod-openapi";

const count = z.number().int().nonnegative();
const timestamp = z.iso.datetime();

export const RuntimeKeyUsageCountsSchema = z
  .strictObject({
    active: count,
    corrupt: count,
    legacyUnversioned: count,
    previous: count,
    total: count,
    unknown: count,
  })
  .openapi("RuntimeKeyUsageCounts");

export const RuntimeKeyRotationBlockerSchema = z
  .strictObject({
    action: z.string().min(1).max(240),
    code: z.enum([
      "active_key_not_configured",
      "corrupt_records_present",
      "legacy_unversioned_records_present",
      "previous_key_invalid",
      "previous_key_matches_active",
      "previous_key_usage_present",
      "unknown_key_version_records_present",
    ]),
    count,
  })
  .openapi("RuntimeKeyRotationBlocker");

export const RuntimeKeyRotationSurfacePostureSchema = z
  .strictObject({
    configuration: z.strictObject({
      activeKeyConfigured: z.boolean(),
      previousKeyAccepted: z.boolean(),
      previousKeyConfigured: z.boolean(),
    }),
    removalStatus: z.enum(["blocked", "not_configured", "safe"]),
    safeToRemovePrevious: z.boolean(),
    blockers: z.array(RuntimeKeyRotationBlockerSchema),
    usage: RuntimeKeyUsageCountsSchema,
  })
  .openapi("RuntimeKeyRotationSurfacePosture");

export const RuntimeKeyRotationPostureReportSchema = z
  .strictObject({
    schema: z.literal("romeo.runtime-key-rotation-posture.v1"),
    generatedAt: timestamp,
    aggregationScope: z.literal("all_organizations"),
    status: z.enum(["attention_required", "ready"]),
    delegatedOAuth: RuntimeKeyRotationSurfacePostureSchema,
    webhookSigning: RuntimeKeyRotationSurfacePostureSchema,
    redaction: z.strictObject({
      ciphertextReturned: z.literal(false),
      connectionIdsReturned: z.literal(false),
      deliveryIdsReturned: z.literal(false),
      keyMaterialReturned: z.literal(false),
      payloadsReturned: z.literal(false),
      rawSignaturesReturned: z.literal(false),
      secretValuesReturned: z.literal(false),
    }),
  })
  .openapi("RuntimeKeyRotationPostureReport");

export type RuntimeKeyRotationPostureReport = z.infer<
  typeof RuntimeKeyRotationPostureReportSchema
>;
