import type {
  DataExportCounts,
  DataExportLimits,
  DataExportResolvedRequest,
} from "./governance";

export type GovernanceExportJobState =
  | "queued"
  | "running"
  | "artifact_ready"
  | "failed"
  | "expired"
  | "deleted";

export interface GovernanceExportCheckpoint {
  cursor?: string;
  datasetIndex: number;
  partCount: number;
  processedRows: number;
  sizeBytes: number;
}

export interface GovernanceExportJobRecord {
  id: string;
  orgId: string;
  workspaceId?: string;
  createdBy: string;
  request: DataExportResolvedRequest;
  snapshotAt: string;
  state: GovernanceExportJobState;
  percent: number;
  checkpoint: GovernanceExportCheckpoint;
  counts: DataExportCounts;
  limits: DataExportLimits;
  warnings: string[];
  exclusions: string[];
  errorCode?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  leaseAttempt: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  deletedAt?: string;
}

export interface GovernanceExportArtifactRecord {
  id: string;
  jobId: string;
  orgId: string;
  objectKey: string;
  contentType: "application/json" | "application/x-ndjson";
  fileName: string;
  sizeBytes: number;
  sha256: string;
  partCount: number;
  createdAt: string;
  expiresAt: string;
  deletedAt?: string;
}

export interface ClaimGovernanceExportJobInput {
  orgId: string;
  workerId: string;
  leaseSeconds: number;
  now: string;
  jobId?: string;
}

export interface UpdateGovernanceExportJobWithLeaseInput {
  job: GovernanceExportJobRecord;
  workerId: string;
  leaseAttempt: number;
}
