import { AuthorizationError } from "./errors";
import { hasGrant, hasWorkspaceAccess } from "./grants";
import { canAccessOrg } from "./roles";
import { assertScope } from "./scopes";
import type {
  ResourceGrant,
  ResourceType,
  RunAuthorizationInput,
} from "./types";

export function assertRunAuthorized(input: RunAuthorizationInput): void {
  assertScope(input.subject, "runs:create");
  assertScope(input.subject, "agents:run");

  if (!canAccessOrg(input.subject, input.orgId)) {
    throw new AuthorizationError("The run is outside the caller organization.");
  }

  if (!hasWorkspaceAccess(input.subject, input.workspaceId)) {
    throw new AuthorizationError(
      "The run is outside the caller workspace access.",
    );
  }

  const checks: Array<[ResourceType, string, ResourceGrant["permission"]]> = [
    ["chat", input.chatId, "write"],
    ["agent", input.agentId, "run"],
    ["model", input.modelId, "use"],
    ["provider", input.providerId, "use"],
  ];

  for (const [resourceType, resourceId, permission] of checks) {
    if (
      !hasGrant(
        input.subject,
        input.grants,
        resourceType,
        resourceId,
        permission,
      )
    ) {
      throw new AuthorizationError(
        `Missing ${permission} permission for ${resourceType}:${resourceId}`,
      );
    }
  }
}
