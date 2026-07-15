export interface AuditLog {
  id: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: "success" | "failure";
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogFilter {
  action?: string;
  outcome?: "failure" | "success";
  resourceType?: string;
}

export interface AuditLogPage {
  data: AuditLog[];
  nextCursor?: string;
}

export interface BulkActionItemResult {
  id: string;
  status: "success" | "failure";
  error?: string;
}

export interface BulkActionResult {
  results: BulkActionItemResult[];
}

export interface UsageEvent {
  id: string;
  sourceType: "run" | "tool" | "storage" | "voice";
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

export interface UsageAlert {
  id: string;
  scopeType: QuotaBucket["scopeType"];
  scopeId: string;
  metric: string;
  used: number;
  limit: number;
  percentUsed: number;
  severity: "warning" | "critical" | "exceeded";
  resetAt?: string;
}

export interface BackgroundJob {
  id: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed";
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface QuotaBucket {
  id: string;
  scopeType: "org" | "user" | "workspace" | "provider" | "agent" | "api_key";
  scopeId: string;
  metric: "run.started" | "tool.call" | "storage.byte";
  limit: number;
  used: number;
  resetInterval: "none" | "daily" | "monthly";
  resetAt?: string;
  updatedAt: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  language: string;
  styleTags: string[];
  enabled: boolean;
}

export interface SpeechArtifact {
  id: string;
  contentType: string;
  storageKey: string;
  durationMs?: number;
  playbackUrl?: string;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  durationMs?: number;
}

export interface VoiceCatalogSyncResult {
  imported: number;
  existing: number;
  providerVoiceCount: number;
  profiles: VoiceProfile[];
}

export interface ApiKeySummary {
  id: string;
  name: string;
  scopes: string[];
  revokedAt?: string;
  createdAt: string;
}

export interface CreatedApiKey {
  apiKey: ApiKeySummary;
  token: string;
}

export interface ServiceAccount {
  id: string;
  name: string;
  scopes: string[];
  createdBy: string;
  disabledAt?: string;
  createdAt: string;
}

export interface RetentionPolicy {
  orgId: string;
  auditLogRetentionDays: number;
  updatedBy: string;
  updatedAt: string;
}

export interface DataDeletionCounts {
  chats: number;
  messages: number;
  messageParts: number;
  runs: number;
  runSteps: number;
  runEvents: number;
  chatComments: number;
  userNotifications: number;
  notificationDeliveries: number;
  runLinkedToolCalls: number;
  usageEvents: number;
  resourceGrants: number;
  resourceFavorites: number;
  workspaceFolderItems: number;
}

export interface DataDeletionPreview {
  schema: "romeo.data-deletion-preview.v1";
  orgId: string;
  workspaceId: string;
  resourceType: "chat";
  resourceId: string;
  legalHold?: {
    until: string;
    reason?: string;
  };
  counts: DataDeletionCounts;
  previewedAt: string;
}

export interface DataDeletionResult {
  schema: "romeo.data-deletion-result.v1";
  orgId: string;
  workspaceId: string;
  resourceType: "chat";
  resourceId: string;
  legalHold?: {
    until: string;
    reason?: string;
  };
  counts: DataDeletionCounts;
  deletedAt: string;
}

export interface ResourceGrant {
  id: string;
  resourceType: string;
  resourceId: string;
  principalType: string;
  principalId: string;
  permission: string;
}

export interface IdentityLifecyclePolicy {
  schema: "romeo.identity-lifecycle-policy.v1";
  orgId: string;
  generatedAt: string;
  policy: {
    accountLinking: "disabled";
    destructiveMembershipSync: "disabled";
    localAdminSource: "local";
    oidcGroupSync: "additive_known_groups_only";
    scim: "deferred_until_required";
    supportAccess: "time_bound_approved_audited";
  };
  accountLinking: {
    status: "disabled";
    rationale: string;
  };
  scim: {
    status: "deferred_until_required";
    supportedResources: [];
    rationale: string;
  };
  groupLifecycle: {
    localAdminSource: "local";
    oidcGroupSync: "additive_known_groups_only";
    destructiveMembershipSync: "disabled";
    unknownExternalGroups: "ignored";
  };
  deprovisioning: {
    localUserDisable: "revokes_user_api_keys_and_sessions";
    oidcFeed: "admin_confirmed_issuer_subject";
    supportAccess: "time_bound_approved_audited_revocable";
  };
}

export interface ReadinessCheck {
  id: string;
  status: "fail" | "pass" | "warn";
  severity: "critical" | "info" | "warning";
  message: string;
}

export interface ReadinessReport {
  status: "attention_required" | "ready";
  generatedAt: string;
  checks: ReadinessCheck[];
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

// --- Governance: retention enforcement, data exports, data-rights coverage,
// access-review report. Field names mirror
// packages/core/src/domain/governance.ts exactly.

export interface RetentionEnforcementResult {
  orgId: string;
  auditLogRetentionDays: number;
  cutoffAt: string;
  cleanedBrowserAutomationJobCount?: number;
  deletedBrowserAutomationArtifactCount?: number;
  deletedDataExportPackageCount?: number;
  missingDataExportPackageCount?: number;
  deletedAuditLogCount: number;
  enforcedAt: string;
}

export type DataExportScope = "org" | "workspace";

export interface DataExportRequest {
  scope: DataExportScope;
  workspaceId?: string;
  includeContent?: boolean;
  includeObjectBytes?: boolean;
  maxObjectBytes?: number;
}

export interface DataExportResolvedRequest {
  scope: DataExportScope;
  workspaceId?: string;
  includeContent: boolean;
  includeObjectBytes: boolean;
  maxObjectBytes: number;
}

export interface DataExportCounts {
  workspaces: number;
  agents: number;
  promptTemplates: number;
  chats: number;
  messages: number;
  messageParts: number;
  chatComments: number;
  knowledgeBases: number;
  knowledgeSources: number;
  knowledgeChunks: number;
  fileObjects: number;
  fileObjectBytesIncluded: number;
  knowledgeSourceBytesIncluded: number;
  dataConnectors: number;
  dataConnectorSyncs: number;
  workflows: number;
  workflowRuns: number;
  usageEvents: number;
  backgroundJobs: number;
}

export interface DataExportLimits {
  maxObjectBytes: number;
  maxTotalObjectBytes: number;
}

export interface DataExportPreview {
  schema: "romeo.data-export-preview.v1";
  orgId: string;
  request: DataExportResolvedRequest;
  counts: DataExportCounts;
  limits: DataExportLimits;
  warnings: string[];
  exclusions: string[];
  previewedAt: string;
}

export interface DataExportPackageArtifact {
  contentType: "application/json";
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
  storage: {
    driver: "object_store";
    objectKeyHash: string;
    rawObjectKeyReturned: false;
  };
}

export interface DataExportPackage {
  schema: "romeo.data-export-package.v1";
  packageId: string;
  orgId: string;
  request: DataExportResolvedRequest;
  counts: DataExportCounts;
  limits: DataExportLimits;
  warnings: string[];
  exclusions: string[];
  artifact: DataExportPackageArtifact;
  createdAt: string;
}

export interface DataExportPackageSummary {
  schema: "romeo.data-export-package-summary.v1";
  packageId: string;
  orgId: string;
  request: DataExportResolvedRequest;
  counts: DataExportCounts;
  limits: DataExportLimits;
  warnings: string[];
  exclusions: string[];
  artifact: DataExportPackageArtifact;
  createdAt: string;
}

export interface DataExportPackageList {
  schema: "romeo.data-export-package-list.v1";
  orgId: string;
  packages: DataExportPackageSummary[];
  redaction: {
    packageContentReturned: false;
    rawObjectKeysReturned: false;
  };
  generatedAt: string;
}

export interface DataExportPackageDeleteResult {
  schema: "romeo.data-export-package-delete-result.v1";
  packageId: string;
  orgId: string;
  storage: {
    driver: "object_store";
    objectKeyHash: string;
    rawObjectKeyReturned: false;
  };
  redaction: {
    packageContentReturned: false;
    rawObjectKeysReturned: false;
  };
  deletedAt: string;
}

export type DataRightsCoverageStatus =
  | "implemented"
  | "partial"
  | "planned"
  | "external_retention_required";

export interface DataRightsStorageClassCoverage {
  id: string;
  label: string;
  containsCustomerContent: boolean;
  deletionCoverage: DataRightsCoverageStatus;
  exportCoverage: DataRightsCoverageStatus;
  retentionCoverage: DataRightsCoverageStatus;
  deletionEvidence: string[];
  exportEvidence: string[];
  limitations: string[];
}

export interface DataRightsWorkflowCoverage {
  id: string;
  status: DataRightsCoverageStatus;
  scope: string;
  evidence: string[];
  limitations: string[];
}

export interface DataRightsCoverageReport {
  schema: "romeo.data-rights-coverage.v1";
  orgId: string;
  generatedAt: string;
  supportedDeletionResourceTypes: "chat"[];
  deletionWorkflows: DataRightsWorkflowCoverage[];
  exportWorkflows: DataRightsWorkflowCoverage[];
  storageClasses: DataRightsStorageClassCoverage[];
  backupRetention: {
    status: "externally_governed";
    posture: string;
    evidence: string[];
    limitations: string[];
  };
  supportBundles: {
    status: "implemented";
    evidence: string[];
    redaction: string;
  };
  openGaps: string[];
}

export interface AccessReviewSummary {
  userCount: number;
  disabledUserCount: number;
  groupCount: number;
  groupMembershipCount: number;
  serviceAccountCount: number;
  disabledServiceAccountCount: number;
  activeUserApiKeyCount: number;
  activeServiceAccountApiKeyCount: number;
  activeUserSessionCount: number;
  resourceGrantCount: number;
  dataConnectorCount: number;
  delegatedOAuthConnectionCount: number;
  toolConnectorCount: number;
  riskyToolConnectorCount: number;
  pendingSupportRequestCount: number;
  activeSupportSessionCount: number;
  runningWorkerJobCount: number;
  queuedWorkerJobCount: number;
}

// Subset of the backend AccessReviewReport limited to the fields this panel
// consumes (summary card + CSV download). Field names mirror the backend.
export interface AccessReviewReport {
  schema: "romeo.access-review-report.v1";
  orgId: string;
  generatedAt: string;
  summary: AccessReviewSummary;
  resourceGrants: ResourceGrant[];
}
