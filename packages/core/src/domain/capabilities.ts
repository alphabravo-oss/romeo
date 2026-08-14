export type CapabilityAssignmentScopeType =
  | "organization"
  | "workspace"
  | "agent"
  | "group"
  | "user";

export type CapabilityAssignmentState =
  | "disabled"
  | "enabled"
  | "inherit"
  | "required";

export interface CapabilityScopeRef {
  scopeType: CapabilityAssignmentScopeType;
  scopeId: string;
}

/**
 * An immutable capability-policy revision. A replacement revokes the current
 * revision and appends a new revision linked through `supersedesId`.
 */
export interface CapabilityAssignment {
  id: string;
  orgId: string;
  scopeType: CapabilityAssignmentScopeType;
  scopeId: string;
  capabilityId: string;
  state: CapabilityAssignmentState;
  configuration: Record<string, unknown>;
  version: number;
  supersedesId?: string;
  actorId: string;
  reason: string;
  effectiveAt: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export type NewCapabilityAssignment = Omit<
  CapabilityAssignment,
  "revokedAt" | "supersedesId" | "version"
>;

export interface ListActiveCapabilityAssignmentsInput {
  orgId: string;
  scopes: CapabilityScopeRef[];
  capabilityIds: string[];
  at: string;
}

export interface ListCapabilityAssignmentHistoryInput {
  orgId: string;
  scope: CapabilityScopeRef;
  capabilityId: string;
  limit: number;
}

export interface ReplaceCapabilityAssignmentInput {
  assignment: NewCapabilityAssignment;
  expectedVersion?: number;
}

export class CapabilityAssignmentVersionConflictError extends Error {
  readonly code = "capability_assignment_version_conflict";

  constructor(
    readonly expectedVersion: number | undefined,
    readonly currentVersion: number | undefined,
  ) {
    super(
      `Capability assignment version conflict: expected ${String(expectedVersion)}, current ${String(currentVersion)}.`,
    );
    this.name = "CapabilityAssignmentVersionConflictError";
  }
}
