import type {
  CapabilityFlagId,
  CapabilityFlagState,
  CapabilityFlagSubject,
} from "@romeo/contracts";

export interface OrganizationCapabilityFlag {
  id: string;
  orgId: string;
  flagId: CapabilityFlagId;
  state: CapabilityFlagState;
  allowlistedSubjects: CapabilityFlagSubject[];
  version: number;
  supersedesId?: string;
  actorId: string;
  reason: string;
  revokedAt?: string;
  createdAt: string;
}

export type NewOrganizationCapabilityFlag = Omit<
  OrganizationCapabilityFlag,
  "revokedAt" | "supersedesId" | "version"
>;

export interface ListOrganizationCapabilityFlagsInput {
  orgId: string;
  flagIds?: CapabilityFlagId[];
}

export interface ListOrganizationCapabilityFlagHistoryInput {
  orgId: string;
  flagId: CapabilityFlagId;
  limit: number;
}

export interface ReplaceOrganizationCapabilityFlagInput {
  flag: NewOrganizationCapabilityFlag;
  expectedVersion?: number;
}

export class CapabilityFlagVersionConflictError extends Error {
  constructor(
    readonly expectedVersion: number | undefined,
    readonly currentVersion: number | undefined,
  ) {
    super("Capability flag version conflict.");
    this.name = "CapabilityFlagVersionConflictError";
  }
}
