import { CapabilityAssignmentVersionConflictError } from "../domain/capabilities";
import type * as E from "../domain/entities";
import { InMemoryRunRepository } from "./in-memory-run";

export abstract class InMemoryCapabilityAssignmentRepository extends InMemoryRunRepository {
  async listActiveCapabilityAssignments(
    input: E.ListActiveCapabilityAssignmentsInput,
  ): Promise<E.CapabilityAssignment[]> {
    const scopes = new Set(
      input.scopes.map((scope) => `${scope.scopeType}\u001f${scope.scopeId}`),
    );
    const capabilityIds = new Set(input.capabilityIds);
    return this.data.capabilityAssignments
      .filter(
        (assignment) =>
          assignment.orgId === input.orgId &&
          scopes.has(`${assignment.scopeType}\u001f${assignment.scopeId}`) &&
          capabilityIds.has(assignment.capabilityId) &&
          assignment.revokedAt === undefined &&
          assignment.effectiveAt <= input.at &&
          (assignment.expiresAt === undefined ||
            assignment.expiresAt > input.at),
      )
      .sort(compareCapabilityAssignments)
      .map((assignment) => structuredClone(assignment));
  }

  async listCapabilityAssignmentHistory(
    input: E.ListCapabilityAssignmentHistoryInput,
  ): Promise<E.CapabilityAssignment[]> {
    if (input.limit <= 0) return [];
    return this.data.capabilityAssignments
      .filter(
        (assignment) =>
          assignment.orgId === input.orgId &&
          assignment.scopeType === input.scope.scopeType &&
          assignment.scopeId === input.scope.scopeId &&
          assignment.capabilityId === input.capabilityId,
      )
      .sort((left, right) => right.version - left.version)
      .slice(0, input.limit)
      .map((assignment) => structuredClone(assignment));
  }

  async replaceCapabilityAssignment(
    input: E.ReplaceCapabilityAssignmentInput,
  ): Promise<E.CapabilityAssignment> {
    const candidate = input.assignment;
    this.assertCapabilityAssignmentScope(candidate);
    const current = this.data.capabilityAssignments.find(
      (assignment) =>
        assignment.orgId === candidate.orgId &&
        assignment.scopeType === candidate.scopeType &&
        assignment.scopeId === candidate.scopeId &&
        assignment.capabilityId === candidate.capabilityId &&
        assignment.revokedAt === undefined,
    );
    const currentExpired =
      current?.expiresAt !== undefined &&
      current.expiresAt <= candidate.createdAt;
    const expectsAbsent =
      input.expectedVersion === undefined || input.expectedVersion === 0;
    if (
      !(
        input.expectedVersion === current?.version ||
        (expectsAbsent && (current === undefined || currentExpired))
      )
    ) {
      throw new CapabilityAssignmentVersionConflictError(
        input.expectedVersion,
        current?.version,
      );
    }
    if (current !== undefined) current.revokedAt = candidate.createdAt;
    const assignment: E.CapabilityAssignment = {
      ...structuredClone(candidate),
      version: (current?.version ?? 0) + 1,
      ...(current === undefined ? {} : { supersedesId: current.id }),
    };
    this.data.capabilityAssignments.push(assignment);
    return structuredClone(assignment);
  }

  private assertCapabilityAssignmentScope(
    assignment: E.NewCapabilityAssignment,
  ): void {
    if (assignment.scopeType === "organization") {
      if (assignment.scopeId !== assignment.orgId) {
        throw new Error(
          "Organization capability assignment scope must match its organization.",
        );
      }
      return;
    }
    if (assignment.scopeType === "workspace") {
      if (
        this.data.workspaces.some(
          (workspace) =>
            workspace.id === assignment.scopeId &&
            workspace.orgId === assignment.orgId,
        )
      )
        return;
    } else if (assignment.scopeType === "agent") {
      if (
        this.data.agents.some(
          (agent) =>
            agent.id === assignment.scopeId && agent.orgId === assignment.orgId,
        )
      )
        return;
    } else if (assignment.scopeType === "group") {
      if (
        this.data.groups.some(
          (group) =>
            group.id === assignment.scopeId && group.orgId === assignment.orgId,
        )
      )
        return;
    } else if (
      this.data.users.some(
        (user) =>
          user.id === assignment.scopeId && user.orgId === assignment.orgId,
      )
    ) {
      return;
    }
    throw new Error(
      assignment.scopeType === "workspace"
        ? "Workspace capability assignment scope does not belong to its organization."
        : "Capability assignment scope does not belong to its organization.",
    );
  }
}

function compareCapabilityAssignments(
  left: E.CapabilityAssignment,
  right: E.CapabilityAssignment,
): number {
  return (
    left.scopeType.localeCompare(right.scopeType) ||
    left.scopeId.localeCompare(right.scopeId) ||
    left.capabilityId.localeCompare(right.capabilityId)
  );
}
