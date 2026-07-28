import { z } from "@hono/zod-openapi";

const identifier = z.string().trim().min(1).max(300);
const timestamp = z.iso.datetime();

export const ChatTagSchema = z
  .strictObject({
    id: identifier,
    orgId: identifier,
    userId: identifier,
    slug: z.string().min(1).max(160),
    name: z.string().min(1).max(160),
    meta: z.record(z.string(), z.unknown()).optional(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .openapi("ChatTag");

export const AssignChatTagSchema = z
  .strictObject({ name: z.string().trim().min(1).max(160) })
  .openapi("AssignChatTagRequest");
