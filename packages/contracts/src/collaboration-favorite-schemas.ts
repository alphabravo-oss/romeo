import { z } from "@hono/zod-openapi";

const identifier = z.string().trim().min(1).max(300);
const favoritableResourceType = z.enum([
  "agent",
  "chat",
  "knowledge_base",
  "model",
]);

export const ResourceFavoriteSchema = z
  .strictObject({
    id: identifier,
    orgId: identifier,
    userId: identifier,
    resourceType: favoritableResourceType,
    resourceId: identifier,
    createdAt: z.iso.datetime(),
  })
  .openapi("ResourceFavorite");

export const CreateFavoriteSchema = z
  .strictObject({
    resourceType: favoritableResourceType,
    resourceId: identifier,
  })
  .openapi("CreateFavoriteRequest");
