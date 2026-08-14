import type {
  BackgroundJob,
  FileObject,
  PromptTemplate,
  User,
  WebhookDelivery,
} from "./entities";
import type { RepositoryContentCapability } from "./repository-content";
import type { RepositoryCapabilityAssignments } from "./repository-capabilities";
import type { RepositoryCapabilityFlags } from "./repository-capability-flags";
import type { RepositoryIdempotency } from "./repository-idempotency";
import type { RepositoryIdentityCapability } from "./repository-identity";
import type { RepositoryOperationsCapability } from "./repository-operations";

export interface RomeoRepository
  extends
    RepositoryIdentityCapability,
    RepositoryContentCapability,
    RepositoryOperationsCapability,
    RepositoryCapabilityAssignments,
    RepositoryCapabilityFlags,
    RepositoryIdempotency {
  readonly runtime?: RomeoRepositoryRuntime;

  transaction<T>(work: (repository: RomeoRepository) => Promise<T>): Promise<T>;
}

export type { RepositoryContentCapability } from "./repository-content";
export type { RepositoryCapabilityAssignments } from "./repository-capabilities";
export type { RepositoryCapabilityFlags } from "./repository-capability-flags";
export type { RepositoryIdempotency } from "./repository-idempotency";
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

export interface AuthorizedMessagePageQuery {
  branchExpectedChildId?: string;
  branchExpectedParentId?: string | null;
  branchLeafMessageId?: string;
  branchStartMessageId?: string;
  branchTraversalOffset?: number;
  chatId: string;
  linearCursor?: { createdAt: string; id: string };
  limit: number;
  mode: "branch" | "linear";
  orgId: string;
  transcriptVersion: string;
  workspaceId: string;
}

export interface AuthorizedChatMessageSearchQuery {
  chatId: string;
  cursor?: { createdAt: string; id: string };
  limit: number;
  normalizedQuery: string;
  orgId: string;
  transcriptVersion: string;
  workspaceId: string;
}

export interface ChatMessageSearchQueryResult {
  hasMore: boolean;
  invalidTranscriptVersion?: boolean;
  items: Array<{
    activeBranch: boolean;
    createdAt: string;
    messageId: string;
    role: import("./entities").Message["role"];
    snippet: string;
  }>;
  nextPosition?: { createdAt: string; id: string };
  total: number;
  transcriptVersion: string;
}

export interface MessagePageQueryResult {
  branchVariants: MessageBranchVariantNavigation[];
  hasMore: boolean;
  invalidBranch?: boolean;
  invalidTranscriptVersion?: boolean;
  items: import("./entities").Message[];
  transcriptVersion: string;
  nextPosition?:
    | {
        expectedChildId: string;
        expectedParentId: string | null;
        messageId: string;
        mode: "branch";
        traversed: number;
      }
    | { createdAt: string; id: string; mode: "linear" };
}

/** Compact adjacent-variant targets for one message on the selected path. */
export interface MessageBranchVariantNavigation {
  index: number;
  messageId: string;
  nextLeafMessageId?: string;
  previousLeafMessageId?: string;
  total: number;
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

export type UserTableSortField = "email" | "name";
export type UserTableStatus = "active" | "disabled";

export interface UserTableFilter {
  roles?: Array<"global_admin" | "org_admin" | "user">;
  status?: UserTableStatus;
}

export interface UserTablePosition {
  id: string;
  value: string;
}

export interface QueryUsersInput {
  direction: "asc" | "desc";
  filter: UserTableFilter;
  limit: number;
  position?: UserTablePosition;
  search?: string;
  sort: UserTableSortField;
}

export interface UserTableQueryResult {
  activeGlobalAdminTotal: number;
  adminTotal: number;
  disabledTotal: number;
  hasMore: boolean;
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

export interface WebhookDeliveryCursor {
  createdAt: string;
  id: string;
}

export interface ListWebhookDeliveriesPageInput {
  cursor?: WebhookDeliveryCursor;
  limit: number;
  orgId: string;
  subscriptionId?: string;
}

export interface ClaimWebhookDeliveryInput {
  deliveryId: string;
  leaseExpiresAt: string;
  leaseOwner: string;
  leaseToken: string;
  now: string;
  orgId: string;
}

export interface ClaimDueWebhookDeliveriesInput {
  leaseExpiresAt: string;
  leaseOwner: string;
  leaseToken: string;
  limit: number;
  maxAttempts: number;
  now: string;
  orgId: string;
}

export interface ClaimedWebhookDelivery {
  delivery: WebhookDelivery;
  leaseExpiresAt: string;
  leaseOwner: string;
  leaseToken: string;
}

export interface CompleteWebhookDeliveryAttemptInput {
  delivery: WebhookDelivery;
  leaseOwner: string;
  leaseToken: string;
  now: string;
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
