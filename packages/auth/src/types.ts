export type PrincipalType = "user" | "group" | "service_account";
export type ResourceType =
  | "organization"
  | "workspace"
  | "provider"
  | "model"
  | "agent"
  | "chat"
  | "run"
  | "tool"
  | "data_connector"
  | "file"
  | "knowledge_base"
  | "prompt_template"
  | "folder"
  | "voice_profile";

export const scopeValues = [
  "me:read",
  "organizations:read",
  "workspaces:read",
  "providers:read",
  "providers:write",
  "models:read",
  "models:use",
  "agents:read",
  "agents:create",
  "agents:write",
  "agents:run",
  "chats:read",
  "chats:write",
  "runs:read",
  "runs:create",
  "runs:cancel",
  "files:read",
  "files:write",
  "knowledge:read",
  "knowledge:write",
  "knowledge:query",
  "audit:read",
  "usage:read",
  "webhooks:read",
  "webhooks:write",
  "voices:use",
  "voices:manage",
  "tools:use",
  "tools:manage",
  "admin:read",
  "admin:write",
] as const;

export type Scope = (typeof scopeValues)[number];
export type UserRole = "user" | "org_admin" | "global_admin";

export interface AuthSubject {
  id: string;
  type: "user" | "service_account";
  email?: string;
  name?: string;
  apiKeyId?: string;
  sessionId?: string;
  supportSession?: {
    adminUserId: string;
    createdAuditLogId: string;
  };
  orgId: string;
  workspaceIds: string[];
  groupIds: string[];
  scopes: Scope[];
  isAdmin?: boolean;
  adminRole?: Exclude<UserRole, "user">;
}

export interface ResourceGrant {
  id: string;
  resourceType: ResourceType;
  resourceId: string;
  principalType: PrincipalType;
  principalId: string;
  permission: "read" | "write" | "use" | "run";
}

export interface RunAuthorizationInput {
  subject: AuthSubject;
  orgId: string;
  workspaceId: string;
  chatId: string;
  agentId: string;
  modelId: string;
  providerId: string;
  grants: ResourceGrant[];
}
