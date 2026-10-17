import type {
  groupMemberships,
  groups,
  orgSsoOidcSettings,
  users,
} from "./schema";
import type {
  GroupMembershipRecord,
  GroupRecord,
  SsoOidcSettingsRecord,
  UserRecord,
} from "./identity-repository";
import {
  asStringArray,
  asStringRecord,
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";

type UserRole = "global_admin" | "org_admin" | "user";

export function toUserRecord(row: typeof users.$inferSelect): UserRecord {
  const user: UserRecord = {
    id: row.id,
    orgId: row.orgId,
    email: row.email,
    name: row.name,
    role: normalizeUserRole(row.role),
  };
  const disabledAt = optionalIsoString(row.disabledAt);
  if (disabledAt !== undefined) user.disabledAt = disabledAt;
  return user;
}

export function toGroupRecord(row: typeof groups.$inferSelect): GroupRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    slug: row.slug,
    createdAt: toIsoString(row.createdAt),
  };
}

export function toGroupMembershipRecord(
  row: typeof groupMemberships.$inferSelect,
): GroupMembershipRecord {
  return {
    groupId: row.groupId,
    userId: row.userId,
    orgId: row.orgId,
    createdAt: toIsoString(row.createdAt),
  };
}

export function toSsoOidcSettingsRecord(
  row: typeof orgSsoOidcSettings.$inferSelect,
): SsoOidcSettingsRecord {
  return {
    orgId: row.orgId,
    enabled: row.enabled,
    issuerUrl: row.issuerUrl,
    clientId: row.clientId,
    groupClaim: row.groupClaim,
    adminGroups: asStringArray(row.adminGroups),
    groupMap: asStringRecord(row.groupMap),
    workspaceGroupMap: asStringRecord(row.workspaceGroupMap),
    workspaceGroupPrefix: row.workspaceGroupPrefix,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function toUserInsert(record: UserRecord): typeof users.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    email: record.email,
    name: record.name,
    role: normalizeUserRole(record.role),
    disabledAt: optionalDate(record.disabledAt),
  };
}

export function normalizeUserRole(value: unknown): UserRole {
  return value === "org_admin" || value === "global_admin" ? value : "user";
}

export function toGroupInsert(record: GroupRecord): typeof groups.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    name: record.name,
    slug: record.slug,
    createdAt: new Date(record.createdAt),
  };
}

export function toGroupMembershipInsert(
  record: GroupMembershipRecord,
): typeof groupMemberships.$inferInsert {
  return {
    groupId: record.groupId,
    userId: record.userId,
    orgId: record.orgId,
    createdAt: new Date(record.createdAt),
  };
}

export function toSsoOidcSettingsInsert(
  record: SsoOidcSettingsRecord,
): typeof orgSsoOidcSettings.$inferInsert {
  return {
    orgId: record.orgId,
    enabled: record.enabled,
    issuerUrl: record.issuerUrl,
    clientId: record.clientId,
    groupClaim: record.groupClaim,
    adminGroups: record.adminGroups,
    groupMap: record.groupMap,
    workspaceGroupMap: record.workspaceGroupMap,
    workspaceGroupPrefix: record.workspaceGroupPrefix,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}
