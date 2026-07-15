export const dataConnectorTypes = [
  "local_import",
  "github",
  "s3",
  "website",
  "rss",
  "confluence",
  "jira",
  "notion",
  "linear",
  "slack",
] as const;

export type DataConnectorType = (typeof dataConnectorTypes)[number];
export type DataConnectorStatus = "active" | "disabled";
export type DataConnectorSyncStatus = "running" | "completed" | "failed";

export interface DataConnector {
  id: string;
  orgId: string;
  workspaceId: string;
  knowledgeBaseId: string;
  type: DataConnectorType;
  name: string;
  config: Record<string, unknown>;
  status: DataConnectorStatus;
  syncIntervalMinutes?: number;
  nextSyncAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastSyncAt?: string;
}

export interface DataConnectorSync {
  id: string;
  orgId: string;
  workspaceId: string;
  knowledgeBaseId: string;
  connectorId: string;
  status: DataConnectorSyncStatus;
  createdBy: string;
  itemCount: number;
  sourceIds: string[];
  summary: Record<string, unknown>;
  errorCode?: string;
  startedAt: string;
  completedAt?: string;
}

export interface LocalImportSyncItem {
  fileName: string;
  mimeType: string;
  content: string;
  sizeBytes?: number | undefined;
}
