export const nativeInventoriedTableResources = [
  "background_jobs",
  "data_connector_sync_runs",
  "governance_export_packages",
  "notification_deliveries",
  "notifications",
  "support_access_requests",
  "support_sessions",
  "tool_trace_calls",
  "usage_events",
] as const;

export type NativeInventoriedTableResource =
  (typeof nativeInventoriedTableResources)[number];

export interface InventoriedTableRepositoryPosition {
  id: string;
  value: number | string | null;
}

export interface QueryInventoriedTableRowsInput {
  actorId: string;
  actorType: "service_account" | "user";
  filters: Array<{ field: string; operator: string; value?: unknown }>;
  includeTotals: boolean;
  limit: number;
  orgId: string;
  parentId?: string;
  position?: InventoriedTableRepositoryPosition;
  resource: NativeInventoriedTableResource;
  search?: string;
  searchFields: readonly string[];
  snapshotAt?: string;
  sort: { direction: "asc" | "desc"; field: string };
  workspaceId?: string;
}

export interface QueryInventoriedTableRowsResult {
  items: Array<{ id: string; [key: string]: unknown }>;
  summary?: Record<string, number>;
  total?: number;
}
