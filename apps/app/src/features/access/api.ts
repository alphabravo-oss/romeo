import {
  collaborationListKnowledgeBaseShares,
  collaborationListModelShares,
  collaborationListWorkspaceMembers,
  collaborationRevokeKnowledgeBaseShare,
  collaborationRevokeModelShare,
  collaborationRevokeWorkspaceMember,
  collaborationShareKnowledgeBase,
  collaborationShareModel,
  collaborationShareWorkspace,
} from "@romeo/api-client/generated/sdk";
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

export async function listModelShares(modelId: string): Promise<AccessGrant[]> {
  configureBrowserApiClients();
  const response = await collaborationListModelShares({
    path: { modelId },
    throwOnError: true,
  });
  return response.data.data;
}

export function shareModel(
  modelId: string,
  share: SharePrincipal,
): Promise<AccessGrant[]> {
  configureBrowserApiClients();
  return collaborationShareModel({
    path: { modelId },
    body: share,
    throwOnError: true,
  }).then((response) => response.data.data);
}

export function revokeModelShare(
  modelId: string,
  grantId: string,
): Promise<AccessGrant> {
  configureBrowserApiClients();
  return collaborationRevokeModelShare({
    path: { modelId, grantId },
    throwOnError: true,
  }).then((response) => response.data.data);
}

export function listKnowledgeShares(
  knowledgeBaseId: string,
): Promise<AccessGrant[]> {
  configureBrowserApiClients();
  return collaborationListKnowledgeBaseShares({
    path: { knowledgeBaseId },
    throwOnError: true,
  }).then((response) => response.data.data);
}

export function shareKnowledge(
  knowledgeBaseId: string,
  share: SharePrincipal,
): Promise<AccessGrant[]> {
  configureBrowserApiClients();
  return collaborationShareKnowledgeBase({
    path: { knowledgeBaseId },
    body: share,
    throwOnError: true,
  }).then((response) => response.data.data);
}

export function revokeKnowledgeShare(
  knowledgeBaseId: string,
  grantId: string,
): Promise<AccessGrant> {
  configureBrowserApiClients();
  return collaborationRevokeKnowledgeBaseShare({
    path: { knowledgeBaseId, grantId },
    throwOnError: true,
  }).then((response) => response.data.data);
}

export function listWorkspaceMembers(
  workspaceId: string,
): Promise<AccessGrant[]> {
  configureBrowserApiClients();
  return collaborationListWorkspaceMembers({
    path: { workspaceId },
    throwOnError: true,
  }).then((response) => response.data.data);
}

export function shareWorkspace(
  workspaceId: string,
  share: SharePrincipal,
): Promise<AccessGrant[]> {
  configureBrowserApiClients();
  return collaborationShareWorkspace({
    path: { workspaceId },
    body: share,
    throwOnError: true,
  }).then((response) => response.data.data);
}

export function revokeWorkspaceMember(
  workspaceId: string,
  grantId: string,
): Promise<AccessGrant> {
  configureBrowserApiClients();
  return collaborationRevokeWorkspaceMember({
    path: { workspaceId, grantId },
    throwOnError: true,
  }).then((response) => response.data.data);
}
