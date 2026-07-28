import { z } from "@hono/zod-openapi";

export const governanceIdentifier = z.string().trim().min(1).max(300);
export const governanceTimestamp = z.iso.datetime();
export const governanceCount = z.number().int().nonnegative();
