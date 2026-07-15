import { and, asc, eq } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { groupMemberships, groups, orgSsoOidcSettings, users } from "./schema";
import {
  asStringArray,
  asStringRecord,
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";

type UserRole = "global_admin" | "org_admin" | "user";

export interface UserRecord {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role?: UserRole;
  disabledAt?: string;
}

export interface GroupRecord {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface GroupMembershipRecord {
  groupId: string;
  userId: string;
  orgId: string;
  createdAt: string;
}

export interface SsoOidcSettingsRecord {
  orgId: string;
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  groupClaim: string;
  adminGroups: string[];
  groupMap: Record<string, string>;
  workspaceGroupMap: Record<string, string>;
  workspaceGroupPrefix: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export class PgIdentityRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async getCurrentUser(userId: string): Promise<UserRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row === undefined ? undefined : toUserRecord(row);
  }

  async listUsers(orgId: string): Promise<UserRecord[]> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.orgId, orgId))
      .orderBy(asc(users.name));
    return rows.map(toUserRecord);
  }

  async createUser(user: UserRecord): Promise<UserRecord> {
    const [row] = await this.db
      .insert(users)
      .values(toUserInsert(user))
      .returning();
    return row === undefined ? user : toUserRecord(row);
  }

  async updateUser(user: UserRecord): Promise<UserRecord> {
    const [row] = await this.db
      .update(users)
      .set({
        disabledAt: optionalDate(user.disabledAt),
        email: user.email,
        name: user.name,
        role: normalizeUserRole(user.role),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();
    return row === undefined ? user : toUserRecord(row);
  }

  async listGroups(orgId: string): Promise<GroupRecord[]> {
    const rows = await this.db
      .select()
      .from(groups)
      .where(eq(groups.orgId, orgId))
      .orderBy(asc(groups.name));
    return rows.map(toGroupRecord);
  }

  async getGroup(groupId: string): Promise<GroupRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    return row === undefined ? undefined : toGroupRecord(row);
  }

  async createGroup(group: GroupRecord): Promise<GroupRecord> {
    const [row] = await this.db
      .insert(groups)
      .values(toGroupInsert(group))
      .onConflictDoNothing({ target: [groups.orgId, groups.slug] })
      .returning();
    if (row !== undefined) return toGroupRecord(row);

    const [existing] = await this.db
      .select()
      .from(groups)
      .where(and(eq(groups.orgId, group.orgId), eq(groups.slug, group.slug)))
      .limit(1);
    return existing === undefined ? group : toGroupRecord(existing);
  }

  async updateGroup(group: GroupRecord): Promise<GroupRecord> {
    const [row] = await this.db
      .update(groups)
      .set({
        name: group.name,
        slug: group.slug,
      })
      .where(eq(groups.id, group.id))
      .returning();
    return row === undefined ? group : toGroupRecord(row);
  }

  async deleteGroup(groupId: string): Promise<GroupRecord | undefined> {
    const [existing] = await this.db
      .select()
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    if (existing === undefined) return undefined;
    await this.db.delete(groups).where(eq(groups.id, groupId));
    return toGroupRecord(existing);
  }

  async listGroupMemberships(
    orgId: string,
    groupId?: string,
    userId?: string,
  ): Promise<GroupMembershipRecord[]> {
    const filters = [
      eq(groupMemberships.orgId, orgId),
      ...(groupId === undefined ? [] : [eq(groupMemberships.groupId, groupId)]),
      ...(userId === undefined ? [] : [eq(groupMemberships.userId, userId)]),
    ];
    const rows = await this.db
      .select()
      .from(groupMemberships)
      .where(and(...filters))
      .orderBy(asc(groupMemberships.groupId), asc(groupMemberships.userId));
    return rows.map(toGroupMembershipRecord);
  }

  async createGroupMembership(
    membership: GroupMembershipRecord,
  ): Promise<GroupMembershipRecord> {
    const [row] = await this.db
      .insert(groupMemberships)
      .values(toGroupMembershipInsert(membership))
      .onConflictDoNothing({
        target: [groupMemberships.groupId, groupMemberships.userId],
      })
      .returning();
    if (row !== undefined) return toGroupMembershipRecord(row);

    const [existing] = await this.db
      .select()
      .from(groupMemberships)
      .where(
        and(
          eq(groupMemberships.groupId, membership.groupId),
          eq(groupMemberships.userId, membership.userId),
        ),
      )
      .limit(1);
    return existing === undefined
      ? membership
      : toGroupMembershipRecord(existing);
  }

  async deleteGroupMembership(
    groupId: string,
    userId: string,
  ): Promise<GroupMembershipRecord | undefined> {
    const [existing] = await this.db
      .select()
      .from(groupMemberships)
      .where(
        and(
          eq(groupMemberships.groupId, groupId),
          eq(groupMemberships.userId, userId),
        ),
      )
      .limit(1);
    if (existing === undefined) return undefined;
    await this.db
      .delete(groupMemberships)
      .where(
        and(
          eq(groupMemberships.groupId, groupId),
          eq(groupMemberships.userId, userId),
        ),
      );
    return toGroupMembershipRecord(existing);
  }

  async getSsoOidcSettings(
    orgId: string,
  ): Promise<SsoOidcSettingsRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(orgSsoOidcSettings)
      .where(eq(orgSsoOidcSettings.orgId, orgId))
      .limit(1);
    return row === undefined ? undefined : toSsoOidcSettingsRecord(row);
  }

  async upsertSsoOidcSettings(
    settings: SsoOidcSettingsRecord,
  ): Promise<SsoOidcSettingsRecord> {
    const [row] = await this.db
      .insert(orgSsoOidcSettings)
      .values(toSsoOidcSettingsInsert(settings))
      .onConflictDoUpdate({
        target: orgSsoOidcSettings.orgId,
        set: {
          adminGroups: settings.adminGroups,
          clientId: settings.clientId,
          enabled: settings.enabled,
          groupClaim: settings.groupClaim,
          groupMap: settings.groupMap,
          issuerUrl: settings.issuerUrl,
          updatedAt: new Date(settings.updatedAt),
          updatedBy: settings.updatedBy,
          workspaceGroupMap: settings.workspaceGroupMap,
          workspaceGroupPrefix: settings.workspaceGroupPrefix,
        },
      })
      .returning();
    return row === undefined ? settings : toSsoOidcSettingsRecord(row);
  }
}

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

function toUserInsert(record: UserRecord): typeof users.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    email: record.email,
    name: record.name,
    role: normalizeUserRole(record.role),
    disabledAt: optionalDate(record.disabledAt),
  };
}

function normalizeUserRole(value: unknown): UserRole {
  return value === "org_admin" || value === "global_admin" ? value : "user";
}

function toGroupInsert(record: GroupRecord): typeof groups.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    name: record.name,
    slug: record.slug,
    createdAt: new Date(record.createdAt),
  };
}

function toGroupMembershipInsert(
  record: GroupMembershipRecord,
): typeof groupMemberships.$inferInsert {
  return {
    groupId: record.groupId,
    userId: record.userId,
    orgId: record.orgId,
    createdAt: new Date(record.createdAt),
  };
}

function toSsoOidcSettingsInsert(
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
