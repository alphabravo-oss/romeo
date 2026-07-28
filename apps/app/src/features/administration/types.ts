import type {
  AdminUser,
  ApiKeySummary,
  DirectorySyncRequest,
  DirectorySyncResult,
} from "@romeo/api-client/generated/sdk";

export type {
  AdminUser as User,
  ApiKeySummary,
  BulkActionResult,
  CreatedApiKey,
  DirectorySyncRequest,
  DirectorySyncResult,
  Group,
  GroupMember,
  LocalAuthStatus,
  ServiceAccount,
} from "@romeo/api-client/generated/sdk";

export type UserRole = NonNullable<AdminUser["role"]>;
export type ApiKeyScope = ApiKeySummary["scopes"][number];
export type DirectorySyncSource = DirectorySyncRequest["source"];
export type DirectorySyncGroupInventory = NonNullable<
  DirectorySyncRequest["groupMemberships"]
>[number];
export type DirectorySyncMembershipRemovalPlan =
  DirectorySyncResult["changes"]["membershipRemovals"];
export type DirectorySyncGroupRemovalPlan =
  DirectorySyncMembershipRemovalPlan["groups"][number];
export type DirectorySyncUserDisablePlan =
  DirectorySyncResult["changes"]["userDisables"];
