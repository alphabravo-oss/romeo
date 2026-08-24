import type * as E from "../domain/entities";
import type * as R from "../domain/repository";
import { InMemoryIdempotencyRepository } from "./in-memory-idempotency";

export abstract class InMemoryServerTableRepository extends InMemoryIdempotencyRepository {
  async listServerTableSavedViews(
    input: R.ListServerTableSavedViewsInput,
  ): Promise<E.ServerTableSavedViewRecord[]> {
    return this.data.serverTableSavedViews
      .filter(
        (view) =>
          view.orgId === input.orgId &&
          view.workspaceId === input.workspaceId &&
          view.resource === input.resource &&
          view.parentId === input.parentId &&
          view.deletedAt === undefined &&
          (view.ownerUserId === input.ownerUserId ||
            view.visibility === "workspace"),
      )
      .sort((left, right) =>
        left.nameNormalized === right.nameNormalized
          ? left.id.localeCompare(right.id)
          : left.nameNormalized.localeCompare(right.nameNormalized),
      );
  }

  async getServerTableSavedView(
    orgId: string,
    viewId: string,
  ): Promise<E.ServerTableSavedViewRecord | undefined> {
    return this.data.serverTableSavedViews.find(
      (view) => view.orgId === orgId && view.id === viewId,
    );
  }

  async writeServerTableSavedView(input: {
    view: E.ServerTableSavedViewRecord;
    expectedVersion?: number;
  }): Promise<R.WriteServerTableSavedViewResult> {
    const current = this.data.serverTableSavedViews.find(
      (view) => view.id === input.view.id && view.orgId === input.view.orgId,
    );
    if (
      input.expectedVersion !== undefined &&
      current?.version !== input.expectedVersion
    )
      return { outcome: "conflict" };
    if (this.hasActiveNameConflict(input.view)) return { outcome: "conflict" };
    if (input.view.isDefault) this.clearOtherDefaults(input.view);
    if (current === undefined) this.data.serverTableSavedViews.push(input.view);
    else
      this.data.serverTableSavedViews = this.data.serverTableSavedViews.map(
        (view) =>
          view.id === input.view.id && view.orgId === input.view.orgId
            ? input.view
            : view,
      );
    return { outcome: "stored", view: input.view };
  }

  async deleteServerTableSavedView(
    input: Parameters<
      R.RepositoryOperationsCapability["deleteServerTableSavedView"]
    >[0],
  ): Promise<R.DeleteServerTableSavedViewResult> {
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
    const deleted = {
      ...current,
      deletedAt: input.deletedAt,
      deleteTokenHash: input.deleteTokenHash,
      deleteTokenExpiresAt: input.deleteTokenExpiresAt,
      deletedWasDefault: current.isDefault,
      isDefault: false,
      version: current.version + 1,
      updatedAt: input.deletedAt,
    };
    this.data.serverTableSavedViews = this.data.serverTableSavedViews.map(
      (view) => (view.id === current.id ? deleted : view),
    );
    return { outcome: "deleted", view: deleted };
  }

  async restoreServerTableSavedView(
    input: Parameters<
      R.RepositoryOperationsCapability["restoreServerTableSavedView"]
    >[0],
  ): Promise<R.RestoreServerTableSavedViewResult> {
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
      this.hasActiveNameConflict(current)
    )
      return { outcome: "conflict" };
    const {
      deletedAt: _deletedAt,
      deleteTokenHash: _deleteTokenHash,
      deleteTokenExpiresAt: _deleteTokenExpiresAt,
      deletedWasDefault,
      ...active
    } = current;
    const restored = {
      ...active,
      isDefault: deletedWasDefault === true,
      version: current.version + 1,
      updatedAt: input.restoredAt,
    };
    if (restored.isDefault) this.clearOtherDefaults(restored);
    this.data.serverTableSavedViews = this.data.serverTableSavedViews.map(
      (view) => (view.id === current.id ? restored : view),
    );
    return { outcome: "restored", view: restored };
  }

  private clearOtherDefaults(view: E.ServerTableSavedViewRecord) {
    this.data.serverTableSavedViews = this.data.serverTableSavedViews.map(
      (candidate) =>
        candidate.id !== view.id &&
        candidate.deletedAt === undefined &&
        candidate.isDefault &&
        sameOwnerScope(candidate, view)
          ? {
              ...candidate,
              isDefault: false,
              version: candidate.version + 1,
              updatedAt: view.updatedAt,
            }
          : candidate,
    );
  }

  private hasActiveNameConflict(view: E.ServerTableSavedViewRecord) {
    return this.data.serverTableSavedViews.some(
      (candidate) =>
        candidate.id !== view.id &&
        candidate.deletedAt === undefined &&
        candidate.nameNormalized === view.nameNormalized &&
        sameOwnerScope(candidate, view),
    );
  }
}

function sameOwnerScope(
  left: E.ServerTableSavedViewRecord,
  right: E.ServerTableSavedViewRecord,
) {
  return (
    left.orgId === right.orgId &&
    left.workspaceId === right.workspaceId &&
    left.ownerUserId === right.ownerUserId &&
    left.resource === right.resource &&
    left.parentId === right.parentId
  );
}
