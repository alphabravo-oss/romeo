export type AuditOutcomeRecord = "failure" | "success";

export type UsageSourceTypeRecord =
  | "chat"
  | "retrieval"
  | "run"
  | "storage"
  | "tool"
  | "voice";

export type BackgroundJobStatusRecord =
  | "completed"
  | "failed"
  | "queued"
  | "running";

export interface AuditLogRecord {
  id: string;
  orgId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: AuditOutcomeRecord;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UsageEventRecord {
  id: string;
  orgId: string;
  workspaceId?: string;
  actorId: string;
  sourceType: UsageSourceTypeRecord;
  sourceId: string;
  metric: string;
  quantity: number;
  unit: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface BackgroundJobRecord {
  id: string;
  orgId: string;
  workspaceId?: string;
  type: string;
  status: BackgroundJobStatusRecord;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface SystemSettingRecord {
  key: string;
  value: Record<string, unknown>;
  updatedAt: string;
}
