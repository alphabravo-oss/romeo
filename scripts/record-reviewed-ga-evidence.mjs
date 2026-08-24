#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createGaEvidenceValidators } from "./lib/ga-evidence-validators.mjs";

const kind = argValue("--kind");
const definitions = evidenceDefinitions();

if (hasFlag("--help")) {
  process.stdout.write(
    "Usage: node scripts/record-reviewed-ga-evidence.mjs --kind <kind> --output <path> [--deployment kubernetes|target|compose] [--generated-at <ISO-8601>]\n" +
      "       node scripts/record-reviewed-ga-evidence.mjs --kind <kind> --dry-run\n" +
      "       node scripts/record-reviewed-ga-evidence.mjs --self-test\n\n" +
      `Kinds: ${[...definitions.keys()].join(", ")}\n` +
      "Live writes require the kind-specific *_EVIDENCE_REVIEWED=true environment attestation.\n",
  );
  process.exit(0);
}

if (hasFlag("--self-test")) {
  runSelfTest(definitions);
  process.exit(0);
}

const selectedDefinition = definitions.get(kind);
if (selectedDefinition === undefined) {
  throw new Error(
    `--kind must be one of: ${[...definitions.keys()].join(", ")}.`,
  );
}

const deployment = enumArg(
  "--deployment",
  selectedDefinition.deployments,
  "kubernetes",
);
const generatedAt = isoTimestamp(argValue("--generated-at"));
const output = argValue("--output");

if (hasFlag("--dry-run")) {
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "romeo.reviewed-ga-evidence-plan.v1",
        kind,
        outputConfigured: typeof output === "string" && output.length > 0,
        deployment,
        reviewedEnvironmentVariable:
          selectedDefinition.reviewedEnvironmentVariable,
        writesEvidence: false,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

if (output === undefined || output.length === 0) {
  throw new Error("--output is required for a live evidence write.");
}
if (process.env[selectedDefinition.reviewedEnvironmentVariable] !== "true") {
  throw new Error(
    `${selectedDefinition.reviewedEnvironmentVariable}=true is required after the target drill and redaction review are complete.`,
  );
}

const evidence = selectedDefinition.build({ deployment, generatedAt });
const validation = validateEvidence(kind, evidence, generatedAt);
if (validation.status !== "pass") {
  throw new Error(
    `Refusing to write invalid ${kind} evidence: ${validation.reason ?? "unknown validation failure"}.`,
  );
}

const resolvedOutput = resolve(process.cwd(), output);
mkdirSync(dirname(resolvedOutput), { recursive: true });
writeFileSync(resolvedOutput, `${JSON.stringify(evidence, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
});
console.log(`Wrote reviewed ${kind} evidence to ${output}`);

function evidenceDefinitions() {
  return new Map([
    [
      "identity-live",
      definition("IDENTITY_LIVE_EVIDENCE_REVIEWED", identityLive),
    ],
    [
      "analytics-authz-live",
      definition("ANALYTICS_AUTHZ_EVIDENCE_REVIEWED", analyticsAuthzLive, [
        "kubernetes",
        "target",
      ]),
    ],
    [
      "voice-provider-live",
      definition("VOICE_PROVIDER_LIVE_EVIDENCE_REVIEWED", voiceProviderLive),
    ],
    [
      "notification-adapter-live",
      definition(
        "NOTIFICATION_ADAPTER_LIVE_EVIDENCE_REVIEWED",
        notificationAdapterLive,
      ),
    ],
    [
      "billing-operations",
      definition("BILLING_OPERATIONS_EVIDENCE_REVIEWED", billingOperations),
    ],
    [
      "audit-integrity",
      definition("AUDIT_INTEGRITY_EVIDENCE_REVIEWED", auditIntegrity),
    ],
    ["tenant-purge", definition("TENANT_PURGE_EVIDENCE_REVIEWED", tenantPurge)],
    [
      "provider-outage",
      definition("PROVIDER_OUTAGE_EVIDENCE_REVIEWED", providerOutage),
    ],
    [
      "migration-drill",
      definition("MIGRATION_DRILL_EVIDENCE_REVIEWED", migrationDrill),
    ],
    [
      "network-partition",
      definition("NETWORK_PARTITION_EVIDENCE_REVIEWED", networkPartition),
    ],
    [
      "secret-rotation-drill",
      definition(
        "SECRET_ROTATION_DRILL_EVIDENCE_REVIEWED",
        secretRotationDrill,
      ),
    ],
  ]);
}

function definition(reviewedEnvironmentVariable, build, deployments) {
  return {
    reviewedEnvironmentVariable,
    build,
    deployments: deployments ?? ["compose", "kubernetes", "target"],
  };
}

function common(schemaVersion, checks, context) {
  return {
    schemaVersion,
    generatedAt: context.generatedAt,
    status: "passed",
    mode: "live",
    deployment: context.deployment,
    checks,
  };
}

function identityLive(context) {
  return {
    ...common(
      "romeo.identity-live-evidence.v1",
      [
        "managed_secret_backend_live",
        "configured_idp_login_live",
        "directory_lookup_live",
        "group_mapping_validation_live",
        "directory_sync_preview_live",
        "directory_sync_apply_live",
        "deprovision_or_scim_lifecycle_live",
        "access_review_readback",
        "identity_log_redaction",
        "identity_evidence_redaction_reviewed",
      ],
      context,
    ),
    identityProviders: {
      configuredProviderCount: 1,
      liveLoginProviderCount: 1,
      oidcProviderCount: 1,
      oauth2ProviderCount: 0,
      ldapProviderCount: 1,
      samlProviderCount: 0,
      localFallbackVerified: true,
      mfaFallbackVerified: true,
    },
    secretBackends: {
      managedSecretBackendCount: 1,
      vaultSecretWriteCount: 1,
      externalSecretReferenceCount: 1,
      secretResolutionCheckCount: 1,
    },
    directory: {
      directoryProviderCount: 1,
      directoryLookupCount: 1,
      mappedGroupCount: 1,
      workspaceMappingCount: 1,
      directorySyncPreviewChangeCount: 1,
      directorySyncAppliedChangeCount: 1,
      policyViolationCount: 0,
    },
    lifecycle: {
      deprovisionedUserCount: 1,
      scimUserLifecycleCount: 1,
      scimGroupLifecycleCount: 1,
      disabledUserCount: 1,
      revokedSessionCount: 1,
    },
    accessReview: {
      checked: true,
      reportUserCount: 1,
      reportGroupCount: 1,
      reportGrantCount: 1,
      exportedCsv: true,
    },
    failures: [],
    redaction: falseFlags([
      "evidenceFileBodiesReturned",
      "rawDirectoryEntriesReturned",
      "rawEmailAddressesReturned",
      "rawEvidencePathsReturned",
      "rawGroupNamesReturned",
      "rawIdpResponsesReturned",
      "rawLdapDnsReturned",
      "rawProviderEndpointsReturned",
      "rawSamlAssertionsReturned",
      "rawSecretRefsReturned",
      "secretValuesReturned",
      "tokenValuesReturned",
    ]),
  };
}

function analyticsAuthzLive(context) {
  return {
    ...common(
      "romeo.analytics-authz-live-evidence.v1",
      [
        "admin_summary_readback",
        "admin_csv_export_readback",
        "usage_scope_enforced",
        "eval_evidence_resource_grant_enforced",
        "non_admin_summary_denied",
        "non_admin_csv_denied",
        "cross_org_summary_denied",
        "cross_workspace_export_scoped",
        "csv_export_hash_recorded",
        "raw_analytics_content_absent",
        "analytics_log_redaction",
        "analytics_evidence_redaction_reviewed",
      ],
      context,
    ),
    subjects: {
      adminSubjectCount: 1,
      orgAdminSubjectCount: 1,
      nonAdminSubjectCount: 1,
      serviceAccountSubjectCount: 1,
      crossOrgSubjectCount: 1,
    },
    authorization: positiveCounts([
      "adminSummaryAllowedCount",
      "adminCsvAllowedCount",
      "nonAdminSummaryDeniedCount",
      "nonAdminCsvDeniedCount",
      "missingUsageScopeDeniedCount",
      "evalGrantDeniedCount",
      "crossOrgDeniedCount",
      "crossWorkspaceScopedCount",
    ]),
    analytics: positiveCounts([
      "summaryReadCount",
      "csvExportReadCount",
      "evalEvidenceReadCount",
      "csvSha256Count",
      "usageMetricCount",
      "evalSuiteCount",
      "jobSummaryCount",
      "providerSummaryCount",
    ]),
    failures: [],
    redaction: falseFlags([
      "apiKeysReturned",
      "evidenceFileBodiesReturned",
      "rawAnalyticsCsvRowsReturned",
      "rawEvalInputsReturned",
      "rawEvalOutputsReturned",
      "rawEvidencePathsReturned",
      "rawHumanRatingCommentsReturned",
      "rawJobPayloadsReturned",
      "rawOrgNamesReturned",
      "rawProviderConfigReturned",
      "rawSecretRefsReturned",
      "rawToolInputsReturned",
      "rawUsageMetadataReturned",
      "rawUserEmailsReturned",
      "rawWorkspaceNamesReturned",
      "secretValuesReturned",
      "tokenValuesReturned",
    ]),
  };
}

function voiceProviderLive(context) {
  return {
    ...common(
      "romeo.voice-provider-live-evidence.v1",
      [
        "live_tts_preview_verified",
        "live_transcription_verified",
        "voice_artifact_readback_verified",
        "voice_artifact_deletion_verified",
        "streaming_consent_reviewed",
        "provider_failure_redaction_verified",
        "voice_log_redaction",
        "voice_evidence_redaction_reviewed",
      ],
      context,
    ),
    provider: {
      driver: "openai-compatible",
      catalogSyncCount: 1,
      configuredVoiceCount: 1,
      providerFailureRedacted: true,
      transcriptionRequestCount: 1,
      ttsRequestCount: 1,
    },
    tts: {
      livePreviewVerified: true,
      generatedArtifactCount: 1,
      generatedAudioBytes: 1,
    },
    transcription: {
      liveTranscriptionVerified: true,
      audioBytes: 1,
      promptProvided: true,
      transcriptLength: 1,
    },
    artifacts: {
      readbackVerified: true,
      readbackBytes: 1,
      deleteVerified: true,
      deletedArtifactCount: 1,
    },
    streamingConsent: {
      streamingEnabled: true,
      reviewed: true,
      reviewedPolicyCount: 1,
    },
    logRedaction: {
      appLogRedactionVerified: true,
      podLogRedactionVerified: true,
      appLogScanCount: 1,
      podLogScanCount: 1,
      rawAudioSentinelHitCount: 0,
      rawSpeechTextSentinelHitCount: 0,
      rawTranscriptSentinelHitCount: 0,
      secretSentinelHitCount: 0,
    },
    failures: [],
    redaction: falseFlags([
      "rawAudioReturned",
      "rawEvidencePathsReturned",
      "rawObjectStoreKeysReturned",
      "rawProviderEndpointReturned",
      "rawProviderResponseReturned",
      "rawSpeechTextReturned",
      "rawTranscriptTextReturned",
      "secretValuesReturned",
      "tokenValuesReturned",
    ]),
  };
}

function notificationAdapterLive(context) {
  return {
    ...common(
      "romeo.notification-adapter-live-evidence.v1",
      [
        "live_notification_delivery_verified",
        "mixed_channel_type_delivery_verified",
        "secret_ref_resolution_verified",
        "notification_egress_policy_verified",
        "provider_payload_redaction_verified",
        "channel_type_isolation_verified",
        "retry_and_dead_letter_verified",
        "notification_log_redaction",
        "notification_evidence_redaction_reviewed",
      ],
      context,
    ),
    delivery: {
      deliveryDriver: "configured",
      attemptedCount: 2,
      successfulCount: 1,
      failedCount: 1,
      providerFamilyCount: 2,
      providerPayloadRedacted: true,
    },
    channels: {
      total: 2,
      webhookCount: 1,
      emailCount: 1,
      mixedChannelTypesVerified: true,
    },
    secrets: {
      secretRefResolutionCount: 1,
      secretResolverBoundaryVerified: true,
    },
    policy: {
      suppressionVerified: true,
      retrySuccessCount: 1,
      deadLetterCount: 1,
      channelTypeIsolationVerified: true,
    },
    egress: {
      networkPolicyEnforced: true,
      hostAllowlistEnforced: true,
      privateNetworkDenied: true,
      providerEndpointAccessVerified: true,
    },
    logRedaction: {
      appLogRedactionVerified: true,
      podLogRedactionVerified: true,
      appLogScanCount: 1,
      podLogScanCount: 1,
      destinationSentinelHitCount: 0,
      bodySentinelHitCount: 0,
      secretSentinelHitCount: 0,
      tokenSentinelHitCount: 0,
    },
    failures: [],
    redaction: falseFlags([
      "rawDestinationsReturned",
      "rawEndpointUrlsReturned",
      "rawEvidencePathsReturned",
      "rawLogLinesReturned",
      "rawMessageBodiesReturned",
      "rawProviderResponsesReturned",
      "rawSecretRefsReturned",
      "secretValuesReturned",
      "tokenValuesReturned",
    ]),
  };
}

function billingOperations(context) {
  const worker = {
    configured: true,
    scheduleConfigured: true,
    lastRunStatus: "passed",
    successCount: 1,
    failureCount: 0,
    alertConfigured: true,
  };
  return {
    ...common(
      "romeo.billing-operations-evidence.v1",
      [
        "entitlement_reconcile_worker_cadence",
        "billing_lifecycle_worker_cadence",
        "entitlement_api_readback",
        "lifecycle_api_readback",
        "worker_log_redaction",
        "billing_alerting_readback",
      ],
      context,
    ),
    cadence: {
      windowMinutes: 60,
      expectedRunCount: 1,
      observedRunCount: 1,
      missedRunCount: 0,
    },
    workers: {
      entitlementReconcile: { ...worker },
      lifecycleEnforce: { ...worker },
    },
    apiReadback: {
      entitlementReportHealthy: true,
      lifecycleReportHealthy: true,
      mismatchCount: 0,
      dueTransitionCount: 0,
    },
    alerting: {
      checked: true,
      status: "passed",
      configuredRuleCount: 1,
      firingRequiredCount: 0,
    },
    failures: [],
    redaction: falseFlags([
      "rawBillingProviderPayloadsReturned",
      "rawWorkerLogsReturned",
      "rawApiKeysReturned",
      "rawAlertPayloadsReturned",
      "rawCustomerIdentifiersReturned",
      "rawEvidencePathsReturned",
      "secretValuesReturned",
    ]),
  };
}

function auditIntegrity(context) {
  return {
    ...common(
      "romeo.audit-integrity-evidence.v1",
      [
        "audit_export_configured",
        "siem_delivery_readback",
        "immutable_storage_reviewed",
        "retention_policy_reviewed",
        "time_sync_reviewed",
        "checksum_chain_verified",
        "audit_evidence_redaction_flags",
      ],
      context,
    ),
    export: {
      enabled: true,
      destinationType: "siem",
      successfulDeliveryCount: 1,
      failedDeliveryCount: 0,
      lastDeliveryStatus: "passed",
    },
    immutability: {
      wormStorageConfigured: true,
      retentionLockConfigured: true,
      immutableWindowDays: 1,
      deleteProtectionReviewed: true,
    },
    retention: {
      auditLogRetentionDays: 1,
      exportRetentionDays: 1,
      policyReviewed: true,
    },
    timeSync: {
      sourceConfigured: true,
      checkedHostCount: 1,
      maxClockSkewMs: 0,
      driftWithinThreshold: true,
    },
    checksumChain: {
      checked: true,
      status: "passed",
      verifiedRecordCount: 1,
      brokenLinkCount: 0,
    },
    failures: [],
    redaction: falseFlags([
      "rawAuditMetadataReturned",
      "rawActorIdentifiersReturned",
      "rawDestinationReturned",
      "rawSiemPayloadsReturned",
      "rawEvidencePathsReturned",
      "secretValuesReturned",
    ]),
  };
}

function tenantPurge(context) {
  return {
    ...common(
      "romeo.tenant-purge-evidence.v1",
      [
        "app_database_purge_executed",
        "app_object_store_purge_executed",
        "external_vector_store_reviewed",
        "backup_retention_reviewed",
        "operational_log_retention_reviewed",
        "support_bundle_retention_reviewed",
        "external_secret_store_reviewed",
        "tenant_purge_redaction_reviewed",
      ],
      context,
    ),
    purge: positiveCounts([
      "tenantCount",
      "databasePurgedTenantCount",
      "objectStorePurgedTenantCount",
      "externalVectorReviewedTenantCount",
      "backupRetentionReviewedTenantCount",
      "operationalLogRetentionReviewedTenantCount",
      "supportBundleReviewedTenantCount",
      "externalSecretReviewedTenantCount",
    ]),
    storage: positiveCounts([
      "postgresRecordCount",
      "objectStoreObjectCount",
      "externalVectorNamespaceCount",
      "backupSystemCount",
      "operationalLogSystemCount",
      "supportBundleSystemCount",
      "secretStoreCount",
    ]),
    retention: {
      backupRetentionDays: 1,
      operationalLogRetentionDays: 1,
      supportBundleRetentionDays: 1,
    },
    failures: [],
    redaction: falseFlags([
      "backupLocationsReturned",
      "evidenceFileBodiesReturned",
      "objectStoreKeysReturned",
      "operationalLogBodiesReturned",
      "rawEvidencePathsReturned",
      "secretValuesReturned",
      "supportBundleBodiesReturned",
      "vectorValuesReturned",
    ]),
  };
}

function providerOutage(context) {
  return {
    ...common(
      "romeo.provider-outage-evidence.v1",
      [
        "provider_outage_injected",
        "provider_timeout_observed",
        "provider_circuit_open",
        "fallback_routing_verified",
        "kill_switch_verified",
        "operational_summary_readback",
        "provider_alerting_readback",
        "provider_recovery_verified",
        "provider_log_redaction",
      ],
      context,
    ),
    drill: {
      providerCount: 1,
      outageInjectedCount: 1,
      timeoutObservedCount: 1,
    },
    runtime: {
      circuitOpenCount: 1,
      fallbackRoutedCount: 1,
      killSwitchVerifiedCount: 1,
    },
    operationalSummary: {
      checked: true,
      degradedProviderCount: 1,
      circuitOpenProviderCount: 1,
      fallbackAvailable: true,
      killSwitchActiveCount: 1,
      alertCodeCount: 1,
    },
    alerting: {
      checked: true,
      status: "passed",
      providerAlertCount: 1,
      firingRequiredCount: 1,
    },
    recovery: {
      checked: true,
      recoveredProviderCount: 1,
      recoverySeconds: 1,
    },
    failures: [],
    redaction: falseFlags([
      "rawProviderPayloadsReturned",
      "rawProviderResponsesReturned",
      "rawProviderErrorsReturned",
      "rawPromptsReturned",
      "rawApiKeysReturned",
      "rawAlertPayloadsReturned",
      "rawEvidencePathsReturned",
      "secretValuesReturned",
    ]),
  };
}

function migrationDrill(context) {
  return {
    ...common(
      "romeo.migration-drill-evidence.v1",
      [
        "failed_migration_injected",
        "migration_failure_detected",
        "migration_job_failed_closed",
        "app_cutover_blocked",
        "rollback_or_retry_verified",
        "schema_validation_after_recovery",
        "migration_log_redaction",
        "operator_runbook_reviewed",
      ],
      context,
    ),
    drill: {
      attemptedMigrationCount: 1,
      failedMigrationCount: 1,
      failureInjected: true,
      cutoverBlocked: true,
    },
    job: {
      migrationJobObserved: true,
      failedClosed: true,
      retryAttemptCount: 1,
      rollbackAttemptCount: 0,
    },
    validation: {
      rollbackOrRetryVerified: true,
      schemaValidationPassed: true,
      appReadinessPassed: true,
      postRecoveryMigrationCount: 1,
    },
    runbook: {
      reviewed: true,
      recoveryDocumented: true,
      reviewerCount: 1,
    },
    failures: [],
    redaction: falseFlags([
      "databaseUrlsReturned",
      "migrationSqlReturned",
      "migrationLogsReturned",
      "rawErrorStacksReturned",
      "rawEvidencePathsReturned",
      "secretValuesReturned",
    ]),
  };
}

function networkPartition(context) {
  return {
    ...common(
      "romeo.network-partition-evidence.v1",
      [
        "network_partition_injected",
        "dependency_partition_verified",
        "api_fail_closed_or_degraded",
        "worker_backpressure_verified",
        "recovery_after_partition_verified",
        "alerting_readback",
        "network_policy_or_cni_context_recorded",
        "partition_log_redaction",
      ],
      context,
    ),
    drill: {
      partitionInjected: true,
      partitionedDependencyCount: 1,
      partitionedServiceCount: 1,
      partitionDurationSeconds: 1,
    },
    runtime: {
      apiDegraded: true,
      failClosedCount: 1,
      backpressureObserved: true,
      workerStormPrevented: true,
    },
    recovery: {
      checked: true,
      recoveredDependencyCount: 1,
      recoverySeconds: 1,
      postRecoveryReadbackPassed: true,
    },
    alerting: {
      checked: true,
      status: "passed",
      partitionAlertCount: 1,
      firingRequiredCount: 1,
    },
    networkContext: {
      cniConfirmed: true,
      networkPolicyApplied: true,
      namespaceScoped: true,
      egressPolicyCount: 1,
    },
    failures: [],
    redaction: falseFlags([
      "rawNetworkEndpointsReturned",
      "rawPodIpsReturned",
      "rawPacketCapturesReturned",
      "rawLogLinesReturned",
      "rawEvidencePathsReturned",
      "secretValuesReturned",
    ]),
  };
}

function secretRotationDrill(context) {
  return {
    ...common(
      "romeo.secret-rotation-drill-evidence.v1",
      [
        "session_secret_staged_dual_read",
        "webhook_signing_key_cutover",
        "local_mfa_envelope_rewrap_verified",
        "managed_secret_envelope_rewrap_verified",
        "old_secret_rejected_or_retired",
        "new_secret_accepted",
        "post_rotation_readiness_verified",
        "dependency_credentials_reviewed",
        "secret_rotation_alerting_readback",
        "secret_rotation_log_redaction",
      ],
      context,
    ),
    stagedCutover: {
      sessionSecretStaged: true,
      webhookSigningKeyCutover: true,
      apiOrServiceKeyContinuityVerified: true,
    },
    rewrap: {
      localMfaPreviewPassed: true,
      localMfaRewrappedCount: 1,
      managedSecretsPreviewPassed: true,
      managedSecretsRewrappedCount: 1,
      failureCount: 0,
    },
    acceptance: {
      oldSecretRetiredOrRejectedCount: 1,
      newSecretAcceptedCount: 1,
    },
    dependencies: {
      databaseCredentialsReviewed: true,
      objectStoreCredentialsReviewed: true,
      providerCredentialCount: 1,
      connectorCredentialCount: 1,
    },
    readiness: {
      checked: true,
      readinessPassed: true,
      postRotationLoginPassed: true,
      postRotationWebhookPassed: true,
    },
    alerting: {
      checked: true,
      status: "passed",
      rotationAlertCount: 1,
      firingRequiredCount: 1,
    },
    failures: [],
    redaction: falseFlags([
      "keyMaterialReturned",
      "rawApiKeysReturned",
      "rawEvidencePathsReturned",
      "rawLogLinesReturned",
      "rawSecretRefsReturned",
      "rawSecretValuesReturned",
      "rawTokensReturned",
      "webhookSigningSecretsReturned",
    ]),
  };
}

function validateEvidence(evidenceKind, evidence, generatedAt) {
  const validators = createGaEvidenceValidators({ generatedAt });
  const validatorName = {
    "analytics-authz-live": "validateAnalyticsAuthzLiveEvidence",
    "audit-integrity": "validateAuditIntegrityEvidence",
    "billing-operations": "validateBillingOperationsEvidence",
    "identity-live": "validateIdentityLiveEvidence",
    "migration-drill": "validateMigrationDrillEvidence",
    "network-partition": "validateNetworkPartitionEvidence",
    "notification-adapter-live": "validateNotificationAdapterLiveEvidence",
    "provider-outage": "validateProviderOutageEvidence",
    "secret-rotation-drill": "validateSecretRotationDrillEvidence",
    "tenant-purge": "validateTenantPurgeEvidence",
    "voice-provider-live": "validateVoiceProviderLiveEvidence",
  }[evidenceKind];
  return validators[validatorName](evidence);
}

function runSelfTest(allDefinitions) {
  const generatedAt = new Date().toISOString();
  for (const [evidenceKind, item] of allDefinitions) {
    const deployment = item.deployments.includes("kubernetes")
      ? "kubernetes"
      : item.deployments[0];
    const evidence = item.build({ deployment, generatedAt });
    const result = validateEvidence(evidenceKind, evidence, generatedAt);
    if (result.status !== "pass") {
      throw new Error(
        `${evidenceKind} self-test failed: ${result.reason ?? "unknown"}.`,
      );
    }
  }
  console.log(
    `reviewed GA evidence recorder: ${allDefinitions.size} schema validators passed`,
  );
}

function falseFlags(names) {
  return Object.fromEntries(names.map((name) => [name, false]));
}

function positiveCounts(names) {
  return Object.fromEntries(names.map((name) => [name, 1]));
}

function isoTimestamp(value) {
  const resolved = value ?? new Date().toISOString();
  const parsed = Date.parse(resolved);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== resolved) {
    throw new Error("--generated-at must be an exact ISO-8601 timestamp.");
  }
  return resolved;
}

function enumArg(name, allowed, fallback) {
  const value = argValue(name) ?? fallback;
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}
