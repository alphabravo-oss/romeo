import type {
  DeleteServerTableSavedViewResult,
  ListServerTableSavedViewsInput,
  RestoreServerTableSavedViewResult,
  ServerTableSavedViewRecord,
  WriteServerTableSavedViewResult,
} from "@romeo/core";
import { and, asc, eq, isNull, ne, or } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";
import { serverTableSavedViews } from "./schema";

export class PgServerTableRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listServerTableSavedViews(
    input: ListServerTableSavedViewsInput,
  ): Promise<ServerTableSavedViewRecord[]> {
    const rows = await this.db
      .select()
      .from(serverTableSavedViews)
      .where(
        and(
          eq(serverTableSavedViews.orgId, input.orgId),
          eq(serverTableSavedViews.workspaceId, input.workspaceId),
          eq(serverTableSavedViews.resource, input.resource),
          eq(serverTableSavedViews.parentScopeKey, input.parentId ?? ""),
          isNull(serverTableSavedViews.deletedAt),
          or(
            eq(serverTableSavedViews.ownerUserId, input.ownerUserId),
            eq(serverTableSavedViews.visibility, "workspace"),
          ),
        ),
      )
      .orderBy(
        asc(serverTableSavedViews.nameNormalized),
        asc(serverTableSavedViews.id),
      );
    return rows.map(toServerTableSavedViewRecord);
  }

  async getServerTableSavedView(
    orgId: string,
    viewId: string,
  ): Promise<ServerTableSavedViewRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(serverTableSavedViews)
      .where(
        and(
          eq(serverTableSavedViews.orgId, orgId),
          eq(serverTableSavedViews.id, viewId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toServerTableSavedViewRecord(row);
  }

  async writeServerTableSavedView(input: {
    view: ServerTableSavedViewRecord;
    expectedVersion?: number;
  }): Promise<WriteServerTableSavedViewResult> {
    const current = await this.getServerTableSavedView(
      input.view.orgId,
      input.view.id,
    );
    if (
      input.expectedVersion !== undefined &&
      current?.version !== input.expectedVersion
    )
      return { outcome: "conflict" };
    if (await this.hasActiveNameConflict(input.view))
      return { outcome: "conflict" };
    if (input.view.isDefault) await this.clearOtherDefaults(input.view);

    const row =
      current === undefined
        ? (
            await this.db
              .insert(serverTableSavedViews)
              .values(toServerTableSavedViewInsert(input.view))
              .onConflictDoNothing()
              .returning()
          )[0]
        : (
            await this.db
              .update(serverTableSavedViews)
              .set(toServerTableSavedViewUpdate(input.view))
              .where(
                and(
                  eq(serverTableSavedViews.orgId, input.view.orgId),
                  eq(serverTableSavedViews.id, input.view.id),
                  eq(serverTableSavedViews.version, current.version),
                ),
              )
              .returning()
          )[0];
    return row === undefined
      ? { outcome: "conflict" }
      : { outcome: "stored", view: toServerTableSavedViewRecord(row) };
  }

  async deleteServerTableSavedView(input: {
    orgId: string;
    viewId: string;
    ownerUserId: string;
    expectedVersion?: number;
    deletedAt: string;
    deleteTokenHash: string;
    deleteTokenExpiresAt: string;
  }): Promise<DeleteServerTableSavedViewResult> {
    const current = await this.getServerTableSavedView(
      input.orgId,
      input.viewId,
    );
    if (current === undefined || current.ownerUserId !== input.ownerUserId)
      return { outcome: "not_found" };
    if (current.deletedAt !== undefined)
      return current.deleteTokenHash === input.deleteTokenHash
        ? { outcome: "already_deleted", view: current }
        : { outcome: "conflict" };
    if (
      input.expectedVersion !== undefined &&
      current.version !== input.expectedVersion
    )
      return { outcome: "conflict" };
    const [row] = await this.db
      .update(serverTableSavedViews)
      .set({
        deletedAt: new Date(input.deletedAt),
        deleteTokenHash: input.deleteTokenHash,
        deleteTokenExpiresAt: new Date(input.deleteTokenExpiresAt),
        deletedWasDefault: current.isDefault,
        isDefault: false,
        updatedAt: new Date(input.deletedAt),
        version: current.version + 1,
      })
      .where(
        and(
          eq(serverTableSavedViews.orgId, input.orgId),
          eq(serverTableSavedViews.id, input.viewId),
          eq(serverTableSavedViews.ownerUserId, input.ownerUserId),
          eq(serverTableSavedViews.version, current.version),
          isNull(serverTableSavedViews.deletedAt),
        ),
      )
      .returning();
    return row === undefined
      ? { outcome: "conflict" }
      : { outcome: "deleted", view: toServerTableSavedViewRecord(row) };
  }

  async restoreServerTableSavedView(input: {
    orgId: string;
    viewId: string;
    ownerUserId: string;
    deleteTokenHash: string;
    expectedVersion?: number;
    restoredAt: string;
  }): Promise<RestoreServerTableSavedViewResult> {
    const current = await this.getServerTableSavedView(
      input.orgId,
      input.viewId,
    );
    if (current === undefined || current.ownerUserId !== input.ownerUserId)
      return { outcome: "not_found" };
    if (current.deletedAt === undefined) return { outcome: "conflict" };
    if (
      current.deleteTokenHash !== input.deleteTokenHash ||
      current.deleteTokenExpiresAt === undefined ||
      Date.parse(current.deleteTokenExpiresAt) < Date.parse(input.restoredAt) ||
      (input.expectedVersion !== undefined &&
        current.version !== input.expectedVersion) ||
      (await this.hasActiveNameConflict(current))
    )
      return { outcome: "conflict" };
    if (current.deletedWasDefault === true)
      await this.clearOtherDefaults(current);
    const [row] = await this.db
      .update(serverTableSavedViews)
      .set({
        deletedAt: null,
        deleteTokenHash: null,
        deleteTokenExpiresAt: null,
        deletedWasDefault: null,
        isDefault: current.deletedWasDefault === true,
        updatedAt: new Date(input.restoredAt),
        version: current.version + 1,
      })
      .where(
        and(
          eq(serverTableSavedViews.orgId, input.orgId),
          eq(serverTableSavedViews.id, input.viewId),
          eq(serverTableSavedViews.ownerUserId, input.ownerUserId),
          eq(serverTableSavedViews.version, current.version),
          eq(serverTableSavedViews.deleteTokenHash, input.deleteTokenHash),
        ),
      )
      .returning();
    return row === undefined
      ? { outcome: "conflict" }
      : { outcome: "restored", view: toServerTableSavedViewRecord(row) };
  }

  private async clearOtherDefaults(view: ServerTableSavedViewRecord) {
    await this.db
      .update(serverTableSavedViews)
      .set({ isDefault: false, updatedAt: new Date(view.updatedAt) })
      .where(
        and(
          eq(serverTableSavedViews.orgId, view.orgId),
          eq(serverTableSavedViews.workspaceId, view.workspaceId),
          eq(serverTableSavedViews.ownerUserId, view.ownerUserId),
          eq(serverTableSavedViews.resource, view.resource),
          eq(serverTableSavedViews.parentScopeKey, view.parentId ?? ""),
          ne(serverTableSavedViews.id, view.id),
          eq(serverTableSavedViews.isDefault, true),
          isNull(serverTableSavedViews.deletedAt),
        ),
      );
  }

  private async hasActiveNameConflict(
    view: ServerTableSavedViewRecord,
  ): Promise<boolean> {
    const [conflict] = await this.db
      .select({ id: serverTableSavedViews.id })
      .from(serverTableSavedViews)
      .where(
        and(
          eq(serverTableSavedViews.orgId, view.orgId),
          eq(serverTableSavedViews.workspaceId, view.workspaceId),
          eq(serverTableSavedViews.ownerUserId, view.ownerUserId),
          eq(serverTableSavedViews.resource, view.resource),
          eq(serverTableSavedViews.parentScopeKey, view.parentId ?? ""),
          eq(serverTableSavedViews.nameNormalized, view.nameNormalized),
          ne(serverTableSavedViews.id, view.id),
          isNull(serverTableSavedViews.deletedAt),
        ),
      )
      .limit(1);
    return conflict !== undefined;
  }
}

function toServerTableSavedViewRecord(
  row: typeof serverTableSavedViews.$inferSelect,
): ServerTableSavedViewRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    ownerUserId: row.ownerUserId,
    resource: row.resource,
    ...(row.parentId === null ? {} : { parentId: row.parentId }),
    name: row.name,
    nameNormalized: row.nameNormalized,
    query: row.query,
    presentation: row.presentation,
    visibility: row.visibility === "workspace" ? "workspace" : "private",
    isDefault: row.isDefault,
    schemaVersion: row.schemaVersion,
    version: row.version,
    ...(row.deleteTokenHash === null
      ? {}
      : { deleteTokenHash: row.deleteTokenHash }),
    ...(optionalIsoString(row.deleteTokenExpiresAt) === undefined
      ? {}
      : { deleteTokenExpiresAt: optionalIsoString(row.deleteTokenExpiresAt)! }),
    ...(row.deletedWasDefault === null
      ? {}
      : { deletedWasDefault: row.deletedWasDefault }),
    ...(optionalIsoString(row.deletedAt) === undefined
      ? {}
      : { deletedAt: optionalIsoString(row.deletedAt)! }),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function toServerTableSavedViewInsert(view: ServerTableSavedViewRecord) {
  return {
    id: view.id,
    orgId: view.orgId,
    workspaceId: view.workspaceId,
    ownerUserId: view.ownerUserId,
    resource: view.resource,
    parentId: view.parentId ?? null,
    parentScopeKey: view.parentId ?? "",
    name: view.name,
    nameNormalized: view.nameNormalized,
    query: view.query,
    presentation: view.presentation,
    visibility: view.visibility,
    isDefault: view.isDefault,
    schemaVersion: view.schemaVersion,
    version: view.version,
    deleteTokenHash: view.deleteTokenHash ?? null,
    deleteTokenExpiresAt: optionalDate(view.deleteTokenExpiresAt),
    deletedWasDefault: view.deletedWasDefault ?? null,
    deletedAt: optionalDate(view.deletedAt),
    createdAt: new Date(view.createdAt),
    updatedAt: new Date(view.updatedAt),
  } satisfies typeof serverTableSavedViews.$inferInsert;
}

function toServerTableSavedViewUpdate(view: ServerTableSavedViewRecord) {
  const insert = toServerTableSavedViewInsert(view);
  const { id: _id, orgId: _orgId, createdAt: _createdAt, ...update } = insert;
  return update;
}
