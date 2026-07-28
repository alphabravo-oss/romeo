import { pgEnum } from "drizzle-orm/pg-core";

export const principalType = pgEnum("principal_type", [
  "user",
  "group",
  "service_account",
]);
export const providerKind = pgEnum("provider_kind", [
  "anthropic",
  "openai-compatible",
  "openai-responses-compatible",
  "ollama",
]);
export const messageRole = pgEnum("message_role", [
  "system",
  "user",
  "assistant",
  "tool",
]);
export const runStatus = pgEnum("run_status", [
  "queued",
  "running",
  "waiting_tool_approval",
  "cancelled",
  "completed",
  "failed",
]);
export const queuedChatTurnStatus = pgEnum("queued_chat_turn_status", [
  "queued",
  "leased",
  "failed",
  "cancelled",
  "completed",
]);
export const resourcePermission = pgEnum("resource_permission", [
  "read",
  "write",
  "use",
  "run",
]);
export const quotaScopeType = pgEnum("quota_scope_type", [
  "org",
  "user",
  "workspace",
  "provider",
  "agent",
  "api_key",
]);
export const webhookDeliveryStatus = pgEnum("webhook_delivery_status", [
  "pending",
  "delivered",
  "failed",
]);
