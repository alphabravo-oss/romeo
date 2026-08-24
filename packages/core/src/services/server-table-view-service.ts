import { assertScope, hasWorkspaceAccess, type AuthSubject } from "@romeo/auth";

import type {
  RomeoRepository,
  ServerTableSavedViewRecord,
} from "../domain/repository";
import type { AuditAction } from "../audit-taxonomy";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { inventoriedTableResource } from "./inventoried-table-resources";
import {
  mergeSavedViews,
  migrateLocalSavedView,
  SAVED_VIEW_SCHEMA_VERSION,
  type LocalSavedViewV1,
  type ServerTableSavedView,
} from "./server-table-saved-view";
import {
  allowedSavedViewFields as allowedFields,
  constantTimeSavedViewTokenEqual as constantTimeEqual,
  normalizedSavedViewName as normalizedName,
  publicSavedViewRecord as publicRecord,
  restorableSavedViewBy as restorableBy,
  sameSavedViewScope as sameScope,
  savedViewConflict,
  savedViewUndoTokenHash as undoTokenHash,
  type SavedViewScope,
} from "./server-table-view-support";

const UNDO_WINDOW_MS = 5_000;

export class ServerTableViewService {
  constructor(private readonly repository: RomeoRepository) {}

  async list(
    input: SavedViewScope & {
      subject: AuthSubject;
      localFallback?: LocalSavedViewV1[];
    },
  ): Promise<ServerTableSavedView[]> {
    const allowed = await this.assertAuthority(input);
    const records = await this.repository.listServerTableSavedViews({
      orgId: input.subject.orgId,
      ownerUserId: input.subject.id,
      workspaceId: input.workspaceId,
      resource: input.resource,
      ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
    });
    const localFallback = (input.localFallback ?? []).flatMap((local) => {
      const migrated = migrateLocalSavedView({
        local,
        orgId: input.subject.orgId,
        workspaceId: input.workspaceId,
        ownerUserId: input.subject.id,
        resource: input.resource,
        allowedFields: allowed,
        now: new Date().toISOString(),
      });
      if ("outcome" in migrated) return [];
      return [
        {
          ...migrated,
          ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
        },
      ];
    });
    return mergeSavedViews({
      server: records.flatMap((record) =>
        record.schemaVersion > SAVED_VIEW_SCHEMA_VERSION
          ? []
          : [publicRecord(record)],
      ),
      localFallback,
    });
  }

  async replace(
    input: SavedViewScope & {
      subject: AuthSubject;
      expectedVersion?: number;
      view: LocalSavedViewV1 & {
        viewId?: string;
        visibility?: "private" | "workspace";
        isDefault?: boolean;
      };
    },
  ): Promise<
    ServerTableSavedView | { outcome: "rejected"; code: "saved_view_invalid" }
  > {
    const allowed = await this.assertAuthority(input);
    const now = new Date().toISOString();
    const migrated = migrateLocalSavedView({
      local: input.view,
      orgId: input.subject.orgId,
      workspaceId: input.workspaceId,
      ownerUserId: input.subject.id,
      resource: input.resource,
      allowedFields: allowed,
      now,
    });
    if ("outcome" in migrated) return migrated;
    if (input.view.visibility === "workspace")
      assertScope(input.subject, "admin:write");
    const existing = await this.findOwned(input, migrated.name);
    if (input.view.viewId !== undefined && existing === undefined)
      throw notFound("Saved view");
    const record: ServerTableSavedViewRecord = {
      ...migrated,
      id: existing?.id ?? createId("saved_view"),
      ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
      nameNormalized: normalizedName(migrated.name),
      visibility: input.view.visibility ?? existing?.visibility ?? "private",
      isDefault: input.view.isDefault ?? existing?.isDefault ?? false,
      schemaVersion: SAVED_VIEW_SCHEMA_VERSION,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? migrated.createdAt,
    };
    const result = await this.repository.transaction((repository) =>
      repository.writeServerTableSavedView({
        view: record,
        ...(input.expectedVersion === undefined
          ? existing === undefined
            ? {}
            : { expectedVersion: existing.version }
          : { expectedVersion: input.expectedVersion }),
      }),
    );
    if (result.outcome === "conflict") throw savedViewConflict();
    await this.audit(
      input.subject,
      "admin.table_view.replace",
      record.id,
      input.resource,
    );
    return publicRecord(result.view);
  }

  async remove(
    input: SavedViewScope & {
      subject: AuthSubject;
      viewId: string;
      expectedVersion?: number;
      requestToken?: string;
      now?: string;
    },
  ): Promise<{
    deleted: boolean;
    undoToken?: string;
    undoExpiresAt?: string;
    version?: number;
  }> {
    await this.assertAuthority(input);
    const current = await this.repository.getServerTableSavedView(
      input.subject.orgId,
      input.viewId,
    );
    if (
      current === undefined ||
      current.ownerUserId !== input.subject.id ||
      !sameScope(current, input)
    )
      return { deleted: false };
    if (current.deletedAt !== undefined) {
      if (
        input.requestToken === undefined ||
        current.deleteTokenHash === undefined ||
        current.deleteTokenExpiresAt === undefined
      )
        return { deleted: false };
      const replayHash = undoTokenHash({
        token: input.requestToken,
        orgId: input.subject.orgId,
        ownerUserId: input.subject.id,
        viewId: input.viewId,
        version: current.version,
      });
      if (!constantTimeEqual(replayHash, current.deleteTokenHash))
        throw savedViewConflict();
      return {
        deleted: true,
        undoToken: input.requestToken,
        undoExpiresAt: current.deleteTokenExpiresAt,
        version: current.version,
      };
    }
    const now = input.now ?? new Date().toISOString();
    const undoToken = input.requestToken ?? createId("saved_view_undo");
    const undoExpiresAt = new Date(
      Date.parse(now) + UNDO_WINDOW_MS,
    ).toISOString();
    const result = await this.repository.deleteServerTableSavedView({
      orgId: input.subject.orgId,
      ownerUserId: input.subject.id,
      viewId: input.viewId,
      deletedAt: now,
      deleteTokenHash: undoTokenHash({
        token: undoToken,
        orgId: input.subject.orgId,
        ownerUserId: input.subject.id,
        viewId: input.viewId,
        version: current.version + 1,
      }),
      deleteTokenExpiresAt: undoExpiresAt,
      expectedVersion: input.expectedVersion ?? current.version,
    });
    if (result.outcome === "conflict") throw savedViewConflict();
    if (result.outcome === "not_found") return { deleted: false };
    await this.audit(
      input.subject,
      "admin.table_view.delete",
      input.viewId,
      input.resource,
    );
    return {
      deleted: true,
      undoToken,
      undoExpiresAt,
      version: result.view.version,
    };
  }

  async restore(
    input: SavedViewScope & {
      subject: AuthSubject;
      viewId: string;
      undoToken: string;
      expectedVersion?: number;
      now?: string;
    },
  ): Promise<ServerTableSavedView> {
    await this.assertAuthority(input);
    const current = await this.repository.getServerTableSavedView(
      input.subject.orgId,
      input.viewId,
    );
    if (current === undefined || !restorableBy(current, input))
      throw notFound("Saved view");
    const now = input.now ?? new Date().toISOString();
    if (Date.parse(current.deleteTokenExpiresAt) < Date.parse(now))
      throw savedViewConflict();
    const candidateHash = undoTokenHash({
      token: input.undoToken,
      orgId: input.subject.orgId,
      ownerUserId: input.subject.id,
      viewId: input.viewId,
      version: current.version,
    });
    if (!constantTimeEqual(candidateHash, current.deleteTokenHash))
      throw savedViewConflict();
    const result = await this.repository.restoreServerTableSavedView({
      orgId: input.subject.orgId,
      ownerUserId: input.subject.id,
      viewId: input.viewId,
      deleteTokenHash: candidateHash,
      restoredAt: now,
      expectedVersion: input.expectedVersion ?? current.version,
    });
    if (result.outcome !== "restored") throw savedViewConflict();
    await this.audit(
      input.subject,
      "admin.table_view.restore",
      input.viewId,
      input.resource,
    );
    return publicRecord(result.view);
  }

  async setDefault(
    input: SavedViewScope & {
      subject: AuthSubject;
      viewId: string;
      isDefault: boolean;
      expectedVersion?: number;
    },
  ): Promise<ServerTableSavedView> {
    return this.updateOwned(
      input,
      (view) => ({ ...view, isDefault: input.isDefault }),
      "admin.table_view.default",
    );
  }

  async share(
    input: SavedViewScope & {
      subject: AuthSubject;
      viewId: string;
      visibility: "private" | "workspace";
      expectedVersion?: number;
    },
  ): Promise<ServerTableSavedView> {
    assertScope(input.subject, "admin:write");
    return this.updateOwned(
      input,
      (view) => ({ ...view, visibility: input.visibility }),
      "admin.table_view.share",
    );
  }

  private async updateOwned(
    input: SavedViewScope & {
      subject: AuthSubject;
      viewId: string;
      expectedVersion?: number;
    },
    update: (view: ServerTableSavedViewRecord) => ServerTableSavedViewRecord,
    action: Extract<AuditAction, `admin.table_view.${string}`>,
  ): Promise<ServerTableSavedView> {
    await this.assertAuthority(input);
    const found = await this.ownedRecord(input);
    if (found === undefined) throw notFound("Saved view");
    const now = new Date().toISOString();
    const result = await this.repository.transaction((repository) =>
      repository.writeServerTableSavedView({
        view: {
          ...update(found),
          version: found.version + 1,
          updatedAt: now,
        },
        expectedVersion: input.expectedVersion ?? found.version,
      }),
    );
    if (result.outcome === "conflict") throw savedViewConflict();
    await this.audit(input.subject, action, input.viewId, input.resource);
    return publicRecord(result.view);
  }

  private async assertAuthority(
    input: SavedViewScope & { subject: AuthSubject },
  ) {
    assertScope(input.subject, "workspaces:read");
    const workspace = await this.repository.getWorkspace(input.workspaceId);
    if (
      workspace === undefined ||
      workspace.orgId !== input.subject.orgId ||
      !hasWorkspaceAccess(input.subject, input.workspaceId)
    )
      throw notFound("Workspace");
    const definition = inventoriedTableResource(input.resource);
    const expectsParent = definition?.requiresParent === true;
    if (
      definition === undefined ||
      expectsParent !== (input.parentId !== undefined)
    )
      throw new ApiError(
        "invalid_request",
        "The table resource or parent scope is invalid.",
        400,
      );
    return allowedFields(definition);
  }

  private async findOwned(
    input: SavedViewScope & { subject: AuthSubject; view: { viewId?: string } },
    name: string,
  ): Promise<ServerTableSavedViewRecord | undefined> {
    if (input.view.viewId !== undefined)
      return this.ownedRecord({ ...input, viewId: input.view.viewId });
    return (
      await this.repository.listServerTableSavedViews({
        orgId: input.subject.orgId,
        ownerUserId: input.subject.id,
        workspaceId: input.workspaceId,
        resource: input.resource,
        ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
      })
    ).find(
      (view) =>
        view.ownerUserId === input.subject.id &&
        view.nameNormalized === normalizedName(name),
    );
  }

  private async ownedRecord(
    input: SavedViewScope & { subject: AuthSubject; viewId: string },
  ) {
    const record = await this.repository.getServerTableSavedView(
      input.subject.orgId,
      input.viewId,
    );
    return record?.ownerUserId === input.subject.id &&
      record.deletedAt === undefined &&
      sameScope(record, input)
      ? record
      : undefined;
  }

  private audit(
    subject: AuthSubject,
    action: Extract<AuditAction, `admin.table_view.${string}`>,
    viewId: string,
    resource: string,
  ) {
    return writeAuditLog(this.repository, {
      subject,
      action,
      resourceType: "table_view",
      resourceId: viewId,
      metadata: {
        resource,
        ...(action === "admin.table_view.replace" ? { source: "server" } : {}),
      },
    });
  }
}
