export type DirectorySyncSource =
  | "active-directory"
  | "ldap"
  | "manual"
  | "oidc"
  | "saml"
  | "scim";

export interface DirectorySyncGroupInventory {
  groupId: string;
  presentUserIds: string[];
}

export interface DirectorySyncRequest {
  allowAdminUserDisable?: boolean | undefined;
  confirmApply?: "apply-directory-sync" | undefined;
  disableMissingUsers?: boolean | undefined;
  dryRun?: boolean | undefined;
  groupMemberships?: DirectorySyncGroupInventory[] | undefined;
  maxMembershipRemovals?: number | undefined;
  maxUserDisables?: number | undefined;
  presentUserEmails?: string[] | undefined;
  presentUserIds?: string[] | undefined;
  preserveAdminUsers?: boolean | undefined;
  reason?: string | undefined;
  removeMissingGroupMembers?: boolean | undefined;
  source: DirectorySyncSource;
}

export interface DirectorySyncUserDisablePlan {
  count: number;
  skippedAdminUserIds: string[];
  skippedSelfUserIds: string[];
  userIds: string[];
}

export interface DirectorySyncGroupRemovalPlan {
  count: number;
  groupId: string;
  userIds: string[];
}

export interface DirectorySyncMembershipRemovalPlan {
  count: number;
  groups: DirectorySyncGroupRemovalPlan[];
  skippedSelfUserIds: string[];
}

export interface DirectorySyncResult {
  changes: {
    membershipRemovals: DirectorySyncMembershipRemovalPlan;
    userDisables: DirectorySyncUserDisablePlan;
  };
  generatedAt: string;
  limits: {
    maxMembershipRemovals: number;
    maxUserDisables: number;
  };
  mode: "apply" | "preview";
  orgId: string;
  redaction: {
    externalGroupNamesReturned: false;
    externalSubjectIdsReturned: false;
    rawDirectoryPayloadReturned: false;
    userEmailsReturned: false;
    userNamesReturned: false;
  };
  requested: {
    disableMissingUsers: boolean;
    preserveAdminUsers: boolean;
    removeMissingGroupMembers: boolean;
  };
  schema: "romeo.directory-sync.v1";
  source: DirectorySyncSource;
  status: "applied" | "preview";
  warnings: string[];
}
