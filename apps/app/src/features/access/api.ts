import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export interface AccessGrant {
  id: string;
  resourceType: string;
  resourceId: string;
  principalType: "group" | "service_account" | "user";
  principalId: string;
  permission: "read" | "write" | "use" | "run";
  createdAt?: string;
}

export interface SharePrincipal {
  principalType: "group" | "service_account" | "user";
  principalId: string;
  permissions: Array<"read" | "write" | "use" | "run">;
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  configureBrowserApiClients();
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (!headers.has("x-request-id")) {
    headers.set("x-request-id", crypto.randomUUID());
  }
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers,
  });
  const payload = (await response.json().catch(() => undefined)) as
    | { data?: T; error?: { message?: string } }
    | undefined;
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? response.statusText);
  }
  if (payload?.data === undefined) {
    throw new Error("The access API returned an empty response.");
  }
  return payload.data;
}

export function listModelShares(modelId: string): Promise<AccessGrant[]> {
  return requestJson(`/api/v1/models/${modelId}/shares`);
}

export function shareModel(
  modelId: string,
  share: SharePrincipal,
): Promise<AccessGrant[]> {
  return requestJson(`/api/v1/models/${modelId}/shares`, {
    method: "POST",
    body: JSON.stringify(share),
  });
}

export function revokeModelShare(
  modelId: string,
  grantId: string,
): Promise<AccessGrant> {
  return requestJson(`/api/v1/models/${modelId}/shares/${grantId}`, {
    method: "DELETE",
  });
}

export function listKnowledgeShares(
  knowledgeBaseId: string,
): Promise<AccessGrant[]> {
  return requestJson(`/api/v1/knowledge-bases/${knowledgeBaseId}/shares`);
}

export function shareKnowledge(
  knowledgeBaseId: string,
  share: SharePrincipal,
): Promise<AccessGrant[]> {
  return requestJson(`/api/v1/knowledge-bases/${knowledgeBaseId}/shares`, {
    method: "POST",
    body: JSON.stringify(share),
  });
}

export function revokeKnowledgeShare(
  knowledgeBaseId: string,
  grantId: string,
): Promise<AccessGrant> {
  return requestJson(
    `/api/v1/knowledge-bases/${knowledgeBaseId}/shares/${grantId}`,
    { method: "DELETE" },
  );
}

export function listWorkspaceMembers(
  workspaceId: string,
): Promise<AccessGrant[]> {
  return requestJson(`/api/v1/workspaces/${workspaceId}/members`);
}

export function shareWorkspace(
  workspaceId: string,
  share: SharePrincipal,
): Promise<AccessGrant[]> {
  return requestJson(`/api/v1/workspaces/${workspaceId}/members`, {
    method: "POST",
    body: JSON.stringify(share),
  });
}

export function revokeWorkspaceMember(
  workspaceId: string,
  grantId: string,
): Promise<AccessGrant> {
  return requestJson(`/api/v1/workspaces/${workspaceId}/members/${grantId}`, {
    method: "DELETE",
  });
}
