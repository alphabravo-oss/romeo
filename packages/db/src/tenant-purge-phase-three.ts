import { eq } from "drizzle-orm";

import {
  agentModels,
  auditExportAttempts,
  auditExportDestinations,
  auditExportIdempotencyReceipts,
  auditExportJobs,
  auditIntegrityCheckpoints,
  auditIntegrityRecords,
  auditIntegrityTenantHeads,
  auditLogs,
  backgroundJobs,
  baseModels,
  billingEventReceipts,
  billingPlans,
  groups,
  identities,
  localMfaChallenges,
  organizations,
  orgSsoOidcSettings,
  providerCapabilities,
  providerCredentials,
  providerInstances,
  quotaBuckets,
  retentionPolicies,
  samlAuthRequests,
  rolePermissions,
  roles,
  sessions,
  users,
  voiceProfiles,
  workspaces,
} from "./schema";
import {
  deleteByIds,
  deleteWhere,
  type TenantPurgeState,
} from "./tenant-purge-support";

export async function purgeTenantPhaseThree({
  context,
  counts,
  database,
  orgId,
}: TenantPurgeState): Promise<void> {
  await deleteWhere(
    database,
    counts,
    "agent_models",
    agentModels,
    eq(agentModels.orgId, orgId),
  );
  await deleteByIds(
    database,
    counts,
    "provider_capabilities",
    providerCapabilities,
    providerCapabilities.providerId,
    context.providerIds,
  );
  await deleteWhere(
    database,
    counts,
    "provider_credentials",
    providerCredentials,
    eq(providerCredentials.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "base_models",
    baseModels,
    eq(baseModels.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "provider_instances",
    providerInstances,
    eq(providerInstances.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "voice_profiles",
    voiceProfiles,
    eq(voiceProfiles.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "quota_buckets",
    quotaBuckets,
    eq(quotaBuckets.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "billing_event_receipts",
    billingEventReceipts,
    eq(billingEventReceipts.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "billing_plans",
    billingPlans,
    eq(billingPlans.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "retention_policies",
    retentionPolicies,
    eq(retentionPolicies.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "local_mfa_challenges",
    localMfaChallenges,
    eq(localMfaChallenges.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "saml_auth_requests",
    samlAuthRequests,
    eq(samlAuthRequests.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "org_sso_oidc_settings",
    orgSsoOidcSettings,
    eq(orgSsoOidcSettings.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "audit_export_idempotency_receipts",
    auditExportIdempotencyReceipts,
    eq(auditExportIdempotencyReceipts.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "audit_export_attempts",
    auditExportAttempts,
    eq(auditExportAttempts.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "audit_export_jobs",
    auditExportJobs,
    eq(auditExportJobs.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "audit_export_destinations",
    auditExportDestinations,
    eq(auditExportDestinations.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "audit_integrity_checkpoints",
    auditIntegrityCheckpoints,
    eq(auditIntegrityCheckpoints.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "audit_integrity_records",
    auditIntegrityRecords,
    eq(auditIntegrityRecords.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "audit_integrity_tenant_heads",
    auditIntegrityTenantHeads,
    eq(auditIntegrityTenantHeads.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "audit_logs",
    auditLogs,
    eq(auditLogs.orgId, orgId),
  );
  await deleteByIds(
    database,
    counts,
    "identities",
    identities,
    identities.userId,
    context.userIds,
  );
  await deleteByIds(
    database,
    counts,
    "sessions",
    sessions,
    sessions.userId,
    context.userIds,
  );
  await deleteByIds(
    database,
    counts,
    "role_permissions",
    rolePermissions,
    rolePermissions.roleId,
    context.roleIds,
  );
  await deleteWhere(database, counts, "roles", roles, eq(roles.orgId, orgId));
  await deleteWhere(
    database,
    counts,
    "background_jobs",
    backgroundJobs,
    eq(backgroundJobs.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "groups",
    groups,
    eq(groups.orgId, orgId),
  );
  await deleteWhere(database, counts, "users", users, eq(users.orgId, orgId));
  await deleteWhere(
    database,
    counts,
    "workspaces",
    workspaces,
    eq(workspaces.orgId, orgId),
  );
  await deleteWhere(
    database,
    counts,
    "organizations",
    organizations,
    eq(organizations.id, orgId),
  );
}
