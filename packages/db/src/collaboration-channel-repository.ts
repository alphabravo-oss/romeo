import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { collaborationChannelMembers, collaborationChannels } from "./schema";
import {
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";

export interface CollaborationChannelRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  userId: string;
  type?: string;
  name: string;
  description?: string;
  isPrivate?: boolean;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
  archivedAt?: string;
  archivedBy?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface CollaborationChannelMemberRecord {
  id: string;
  orgId: string;
  channelId: string;
  userId: string;
  role?: string;
  status?: string;
  isActive: boolean;
  isChannelMuted: boolean;
  isChannelPinned: boolean;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  invitedAt?: string;
  invitedBy?: string;
  joinedAt: string;
  leftAt?: string;
  lastReadAt?: string;
  createdAt: string;
  updatedAt: string;
}

export class PgCollaborationChannelRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listCollaborationChannels(
    orgId: string,
  ): Promise<CollaborationChannelRecord[]> {
    const rows = await this.db
      .select()
      .from(collaborationChannels)
      .where(eq(collaborationChannels.orgId, orgId))
      .orderBy(
        desc(collaborationChannels.updatedAt),
        asc(collaborationChannels.id),
      );
    return rows.map(toCollaborationChannelRecord);
  }

  async getCollaborationChannel(
    channelId: string,
  ): Promise<CollaborationChannelRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(collaborationChannels)
      .where(eq(collaborationChannels.id, channelId))
      .limit(1);
    return row === undefined ? undefined : toCollaborationChannelRecord(row);
  }

  async createCollaborationChannel(
    channel: CollaborationChannelRecord,
  ): Promise<CollaborationChannelRecord> {
    const [row] = await this.db
      .insert(collaborationChannels)
      .values(toCollaborationChannelInsert(channel))
      .returning();
    return row === undefined ? channel : toCollaborationChannelRecord(row);
  }

  async updateCollaborationChannel(
    channel: CollaborationChannelRecord,
  ): Promise<CollaborationChannelRecord> {
    const [row] = await this.db
      .update(collaborationChannels)
      .set(toCollaborationChannelUpdate(channel))
      .where(eq(collaborationChannels.id, channel.id))
      .returning();
    return row === undefined ? channel : toCollaborationChannelRecord(row);
  }

  async deleteCollaborationChannel(
    channelId: string,
  ): Promise<CollaborationChannelRecord | undefined> {
    const [row] = await this.db
      .delete(collaborationChannels)
      .where(eq(collaborationChannels.id, channelId))
      .returning();
    return row === undefined ? undefined : toCollaborationChannelRecord(row);
  }

  async listCollaborationChannelMembers(
    orgId: string,
    channelId?: string,
    userId?: string,
  ): Promise<CollaborationChannelMemberRecord[]> {
    const filters: SQL[] = [eq(collaborationChannelMembers.orgId, orgId)];
    if (channelId !== undefined) {
      filters.push(eq(collaborationChannelMembers.channelId, channelId));
    }
    if (userId !== undefined) {
      filters.push(eq(collaborationChannelMembers.userId, userId));
    }
    const rows = await this.db
      .select()
      .from(collaborationChannelMembers)
      .where(and(...filters))
      .orderBy(
        asc(collaborationChannelMembers.channelId),
        asc(collaborationChannelMembers.userId),
      );
    return rows.map(toCollaborationChannelMemberRecord);
  }

  async getCollaborationChannelMember(
    channelId: string,
    userId: string,
  ): Promise<CollaborationChannelMemberRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(collaborationChannelMembers)
      .where(
        and(
          eq(collaborationChannelMembers.channelId, channelId),
          eq(collaborationChannelMembers.userId, userId),
        ),
      )
      .limit(1);
    return row === undefined
      ? undefined
      : toCollaborationChannelMemberRecord(row);
  }

  async createCollaborationChannelMember(
    member: CollaborationChannelMemberRecord,
  ): Promise<CollaborationChannelMemberRecord> {
    const [row] = await this.db
      .insert(collaborationChannelMembers)
      .values(toCollaborationChannelMemberInsert(member))
      .onConflictDoUpdate({
        target: [
          collaborationChannelMembers.orgId,
          collaborationChannelMembers.channelId,
          collaborationChannelMembers.userId,
        ],
        set: toCollaborationChannelMemberUpdate(member),
      })
      .returning();
    return row === undefined ? member : toCollaborationChannelMemberRecord(row);
  }

  async updateCollaborationChannelMember(
    member: CollaborationChannelMemberRecord,
  ): Promise<CollaborationChannelMemberRecord> {
    const [row] = await this.db
      .update(collaborationChannelMembers)
      .set(toCollaborationChannelMemberUpdate(member))
      .where(eq(collaborationChannelMembers.id, member.id))
      .returning();
    return row === undefined ? member : toCollaborationChannelMemberRecord(row);
  }

  async deleteCollaborationChannelMembers(
    channelId: string,
    userIds: string[],
  ): Promise<CollaborationChannelMemberRecord[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db
      .delete(collaborationChannelMembers)
      .where(
        and(
          eq(collaborationChannelMembers.channelId, channelId),
          inArray(collaborationChannelMembers.userId, userIds),
        ),
      )
      .returning();
    return rows.map(toCollaborationChannelMemberRecord);
  }
}

export function toCollaborationChannelRecord(
  row: typeof collaborationChannels.$inferSelect,
): CollaborationChannelRecord {
  const record: CollaborationChannelRecord = {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    userId: row.userId,
    name: row.name,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  if (row.type !== null) record.type = row.type;
  if (row.description !== null) record.description = row.description;
  if (row.isPrivate !== null) record.isPrivate = row.isPrivate;
  if (row.data !== null) record.data = row.data;
  if (row.meta !== null) record.meta = row.meta;
  if (row.updatedBy !== null) record.updatedBy = row.updatedBy;
  const archivedAt = optionalIsoString(row.archivedAt);
  if (archivedAt !== undefined) record.archivedAt = archivedAt;
  if (row.archivedBy !== null) record.archivedBy = row.archivedBy;
  const deletedAt = optionalIsoString(row.deletedAt);
  if (deletedAt !== undefined) record.deletedAt = deletedAt;
  if (row.deletedBy !== null) record.deletedBy = row.deletedBy;
  return record;
}

export function toCollaborationChannelMemberRecord(
  row: typeof collaborationChannelMembers.$inferSelect,
): CollaborationChannelMemberRecord {
  const record: CollaborationChannelMemberRecord = {
    id: row.id,
    orgId: row.orgId,
    channelId: row.channelId,
    userId: row.userId,
    isActive: row.isActive,
    isChannelMuted: row.isChannelMuted,
    isChannelPinned: row.isChannelPinned,
    joinedAt: toIsoString(row.joinedAt),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  if (row.role !== null) record.role = row.role;
  if (row.status !== null) record.status = row.status;
  if (row.data !== null) record.data = row.data;
  if (row.meta !== null) record.meta = row.meta;
  const invitedAt = optionalIsoString(row.invitedAt);
  if (invitedAt !== undefined) record.invitedAt = invitedAt;
  if (row.invitedBy !== null) record.invitedBy = row.invitedBy;
  const leftAt = optionalIsoString(row.leftAt);
  if (leftAt !== undefined) record.leftAt = leftAt;
  const lastReadAt = optionalIsoString(row.lastReadAt);
  if (lastReadAt !== undefined) record.lastReadAt = lastReadAt;
  return record;
}

function toCollaborationChannelInsert(
  record: CollaborationChannelRecord,
): typeof collaborationChannels.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    userId: record.userId,
    type: record.type ?? null,
    name: record.name,
    description: record.description ?? null,
    isPrivate: record.isPrivate ?? null,
    data: record.data ?? null,
    meta: record.meta ?? null,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    updatedBy: record.updatedBy ?? null,
    archivedAt: optionalDate(record.archivedAt),
    archivedBy: record.archivedBy ?? null,
    deletedAt: optionalDate(record.deletedAt),
    deletedBy: record.deletedBy ?? null,
  };
}

function toCollaborationChannelUpdate(
  record: CollaborationChannelRecord,
): Partial<typeof collaborationChannels.$inferInsert> {
  return {
    type: record.type ?? null,
    name: record.name,
    description: record.description ?? null,
    isPrivate: record.isPrivate ?? null,
    data: record.data ?? null,
    meta: record.meta ?? null,
    updatedAt: new Date(record.updatedAt),
    updatedBy: record.updatedBy ?? null,
    archivedAt: optionalDate(record.archivedAt),
    archivedBy: record.archivedBy ?? null,
    deletedAt: optionalDate(record.deletedAt),
    deletedBy: record.deletedBy ?? null,
  };
}

function toCollaborationChannelMemberInsert(
  record: CollaborationChannelMemberRecord,
): typeof collaborationChannelMembers.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    channelId: record.channelId,
    userId: record.userId,
    role: record.role ?? null,
    status: record.status ?? null,
    isActive: record.isActive,
    isChannelMuted: record.isChannelMuted,
    isChannelPinned: record.isChannelPinned,
    data: record.data ?? null,
    meta: record.meta ?? null,
    invitedAt: optionalDate(record.invitedAt),
    invitedBy: record.invitedBy ?? null,
    joinedAt: new Date(record.joinedAt),
    leftAt: optionalDate(record.leftAt),
    lastReadAt: optionalDate(record.lastReadAt),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function toCollaborationChannelMemberUpdate(
  record: CollaborationChannelMemberRecord,
): Partial<typeof collaborationChannelMembers.$inferInsert> {
  return {
    role: record.role ?? null,
    status: record.status ?? null,
    isActive: record.isActive,
    isChannelMuted: record.isChannelMuted,
    isChannelPinned: record.isChannelPinned,
    data: record.data ?? null,
    meta: record.meta ?? null,
    invitedAt: optionalDate(record.invitedAt),
    invitedBy: record.invitedBy ?? null,
    joinedAt: new Date(record.joinedAt),
    leftAt: optionalDate(record.leftAt),
    lastReadAt: optionalDate(record.lastReadAt),
    updatedAt: new Date(record.updatedAt),
  };
}
