import type { AuthSubject } from "@romeo/auth";
import { createHash, timingSafeEqual } from "node:crypto";

import type { ServerTableSavedViewRecord } from "../domain/repository";
import { ApiError } from "../errors";
import { inventoriedTableResource } from "./inventoried-table-resources";
import {
  SAVED_VIEW_SCHEMA,
  type ServerTableSavedView,
} from "./server-table-saved-view";

export interface SavedViewScope {
  workspaceId: string;
  resource: string;
  parentId?: string;
}

export function publicSavedViewRecord(
  record: ServerTableSavedViewRecord,
): ServerTableSavedView {
  return {
    schema: SAVED_VIEW_SCHEMA,
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    ownerUserId: record.ownerUserId,
    resource: record.resource,
    ...(record.parentId === undefined ? {} : { parentId: record.parentId }),
    name: record.name,
    query: record.query,
    presentation: record.presentation,
    source: "server",
    visibility: record.visibility,
    isDefault: record.isDefault,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function allowedSavedViewFields(
  definition: NonNullable<ReturnType<typeof inventoriedTableResource>>,
) {
  return new Set([
    ...definition.policy.sortFields,
    ...definition.policy.searchFields,
    ...Object.keys(definition.policy.filters),
    ...definition.requiredRowKeys,
  ]);
}

export function sameSavedViewScope(
  record: ServerTableSavedViewRecord,
  input: SavedViewScope,
) {
  return (
    record.workspaceId === input.workspaceId &&
    record.resource === input.resource &&
    record.parentId === input.parentId
  );
}

export function restorableSavedViewBy(
  record: ServerTableSavedViewRecord | undefined,
  input: SavedViewScope & { subject: AuthSubject },
): record is ServerTableSavedViewRecord & {
  deletedAt: string;
  deleteTokenHash: string;
  deleteTokenExpiresAt: string;
} {
  return (
    record !== undefined &&
    record.ownerUserId === input.subject.id &&
    sameSavedViewScope(record, input) &&
    record.deletedAt !== undefined &&
    record.deleteTokenHash !== undefined &&
    record.deleteTokenExpiresAt !== undefined
  );
}

export const normalizedSavedViewName = (value: string) =>
  value.trim().toLocaleLowerCase();

export function savedViewConflict() {
  return new ApiError(
    "saved_view_version_conflict",
    "The saved view changed or conflicts with an existing view.",
    409,
  );
}

export function savedViewUndoTokenHash(input: {
  token: string;
  orgId: string;
  ownerUserId: string;
  viewId: string;
  version: number;
}) {
  return createHash("sha256")
    .update(
      [
        input.orgId,
        input.ownerUserId,
        input.viewId,
        String(input.version),
        input.token,
      ].join("\u0000"),
    )
    .digest("hex");
}

export function constantTimeSavedViewTokenEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
