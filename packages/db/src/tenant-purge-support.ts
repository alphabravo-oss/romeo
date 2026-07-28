import { eq, inArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  chats,
  messages,
  providerInstances,
  roles,
  runs,
  users,
} from "./schema";

export interface TenantPurgeContext {
  messageIds: string[];
  providerIds: string[];
  roleIds: string[];
  runIds: string[];
  userIds: string[];
}

export interface TenantPurgeState {
  context: TenantPurgeContext;
  counts: Record<string, number>;
  database: RomeoDatabase;
  orgId: string;
}

export async function tenantPurgeContext(
  db: RomeoDatabase,
  orgId: string,
): Promise<{
  messageIds: string[];
  providerIds: string[];
  roleIds: string[];
  runIds: string[];
  userIds: string[];
}> {
  const [messageRows, providerRows, roleRows, runRows, userRows] =
    await Promise.all([
      db
        .select({ id: messages.id })
        .from(messages)
        .innerJoin(chats, eq(messages.chatId, chats.id))
        .where(eq(chats.orgId, orgId)),
      db
        .select({ id: providerInstances.id })
        .from(providerInstances)
        .where(eq(providerInstances.orgId, orgId)),
      db.select({ id: roles.id }).from(roles).where(eq(roles.orgId, orgId)),
      db.select({ id: runs.id }).from(runs).where(eq(runs.orgId, orgId)),
      db.select({ id: users.id }).from(users).where(eq(users.orgId, orgId)),
    ]);
  return {
    messageIds: messageRows.map((row) => row.id),
    providerIds: providerRows.map((row) => row.id),
    roleIds: roleRows.map((row) => row.id),
    runIds: runRows.map((row) => row.id),
    userIds: userRows.map((row) => row.id),
  };
}

export async function deleteByIds(
  db: RomeoDatabase,
  counts: Record<string, number>,
  label: string,
  table: Parameters<RomeoDatabase["delete"]>[0],
  column: SQLWrapper,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) {
    counts[label] = 0;
    return;
  }
  await deleteWhere(db, counts, label, table, inArray(column, ids));
}

export async function deleteWhere(
  db: RomeoDatabase,
  counts: Record<string, number>,
  label: string,
  table: Parameters<RomeoDatabase["delete"]>[0],
  where: SQL | undefined,
): Promise<void> {
  if (where === undefined) {
    counts[label] = 0;
    return;
  }
  const deleted = await db
    .delete(table)
    .where(where)
    .returning({ deleted: sql<number>`1` });
  counts[label] = deleted.length;
}

export function orgScopedSystemSettingKeys(orgId: string): string[] {
  const encodedOrgId = encodeURIComponent(orgId);
  return [
    `abuse_controls.org.v1:${orgId}`,
    `auth_provider_settings.org.v1:${orgId}`,
    `governance.data_export_packages.${encodedOrgId}`,
    `notification_policy.org.v1:${orgId}`,
    `rag_policy.change_request.org.v1:${orgId}`,
    `rag_policy.org.v1:${orgId}`,
    `tenant_lifecycle.deletion_finalization_evidence.v1:${orgId}`,
    `tenant_lifecycle.deletion_request.v1:${orgId}`,
    `web_search.org.v1:${orgId}`,
    `web_search.health.v1:${orgId}`,
  ];
}
