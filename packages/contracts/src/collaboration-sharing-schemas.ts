import { z } from "@hono/zod-openapi";

const identifier = z.string().trim().min(1).max(300);
const principalType = z.enum(["group", "service_account", "user"]);
const permission = z.enum(["read", "write", "use", "run"]);
const resourceType = z.enum([
  "organization",
  "workspace",
  "provider",
  "model",
  "agent",
  "chat",
  "run",
  "tool",
  "data_connector",
  "file",
  "knowledge_base",
  "prompt_template",
  "folder",
  "voice_profile",
]);

export const ResourceGrantSchema = z
  .strictObject({
    createdAt: z.iso.datetime().optional(),
    id: identifier,
    resourceType,
    resourceId: identifier,
    principalType,
    principalId: identifier,
    permission,
  })
  .openapi("ResourceGrant");

export const ShareTargetSchema = z
  .strictObject({
    principalType,
    principalId: identifier,
    label: z.string().min(1).max(500),
    detail: z.string().max(500).optional(),
  })
  .openapi("ShareTarget");

export const ShareResourceSchema = z
  .strictObject({
    principalType,
    principalId: identifier,
    permissions: z.array(permission).min(1).max(4),
  })
  .openapi("ShareResourceRequest");
