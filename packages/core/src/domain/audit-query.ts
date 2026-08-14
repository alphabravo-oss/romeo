import type { AuditLog } from "./operational-entities";

export type AuditLogCategory =
  | "access"
  | "admin"
  | "chat"
  | "data"
  | "run"
  | "security"
  | "system";

export interface AuditLogQueryFilter {
  action?: string;
  actorId?: string;
  category?: AuditLogCategory;
  from?: string;
  includeNoise?: boolean;
  outcome?: "failure" | "success";
  resourceId?: string;
  resourceType?: string;
  to?: string;
}

export interface AuditLogQueryPosition {
  createdAt: string;
  id: string;
}

export interface QueryAuditLogsInput {
  filter: AuditLogQueryFilter;
  limit: number;
  orgId: string;
  position?: AuditLogQueryPosition;
  search?: string;
  sort: {
    direction: "asc" | "desc";
    field: "createdAt";
  };
}

export interface AuditLogQueryResult {
  hasMore: boolean;
  items: AuditLog[];
}
