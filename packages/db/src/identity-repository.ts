import type { QueryUsersInput, UserTableQueryResult } from "@romeo/core";
import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { queryIdentityUsers } from "./identity-user-query";

import type { RomeoDatabase } from "./client";
import { groupMemberships, groups, orgSsoOidcSettings, users } from "./schema";
import { optionalDate } from "./repository-mapping";
import { containsPattern } from "./like-pattern";
import {
  normalizeUserRole,
  toGroupInsert,
  toGroupMembershipInsert,
  toGroupMembershipRecord,
  toGroupRecord,
  toSsoOidcSettingsInsert,
  toSsoOidcSettingsRecord,
  toUserInsert,
  toUserRecord,
} from "./identity-record-mappers";

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

  async listUsersPage(
    orgId: string,
    input: {
      direction?: "asc" | "desc";
      limit: number;
      offset: number;
      query?: string;
      sort?: "email" | "name" | "role" | "status";
    },
  ): Promise<{
    activeGlobalAdminTotal: number;
    adminTotal: number;
    disabledTotal: number;
    items: UserRecord[];
    total: number;
    userTotal: number;
  }> {
    const query = input.query?.trim();
    const predicate = and(
      eq(users.orgId, orgId),
      query === undefined || query === ""
        ? undefined
        : or(
            ilike(users.name, containsPattern(query)),
            ilike(users.email, containsPattern(query)),
          ),
    );
    const sortColumn =
      input.sort === "email"
        ? users.email
        : input.sort === "role"
          ? users.role
          : input.sort === "status"
            ? users.disabledAt
            : users.name;
    const order = input.direction === "desc" ? desc : asc;
    const [rows, totals, stats] = await Promise.all([
      this.db
        .select()
        .from(users)
        .where(predicate)
        .orderBy(order(sortColumn), order(users.id))
        .limit(input.limit)
        .offset(input.offset),
      this.db.select({ value: count() }).from(users).where(predicate),
      this.db
        .select({
          activeGlobalAdminTotal:
            sql<number>`count(*) filter (where ${users.role} = 'global_admin' and ${users.disabledAt} is null)`.mapWith(
              Number,
            ),
          adminTotal:
            sql<number>`count(*) filter (where ${users.role} <> 'user')`.mapWith(
              Number,
            ),
          disabledTotal:
            sql<number>`count(*) filter (where ${users.disabledAt} is not null)`.mapWith(
              Number,
            ),
          userTotal: count(),
        })
        .from(users)
        .where(eq(users.orgId, orgId)),
    ]);
    return {
      activeGlobalAdminTotal: stats[0]?.activeGlobalAdminTotal ?? 0,
      adminTotal: stats[0]?.adminTotal ?? 0,
      disabledTotal: stats[0]?.disabledTotal ?? 0,
      items: rows.map(toUserRecord),
      total: totals[0]?.value ?? 0,
      userTotal: stats[0]?.userTotal ?? 0,
    };
  }

  async queryUsers(
    orgId: string,
    input: QueryUsersInput,
  ): Promise<UserTableQueryResult> {
    return queryIdentityUsers(this.db, orgId, input);
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

  async listGroupMembershipsBySource(
    orgId: string,
    userId: string,
    source: string,
  ): Promise<GroupMembershipRecord[]> {
    const rows = await this.db
      .select()
      .from(groupMemberships)
      .where(
        and(
          eq(groupMemberships.orgId, orgId),
          eq(groupMemberships.userId, userId),
          eq(groupMemberships.source, source),
        ),
      )
      .orderBy(asc(groupMemberships.groupId));
    return rows.map(toGroupMembershipRecord);
  }

  async createGroupMembership(
    membership: GroupMembershipRecord,
    options: { source?: string } = {},
  ): Promise<GroupMembershipRecord> {
    const [row] = await this.db
      .insert(groupMemberships)
      .values({
        ...toGroupMembershipInsert(membership),
        source: options.source ?? null,
      })
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

  async listEnabledSsoOidcSettingsByIssuer(
    issuerUrl: string,
  ): Promise<SsoOidcSettingsRecord[]> {
    const issuer = issuerUrl.replace(/\/+$/u, "");
    if (issuer.length === 0) return [];
    const rows = await this.db
      .select()
      .from(orgSsoOidcSettings)
      .where(
        and(
          eq(orgSsoOidcSettings.enabled, true),
          or(
            eq(orgSsoOidcSettings.issuerUrl, issuer),
            eq(orgSsoOidcSettings.issuerUrl, `${issuer}/`),
          ),
        ),
      )
      .orderBy(asc(orgSsoOidcSettings.orgId));
    return rows.map(toSsoOidcSettingsRecord);
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

export {
  toGroupMembershipRecord,
  toGroupRecord,
  toSsoOidcSettingsRecord,
  toUserRecord,
} from "./identity-record-mappers";
