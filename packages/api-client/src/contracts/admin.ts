import type { Organization, Scope, Workspace } from "./common";

export interface ApiKeySummary {
  id: string;
  orgId?: string;
  userId?: string;
  serviceAccountId?: string;
  name: string;
  scopes: Scope[];
  revokedAt?: string;
  createdAt: string;
}

export interface CreatedApiKey {
  apiKey: ApiKeySummary;
  token: string;
}

export interface BulkRevokeApiKeysInput {
  apiKeyIds: string[];
}

export interface BulkActionItemResult {
  id: string;
  status: "failure" | "success";
  error?: string;
}

export interface BulkActionResult {
  results: BulkActionItemResult[];
}

export interface ServiceAccount {
  id: string;
  orgId: string;
  name: string;
  scopes: Scope[];
  createdBy: string;
  disabledAt?: string;
  createdAt: string;
}

export interface BulkDisableServiceAccountsInput {
  serviceAccountIds: string[];
}

export interface Group {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface GroupMembership {
  groupId: string;
  userId: string;
  orgId: string;
  createdAt: string;
}

export interface UserSummary {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role?: UserRole;
  disabledAt?: string;
}

export type UserRole = "global_admin" | "org_admin" | "user";

export interface UpdateUserRoleInput {
  confirmUserId: string;
  role: UserRole;
}

export interface AdminSetLocalPasswordInput {
  confirmUserId: string;
  newPassword: string;
}

export interface TenantDeletionRequest {
  status: "cancelled" | "requested";
  reasonCode: string;
  requestedAt: string;
  requestedBy: string;
  cancelledAt?: string;
  cancelledBy?: string;
}

export interface TenantOrganizationSummary {
  organization: Organization;
  counts: {
    activeApiKeys: number;
    disabledUsers: number;
    serviceAccounts: number;
    users: number;
    workspaces: number;
  };
  suspension: {
    suspended: boolean;
    reasonCode?: string;
    suspendedAt?: string;
    suspendedBy?: string;
  };
  deletionRequest?: TenantDeletionRequest;
}

export interface TenantProvisioningResult extends TenantOrganizationSummary {
  defaultWorkspace: Workspace;
  initialAdmin?: {
    id: string;
    email: string;
    name: string;
    role: "org_admin";
    localPasswordConfigured: boolean;
  };
}

export interface CreateTenantOrganizationInput {
  name: string;
  slug?: string;
  defaultWorkspace?: {
    name?: string;
    slug?: string;
  };
  initialAdmin?: {
    email: string;
    name: string;
    password?: string;
  };
}

export interface UpdateTenantOrganizationInput {
  name?: string;
  slug?: string;
}

export interface TenantOrganizationConfirmationInput {
  confirmOrgId: string;
}

export interface TenantOrganizationReasonInput extends TenantOrganizationConfirmationInput {
  reasonCode: string;
}

export type TenantDeletionEvidenceControl =
  | "backup_retention_review"
  | "external_secret_store_review"
  | "external_vector_purge_review"
  | "object_store_purge_plan_review"
  | "operational_log_retention_review"
  | "postgres_purge_plan_review"
  | "support_bundle_retention_review";

export type TenantDeletionEvidenceStatus =
  | "failed"
  | "not_applicable"
  | "passed";

export interface TenantDeletionEvidence {
  control: TenantDeletionEvidenceControl;
  evidenceRefHash?: string;
  reviewedAt: string;
  reviewedBy: string;
  status: TenantDeletionEvidenceStatus;
}

export interface TenantDeletionFinalizationPreview {
  schema: "romeo.tenant-deletion-finalization-preview.v1";
  blockers: string[];
  counts: {
    activeApiKeys: number;
    activeSessions: number;
    auditLogs: number;
    backgroundJobs: number;
    dataExportPackages: number;
    fileObjects: number;
    knowledgeBases: number;
    knowledgeChunkEmbeddings: number;
    knowledgeChunks: number;
    knowledgeSourceObjects: number;
    knowledgeSources: number;
    serviceAccounts: number;
    users: number;
    workspaces: number;
  };
  evidence: {
    controls: TenantDeletionEvidence[];
    missingControls: TenantDeletionEvidenceControl[];
    requiredControls: TenantDeletionEvidenceControl[];
  };
  generatedAt: string;
  orgId: string;
  preconditions: {
    deletionRequestActive: boolean;
    evidenceComplete: boolean;
    suspended: boolean;
  };
  redaction: {
    evidenceBodiesReturned: false;
    objectStoreKeysReturned: false;
    rawEvidenceRefsReturned: false;
    rawLogsReturned: false;
    secretValuesReturned: false;
    vectorValuesReturned: false;
  };
  status: "blocked" | "ready";
  storageClasses: Array<{
    evidenceControl: TenantDeletionEvidenceControl;
    id:
      | "backups"
      | "external_secret_store"
      | "external_vector_store"
      | "object_store_artifacts"
      | "operational_logs"
      | "postgres_domain_records"
      | "support_bundles";
    status: "app_tracked" | "operator_evidence_required";
    trackedObjectCount?: number;
    trackedRecordCount?: number;
  }>;
}

export interface TenantDeletionFinalizationEvidenceInput extends TenantOrganizationConfirmationInput {
  controls: Array<{
    control: TenantDeletionEvidenceControl;
    evidenceRefHash?: string;
    status: TenantDeletionEvidenceStatus;
  }>;
}

export interface TenantDeletionFinalizationExecuteInput extends TenantOrganizationConfirmationInput {
  confirmPermanentDeletion: true;
}

export type TenantTrackedObjectClass =
  | "browser_automation_artifact"
  | "chat_attachment"
  | "data_export_package"
  | "file_object"
  | "knowledge_source"
  | "tool_dispatch_payload"
  | "voice_artifact";

export interface TenantPhysicalPurgeResult {
  schema: "romeo.tenant-physical-purge-result.v1";
  orgId: string;
  status: "deleted";
  deletedAt: string;
  deletedBy: string;
  database: {
    organizationDeleted: boolean;
    recordCounts: Record<string, number>;
    totalRecordCount: number;
  };
  objectStore: {
    deletionFailures: 0;
    objectStoreKeysReturned: false;
    trackedObjectCount: number;
    deletedObjectCount: number;
    trackedObjectsByClass: Record<TenantTrackedObjectClass, number>;
  };
  externalEvidence: {
    backupsHandledByEvidence: true;
    externalSecretsHandledByEvidence: true;
    externalVectorsHandledByEvidence: true;
    operationalLogsHandledByEvidence: true;
    supportBundlesHandledByEvidence: true;
  };
  redaction: {
    auditLogBodiesReturned: false;
    evidenceBodiesReturned: false;
    objectStoreKeysReturned: false;
    rawEvidenceRefsReturned: false;
    secretValuesReturned: false;
    vectorValuesReturned: false;
  };
}

export type TenantPurgeEvidencePostureWarning =
  | "tenant_purge_app_database_missing"
  | "tenant_purge_app_object_store_missing"
  | "tenant_purge_backup_retention_missing"
  | "tenant_purge_deployment_invalid"
  | "tenant_purge_evidence_failed"
  | "tenant_purge_evidence_invalid"
  | "tenant_purge_evidence_not_configured"
  | "tenant_purge_evidence_not_live"
  | "tenant_purge_evidence_not_passed"
  | "tenant_purge_external_secret_store_missing"
  | "tenant_purge_external_vector_missing"
  | "tenant_purge_failure_codes_present"
  | "tenant_purge_operational_log_retention_missing"
  | "tenant_purge_redaction_missing"
  | "tenant_purge_required_checks_missing"
  | "tenant_purge_retention_days_missing"
  | "tenant_purge_storage_review_missing"
  | "tenant_purge_support_bundle_retention_missing";

export interface TenantPurgeEvidencePostureReport {
  schema: "romeo.tenant-purge-evidence-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: "romeo.tenant-purge-evidence.v1";
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<
      | "app_database_purge_executed"
      | "app_object_store_purge_executed"
      | "backup_retention_reviewed"
      | "external_secret_store_reviewed"
      | "external_vector_store_reviewed"
      | "operational_log_retention_reviewed"
      | "support_bundle_retention_reviewed"
      | "tenant_purge_redaction_reviewed"
    >;
  };
  purge: {
    tenantCount: number;
    databasePurgedTenantCount: number;
    objectStorePurgedTenantCount: number;
    externalVectorReviewedTenantCount: number;
    backupRetentionReviewedTenantCount: number;
    operationalLogRetentionReviewedTenantCount: number;
    supportBundleReviewedTenantCount: number;
    externalSecretReviewedTenantCount: number;
  };
  storage: {
    postgresRecordCount: number;
    objectStoreObjectCount: number;
    externalVectorNamespaceCount: number;
    backupSystemCount: number;
    operationalLogSystemCount: number;
    supportBundleSystemCount: number;
    secretStoreCount: number;
  };
  retention: {
    backupRetentionDays?: number;
    operationalLogRetentionDays?: number;
    supportBundleRetentionDays?: number;
  };
  redaction: {
    backupLocationsReturned: false;
    evidenceFileBodiesReturned: false;
    objectStoreKeysReturned: false;
    operationalLogBodiesReturned: false;
    rawEvidencePathsReturned: false;
    secretValuesReturned: false;
    supportBundleBodiesReturned: false;
    vectorValuesReturned: false;
  };
  warnings: TenantPurgeEvidencePostureWarning[];
}

export type DirectorySyncSource =
  | "active-directory"
  | "ldap"
  | "manual"
  | "oidc"
  | "saml"
  | "scim";

export interface DirectorySyncGroupInventory {
  groupId: string;
  presentUserIds: string[];
}

export interface DirectorySyncInput {
  allowAdminUserDisable?: boolean;
  confirmApply?: "apply-directory-sync";
  disableMissingUsers?: boolean;
  dryRun?: boolean;
  groupMemberships?: DirectorySyncGroupInventory[];
  maxMembershipRemovals?: number;
  maxUserDisables?: number;
  presentUserEmails?: string[];
  presentUserIds?: string[];
  preserveAdminUsers?: boolean;
  reason?: string;
  removeMissingGroupMembers?: boolean;
  source: DirectorySyncSource;
}

export interface DirectorySyncUserDisablePlan {
  count: number;
  skippedAdminUserIds: string[];
  skippedSelfUserIds: string[];
  userIds: string[];
}

export interface DirectorySyncGroupRemovalPlan {
  count: number;
  groupId: string;
  userIds: string[];
}

export interface DirectorySyncMembershipRemovalPlan {
  count: number;
  groups: DirectorySyncGroupRemovalPlan[];
  skippedSelfUserIds: string[];
}

export interface DirectorySyncResult {
  changes: {
    membershipRemovals: DirectorySyncMembershipRemovalPlan;
    userDisables: DirectorySyncUserDisablePlan;
  };
  generatedAt: string;
  limits: {
    maxMembershipRemovals: number;
    maxUserDisables: number;
  };
  mode: "apply" | "preview";
  orgId: string;
  redaction: {
    externalGroupNamesReturned: false;
    externalSubjectIdsReturned: false;
    rawDirectoryPayloadReturned: false;
    userEmailsReturned: false;
    userNamesReturned: false;
  };
  requested: {
    disableMissingUsers: boolean;
    preserveAdminUsers: boolean;
    removeMissingGroupMembers: boolean;
  };
  schema: "romeo.directory-sync.v1";
  source: DirectorySyncSource;
  status: "applied" | "preview";
  warnings: string[];
}

export type IdentityLivePostureWarning =
  | "identity_live_access_review_missing"
  | "identity_live_directory_lookup_missing"
  | "identity_live_directory_sync_missing"
  | "identity_live_deployment_invalid"
  | "identity_live_directory_missing"
  | "identity_live_evidence_failed"
  | "identity_live_evidence_invalid"
  | "identity_live_evidence_not_configured"
  | "identity_live_evidence_not_live"
  | "identity_live_evidence_not_passed"
  | "identity_live_failure_codes_present"
  | "identity_live_group_mapping_missing"
  | "identity_live_lifecycle_missing"
  | "identity_live_login_missing"
  | "identity_live_policy_violations_present"
  | "identity_live_redaction_missing"
  | "identity_live_required_checks_missing"
  | "identity_live_secret_backend_missing";

export interface IdentityLivePostureReport {
  schema: "romeo.identity-live-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: "romeo.identity-live-evidence.v1";
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<
      | "access_review_readback"
      | "configured_idp_login_live"
      | "deprovision_or_scim_lifecycle_live"
      | "directory_lookup_live"
      | "directory_sync_apply_live"
      | "directory_sync_preview_live"
      | "group_mapping_validation_live"
      | "identity_evidence_redaction_reviewed"
      | "identity_log_redaction"
      | "managed_secret_backend_live"
    >;
  };
  identityProviders: {
    configuredProviderCount: number;
    liveLoginProviderCount: number;
    oidcProviderCount: number;
    oauth2ProviderCount: number;
    ldapProviderCount: number;
    samlProviderCount: number;
    localFallbackVerified: boolean;
    mfaFallbackVerified: boolean;
  };
  secretBackends: {
    managedSecretBackendCount: number;
    vaultSecretWriteCount: number;
    externalSecretReferenceCount: number;
    secretResolutionCheckCount: number;
  };
  directory: {
    directoryProviderCount: number;
    directoryLookupCount: number;
    mappedGroupCount: number;
    workspaceMappingCount: number;
    directorySyncPreviewChangeCount: number;
    directorySyncAppliedChangeCount: number;
    policyViolationCount: number;
  };
  lifecycle: {
    deprovisionedUserCount: number;
    scimUserLifecycleCount: number;
    scimGroupLifecycleCount: number;
    disabledUserCount: number;
    revokedSessionCount: number;
  };
  accessReview: {
    checked: boolean;
    reportUserCount: number;
    reportGroupCount: number;
    reportGrantCount: number;
    exportedCsv: boolean;
  };
  redaction: {
    evidenceFileBodiesReturned: false;
    rawDirectoryEntriesReturned: false;
    rawEmailAddressesReturned: false;
    rawEvidencePathsReturned: false;
    rawGroupNamesReturned: false;
    rawIdpResponsesReturned: false;
    rawLdapDnsReturned: false;
    rawProviderEndpointsReturned: false;
    rawSamlAssertionsReturned: false;
    rawSecretRefsReturned: false;
    secretValuesReturned: false;
    tokenValuesReturned: false;
  };
  warnings: IdentityLivePostureWarning[];
}

export type AnalyticsAuthzPostureWarning =
  | "analytics_authz_admin_readback_missing"
  | "analytics_authz_cross_org_denial_missing"
  | "analytics_authz_cross_workspace_scoping_missing"
  | "analytics_authz_csv_export_missing"
  | "analytics_authz_csv_hash_missing"
  | "analytics_authz_eval_grant_missing"
  | "analytics_authz_evidence_failed"
  | "analytics_authz_evidence_invalid"
  | "analytics_authz_evidence_not_configured"
  | "analytics_authz_evidence_not_live"
  | "analytics_authz_evidence_not_passed"
  | "analytics_authz_live_authorization_missing"
  | "analytics_authz_live_deployment_invalid"
  | "analytics_authz_live_failure_codes_present"
  | "analytics_authz_live_readback_missing"
  | "analytics_authz_live_subjects_missing"
  | "analytics_authz_non_admin_denial_missing"
  | "analytics_authz_redaction_missing"
  | "analytics_authz_required_checks_missing"
  | "analytics_authz_usage_scope_missing";

export interface AnalyticsAuthzPostureReport {
  schema: "romeo.analytics-authz-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: "romeo.analytics-authz-live-evidence.v1";
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: string[];
  };
  subjects: {
    adminSubjectCount: number;
    orgAdminSubjectCount: number;
    nonAdminSubjectCount: number;
    serviceAccountSubjectCount: number;
    crossOrgSubjectCount: number;
  };
  authorization: {
    adminSummaryAllowedCount: number;
    adminCsvAllowedCount: number;
    nonAdminSummaryDeniedCount: number;
    nonAdminCsvDeniedCount: number;
    missingUsageScopeDeniedCount: number;
    evalGrantDeniedCount: number;
    crossOrgDeniedCount: number;
    crossWorkspaceScopedCount: number;
  };
  analytics: {
    summaryReadCount: number;
    csvExportReadCount: number;
    evalEvidenceReadCount: number;
    csvSha256Count: number;
    usageMetricCount: number;
    evalSuiteCount: number;
    jobSummaryCount: number;
    providerSummaryCount: number;
  };
  redaction: {
    apiKeysReturned: false;
    evidenceFileBodiesReturned: false;
    rawAnalyticsCsvRowsReturned: false;
    rawEvalInputsReturned: false;
    rawEvalOutputsReturned: false;
    rawEvidencePathsReturned: false;
    rawHumanRatingCommentsReturned: false;
    rawJobPayloadsReturned: false;
    rawOrgNamesReturned: false;
    rawProviderConfigReturned: false;
    rawSecretRefsReturned: false;
    rawToolInputsReturned: false;
    rawUsageMetadataReturned: false;
    rawUserEmailsReturned: false;
    rawWorkspaceNamesReturned: false;
    secretValuesReturned: false;
    tokenValuesReturned: false;
  };
  warnings: AnalyticsAuthzPostureWarning[];
}

export interface AdminAnalyticsEvalSuiteSummary {
  suiteId: string;
  agentId: string;
  workspaceId: string;
  latestRunId?: string;
  latestStatus: "failed" | "missing" | "passed";
  latestScore?: number;
  latestCompletedAt?: string;
  runCount: number;
}

export interface AdminAnalyticsEvalAgentSummary {
  agentId: string;
  workspaceId: string;
  latestCompletedAt?: string;
  latestRunId?: string;
  latestScore?: number;
  latestStatus: "failed" | "missing" | "not_required" | "passed";
  runCount: number;
  suiteCount: number;
}

export interface AdminAnalyticsEvalModelSummary {
  averageScore: number;
  failedRunCount: number;
  latestCompletedAt?: string;
  latestRunId?: string;
  modelId: string;
  passedRunCount: number;
  runCount: number;
}

export interface AdminAnalyticsEvalSummary {
  agentCount: number;
  agents: AdminAnalyticsEvalAgentSummary[];
  averageLatestScore: number | null;
  byModel: AdminAnalyticsEvalModelSummary[];
  failedSuiteCount: number;
  generatedRunCount: number;
  missingSuiteCount: number;
  passedSuiteCount: number;
  releaseGate: {
    failedSuiteCount: number;
    missingSuiteCount: number;
    requiredSuiteCount: number;
    status: "failed" | "missing" | "not_required" | "passed";
  };
  status: "failed" | "missing" | "not_required" | "passed";
  suiteCount: number;
  suites: AdminAnalyticsEvalSuiteSummary[];
}

export interface AdminAnalyticsUsageMetric {
  estimatedCostUsd: number;
  metric: string;
  providerId?: string;
  quantity: number;
  unit: string;
}

export interface AdminAnalyticsUsageSummary {
  byProvider: AdminAnalyticsUsageMetric[];
  eventCount: number;
  estimatedCostUsd: number;
  totals: AdminAnalyticsUsageMetric[];
}

export interface AdminAnalyticsProviderSummary {
  alertCount: number;
  availableProviderCount: number;
  criticalAlertCount: number;
  degradedProviderCount: number;
  providerCount: number;
  status: "critical" | "degraded" | "healthy";
  unavailableProviderCount: number;
}

export interface AdminAnalyticsToolSummary {
  approvalRequiredCount: number;
  blockedCount: number;
  byTool: Array<{
    approvalRequiredCount: number;
    blockedCount: number;
    failureCount: number;
    pendingApprovalCount: number;
    successCount: number;
    toolId: string;
    totalCount: number;
  }>;
  failureCount: number;
  pendingApprovalCount: number;
  successCount: number;
  totalCount: number;
}

export interface AdminAnalyticsJobSummary {
  alertCount: number;
  completed: number;
  criticalAlertCount: number;
  deadLettered: number;
  failed: number;
  queued: number;
  running: number;
  status: "critical" | "degraded" | "healthy";
  total: number;
}

export interface AdminAnalyticsSummary {
  evals: AdminAnalyticsEvalSummary;
  generatedAt: string;
  jobs: AdminAnalyticsJobSummary;
  orgId: string;
  providers: AdminAnalyticsProviderSummary;
  redaction: {
    rawEvalInputsReturned: false;
    rawEvalOutputsReturned: false;
    rawJobPayloadsReturned: false;
    rawProviderConfigReturned: false;
    rawToolInputsReturned: false;
    rawUsageMetadataReturned: false;
  };
  status: "critical" | "degraded" | "healthy";
  tools: AdminAnalyticsToolSummary;
  usage: AdminAnalyticsUsageSummary;
}

export type PostgresOperationalWarningCode =
  | "archival_partitioning_decision_required"
  | "live_lock_telemetry_required"
  | "postgres_archival_decision_failures_present"
  | "postgres_connection_security_warning"
  | "postgres_lock_telemetry_failures_present"
  | "postgres_slow_query_failures_present"
  | "representative_query_plan_evidence_required"
  | "slow_query_telemetry_required";

export type PostgresConnectionSecurityWarning =
  | "postgres_database_url_invalid"
  | "postgres_hosted_tls_not_configured"
  | "postgres_hosted_tls_verification_recommended";

export interface PostgresOperationalPostureReport {
  schema: "romeo.postgres-operational-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  repository: {
    driver: "memory" | "postgres";
    databaseUrlConfigured: boolean;
    postgresRequiredForProduction: boolean;
  };
  pool: {
    maxConnectionsPerProcess: number;
    source: "POSTGRES_POOL_MAX";
    sizingGuide: "docs/deployment-sizing.md";
    budgetFormula: string;
  };
  connectionSecurity: {
    databaseUrlValid: boolean;
    hostCategory: "invalid" | "internal" | "local" | "missing" | "remote";
    hostedPostgresTlsRecommended: boolean;
    sslmodeSource: "none" | "ssl" | "sslmode";
    tlsConfigured: boolean;
    tlsMode:
      | "allow"
      | "disable"
      | "prefer"
      | "require"
      | "unknown"
      | "verify_ca"
      | "verify_full";
    tlsVerification:
      | "certificate_authority"
      | "full"
      | "none"
      | "opportunistic"
      | "unknown";
    warningCodes: PostgresConnectionSecurityWarning[];
    redaction: {
      databaseUrlReturned: false;
      hostReturned: false;
      passwordReturned: false;
      usernameReturned: false;
    };
  };
  queryPlanReview: {
    evidenceSchema: "romeo.postgres-query-plan-review.v1";
    command: "pnpm review:postgres-query-plans";
    reviewedPathCount: number;
    requiredIndexCount: number;
    categories: string[];
    checks: Array<{
      id: string;
      category: string;
      expectedIndexCount: number;
    }>;
    representativeVolumeEvidence: {
      requiredForGa: true;
      status: "invalid" | "required" | "satisfied";
      evidenceSource: "configured_file" | "not_configured";
      configured: boolean;
      representativeVolume: boolean;
      evidenceStatus?: "failed" | "passed" | "unknown";
      schemaVersion?: "romeo.postgres-query-plan-review.v1";
      generatedAt?: string;
      invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
      missingExpectedIndexCount: number;
      failedCheckCount: number;
    };
  };
  slowQueryTelemetry: {
    requiredForProduction: true;
    status: "external_required" | "invalid" | "satisfied";
    expectedSignals: string[];
    evidence: {
      configured: boolean;
      schemaVersion?: "romeo.postgres-slow-query-telemetry.v1";
      generatedAt?: string;
      evidenceStatus?: "failed" | "passed" | "unknown";
      invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
      windowMinutes?: number;
      fingerprintCount: number;
      slowQueryCount: number;
      totalCalls: number;
      maxMeanMs?: number;
      maxP95Ms?: number;
      maxP99Ms?: number;
      tempFileStatementCount: number;
      failureCodes: string[];
    };
  };
  lockTelemetry: {
    requiredForProduction: true;
    status: "external_required" | "invalid" | "satisfied";
    expectedSignals: string[];
    evidence: {
      configured: boolean;
      schemaVersion?: "romeo.postgres-lock-telemetry.v1";
      generatedAt?: string;
      evidenceStatus?: "failed" | "passed" | "unknown";
      invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
      windowMinutes?: number;
      blockedSessionMax: number;
      longestWaitMs?: number;
      deadlockCount: number;
      failureCodes: string[];
    };
  };
  archivalPartitioning: {
    status: "accepted" | "decision_required" | "invalid";
    currentDecision: string;
    migrationPolicy: "one_forward_migration_after_live_evidence";
    decisionInputs: string[];
    evidence: {
      configured: boolean;
      schemaVersion?: "romeo.postgres-archival-partitioning-decision.v1";
      generatedAt?: string;
      decisionStatus?: "accepted" | "deferred" | "required" | "unknown";
      invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
      migrationRequired?: boolean;
      tableCount: number;
      failureCodes: string[];
    };
  };
  redaction: {
    databaseUrlReturned: false;
    evidenceFileBodiesReturned: false;
    lockStatementReturned: false;
    queryParameterValuesReturned: false;
    rawSqlReturned: false;
    rawEvidencePathsReturned: false;
    rowDataReturned: false;
    secretValuesReturned: false;
    telemetrySampleSqlReturned: false;
  };
  warnings: PostgresOperationalWarningCode[];
}

export type GaEvidenceChecklistStatus =
  | "blocked"
  | "invalid"
  | "not_configured"
  | "passed";

export type GaEvidenceWarningCode =
  | "ga_blocked"
  | "ga_bundle_blocked"
  | "ga_bundle_invalid"
  | "ga_checklist_invalid"
  | "ga_checklist_path_not_configured"
  | "ga_target_execution_failed"
  | "ga_target_execution_invalid"
  | "ga_target_plan_invalid"
  | "ga_target_preflight_blocked"
  | "ga_target_preflight_invalid"
  | "live_environment_evidence_required";

export type GaTargetPreflightStatus =
  | "blocked"
  | "invalid"
  | "not_configured"
  | "ready";

export type GaTargetEvidencePlanStatus =
  | "blocked"
  | "invalid"
  | "not_configured"
  | "ready";

export type GaTargetExecutionStatus =
  | "blocked"
  | "failed"
  | "invalid"
  | "not_configured"
  | "not_run"
  | "partial"
  | "passed";

export type GaEvidenceBundleStatus =
  | "blocked"
  | "invalid"
  | "not_configured"
  | "passed";

export interface GaEvidencePostureGate {
  id: string;
  phase: string;
  title: string;
  status: "blocked" | "excepted" | "satisfied" | "unknown";
  requiredForGa: boolean;
  exceptionAllowed: boolean;
  environmentRequired: boolean;
  securityCritical: boolean;
  evidence: Array<{
    path: string;
    status: "failed" | "invalid_json" | "missing" | "satisfied" | "unknown";
    schemaVersion?: string;
    evidenceStatus?: string;
    failureCodes: string[];
  }>;
  exception?: {
    status: "invalid" | "valid";
    expiresAt?: string;
    failureCodes: string[];
  };
}

export interface GaTargetPreflightGate {
  id: string;
  phase: string;
  title: string;
  status: "blocked" | "ready" | "unknown";
  environmentRequired: boolean;
  securityCritical: boolean;
  evidence: Array<{
    path: string;
    status:
      | "blocked"
      | "failed"
      | "missing"
      | "ready"
      | "satisfied"
      | "unknown";
    schemaVersion?: string;
  }>;
  command?: string;
  checks: Array<{
    name: string;
    status: "blocked" | "optional" | "ready" | "unknown";
    reason?: string;
    configured?: boolean;
    required?: boolean;
    configuredNames?: string[];
    context?: string;
    origin?: string;
    path?: string;
    baselineConfigured?: boolean;
    candidateConfigured?: boolean;
    replayKind?: string;
    baselineRouteMode?: string;
    candidateRouteMode?: string;
    baselineCaseCount?: number;
    candidateCaseCount?: number;
  }>;
  notes: string[];
}

export interface GaTargetEvidencePlanGate {
  order: number;
  id: string;
  phase: string;
  title: string;
  status: "blocked" | "ready" | "unknown";
  environmentRequired: boolean;
  securityCritical: boolean;
  command?: string;
  commandRedacted: boolean;
  operatorAction: {
    state:
      | "blocked_on_prerequisites"
      | "command_redacted"
      | "ready_to_run"
      | "unknown";
    commandAvailable: boolean;
    prerequisiteBlocked: boolean;
    blockedReasonCodes: string[];
  };
  evidenceTargets: GaTargetPreflightGate["evidence"];
  requiredCommands: string[];
  requiredEnvironment: string[];
  anyOfEnvironment: string[][];
  optionalEnvironment: string[];
  requiredFiles: string[];
  checks: {
    total: number;
    ready: number;
    blocked: number;
    optional: number;
    unknown: number;
    blockedReasons: string[];
  };
  blockedChecks: Array<{
    name: string;
    reason: string;
    configured?: boolean;
  }>;
  notes: string[];
}

export interface GaEvidenceLiveGateReadiness {
  id: string;
  phase: string;
  title: string;
  securityCritical: boolean;
  checklistStatus: "blocked" | "excepted" | "satisfied" | "unknown";
  preflightStatus: "blocked" | "not_configured" | "ready" | "unknown";
  command?: string;
  checklistEvidence: {
    total: number;
    satisfied: number;
    missing: number;
    failed: number;
    invalid: number;
    unknown: number;
  };
  preflightEvidence: {
    total: number;
    ready: number;
    missing: number;
    blocked: number;
    failed: number;
    unknown: number;
  };
  checks: {
    total: number;
    ready: number;
    blocked: number;
    optional: number;
    unknown: number;
    blockedReasons: string[];
  };
  warnings: Array<
    | "live_evidence_missing"
    | "preflight_blocked"
    | "preflight_gate_missing"
    | "preflight_not_configured"
  >;
}

export interface GaEvidencePostureReport {
  schema: "romeo.ga-evidence-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "passed";
  checklist: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: GaEvidenceChecklistStatus;
    schemaVersion?: string;
    generatedAt?: string;
    strict?: boolean;
    target?: {
      profile: "default-ga" | "full-product-enterprise" | "unknown";
      fullProductEnterpriseRequired: boolean;
      deploymentTiers: string[];
      postgresModes: string[];
      qdrantLiveRequired: boolean;
      qdrantDrRequired: boolean;
      ciGovernanceLiveRequired: boolean;
      kedaRequired: boolean;
      browserAutomationRequired: boolean;
      identityLiveRequired: boolean;
      dataConnectorLiveRequired: boolean;
      toolDispatchLiveRequired: boolean;
      voiceProviderLiveRequired: boolean;
      notificationAdapterLiveRequired: boolean;
      analyticsAuthzLiveRequired: boolean;
      targetQualityVectorComparisonRequired: boolean;
      dataRightsRetentionLiveRequired: boolean;
      billingOperationsLiveRequired: boolean;
      auditIntegrityLiveRequired: boolean;
      tenantPurgeLiveRequired: boolean;
      supportBundleLiveRequired: boolean;
      targetResilienceDrillsRequired: boolean;
      postgresOperationsLiveRequired: boolean;
    };
    summary: {
      total: number;
      satisfied: number;
      excepted: number;
      blocked: number;
      environmentRequired: number;
      securityCriticalBlocked: number;
    };
    exceptionCount: number;
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
  };
  targetPreflight: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: GaTargetPreflightStatus;
    schemaVersion?: string;
    generatedAt?: string;
    checklist?: {
      status: string;
      schemaVersion?: string;
      summary: {
        total: number;
        satisfied: number;
        excepted: number;
        blocked: number;
        environmentRequired: number;
        securityCriticalBlocked: number;
      };
    };
    summary: {
      total: number;
      ready: number;
      blocked: number;
      securityCriticalBlocked: number;
    };
    gates: GaTargetPreflightGate[];
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
  };
  targetPlan: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: GaTargetEvidencePlanStatus;
    schemaVersion?: string;
    generatedAt?: string;
    sourcePreflight?: {
      schemaVersion?: string;
      status: string;
      checklist?: {
        status: string;
        schemaVersion?: string;
        summary: {
          total: number;
          satisfied: number;
          excepted: number;
          blocked: number;
          environmentRequired: number;
          securityCriticalBlocked: number;
        };
      };
    };
    summary: {
      total: number;
      ready: number;
      blocked: number;
      environmentRequired: number;
      securityCriticalBlocked: number;
      phaseCount: number;
      commandCount: number;
      evidenceTargetCount: number;
      blockedCheckCount: number;
    };
    phases: Array<{
      phase: string;
      status: "blocked" | "ready" | "unknown";
      total: number;
      ready: number;
      blocked: number;
      securityCriticalBlocked: number;
      gateIds: string[];
    }>;
    gates: GaTargetEvidencePlanGate[];
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
  };
  targetExecution: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: GaTargetExecutionStatus;
    schemaVersion?: string;
    generatedAt?: string;
    sourcePlan?: {
      schemaVersion?: string;
      status: string;
      checklist?: {
        status: string;
        schemaVersion?: string;
        summary: {
          total: number;
          satisfied: number;
          excepted: number;
          blocked: number;
          environmentRequired: number;
          securityCriticalBlocked: number;
        };
      };
    };
    execution: {
      confirmed: boolean;
      continueOnFailure: boolean;
      timeoutMs: number;
      selectedGateCount: number;
      commandsExecuted: number;
    };
    envFile: {
      configured: boolean;
      loaded: boolean;
      variableCount: number;
      populatedVariableCount: number;
      blankVariableCount: number;
      duplicateCount: number;
      appliedVariableCount: number;
      variableNames: string[];
      warningCodes: string[];
      rawValuesReturned: false;
      rawFileBodyReturned: false;
      shellSourced: false;
      blankValuesApplied: false;
    };
    summary: {
      total: number;
      readyToRun: number;
      executed: number;
      passed: number;
      failed: number;
      skipped: number;
      confirmationRequired: number;
      blocked: number;
      redacted: number;
      commandMissing: number;
    };
    gates: Array<{
      id: string;
      phase: string;
      title: string;
      targetStatus: "blocked" | "ready" | "unknown";
      operatorActionState:
        | "blocked_on_prerequisites"
        | "command_redacted"
        | "ready_to_run"
        | "unknown";
      commandHash?: string;
      commandAvailable: boolean;
      commandRedacted: boolean;
      executionStatus: "failed" | "passed" | "skipped" | "unknown";
      skippedReason?: string;
      failureReason?: string;
      exitCode?: number;
      signal?: string;
      startedAt?: string;
      completedAt?: string;
      durationMs: number;
      evidenceTargets: Array<{
        path: string;
        status:
          | "blocked"
          | "failed"
          | "missing"
          | "ready"
          | "satisfied"
          | "unknown";
        schemaVersion?: string;
      }>;
      blockedReasonCodes: string[];
    }>;
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
  };
  bundle: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: GaEvidenceBundleStatus;
    schemaVersion?: string;
    generatedAt?: string;
    requirements: {
      checklistPassed: boolean;
      readbackValidation: boolean;
      supportBundle: boolean;
      supportRedaction: boolean;
      docsCommandCheck: boolean;
      tenantIsolation: boolean;
    };
    release?: {
      name?: string;
      version?: string;
      artifactCount: number;
    };
    ga?: {
      status: string;
      strict: boolean;
      summary: {
        total: number;
        satisfied: number;
        excepted: number;
        blocked: number;
        environmentRequired: number;
        securityCriticalBlocked: number;
      };
      profile: "default-ga" | "full-product-enterprise" | "unknown";
      fullProductEnterpriseRequired: boolean;
      qdrantLiveRequired: boolean;
      qdrantDrRequired: boolean;
      ciGovernanceLiveRequired: boolean;
      kedaRequired: boolean;
      browserAutomationRequired: boolean;
      identityLiveRequired: boolean;
      dataConnectorLiveRequired: boolean;
      toolDispatchLiveRequired: boolean;
      voiceProviderLiveRequired: boolean;
      notificationAdapterLiveRequired: boolean;
      analyticsAuthzLiveRequired: boolean;
      targetQualityVectorComparisonRequired: boolean;
      dataRightsRetentionLiveRequired: boolean;
      billingOperationsLiveRequired: boolean;
      auditIntegrityLiveRequired: boolean;
      tenantPurgeLiveRequired: boolean;
      supportBundleLiveRequired: boolean;
      targetResilienceDrillsRequired: boolean;
      postgresOperationsLiveRequired: boolean;
      blockedGateIds: string[];
      exceptionCount: number;
    };
    inventory: {
      evidenceFileCount: number;
      totalBytes: number;
      sha256?: string;
    };
    checks: {
      total: number;
      passed: number;
      failed: number;
    };
    blockerCount: number;
    blockerCodes: string[];
    redaction: {
      evidenceBodiesIncluded: boolean;
      exceptionRationaleIncluded: boolean;
      rawEvidencePathsIncluded: boolean;
      rawSecretsIncluded: boolean;
      rawLogsIncluded: boolean;
      rawPromptsIncluded: boolean;
      rawProviderPayloadsIncluded: boolean;
      rawConnectorPayloadsIncluded: boolean;
    };
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
  };
  gates: GaEvidencePostureGate[];
  requiredLiveBlockers: Array<{
    id: string;
    phase: string;
    title: string;
    securityCritical: boolean;
  }>;
  liveGateReadiness: GaEvidenceLiveGateReadiness[];
  redaction: {
    absoluteChecklistPathReturned: false;
    absoluteBundlePathReturned: false;
    bundleBlockerMessagesReturned: false;
    bundleEvidenceFileBodiesReturned: false;
    bundleEvidencePathsReturned: false;
    evidenceFileBodiesReturned: false;
    exceptionApproverReturned: false;
    exceptionOwnerReturned: false;
    exceptionRationaleReturned: false;
    preflightCommandOutputReturned: false;
    preflightEnvironmentValuesReturned: false;
    preflightFileBodiesReturned: false;
    targetPlanCommandOutputReturned: false;
    targetPlanEnvironmentValuesReturned: false;
    targetPlanEvidenceBodiesReturned: false;
    targetExecutionCommandTextReturned: false;
    targetExecutionCommandOutputReturned: false;
    targetExecutionEnvironmentValuesReturned: false;
    targetExecutionEnvFileValuesReturned: false;
    targetExecutionEnvFileBodyReturned: false;
    targetExecutionEvidenceBodiesReturned: false;
    rawEvidencePathsReturned: false;
    rawPreflightEvidencePathsReturned: false;
    rawTargetPlanEvidencePathsReturned: false;
    rawTargetExecutionEvidencePathsReturned: false;
  };
  warnings: GaEvidenceWarningCode[];
}

export interface TargetQualityPostureReport {
  schema: "romeo.target-quality-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: "romeo.target-quality-evidence.v1";
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    failureCodes: string[];
  };
  target: {
    deployment: "target-api" | "unknown";
    originConfigured: boolean;
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: string[];
  };
  health: {
    checked: boolean;
    status?: string;
    bodyBytes: number;
  };
  analytics: {
    status: "failed" | "passed" | "unknown";
    summaryStatus?: string;
    evalStatus?: string;
    evalSuiteCount: number;
    evalRunCount: number;
    usageEventCount: number;
    providerStatus?: string;
    jobStatus?: string;
    toolCallCount: number;
    csvBytes: number;
    csvSha256Present: boolean;
    redactionPassed: boolean;
  };
  evals: {
    reportCount: number;
    passedReportCount: number;
    gatePassedCount: number;
    publishBlockedCount: number;
    failedSuiteCount: number;
    missingSuiteCount: number;
    reasonCodes: string[];
    redactionPassed: boolean;
  };
  replay: {
    checked: boolean;
    status: "failed" | "passed" | "unknown";
    kind?: "compare" | "single";
    outcome?: string;
    replayStatus?: string;
    caseCount: number;
    matchedExpectedChunkCount: number;
    averagePrecision?: number | null;
    averageRecall?: number | null;
    routeModeCounts: {
      baseline?: TargetQualityRouteModeCounts;
      candidate?: TargetQualityRouteModeCounts;
      single?: TargetQualityRouteModeCounts;
    };
    vectorComparison?: {
      required: boolean;
      status: "failed" | "passed" | "unknown";
      expectedBaselineRouteMode?: "external_vector" | "pgvector" | "unknown";
      expectedCandidateRouteMode?: "external_vector" | "pgvector" | "unknown";
      baselineMatchedCount: number;
      candidateMatchedCount: number;
      baselineTotalRouteCount: number;
      candidateTotalRouteCount: number;
    };
    redactionPassed: boolean;
  };
  redaction: {
    evidenceFileBodyReturned: false;
    rawAnalyticsCsvReturned: false;
    rawEvalAgentIdsReturned: false;
    rawEvalInputsReturned: false;
    rawEvalOutputsReturned: false;
    rawEvalWorkspaceIdsReturned: false;
    rawEvidencePathReturned: false;
    rawReplayHitIdsReturned: false;
    rawReplayQueriesReturned: false;
    rawSecretsReturned: false;
    rawTargetUrlReturned: false;
  };
  warnings: Array<
    | "target_quality_analytics_missing"
    | "target_quality_eval_gate_not_passed"
    | "target_quality_evidence_failed"
    | "target_quality_evidence_invalid"
    | "target_quality_evidence_not_configured"
    | "target_quality_evidence_not_live"
    | "target_quality_health_not_ok"
    | "target_quality_redaction_missing"
    | "target_quality_replay_missing"
  >;
}

export interface TargetQualityRouteModeCounts {
  external_vector: number;
  legacy_rag_provider: number;
  lexical_fallback: number;
  pgvector: number;
}

export type AlertFiringPostureWarning =
  | "alert_firing_alertmanager_readback_failed"
  | "alert_firing_evidence_failed"
  | "alert_firing_evidence_invalid"
  | "alert_firing_evidence_not_configured"
  | "alert_firing_evidence_not_live"
  | "alert_firing_prometheus_readback_missing"
  | "alert_firing_redaction_missing"
  | "alert_firing_required_alerts_missing"
  | "alert_firing_required_checks_missing"
  | "alert_firing_required_categories_missing";

export interface AlertFiringPostureReport {
  schema: "romeo.alert-firing-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: "romeo.live-alert-firing.v1";
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    redactionPassed: boolean;
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: string[];
  };
  requiredAlerts: {
    total: number;
    providerCategoryCount: number;
    queueCategoryCount: number;
    backupCategoryCount: number;
    customCategoryCount: number;
    requiredCategoriesMissing: Array<"provider" | "queue" | "backup">;
  };
  prometheus: {
    checked: boolean;
    status: "failed" | "passed" | "unknown";
    originConfigured: boolean;
    firingAlertCount: number;
    requiredFiringCount: number;
    requiredFiringMissingCount: number;
  };
  alertmanager: {
    checked: boolean;
    status: "failed" | "passed" | "unknown";
    originConfigured: boolean;
    activeAlertCount: number;
    requiredActiveCount: number;
  };
  redaction: {
    bearerTokensReturned: false;
    evidenceFileBodyReturned: false;
    rawAlertPayloadsReturned: false;
    rawAlertmanagerResponseReturned: false;
    rawAlertmanagerUrlReturned: false;
    rawEvidencePathReturned: false;
    rawPrometheusResponseReturned: false;
    rawPrometheusUrlReturned: false;
    secretValuesReturned: false;
  };
  warnings: AlertFiringPostureWarning[];
}

export interface EdgeSecurityPostureCheck {
  id: string;
  status: "pass" | "warn";
  severity: "info" | "warning";
  message: string;
  details: Record<string, boolean | number | string>;
}

export interface EdgeSecurityPostureReport {
  status: "attention_required" | "ready";
  generatedAt: string;
  orgId: string;
  appOrigin: {
    configured: boolean;
    localhost: boolean;
    scheme: "http" | "https";
  };
  tls: {
    appOriginHttps: boolean;
    hstsEnabled: boolean;
    hstsIncludeSubdomains: boolean;
    hstsMaxAgeSeconds: number;
    hstsPreload: boolean;
    termination: "app" | "external_lb" | "ingress";
  };
  proxy: {
    mode: "direct" | "trusted_proxy";
    forwardedHeadersTrusted: boolean;
  };
  ingress: {
    allowedOriginRuleCount: number;
    wafMode: "block" | "disabled" | "monitor";
  };
  limits: {
    files: {
      directUploadMaxBytes: number;
      inlineMaxBytes: number;
      messageAttachmentMaxBytes: number;
    };
    rateLimit: {
      authenticatedMax: number;
      authMax: number;
      distributed: boolean;
      driver: "disabled" | "memory" | "valkey";
      publicMax: number;
      webhookMax: number;
      windowSeconds: number;
    };
    requestBodyMaxBytes: number;
  };
  headers: {
    contentTypeOptions: "nosniff";
    crossOriginOpenerPolicy: "same-origin";
    frameOptions: "DENY";
    permissionsPolicy: "camera=(), microphone=(), geolocation=()";
    referrerPolicy: "no-referrer";
    strictTransportSecurity: boolean;
  };
  liveEvidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: "romeo.live-edge-enforcement.v1";
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    failureCodes: string[];
    target: {
      deployment: "edge" | "unknown";
      originConfigured: boolean;
    };
    checks: {
      total: number;
      requiredTotal: number;
      requiredPresent: number;
      missingRequired: string[];
    };
    securityHeaders: {
      checked: boolean;
      status: "failed" | "passed" | "unknown";
      matchedRequiredCount: number;
      missingRequiredCount: number;
      missingRequired: Array<
        | "cross-origin-opener-policy"
        | "permissions-policy"
        | "referrer-policy"
        | "x-content-type-options"
        | "x-frame-options"
      >;
      hstsChecked: boolean;
      headerValuesReturned: boolean;
    };
    waf: {
      checked: boolean;
      status: "failed" | "passed" | "unknown";
      httpStatus?: number;
      expectedStatusCount: number;
      expectedHeaderPresent?: boolean;
      responseBodyReturned: boolean;
    };
    requestBodyLimit: {
      checked: boolean;
      status: "failed" | "passed" | "unknown";
      bytesSent: number;
      httpStatus?: number;
      expectedStatusCount: number;
      requestBodyReturned: boolean;
      responseBodyReturned: boolean;
    };
    rateLimit: {
      checked: boolean;
      status: "failed" | "passed" | "unknown";
      attempts: number;
      blockedAt?: number;
      expectedStatus?: number;
      expectedStatusObserved: boolean;
      responseBodyReturned: boolean;
    };
    redaction: {
      rawApiKeyReturned: boolean;
      rawHeaderValuesReturned: boolean;
      rawProbePayloadReturned: boolean;
      rawQueryValuesReturned: boolean;
      rawRequestBodiesReturned: boolean;
      rawResponseBodiesReturned: boolean;
    };
  };
  checks: EdgeSecurityPostureCheck[];
  redaction: {
    evidenceFileBodyReturned: false;
    rawAllowedOriginsReturned: false;
    rawAppOriginReturned: false;
    rawEvidencePathReturned: false;
    rawIngressAnnotationsReturned: false;
    rawProxyIpRangesReturned: false;
    rawSecretsReturned: false;
  };
}

export type BrowserAutomationPostureWarning =
  | "browser_automation_dead_letters_present"
  | "browser_automation_live_evidence_invalid"
  | "browser_automation_live_evidence_required"
  | "browser_automation_network_policy_not_configured"
  | "browser_automation_runner_origin_not_https"
  | "browser_automation_runner_not_configured"
  | "browser_automation_stale_tasks_present"
  | "browser_automation_worker_not_enabled";

export interface BrowserAutomationPostureReport {
  schema: "romeo.browser-automation-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  backend: {
    approvalRequired: true;
    artifactUploadTtlSeconds: number;
    maxArtifactBytes: number;
    maxAttempts: number;
    rawTaskReturnedOnlyOnActiveClaim: true;
    requiredWorkerScope: "tools:manage";
    workerQueue: "browser_automation";
    jobType: "workflow.browser_task.dispatch_request";
  };
  deployment: {
    liveEvidencePathConfigured: boolean;
    networkPolicyConfigured: boolean;
    runnerOriginConfigured: boolean;
    runnerUrlConfigured: boolean;
    workerEnabled: boolean;
    workerLeaseSeconds: number;
    workerMaxBytes: number;
    workerMaxJobs: number;
    workerTimeoutMs: number;
  };
  queue: {
    completed: number;
    deadLettered: number;
    failed: number;
    oldestQueuedAgeSeconds: number | null;
    queued: number;
    running: number;
    staleQueued: number;
    staleRunning: number;
    total: number;
  };
  artifacts: {
    allowedScreenshotContentTypes: string[];
    allowedTraceContentTypes: string[];
    registeredCount: number;
    taskCountWithRegisteredArtifacts: number;
  };
  liveEvidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "satisfied";
    schemaVersion?: "romeo.browser-automation-live-evidence.v1";
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    generatedAt?: string;
    checks: {
      reviewed_runner_sandbox: boolean;
      network_denial_enforced: boolean;
      worker_crash_retry: boolean;
      retention_worker_execution: boolean;
      pod_log_redaction: boolean;
    };
    failureCodes: string[];
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    redaction: {
      artifactBytesReturned: boolean;
      rawEvidencePathsReturned: boolean;
      rawPageContentReturned: boolean;
      rawRunnerUrlReturned: boolean;
      rawTaskTextReturned: boolean;
      secretValuesReturned: boolean;
    };
  };
  redaction: {
    evidenceFileBodiesReturned: false;
    rawArtifactStorageKeysReturned: false;
    rawEvidencePathsReturned: false;
    rawRunnerUrlReturned: false;
    rawTaskTextReturned: false;
    secretValuesReturned: false;
  };
  warnings: BrowserAutomationPostureWarning[];
}

export type VoiceProviderLivePostureWarning =
  | "voice_provider_live_artifact_missing"
  | "voice_provider_live_evidence_failed"
  | "voice_provider_live_evidence_invalid"
  | "voice_provider_live_evidence_not_configured"
  | "voice_provider_live_evidence_not_live"
  | "voice_provider_live_evidence_not_passed"
  | "voice_provider_live_deployment_invalid"
  | "voice_provider_live_failure_redaction_missing"
  | "voice_provider_live_log_redaction_missing"
  | "voice_provider_live_provider_credential_missing"
  | "voice_provider_live_provider_runtime_disabled"
  | "voice_provider_live_redaction_missing"
  | "voice_provider_live_required_checks_missing"
  | "voice_provider_live_streaming_consent_missing"
  | "voice_provider_live_transcription_missing"
  | "voice_provider_live_tts_missing";

export type NotificationAdapterLivePostureWarning =
  | "notification_adapter_live_channel_isolation_missing"
  | "notification_adapter_live_channel_mix_missing"
  | "notification_adapter_live_delivery_missing"
  | "notification_adapter_live_deployment_invalid"
  | "notification_adapter_live_egress_missing"
  | "notification_adapter_live_evidence_failed"
  | "notification_adapter_live_evidence_invalid"
  | "notification_adapter_live_evidence_not_configured"
  | "notification_adapter_live_evidence_not_live"
  | "notification_adapter_live_log_redaction_missing"
  | "notification_adapter_live_policy_invalid"
  | "notification_adapter_live_provider_credential_missing"
  | "notification_adapter_live_redaction_missing"
  | "notification_adapter_live_required_checks_missing"
  | "notification_adapter_live_retry_dead_letter_missing"
  | "notification_adapter_live_runtime_disabled"
  | "notification_adapter_live_secret_resolution_missing";

export interface NotificationAdapterLivePostureReport {
  schema: "romeo.notification-adapter-live-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  runtime: {
    deliveryDriver:
      | "configured"
      | "disabled"
      | "fcm-mobile-push"
      | "pagerduty-events"
      | "resend-email"
      | "slack-webhook"
      | "smtp-email"
      | "teams-webhook"
      | "webhook";
    emailDeliveryDriver: "resend" | "smtp";
    fcmConfigured: boolean;
    liveEvidencePathConfigured: boolean;
    pagerDutyConfigured: boolean;
    providerEndpointCount: number;
    resendConfigured: boolean;
    secretResolverConfigured: boolean;
    smtpConfigured: boolean;
  };
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: "romeo.notification-adapter-live-evidence.v1";
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<
      | "live_notification_delivery_verified"
      | "mixed_channel_type_delivery_verified"
      | "secret_ref_resolution_verified"
      | "notification_egress_policy_verified"
      | "provider_payload_redaction_verified"
      | "channel_type_isolation_verified"
      | "retry_and_dead_letter_verified"
      | "notification_log_redaction"
      | "notification_evidence_redaction_reviewed"
    >;
  };
  delivery: {
    attemptedCount: number;
    deliveryDriver:
      | "configured"
      | "disabled"
      | "fcm-mobile-push"
      | "pagerduty-events"
      | "resend-email"
      | "slack-webhook"
      | "smtp-email"
      | "teams-webhook"
      | "unknown"
      | "webhook";
    failedCount: number;
    providerFamilyCount: number;
    providerPayloadRedacted: boolean;
    successfulCount: number;
  };
  channels: {
    emailCount: number;
    mobilePushCount: number;
    mixedChannelTypesVerified: boolean;
    pagerDutyCount: number;
    slackCount: number;
    teamsCount: number;
    total: number;
    webhookCount: number;
  };
  secrets: {
    secretRefResolutionCount: number;
    secretResolverBoundaryVerified: boolean;
  };
  policy: {
    channelTypeIsolationVerified: boolean;
    deadLetterCount: number;
    retrySuccessCount: number;
    suppressionVerified: boolean;
  };
  egress: {
    hostAllowlistEnforced: boolean;
    networkPolicyEnforced: boolean;
    privateNetworkDenied: boolean;
    providerEndpointAccessVerified: boolean;
  };
  logRedaction: {
    appLogRedactionVerified: boolean;
    appLogScanCount: number;
    bodySentinelHitCount: number;
    destinationSentinelHitCount: number;
    podLogRedactionVerified: boolean;
    podLogScanCount: number;
    secretSentinelHitCount: number;
    tokenSentinelHitCount: number;
  };
  redaction: {
    evidenceFileBodyReturned: false;
    rawDestinationsReturned: false;
    rawEndpointUrlsReturned: false;
    rawEvidencePathsReturned: false;
    rawLogLinesReturned: false;
    rawMessageBodiesReturned: false;
    rawProviderResponsesReturned: false;
    rawSecretRefsReturned: false;
    secretValuesReturned: false;
    tokenValuesReturned: false;
  };
  warnings: NotificationAdapterLivePostureWarning[];
}

export interface VoiceProviderLivePostureReport {
  schema: "romeo.voice-provider-live-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  runtime: {
    catalogVoiceCount: number;
    liveEvidencePathConfigured: boolean;
    providerCredentialConfigured: boolean;
    providerDriver: "disabled" | "dev" | "openai-compatible";
    transcriptionModelConfigured: boolean;
    ttsModelConfigured: boolean;
  };
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: "romeo.voice-provider-live-evidence.v1";
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<
      | "live_tts_preview_verified"
      | "live_transcription_verified"
      | "voice_artifact_readback_verified"
      | "voice_artifact_deletion_verified"
      | "streaming_consent_reviewed"
      | "provider_failure_redaction_verified"
      | "voice_log_redaction"
      | "voice_evidence_redaction_reviewed"
    >;
  };
  provider: {
    driver: "dev" | "disabled" | "openai-compatible" | "unknown";
    catalogSyncCount: number;
    configuredVoiceCount: number;
    providerFailureRedacted: boolean;
    transcriptionRequestCount: number;
    ttsRequestCount: number;
  };
  tts: {
    livePreviewVerified: boolean;
    generatedArtifactCount: number;
    generatedAudioBytes: number;
  };
  transcription: {
    liveTranscriptionVerified: boolean;
    audioBytes: number;
    promptProvided: boolean;
    transcriptLength: number;
  };
  artifacts: {
    readbackVerified: boolean;
    readbackBytes: number;
    deleteVerified: boolean;
    deletedArtifactCount: number;
  };
  streamingConsent: {
    streamingEnabled: boolean;
    reviewed: boolean;
    reviewedPolicyCount: number;
  };
  logRedaction: {
    appLogRedactionVerified: boolean;
    podLogRedactionVerified: boolean;
    appLogScanCount: number;
    podLogScanCount: number;
    rawAudioSentinelHitCount: number;
    rawSpeechTextSentinelHitCount: number;
    rawTranscriptSentinelHitCount: number;
    secretSentinelHitCount: number;
  };
  redaction: {
    evidenceFileBodyReturned: false;
    rawAudioReturned: false;
    rawEvidencePathsReturned: false;
    rawObjectStoreKeysReturned: false;
    rawProviderEndpointReturned: false;
    rawProviderResponseReturned: false;
    rawSpeechTextReturned: false;
    rawTranscriptTextReturned: false;
    secretValuesReturned: false;
    tokenValuesReturned: false;
  };
  warnings: VoiceProviderLivePostureWarning[];
}

export type KubernetesPostureWarning =
  | "kubernetes_optional_evidence_invalid"
  | "kubernetes_required_evidence_failed"
  | "kubernetes_required_evidence_invalid"
  | "kubernetes_required_evidence_missing"
  | "kubernetes_required_evidence_planned";

export type ReleaseReadbackPostureWarning =
  | "release_readback_evidence_invalid"
  | "release_readback_evidence_not_collected"
  | "release_readback_evidence_not_configured"
  | "release_readback_evidence_not_live"
  | "release_readback_plan_blocked"
  | "release_readback_plan_invalid"
  | "release_readback_plan_not_configured"
  | "release_readback_required_artifacts_missing"
  | "release_readback_validation_failed"
  | "release_readback_validation_invalid"
  | "release_readback_validation_not_configured"
  | "release_readback_validation_not_live"
  | "release_readback_validation_redaction_missing";

export type CiGovernancePostureWarning =
  | "ci_branch_protection_plan_blocked"
  | "ci_branch_protection_plan_invalid"
  | "ci_branch_protection_plan_not_configured"
  | "ci_branch_protection_verification_failed"
  | "ci_branch_protection_verification_invalid"
  | "ci_branch_protection_verification_not_configured"
  | "ci_branch_protection_verification_not_live"
  | "ci_governance_evidence_missing"
  | "ci_governance_redaction_flags_unsafe"
  | "ci_hosted_run_verification_failed"
  | "ci_hosted_run_verification_invalid"
  | "ci_hosted_run_verification_not_configured"
  | "ci_hosted_run_verification_not_live";

export interface CiGovernancePolicySummary {
  requirePullRequest: boolean;
  requireConversationResolution: boolean;
  requireLinearHistory: boolean;
  requireSignedCommits: boolean;
  requireUpToDateBeforeMerge: boolean;
  dismissStaleApprovals: boolean;
  restrictBypassToReleaseAdmins: boolean;
  requireCodeOwnerReviews: boolean;
  requiredApprovingReviewCount?: number;
}

export interface CiGovernanceCheckSummary {
  total: number;
  passed: number;
  failed: number;
  planned: number;
  unknown: number;
}

export interface CiGovernanceBlockerSummary {
  total: number;
  codes: string[];
}

export interface CiGovernancePostureReport {
  schema: "romeo.ci-governance-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  summary: {
    planReady: boolean;
    hostedRunVerified: boolean;
    branchProtectionVerified: boolean;
    requiredStatusCheckCount: number;
    requiredWorkflowCommandCount: number;
    totalCheckCount: number;
    passedCheckCount: number;
    failedCheckCount: number;
    plannedCheckCount: number;
    blockerCount: number;
  };
  plan: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "blocked" | "invalid" | "not_configured" | "passed";
    schemaVersion?: "romeo.branch-protection-plan.v1";
    generatedAt?: string;
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    provider?: "github" | "unknown";
    workflow: {
      configured: boolean;
      jobCount: number;
    };
    policy: CiGovernancePolicySummary;
    requiredStatusCheckCount: number;
    requiredWorkflowCommandCount: number;
    checks: CiGovernanceCheckSummary;
    blockers: CiGovernanceBlockerSummary;
    redactionSafe: boolean;
  };
  hostedRun: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "blocked" | "invalid" | "not_configured" | "passed" | "planned";
    schemaVersion?: "romeo.hosted-ci-run-verification.v1";
    generatedAt?: string;
    mode?: "dry-run" | "live_github_api" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    provider?: "github_actions" | "unknown";
    plan: {
      status?: "blocked" | "passed" | "planned" | "unknown";
      requiredStatusCheckCount: number;
    };
    run: {
      observed: boolean;
      completed: boolean;
      successful: boolean;
    };
    jobs: {
      inventoryRead: boolean;
      observedJobCount: number;
      missingRequiredJobCount: number;
      failedRequiredJobCount: number;
    };
    checks: CiGovernanceCheckSummary;
    blockers: CiGovernanceBlockerSummary;
    redactionSafe: boolean;
  };
  branchProtection: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "blocked" | "invalid" | "not_configured" | "passed" | "planned";
    schemaVersion?: "romeo.branch-protection-verification.v1";
    generatedAt?: string;
    mode?: "dry-run" | "live_github_api" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    provider?: "github" | "unknown";
    plan: {
      status?: "blocked" | "passed" | "planned" | "unknown";
      requiredStatusCheckCount: number;
      policy: CiGovernancePolicySummary;
    };
    controls: {
      evaluatedCount: number;
      passedCount: number;
      failedCount: number;
      plannedCount: number;
    };
    checks: CiGovernanceCheckSummary;
    blockers: CiGovernanceBlockerSummary;
    redactionSafe: boolean;
  };
  redaction: {
    branchNamesReturned: false;
    evidenceFileBodiesReturned: false;
    jobLogsReturned: false;
    rawApiResponsesReturned: false;
    rawEvidencePathsReturned: false;
    rawStatusCheckNamesReturned: false;
    repositorySlugsReturned: false;
    runUrlsReturned: false;
    secretValuesReturned: false;
    tokenValuesReturned: false;
    workflowBodiesReturned: false;
  };
  warnings: CiGovernancePostureWarning[];
}

export type ReleaseSecurityPostureWarning =
  | "release_airgap_verification_blocked"
  | "release_airgap_verification_invalid"
  | "release_airgap_verification_not_configured"
  | "release_airgap_verification_redaction_missing"
  | "release_approval_blocked"
  | "release_approval_insufficient_approvers"
  | "release_approval_invalid"
  | "release_approval_not_configured"
  | "release_approval_redaction_missing"
  | "release_provenance_blocked"
  | "release_provenance_invalid"
  | "release_provenance_not_configured"
  | "release_provenance_redaction_missing"
  | "release_provenance_signature_missing"
  | "release_publish_plan_blocked"
  | "release_publish_plan_invalid"
  | "release_publish_plan_missing_approval"
  | "release_publish_plan_missing_provenance"
  | "release_publish_plan_not_configured"
  | "release_security_evidence_missing"
  | "release_security_version_mismatch";

export interface ReleaseSecurityReleaseSummary {
  name?: string;
  version?: string;
}

export interface ReleaseSecurityCheckSummary {
  total: number;
  passed: number;
  failed: number;
  planned: number;
  unknown: number;
}

export interface ReleaseSecurityBlockerSummary {
  total: number;
  codes: string[];
}

export interface ReleaseSecurityPostureReport {
  schema: "romeo.release-security-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  summary: {
    provenancePassed: boolean;
    approvalPassed: boolean;
    publishPlanReady: boolean;
    airgapVerified: boolean;
    signedProvenanceAttached: boolean;
    approvalMinApproversSatisfied: boolean;
    releaseVersionConsistent: boolean;
    totalCheckCount: number;
    passedCheckCount: number;
    failedCheckCount: number;
    blockerCount: number;
  };
  provenance: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "blocked" | "invalid" | "not_configured" | "passed";
    schemaVersion?: "romeo.release-provenance.v1";
    generatedAt?: string;
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    release?: ReleaseSecurityReleaseSummary;
    sourcePosture: {
      commitShaConfigured: boolean;
      sourceRepoConfigured: boolean;
      sourceRefConfigured: boolean;
      builderIdConfigured: boolean;
      ciRunUrlConfigured: boolean;
    };
    supplyChain: {
      sbomAttached: boolean;
      securityEvidenceAttached: boolean;
      releaseChannelAttached: boolean;
      signatureAttached: boolean;
      attestationAttached: boolean;
      signatureRequired: boolean;
      attestationRequired: boolean;
      ciSourceRequired: boolean;
    };
    checks: ReleaseSecurityCheckSummary;
    blockers: ReleaseSecurityBlockerSummary;
    redactionSafe: boolean;
  };
  approval: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "blocked" | "invalid" | "not_configured" | "passed";
    schemaVersion?: "romeo.release-approval.v1";
    generatedAt?: string;
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    release?: ReleaseSecurityReleaseSummary;
    approval: {
      systemConfigured: boolean;
      refConfigured: boolean;
      approverCount: number;
      minApprovers: number;
      minApproversSatisfied: boolean;
      approvedAtConfigured: boolean;
      expiresAtConfigured: boolean;
      expiredAtGeneration: boolean;
    };
    checks: ReleaseSecurityCheckSummary;
    blockers: ReleaseSecurityBlockerSummary;
    redactionSafe: boolean;
  };
  publishPlan: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "blocked" | "invalid" | "not_configured" | "ready";
    schemaVersion?: "romeo.release-publish-plan.v1";
    generatedAt?: string;
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    release?: ReleaseSecurityReleaseSummary;
    artifacts: {
      total: number;
      packageArtifacts: number;
    };
    evidence: {
      securityEvidenceIncluded: boolean;
      provenanceIncluded: boolean;
      approvalIncluded: boolean;
      releaseNotesIncluded: boolean;
    };
    policy: {
      npmProvenance: boolean;
      requireApproval: boolean;
      requireSignedProvenance: boolean;
    };
    steps: {
      total: number;
      registryPublish: number;
      gitTag: number;
      gitPush: number;
      releaseAssetPublish: number;
    };
    blockers: ReleaseSecurityBlockerSummary;
  };
  airgap: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "blocked" | "invalid" | "not_configured" | "passed";
    schemaVersion?: "romeo.airgap-bundle-verification.v1";
    generatedAt?: string;
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    release?: ReleaseSecurityReleaseSummary;
    requirements: {
      gaBundle: boolean;
      publishPlan: boolean;
      releaseReadback: boolean;
      readbackValidation: boolean;
      signedProvenance: boolean;
      approval: boolean;
    };
    bundle: {
      artifactCount: number;
      evidenceFileCount: number;
      totalBytes: number;
      inventoryHashPresent: boolean;
    };
    files: {
      manifest: boolean;
      channel: boolean;
      securityEvidence: boolean;
      sbom: boolean;
      provenance: boolean;
      approval: boolean;
      gaBundle: boolean;
      publishPlan: boolean;
      releaseReadback: boolean;
      readbackValidation: boolean;
    };
    checks: ReleaseSecurityCheckSummary;
    blockers: ReleaseSecurityBlockerSummary;
    redactionSafe: boolean;
  };
  redaction: {
    airgapBundlePathsReturned: false;
    approvalRefsReturned: false;
    approverIdsReturned: false;
    artifactBodiesReturned: false;
    attestationBodiesReturned: false;
    ciRunUrlsReturned: false;
    commandLinesReturned: false;
    environmentValuesReturned: false;
    evidenceFileBodiesReturned: false;
    gitRemotesReturned: false;
    rawEvidencePathsReturned: false;
    registryUrlsReturned: false;
    secretValuesReturned: false;
    signatureBodiesReturned: false;
    sourceRefsReturned: false;
    sourceReposReturned: false;
    tokenValuesReturned: false;
  };
  warnings: ReleaseSecurityPostureWarning[];
}

export interface ReleaseReadbackPostureReport {
  schema: "romeo.release-readback-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  summary: {
    planReady: boolean;
    readbackSatisfied: boolean;
    validationPassed: boolean;
    requiredPackageCount: number;
    requiredImageCount: number;
    requiredChartCount: number;
    requiredAssetCount: number;
    requiredReleaseAssetNamesFound: string[];
    validationCheckCount: number;
    validationChecksPassed: number;
    validationChecksFailed: number;
  };
  plan: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "blocked" | "invalid" | "not_configured" | "ready";
    schemaVersion?: "romeo.release-readback-plan.v1";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    failureCodes: string[];
    helmRepositoryConfigured: boolean;
    images: {
      total: number;
      digestPinned: number;
      requiredMatched: number;
    };
    charts: {
      total: number;
      digestPinned: number;
      requiredMatched: number;
    };
    assets: {
      total: number;
      digestPinned: number;
      requiredMatched: number;
      requiredReleaseAssetNamesFound: string[];
      requiredReleaseAssetNamesMissing: string[];
    };
  };
  readback: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: "romeo.release-readback.v1";
    generatedAt?: string;
    mode?: "dry-run" | "live_registry_readback" | "unknown";
    evidenceStatus?: "collected" | "planned" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    release?: {
      name?: string;
      version?: string;
    };
    registries: {
      npmCredentialsUsed: boolean;
      ociCredentialsUsed: boolean;
      helmCredentialsUsed: boolean;
      assetCredentialsUsed: boolean;
    };
    artifacts: {
      packages: number;
      images: number;
      ociRegistryImages: number;
      charts: number;
      helmRepositoryCharts: number;
      assets: number;
      releaseAssets: number;
    };
    failureCodes: string[];
  };
  validation: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "passed" | "planned";
    schemaVersion?: "romeo.release-readback-validation.v1";
    generatedAt?: string;
    mode?: "live_readback" | "planned_readback" | "unknown";
    validationStatus?: "fail" | "pass" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    release?: {
      name?: string;
      version?: string;
    };
    required: {
      packages: number;
      images: number;
      charts: number;
      assets: number;
      requiredReleaseAssetNamesFound: string[];
      requiredReleaseAssetNamesMissing: string[];
    };
    verified: {
      credentialedNpmRegistry: boolean;
      images: number;
      charts: number;
      releaseAssets: number;
    };
    checks: {
      total: number;
      passed: number;
      failed: number;
    };
    redactionProof: {
      status: "failed" | "passed";
      requiredFlagCount: number;
      safeFlagCount: number;
      unsafeFlagCount: number;
      missingFlagCount: number;
    };
    failureCodes: string[];
  };
  redaction: {
    evidenceFileBodiesReturned: false;
    helmRepositoryUrlsReturned: false;
    ociImageRefsReturned: false;
    packageRegistryUrlsReturned: false;
    packageTarballsReturned: false;
    rawEvidencePathsReturned: false;
    rawHelmRepositoryBodiesReturned: false;
    rawOciManifestsReturned: false;
    rawReadbackBodiesReturned: false;
    rawRegistryResponsesReturned: false;
    releaseAssetUrlsReturned: false;
    secretValuesReturned: false;
    tokenValuesReturned: false;
  };
  warnings: ReleaseReadbackPostureWarning[];
}

export interface KubernetesPostureReport {
  schema: "romeo.kubernetes-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  summary: {
    total: number;
    requiredTotal: number;
    configured: number;
    notConfigured: number;
    invalid: number;
    planned: number;
    failed: number;
    satisfied: number;
    requiredSatisfied: number;
    requiredMissing: number;
  };
  evidence: Array<{
    kind:
      | "live_smoke"
      | "workers"
      | "networkpolicy"
      | "cloudnativepg_dr"
      | "external_postgres_dr"
      | "tiered_rag"
      | "load_soak"
      | "keda"
      | "log_redaction";
    gateId: string;
    label: string;
    required: boolean;
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: string;
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    databaseMode?: "cloudnativepg" | "external-postgres" | "unknown";
    invalidReason?:
      | "database_mode_mismatch"
      | "invalid_json"
      | "read_failed"
      | "schema_mismatch";
    failureCodes: string[];
    checks: {
      total: number;
      requiredTotal: number;
      requiredPresent: number;
      missingRequired: string[];
    };
    target: {
      deployment: "kubernetes" | "unknown";
      namespaceConfigured: boolean;
      releaseConfigured: boolean;
      serviceConfigured: boolean;
      deploymentConfigured: boolean;
    };
    logRedaction: {
      configured: boolean;
      status: "failed" | "passed" | "unknown";
      scanCount: number;
      sentinelCheckCount: number;
    };
    metrics: {
      authorizedTierCount?: number;
      iterationCount?: number;
      kedaSucceededJobs?: number;
      loadRunCount?: number;
      skippedDeniedCount?: number;
      soakObservedSeconds?: number;
      soakRequestedSeconds?: number;
      vectorPlanEntryCount?: number;
      workerCount?: number;
    };
    vectorPosture?: {
      driver: "pgvector" | "qdrant" | "unknown";
      isolationMode:
        | "dedicated_vector_store_per_org"
        | "external_collection_per_org"
        | "external_namespace_per_org"
        | "pgvector_partitioned_by_org"
        | "shared_row_scope"
        | "unknown";
      externalVectorStoreDriver: "disabled" | "qdrant" | "unknown";
      externalVectorStoreRoutingActive: boolean;
      namespaceConfigured: boolean;
      namespacePolicy:
        | "knowledge_base"
        | "none"
        | "org"
        | "workspace"
        | "unknown";
      partitioningConfigured: boolean;
      partitioningPolicy:
        | "knowledge_base"
        | "none"
        | "org"
        | "workspace"
        | "unknown";
      planEntryCount: number;
      vectorScopeDriverCounts: {
        pgvector: number;
        qdrant: number;
      };
    };
  }>;
  redaction: {
    databaseUrlsReturned: false;
    evidenceFileBodiesReturned: false;
    kubernetesObjectBodiesReturned: false;
    podLogsReturned: false;
    rawEvidencePathsReturned: false;
    rawImageRefsReturned: false;
    rawNamespaceValuesReturned: false;
    secretValuesReturned: false;
  };
  warnings: KubernetesPostureWarning[];
}

export interface PgvectorPhysicalIsolationEvidenceSummary {
  configured: boolean;
  status: "failed" | "invalid" | "not_configured" | "satisfied";
  schemaVersion?: "romeo.pgvector-physical-isolation-review.v1";
  generatedAt?: string;
  evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
  evidenceMode?: "dry-run" | "live";
  invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
  tablePartitioned: boolean;
  partitionKeyIncludesOrgId: boolean;
  partitionCount: number;
  hnswIndexCount: number;
  queryPlanReviewed: boolean;
  redaction: {
    databaseUrlReturned: false;
    evidenceFileBodyReturned: false;
    rawEvidencePathReturned: false;
    rawSqlReturned: false;
    vectorValuesReturned: false;
  };
}

export interface QdrantLiveEvidenceSummary {
  configured: boolean;
  status: "failed" | "invalid" | "not_configured" | "satisfied";
  schemaVersion?: "romeo.qdrant-live-evidence.v1";
  generatedAt?: string;
  evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
  evidenceMode?: "dry-run" | "live";
  invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
  namespacePolicy?: "knowledge_base" | "none" | "org" | "workspace";
  partitioningPolicy?: "knowledge_base" | "none" | "org" | "workspace";
  collectionHealthRead: boolean;
  scopedQueryReturnedExpectedPoint: boolean;
  namespaceTrapExcluded: boolean;
  partitionTrapExcluded: boolean;
  foreignOrgTrapExcluded: boolean;
  vectorsOmittedFromQuery: boolean;
  scopedDeleteVerified: boolean;
  cleanupAttempted: boolean;
  redaction: {
    apiKeyReturned: false;
    collectionReturned: false;
    endpointReturned: false;
    evidenceFileBodyReturned: false;
    namespaceValuesReturned: false;
    partitionValuesReturned: false;
    payloadValuesReturned: false;
    pointIdsReturned: false;
    rawEvidencePathReturned: false;
    vectorValuesReturned: false;
  };
}

export interface RagPostureReport {
  generatedAt: string;
  orgId: string;
  status: "degraded" | "ready";
  vector: {
    driver: "pgvector" | "qdrant";
    authoritativeStore: "postgres";
    isolationMode: RagPolicyPhysicalVectorIsolationMode;
    pgvectorConfigured: boolean;
    externalVectorStoreConfigured: boolean;
    qdrantConfigured: boolean;
    namespaceConfigured: boolean;
    partitioningConfigured: boolean;
    postureSource: "deployment_default";
    externalStore: {
      driver: "disabled" | "qdrant";
      endpointConfigured: boolean;
      collectionConfigured: boolean;
      credentialRefConfigured: boolean;
      credentialRefValid: boolean;
      credentialRefScheme?: string;
      namespacePolicy: "knowledge_base" | "none" | "org" | "workspace";
      partitioningPolicy: "knowledge_base" | "none" | "org" | "workspace";
      configured: boolean;
      routingActive: boolean;
      evidence: QdrantLiveEvidenceSummary;
    };
    physicalIsolation: {
      policy: RagPolicyPhysicalVectorIsolation;
      deploymentMode: RagPolicyPhysicalVectorIsolationMode;
      deploymentMatched: boolean;
      evidence: PgvectorPhysicalIsolationEvidenceSummary;
      externalVectorEvidence: QdrantLiveEvidenceSummary;
      status: "deployment_mismatch" | "evidence_pending" | "satisfied";
    };
  };
  corpus: {
    workspaceCount: number;
    knowledgeBaseCount: number;
    sourceCount: number;
    indexedSourceCount: number;
    pendingSourceCount: number;
    failedSourceCount: number;
    chunkCount: number;
    embeddingCount: number;
    embeddedChunkCount: number;
    chunksMissingProviderEmbeddingCount: number;
    staleEmbeddingRecordCount: number;
    staleSourceCount: number;
    providerModelIndexCount: number;
  };
  jobs: {
    failedEmbeddingIndexJobCount: number;
    failedExtractionJobCount: number;
    failedReindexJobCount: number;
    queuedKnowledgeJobCount: number;
    runningKnowledgeJobCount: number;
  };
  fallback: {
    lexicalFallbackAvailable: boolean;
    degraded: boolean;
    reasonCodes: Array<
      | "no_provider_embeddings"
      | "partial_provider_embedding_coverage"
      | "shared_pgvector_default"
    >;
  };
  readiness: {
    warnings: Array<{
      code:
        | "failed_knowledge_jobs"
        | "failed_knowledge_sources"
        | "lexical_fallback_active"
        | "physical_vector_isolation_evidence_pending"
        | "physical_vector_isolation_mismatch"
        | "stale_embedding_records"
        | "stale_source_chunk_counts";
      count: number;
      severity: "info" | "warning";
    }>;
  };
}

export type RagPolicyTier = "org" | "shared" | "user_private" | "workspace";

export type RagPolicyBudgetMap = Record<RagPolicyTier, number>;

export interface RagPolicyProviderModel {
  providerId: string;
  model: string;
}

export interface RagPolicyKnowledgeBaseTierAssignments {
  org: string[];
  shared: string[];
}

export type RagVectorIsolationPolicy =
  | "knowledge_base"
  | "none"
  | "org"
  | "workspace";

export type RagPolicyExternalVectorMode = "deployment_managed" | "disabled";

export type RagPolicyExternalVectorDrStrategy =
  "postgres_authoritative_reindex";

export type RagPolicyExternalVectorExportPolicy = "metadata_only";

export type RagPolicyPhysicalVectorIsolationMode =
  | "dedicated_vector_store_per_org"
  | "external_collection_per_org"
  | "external_namespace_per_org"
  | "pgvector_partitioned_by_org"
  | "shared_row_scope";

export type RagPolicyPhysicalVectorIsolationEnforcement =
  | "advisory"
  | "required";

export interface RagPolicyExternalVectorStore {
  mode: RagPolicyExternalVectorMode;
  namespacePolicy: RagVectorIsolationPolicy;
  partitioningPolicy: RagVectorIsolationPolicy;
  configured: boolean;
  drStrategy: RagPolicyExternalVectorDrStrategy;
  exportPolicy: RagPolicyExternalVectorExportPolicy;
  restoreValidation: "not_required" | "required_when_enabled";
}

export interface RagPolicyPhysicalVectorIsolation {
  mode: RagPolicyPhysicalVectorIsolationMode;
  enforcement: RagPolicyPhysicalVectorIsolationEnforcement;
  configured: boolean;
  postgresAuthoritative: true;
  liveEvidenceRequired: boolean;
}

export interface RagPolicyReport {
  orgId: string;
  source: "default" | "org";
  enabledTiers: RagPolicyTier[];
  defaultMaxResultsPerTier: RagPolicyBudgetMap;
  maxResultsPerTier: RagPolicyBudgetMap;
  allowedEmbeddingProviderModels: RagPolicyProviderModel[];
  knowledgeBaseTierAssignments: RagPolicyKnowledgeBaseTierAssignments;
  dataResidencyTags: string[];
  externalVectorStore: RagPolicyExternalVectorStore;
  physicalVectorIsolation: RagPolicyPhysicalVectorIsolation;
  retention: {
    deleteVectorsOnSourceDelete: true;
    exportIncludesEmbeddingVectors: false;
  };
  enforcement: {
    tierBudgets: "enforced";
    embeddingProviderModelAllowlist: "enforced" | "unrestricted";
  };
  updatedAt?: string;
  updatedBy?: string;
}

export interface UpdateRagPolicyExternalVectorStoreInput {
  mode?: RagPolicyExternalVectorMode;
  namespacePolicy?: RagVectorIsolationPolicy;
  partitioningPolicy?: RagVectorIsolationPolicy;
  drStrategy?: RagPolicyExternalVectorDrStrategy;
  exportPolicy?: RagPolicyExternalVectorExportPolicy;
}

export interface UpdateRagPolicyPhysicalVectorIsolationInput {
  mode?: RagPolicyPhysicalVectorIsolationMode;
  enforcement?: RagPolicyPhysicalVectorIsolationEnforcement;
}

export interface UpdateRagPolicyInput {
  enabledTiers?: RagPolicyTier[];
  defaultMaxResultsPerTier?: Partial<RagPolicyBudgetMap>;
  maxResultsPerTier?: Partial<RagPolicyBudgetMap>;
  allowedEmbeddingProviderModels?: RagPolicyProviderModel[];
  knowledgeBaseTierAssignments?: Partial<RagPolicyKnowledgeBaseTierAssignments>;
  dataResidencyTags?: string[];
  externalVectorStore?: UpdateRagPolicyExternalVectorStoreInput;
  physicalVectorIsolation?: UpdateRagPolicyPhysicalVectorIsolationInput;
}

export type RagPolicyChangeJustificationCode =
  | "compliance_update"
  | "incident_response"
  | "manual_risk_reduction"
  | "retrieval_replay_improvement";

export type RagPolicyChangeRejectReasonCode =
  | "insufficient_evidence"
  | "policy_conflict"
  | "superseded"
  | "unsafe_defaults";

export type RagPolicyChangeRequestStatus = "approved" | "pending" | "rejected";

export interface RagPolicyChangeEvidenceSummary {
  replayCaseCount?: number;
  averagePrecision?: number;
  averageRecall?: number;
  averageLatencyMs?: number;
  beforeAfterComparisonAttached?: boolean;
}

export interface RagPolicyChangeRequest {
  schema: "romeo.rag-policy-change-request.v1";
  orgId: string;
  requestId: string;
  status: RagPolicyChangeRequestStatus;
  requestedBy: string;
  requestedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectReasonCode?: RagPolicyChangeRejectReasonCode;
  justificationCode?: RagPolicyChangeJustificationCode;
  evidenceSummary?: RagPolicyChangeEvidenceSummary;
  changedFields: string[];
  policyPatch: UpdateRagPolicyInput;
  before: RagPolicyReport;
  proposed: RagPolicyReport;
  applied?: RagPolicyReport;
  redaction: {
    rawQueriesReturned: false;
    rawCorpusReturned: false;
    rawChunkTextReturned: false;
    rawVectorValuesReturned: false;
    secretRefsReturned: false;
  };
}

export interface CreateRagPolicyChangeRequestInput {
  policy: UpdateRagPolicyInput;
  justificationCode?: RagPolicyChangeJustificationCode;
  evidenceSummary?: RagPolicyChangeEvidenceSummary;
}

export interface ReviewRagPolicyChangeRequestInput {
  confirmRequestId: string;
  reasonCode?: RagPolicyChangeRejectReasonCode;
}

export type AuthProviderId =
  | "active-directory"
  | "auth0"
  | "azure-ad"
  | "generic-oidc"
  | "github"
  | "google"
  | "keycloak"
  | "ldap"
  | "local"
  | "okta"
  | "saml";

export interface AuthProviderCatalogEntry {
  id: AuthProviderId;
  name: string;
  protocol: "ldap" | "local" | "oauth2" | "oidc" | "saml";
  configurationScopes: Array<"global" | "org">;
  runtimePackage: string | null;
  status: "implemented" | "planned";
  supportsJitProvisioning: boolean;
  supportsLocalFallback: boolean;
  supportsMfaDelegation: boolean;
  notes: string[];
}

export interface AuthProviderSettingSummary {
  providerId: AuthProviderId;
  enabled: boolean;
  displayName: string;
  loginOrder: number;
  allowedEmailDomains: string[];
  orgOverridesAllowed: boolean;
  disabledReason?: string;
  ldap?: AuthProviderLdapConnectionSummary;
  oauth2?: AuthProviderOAuth2ConnectionSummary;
  oidc?: AuthProviderOidcConnectionSummary;
  saml?: AuthProviderSamlConnectionSummary;
  secretRefConfigured: boolean;
  secretRefScheme?: string;
  source: "default" | "global" | "org";
}

export interface AuthProviderOrgOverrideSummary {
  providerId: AuthProviderId;
  enabled?: boolean;
  displayName?: string;
  loginOrder?: number;
  allowedEmailDomains?: string[];
  disabledReason?: string;
  ldap?: AuthProviderLdapConnectionSummary;
  oauth2?: AuthProviderOAuth2ConnectionSummary;
  oidc?: AuthProviderOidcConnectionSummary;
  saml?: AuthProviderSamlConnectionSummary;
  secretRefConfigured: boolean;
  secretRefScheme?: string;
  source: "org";
}

export interface EffectiveAuthProviderSetting extends AuthProviderSettingSummary {
  catalogStatus: "implemented" | "planned";
  protocol: AuthProviderCatalogEntry["protocol"];
  runtimePackage: string | null;
}

export interface AuthProviderSettingsReport {
  generatedAt: string;
  global: { providers: AuthProviderSettingSummary[] };
  orgOverride: { orgId: string; providers: AuthProviderOrgOverrideSummary[] };
  effective: { orgId: string; providers: EffectiveAuthProviderSetting[] };
  notes: string[];
}

export interface AuthProviderConnectionTestInput {
  providerId: AuthProviderId;
  orgId?: string;
  oauth2?: {
    clientId?: string;
    secretRef?: string;
  };
  ldap?: {
    url?: string;
    startTls?: boolean;
    baseDn?: string;
    bindDn?: string;
    secretRef?: string;
    userSearchFilter?: string;
    groupSearchBaseDn?: string;
    groupSearchFilter?: string;
  };
  oidc?: {
    issuerUrl?: string;
    clientId?: string;
  };
  saml?: {
    entryPoint?: string;
    idpCertificateRef?: string;
    spEntityId?: string;
  };
}

export interface AuthProviderConnectionTestReport {
  generatedAt: string;
  providerId: AuthProviderId;
  catalogStatus: "implemented" | "planned";
  protocol: AuthProviderCatalogEntry["protocol"];
  runtimePackage: string | null;
  configurationSource: "active_sso" | "provider_settings" | "transient_request";
  status: "disabled" | "failed" | "partial" | "passed";
  enabled: boolean;
  issuerHost?: string;
  detectedProviderPreset?: string;
  checks: AuthProviderConnectionTestCheck[];
  notes: string[];
}

export interface AuthProviderConnectionTestCheck {
  id:
    | "adapter"
    | "api"
    | "configuration"
    | "discovery"
    | "jwks"
    | "ldap_bind"
    | "ldap_search"
    | "oauth2_endpoints"
    | "saml_endpoints"
    | "secret";
  status: "fail" | "pass" | "skip";
  code: string;
}

export type ManagedSecretScope = "global" | "org";
export type ManagedSecretStorageDriver = "local" | "vault";

export type ManagedSecretPurpose =
  | "auth_provider_client_secret"
  | "data_connector_credential"
  | "model_provider_credential"
  | "tool_connector_credential";

export interface CreateManagedSecretInput {
  name?: string;
  orgId?: string;
  purpose: ManagedSecretPurpose;
  scope?: ManagedSecretScope;
  storageDriver?: ManagedSecretStorageDriver;
  targetSecretRef?: string;
  value: string;
}

export interface ManagedSecretReference {
  createdAt: string;
  nameConfigured: boolean;
  orgId?: string;
  purpose: ManagedSecretPurpose;
  scope: ManagedSecretScope;
  secretRef: string;
  secretRefScheme: "romeo-secret" | "vault";
  storageDriver: ManagedSecretStorageDriver;
  valueStored: true;
}

export interface SecretRewrapPreviewInput {
  includeDisabledMfaFactors?: boolean;
  includeGlobalManagedSecrets?: boolean;
  targetOrgId?: string;
}

export interface SecretRewrapExecuteInput extends SecretRewrapPreviewInput {
  confirmRewrap: "rewrap-secret-envelopes";
}

export interface SecretRewrapCountSummary {
  currentKeyConfigured: boolean;
  decryptableCount: number;
  eligibleCount: number;
  failedCount: number;
  failureCodes: string[];
  previousKeyConfigured: boolean;
  previousKeyDecryptableCount: number;
  rewrappedCount: number;
  [key: string]: boolean | number | string[] | undefined;
}

export interface SecretRewrapReport {
  schema: "romeo.secret-rotation-rewrap.v1";
  generatedAt: string;
  mode: "apply" | "preview";
  orgId: string;
  status: "blocked" | "completed" | "partial" | "ready";
  scope: {
    includeDisabledMfaFactors: boolean;
    includeGlobalManagedSecrets: boolean;
    targetOrgId: string;
  };
  localMfa: SecretRewrapCountSummary & {
    activeFactorCount: number;
    disabledFactorCount: number;
    pendingFactorCount: number;
    totpSecretsReturned: false;
  };
  managedSecrets: SecretRewrapCountSummary & {
    globalSecretCount: number;
    orgSecretCount: number;
    secretRefsReturned: false;
    secretValuesReturned: false;
  };
  warnings: string[];
  redaction: {
    factorIdsReturned: false;
    keyMaterialReturned: false;
    rawSecretValuesReturned: false;
    secretRefsReturned: false;
    totpSecretsReturned: false;
    userEmailsReturned: false;
  };
}

export type SecretRotationDrillPostureWarning =
  | "secret_rotation_alerting_missing"
  | "secret_rotation_dependency_review_missing"
  | "secret_rotation_drill_deployment_invalid"
  | "secret_rotation_drill_failure_codes_present"
  | "secret_rotation_evidence_failed"
  | "secret_rotation_evidence_invalid"
  | "secret_rotation_evidence_not_configured"
  | "secret_rotation_evidence_not_live"
  | "secret_rotation_evidence_not_passed"
  | "secret_rotation_new_secret_acceptance_missing"
  | "secret_rotation_old_secret_retirement_missing"
  | "secret_rotation_readiness_missing"
  | "secret_rotation_redaction_missing"
  | "secret_rotation_required_checks_missing"
  | "secret_rotation_rewrap_missing"
  | "secret_rotation_staged_cutover_missing";

export interface SecretRotationDrillPostureReport {
  schema: "romeo.secret-rotation-drill-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: "romeo.secret-rotation-drill-evidence.v1";
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: string[];
  };
  stagedCutover: {
    sessionSecretStaged: boolean;
    webhookSigningKeyCutover: boolean;
    apiOrServiceKeyContinuityVerified: boolean;
  };
  rewrap: {
    localMfaPreviewPassed: boolean;
    localMfaRewrappedCount: number;
    managedSecretsPreviewPassed: boolean;
    managedSecretsRewrappedCount: number;
    failureCount: number;
  };
  acceptance: {
    oldSecretRetiredOrRejectedCount: number;
    newSecretAcceptedCount: number;
  };
  dependencies: {
    databaseCredentialsReviewed: boolean;
    objectStoreCredentialsReviewed: boolean;
    providerCredentialCount: number;
    connectorCredentialCount: number;
  };
  readiness: {
    checked: boolean;
    readinessPassed: boolean;
    postRotationLoginPassed: boolean;
    postRotationWebhookPassed: boolean;
  };
  alerting: {
    checked: boolean;
    status: "failed" | "passed" | "unknown";
    rotationAlertCount: number;
    firingRequiredCount: number;
  };
  redaction: {
    evidenceFileBodyReturned: false;
    keyMaterialReturned: false;
    rawApiKeysReturned: false;
    rawEvidencePathsReturned: false;
    rawLogLinesReturned: false;
    rawSecretRefsReturned: false;
    rawSecretValuesReturned: false;
    rawTokensReturned: false;
    webhookSigningSecretsReturned: false;
  };
  warnings: SecretRotationDrillPostureWarning[];
}

export interface AuthProviderOidcConnectionSummary {
  issuerConfigured: boolean;
  issuerHost?: string;
  clientIdConfigured: boolean;
  groupClaim: string;
  adminGroupCount: number;
  groupMappingCount: number;
  workspaceGroupMappingCount: number;
  workspaceGroupPrefixConfigured: boolean;
}

export interface AuthProviderOidcConnectionPatch {
  issuerUrl?: string | null;
  clientId?: string | null;
  groupClaim?: string | null;
  adminGroups?: string[] | null;
  groupMap?: Record<string, string> | null;
  workspaceGroupMap?: Record<string, string> | null;
  workspaceGroupPrefix?: string | null;
}

export interface AuthProviderLdapConnectionSummary {
  adminGroupCount: number;
  baseDnConfigured: boolean;
  bindDnConfigured: boolean;
  groupMappingCount: number;
  groupSearchConfigured: boolean;
  requiredGroupCount: number;
  startTls: boolean;
  urlConfigured: boolean;
  urlHost?: string;
  userSearchFilterConfigured: boolean;
  workspaceGroupMappingCount: number;
  workspaceGroupPrefixConfigured: boolean;
}

export interface AuthProviderLdapConnectionPatch {
  adminGroups?: string[] | null;
  baseDn?: string | null;
  bindDn?: string | null;
  emailAttribute?: string | null;
  groupMap?: Record<string, string> | null;
  groupNameAttribute?: string | null;
  groupSearchBaseDn?: string | null;
  groupSearchFilter?: string | null;
  nameAttribute?: string | null;
  requiredGroups?: string[] | null;
  startTls?: boolean | null;
  url?: string | null;
  userIdAttribute?: string | null;
  userSearchFilter?: string | null;
  workspaceGroupMap?: Record<string, string> | null;
  workspaceGroupPrefix?: string | null;
}

export interface AuthProviderOAuth2ConnectionSummary {
  adminTeamCount: number;
  clientIdConfigured: boolean;
  groupMappingCount: number;
  requiredOrganizationCount: number;
  requiredTeamCount: number;
  scopeCount: number;
  workspaceTeamMappingCount: number;
  workspaceTeamPrefixConfigured: boolean;
}

export interface AuthProviderOAuth2ConnectionPatch {
  adminTeams?: string[] | null;
  clientId?: string | null;
  groupMap?: Record<string, string> | null;
  requiredOrganizations?: string[] | null;
  requiredTeams?: string[] | null;
  scopes?: string[] | null;
  workspaceTeamMap?: Record<string, string> | null;
  workspaceTeamPrefix?: string | null;
}

export interface AuthProviderSamlConnectionSummary {
  acceptedClockSkewMs: number;
  adminGroupCount: number;
  emailAttribute: string;
  entryPointConfigured: boolean;
  entryPointHost?: string;
  groupMappingCount: number;
  groupsAttribute: string;
  idpIssuerConfigured: boolean;
  maxAssertionAgeMs: number;
  nameAttribute: string;
  requiredGroupCount: number;
  signedAssertionRequired: true;
  signedResponseRequired: boolean;
  spEntityIdConfigured: boolean;
  subjectAttribute: string;
  workspaceGroupMappingCount: number;
  workspaceGroupPrefixConfigured: boolean;
}

export interface AuthProviderSamlConnectionPatch {
  acceptedClockSkewMs?: number | null;
  adminGroups?: string[] | null;
  emailAttribute?: string | null;
  entryPoint?: string | null;
  groupMap?: Record<string, string> | null;
  groupsAttribute?: string | null;
  idpIssuer?: string | null;
  maxAssertionAgeMs?: number | null;
  nameAttribute?: string | null;
  requiredGroups?: string[] | null;
  spEntityId?: string | null;
  subjectAttribute?: string | null;
  wantAuthnResponseSigned?: boolean | null;
  workspaceGroupMap?: Record<string, string> | null;
  workspaceGroupPrefix?: string | null;
}

export interface AuthProviderGlobalPatch {
  providerId: AuthProviderId;
  clear?: boolean;
  enabled?: boolean;
  displayName?: string | null;
  loginOrder?: number | null;
  allowedEmailDomains?: string[] | null;
  orgOverridesAllowed?: boolean;
  disabledReason?: string | null;
  ldap?: AuthProviderLdapConnectionPatch | null;
  oauth2?: AuthProviderOAuth2ConnectionPatch | null;
  oidc?: AuthProviderOidcConnectionPatch | null;
  saml?: AuthProviderSamlConnectionPatch | null;
  secretRef?: string | null;
}

export interface AuthProviderOrgOverridePatch {
  providerId: AuthProviderId;
  clear?: boolean;
  enabled?: boolean | null;
  displayName?: string | null;
  loginOrder?: number | null;
  allowedEmailDomains?: string[] | null;
  disabledReason?: string | null;
  ldap?: AuthProviderLdapConnectionPatch | null;
  oauth2?: AuthProviderOAuth2ConnectionPatch | null;
  oidc?: AuthProviderOidcConnectionPatch | null;
  saml?: AuthProviderSamlConnectionPatch | null;
  secretRef?: string | null;
}

export interface UpdateAuthProviderSettingsInput {
  confirmDisableLocalFallback?: boolean;
  global?: {
    providers: AuthProviderGlobalPatch[];
  };
  orgOverride?: {
    orgId?: string;
    providers: AuthProviderOrgOverridePatch[];
  };
}

export interface CreateApiKeyInput {
  name: string;
  scopes: Scope[];
}

export interface CreateGroupInput {
  name: string;
  slug?: string;
}

export interface AddGroupMemberInput {
  userId: string;
}

export interface CreateServiceAccountInput {
  name: string;
  scopes: Scope[];
}

export interface CreateServiceAccountApiKeyInput {
  serviceAccountId: string;
  name: string;
  scopes: Scope[];
}

export interface AuditLog {
  id: string;
  orgId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: "failure" | "success";
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UsageEvent {
  id: string;
  orgId: string;
  workspaceId?: string;
  actorId: string;
  sourceType: "run" | "storage" | "tool" | "voice";
  sourceId: string;
  metric: string;
  quantity: number;
  unit: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UsageSummaryMetric {
  metric: string;
  quantity: number;
  unit: string;
  estimatedCostUsd: number;
}

export interface UsageSummaryActor extends UsageSummaryMetric {
  actorId: string;
}

export interface UsageSummaryProvider extends UsageSummaryMetric {
  providerId: string;
}

export interface UsageSummary {
  totals: UsageSummaryMetric[];
  byActor: UsageSummaryActor[];
  byProvider: UsageSummaryProvider[];
}

export interface QuotaBucket {
  id: string;
  orgId: string;
  scopeType: "agent" | "api_key" | "org" | "provider" | "user" | "workspace";
  scopeId: string;
  metric: "run.started" | "storage.byte" | "tool.call";
  limit: number;
  used: number;
  resetInterval: "daily" | "monthly" | "none";
  resetAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuotaCoordinationStatus {
  driver: "disabled" | "valkey";
  enabled: boolean;
  configured: boolean;
  healthy: boolean | null;
  keyPrefix: string;
  checkedAt: string;
  details: {
    failClosed: boolean;
    statusCode: "disabled" | "healthy" | "unconfigured" | "unreachable";
  };
}

export interface BillingPlanQuotaTemplate {
  metric: QuotaBucket["metric"];
  limit: number;
  resetInterval: QuotaBucket["resetInterval"];
}

export interface BillingPlan {
  id: string;
  orgId: string;
  code: string;
  name: string;
  status: "active" | "canceled" | "past_due" | "trialing";
  source: "external" | "manual";
  quotaTemplates: BillingPlanQuotaTemplate[];
  metadata: Record<string, unknown>;
  externalCustomerId?: string;
  externalSubscriptionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApplyBillingPlanInput {
  code: string;
  name: string;
  quotaTemplates: BillingPlanQuotaTemplate[];
  status?: BillingPlan["status"];
  source?: BillingPlan["source"];
  metadata?: Record<string, unknown>;
  externalCustomerId?: string;
  externalSubscriptionId?: string;
  lifecycle?: BillingLifecycleInput;
}

export interface BillingLifecycleInput {
  cancelAt?: string | undefined;
  canceledAt?: string | undefined;
  currentPeriodEndsAt?: string | undefined;
  pastDueGraceEndsAt?: string | undefined;
  trialEndsAt?: string | undefined;
}

export interface SyncExternalBillingEventInput {
  amountCents?: number;
  currency?: string;
  eventType:
    | "customer.updated"
    | "invoice.paid"
    | "invoice.payment_failed"
    | "subscription.canceled"
    | "subscription.created"
    | "subscription.updated";
  externalCustomerId?: string;
  externalInvoiceId?: string;
  externalSubscriptionId?: string;
  invoiceStatus?: string;
  lifecycle?: BillingLifecycleInput;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
  planCode?: string;
  planName?: string;
  provider: string;
  quotaTemplates?: BillingPlanQuotaTemplate[];
  status?: BillingPlan["status"];
}

export interface BillingPlanApplyResult {
  plan: BillingPlan;
  quotas: QuotaBucket[];
}

export type BillingEntitlementQuotaStatus =
  | "limit_and_reset_interval_mismatch"
  | "limit_mismatch"
  | "matched"
  | "missing"
  | "reset_interval_mismatch";

export type BillingEntitlementWarning =
  | "billing_plan_missing"
  | "billing_status_not_entitled"
  | "quota_limit_mismatch"
  | "quota_missing"
  | "quota_reset_interval_mismatch";

export interface BillingEntitlementQuotaReport {
  metric: QuotaBucket["metric"];
  expectedLimit: number;
  expectedResetInterval: QuotaBucket["resetInterval"];
  status: BillingEntitlementQuotaStatus;
  actualLimit?: number;
  actualResetInterval?: QuotaBucket["resetInterval"];
  actualUsed?: number;
  quotaBucketId?: string;
  resetAt?: string;
}

export interface BillingEntitlementReport {
  orgId: string;
  generatedAt: string;
  status: "attention_required" | "healthy";
  billingPlanConfigured: boolean;
  quotaTemplateCount: number;
  unmanagedOrgQuotaCount: number;
  warnings: BillingEntitlementWarning[];
  billingPlan?: {
    code: string;
    name: string;
    source: BillingPlan["source"];
    status: BillingPlan["status"];
    externalCustomerConfigured: boolean;
    externalSubscriptionConfigured: boolean;
    updatedAt: string;
  };
  quotas: BillingEntitlementQuotaReport[];
}

export interface BillingEntitlementReconciliationResult {
  before: BillingEntitlementReport;
  after: BillingEntitlementReport;
  actions: {
    createdQuotaIds: string[];
    updatedQuotaIds: string[];
    unchangedQuotaIds: string[];
  };
}

export type BillingLifecycleWarning =
  | "billing_plan_missing"
  | "cancel_at_reached"
  | "past_due_grace_expired"
  | "subscription_period_expired"
  | "trial_expired";

export type BillingLifecycleRecommendedAction =
  | "mark_canceled"
  | "mark_past_due"
  | "none";

export interface BillingLifecycleReport {
  orgId: string;
  generatedAt: string;
  status: "attention_required" | "healthy";
  billingPlanConfigured: boolean;
  warnings: BillingLifecycleWarning[];
  recommendedAction: BillingLifecycleRecommendedAction;
  lifecycle: BillingLifecycleInput;
  billingPlan?: {
    code: string;
    name: string;
    source: BillingPlan["source"];
    status: BillingPlan["status"];
    externalCustomerConfigured: boolean;
    externalSubscriptionConfigured: boolean;
    updatedAt: string;
  };
}

export interface BillingLifecycleEnforcementResult {
  before: BillingLifecycleReport;
  after: BillingLifecycleReport;
  action: {
    type: BillingLifecycleRecommendedAction;
    statusChanged: boolean;
    previousStatus?: BillingPlan["status"];
    newStatus?: BillingPlan["status"];
  };
}

export type BillingOperationsPostureWarning =
  | "billing_operations_alerting_missing"
  | "billing_operations_api_readback_missing"
  | "billing_operations_cadence_missing"
  | "billing_operations_deployment_invalid"
  | "billing_operations_evidence_failed"
  | "billing_operations_evidence_invalid"
  | "billing_operations_evidence_not_configured"
  | "billing_operations_evidence_not_live"
  | "billing_operations_evidence_not_passed"
  | "billing_operations_entitlement_worker_missing"
  | "billing_operations_failure_codes_present"
  | "billing_operations_lifecycle_worker_missing"
  | "billing_operations_redaction_missing"
  | "billing_operations_required_checks_missing"
  | "billing_operations_worker_cadence_missing";

export interface BillingOperationsWorkerPosture {
  configured: boolean;
  scheduleConfigured: boolean;
  lastRunStatus: "failed" | "passed" | "unknown";
  successCount: number;
  failureCount: number;
  alertConfigured: boolean;
}

export interface BillingOperationsPostureReport {
  schema: "romeo.billing-operations-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: "romeo.billing-operations-evidence.v1";
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<
      | "billing_alerting_readback"
      | "billing_lifecycle_worker_cadence"
      | "entitlement_api_readback"
      | "entitlement_reconcile_worker_cadence"
      | "lifecycle_api_readback"
      | "worker_log_redaction"
    >;
  };
  cadence: {
    windowMinutes?: number;
    expectedRunCount: number;
    observedRunCount: number;
    missedRunCount: number;
  };
  workers: {
    entitlementReconcile: BillingOperationsWorkerPosture;
    lifecycleEnforce: BillingOperationsWorkerPosture;
  };
  apiReadback: {
    entitlementReportHealthy: boolean;
    lifecycleReportHealthy: boolean;
    mismatchCount: number;
    dueTransitionCount: number;
  };
  alerting: {
    checked: boolean;
    status: "failed" | "passed" | "unknown";
    configuredRuleCount: number;
    firingRequiredCount: number;
  };
  redaction: {
    evidenceFileBodyReturned: false;
    rawAlertPayloadsReturned: false;
    rawApiKeysReturned: false;
    rawBillingProviderPayloadsReturned: false;
    rawCustomerIdentifiersReturned: false;
    rawEvidencePathsReturned: false;
    rawWorkerLogsReturned: false;
    secretValuesReturned: false;
  };
  warnings: BillingOperationsPostureWarning[];
}

export type AuditIntegrityPostureWarning =
  | "audit_integrity_chain_missing"
  | "audit_integrity_delivery_missing"
  | "audit_integrity_deployment_invalid"
  | "audit_integrity_evidence_failed"
  | "audit_integrity_evidence_invalid"
  | "audit_integrity_evidence_not_configured"
  | "audit_integrity_evidence_not_live"
  | "audit_integrity_export_missing"
  | "audit_integrity_failure_codes_present"
  | "audit_integrity_immutability_missing"
  | "audit_integrity_redaction_missing"
  | "audit_integrity_required_checks_missing"
  | "audit_integrity_retention_missing"
  | "audit_integrity_time_sync_missing";

export interface AuditIntegrityPostureReport {
  schema: "romeo.audit-integrity-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: "romeo.audit-integrity-evidence.v1";
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<
      | "audit_evidence_redaction_flags"
      | "audit_export_configured"
      | "checksum_chain_verified"
      | "immutable_storage_reviewed"
      | "retention_policy_reviewed"
      | "siem_delivery_readback"
      | "time_sync_reviewed"
    >;
  };
  export: {
    enabled: boolean;
    destinationType: "both" | "none" | "object_store" | "siem" | "unknown";
    successfulDeliveryCount: number;
    failedDeliveryCount: number;
    lastDeliveryStatus: "failed" | "passed" | "unknown";
  };
  immutability: {
    wormStorageConfigured: boolean;
    retentionLockConfigured: boolean;
    immutableWindowDays?: number;
    deleteProtectionReviewed: boolean;
  };
  retention: {
    auditLogRetentionDays?: number;
    exportRetentionDays?: number;
    policyReviewed: boolean;
  };
  timeSync: {
    sourceConfigured: boolean;
    checkedHostCount: number;
    maxClockSkewMs?: number;
    driftWithinThreshold: boolean;
  };
  checksumChain: {
    checked: boolean;
    status: "failed" | "passed" | "unknown";
    verifiedRecordCount: number;
    brokenLinkCount: number;
  };
  redaction: {
    evidenceFileBodyReturned: false;
    rawActorIdentifiersReturned: false;
    rawAuditMetadataReturned: false;
    rawDestinationReturned: false;
    rawEvidencePathsReturned: false;
    rawSiemPayloadsReturned: false;
    secretValuesReturned: false;
  };
  warnings: AuditIntegrityPostureWarning[];
}

export type MigrationDrillPostureWarning =
  | "migration_drill_deployment_invalid"
  | "migration_drill_evidence_failed"
  | "migration_drill_evidence_invalid"
  | "migration_drill_evidence_not_configured"
  | "migration_drill_evidence_not_live"
  | "migration_drill_evidence_not_passed"
  | "migration_drill_failure_codes_present"
  | "migration_drill_failure_behavior_missing"
  | "migration_drill_injection_missing"
  | "migration_drill_recovery_missing"
  | "migration_drill_redaction_missing"
  | "migration_drill_required_checks_missing"
  | "migration_drill_runbook_missing"
  | "migration_drill_validation_missing";

export interface MigrationDrillPostureReport {
  schema: "romeo.migration-drill-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: "romeo.migration-drill-evidence.v1";
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<
      | "app_cutover_blocked"
      | "failed_migration_injected"
      | "migration_failure_detected"
      | "migration_job_failed_closed"
      | "migration_log_redaction"
      | "operator_runbook_reviewed"
      | "rollback_or_retry_verified"
      | "schema_validation_after_recovery"
    >;
  };
  drill: {
    attemptedMigrationCount: number;
    failedMigrationCount: number;
    failureInjected: boolean;
    cutoverBlocked: boolean;
  };
  job: {
    migrationJobObserved: boolean;
    failedClosed: boolean;
    retryAttemptCount: number;
    rollbackAttemptCount: number;
  };
  validation: {
    rollbackOrRetryVerified: boolean;
    schemaValidationPassed: boolean;
    appReadinessPassed: boolean;
    postRecoveryMigrationCount: number;
  };
  runbook: {
    reviewed: boolean;
    recoveryDocumented: boolean;
    reviewerCount: number;
  };
  redaction: {
    databaseUrlsReturned: false;
    evidenceFileBodyReturned: false;
    migrationLogsReturned: false;
    migrationSqlReturned: false;
    rawErrorStacksReturned: false;
    rawEvidencePathsReturned: false;
    secretValuesReturned: false;
  };
  warnings: MigrationDrillPostureWarning[];
}

export type NetworkPartitionPostureWarning =
  | "network_partition_alerting_missing"
  | "network_partition_deployment_invalid"
  | "network_partition_evidence_failed"
  | "network_partition_evidence_invalid"
  | "network_partition_evidence_not_configured"
  | "network_partition_evidence_not_live"
  | "network_partition_evidence_not_passed"
  | "network_partition_failure_codes_present"
  | "network_partition_injection_missing"
  | "network_partition_network_context_missing"
  | "network_partition_recovery_missing"
  | "network_partition_redaction_missing"
  | "network_partition_required_checks_missing"
  | "network_partition_runtime_behavior_missing";

export interface NetworkPartitionPostureReport {
  schema: "romeo.network-partition-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: "romeo.network-partition-evidence.v1";
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<
      | "alerting_readback"
      | "api_fail_closed_or_degraded"
      | "dependency_partition_verified"
      | "network_partition_injected"
      | "network_policy_or_cni_context_recorded"
      | "partition_log_redaction"
      | "recovery_after_partition_verified"
      | "worker_backpressure_verified"
    >;
  };
  drill: {
    partitionInjected: boolean;
    partitionedDependencyCount: number;
    partitionedServiceCount: number;
    partitionDurationSeconds?: number;
  };
  runtime: {
    apiDegraded: boolean;
    failClosedCount: number;
    backpressureObserved: boolean;
    workerStormPrevented: boolean;
  };
  recovery: {
    checked: boolean;
    recoveredDependencyCount: number;
    recoverySeconds?: number;
    postRecoveryReadbackPassed: boolean;
  };
  alerting: {
    checked: boolean;
    status: "failed" | "passed" | "unknown";
    partitionAlertCount: number;
    firingRequiredCount: number;
  };
  networkContext: {
    cniConfirmed: boolean;
    networkPolicyApplied: boolean;
    namespaceScoped: boolean;
    egressPolicyCount: number;
  };
  redaction: {
    evidenceFileBodyReturned: false;
    rawEvidencePathsReturned: false;
    rawLogLinesReturned: false;
    rawNetworkEndpointsReturned: false;
    rawPacketCapturesReturned: false;
    rawPodIpsReturned: false;
    secretValuesReturned: false;
  };
  warnings: NetworkPartitionPostureWarning[];
}

export type ProviderOutagePostureWarning =
  | "provider_outage_alerting_missing"
  | "provider_outage_deployment_invalid"
  | "provider_outage_evidence_failed"
  | "provider_outage_evidence_invalid"
  | "provider_outage_evidence_not_configured"
  | "provider_outage_evidence_not_live"
  | "provider_outage_evidence_not_passed"
  | "provider_outage_failure_codes_present"
  | "provider_outage_injection_missing"
  | "provider_outage_operational_summary_missing"
  | "provider_outage_recovery_missing"
  | "provider_outage_redaction_missing"
  | "provider_outage_required_checks_missing"
  | "provider_outage_runtime_behavior_missing";

export interface ProviderOutagePostureReport {
  schema: "romeo.provider-outage-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  evidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: "romeo.provider-outage-evidence.v1";
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    failureCodes: string[];
  };
  checks: {
    total: number;
    requiredTotal: number;
    requiredPresent: number;
    missingRequired: Array<
      | "fallback_routing_verified"
      | "kill_switch_verified"
      | "operational_summary_readback"
      | "provider_alerting_readback"
      | "provider_circuit_open"
      | "provider_log_redaction"
      | "provider_outage_injected"
      | "provider_recovery_verified"
      | "provider_timeout_observed"
    >;
  };
  drill: {
    providerCount: number;
    outageInjectedCount: number;
    timeoutObservedCount: number;
  };
  runtime: {
    circuitOpenCount: number;
    fallbackRoutedCount: number;
    killSwitchVerifiedCount: number;
  };
  operationalSummary: {
    checked: boolean;
    degradedProviderCount: number;
    circuitOpenProviderCount: number;
    fallbackAvailable: boolean;
    killSwitchActiveCount: number;
    alertCodeCount: number;
  };
  alerting: {
    checked: boolean;
    status: "failed" | "passed" | "unknown";
    providerAlertCount: number;
    firingRequiredCount: number;
  };
  recovery: {
    checked: boolean;
    recoveredProviderCount: number;
    recoverySeconds?: number;
  };
  redaction: {
    evidenceFileBodyReturned: false;
    rawAlertPayloadsReturned: false;
    rawApiKeysReturned: false;
    rawEvidencePathsReturned: false;
    rawPromptsReturned: false;
    rawProviderErrorsReturned: false;
    rawProviderPayloadsReturned: false;
    rawProviderResponsesReturned: false;
    secretValuesReturned: false;
  };
  warnings: ProviderOutagePostureWarning[];
}

export type AbuseControlBlockReason =
  | "billing_plan_missing"
  | "billing_status_blocked"
  | "connector_kill_switch"
  | "org_suspended"
  | "provider_kill_switch"
  | "tool_kill_switch"
  | "worker_class_kill_switch";

export interface AbuseControlPolicyReport {
  orgId: string;
  source: "default" | "org";
  generatedAt: string;
  suspension: {
    suspended: boolean;
    reasonCode?: string;
    suspendedAt?: string;
    suspendedBy?: string;
  };
  entitlements: {
    enforceBillingStatus: boolean;
    denyWhenBillingPlanMissing: boolean;
    allowedBillingStatuses: BillingPlan["status"][];
  };
  killSwitches: {
    connectorIds: string[];
    providerIds: string[];
    toolIds: string[];
    workerClasses: string[];
  };
  enforcement: {
    billingPlanConfigured: boolean;
    billingPlanCode?: string;
    billingStatus?: BillingPlan["status"];
    costWorkBlocked: boolean;
    defaultBlockReasons: AbuseControlBlockReason[];
    activeKillSwitchCount: number;
  };
  updatedAt?: string;
  updatedBy?: string;
}

export interface UpdateAbuseControlPolicyInput {
  suspension?: {
    suspended?: boolean;
    reasonCode?: string | null;
  };
  entitlements?: {
    enforceBillingStatus?: boolean;
    denyWhenBillingPlanMissing?: boolean;
    allowedBillingStatuses?: BillingPlan["status"][];
  };
  killSwitches?: {
    connectorIds?: string[];
    providerIds?: string[];
    toolIds?: string[];
    workerClasses?: string[];
  };
}

export interface UsageAlert {
  id: string;
  scopeType: QuotaBucket["scopeType"];
  scopeId: string;
  metric: string;
  used: number;
  limit: number;
  percentUsed: number;
  severity: "critical" | "exceeded" | "warning";
  resetAt?: string;
}

export interface BackgroundJob {
  id: string;
  orgId: string;
  type: string;
  status: "completed" | "failed" | "queued" | "running";
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface BackgroundJobStatusCounts {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
}

export interface BackgroundJobLagThresholds {
  deadLetterCriticalCount: number;
  deadLetterWarningCount: number;
  queuedWarningSeconds: number;
  queuedCriticalSeconds: number;
  runningWarningSeconds: number;
  runningCriticalSeconds: number;
  failedLookbackSeconds: number;
  failedWarningCount: number;
  failedCriticalCount: number;
}

export interface BackgroundJobTypeOperationalSummary extends BackgroundJobStatusCounts {
  type: string;
  deadLettered: number;
  recentFailed: number;
  oldestQueuedAgeSeconds?: number;
  oldestQueuedJobId?: string;
  longestRunningAgeSeconds?: number;
  longestRunningJobId?: string;
}

export interface BackgroundJobOperationalAlert {
  id: string;
  metric:
    | "dead_letter_jobs"
    | "queued_lag_seconds"
    | "recent_failed_jobs"
    | "running_stale_seconds";
  severity: "critical" | "warning";
  type: string;
  value: number;
  threshold: number;
  jobId?: string;
}

export interface BackgroundJobOperationalSummary {
  generatedAt: string;
  status: "critical" | "degraded" | "healthy";
  thresholds: BackgroundJobLagThresholds;
  totals: BackgroundJobStatusCounts & {
    deadLettered: number;
    recentFailed: number;
  };
  byType: BackgroundJobTypeOperationalSummary[];
  alerts: BackgroundJobOperationalAlert[];
}

export interface ReadinessCheck {
  id: string;
  status: "fail" | "pass" | "warn";
  severity: "critical" | "info" | "warning";
  message: string;
  details: Record<string, unknown>;
}

export interface ReadinessReport {
  status: "attention_required" | "ready";
  generatedAt: string;
  checks: ReadinessCheck[];
}

export interface SsoSettingsReport {
  generatedAt: string;
  configurationSource: "database" | "environment";
  status: "disabled" | "enabled" | "partial";
  localLogin: {
    seededDevelopmentLoginEnabled: boolean;
  };
  oidc: {
    detectedProviderPreset: SsoOidcProviderPresetId;
    providerPresets: SsoOidcProviderPreset[];
    bearerTokenAuthEnabled: boolean;
    browserPkceLoginEnabled: boolean;
    issuerConfigured: boolean;
    issuerHost?: string;
    clientIdConfigured: boolean;
    groupClaim: string;
    adminGroupCount: number;
    groupMappingCount: number;
    workspaceGroupMappingCount: number;
    workspaceGroupPrefixConfigured: boolean;
    jitProvisioningEnabled: boolean;
    accountLinkingEnabled: false;
  };
  notes: string[];
}

export type SsoOidcProviderPresetId =
  | "auth0"
  | "azure-ad"
  | "generic"
  | "github"
  | "google"
  | "keycloak"
  | "okta";

export interface SsoOidcProviderPreset {
  id: SsoOidcProviderPresetId;
  name: string;
  recommendedGroupClaim: string;
  issuerHint: string;
  notes: string[];
}

export interface UpdateSsoSettingsInput {
  oidc: {
    enabled?: boolean;
    issuerUrl?: string;
    clientId?: string;
    groupClaim?: string;
    adminGroups?: string[];
    groupMap?: Record<string, string>;
    workspaceGroupMap?: Record<string, string>;
    workspaceGroupPrefix?: string;
    providerPreset?: SsoOidcProviderPresetId;
  };
}

export interface DeprovisionSsoOidcUserInput {
  oidcSubject: string;
  confirmOidcSubject: string;
  issuerUrl?: string;
}

export interface SsoOidcDeprovisionResult {
  status: "already_disabled" | "disabled";
  issuerHost?: string;
  user: UserSummary;
}

export interface SsoConnectionTestReport {
  generatedAt: string;
  status: "disabled" | "failed" | "partial" | "passed";
  issuerHost?: string;
  checks: Array<{
    id: "configuration" | "discovery" | "jwks";
    status: "fail" | "pass" | "skip";
    code: string;
  }>;
  notes: string[];
}

export interface CreateQuotaBucketInput {
  scopeType: QuotaBucket["scopeType"];
  metric: QuotaBucket["metric"];
  limit: number;
  resetInterval: QuotaBucket["resetInterval"];
  scopeId?: string;
}

export interface UpdateQuotaBucketInput {
  limit?: number;
  resetInterval?: QuotaBucket["resetInterval"];
  resetUsage?: boolean;
}
