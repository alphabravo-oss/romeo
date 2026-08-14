import { assertScope, hasWorkspaceAccess, type AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import {
  mergeSavedViews,
  migrateLocalSavedView,
  SAVED_VIEW_SCHEMA,
  type LocalSavedViewV1,
  type ServerTableSavedView,
} from "./server-table-saved-view";

const SCHEMA = "romeo.server-table-view-store.v2";

export const TABLE_VIEW_ALLOWED_FIELDS: Record<string, readonly string[]> = {
  audit_logs: ["createdAt", "action", "category", "outcome"],
  usage_events: ["createdAt", "metric"],
};

const DEFAULT_TABLE_FIELDS = ["createdAt", "id", "name"] as const;

export class ServerTableViewService {
  constructor(private readonly repository: RomeoRepository) {}

  async list(input: {
    subject: AuthSubject;
    workspaceId: string;
    resource: string;
    localFallback?: LocalSavedViewV1[];
  }): Promise<ServerTableSavedView[]> {
    await this.assertWorkspace(input.subject, input.workspaceId);
    const server = await this.read(
      input.subject.orgId,
      input.workspaceId,
      input.subject.id,
      input.resource,
    );
    const allowed = new Set(
      TABLE_VIEW_ALLOWED_FIELDS[input.resource] ?? DEFAULT_TABLE_FIELDS,
    );
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
      return "outcome" in migrated ? [] : [migrated];
    });
    return mergeSavedViews({ server, localFallback });
  }

  async replace(input: {
    subject: AuthSubject;
    workspaceId: string;
    resource: string;
    view: LocalSavedViewV1;
  }): Promise<
    ServerTableSavedView | { outcome: "rejected"; code: "saved_view_invalid" }
  > {
    await this.assertWorkspace(input.subject, input.workspaceId);
    const now = new Date().toISOString();
    const migrated = migrateLocalSavedView({
      local: input.view,
      orgId: input.subject.orgId,
      workspaceId: input.workspaceId,
      ownerUserId: input.subject.id,
      resource: input.resource,
      allowedFields: new Set(
        TABLE_VIEW_ALLOWED_FIELDS[input.resource] ?? DEFAULT_TABLE_FIELDS,
      ),
      now,
    });
    if ("outcome" in migrated) return migrated;
    const stored: ServerTableSavedView = {
      ...migrated,
      id: createId("saved_view"),
      source: "server",
    };
    const current = await this.read(
      input.subject.orgId,
      input.workspaceId,
      input.subject.id,
      input.resource,
    );
    const next = [
      ...current.filter((view) => view.name !== stored.name),
      stored,
    ];
    await this.save(
      input.subject.orgId,
      input.workspaceId,
      input.subject.id,
      input.resource,
      next,
      now,
    );
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action: "admin.table_view.replace",
      resourceType: "table_view",
      resourceId: stored.id,
      metadata: { resource: input.resource, source: "server" },
    });
    return stored;
  }

  async remove(input: {
    subject: AuthSubject;
    workspaceId: string;
    resource: string;
    viewId: string;
  }): Promise<void> {
    await this.assertWorkspace(input.subject, input.workspaceId);
    const current = await this.read(
      input.subject.orgId,
      input.workspaceId,
      input.subject.id,
      input.resource,
    );
    const remaining = current.filter((view) => view.id !== input.viewId);
    if (remaining.length === current.length) throw notFound("Saved view");
    await this.save(
      input.subject.orgId,
      input.workspaceId,
      input.subject.id,
      input.resource,
      remaining,
      new Date().toISOString(),
    );
  }

  private async assertWorkspace(subject: AuthSubject, workspaceId: string) {
    assertScope(subject, "workspaces:read");
    const workspace = await this.repository.getWorkspace(workspaceId);
    if (
      workspace === undefined ||
      workspace.orgId !== subject.orgId ||
      !hasWorkspaceAccess(subject, workspaceId)
    )
      throw notFound("Workspace");
  }

  private async read(
    orgId: string,
    workspaceId: string,
    ownerUserId: string,
    resource: string,
  ): Promise<ServerTableSavedView[]> {
    const value = (
      await this.repository.getSystemSetting(
        storeKey(orgId, workspaceId, ownerUserId, resource),
      )
    )?.value;
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return [];
    const candidate = value as Record<string, unknown>;
    if (candidate.schema !== SCHEMA || !Array.isArray(candidate.views))
      return [];
    return candidate.views.filter(
      (view): view is ServerTableSavedView =>
        typeof view === "object" &&
        view !== null &&
        (view as ServerTableSavedView).schema === SAVED_VIEW_SCHEMA,
    );
  }

  private async save(
    orgId: string,
    workspaceId: string,
    ownerUserId: string,
    resource: string,
    views: ServerTableSavedView[],
    updatedAt: string,
  ): Promise<void> {
    await this.repository.upsertSystemSetting({
      key: storeKey(orgId, workspaceId, ownerUserId, resource),
      value: { schema: SCHEMA, orgId, views },
      updatedAt,
    });
  }
}

function storeKey(
  orgId: string,
  workspaceId: string,
  ownerUserId: string,
  resource: string,
): string {
  return `table_view.v2:${orgId}:${workspaceId}:${ownerUserId}:${resource}`;
}
