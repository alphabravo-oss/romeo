import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";

import type { KnowledgeBase } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { createId } from "../ids";

export function assertKnowledgeWorkspaceAccess(
  subject: AuthSubject,
  workspaceId: string,
  scope: "knowledge:read" | "knowledge:write",
): void {
  assertScope(subject, scope);
  if (!hasWorkspaceAccess(subject, workspaceId))
    throw new AuthorizationError("The workspace is outside the caller access.");
}

export async function getAuthorizedKnowledgeBase(
  repository: RomeoRepository,
  input: {
    knowledgeBaseId: string;
    subject: AuthSubject;
    scope: "knowledge:read" | "knowledge:write" | "knowledge:query";
    permission: ResourceGrant["permission"];
  },
): Promise<KnowledgeBase> {
  assertScope(input.subject, input.scope);
  const knowledgeBase = await repository.getKnowledgeBase(
    input.knowledgeBaseId,
  );
  if (!knowledgeBase) throw notFound("Knowledge base");
  if (!canAccessOrg(input.subject, knowledgeBase.orgId)) {
    throw new AuthorizationError(
      "The knowledge base is outside the caller organization.",
    );
  }
  if (!hasWorkspaceAccess(input.subject, knowledgeBase.workspaceId)) {
    throw new AuthorizationError(
      "The knowledge base is outside the caller workspace access.",
    );
  }

  const grants = await repository.listResourceGrants(input.subject.orgId);
  if (
    !hasGrant(
      input.subject,
      grants,
      "knowledge_base",
      knowledgeBase.id,
      input.permission,
    )
  ) {
    throw new AuthorizationError(
      `Missing ${input.permission} permission for knowledge_base:${knowledgeBase.id}`,
    );
  }
  return knowledgeBase;
}

export async function createKnowledgeOwnerGrants(
  repository: RomeoRepository,
  subject: AuthSubject,
  knowledgeBaseId: string,
): Promise<void> {
  const permissions: ResourceGrant["permission"][] = ["read", "write", "use"];
  await Promise.all(
    permissions.map((permission) =>
      repository.createResourceGrant({
        id: createId("grant"),
        resourceType: "knowledge_base",
        resourceId: knowledgeBaseId,
        principalType: subject.type,
        principalId: subject.id,
        permission,
      }),
    ),
  );
}
