import type {
  BackgroundJob,
  FileObject,
  PromptTemplate,
  User,
} from "./entities";
import type { RepositoryContentCapability } from "./repository-content";
import type { RepositoryIdentityCapability } from "./repository-identity";
import type { RepositoryOperationsCapability } from "./repository-operations";

export interface RomeoRepository
  extends
    RepositoryIdentityCapability,
    RepositoryContentCapability,
    RepositoryOperationsCapability {
  readonly runtime?: RomeoRepositoryRuntime;

  transaction<T>(work: (repository: RomeoRepository) => Promise<T>): Promise<T>;
}

export type { RepositoryContentCapability } from "./repository-content";
export type { RepositoryIdentityCapability } from "./repository-identity";
export type { RepositoryOperationsCapability } from "./repository-operations";

export interface AuthorizedChatCatalogQuery {
  archived: "active" | "all" | "archived";
  groupIds: string[];
  isAdmin: boolean;
  limit: number;
  now: string;
  offset: number;
  orgId: string;
  principalId: string;
  principalType: "service_account" | "user";
  workspaceId: string;
}

export interface AuthorizedFileCatalogQuery {
  accessMode: "file_grants" | "workspace_content";
  excludePurposes?: FileObject["purpose"][];
  groupIds: string[];
  isAdmin: boolean;
  limit: number;
  offset: number;
  orgId: string;
  principalId: string;
  principalType: "service_account" | "user";
  purposes?: FileObject["purpose"][];
  query?: string;
  workspaceId: string;
}

export interface ModelCatalogQuery {
  available?: boolean;
  direction?: "asc" | "desc";
  enabled?: boolean;
  limit: number;
  offset: number;
  providerId?: string;
  query?: string;
  sort?: "availability" | "contextWindow" | "displayName" | "enabled" | "name";
}

export interface UserCatalogQuery {
  direction?: "asc" | "desc";
  limit: number;
  offset: number;
  query?: string;
  sort?: "email" | "name" | "role" | "status";
}

export interface UserCatalogPage {
  activeGlobalAdminTotal: number;
  adminTotal: number;
  disabledTotal: number;
  items: User[];
  total: number;
  userTotal: number;
}

export interface AuthorizedPromptCatalogQuery {
  groupIds: string[];
  isAdmin: boolean;
  limit: number;
  offset: number;
  orgId: string;
  principalId: string;
  principalType: "service_account" | "user";
  query?: string;
  visibility?: PromptTemplate["visibility"];
  workspaceId: string;
}

export interface TenantDataPurgeResult {
  organizationDeleted: boolean;
  recordCounts: Record<string, number>;
}

export interface RomeoRepositoryRuntime {
  driver: string;
  durable: boolean;
  storageScope: string;
  description: string;
}

export interface ClaimBackgroundJobInput {
  leaseSeconds: number;
  now?: string;
  orgId: string;
  payloadEquals?: Record<string, string>;
  type: string;
  workerId: string;
}

export interface RenewBackgroundJobLeaseInput {
  jobId: string;
  leaseSeconds: number;
  now?: string;
  orgId: string;
  workerId: string;
}

export interface UpdateBackgroundJobWithLeaseInput {
  job: BackgroundJob;
  workerId: string;
  now?: string;
}

export interface FinalizeRunInput {
  runId: string;
  status: "cancelled" | "completed" | "failed";
  completedAt: string;
}

export interface ClaimQueuedChatTurnInput {
  chatId: string;
  leaseOwner: string;
  leaseToken: string;
  now: string;
  leaseExpiresAt: string;
}

export interface RenewQueuedChatTurnLeaseInput {
  turnId: string;
  leaseOwner: string;
  leaseToken: string;
  now: string;
  leaseExpiresAt: string;
}

export interface CancelQueuedChatTurnInput {
  turnId: string;
  chatId: string;
  now: string;
}

export interface FinishQueuedChatTurnLeaseInput {
  turnId: string;
  leaseOwner: string;
  leaseToken: string;
  status: "queued" | "failed" | "completed";
  now: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
}

export function getRomeoRepositoryRuntime(
  repository: RomeoRepository,
): RomeoRepositoryRuntime {
  return (
    repository.runtime ?? {
      driver: "unknown",
      durable: false,
      storageScope: "unknown",
      description: "Repository does not expose runtime persistence metadata.",
    }
  );
}
