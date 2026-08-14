import { CapabilityFlagVersionConflictError } from "../domain/capability-flags";
import type * as F from "../domain/capability-flags";
import { InMemoryCapabilityAssignmentRepository } from "./in-memory-capabilities";

export abstract class InMemoryCapabilityFlagRepository extends InMemoryCapabilityAssignmentRepository {
  async listActiveOrganizationCapabilityFlags(
    input: F.ListOrganizationCapabilityFlagsInput,
  ): Promise<F.OrganizationCapabilityFlag[]> {
    const ids =
      input.flagIds === undefined ? undefined : new Set(input.flagIds);
    return this.data.organizationCapabilityFlags
      .filter(
        (flag) =>
          flag.orgId === input.orgId &&
          flag.revokedAt === undefined &&
          (ids === undefined || ids.has(flag.flagId)),
      )
      .sort((left, right) => left.flagId.localeCompare(right.flagId))
      .map((flag) => structuredClone(flag));
  }

  async listOrganizationCapabilityFlagHistory(
    input: F.ListOrganizationCapabilityFlagHistoryInput,
  ): Promise<F.OrganizationCapabilityFlag[]> {
    if (input.limit <= 0) return [];
    return this.data.organizationCapabilityFlags
      .filter(
        (flag) => flag.orgId === input.orgId && flag.flagId === input.flagId,
      )
      .sort((left, right) => right.version - left.version)
      .slice(0, input.limit)
      .map((flag) => structuredClone(flag));
  }

  async replaceOrganizationCapabilityFlag(
    input: F.ReplaceOrganizationCapabilityFlagInput,
  ): Promise<F.OrganizationCapabilityFlag> {
    const candidate = input.flag;
    const current = this.data.organizationCapabilityFlags.find(
      (flag) =>
        flag.orgId === candidate.orgId &&
        flag.flagId === candidate.flagId &&
        flag.revokedAt === undefined,
    );
    if (current !== undefined && equivalentFlag(current, candidate))
      return structuredClone(current);
    const expectsAbsent =
      input.expectedVersion === undefined || input.expectedVersion === 0;
    if (
      !(
        input.expectedVersion === current?.version ||
        (expectsAbsent && current === undefined)
      )
    )
      throw new CapabilityFlagVersionConflictError(
        input.expectedVersion,
        current?.version,
      );
    if (current !== undefined) current.revokedAt = candidate.createdAt;
    const stored: F.OrganizationCapabilityFlag = {
      ...structuredClone(candidate),
      version: (current?.version ?? 0) + 1,
      ...(current === undefined ? {} : { supersedesId: current.id }),
    };
    this.data.organizationCapabilityFlags.push(stored);
    return structuredClone(stored);
  }
}

function equivalentFlag(
  current: F.OrganizationCapabilityFlag,
  candidate: F.NewOrganizationCapabilityFlag,
): boolean {
  return (
    current.state === candidate.state &&
    JSON.stringify(current.allowlistedSubjects) ===
      JSON.stringify(candidate.allowlistedSubjects)
  );
}
