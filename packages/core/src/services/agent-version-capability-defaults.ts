import type { AgentVersionCapabilityDefault } from "../domain/agent-entities";
import type { RomeoRepository } from "../domain/repository";
import { capabilityIds } from "./capability-definition-registry";

export async function snapshotAgentCapabilityDefaults(
  repository: RomeoRepository,
  input: { agentId: string; orgId: string; at: string },
): Promise<AgentVersionCapabilityDefault[]> {
  const assignments = await repository.listActiveCapabilityAssignments({
    orgId: input.orgId,
    scopes: [{ scopeType: "agent", scopeId: input.agentId }],
    capabilityIds: [...capabilityIds],
    at: input.at,
  });
  return assignments.map((assignment) => ({
    capabilityId: assignment.capabilityId,
    state: assignment.state,
    configuration: structuredClone(assignment.configuration),
    assignmentVersion: assignment.version,
    ...(assignment.expiresAt === undefined
      ? {}
      : { expiresAt: assignment.expiresAt }),
  }));
}
