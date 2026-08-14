import type { AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { getAuthorizedAgent } from "./agent-access";
import { getAgentVersionForAgent } from "./agent-service-support";
import { diffAgentVersions, type AgentVersionDiff } from "./agent-version-diff";

export interface AuthorizedAgentVersionDiffInput {
  subject: AuthSubject;
  agentId: string;
  leftVersionId: string;
  rightVersionId: string;
}

export async function diffAuthorizedAgentVersions(
  repository: RomeoRepository,
  input: AuthorizedAgentVersionDiffInput,
): Promise<AgentVersionDiff> {
  await getAuthorizedAgent(repository, {
    agentId: input.agentId,
    subject: input.subject,
    scope: "agents:read",
  });
  const [left, right] = await Promise.all([
    getAgentVersionForAgent(repository, input.agentId, input.leftVersionId),
    getAgentVersionForAgent(repository, input.agentId, input.rightVersionId),
  ]);
  return diffAgentVersions(left, right);
}
