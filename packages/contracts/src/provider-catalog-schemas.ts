import { z } from "@hono/zod-openapi";

export const ProviderCatalogSyncSchema = z
  .strictObject({
    status: z.enum(["error", "never", "ready", "stale", "syncing"]),
    modelCount: z.number().int().nonnegative(),
    lastAttemptAt: z.iso.datetime().optional(),
    lastSyncedAt: z.iso.datetime().optional(),
    error: z.string().max(1_000).optional(),
  })
  .openapi("ProviderCatalogSync");
