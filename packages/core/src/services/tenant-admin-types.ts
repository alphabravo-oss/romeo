import type { Organization, Workspace } from "../domain/entities";

export interface TenantAdminOrganizationSummary {
  organization: Organization;
  counts: {
    activeApiKeys: number;
    disabledUsers: number;
    serviceAccounts: number;
    users: number;
    workspaces: number;
  };
  suspension: {
    suspended: boolean;
    reasonCode?: string;
    suspendedAt?: string;
    suspendedBy?: string;
  };
  deletionRequest?: TenantDeletionRequestSummary;
}

export interface TenantProvisioningResult extends TenantAdminOrganizationSummary {
  initialAdmin?: {
    id: string;
    email: string;
    name: string;
    role: "org_admin";
    localPasswordConfigured: boolean;
  };
  defaultWorkspace: Workspace;
}

export interface TenantDeletionRequestSummary {
  status: "cancelled" | "requested";
  reasonCode: string;
  requestedAt: string;
  requestedBy: string;
  cancelledAt?: string;
  cancelledBy?: string;
}

export interface StoredTenantDeletionRequest extends TenantDeletionRequestSummary {
  schemaVersion: "romeo.tenant-deletion-request.v1";
  orgId: string;
}
