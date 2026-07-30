import { assertScope, type AuthSubject } from "@romeo/auth";

import type { VoiceProfile } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";

export async function listVoiceProfilesWithDependencies(
  repository: RomeoRepository,
  subject: AuthSubject,
): Promise<VoiceProfile[]> {
  assertScope(subject, "voices:use");
  const [voices, workspaces, grants] = await Promise.all([
    repository.listVoiceProfiles(subject.orgId),
    repository.listWorkspaces(subject.orgId),
    repository.listResourceGrants(subject.orgId),
  ]);
  const agents = (
    await Promise.all(
      workspaces.map((workspace) => repository.listAgents(workspace.id)),
    )
  ).flat();
  return voices.map((voice) => ({
    ...voice,
    dependentAgentCount: agents.filter(
      (agent) => agent.voiceProfileId === voice.id,
    ).length,
    grantCount: grants.filter(
      (grant) =>
        grant.resourceType === "voice_profile" && grant.resourceId === voice.id,
    ).length,
  }));
}
