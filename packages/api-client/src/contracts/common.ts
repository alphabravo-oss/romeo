export type HttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export type Scope =
  | "me:read"
  | "organizations:read"
  | "workspaces:read"
  | "providers:read"
  | "providers:write"
  | "models:read"
  | "models:use"
  | "agents:read"
  | "agents:create"
  | "agents:write"
  | "agents:run"
  | "chats:read"
  | "chats:write"
  | "runs:read"
  | "runs:create"
  | "runs:cancel"
  | "files:read"
  | "files:write"
  | "knowledge:read"
  | "knowledge:write"
  | "knowledge:query"
  | "audit:read"
  | "usage:read"
  | "webhooks:read"
  | "webhooks:write"
  | "voices:use"
  | "voices:manage"
  | "tools:use"
  | "tools:manage"
  | "admin:read"
  | "admin:write";

export interface RomeoClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface ApiEnvelope<T> {
  data: T;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id: string;
    details?: Record<string, unknown>;
  };
}

export interface AuthSubject {
  id: string;
  type: "service_account" | "user";
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
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export interface Workspace {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  archivedAt?: string;
}

export interface CreateWorkspaceInput {
  name: string;
  slug?: string;
}

export interface BootstrapResponse {
  subject: AuthSubject;
  user?: UserProfile;
  deployment: {
    tenancyMode: "multi" | "single";
  };
  organizations: Organization[];
  workspaces: Workspace[];
}

export interface UserProfile {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role?: "global_admin" | "org_admin" | "user";
  disabledAt?: string;
}

export interface UpdateMyProfileInput {
  email?: string;
  name?: string;
}

export interface WorkspaceExportDocument {
  schema: "romeo.workspace-export.v1";
  orgId: string;
  workspace: Workspace;
  counts: {
    agents: number;
    chats: number;
    messages: number;
    knowledgeBases: number;
    dataConnectors: number;
    workflows: number;
  };
  resources: {
    agents: Array<{
      id: string;
      publishedVersionId?: string;
      updatedAt: string;
    }>;
    chats: Array<{ id: string; archivedAt?: string; updatedAt: string }>;
    knowledgeBases: Array<{ id: string; createdAt: string; updatedAt: string }>;
    dataConnectors: Array<{
      id: string;
      knowledgeBaseId: string;
      status: string;
      type: string;
    }>;
    workflows: Array<{
      enabled: boolean;
      id: string;
      stepCount: number;
      updatedAt: string;
    }>;
  };
  exportedAt: string;
}

export interface HealthStatus {
  status: "ok";
  service: string;
  version: string;
  requestId: string;
}
