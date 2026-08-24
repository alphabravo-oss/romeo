import type { TableSavedView } from "./table-preferences";

export interface DataTableAuthority {
  mode: "server";
  status: "error" | "loading" | "ready";
  error?: string;
  pending?: boolean;
  statusMessage?: string;
  savedViews: TableSavedView[];
  saveView: (view: TableSavedView) => Promise<void>;
  deleteView: (view: TableSavedView) => Promise<
    | {
        restore: () => Promise<void>;
      }
    | undefined
  >;
  setDefaultView: (view: TableSavedView, isDefault: boolean) => Promise<void>;
  setViewVisibility: (
    view: TableSavedView,
    visibility: "private" | "workspace",
  ) => Promise<void>;
  exportView: (view: TableSavedView, estimatedRows: number) => Promise<void>;
}

export interface ServerTableAuthorityScope {
  parentId?: string;
  resource: string;
  schemaVersion: number;
  workspaceId?: string;
}
