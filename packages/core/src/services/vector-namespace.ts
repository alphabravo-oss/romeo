import type { VectorNamespacePolicy } from "./vector-store-deployment";

export interface VectorScopedResource {
  knowledgeBaseId: string;
  orgId: string;
  workspaceId: string;
}

export function vectorScopeToken(
  policy: VectorNamespacePolicy,
  resource: VectorScopedResource,
): string | undefined {
  if (policy === "none") return undefined;
  if (policy === "org") return `org:${resource.orgId}`;
  if (policy === "workspace")
    return `workspace:${resource.orgId}:${resource.workspaceId}`;
  return `knowledge_base:${resource.orgId}:${resource.workspaceId}:${resource.knowledgeBaseId}`;
}
