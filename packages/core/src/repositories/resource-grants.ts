import type { ResourceGrant } from "@romeo/auth";

import type { SeedData } from "./seed-data";

export function listSeedResourceGrants(
  data: SeedData,
  orgId: string,
): ResourceGrant[] {
  const resourcesInOrg = new Set([
    ...data.organizations
      .filter((item) => item.id === orgId)
      .map((item) => item.id),
    ...data.workspaces
      .filter((item) => item.orgId === orgId)
      .map((item) => item.id),
    ...data.providers
      .filter((item) => item.orgId === orgId)
      .map((item) => item.id),
    ...data.models.map((item) => item.id),
    ...data.agents
      .filter((item) => item.orgId === orgId)
      .map((item) => item.id),
    ...data.chats.filter((item) => item.orgId === orgId).map((item) => item.id),
    ...data.runs.filter((item) => item.orgId === orgId).map((item) => item.id),
    ...data.dataConnectors
      .filter((item) => item.orgId === orgId)
      .map((item) => item.id),
    ...data.fileObjects
      .filter((item) => item.orgId === orgId)
      .map((item) => item.id),
    ...data.knowledgeBases
      .filter((item) => item.orgId === orgId)
      .map((item) => item.id),
    ...data.promptTemplates
      .filter((item) => item.orgId === orgId)
      .map((item) => item.id),
    ...data.workspaceFolders
      .filter((item) => item.orgId === orgId)
      .map((item) => item.id),
    ...data.toolConnectors
      .filter((item) => item.orgId === orgId)
      .map((item) => item.id),
    ...data.toolOperations
      .filter((item) => item.orgId === orgId)
      .map((item) => item.id),
    ...data.voiceProfiles
      .filter((item) => item.orgId === orgId)
      .map((item) => item.id),
  ]);

  return data.grants.filter(
    (grant) =>
      resourcesInOrg.has(grant.resourceId) || grant.resourceType === "tool",
  );
}
