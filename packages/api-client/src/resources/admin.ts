import { pathId, withQuery } from "../path";
import type { RomeoTransport } from "../transport";
import type {
  AbuseControlPolicyReport,
  AnalyticsAuthzPostureReport,
  AdminAnalyticsSummary,
  ApiKeySummary,
  ApplyBillingPlanInput,
  AuthProviderCatalogEntry,
  AuthProviderConnectionTestInput,
  AuthProviderConnectionTestReport,
  AuditLogFilter,
  AuditLog,
  AuditIntegrityPostureReport,
  BackgroundJob,
  BackgroundJobOperationalSummary,
  BillingEntitlementReconciliationResult,
  BillingEntitlementReport,
  BillingLifecycleEnforcementResult,
  BillingLifecycleReport,
  BillingOperationsPostureReport,
  BillingPlan,
  BillingPlanApplyResult,
  BulkActionResult,
  BulkDisableServiceAccountsInput,
  BulkRevokeApiKeysInput,
  CiGovernancePostureReport,
  CreateApiKeyInput,
  CreatedApiKey,
  CreateManagedSecretInput,
  CreateRagPolicyChangeRequestInput,
  SecretRotationDrillPostureReport,
  SecretRewrapExecuteInput,
  SecretRewrapPreviewInput,
  SecretRewrapReport,
  DeprovisionSsoOidcUserInput,
  DelegatedOAuthPostureReport,
  DirectorySyncInput,
  DirectorySyncResult,
  CreateQuotaBucketInput,
  AddGroupMemberInput,
  AdminSetLocalPasswordInput,
  AuthProviderSettingsReport,
  AlertFiringPostureReport,
  BrowserAutomationPostureReport,
  CreateGroupInput,
  DataConnectorPostureReport,
  CreateServiceAccountApiKeyInput,
  CreateServiceAccountInput,
  EdgeSecurityPostureReport,
  GaEvidencePostureReport,
  Group,
  GroupMembership,
  IdentityLivePostureReport,
  KubernetesPostureReport,
  QuotaBucket,
  QuotaCoordinationStatus,
  ProviderOperationalSummary,
  ProviderOutagePostureReport,
  RagPolicyChangeRequest,
  RagPolicyReport,
  RagPostureReport,
  ReleaseReadbackPostureReport,
  ReleaseSecurityPostureReport,
  ReadinessReport,
  ServiceAccount,
  LocalAuthStatus,
  ManagedSecretReference,
  MigrationDrillPostureReport,
  NetworkPartitionPostureReport,
  NotificationAdapterLivePostureReport,
  PostgresOperationalPostureReport,
  SsoConnectionTestReport,
  SsoOidcDeprovisionResult,
  SsoSettingsReport,
  SupportBundlePostureReport,
  SyncExternalBillingEventInput,
  TargetQualityPostureReport,
  CreateTenantOrganizationInput,
  TenantDeletionFinalizationExecuteInput,
  TenantDeletionFinalizationEvidenceInput,
  TenantDeletionFinalizationPreview,
  TenantOrganizationConfirmationInput,
  TenantOrganizationReasonInput,
  TenantPurgeEvidencePostureReport,
  TenantOrganizationSummary,
  TenantPhysicalPurgeResult,
  TenantProvisioningResult,
  ToolDispatchPostureReport,
  UpdateTenantOrganizationInput,
  UpdateAbuseControlPolicyInput,
  UpdateAuthProviderSettingsInput,
  UpdateRagPolicyInput,
  UpdateSsoSettingsInput,
  UpdateQuotaBucketInput,
  ReviewRagPolicyChangeRequestInput,
  UpdateUserRoleInput,
  UserSummary,
  UsageAlert,
  UsageEvent,
  UsageSummary,
  VoiceProviderLivePostureReport,
} from "../types";

export function createAdminResource(transport: RomeoTransport) {
  return {
    apiKeys: () => transport.data<ApiKeySummary[]>("GET", "/api/v1/api-keys"),
    createApiKey: (input: CreateApiKeyInput) =>
      transport.data<CreatedApiKey>("POST", "/api/v1/api-keys", input),
    bulkRevokeApiKeys: (input: BulkRevokeApiKeysInput) =>
      transport.data<BulkActionResult>(
        "POST",
        "/api/v1/api-keys/bulk-revoke",
        input,
      ),
    revokeApiKey: (apiKeyId: string) =>
      transport.data<ApiKeySummary>(
        "POST",
        `/api/v1/api-keys/${pathId(apiKeyId)}/revoke`,
      ),
    serviceAccounts: () =>
      transport.data<ServiceAccount[]>("GET", "/api/v1/service-accounts"),
    users: () => transport.data<UserSummary[]>("GET", "/api/v1/users"),
    disableUser: (userId: string) =>
      transport.data<UserSummary>(
        "POST",
        `/api/v1/users/${pathId(userId)}/disable`,
      ),
    updateUserRole: (userId: string, input: UpdateUserRoleInput) =>
      transport.data<UserSummary>(
        "PATCH",
        `/api/v1/users/${pathId(userId)}/role`,
        input,
      ),
    setUserLocalPassword: (userId: string, input: AdminSetLocalPasswordInput) =>
      transport.data<LocalAuthStatus>(
        "POST",
        `/api/v1/users/${pathId(userId)}/local-password`,
        input,
      ),
    directorySync: (input: DirectorySyncInput) =>
      transport.data<DirectorySyncResult>(
        "POST",
        "/api/v1/admin/directory-sync",
        input,
      ),
    createServiceAccount: (input: CreateServiceAccountInput) =>
      transport.data<ServiceAccount>("POST", "/api/v1/service-accounts", input),
    bulkDisableServiceAccounts: (input: BulkDisableServiceAccountsInput) =>
      transport.data<BulkActionResult>(
        "POST",
        "/api/v1/service-accounts/bulk-disable",
        input,
      ),
    groups: () => transport.data<Group[]>("GET", "/api/v1/groups"),
    createGroup: (input: CreateGroupInput) =>
      transport.data<Group>("POST", "/api/v1/groups", input),
    groupMembers: (groupId: string) =>
      transport.data<GroupMembership[]>(
        "GET",
        `/api/v1/groups/${pathId(groupId)}/members`,
      ),
    addGroupMember: (groupId: string, input: AddGroupMemberInput) =>
      transport.data<GroupMembership>(
        "POST",
        `/api/v1/groups/${pathId(groupId)}/members`,
        input,
      ),
    removeGroupMember: (groupId: string, userId: string) =>
      transport.data<GroupMembership>(
        "DELETE",
        `/api/v1/groups/${pathId(groupId)}/members/${pathId(userId)}`,
      ),
    createServiceAccountApiKey: (input: CreateServiceAccountApiKeyInput) => {
      const { serviceAccountId, ...body } = input;
      return transport.data<CreatedApiKey>(
        "POST",
        `/api/v1/service-accounts/${pathId(serviceAccountId)}/api-keys`,
        body,
      );
    },
    disableServiceAccount: (serviceAccountId: string) =>
      transport.data<ServiceAccount>(
        "POST",
        `/api/v1/service-accounts/${pathId(serviceAccountId)}/disable`,
      ),
    auditLogs: (filter: AuditLogFilter = {}) =>
      transport.data<AuditLog[]>(
        "GET",
        withQuery("/api/v1/audit-logs", auditFilterQuery(filter)),
      ),
    auditLogsCsv: (filter: AuditLogFilter = {}) =>
      transport.text(
        "GET",
        withQuery("/api/v1/audit-logs.csv", auditFilterQuery(filter)),
        "text/csv",
      ),
    abuseControls: () =>
      transport.data<AbuseControlPolicyReport>(
        "GET",
        "/api/v1/admin/abuse-controls",
      ),
    tenantOrganizations: () =>
      transport.data<TenantOrganizationSummary[]>(
        "GET",
        "/api/v1/admin/organizations",
      ),
    createTenantOrganization: (input: CreateTenantOrganizationInput) =>
      transport.data<TenantProvisioningResult>(
        "POST",
        "/api/v1/admin/organizations",
        input,
      ),
    tenantOrganization: (orgId: string) =>
      transport.data<TenantOrganizationSummary>(
        "GET",
        `/api/v1/admin/organizations/${pathId(orgId)}`,
      ),
    updateTenantOrganization: (
      orgId: string,
      input: UpdateTenantOrganizationInput,
    ) =>
      transport.data<TenantOrganizationSummary>(
        "PATCH",
        `/api/v1/admin/organizations/${pathId(orgId)}`,
        input,
      ),
    suspendTenantOrganization: (
      orgId: string,
      input: TenantOrganizationReasonInput,
    ) =>
      transport.data<TenantOrganizationSummary>(
        "POST",
        `/api/v1/admin/organizations/${pathId(orgId)}/suspend`,
        input,
      ),
    reactivateTenantOrganization: (
      orgId: string,
      input: TenantOrganizationConfirmationInput,
    ) =>
      transport.data<TenantOrganizationSummary>(
        "POST",
        `/api/v1/admin/organizations/${pathId(orgId)}/reactivate`,
        input,
      ),
    requestTenantDeletion: (
      orgId: string,
      input: TenantOrganizationReasonInput,
    ) =>
      transport.data<TenantOrganizationSummary>(
        "POST",
        `/api/v1/admin/organizations/${pathId(orgId)}/deletion-request`,
        input,
      ),
    cancelTenantDeletionRequest: (
      orgId: string,
      input: TenantOrganizationConfirmationInput,
    ) =>
      transport.data<TenantOrganizationSummary>(
        "POST",
        `/api/v1/admin/organizations/${pathId(orgId)}/deletion-request/cancel`,
        input,
      ),
    tenantDeletionFinalizationPreview: (orgId: string) =>
      transport.data<TenantDeletionFinalizationPreview>(
        "GET",
        `/api/v1/admin/organizations/${pathId(orgId)}/deletion-finalization-preview`,
      ),
    recordTenantDeletionFinalizationEvidence: (
      orgId: string,
      input: TenantDeletionFinalizationEvidenceInput,
    ) =>
      transport.data<TenantDeletionFinalizationPreview>(
        "POST",
        `/api/v1/admin/organizations/${pathId(orgId)}/deletion-finalization-evidence`,
        input,
      ),
    executeTenantDeletionFinalization: (
      orgId: string,
      input: TenantDeletionFinalizationExecuteInput,
    ) =>
      transport.data<TenantPhysicalPurgeResult>(
        "POST",
        `/api/v1/admin/organizations/${pathId(orgId)}/deletion-finalization/execute`,
        input,
      ),
    tenantPurgeEvidencePosture: () =>
      transport.data<TenantPurgeEvidencePostureReport>(
        "GET",
        "/api/v1/admin/tenant-deletion/purge-evidence-posture",
      ),
    analyticsSummary: () =>
      transport.data<AdminAnalyticsSummary>(
        "GET",
        "/api/v1/admin/analytics/summary",
      ),
    analyticsSummaryCsv: () =>
      transport.text("GET", "/api/v1/admin/analytics/summary.csv", "text/csv"),
    analyticsAuthzPosture: () =>
      transport.data<AnalyticsAuthzPostureReport>(
        "GET",
        "/api/v1/admin/analytics/authz-posture",
      ),
    postgresOperationalPosture: () =>
      transport.data<PostgresOperationalPostureReport>(
        "GET",
        "/api/v1/admin/postgres/operational-posture",
      ),
    ciGovernancePosture: () =>
      transport.data<CiGovernancePostureReport>(
        "GET",
        "/api/v1/admin/ci-governance/posture",
      ),
    gaEvidencePosture: () =>
      transport.data<GaEvidencePostureReport>(
        "GET",
        "/api/v1/admin/ga/evidence-posture",
      ),
    targetQualityPosture: () =>
      transport.data<TargetQualityPostureReport>(
        "GET",
        "/api/v1/admin/target-quality/posture",
      ),
    alertFiringPosture: () =>
      transport.data<AlertFiringPostureReport>(
        "GET",
        "/api/v1/admin/alert-firing/posture",
      ),
    edgeSecurityPosture: () =>
      transport.data<EdgeSecurityPostureReport>(
        "GET",
        "/api/v1/admin/edge-security/posture",
      ),
    delegatedOAuthPosture: () =>
      transport.data<DelegatedOAuthPostureReport>(
        "GET",
        "/api/v1/admin/delegated-oauth/posture",
      ),
    browserAutomationPosture: () =>
      transport.data<BrowserAutomationPostureReport>(
        "GET",
        "/api/v1/admin/browser-automation/posture",
      ),
    dataConnectorPosture: () =>
      transport.data<DataConnectorPostureReport>(
        "GET",
        "/api/v1/admin/data-connectors/posture",
      ),
    toolDispatchPosture: () =>
      transport.data<ToolDispatchPostureReport>(
        "GET",
        "/api/v1/admin/tool-dispatch/posture",
      ),
    voiceProviderLivePosture: () =>
      transport.data<VoiceProviderLivePostureReport>(
        "GET",
        "/api/v1/admin/voice/provider-live-posture",
      ),
    notificationAdapterLivePosture: () =>
      transport.data<NotificationAdapterLivePostureReport>(
        "GET",
        "/api/v1/admin/notifications/adapter-live-posture",
      ),
    kubernetesPosture: () =>
      transport.data<KubernetesPostureReport>(
        "GET",
        "/api/v1/admin/kubernetes/posture",
      ),
    releaseReadbackPosture: () =>
      transport.data<ReleaseReadbackPostureReport>(
        "GET",
        "/api/v1/admin/release-readback/posture",
      ),
    releaseSecurityPosture: () =>
      transport.data<ReleaseSecurityPostureReport>(
        "GET",
        "/api/v1/admin/release-security/posture",
      ),
    supportBundlePosture: () =>
      transport.data<SupportBundlePostureReport>(
        "GET",
        "/api/v1/admin/support-bundle/posture",
      ),
    updateAbuseControls: (input: UpdateAbuseControlPolicyInput) =>
      transport.data<AbuseControlPolicyReport>(
        "PATCH",
        "/api/v1/admin/abuse-controls",
        input,
      ),
    billingPlan: () =>
      transport.data<BillingPlan | null>("GET", "/api/v1/billing/plan"),
    applyBillingPlan: (input: ApplyBillingPlanInput) =>
      transport.data<BillingPlanApplyResult>(
        "POST",
        "/api/v1/billing/plan",
        input,
      ),
    syncExternalBillingEvent: (input: SyncExternalBillingEventInput) =>
      transport.data<BillingPlanApplyResult>(
        "POST",
        "/api/v1/billing/external-events",
        input,
      ),
    billingEntitlements: () =>
      transport.data<BillingEntitlementReport>(
        "GET",
        "/api/v1/billing/entitlements",
      ),
    reconcileBillingEntitlements: () =>
      transport.data<BillingEntitlementReconciliationResult>(
        "POST",
        "/api/v1/billing/entitlements/reconcile",
      ),
    billingLifecycle: () =>
      transport.data<BillingLifecycleReport>(
        "GET",
        "/api/v1/billing/lifecycle",
      ),
    billingOperationsPosture: () =>
      transport.data<BillingOperationsPostureReport>(
        "GET",
        "/api/v1/admin/billing/operations-posture",
      ),
    auditIntegrityPosture: () =>
      transport.data<AuditIntegrityPostureReport>(
        "GET",
        "/api/v1/admin/audit-integrity/posture",
      ),
    enforceBillingLifecycle: () =>
      transport.data<BillingLifecycleEnforcementResult>(
        "POST",
        "/api/v1/billing/lifecycle/enforce",
      ),
    jobs: () => transport.data<BackgroundJob[]>("GET", "/api/v1/jobs"),
    jobOperationalSummary: () =>
      transport.data<BackgroundJobOperationalSummary>(
        "GET",
        "/api/v1/jobs/operational-summary",
      ),
    providerOperationalSummary: () =>
      transport.data<ProviderOperationalSummary>(
        "GET",
        "/api/v1/providers/operational-summary",
      ),
    providerOutagePosture: () =>
      transport.data<ProviderOutagePostureReport>(
        "GET",
        "/api/v1/admin/providers/outage-posture",
      ),
    identityLivePosture: () =>
      transport.data<IdentityLivePostureReport>(
        "GET",
        "/api/v1/admin/identity/live-posture",
      ),
    migrationDrillPosture: () =>
      transport.data<MigrationDrillPostureReport>(
        "GET",
        "/api/v1/admin/migrations/drill-posture",
      ),
    networkPartitionPosture: () =>
      transport.data<NetworkPartitionPostureReport>(
        "GET",
        "/api/v1/admin/network/partition-posture",
      ),
    secretRotationDrillPosture: () =>
      transport.data<SecretRotationDrillPostureReport>(
        "GET",
        "/api/v1/admin/secret-rotation/drill-posture",
      ),
    readiness: () =>
      transport.data<ReadinessReport>("GET", "/api/v1/admin/readiness"),
    ragPosture: () =>
      transport.data<RagPostureReport>("GET", "/api/v1/admin/rag/posture"),
    ragPolicy: () =>
      transport.data<RagPolicyReport>("GET", "/api/v1/admin/rag/policy"),
    updateRagPolicy: (input: UpdateRagPolicyInput) =>
      transport.data<RagPolicyReport>(
        "PATCH",
        "/api/v1/admin/rag/policy",
        input,
      ),
    ragPolicyChangeRequest: () =>
      transport.data<RagPolicyChangeRequest | null>(
        "GET",
        "/api/v1/admin/rag/policy/change-request",
      ),
    createRagPolicyChangeRequest: (input: CreateRagPolicyChangeRequestInput) =>
      transport.data<RagPolicyChangeRequest>(
        "POST",
        "/api/v1/admin/rag/policy/change-requests",
        input,
      ),
    approveRagPolicyChangeRequest: (
      requestId: string,
      input: ReviewRagPolicyChangeRequestInput,
    ) =>
      transport.data<RagPolicyChangeRequest>(
        "POST",
        `/api/v1/admin/rag/policy/change-requests/${pathId(requestId)}/approve`,
        input,
      ),
    rejectRagPolicyChangeRequest: (
      requestId: string,
      input: ReviewRagPolicyChangeRequestInput,
    ) =>
      transport.data<RagPolicyChangeRequest>(
        "POST",
        `/api/v1/admin/rag/policy/change-requests/${pathId(requestId)}/reject`,
        input,
      ),
    authProviderCatalog: () =>
      transport.data<AuthProviderCatalogEntry[]>(
        "GET",
        "/api/v1/admin/auth-providers/catalog",
      ),
    authProviderSettings: () =>
      transport.data<AuthProviderSettingsReport>(
        "GET",
        "/api/v1/admin/auth-providers/settings",
      ),
    updateAuthProviderSettings: (input: UpdateAuthProviderSettingsInput) =>
      transport.data<AuthProviderSettingsReport>(
        "PATCH",
        "/api/v1/admin/auth-providers/settings",
        input,
      ),
    testAuthProviderConnection: (input: AuthProviderConnectionTestInput) =>
      transport.data<AuthProviderConnectionTestReport>(
        "POST",
        "/api/v1/admin/auth-providers/settings/test",
        input,
      ),
    createManagedSecret: (input: CreateManagedSecretInput) =>
      transport.data<ManagedSecretReference>(
        "POST",
        "/api/v1/admin/secrets",
        input,
      ),
    previewSecretRewrap: (input: SecretRewrapPreviewInput = {}) =>
      transport.data<SecretRewrapReport>(
        "POST",
        "/api/v1/admin/secret-rotation/rewrap/preview",
        input,
      ),
    executeSecretRewrap: (input: SecretRewrapExecuteInput) =>
      transport.data<SecretRewrapReport>(
        "POST",
        "/api/v1/admin/secret-rotation/rewrap",
        input,
      ),
    ssoSettings: () =>
      transport.data<SsoSettingsReport>("GET", "/api/v1/admin/sso-settings"),
    updateSsoSettings: (input: UpdateSsoSettingsInput) =>
      transport.data<SsoSettingsReport>(
        "PATCH",
        "/api/v1/admin/sso-settings",
        input,
      ),
    testSsoSettings: () =>
      transport.data<SsoConnectionTestReport>(
        "POST",
        "/api/v1/admin/sso-settings/test",
      ),
    deprovisionOidcUser: (input: DeprovisionSsoOidcUserInput) =>
      transport.data<SsoOidcDeprovisionResult>(
        "POST",
        "/api/v1/admin/sso/oidc/deprovision",
        input,
      ),
    usageEvents: () =>
      transport.data<UsageEvent[]>("GET", "/api/v1/usage/events"),
    usageEventsCsv: () =>
      transport.text("GET", "/api/v1/usage/events.csv", "text/csv"),
    usageSummary: () =>
      transport.data<UsageSummary>("GET", "/api/v1/usage/summary"),
    usageAlerts: () =>
      transport.data<UsageAlert[]>("GET", "/api/v1/usage/alerts"),
    quotas: () => transport.data<QuotaBucket[]>("GET", "/api/v1/quotas"),
    quotaCoordinationStatus: () =>
      transport.data<QuotaCoordinationStatus>(
        "GET",
        "/api/v1/quotas/distributed-status",
      ),
    createQuota: (input: CreateQuotaBucketInput) =>
      transport.data<QuotaBucket>("POST", "/api/v1/quotas", input),
    updateQuota: (quotaBucketId: string, input: UpdateQuotaBucketInput) =>
      transport.data<QuotaBucket>(
        "PATCH",
        `/api/v1/quotas/${pathId(quotaBucketId)}`,
        input,
      ),
    deleteQuota: (quotaBucketId: string) =>
      transport.data<QuotaBucket>(
        "DELETE",
        `/api/v1/quotas/${pathId(quotaBucketId)}`,
      ),
  };
}

function auditFilterQuery(
  filter: AuditLogFilter,
): Record<string, string | undefined> {
  return {
    action: filter.action,
    actorId: filter.actorId,
    outcome: filter.outcome,
    resourceId: filter.resourceId,
    resourceType: filter.resourceType,
  };
}
