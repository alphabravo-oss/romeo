import { assertScope } from "@romeo/auth";

import {
  CapabilityAssignmentVersionConflictError,
  type CapabilityAssignment,
  type NewCapabilityAssignment,
} from "../domain/capabilities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { parseCapabilityConfigurationPatch } from "./capability-definition-registry";
import {
  assertCapabilityScopeRef,
  requiredCapabilityDefinition,
  type UpdateCapabilityAssignmentInput,
} from "./capability-resolution-model";

export async function updateCapabilityAssignment(
  repository: RomeoRepository,
  input: UpdateCapabilityAssignmentInput,
): Promise<CapabilityAssignment> {
  assertScope(input.subject, "capabilities:manage");
  const definition = requiredCapabilityDefinition(input.capabilityId);
  await assertCapabilityScopeRef(repository, input.subject, input.scope);
  if (!definition.allowedStates.includes(input.state))
    throw new ApiError(
      "capability_assignment_state_unsupported",
      "The assignment state is not supported by this capability.",
      400,
    );
  if (!definition.controllingLayers.includes(input.scope.scopeType))
    throw new ApiError(
      "capability_assignment_invalid",
      "The capability cannot be assigned at the requested scope.",
      400,
    );
  if (input.state !== "required" && input.state !== "inherit") {
    const parents = await repository.listActiveCapabilityAssignments({
      orgId: input.subject.orgId,
      scopes: parentScopes(
        input.subject.orgId,
        input.scope,
        input.workspaceId,
      ),
      capabilityIds: [input.capabilityId],
      at: new Date().toISOString(),
    });
    if (parents.some((assignment) => assignment.state === "required"))
      throw new ApiError(
        "capability_assignment_invalid",
        "A child assignment cannot weaken a required parent policy.",
        400,
      );
  }
  const configuration = parseCapabilityConfigurationPatch(
    definition.id,
    input.configuration,
  );
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > 1_000)
    throw new ApiError(
      "capability_assignment_invalid",
      "A bounded capability assignment reason is required.",
      400,
    );
  if (
    input.expiresAt !== undefined &&
    input.expiresAt !== null &&
    (!Number.isFinite(Date.parse(input.expiresAt)) ||
      Date.parse(input.expiresAt) <= Date.now())
  )
    throw new ApiError(
      "capability_assignment_invalid",
      "Capability assignment expiry must be in the future.",
      400,
    );
  const now = new Date().toISOString();
  const expiresAt =
    input.expiresAt === undefined || input.expiresAt === null
      ? undefined
      : new Date(input.expiresAt).toISOString();
  const assignment: NewCapabilityAssignment = {
    id: createId("capability_assignment"),
    orgId: input.subject.orgId,
    scopeType: input.scope.scopeType,
    scopeId: input.scope.scopeId,
    capabilityId: input.capabilityId,
    state: input.state,
    configuration: { ...configuration },
    actorId: input.subject.id,
    reason,
    effectiveAt: now,
    createdAt: now,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
  try {
    return await repository.transaction(async (transaction) => {
      const stored = await transaction.replaceCapabilityAssignment({
        assignment,
        ...(input.expectedVersion === undefined
          ? {}
          : { expectedVersion: input.expectedVersion }),
      });
      await writeAuditLog(transaction, {
        subject: input.subject,
        action: "admin.capability_assignment.replace",
        resourceType: "capability_assignment",
        resourceId: stored.id,
        metadata: {
          capabilityId: stored.capabilityId,
          scopeType: stored.scopeType,
          scopeId: stored.scopeId,
          state: stored.state,
          version: stored.version,
          configurationFields: Object.keys(stored.configuration).sort(),
          expires: stored.expiresAt !== undefined,
        },
      });
      return stored;
    });
  } catch (caught) {
    if (caught instanceof CapabilityAssignmentVersionConflictError)
      throw new ApiError(
        "capability_assignment_version_conflict",
        "The capability assignment changed. Refresh and try again.",
        409,
        {
          expectedVersion: caught.expectedVersion,
          currentVersion: caught.currentVersion,
        },
      );
    throw caught;
  }
}

function parentScopes(
  orgId: string,
  scope: UpdateCapabilityAssignmentInput["scope"],
  workspaceId: string | undefined,
): UpdateCapabilityAssignmentInput["scope"][] {
  if (scope.scopeType === "organization") return [];
  const organization = {
    scopeType: "organization" as const,
    scopeId: orgId,
  };
  if (scope.scopeType === "workspace") return [organization];
  return [
    organization,
    ...(workspaceId === undefined
      ? []
      : [{ scopeType: "workspace" as const, scopeId: workspaceId }]),
  ];
}
