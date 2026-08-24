export interface ServerTableSavedViewRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  ownerUserId: string;
  resource: string;
  parentId?: string;
  name: string;
  nameNormalized: string;
  query: {
    sort: Array<{ field: string; direction: "asc" | "desc" }>;
    filters: Array<{ field: string; operator: string; value?: unknown }>;
    search?: string;
    pageSize: number;
  };
  presentation: {
    columnVisibility: Record<string, boolean>;
    density: "comfortable" | "compact";
  };
  visibility: "private" | "workspace";
  isDefault: boolean;
  schemaVersion: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deleteTokenHash?: string;
  deleteTokenExpiresAt?: string;
  deletedWasDefault?: boolean;
}

export interface ListServerTableSavedViewsInput {
  orgId: string;
  workspaceId: string;
  ownerUserId: string;
  resource: string;
  parentId?: string;
}

export type WriteServerTableSavedViewResult =
  | { outcome: "stored"; view: ServerTableSavedViewRecord }
  | { outcome: "conflict" };

export type DeleteServerTableSavedViewResult =
  | { outcome: "deleted"; view: ServerTableSavedViewRecord }
  | { outcome: "already_deleted"; view: ServerTableSavedViewRecord }
  | { outcome: "not_found" }
  | { outcome: "conflict" };

export type RestoreServerTableSavedViewResult =
  | { outcome: "restored"; view: ServerTableSavedViewRecord }
  | { outcome: "already_restored"; view: ServerTableSavedViewRecord }
  | { outcome: "not_found" }
  | { outcome: "conflict" };
