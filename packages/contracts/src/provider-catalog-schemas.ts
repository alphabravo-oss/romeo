import { z } from "@hono/zod-openapi";

const identifier = z.string().trim().min(1).max(300);

export const ProviderCatalogSyncSchema = z
  .strictObject({
    status: z.enum(["error", "never", "ready", "stale", "syncing"]),
    modelCount: z.number().int().nonnegative(),
    lastAttemptAt: z.iso.datetime().optional(),
    lastSyncedAt: z.iso.datetime().optional(),
    error: z.string().max(1_000).optional(),
  })
  .openapi("ProviderCatalogSync");

export const CatalogSupportLevelSchema = z.enum([
  "emulated",
  "native",
  "unsupported",
]);

export const CatalogModelSurfaceSchema = z
  .strictObject({
    contextWindow: z.number().int().positive(),
    deploymentBoundary: z.enum(["hosted-api", "local-runtime"]),
    maxOutputTokens: z.number().int().positive().optional(),
    modalities: z.array(z.string().min(1).max(40)).max(16),
    pricing: z
      .strictObject({
        inputTokenUsd: z.number().nonnegative(),
        outputTokenUsd: z.number().nonnegative(),
      })
      .optional(),
    probeFreshness: z.enum(["fresh", "never", "stale"]),
    reasoning: CatalogSupportLevelSchema,
    region: z.string().min(1).max(80).optional(),
    tools: CatalogSupportLevelSchema,
    vision: CatalogSupportLevelSchema,
  })
  .openapi("CatalogModelSurface");

export const ProviderCatalogSyncJobSchema = z
  .strictObject({
    jobId: identifier,
    providerId: identifier,
    state: z.enum(["queued", "running", "ready", "failed"]),
    percent: z.number().int().min(0).max(100),
    modelCount: z.number().int().nonnegative(),
    error: z.string().max(300).optional(),
  })
  .openapi("ProviderCatalogSyncJob");
