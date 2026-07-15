import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAllDocuments } from "yaml";
import {
  readReleaseReadbackPlan,
  requiredReleaseAssetNames,
} from "./release-readback-plan.mjs";
import {
  readKubernetesDrPlan,
  requiredKubernetesDrModes,
} from "./kubernetes-dr-plan.mjs";

export const defaultChecklistPath = "dist/ci/ga-checklist.json";

const gateSpecs = [
  {
    id: "phase21.kubernetes_live_smoke",
    command: () =>
      `KUBERNETES_LIVE_SMOKE_SKIP_BUILD=true pnpm smoke:kubernetes:live -- --skip-build --namespace ${targetKubernetesLiveSmokeNamespace()} --release-name ${targetKubernetesLiveSmokeReleaseName()} --image $KUBERNETES_LIVE_SMOKE_APP_IMAGE --postgres-image $KUBERNETES_LIVE_SMOKE_POSTGRES_IMAGE --valkey-image $KUBERNETES_LIVE_SMOKE_VALKEY_IMAGE --rustfs-image $KUBERNETES_LIVE_SMOKE_RUSTFS_IMAGE --object-store-client-image $KUBERNETES_LIVE_SMOKE_OBJECT_STORE_CLIENT_IMAGE --timeout-ms $KUBERNETES_LIVE_SMOKE_TIMEOUT_MS --output dist/ci/kubernetes-live-smoke.json`,
    requiredCommands: ["kubectl", "helm"],
    requiredEnv: [
      "KUBERNETES_LIVE_SMOKE_SKIP_BUILD",
      "KUBERNETES_LIVE_SMOKE_NAMESPACE",
      "KUBERNETES_LIVE_SMOKE_RELEASE_NAME",
      "KUBERNETES_LIVE_SMOKE_APP_IMAGE",
      "KUBERNETES_LIVE_SMOKE_POSTGRES_IMAGE",
      "KUBERNETES_LIVE_SMOKE_VALKEY_IMAGE",
      "KUBERNETES_LIVE_SMOKE_RUSTFS_IMAGE",
      "KUBERNETES_LIVE_SMOKE_OBJECT_STORE_CLIENT_IMAGE",
      "KUBERNETES_LIVE_SMOKE_TIMEOUT_MS",
    ],
    checks: [
      "kubernetes_cluster",
      "kubernetes_live_smoke_plan",
      "kubernetes_live_smoke_namespace_available",
    ],
    notes: [
      "Use a reviewed, digest-pinned, prebuilt Romeo app image and skip local image build for target evidence collection.",
      "Dependency probe images must be digest-pinned. Preflight reports only image count and posture, not image refs.",
    ],
  },
  {
    id: "phase21.kubernetes_networkpolicy_enforcement",
    command: () =>
      `KUBERNETES_NETWORKPOLICY_CONFIRM_CNI_ENFORCEMENT=true pnpm smoke:kubernetes:networkpolicy -- --namespace ${targetNetworkPolicyNamespace()} --client-image $KUBERNETES_NETWORKPOLICY_CLIENT_IMAGE --server-image $KUBERNETES_NETWORKPOLICY_SERVER_IMAGE --policy-propagation-ms $KUBERNETES_NETWORKPOLICY_POLICY_PROPAGATION_MS --output dist/ci/kubernetes-networkpolicy-smoke.json`,
    requiredCommands: ["kubectl"],
    requiredEnv: [
      "KUBERNETES_NETWORKPOLICY_CONFIRM_CNI_ENFORCEMENT",
      "KUBERNETES_NETWORKPOLICY_CLIENT_IMAGE",
      "KUBERNETES_NETWORKPOLICY_SERVER_IMAGE",
      "KUBERNETES_NETWORKPOLICY_POLICY_PROPAGATION_MS",
    ],
    optionalEnv: [
      "KUBERNETES_NETWORKPOLICY_NAMESPACE",
      "KUBERNETES_NETWORKPOLICY_TIMEOUT_MS",
    ],
    checks: [
      "kubernetes_cluster",
      "kubernetes_networkpolicy_api",
      "kubernetes_networkpolicy_cni_confirmation",
      "kubernetes_networkpolicy_images",
      "kubernetes_networkpolicy_probe_config",
    ],
    notes: [
      "The cluster must use a CNI that enforces networking.k8s.io/v1 NetworkPolicy; preflight requires an explicit operator confirmation before the live mutation runs.",
      "Use reviewed, digest-pinned client/server probe images from an approved registry; preflight reports only image count and digest posture, not image names.",
    ],
  },
  {
    id: "phase21.kubernetes_keda_scaler",
    command: () =>
      `pnpm smoke:kubernetes:keda -- --api-key $ROMEO_API_KEY --namespace ${targetKubernetesNamespace()} --keda-namespace ${targetKedaNamespace()} --service ${targetKubernetesServiceName()} --scaledjob ${targetKedaScaledJobName()} --triggerauthentication ${targetKedaTriggerAuthenticationName()} --output dist/ci/kubernetes-keda-smoke.json`,
    requiredCommands: ["kubectl"],
    requiredEnv: ["ROMEO_API_KEY"],
    checks: [
      "kubernetes_cluster",
      "kubernetes_namespace",
      "keda_namespace",
      "kubernetes_app_service",
      "keda_scaledjob",
      "keda_triggerauthentication",
    ],
    notes: [
      "Use this only for releases that enable the optional KEDA webhook-retry ScaledJob.",
      "The target namespace must already have KEDA CRDs, the ScaledJob, TriggerAuthentication, worker API-key Secret, and Postgres Secret refs configured.",
    ],
  },
  {
    id: "phase21.kubernetes_dr_modes",
    command:
      "KUBERNETES_DR_SKIP_BUILD=true pnpm smoke:kubernetes:dr -- --skip-build --image $KUBERNETES_DR_APP_IMAGE --mode external-postgres --dr-plan-file $KUBERNETES_DR_PLAN_FILE --output dist/ci/kubernetes-external-postgres-dr.json && KUBERNETES_DR_SKIP_BUILD=true pnpm smoke:kubernetes:dr -- --skip-build --image $KUBERNETES_DR_APP_IMAGE --mode cloudnativepg --dr-plan-file $KUBERNETES_DR_PLAN_FILE --output dist/ci/kubernetes-cloudnativepg-dr.json",
    requiredCommands: ["kubectl", "helm"],
    requiredEnv: [
      "KUBERNETES_DR_PLAN_FILE",
      "KUBERNETES_DR_SKIP_BUILD",
      "KUBERNETES_DR_APP_IMAGE",
    ],
    checks: [
      "kubernetes_cluster",
      "kubernetes_dr_runtime_plan",
      "kubernetes_dr_plan",
      "kubernetes_dr_cloudnativepg_source_secret",
      "kubernetes_dr_cloudnativepg_restore_secret",
    ],
    notes: [
      "The plan must include both external-postgres and cloudnativepg modes with isolated source/restore namespaces.",
      "Use a reviewed, digest-pinned, prebuilt Romeo app image and skip local Docker builds for target DR evidence collection.",
      "CloudNativePG mode requires operator-managed source and restore database URL Secrets in explicit namespaces; preflight checks presence without returning Secret names, keys, or values.",
    ],
  },
  {
    id: "phase25.kubernetes_workers_smoke",
    command: () =>
      `pnpm smoke:kubernetes:workers -- --api-key $ROMEO_API_KEY --namespace ${targetKubernetesNamespace()} --release-name ${targetKubernetesReleaseName()} --service ${targetKubernetesServiceName()} --output dist/ci/kubernetes-workers-smoke.json`,
    requiredCommands: ["kubectl"],
    requiredEnv: ["ROMEO_API_KEY"],
    checks: [
      "kubernetes_cluster",
      "kubernetes_namespace",
      "kubernetes_app_deployment",
      "kubernetes_app_service",
    ],
  },
  {
    id: "phase22.credentialed_release_readback",
    command:
      "pnpm release:readback-collect -- --readback-plan-file $RELEASE_READBACK_PLAN_FILE --output dist/release/release-readback.json && pnpm release:readback-check -- --readback-file dist/release/release-readback.json --readback-plan-file $RELEASE_READBACK_PLAN_FILE --output dist/release/readback-validation.json",
    requiredEnv: ["RELEASE_READBACK_PLAN_FILE"],
    requiredEnvAnyOf: [["NPM_TOKEN", "NODE_AUTH_TOKEN"]],
    optionalEnv: [
      "OCI_REGISTRY_TOKEN",
      "HELM_REPOSITORY_TOKEN",
      "RELEASE_ASSET_TOKEN",
    ],
    requiredFiles: [
      "dist/release/release-manifest.json",
      "dist/release/release-channel.json",
      "dist/release/security-evidence.json",
      "dist/release/sbom.cdx.json",
    ],
    checks: ["release_artifacts", "release_readback_plan"],
    notes: [
      "The readback plan must describe at least one OCI image, one Helm chart plus repository URL, and hosted release-channel, security-evidence, SBOM, provenance, and approval assets.",
      "The preflight returns only plan counts and required asset names, not registry URLs, release asset URLs, digests, tokens, or plan bodies.",
    ],
  },
  {
    id: "phase22.ci_governance_live",
    command: () =>
      `pnpm ci:branch-protection-plan -- --output dist/ci/branch-protection-plan.json && pnpm ci:hosted-run-verify -- --plan dist/ci/branch-protection-plan.json ${targetHostedCiRunSelectorArgs()} --output dist/ci/hosted-ci-run-verification.json && pnpm ci:branch-protection-verify -- --plan dist/ci/branch-protection-plan.json --output dist/ci/branch-protection-verification.json`,
    requiredCommands: ["pnpm"],
    requiredEnv: ["CI_GOVERNANCE_EVIDENCE_REVIEWED", "GITHUB_REPOSITORY"],
    requiredEnvAnyOf: [
      ["GITHUB_TOKEN", "GH_TOKEN"],
      ["GITHUB_CI_RUN_ID", "GITHUB_CI_HEAD_SHA"],
    ],
    optionalEnv: ["GITHUB_API_URL", "GITHUB_BRANCH"],
    checks: [
      "ci_governance_live_review",
      "github_repository_target",
      "github_ci_run_selector",
    ],
    notes: [
      "Use this only for releases that claim hosted GitHub CI run evidence and branch-protection settings have been reviewed.",
      "The verifier evidence must stay metadata-only and must not contain repository slugs, raw GitHub API responses, run URLs, job logs, token values, workflow bodies, branch names beyond configured labels, or secret values.",
    ],
  },
  {
    id: "phase32.target_quality_evidence",
    command:
      "TARGET_QUALITY_REQUIRE_EVAL_PASSED=true TARGET_QUALITY_REQUIRE_VECTOR_COMPARISON=$TARGET_QUALITY_REQUIRE_VECTOR_COMPARISON TARGET_QUALITY_BASELINE_VECTOR_ROUTE_MODE=$TARGET_QUALITY_BASELINE_VECTOR_ROUTE_MODE TARGET_QUALITY_CANDIDATE_VECTOR_ROUTE_MODE=$TARGET_QUALITY_CANDIDATE_VECTOR_ROUTE_MODE pnpm smoke:quality:target -- --api-key $ROMEO_API_KEY --base-url $ROMEO_BASE_URL --agent-ids $TARGET_QUALITY_AGENT_IDS --require-eval-passed --replay-file $TARGET_QUALITY_REPLAY_FILE --output dist/ci/target-quality-evidence.json",
    requiredEnv: [
      "ROMEO_BASE_URL",
      "ROMEO_API_KEY",
      "TARGET_QUALITY_AGENT_IDS",
      "TARGET_QUALITY_REPLAY_FILE",
    ],
    optionalEnv: [
      "TARGET_QUALITY_FORBIDDEN_STRINGS",
      "TARGET_QUALITY_REQUIRE_VECTOR_COMPARISON",
      "TARGET_QUALITY_BASELINE_VECTOR_ROUTE_MODE",
      "TARGET_QUALITY_CANDIDATE_VECTOR_ROUTE_MODE",
    ],
    checks: [
      "target_api",
      "target_quality_agent_ids",
      "target_quality_replay_file",
      "target_quality_vector_comparison",
    ],
    notes: [
      "The GA validator rejects target-quality evidence without passing release-candidate eval readback and representative retrieval replay evidence.",
      "Set TARGET_QUALITY_REQUIRE_VECTOR_COMPARISON=true when Qdrant is enabled for the release; the replay fixture must be a compare shape with pgvector baseline and external_vector candidate route proof.",
      "Use TARGET_QUALITY_AGENT_IDS and TARGET_QUALITY_REPLAY_FILE to make the preflight command match the selected release-candidate and replay fixture.",
    ],
  },
  {
    id: "phase23.identity_live",
    command:
      "IDENTITY_LIVE_EVIDENCE_REVIEWED=true pnpm evidence:identity-live -- --output dist/ci/identity-live-evidence.json",
    requiredEnv: ["IDENTITY_LIVE_EVIDENCE_REVIEWED"],
    checks: ["identity_live_review"],
    notes: [
      "Use this only for releases that claim target enterprise identity, managed-secret backend, customer directory, directory-sync, SCIM/deprovisioning, access-review, and identity log-redaction evidence is complete.",
      "Run the selected IdP, Vault or secret-backend, directory lookup/group-mapping, directory-sync preview/apply, lifecycle, access-review, and log-redaction drills before recording this metadata-only evidence.",
    ],
  },
  {
    id: "phase32.analytics_authz_live",
    command:
      "ANALYTICS_AUTHZ_EVIDENCE_REVIEWED=true pnpm evidence:analytics-authz-live -- --output dist/ci/analytics-authz-live-evidence.json",
    requiredEnv: ["ANALYTICS_AUTHZ_EVIDENCE_REVIEWED"],
    checks: ["analytics_authz_live_review"],
    notes: [
      "Use this only for releases that claim representative admin analytics authorization and CSV export controls are complete in the selected target deployment.",
      "Run the selected admin, non-admin, cross-org, cross-workspace, usage-scope, eval-grant, CSV hash, and log-redaction checks before recording this metadata-only evidence.",
    ],
  },
  {
    id: "phase31.browser_automation_live_runner",
    command:
      "BROWSER_AUTOMATION_LIVE_EVIDENCE_REVIEWED=true pnpm evidence:browser-automation-live -- --output dist/ci/browser-automation-live-evidence.json",
    requiredEnv: ["BROWSER_AUTOMATION_LIVE_EVIDENCE_REVIEWED"],
    checks: ["browser_automation_live_review"],
    notes: [
      "Use this only for releases that enable the browser automation worker path.",
      "Run the selected reviewed browser runner, CNI/NetworkPolicy denial, crash/retry, retention-worker, and pod-log-redaction drills before recording this metadata-only evidence.",
    ],
  },
  {
    id: "phase31.data_connector_live_worker",
    command:
      "DATA_CONNECTOR_LIVE_EVIDENCE_REVIEWED=true pnpm evidence:data-connector-live -- --output dist/ci/data-connector-live-evidence.json",
    requiredEnv: ["DATA_CONNECTOR_LIVE_EVIDENCE_REVIEWED"],
    checks: ["data_connector_live_review"],
    notes: [
      "Use this only for releases that enable live outbound data connector sync.",
      "Run the selected connector worker, CNI/NetworkPolicy denial, private-DNS denial, secret-ref, crash/requeue, sync-log-redaction, and sanitized-readback drills before recording this metadata-only evidence.",
    ],
  },
  {
    id: "phase25.tool_dispatch_live_worker",
    command:
      "TOOL_DISPATCH_LIVE_EVIDENCE_REVIEWED=true pnpm evidence:tool-dispatch-live -- --output dist/ci/tool-dispatch-live-evidence.json",
    requiredEnv: ["TOOL_DISPATCH_LIVE_EVIDENCE_REVIEWED"],
    checks: ["tool_dispatch_live_review"],
    notes: [
      "Use this only for releases that enable live external tool operation dispatch.",
      "Run the selected tool-dispatch worker, managed-payload read, MCP Streamable HTTP protocol/envelope/redaction proof, CNI/NetworkPolicy denial, private-DNS denial, secret-resolution, crash/reclaim, response-schema, log-redaction, and sanitized-readback drills before recording this metadata-only evidence.",
    ],
  },
  {
    id: "phase32.voice_provider_live",
    command:
      "VOICE_PROVIDER_LIVE_EVIDENCE_REVIEWED=true pnpm evidence:voice-provider-live -- --output dist/ci/voice-provider-live-evidence.json",
    requiredEnv: ["VOICE_PROVIDER_LIVE_EVIDENCE_REVIEWED"],
    checks: ["voice_provider_live_review"],
    notes: [
      "Use this only for releases that claim the selected production TTS/STT provider has been exercised in the target deployment.",
      "Run live catalog sync, preview generation, transcription, artifact readback/delete, streaming consent when enabled, provider failure redaction, pod/app log redaction, and sanitized-readback checks before recording this metadata-only evidence.",
    ],
  },
  {
    id: "phase32.notification_adapter_live",
    command:
      "NOTIFICATION_ADAPTER_LIVE_EVIDENCE_REVIEWED=true pnpm evidence:notification-adapter-live -- --output dist/ci/notification-adapter-live-evidence.json",
    requiredEnv: ["NOTIFICATION_ADAPTER_LIVE_EVIDENCE_REVIEWED"],
    checks: ["notification_adapter_live_review"],
    notes: [
      "Use this only for releases that claim selected target notification adapters and egress controls have been exercised.",
      "Run live delivery, mixed channel routing, secret-ref resolution, egress allowlist/NetworkPolicy denial, retry/dead-letter, channel-isolation, app/pod log redaction, and sanitized-readback checks before recording this metadata-only evidence.",
    ],
  },
  {
    id: "phase33.data_rights_retention_live",
    command:
      "DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_EVIDENCE_REVIEWED=true DATA_RIGHTS_BACKUP_RETENTION_EVIDENCE_REVIEWED=true pnpm evidence:data-rights-retention -- --control operational_logs --retention-days $DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_DAYS --output dist/ci/data-rights-operational-log-retention-evidence.json && pnpm evidence:data-rights-retention -- --control backups --retention-days $DATA_RIGHTS_BACKUP_RETENTION_DAYS --output dist/ci/data-rights-backup-retention-evidence.json",
    requiredEnv: [
      "DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_EVIDENCE_REVIEWED",
      "DATA_RIGHTS_BACKUP_RETENTION_EVIDENCE_REVIEWED",
      "DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_DAYS",
      "DATA_RIGHTS_BACKUP_RETENTION_DAYS",
    ],
    checks: ["data_rights_retention_live_review"],
    notes: [
      "Use this only for releases that claim deployment-specific operational-log and backup retention or destruction controls are complete.",
      "Review the selected logging and backup systems before recording metadata-only evidence; the generated files must not contain log destinations, backup locations, object keys, system names, or secrets.",
    ],
  },
  {
    id: "phase33.billing_operations_live",
    command:
      "BILLING_OPERATIONS_EVIDENCE_REVIEWED=true pnpm evidence:billing-operations -- --output dist/ci/billing-operations-evidence.json",
    requiredEnv: ["BILLING_OPERATIONS_EVIDENCE_REVIEWED"],
    checks: ["billing_operations_live_review"],
    notes: [
      "Use this only for releases that claim target billing worker cadence, entitlement/lifecycle API readback, worker-log redaction, and billing alerting are complete.",
      "Review the selected billing CronJobs, alert rules, API readback, and worker logs before recording metadata-only evidence; generated files must not contain provider payloads, API keys, customer identifiers, alert payloads, evidence bodies, or secrets.",
    ],
  },
  {
    id: "phase33.audit_integrity_live",
    command:
      "AUDIT_INTEGRITY_EVIDENCE_REVIEWED=true pnpm evidence:audit-integrity -- --output dist/ci/audit-integrity-evidence.json",
    requiredEnv: ["AUDIT_INTEGRITY_EVIDENCE_REVIEWED"],
    checks: ["audit_integrity_live_review"],
    notes: [
      "Use this only for releases that claim target audit export, immutable storage, retention, time-sync, and checksum-chain controls are complete.",
      "Review target SIEM/object-store delivery, WORM or retention-lock policy, retention duration, time-source drift, checksum-chain verification, and audit evidence redaction before recording metadata-only evidence.",
    ],
  },
  {
    id: "phase33.tenant_purge_live",
    command:
      "TENANT_PURGE_EVIDENCE_REVIEWED=true pnpm evidence:tenant-purge -- --output dist/ci/tenant-purge-evidence.json",
    requiredEnv: ["TENANT_PURGE_EVIDENCE_REVIEWED"],
    checks: ["tenant_purge_live_review"],
    notes: [
      "Use this only for releases that claim target tenant purge and external storage-class retention/destruction controls are complete.",
      "Run app-owned finalization and review external vector, backup, operational-log, support-bundle, and external secret-store controls before recording metadata-only evidence; generated files must not contain evidence bodies, object keys, vector values, backup locations, log bodies, support bundle bodies, secret values, or mounted paths.",
    ],
  },
  {
    id: "phase35.support_bundle_live",
    command:
      "SUPPORT_BUNDLE_EVIDENCE_REVIEWED=true pnpm support:bundle -- --output dist/ci/support-bundle.json",
    requiredEnv: ["SUPPORT_BUNDLE_EVIDENCE_REVIEWED"],
    checks: ["support_bundle_live_review"],
    notes: [
      "Use this only for releases that claim target-tier supportability evidence is generated and reviewed.",
      "Generate the bundle after target evidence and redaction evidence are present; the support bundle must remain metadata-only and must not contain raw logs, evidence bodies, prompts, provider payloads, connector payloads, object keys, vector values, backup locations, environment values, token values, or secrets.",
    ],
  },
  {
    id: "phase34.target_resilience_drills",
    command:
      "PROVIDER_OUTAGE_EVIDENCE_REVIEWED=true MIGRATION_DRILL_EVIDENCE_REVIEWED=true NETWORK_PARTITION_EVIDENCE_REVIEWED=true SECRET_ROTATION_DRILL_EVIDENCE_REVIEWED=true pnpm evidence:provider-outage -- --output dist/ci/provider-outage-evidence.json && pnpm evidence:migration-drill -- --output dist/ci/migration-drill-evidence.json && pnpm evidence:network-partition -- --output dist/ci/network-partition-evidence.json && pnpm evidence:secret-rotation-drill -- --output dist/ci/secret-rotation-drill-evidence.json",
    requiredEnv: [
      "PROVIDER_OUTAGE_EVIDENCE_REVIEWED",
      "MIGRATION_DRILL_EVIDENCE_REVIEWED",
      "NETWORK_PARTITION_EVIDENCE_REVIEWED",
      "SECRET_ROTATION_DRILL_EVIDENCE_REVIEWED",
    ],
    checks: ["target_resilience_drills_review"],
    notes: [
      "Use this only for releases that claim target provider outage, failed-migration, network-partition, and secret-rotation drills are complete.",
      "Review the selected target environment before recording metadata-only evidence; generated files must not contain provider endpoints, payloads, database URLs, SQL, network endpoints, pod IPs, packet captures, key material, token values, raw log lines, evidence bodies, or secrets.",
    ],
    rawSecretRefsReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
  },
  {
    id: "phase34.postgres_operations_live",
    command:
      "DATABASE_URL=$DATABASE_URL pnpm review:postgres-query-plans -- --representative-volume --target-tier $POSTGRES_OPERATIONAL_TARGET_TIER --postgres-mode $POSTGRES_OPERATIONAL_MODE --output dist/ci/postgres-query-plan-review.json && DATABASE_URL=$DATABASE_URL pnpm collect:postgres-telemetry -- --window-minutes $POSTGRES_TELEMETRY_WINDOW_MINUTES --slow-threshold-ms $POSTGRES_SLOW_QUERY_THRESHOLD_MS --max-blocked-sessions $POSTGRES_MAX_BLOCKED_SESSIONS --max-deadlocks $POSTGRES_MAX_DEADLOCKS --slow-output dist/ci/postgres-slow-query-telemetry.json --lock-output dist/ci/postgres-lock-telemetry.json && DATABASE_URL=$DATABASE_URL pnpm decide:postgres-archival -- --decision $POSTGRES_ARCHIVAL_DECISION --accept-decision --output dist/ci/postgres-archival-partitioning-decision.json",
    requiredCommands: ["psql"],
    requiredEnv: [
      "DATABASE_URL",
      "POSTGRES_OPERATIONAL_TARGET_TIER",
      "POSTGRES_OPERATIONAL_MODE",
      "POSTGRES_TELEMETRY_WINDOW_MINUTES",
      "POSTGRES_SLOW_QUERY_THRESHOLD_MS",
      "POSTGRES_MAX_BLOCKED_SESSIONS",
      "POSTGRES_MAX_DEADLOCKS",
      "POSTGRES_ARCHIVAL_DECISION",
    ],
    checks: [
      "postgres_operations_target",
      "postgres_telemetry_thresholds",
      "postgres_archival_decision",
    ],
    notes: [
      "Use this only for releases that claim target CloudNativePG or external hosted Postgres operational evidence is complete.",
      "Run after representative traffic has exercised the selected database; pg_stat_statements must be enabled before telemetry collection.",
      "For external hosted Postgres, strict preflight requires sslmode=verify-full on DATABASE_URL and reports only booleans, not the database URL or host.",
    ],
  },
  {
    id: "phase32.kubernetes_tiered_rag_smoke",
    command: () =>
      `pnpm smoke:kubernetes:tiered-rag -- --api-key $ROMEO_API_KEY --namespace ${targetKubernetesNamespace()} --release-name ${targetKubernetesReleaseName()} --service ${targetKubernetesServiceName()} --deployment ${targetKubernetesDeploymentName()} --output dist/ci/kubernetes-tiered-rag-smoke.json`,
    requiredCommands: ["kubectl"],
    requiredEnv: ["ROMEO_API_KEY"],
    checks: [
      "kubernetes_cluster",
      "kubernetes_namespace",
      "kubernetes_app_deployment",
      "kubernetes_app_service",
    ],
  },
  {
    id: "phase32.qdrant_dr_consistency",
    command:
      "pnpm smoke:qdrant:dr -- --phase prepare-source --url $SOURCE_QDRANT_URL --collection $SOURCE_QDRANT_COLLECTION --api-key $SOURCE_QDRANT_API_KEY --run-secret $QDRANT_DR_RUN_SECRET --namespace-policy $VECTOR_NAMESPACE_POLICY --partitioning-policy $VECTOR_PARTITIONING_POLICY --confirm-mutation --output dist/ci/qdrant-dr-source.json && pnpm smoke:qdrant:dr -- --phase verify-restore --url $RESTORE_QDRANT_URL --collection $RESTORE_QDRANT_COLLECTION --api-key $RESTORE_QDRANT_API_KEY --run-secret $QDRANT_DR_RUN_SECRET --namespace-policy $VECTOR_NAMESPACE_POLICY --partitioning-policy $VECTOR_PARTITIONING_POLICY --source-evidence dist/ci/qdrant-dr-source.json --confirm-cleanup --output dist/ci/qdrant-dr-restore.json && pnpm smoke:qdrant:dr -- --phase cleanup-source --url $SOURCE_QDRANT_URL --collection $SOURCE_QDRANT_COLLECTION --api-key $SOURCE_QDRANT_API_KEY --run-secret $QDRANT_DR_RUN_SECRET --namespace-policy $VECTOR_NAMESPACE_POLICY --partitioning-policy $VECTOR_PARTITIONING_POLICY --confirm-mutation --output dist/ci/qdrant-dr-source-cleanup.json",
    requiredEnv: [
      "SOURCE_QDRANT_URL",
      "SOURCE_QDRANT_COLLECTION",
      "SOURCE_QDRANT_API_KEY",
      "RESTORE_QDRANT_URL",
      "RESTORE_QDRANT_COLLECTION",
      "RESTORE_QDRANT_API_KEY",
      "QDRANT_DR_RUN_SECRET",
      "VECTOR_NAMESPACE_POLICY",
      "VECTOR_PARTITIONING_POLICY",
    ],
    checks: [
      "qdrant_dr_source",
      "qdrant_dr_restore",
      "qdrant_dr_run_secret",
      "qdrant_dr_namespace_policy",
    ],
    notes: [
      "Run prepare-source before the operator vector backup/restore, verify-restore against the isolated restored collection with dist/ci/qdrant-dr-source.json, then cleanup-source against the source collection.",
      "The preflight returns only configured booleans and URL origins, not Qdrant URLs, collection names, API keys, run secrets, namespaces, or evidence bodies.",
    ],
  },
  {
    id: "phase32.qdrant_live_evidence",
    command: () =>
      `QDRANT_LIVE_EVIDENCE_REVIEWED=true pnpm smoke:qdrant:live -- --url $QDRANT_URL --collection $QDRANT_COLLECTION --api-key $QDRANT_API_KEY --namespace-policy $VECTOR_NAMESPACE_POLICY --partitioning-policy $VECTOR_PARTITIONING_POLICY --confirm-mutation --output dist/ci/qdrant-live-evidence.json`,
    requiredEnv: [
      "QDRANT_LIVE_EVIDENCE_REVIEWED",
      "QDRANT_URL",
      "QDRANT_COLLECTION",
      "QDRANT_API_KEY",
      "VECTOR_NAMESPACE_POLICY",
      "VECTOR_PARTITIONING_POLICY",
    ],
    checks: [
      "qdrant_live_review",
      "qdrant_live_target",
      "qdrant_live_credentials",
      "qdrant_live_namespace_policy",
    ],
    notes: [
      "Use this only for releases that claim target Qdrant external-vector isolation is active and mounted into runtime readiness through QDRANT_LIVE_EVIDENCE_PATH.",
      "The live smoke writes and deletes synthetic points, so run it against the selected collection only after reviewing namespace/partition policy and credential scope.",
      "The preflight returns only safe URL origin, configured booleans, policy names, and redaction flags, not Qdrant URLs, collection names, API keys, namespaces, partitions, point IDs, vectors, or evidence bodies.",
    ],
  },
  {
    id: "phase33.live_edge_enforcement",
    command:
      "pnpm smoke:edge:live -- --api-key $ROMEO_API_KEY --base-url $ROMEO_BASE_URL --require-admin-posture --require-waf-block-mode --body-limit-path $EDGE_ENFORCEMENT_BODY_LIMIT_PATH --body-limit-bytes $EDGE_ENFORCEMENT_BODY_LIMIT_BYTES --body-limit-expected-statuses $EDGE_ENFORCEMENT_BODY_LIMIT_EXPECTED_STATUSES --rate-limit-path $EDGE_ENFORCEMENT_RATE_LIMIT_PATH --rate-limit-attempts $EDGE_ENFORCEMENT_RATE_LIMIT_ATTEMPTS --rate-limit-expected-status $EDGE_ENFORCEMENT_RATE_LIMIT_EXPECTED_STATUS --waf-probe-path $EDGE_ENFORCEMENT_WAF_PROBE_PATH --waf-expected-statuses $EDGE_ENFORCEMENT_WAF_EXPECTED_STATUSES --output dist/ci/live-edge-enforcement.json",
    requiredEnv: [
      "ROMEO_BASE_URL",
      "ROMEO_API_KEY",
      "EDGE_ENFORCEMENT_REQUIRE_ADMIN_POSTURE",
      "EDGE_ENFORCEMENT_REQUIRE_WAF_BLOCK_MODE",
      "EDGE_ENFORCEMENT_BODY_LIMIT_PATH",
      "EDGE_ENFORCEMENT_BODY_LIMIT_BYTES",
      "EDGE_ENFORCEMENT_BODY_LIMIT_EXPECTED_STATUSES",
      "EDGE_ENFORCEMENT_RATE_LIMIT_PATH",
      "EDGE_ENFORCEMENT_RATE_LIMIT_ATTEMPTS",
      "EDGE_ENFORCEMENT_RATE_LIMIT_EXPECTED_STATUS",
      "EDGE_ENFORCEMENT_WAF_PROBE_PATH",
      "EDGE_ENFORCEMENT_WAF_EXPECTED_STATUSES",
    ],
    optionalEnv: [
      "EDGE_ENFORCEMENT_HEADER_PATH",
      "EDGE_ENFORCEMENT_REQUIRE_HSTS",
      "EDGE_ENFORCEMENT_TIMEOUT_MS",
      "EDGE_ENFORCEMENT_WAF_EXPECTED_HEADER",
      "EDGE_ENFORCEMENT_WAF_PROBE_HEADER_NAME",
      "EDGE_ENFORCEMENT_WAF_PROBE_HEADER_VALUE",
    ],
    checks: [
      "target_api",
      "edge_required_controls",
      "edge_status_expectations",
      "edge_probe_paths",
    ],
    notes: [
      "Use a scoped admin/operator API key so the smoke must read sanitized admin edge posture and WAF block mode before collecting evidence.",
      "The preflight validates edge probe paths, bounded body/rate controls, and GA-compatible WAF/body/rate status expectations without returning raw probe paths, query values, header values, or API keys.",
    ],
  },
  {
    id: "phase34.live_alert_firing",
    command:
      "pnpm smoke:alerts:live -- --prometheus-url $PROMETHEUS_URL --output dist/ci/live-alert-firing.json",
    requiredEnv: ["PROMETHEUS_URL"],
    optionalEnv: [
      "ALERTMANAGER_URL",
      "PROMETHEUS_BEARER_TOKEN",
      "ALERTMANAGER_BEARER_TOKEN",
      "ALERT_FIRING_REQUIRED_ALERTS",
    ],
    checks: [
      "prometheus",
      "alertmanager_optional",
      "alert_rules_defined",
      "alert_required_categories",
    ],
    notes: [
      "Default required alerts cover provider, queue, and backup categories. Set ALERT_FIRING_REQUIRED_ALERTS only for an approved deployment-specific replacement that keeps those categories covered.",
      "Preflight checks rule names and categories without returning bearer tokens or alert payloads.",
    ],
  },
  {
    id: "phase34.kubernetes_load_soak",
    command: () =>
      `pnpm smoke:kubernetes:load-soak -- --api-key $ROMEO_API_KEY --namespace ${targetKubernetesNamespace()} --release-name ${targetKubernetesReleaseName()} --service ${targetKubernetesServiceName()} --deployment ${targetKubernetesDeploymentName()} --tier $KUBERNETES_LOAD_SOAK_TIER --iterations $KUBERNETES_LOAD_SOAK_ITERATIONS --soak-seconds $KUBERNETES_LOAD_SOAK_SOAK_SECONDS --interval-seconds $KUBERNETES_LOAD_SOAK_INTERVAL_SECONDS --timeout-ms $KUBERNETES_LOAD_SOAK_TIMEOUT_MS --output dist/ci/kubernetes-load-soak.json`,
    requiredCommands: ["kubectl"],
    requiredEnv: [
      "ROMEO_API_KEY",
      "KUBERNETES_LOAD_SOAK_TIER",
      "KUBERNETES_LOAD_SOAK_ITERATIONS",
      "KUBERNETES_LOAD_SOAK_SOAK_SECONDS",
      "KUBERNETES_LOAD_SOAK_INTERVAL_SECONDS",
      "KUBERNETES_LOAD_SOAK_TIMEOUT_MS",
    ],
    optionalEnv: [
      "KUBERNETES_LOAD_SOAK_BASE_URL",
      "KUBERNETES_LOAD_SOAK_NAMESPACE",
      "KUBERNETES_LOAD_SOAK_RELEASE_NAME",
      "KUBERNETES_LOAD_SOAK_SERVICE_NAME",
      "KUBERNETES_LOAD_SOAK_DEPLOYMENT_NAME",
      "KUBERNETES_LOAD_SOAK_SELECTOR",
      "KUBERNETES_LOAD_SOAK_SERVICE_PORT",
    ],
    checks: [
      "kubernetes_cluster",
      "kubernetes_namespace",
      "kubernetes_app_deployment",
      "kubernetes_app_service",
      "kubernetes_load_soak_parameters",
      "kubernetes_load_soak_target",
    ],
    notes: [
      "The GA validator requires live Kubernetes load/soak evidence with small or enterprise tier, at least two live load runs, at least a 60-second requested soak, observed soak pass, and pod-log redaction.",
      "Preflight returns only tier/iteration/duration posture and safe target origin, not API keys, selector strings, fixture payloads, pod logs, or load evidence bodies.",
    ],
  },
];

export function collectGaTargetPreflight(config = {}) {
  const checklistPath = config.checklistPath ?? defaultChecklistPath;
  const checklist = readChecklist(checklistPath);
  const gates = blockedRequiredGates(checklist).map((gate) =>
    gatePreflight(gate, config),
  );
  const summary = summarize(gates);
  return {
    schemaVersion: "romeo.ga-target-preflight.v1",
    generatedAt: new Date().toISOString(),
    status: summary.blocked === 0 ? "ready" : "blocked",
    checklist: checklistSummary(checklist, checklistPath),
    summary,
    gates,
    redaction: {
      commandOutputReturned: false,
      rawEnvironmentValuesReturned: false,
      rawTokensReturned: false,
      rawEvidenceBodiesReturned: false,
      unsafeAbsoluteEvidencePathsReturned: false,
    },
  };
}

export function blockedRequiredGates(checklist) {
  const gates = Array.isArray(checklist.gates) ? checklist.gates : [];
  return gates.filter(
    (gate) => gate.requiredForGa === true && gate.status !== "satisfied",
  );
}

function gatePreflight(gate, config) {
  const spec = gateSpecs.find((candidate) => candidate.id === gate.id);
  const commandChecks = (spec?.requiredCommands ?? []).map(commandCheck);
  const envChecks = (spec?.requiredEnv ?? []).map(envCheck);
  const envAnyChecks = (spec?.requiredEnvAnyOf ?? []).map(envAnyCheck);
  const optionalEnvChecks = (spec?.optionalEnv ?? []).map(optionalEnvCheck);
  const fileChecks = (spec?.requiredFiles ?? []).map(fileCheck);
  const liveChecks = (spec?.checks ?? []).map((check) =>
    namedCheck(check, config),
  );
  const checks = [
    ...commandChecks,
    ...envChecks,
    ...envAnyChecks,
    ...optionalEnvChecks,
    ...fileChecks,
    ...liveChecks,
  ];
  const missingEvidence = missingEvidencePaths(gate);
  const status =
    spec === undefined || checks.some((check) => check.status === "blocked")
      ? "blocked"
      : "ready";
  return {
    id: gate.id,
    title: gate.title,
    phase: gate.phase,
    status,
    environmentRequired: gate.environmentRequired === true,
    securityCritical: gate.securityCritical === true,
    evidence: missingEvidence,
    command: resolveCommand(spec?.command),
    checks,
    notes: spec?.notes ?? [],
  };
}

function namedCheck(name, config) {
  if (name === "kubernetes_cluster") return kubernetesClusterCheck();
  if (name === "kubernetes_namespace") return kubernetesNamespaceCheck();
  if (name === "kubernetes_app_deployment") {
    return kubernetesResourceCheck({
      kind: "deployment",
      resourceName: targetKubernetesDeploymentName(),
      namespace: targetKubernetesNamespace(),
      name: "kubernetes_app_deployment",
    });
  }
  if (name === "kubernetes_app_service") {
    return kubernetesResourceCheck({
      kind: "service",
      resourceName: targetKubernetesServiceName(),
      namespace: targetKubernetesNamespace(),
      name: "kubernetes_app_service",
    });
  }
  if (name === "keda_namespace") {
    return kubernetesNamespaceCheck(targetKedaNamespace(), "keda_namespace");
  }
  if (name === "keda_scaledjob") {
    return kubernetesResourceCheck({
      kind: "scaledjob",
      resourceName: targetKedaScaledJobName(),
      namespace: targetKubernetesNamespace(),
      name,
    });
  }
  if (name === "keda_triggerauthentication") {
    return kubernetesResourceCheck({
      kind: "triggerauthentication",
      resourceName: targetKedaTriggerAuthenticationName(),
      namespace: targetKubernetesNamespace(),
      name,
    });
  }
  if (name === "kubernetes_live_smoke_plan") {
    return kubernetesLiveSmokePlanCheck();
  }
  if (name === "kubernetes_live_smoke_namespace_available") {
    return kubernetesLiveSmokeNamespaceAvailableCheck();
  }
  if (name.startsWith("kubernetes_namespace:")) {
    return kubernetesNamespaceCheck(name.split(":")[1]);
  }
  if (name.startsWith("kubernetes_resource:")) {
    return kubernetesResourceCheck(name);
  }
  if (name === "kubernetes_dr_runtime_plan") {
    return kubernetesDrRuntimePlanCheck();
  }
  if (name === "kubernetes_dr_plan") return kubernetesDrPlanCheck();
  if (name === "kubernetes_dr_cloudnativepg_source_secret") {
    return kubernetesDrCloudNativePgSecretCheck("source");
  }
  if (name === "kubernetes_dr_cloudnativepg_restore_secret") {
    return kubernetesDrCloudNativePgSecretCheck("restore");
  }
  if (name === "kubernetes_networkpolicy_api") {
    return kubernetesNetworkPolicyApiCheck();
  }
  if (name === "kubernetes_networkpolicy_cni_confirmation") {
    return kubernetesNetworkPolicyCniConfirmationCheck();
  }
  if (name === "kubernetes_networkpolicy_images") {
    return kubernetesNetworkPolicyImagesCheck();
  }
  if (name === "kubernetes_networkpolicy_probe_config") {
    return kubernetesNetworkPolicyProbeConfigCheck();
  }
  if (name === "kubernetes_load_soak_parameters") {
    return kubernetesLoadSoakParametersCheck();
  }
  if (name === "kubernetes_load_soak_target") {
    return kubernetesLoadSoakTargetCheck();
  }
  if (name === "target_api") return targetApiCheck(config);
  if (name === "target_quality_agent_ids") return targetQualityAgentIdsCheck();
  if (name === "target_quality_replay_file") {
    return targetQualityReplayFileCheck();
  }
  if (name === "target_quality_vector_comparison") {
    return targetQualityVectorComparisonCheck();
  }
  if (name === "ci_governance_live_review") {
    return ciGovernanceLiveReviewCheck();
  }
  if (name === "github_repository_target") {
    return githubRepositoryTargetCheck();
  }
  if (name === "github_ci_run_selector") {
    return githubCiRunSelectorCheck();
  }
  if (name === "identity_live_review") {
    return identityLiveReviewCheck();
  }
  if (name === "analytics_authz_live_review") {
    return analyticsAuthzLiveReviewCheck();
  }
  if (name === "browser_automation_live_review") {
    return browserAutomationLiveReviewCheck();
  }
  if (name === "data_connector_live_review") {
    return dataConnectorLiveReviewCheck();
  }
  if (name === "tool_dispatch_live_review") {
    return toolDispatchLiveReviewCheck();
  }
  if (name === "voice_provider_live_review") {
    return voiceProviderLiveReviewCheck();
  }
  if (name === "notification_adapter_live_review") {
    return notificationAdapterLiveReviewCheck();
  }
  if (name === "data_rights_retention_live_review") {
    return dataRightsRetentionLiveReviewCheck();
  }
  if (name === "billing_operations_live_review") {
    return billingOperationsLiveReviewCheck();
  }
  if (name === "audit_integrity_live_review") {
    return auditIntegrityLiveReviewCheck();
  }
  if (name === "tenant_purge_live_review") {
    return tenantPurgeLiveReviewCheck();
  }
  if (name === "support_bundle_live_review") {
    return supportBundleLiveReviewCheck();
  }
  if (name === "target_resilience_drills_review") {
    return targetResilienceDrillsReviewCheck();
  }
  if (name === "postgres_operations_target") {
    return postgresOperationsTargetCheck();
  }
  if (name === "postgres_telemetry_thresholds") {
    return postgresTelemetryThresholdsCheck();
  }
  if (name === "postgres_archival_decision") {
    return postgresArchivalDecisionCheck();
  }
  if (name === "prometheus") return prometheusCheck(config);
  if (name === "alertmanager_optional") return alertmanagerOptionalCheck();
  if (name === "alert_rules_defined") return alertRulesDefinedCheck();
  if (name === "alert_required_categories")
    return alertRequiredCategoriesCheck();
  if (name === "edge_required_controls") return edgeRequiredControlsCheck();
  if (name === "edge_status_expectations") {
    return edgeStatusExpectationsCheck();
  }
  if (name === "edge_probe_paths") return edgeProbePathsCheck();
  if (name === "release_artifacts") return releaseArtifactCheck();
  if (name === "release_readback_plan") return releaseReadbackPlanCheck();
  if (name === "qdrant_dr_source") {
    return qdrantDrTargetCheck("source", "SOURCE_QDRANT_URL");
  }
  if (name === "qdrant_dr_restore") {
    return qdrantDrTargetCheck("restore", "RESTORE_QDRANT_URL");
  }
  if (name === "qdrant_dr_run_secret") return qdrantDrRunSecretCheck();
  if (name === "qdrant_dr_namespace_policy") {
    return qdrantDrNamespacePolicyCheck();
  }
  if (name === "qdrant_live_review") return qdrantLiveReviewCheck();
  if (name === "qdrant_live_target") return qdrantLiveTargetCheck();
  if (name === "qdrant_live_credentials") return qdrantLiveCredentialsCheck();
  if (name === "qdrant_live_namespace_policy") {
    return qdrantLiveNamespacePolicyCheck();
  }
  return { name, status: "blocked", reason: "unknown_preflight_check" };
}

function kubernetesClusterCheck() {
  const context = run("kubectl", ["config", "current-context"]);
  if (!context.ok) {
    return {
      name: "kubernetes_cluster",
      status: "blocked",
      reason: "kubectl_context_unavailable",
    };
  }
  const cluster = run("kubectl", ["cluster-info"]);
  return {
    name: "kubernetes_cluster",
    status: cluster.ok ? "ready" : "blocked",
    context: context.stdout,
    reason: cluster.ok ? undefined : "cluster_unreachable",
  };
}

function kubernetesNamespaceCheck(
  namespace = targetKubernetesNamespace(),
  checkName = "kubernetes_namespace",
) {
  if (!kubernetesNameValid(namespace)) {
    return {
      name: checkName,
      status: "blocked",
      reason: "namespace_invalid",
    };
  }
  const result = run("kubectl", ["get", "namespace", namespace]);
  return {
    name: `${checkName}:${namespace}`,
    status: result.ok ? "ready" : "blocked",
    reason: result.ok ? undefined : "namespace_unavailable",
  };
}

function kubernetesResourceCheck(input) {
  const { kind, resourceName, namespace, name } =
    typeof input === "string" ? legacyKubernetesResourceCheck(input) : input;
  const checkName = name ?? `kubernetes_resource:${kind}:${resourceName}`;
  if (!kubernetesNameValid(namespace) || !kubernetesNameValid(resourceName)) {
    return { name: checkName, status: "blocked", reason: "resource_invalid" };
  }
  const result = run("kubectl", ["get", kind, resourceName, "-n", namespace]);
  return {
    name: `${checkName}:${resourceName}:${namespace}`,
    status: result.ok ? "ready" : "blocked",
    reason: result.ok ? undefined : "resource_unavailable",
  };
}

function kubernetesLiveSmokePlanCheck() {
  const skipBuild = strictTrueEnv(
    "KUBERNETES_LIVE_SMOKE_SKIP_BUILD",
    "kubernetes_live_smoke_skip_build",
  );
  if (!skipBuild.ok) {
    return {
      name: "kubernetes_live_smoke:plan",
      status: "blocked",
      reason: skipBuild.reason,
      configured: skipBuild.configured,
    };
  }
  const namespace = process.env.KUBERNETES_LIVE_SMOKE_NAMESPACE;
  if (!kubernetesNameValid(namespace)) {
    return {
      name: "kubernetes_live_smoke:plan",
      status: "blocked",
      reason: "namespace_invalid",
      configured: hasEnv("KUBERNETES_LIVE_SMOKE_NAMESPACE"),
    };
  }
  const releaseName = process.env.KUBERNETES_LIVE_SMOKE_RELEASE_NAME;
  if (!kubernetesNameValid(releaseName)) {
    return {
      name: "kubernetes_live_smoke:plan",
      status: "blocked",
      reason: "release_name_invalid",
      configured: hasEnv("KUBERNETES_LIVE_SMOKE_RELEASE_NAME"),
    };
  }
  const appImage = reviewedImmutableImageEnv(
    "KUBERNETES_LIVE_SMOKE_APP_IMAGE",
    "app_image",
  );
  if (!appImage.ok) {
    return {
      name: "kubernetes_live_smoke:plan",
      status: "blocked",
      reason: appImage.reason,
      configured: appImage.configured,
    };
  }
  for (const [envName, label] of [
    ["KUBERNETES_LIVE_SMOKE_POSTGRES_IMAGE", "postgres_image"],
    ["KUBERNETES_LIVE_SMOKE_VALKEY_IMAGE", "valkey_image"],
    ["KUBERNETES_LIVE_SMOKE_RUSTFS_IMAGE", "rustfs_image"],
    [
      "KUBERNETES_LIVE_SMOKE_OBJECT_STORE_CLIENT_IMAGE",
      "object_store_client_image",
    ],
  ]) {
    const image = reviewedImageEnv(envName, label);
    if (!image.ok) {
      return {
        name: "kubernetes_live_smoke:plan",
        status: "blocked",
        reason: image.reason,
        configured: image.configured,
      };
    }
  }
  const timeout = boundedIntegerEnv(
    "KUBERNETES_LIVE_SMOKE_TIMEOUT_MS",
    300_000,
    3_600_000,
    "kubernetes_live_smoke_timeout_ms",
  );
  if (!timeout.ok) {
    return {
      name: "kubernetes_live_smoke:plan",
      status: "blocked",
      reason: timeout.reason,
      configured: timeout.configured,
    };
  }
  return {
    name: "kubernetes_live_smoke:plan",
    status: "ready",
    namespace,
    releaseName,
    skipBuildRequired: true,
    appImageReviewed: true,
    dependencyImageCount: 4,
    dependencyImagesDigestPinned: true,
    timeoutMs: timeout.value,
    rawImageRefsReturned: false,
  };
}

function kubernetesLiveSmokeNamespaceAvailableCheck() {
  const namespace = process.env.KUBERNETES_LIVE_SMOKE_NAMESPACE;
  if (!kubernetesNameValid(namespace)) {
    return {
      name: "kubernetes_live_smoke:namespace_available",
      status: "blocked",
      reason: "namespace_invalid",
    };
  }
  const result = run("kubectl", ["get", "namespace", namespace]);
  return {
    name: "kubernetes_live_smoke:namespace_available",
    status: result.ok ? "blocked" : "ready",
    reason: result.ok ? "namespace_already_exists" : undefined,
  };
}

function kubernetesNetworkPolicyApiCheck() {
  const result = run("kubectl", [
    "api-resources",
    "--api-group",
    "networking.k8s.io",
    "-o",
    "name",
  ]);
  if (!result.ok) {
    return {
      name: "kubernetes_networkpolicy:api",
      status: "blocked",
      reason: "networkpolicy_api_unavailable",
    };
  }
  return {
    name: "kubernetes_networkpolicy:api",
    status: "ready",
    apiGroup: "networking.k8s.io",
    resource: "networkpolicies",
    rawApiResourcesReturned: false,
  };
}

function kubernetesNetworkPolicyCniConfirmationCheck() {
  const confirmation = strictTrueEnv(
    "KUBERNETES_NETWORKPOLICY_CONFIRM_CNI_ENFORCEMENT",
    "networkpolicy_cni_enforcement",
  );
  if (!confirmation.ok) {
    return {
      name: "kubernetes_networkpolicy:cni_confirmation",
      status: "blocked",
      reason: confirmation.reason,
      configured: confirmation.configured,
    };
  }
  return {
    name: "kubernetes_networkpolicy:cni_confirmation",
    status: "ready",
    operatorConfirmedCniEnforcement: true,
  };
}

function kubernetesNetworkPolicyImagesCheck() {
  const client = reviewedImageEnv(
    "KUBERNETES_NETWORKPOLICY_CLIENT_IMAGE",
    "client_image",
  );
  if (!client.ok) {
    return {
      name: "kubernetes_networkpolicy:images",
      status: "blocked",
      reason: client.reason,
      configured: client.configured,
    };
  }
  const server = reviewedImageEnv(
    "KUBERNETES_NETWORKPOLICY_SERVER_IMAGE",
    "server_image",
  );
  if (!server.ok) {
    return {
      name: "kubernetes_networkpolicy:images",
      status: "blocked",
      reason: server.reason,
      configured: server.configured,
    };
  }
  return {
    name: "kubernetes_networkpolicy:images",
    status: "ready",
    imageCount: 2,
    digestPinned: true,
    latestTagsRejected: true,
    rawImageRefsReturned: false,
  };
}

function kubernetesNetworkPolicyProbeConfigCheck() {
  const namespace = targetNetworkPolicyNamespace();
  if (!kubernetesNameValid(namespace)) {
    return {
      name: "kubernetes_networkpolicy:probe_config",
      status: "blocked",
      reason: "namespace_invalid",
    };
  }
  const propagation = boundedIntegerEnv(
    "KUBERNETES_NETWORKPOLICY_POLICY_PROPAGATION_MS",
    1_000,
    120_000,
    "networkpolicy_policy_propagation_ms",
  );
  if (!propagation.ok) {
    return {
      name: "kubernetes_networkpolicy:probe_config",
      status: "blocked",
      reason: propagation.reason,
      configured: propagation.configured,
    };
  }
  const timeout = hasEnv("KUBERNETES_NETWORKPOLICY_TIMEOUT_MS")
    ? boundedIntegerEnv(
        "KUBERNETES_NETWORKPOLICY_TIMEOUT_MS",
        propagation.value + 30_000,
        900_000,
        "networkpolicy_timeout_ms",
      )
    : { ok: true, configured: false };
  if (!timeout.ok) {
    return {
      name: "kubernetes_networkpolicy:probe_config",
      status: "blocked",
      reason: timeout.reason,
      configured: timeout.configured,
    };
  }
  return {
    name: "kubernetes_networkpolicy:probe_config",
    status: "ready",
    namespace: targetNetworkPolicyNamespace(),
    policyPropagationMs: propagation.value,
    timeoutConfigured: timeout.configured,
    rawPodIpsReturned: false,
    rawPodLogsReturned: false,
  };
}

function kubernetesLoadSoakParametersCheck() {
  const tier = process.env.KUBERNETES_LOAD_SOAK_TIER;
  if (tier === undefined || tier.length === 0) {
    return {
      name: "kubernetes_load_soak:parameters",
      status: "blocked",
      reason: "tier_missing",
      configured: false,
    };
  }
  if (!["small", "enterprise"].includes(tier)) {
    return {
      name: "kubernetes_load_soak:parameters",
      status: "blocked",
      reason: "tier_not_ga_scale",
      configured: true,
    };
  }
  const iterations = boundedIntegerEnv(
    "KUBERNETES_LOAD_SOAK_ITERATIONS",
    2,
    100,
    "load_soak_iterations",
  );
  if (!iterations.ok) {
    return {
      name: "kubernetes_load_soak:parameters",
      status: "blocked",
      reason: iterations.reason,
      configured: iterations.configured,
    };
  }
  const soakSeconds = boundedIntegerEnv(
    "KUBERNETES_LOAD_SOAK_SOAK_SECONDS",
    60,
    86_400,
    "load_soak_soak_seconds",
  );
  if (!soakSeconds.ok) {
    return {
      name: "kubernetes_load_soak:parameters",
      status: "blocked",
      reason: soakSeconds.reason,
      configured: soakSeconds.configured,
    };
  }
  const intervalSeconds = boundedIntegerEnv(
    "KUBERNETES_LOAD_SOAK_INTERVAL_SECONDS",
    0,
    Math.min(soakSeconds.value, 3_600),
    "load_soak_interval_seconds",
  );
  if (!intervalSeconds.ok) {
    return {
      name: "kubernetes_load_soak:parameters",
      status: "blocked",
      reason: intervalSeconds.reason,
      configured: intervalSeconds.configured,
    };
  }
  const timeoutMs = boundedIntegerEnv(
    "KUBERNETES_LOAD_SOAK_TIMEOUT_MS",
    Math.max(120_000, soakSeconds.value * 1_000),
    86_400_000,
    "load_soak_timeout_ms",
  );
  if (!timeoutMs.ok) {
    return {
      name: "kubernetes_load_soak:parameters",
      status: "blocked",
      reason: timeoutMs.reason,
      configured: timeoutMs.configured,
    };
  }
  return {
    name: "kubernetes_load_soak:parameters",
    status: "ready",
    tier,
    iterations: iterations.value,
    requestedSoakSeconds: soakSeconds.value,
    intervalSeconds: intervalSeconds.value,
    timeoutConfigured: true,
    gaCompatible: true,
  };
}

function kubernetesLoadSoakTargetCheck() {
  const servicePort = hasEnv("KUBERNETES_LOAD_SOAK_SERVICE_PORT")
    ? boundedIntegerEnv(
        "KUBERNETES_LOAD_SOAK_SERVICE_PORT",
        1,
        65_535,
        "load_soak_service_port",
      )
    : { ok: true, configured: false };
  if (!servicePort.ok) {
    return {
      name: "kubernetes_load_soak:target",
      status: "blocked",
      reason: servicePort.reason,
      configured: servicePort.configured,
    };
  }
  const baseUrl = process.env.KUBERNETES_LOAD_SOAK_BASE_URL;
  if (baseUrl !== undefined && baseUrl.length > 0) {
    const posture = safeHttpUrlPosture(baseUrl);
    if (posture.status === "blocked") {
      return {
        name: "kubernetes_load_soak:target",
        status: "blocked",
        reason: posture.reason,
        origin: posture.origin,
        baseUrlConfigured: true,
      };
    }
    return {
      name: "kubernetes_load_soak:target",
      status: "ready",
      mode: "provided_base_url",
      origin: posture.origin,
      servicePortConfigured: servicePort.configured,
      rawSelectorReturned: false,
      rawBaseUrlReturned: false,
    };
  }
  return {
    name: "kubernetes_load_soak:target",
    status: "ready",
    mode: "port_forward",
    servicePortConfigured: servicePort.configured,
    rawSelectorReturned: false,
    rawBaseUrlReturned: false,
  };
}

function legacyKubernetesResourceCheck(checkName) {
  const [, kind, resourceName, namespaceOverride] = checkName.split(":");
  return {
    kind,
    resourceName,
    namespace: namespaceOverride ?? targetKubernetesNamespace(),
    name: checkName,
  };
}

function targetKubernetesNamespace() {
  return safeKubernetesName(process.env.ROMEO_NAMESPACE ?? "romeo");
}

function targetKubernetesReleaseName() {
  return safeKubernetesName(process.env.ROMEO_RELEASE_NAME ?? "romeo");
}

function targetKubernetesServiceName() {
  return safeKubernetesName(
    process.env.ROMEO_SERVICE_NAME ??
      helmFullname(targetKubernetesReleaseName()),
  );
}

function targetKubernetesDeploymentName() {
  return safeKubernetesName(
    process.env.ROMEO_DEPLOYMENT_NAME ??
      helmFullname(targetKubernetesReleaseName()),
  );
}

function targetKubernetesLiveSmokeNamespace() {
  return safeKubernetesName(
    process.env.KUBERNETES_LIVE_SMOKE_NAMESPACE ?? "romeo-live-smoke",
  );
}

function targetKubernetesLiveSmokeReleaseName() {
  return safeKubernetesName(
    process.env.KUBERNETES_LIVE_SMOKE_RELEASE_NAME ?? "romeo-live",
  );
}

function targetKedaNamespace() {
  return safeKubernetesName(process.env.KEDA_NAMESPACE ?? "keda");
}

function targetKedaScaledJobName() {
  return safeKubernetesName(
    process.env.KEDA_SCALEDJOB_NAME ?? "romeo-webhook-retry",
  );
}

function targetKedaTriggerAuthenticationName() {
  return safeKubernetesName(
    process.env.KEDA_TRIGGERAUTHENTICATION_NAME ??
      "romeo-webhook-retry-postgres",
  );
}

function targetNetworkPolicyNamespace() {
  return safeKubernetesName(
    process.env.KUBERNETES_NETWORKPOLICY_NAMESPACE ?? "romeo-cni-smoke",
  );
}

function targetHostedCiRunSelectorArgs() {
  if (hasEnv("GITHUB_CI_RUN_ID")) {
    return "--run-id $GITHUB_CI_RUN_ID";
  }
  return "--head-sha $GITHUB_CI_HEAD_SHA";
}

function helmFullname(value) {
  const chartName = "romeo";
  const name = value.includes(chartName) ? value : `${value}-${chartName}`;
  return name.slice(0, 63).replace(/-+$/u, "");
}

function safeKubernetesName(value) {
  return kubernetesNameValid(value) ? value : "invalid-kubernetes-name";
}

function kubernetesNameValid(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 253 &&
    /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/u.test(value)
  );
}

function targetApiCheck(config) {
  const baseUrl = config.baseUrl ?? process.env.ROMEO_BASE_URL;
  if (baseUrl === undefined || baseUrl.length === 0) {
    return {
      name: "target_api",
      status: "blocked",
      reason: "base_url_missing",
    };
  }
  const posture = safeHttpUrlPosture(baseUrl);
  if (posture.status === "blocked") {
    return {
      name: "target_api",
      status: "blocked",
      reason: posture.reason,
      origin: posture.origin,
    };
  }
  return {
    name: "target_api",
    status: "ready",
    origin: posture.origin,
  };
}

function prometheusCheck(config) {
  const prometheusUrl = config.prometheusUrl ?? process.env.PROMETHEUS_URL;
  if (prometheusUrl === undefined || prometheusUrl.length === 0) {
    return {
      name: "prometheus",
      status: "blocked",
      reason: "prometheus_url_missing",
    };
  }
  const posture = safeHttpUrlPosture(prometheusUrl);
  if (posture.status === "blocked") {
    return {
      name: "prometheus",
      status: "blocked",
      reason: posture.reason,
      origin: posture.origin,
    };
  }
  return {
    name: "prometheus",
    status: "ready",
    origin: posture.origin,
  };
}

function alertmanagerOptionalCheck() {
  const alertmanagerUrl = process.env.ALERTMANAGER_URL;
  if (alertmanagerUrl === undefined || alertmanagerUrl.length === 0) {
    return {
      name: "alertmanager",
      status: "optional",
      configured: false,
    };
  }
  const posture = safeHttpUrlPosture(alertmanagerUrl);
  if (posture.status === "blocked") {
    return {
      name: "alertmanager",
      status: "blocked",
      reason: posture.reason,
      origin: posture.origin,
      configured: true,
    };
  }
  return {
    name: "alertmanager",
    status: "ready",
    origin: posture.origin,
    configured: true,
  };
}

function alertRulesDefinedCheck() {
  const required = configuredRequiredAlerts();
  const ruleNames = new Set(collectAlertRuleNames());
  const missing = required
    .map((alert) => alert.name)
    .filter((name) => !ruleNames.has(name));
  return {
    name: "alerts:rules_defined",
    status: missing.length === 0 ? "ready" : "blocked",
    reason: missing.length === 0 ? undefined : "required_alert_rules_missing",
    requiredAlertCount: required.length,
    missingAlertCount: missing.length,
    customRequiredAlertsConfigured: hasEnv("ALERT_FIRING_REQUIRED_ALERTS"),
  };
}

function alertRequiredCategoriesCheck() {
  const required = configuredRequiredAlerts();
  const categories = new Set(required.map((alert) => alert.category));
  const missing = ["provider", "queue", "backup"].filter(
    (category) => !categories.has(category),
  );
  return {
    name: "alerts:required_categories",
    status: missing.length === 0 ? "ready" : "blocked",
    reason: missing.length === 0 ? undefined : "required_category_missing",
    providerConfigured: categories.has("provider"),
    queueConfigured: categories.has("queue"),
    backupConfigured: categories.has("backup"),
    customRequiredAlertsConfigured: hasEnv("ALERT_FIRING_REQUIRED_ALERTS"),
  };
}

function edgeRequiredControlsCheck() {
  const adminPosture = strictTrueEnv(
    "EDGE_ENFORCEMENT_REQUIRE_ADMIN_POSTURE",
    "admin_posture",
  );
  if (!adminPosture.ok) {
    return {
      name: "edge:required_controls",
      status: "blocked",
      reason: adminPosture.reason,
      configured: adminPosture.configured,
    };
  }
  const wafBlockMode = strictTrueEnv(
    "EDGE_ENFORCEMENT_REQUIRE_WAF_BLOCK_MODE",
    "waf_block_mode",
  );
  if (!wafBlockMode.ok) {
    return {
      name: "edge:required_controls",
      status: "blocked",
      reason: wafBlockMode.reason,
      configured: wafBlockMode.configured,
    };
  }
  const bodyLimitBytes = boundedIntegerEnv(
    "EDGE_ENFORCEMENT_BODY_LIMIT_BYTES",
    1_024,
    20 * 1024 * 1024,
    "body_limit_bytes",
  );
  if (!bodyLimitBytes.ok) {
    return {
      name: "edge:required_controls",
      status: "blocked",
      reason: bodyLimitBytes.reason,
      configured: bodyLimitBytes.configured,
    };
  }
  const rateLimitAttempts = boundedIntegerEnv(
    "EDGE_ENFORCEMENT_RATE_LIMIT_ATTEMPTS",
    2,
    100,
    "rate_limit_attempts",
  );
  if (!rateLimitAttempts.ok) {
    return {
      name: "edge:required_controls",
      status: "blocked",
      reason: rateLimitAttempts.reason,
      configured: rateLimitAttempts.configured,
    };
  }
  return {
    name: "edge:required_controls",
    status: "ready",
    adminPostureRequired: true,
    wafBlockModeRequired: true,
    bodyLimitBytesConfigured: true,
    bodyLimitBytesWithinBounds: true,
    rateLimitAttempts: rateLimitAttempts.value,
    rawValuesReturned: false,
  };
}

function edgeStatusExpectationsCheck() {
  const bodyStatuses = httpStatusesEnv(
    "EDGE_ENFORCEMENT_BODY_LIMIT_EXPECTED_STATUSES",
    "body_limit_statuses",
  );
  if (!bodyStatuses.ok) {
    return {
      name: "edge:status_expectations",
      status: "blocked",
      reason: bodyStatuses.reason,
      configured: bodyStatuses.configured,
    };
  }
  const wafStatuses = httpStatusesEnv(
    "EDGE_ENFORCEMENT_WAF_EXPECTED_STATUSES",
    "waf_statuses",
  );
  if (!wafStatuses.ok) {
    return {
      name: "edge:status_expectations",
      status: "blocked",
      reason: wafStatuses.reason,
      configured: wafStatuses.configured,
    };
  }
  const rateStatus = boundedIntegerEnv(
    "EDGE_ENFORCEMENT_RATE_LIMIT_EXPECTED_STATUS",
    100,
    599,
    "rate_limit_expected_status",
  );
  if (!rateStatus.ok) {
    return {
      name: "edge:status_expectations",
      status: "blocked",
      reason: rateStatus.reason,
      configured: rateStatus.configured,
    };
  }
  const bodyAllowed = new Set([413, 429]);
  const wafAllowed = new Set([403, 406, 429]);
  if (!bodyStatuses.values.every((status) => bodyAllowed.has(status))) {
    return {
      name: "edge:status_expectations",
      status: "blocked",
      reason: "body_limit_statuses_not_ga_compatible",
      configured: true,
      bodyLimitStatusCount: bodyStatuses.values.length,
    };
  }
  if (!wafStatuses.values.every((status) => wafAllowed.has(status))) {
    return {
      name: "edge:status_expectations",
      status: "blocked",
      reason: "waf_statuses_not_ga_compatible",
      configured: true,
      wafStatusCount: wafStatuses.values.length,
    };
  }
  if (rateStatus.value !== 429) {
    return {
      name: "edge:status_expectations",
      status: "blocked",
      reason: "rate_limit_expected_status_not_429",
      configured: true,
    };
  }
  return {
    name: "edge:status_expectations",
    status: "ready",
    bodyLimitStatusCount: bodyStatuses.values.length,
    wafStatusCount: wafStatuses.values.length,
    rateLimitExpectedStatusConfigured: true,
    gaCompatible: true,
    rawValuesReturned: false,
  };
}

function edgeProbePathsCheck() {
  const headerPath = edgeProbePathFromEnv(
    "EDGE_ENFORCEMENT_HEADER_PATH",
    "header_path",
    { fallback: "/api/v1/health" },
  );
  const bodyLimitPath = edgeProbePathFromEnv(
    "EDGE_ENFORCEMENT_BODY_LIMIT_PATH",
    "body_limit_path",
  );
  const rateLimitPath = edgeProbePathFromEnv(
    "EDGE_ENFORCEMENT_RATE_LIMIT_PATH",
    "rate_limit_path",
  );
  const wafProbePath = edgeProbePathFromEnv(
    "EDGE_ENFORCEMENT_WAF_PROBE_PATH",
    "waf_probe_path",
  );
  const paths = [headerPath, bodyLimitPath, rateLimitPath, wafProbePath];
  const blockedPath = paths.find((path) => path.status === "blocked");
  if (blockedPath !== undefined) {
    return {
      name: "edge:probe_paths",
      status: "blocked",
      reason: blockedPath.reason,
      configured: blockedPath.configured,
    };
  }
  const wafProbeHeader = optionalHeaderNameEnv(
    "EDGE_ENFORCEMENT_WAF_PROBE_HEADER_NAME",
    "waf_probe_header_name",
  );
  if (wafProbeHeader.status === "blocked") {
    return {
      name: "edge:probe_paths",
      status: "blocked",
      reason: wafProbeHeader.reason,
      configured: wafProbeHeader.configured,
    };
  }
  const wafExpectedHeader = optionalHeaderNameEnv(
    "EDGE_ENFORCEMENT_WAF_EXPECTED_HEADER",
    "waf_expected_header",
  );
  if (wafExpectedHeader.status === "blocked") {
    return {
      name: "edge:probe_paths",
      status: "blocked",
      reason: wafExpectedHeader.reason,
      configured: wafExpectedHeader.configured,
    };
  }
  const wafProbeHeaderValue = optionalHeaderValueEnv(
    "EDGE_ENFORCEMENT_WAF_PROBE_HEADER_VALUE",
    "waf_probe_header_value",
  );
  if (wafProbeHeaderValue.status === "blocked") {
    return {
      name: "edge:probe_paths",
      status: "blocked",
      reason: wafProbeHeaderValue.reason,
      configured: wafProbeHeaderValue.configured,
    };
  }
  const wafProbePayloadConfigured =
    wafProbePath.shape.queryParameterCount > 0 || wafProbeHeader.configured;
  if (!wafProbePayloadConfigured) {
    return {
      name: "edge:probe_paths",
      status: "blocked",
      reason: "waf_probe_payload_missing",
      configured: true,
    };
  }
  return {
    name: "edge:probe_paths",
    status: "ready",
    pathCount: 4,
    headerPath: headerPath.shape,
    bodyLimitPath: bodyLimitPath.shape,
    rateLimitPath: rateLimitPath.shape,
    wafProbePath: wafProbePath.shape,
    wafProbePayloadConfigured,
    wafProbeHeaderConfigured: wafProbeHeader.configured,
    wafExpectedHeaderConfigured: wafExpectedHeader.configured,
    wafProbeHeaderValueConfigured: wafProbeHeaderValue.configured,
    rawPathsReturned: false,
    rawQueryValuesReturned: false,
    rawHeaderValuesReturned: false,
  };
}

function strictTrueEnv(name, label) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    return { ok: false, reason: `${label}_missing`, configured: false };
  }
  if (["true", "1", "yes", "on"].includes(value.trim().toLowerCase())) {
    return { ok: true, configured: true };
  }
  return { ok: false, reason: `${label}_not_true`, configured: true };
}

function boundedIntegerEnv(name, min, max, label) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    return { ok: false, reason: `${label}_missing`, configured: false };
  }
  if (!/^\d+$/u.test(value.trim())) {
    return { ok: false, reason: `${label}_invalid`, configured: true };
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return {
      ok: false,
      reason: `${label}_out_of_bounds`,
      configured: true,
    };
  }
  return { ok: true, configured: true, value: parsed };
}

function httpStatusesEnv(name, label) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    return { ok: false, reason: `${label}_missing`, configured: false };
  }
  const values = splitCsv(value);
  if (values.length === 0) {
    return { ok: false, reason: `${label}_empty`, configured: true };
  }
  const statuses = values.map((entry) => Number.parseInt(entry, 10));
  if (
    statuses.some(
      (status, index) =>
        values[index] !== String(status) || status < 100 || status > 599,
    )
  ) {
    return { ok: false, reason: `${label}_invalid`, configured: true };
  }
  return { ok: true, configured: true, values: statuses };
}

function reviewedImageEnv(name, label) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    return { ok: false, reason: `${label}_missing`, configured: false };
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 512 ||
    /[\s"'`$\\\0]/u.test(trimmed)
  ) {
    return { ok: false, reason: `${label}_invalid`, configured: true };
  }
  if (trimmed.endsWith(":latest") || trimmed.includes(":latest@")) {
    return {
      ok: false,
      reason: `${label}_latest_tag_rejected`,
      configured: true,
    };
  }
  if (!/@sha256:[a-f0-9]{64}$/u.test(trimmed)) {
    return {
      ok: false,
      reason: `${label}_digest_pin_required`,
      configured: true,
    };
  }
  return { ok: true, configured: true };
}

function reviewedImmutableImageEnv(name, label) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    return { ok: false, reason: `${label}_missing`, configured: false };
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 512 ||
    /[\s"'`$\\\0]/u.test(trimmed)
  ) {
    return { ok: false, reason: `${label}_invalid`, configured: true };
  }
  const digestIndex = trimmed.indexOf("@sha256:");
  if (digestIndex < 0 || !/@sha256:[a-f0-9]{64}$/u.test(trimmed)) {
    return {
      ok: false,
      reason: `${label}_digest_pin_required`,
      configured: true,
    };
  }
  const tagPart = trimmed.slice(0, digestIndex);
  const slashIndex = tagPart.lastIndexOf("/");
  const colonIndex = tagPart.lastIndexOf(":");
  if (colonIndex <= slashIndex || colonIndex === tagPart.length - 1) {
    return { ok: false, reason: `${label}_tag_required`, configured: true };
  }
  const tag = tagPart.slice(colonIndex + 1);
  if (tag === "latest") {
    return {
      ok: false,
      reason: `${label}_latest_tag_rejected`,
      configured: true,
    };
  }
  return { ok: true, configured: true };
}

function edgeProbePathFromEnv(name, label, options = {}) {
  const configured = hasEnv(name);
  const value = configured ? process.env[name] : options.fallback;
  if (value === undefined || value.length === 0) {
    return {
      status: "blocked",
      reason: `${label}_missing`,
      configured,
    };
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) || value.startsWith("//")) {
    return {
      status: "blocked",
      reason: `${label}_absolute_url_not_allowed`,
      configured,
    };
  }
  if (!value.startsWith("/")) {
    return {
      status: "blocked",
      reason: `${label}_relative_path_required`,
      configured,
    };
  }
  if (value.includes("\0") || value.length > 2048) {
    return {
      status: "blocked",
      reason: `${label}_invalid`,
      configured,
    };
  }
  let parsed;
  try {
    parsed = new URL(value, "https://romeo.invalid");
  } catch {
    return {
      status: "blocked",
      reason: `${label}_invalid`,
      configured,
    };
  }
  if (parsed.hash.length > 0) {
    return {
      status: "blocked",
      reason: `${label}_fragment_not_allowed`,
      configured,
    };
  }
  return {
    status: "ready",
    configured,
    shape: {
      pathDepth: parsed.pathname.split("/").filter(Boolean).length,
      queryParameterCount: [...parsed.searchParams.keys()].length,
      hasQuery: parsed.search.length > 0,
      pathReturned: false,
      queryValuesReturned: false,
    },
  };
}

function optionalHeaderNameEnv(name, label) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    return { status: "ready", configured: false };
  }
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u.test(value)) {
    return {
      status: "blocked",
      reason: `${label}_invalid`,
      configured: true,
    };
  }
  return { status: "ready", configured: true };
}

function optionalHeaderValueEnv(name, label) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    return { status: "ready", configured: false };
  }
  if (value.length > 512 || /[\r\n\0]/u.test(value)) {
    return {
      status: "blocked",
      reason: `${label}_invalid`,
      configured: true,
    };
  }
  return { status: "ready", configured: true };
}

function configuredRequiredAlerts() {
  const configured = splitCsv(process.env.ALERT_FIRING_REQUIRED_ALERTS);
  const names =
    configured.length > 0
      ? configured
      : [
          "RomeoProviderCircuitOpen",
          "RomeoBackgroundJobQueuedLag",
          "RomeoBackgroundJobDeadLetters",
          "RomeoPostgresBackupJobFailed",
        ];
  return names.map((name) => ({ name, category: categoryForAlert(name) }));
}

function collectAlertRuleNames() {
  try {
    return parseAllDocuments(
      readFileSync("deploy/monitoring/prometheus-rules.yaml", "utf8"),
    )
      .map((doc) => doc.toJSON())
      .filter((doc) => doc?.kind === "PrometheusRule")
      .flatMap((doc) => doc.spec?.groups ?? [])
      .flatMap((group) => group.rules ?? [])
      .map((rule) => rule.alert)
      .filter((name) => typeof name === "string" && name.length > 0);
  } catch {
    return [];
  }
}

function categoryForAlert(name) {
  const normalized = name.toLowerCase();
  if (normalized.includes("backup")) return "backup";
  if (normalized.includes("job") || normalized.includes("queue")) {
    return "queue";
  }
  if (normalized.includes("provider")) return "provider";
  return "custom";
}

function releaseArtifactCheck() {
  return {
    name: "release_artifacts",
    status: "ready",
    reason:
      "file and credential checks cover the local release-readback prerequisites",
  };
}

function releaseReadbackPlanCheck() {
  const path = process.env.RELEASE_READBACK_PLAN_FILE;
  if (path === undefined || path.length === 0) {
    return {
      name: "release_readback:plan",
      status: "blocked",
      reason: "path_missing",
      configured: false,
    };
  }
  const safePath = safeRelativePath(path);
  if (safePath === "[redacted-path]" || path.includes("\0")) {
    return {
      name: "release_readback:plan",
      status: "blocked",
      reason: "path_unsafe",
      configured: true,
      path: safePath,
    };
  }
  const resolved = resolve(process.cwd(), path);
  if (!existsSync(resolved)) {
    return {
      name: "release_readback:plan",
      status: "blocked",
      reason: "file_missing",
      configured: true,
      path: safePath,
    };
  }
  let plan;
  try {
    plan = readReleaseReadbackPlan(resolved);
  } catch {
    return {
      name: "release_readback:plan",
      status: "blocked",
      reason: "invalid_json_or_shape",
      configured: true,
      path: safePath,
    };
  }
  const validation = validateReleaseReadbackPlan(plan);
  if (validation.status === "blocked") {
    return {
      name: "release_readback:plan",
      status: "blocked",
      reason: validation.reason,
      configured: true,
      path: safePath,
      imageCount: validation.imageCount,
      chartCount: validation.chartCount,
      assetCount: validation.assetCount,
      requiredAssetNames: validation.requiredAssetNames,
    };
  }
  return {
    name: "release_readback:plan",
    status: "ready",
    configured: true,
    path: safePath,
    imageCount: validation.imageCount,
    chartCount: validation.chartCount,
    assetCount: validation.assetCount,
    requiredAssetNames: validation.requiredAssetNames,
  };
}

function kubernetesDrPlanCheck() {
  const path = process.env.KUBERNETES_DR_PLAN_FILE;
  if (path === undefined || path.length === 0) {
    return {
      name: "kubernetes_dr:plan",
      status: "blocked",
      reason: "path_missing",
      configured: false,
    };
  }
  const safePath = safeRelativePath(path);
  if (safePath === "[redacted-path]" || path.includes("\0")) {
    return {
      name: "kubernetes_dr:plan",
      status: "blocked",
      reason: "path_unsafe",
      configured: true,
      path: safePath,
    };
  }
  const resolved = resolve(process.cwd(), path);
  if (!existsSync(resolved)) {
    return {
      name: "kubernetes_dr:plan",
      status: "blocked",
      reason: "file_missing",
      configured: true,
      path: safePath,
    };
  }
  let plan;
  try {
    plan = readKubernetesDrPlan(resolved);
  } catch {
    return {
      name: "kubernetes_dr:plan",
      status: "blocked",
      reason: "invalid_json_or_shape",
      configured: true,
      path: safePath,
    };
  }
  const validation = validateKubernetesDrPlan(plan);
  return {
    name: "kubernetes_dr:plan",
    status: validation.status,
    reason: validation.reason,
    configured: true,
    path: safePath,
    requiredModes: requiredKubernetesDrModes,
    modeCount: validation.modeCount,
    namespacePairCount: validation.namespacePairCount,
    cloudnativepgSecretRefsConfigured:
      validation.cloudnativepgSecretRefsConfigured,
    secretNamesReturned: false,
  };
}

function kubernetesDrRuntimePlanCheck() {
  const skipBuild = strictTrueEnv(
    "KUBERNETES_DR_SKIP_BUILD",
    "kubernetes_dr_skip_build",
  );
  if (!skipBuild.ok) {
    return {
      name: "kubernetes_dr:runtime_plan",
      status: "blocked",
      reason: skipBuild.reason,
      configured: skipBuild.configured,
    };
  }
  const appImage = reviewedImmutableImageEnv(
    "KUBERNETES_DR_APP_IMAGE",
    "app_image",
  );
  if (!appImage.ok) {
    return {
      name: "kubernetes_dr:runtime_plan",
      status: "blocked",
      reason: appImage.reason,
      configured: appImage.configured,
    };
  }
  return {
    name: "kubernetes_dr:runtime_plan",
    status: "ready",
    skipBuildRequired: true,
    appImageReviewed: true,
    rawImageRefsReturned: false,
  };
}

function validateKubernetesDrPlan(plan) {
  const base = {
    modeCount: requiredKubernetesDrModes.filter((mode) => {
      const entry = plan.modes?.[mode];
      return (
        entry?.sourceNamespace !== undefined ||
        entry?.restoreNamespace !== undefined
      );
    }).length,
    namespacePairCount: 0,
    cloudnativepgSecretRefsConfigured: false,
  };
  if (plan.schemaVersion !== "romeo.kubernetes-dr-plan.v1") {
    return { ...base, status: "blocked", reason: "schema_mismatch" };
  }
  for (const mode of requiredKubernetesDrModes) {
    const entry = plan.modes?.[mode];
    if (entry === undefined) {
      return { ...base, status: "blocked", reason: `${mode}_missing` };
    }
    for (const field of ["sourceNamespace", "restoreNamespace"]) {
      if (!kubernetesNameValid(entry[field])) {
        return {
          ...base,
          status: "blocked",
          reason: `${mode}_${field}_invalid`,
        };
      }
    }
    if (entry.sourceNamespace === entry.restoreNamespace) {
      return {
        ...base,
        status: "blocked",
        reason: `${mode}_namespaces_not_isolated`,
      };
    }
    if (
      entry.releaseName !== undefined &&
      !kubernetesNameValid(entry.releaseName)
    ) {
      return {
        ...base,
        status: "blocked",
        reason: `${mode}_release_name_invalid`,
      };
    }
    base.namespacePairCount += 1;
  }
  const cloudnativepg = plan.modes.cloudnativepg;
  if (
    parseKubernetesSecretRef(cloudnativepg.sourceDatabaseUrlSecret) ===
      undefined ||
    parseKubernetesSecretRef(cloudnativepg.restoreDatabaseUrlSecret) ===
      undefined
  ) {
    return {
      ...base,
      status: "blocked",
      reason: "cloudnativepg_secret_refs_invalid",
    };
  }
  base.cloudnativepgSecretRefsConfigured = true;
  return { ...base, status: "ready" };
}

function kubernetesDrCloudNativePgSecretCheck(role) {
  const plan = configuredKubernetesDrPlan();
  if (plan === undefined) {
    return {
      name: `kubernetes_dr:cloudnativepg:${role}_secret`,
      status: "blocked",
      reason: "plan_missing_or_invalid",
    };
  }
  const mode = plan.modes.cloudnativepg;
  const secretRef = parseKubernetesSecretRef(
    role === "source"
      ? mode.sourceDatabaseUrlSecret
      : mode.restoreDatabaseUrlSecret,
  );
  const namespace =
    role === "source" ? mode.sourceNamespace : mode.restoreNamespace;
  if (secretRef === undefined || !kubernetesNameValid(namespace)) {
    return {
      name: `kubernetes_dr:cloudnativepg:${role}_secret`,
      status: "blocked",
      reason: "secret_ref_invalid",
    };
  }
  const result = run("kubectl", [
    "get",
    "secret",
    secretRef.name,
    "-n",
    namespace,
  ]);
  return {
    name: `kubernetes_dr:cloudnativepg:${role}_secret`,
    status: result.ok ? "ready" : "blocked",
    reason: result.ok ? undefined : "secret_unavailable",
    secretNameReturned: false,
    secretKeyReturned: false,
    secretValueReturned: false,
  };
}

function configuredKubernetesDrPlan() {
  const path = process.env.KUBERNETES_DR_PLAN_FILE;
  if (path === undefined || path.length === 0) return undefined;
  if (safeRelativePath(path) === "[redacted-path]" || path.includes("\0")) {
    return undefined;
  }
  const resolved = resolve(process.cwd(), path);
  if (!existsSync(resolved)) return undefined;
  try {
    const plan = readKubernetesDrPlan(resolved);
    return validateKubernetesDrPlan(plan).status === "ready" ? plan : undefined;
  } catch {
    return undefined;
  }
}

function parseKubernetesSecretRef(value) {
  if (typeof value !== "string") return undefined;
  const [name, key] = value.split(":", 2);
  if (
    !kubernetesNameValid(name) ||
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > 253 ||
    !/^[A-Za-z0-9._-]+$/u.test(key)
  ) {
    return undefined;
  }
  return { name, key };
}

function validateReleaseReadbackPlan(plan) {
  const requiredAssetNamesFound = plan.assets
    .map((asset) => releasePlanAssetName(asset.required))
    .filter((name) => name !== undefined);
  const summary = {
    imageCount: plan.images.length,
    chartCount: plan.charts.length,
    assetCount: plan.assets.length,
    requiredAssetNames: requiredReleaseAssetNames.filter((name) =>
      requiredAssetNamesFound.includes(name),
    ),
  };
  if (plan.schemaVersion !== "romeo.release-readback-plan.v1") {
    return { ...summary, status: "blocked", reason: "schema_mismatch" };
  }
  if (plan.images.length < 1) {
    return { ...summary, status: "blocked", reason: "image_missing" };
  }
  if (plan.charts.length < 1) {
    return { ...summary, status: "blocked", reason: "chart_missing" };
  }
  if (plan.helmRepositoryUrl === undefined) {
    return {
      ...summary,
      status: "blocked",
      reason: "helm_repository_url_missing",
    };
  }
  const helmPosture = safeHttpUrlPosture(plan.helmRepositoryUrl);
  if (helmPosture.status === "blocked") {
    return {
      ...summary,
      status: "blocked",
      reason: `helm_repository_${helmPosture.reason}`,
    };
  }
  for (const image of plan.images) {
    const parsed = releasePlanImage(image.readback);
    if (parsed === undefined) {
      return { ...summary, status: "blocked", reason: "image_invalid" };
    }
    if (image.required !== parsed.image) {
      return {
        ...summary,
        status: "blocked",
        reason: "image_required_mismatch",
      };
    }
  }
  for (const chart of plan.charts) {
    const parsed = releasePlanChart(chart.readback);
    if (parsed === undefined) {
      return { ...summary, status: "blocked", reason: "chart_invalid" };
    }
    if (chart.required !== `${parsed.name}:${parsed.version}`) {
      return {
        ...summary,
        status: "blocked",
        reason: "chart_required_mismatch",
      };
    }
  }
  for (const asset of plan.assets) {
    const parsed = releasePlanAsset(asset.readback);
    const required = releasePlanRequiredAsset(asset.required);
    if (parsed === undefined || required === undefined) {
      return { ...summary, status: "blocked", reason: "asset_invalid" };
    }
    if (
      parsed.name !== required.name ||
      parsed.sha256 !== required.sha256 ||
      parsed.urlPosture.status === "blocked"
    ) {
      return {
        ...summary,
        status: "blocked",
        reason:
          parsed.urlPosture.status === "blocked"
            ? `asset_${parsed.urlPosture.reason}`
            : "asset_required_mismatch",
      };
    }
  }
  const missingAssets = requiredReleaseAssetNames.filter(
    (name) => !requiredAssetNamesFound.includes(name),
  );
  if (missingAssets.length > 0) {
    return {
      ...summary,
      status: "blocked",
      reason: "required_assets_missing",
    };
  }
  return { ...summary, status: "ready" };
}

function releasePlanImage(value) {
  const [image, digest] = value.split("@");
  if (
    typeof image !== "string" ||
    image.length === 0 ||
    typeof digest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(digest) ||
    image.endsWith(":latest")
  ) {
    return undefined;
  }
  return { image, digest };
}

function releasePlanChart(value) {
  const [identity, digest] = value.split("@");
  const [name, version] = identity.split(":");
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    typeof version !== "string" ||
    version.length === 0 ||
    (digest !== undefined && !/^sha256:[a-f0-9]{64}$/u.test(digest))
  ) {
    return undefined;
  }
  return { name, version, digest };
}

function releasePlanAsset(value) {
  const digestIndex = value.lastIndexOf("@sha256:");
  if (digestIndex <= 0) return undefined;
  const assignment = value.slice(0, digestIndex);
  const sha256 = value.slice(digestIndex + "@sha256:".length);
  const separator = assignment.indexOf("=");
  if (separator <= 0 || separator === assignment.length - 1) return undefined;
  const name = assignment.slice(0, separator);
  if (!releaseAssetNameValid(name) || !/^[a-f0-9]{64}$/u.test(sha256)) {
    return undefined;
  }
  return {
    name,
    sha256,
    urlPosture: safeHttpUrlPosture(assignment.slice(separator + 1)),
  };
}

function releasePlanRequiredAsset(value) {
  const digestIndex = value.lastIndexOf("@sha256:");
  if (digestIndex <= 0) return undefined;
  const name = value.slice(0, digestIndex);
  const sha256 = value.slice(digestIndex + "@sha256:".length);
  if (!releaseAssetNameValid(name) || !/^[a-f0-9]{64}$/u.test(sha256)) {
    return undefined;
  }
  return { name, sha256 };
}

function releasePlanAssetName(value) {
  return releasePlanRequiredAsset(value)?.name;
}

function releaseAssetNameValid(value) {
  return /^[a-z0-9][a-z0-9._:-]{0,80}$/u.test(value);
}

function targetQualityAgentIdsCheck() {
  const value = process.env.TARGET_QUALITY_AGENT_IDS;
  if (value === undefined || value.length === 0) {
    return {
      name: "target_quality:agent_ids",
      status: "blocked",
      reason: "agent_ids_missing",
      configured: false,
    };
  }
  const agentIds = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (agentIds.length === 0) {
    return {
      name: "target_quality:agent_ids",
      status: "blocked",
      reason: "agent_ids_empty",
      configured: true,
    };
  }
  if (
    agentIds.some(
      (agentId) => agentId.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(agentId),
    )
  ) {
    return {
      name: "target_quality:agent_ids",
      status: "blocked",
      reason: "agent_id_invalid",
      configured: true,
      count: agentIds.length,
    };
  }
  return {
    name: "target_quality:agent_ids",
    status: "ready",
    configured: true,
    count: agentIds.length,
  };
}

function targetQualityReplayFileCheck() {
  const path = process.env.TARGET_QUALITY_REPLAY_FILE;
  if (path === undefined || path.length === 0) {
    return {
      name: "target_quality:replay_file",
      status: "blocked",
      reason: "path_missing",
      configured: false,
    };
  }
  const safePath = safeRelativePath(path);
  if (safePath === "[redacted-path]" || path.includes("\0")) {
    return {
      name: "target_quality:replay_file",
      status: "blocked",
      reason: "path_unsafe",
      configured: true,
      path: safePath,
    };
  }
  const resolved = resolve(process.cwd(), path);
  if (!existsSync(resolved)) {
    return {
      name: "target_quality:replay_file",
      status: "blocked",
      reason: "file_missing",
      configured: true,
      path: safePath,
    };
  }
  let content;
  try {
    content = JSON.parse(readFileSync(resolved, "utf8"));
  } catch {
    return {
      name: "target_quality:replay_file",
      status: "blocked",
      reason: "invalid_json",
      configured: true,
      path: safePath,
    };
  }
  if (Array.isArray(content.cases) && content.cases.length > 0) {
    return {
      name: "target_quality:replay_file",
      status: "ready",
      configured: true,
      path: safePath,
      kind: "single",
      caseCount: content.cases.length,
    };
  }
  if (
    Array.isArray(content.baseline) &&
    content.baseline.length > 0 &&
    Array.isArray(content.candidate) &&
    content.candidate.length > 0
  ) {
    return {
      name: "target_quality:replay_file",
      status: "ready",
      configured: true,
      path: safePath,
      kind: "compare",
      baselineCaseCount: content.baseline.length,
      candidateCaseCount: content.candidate.length,
    };
  }
  return {
    name: "target_quality:replay_file",
    status: "blocked",
    reason: "replay_shape_invalid",
    configured: true,
    path: safePath,
  };
}

function targetQualityVectorComparisonCheck() {
  const required =
    process.env.TARGET_QUALITY_REQUIRE_VECTOR_COMPARISON === "true";
  if (!required) {
    return {
      name: "target_quality:vector_comparison",
      status: "optional",
      required: false,
      configured: false,
    };
  }
  const replay = targetQualityReplayFileCheck();
  if (replay.status !== "ready") {
    return {
      name: "target_quality:vector_comparison",
      status: "blocked",
      reason: "replay_file_not_ready",
      required: true,
      configured: true,
    };
  }
  if (replay.kind !== "compare") {
    return {
      name: "target_quality:vector_comparison",
      status: "blocked",
      reason: "comparison_replay_required",
      required: true,
      configured: true,
      replayKind: replay.kind,
    };
  }
  const baseline = normalizeTargetQualityRouteMode(
    process.env.TARGET_QUALITY_BASELINE_VECTOR_ROUTE_MODE,
    "pgvector",
  );
  const candidate = normalizeTargetQualityRouteMode(
    process.env.TARGET_QUALITY_CANDIDATE_VECTOR_ROUTE_MODE,
    "external_vector",
  );
  if (!baseline.valid || !candidate.valid) {
    return {
      name: "target_quality:vector_comparison",
      status: "blocked",
      reason: "route_mode_invalid",
      required: true,
      configured: true,
      baselineConfigured: baseline.configured,
      candidateConfigured: candidate.configured,
    };
  }
  if (baseline.value !== "pgvector" || candidate.value !== "external_vector") {
    return {
      name: "target_quality:vector_comparison",
      status: "blocked",
      reason: "pgvector_to_external_vector_required",
      required: true,
      configured: true,
      baselineRouteMode: baseline.value,
      candidateRouteMode: candidate.value,
    };
  }
  return {
    name: "target_quality:vector_comparison",
    status: "ready",
    required: true,
    configured: true,
    baselineRouteMode: baseline.value,
    candidateRouteMode: candidate.value,
    baselineCaseCount: replay.baselineCaseCount,
    candidateCaseCount: replay.candidateCaseCount,
  };
}

function normalizeTargetQualityRouteMode(value, fallback) {
  const configured = typeof value === "string" && value.length > 0;
  const selected = configured ? value : fallback;
  const normalized = selected === "qdrant" ? "external_vector" : selected;
  return {
    configured,
    value: normalized,
    valid: normalized === "pgvector" || normalized === "external_vector",
  };
}

function ciGovernanceLiveReviewCheck() {
  const reviewed = strictTrueEnv(
    "CI_GOVERNANCE_EVIDENCE_REVIEWED",
    "ci_governance_evidence_reviewed",
  );
  if (!reviewed.ok) {
    return {
      name: "ci_governance:live_review",
      status: "blocked",
      reason: reviewed.reason,
      configured: reviewed.configured,
    };
  }
  return {
    name: "ci_governance:live_review",
    status: "ready",
    reviewed: true,
    requiredCheckCount: 3,
    branchProtectionPlanReviewed: true,
    hostedRunEvidenceReviewed: true,
    branchProtectionEvidenceReviewed: true,
    rawApiResponsesReturned: false,
    rawBranchNamesReturned: false,
    rawEnvironmentValuesReturned: false,
    rawJobLogsReturned: false,
    rawRepositorySlugReturned: false,
    rawRunUrlsReturned: false,
    rawWorkflowBodiesReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
  };
}

function githubRepositoryTargetCheck() {
  const configured = hasEnv("GITHUB_REPOSITORY");
  const value = process.env.GITHUB_REPOSITORY ?? "";
  const valid = /^[^/\s]+\/[^/\s]+$/u.test(value);
  return {
    name: "github:repository_target",
    status: configured && valid ? "ready" : "blocked",
    configured,
    valid,
    repositorySlugReturned: false,
  };
}

function githubCiRunSelectorCheck() {
  const runId = process.env.GITHUB_CI_RUN_ID ?? "";
  const headSha = process.env.GITHUB_CI_HEAD_SHA ?? "";
  const runIdConfigured = runId.length > 0;
  const headShaConfigured = headSha.length > 0;
  const runIdValid = /^\d+$/u.test(runId);
  const headShaValid = /^[a-f0-9]{7,64}$/iu.test(headSha);
  const ready =
    (runIdConfigured && runIdValid) || (headShaConfigured && headShaValid);
  return {
    name: "github:ci_run_selector",
    status: ready ? "ready" : "blocked",
    configured: runIdConfigured || headShaConfigured,
    runIdConfigured,
    headShaConfigured,
    selectorValueReturned: false,
  };
}

function identityLiveReviewCheck() {
  const reviewed = strictTrueEnv(
    "IDENTITY_LIVE_EVIDENCE_REVIEWED",
    "identity_live_evidence_reviewed",
  );
  if (!reviewed.ok) {
    return {
      name: "identity_live:review",
      status: "blocked",
      reason: reviewed.reason,
      configured: reviewed.configured,
    };
  }
  return {
    name: "identity_live:review",
    status: "ready",
    reviewed: true,
    requiredCheckCount: 10,
    accessReviewReviewed: true,
    directoryLifecycleReviewed: true,
    idpLoginReviewed: true,
    localFallbackReviewed: true,
    managedSecretBackendReviewed: true,
    rawDirectoryEntriesReturned: false,
    rawEmailAddressesReturned: false,
    rawEvidenceBodiesReturned: false,
    rawEvidencePathsReturned: false,
    rawGroupNamesReturned: false,
    rawIdpResponsesReturned: false,
    rawLdapDnsReturned: false,
    rawProviderEndpointsReturned: false,
    rawSamlAssertionsReturned: false,
    rawSecretRefsReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
  };
}

function analyticsAuthzLiveReviewCheck() {
  const reviewed = strictTrueEnv(
    "ANALYTICS_AUTHZ_EVIDENCE_REVIEWED",
    "analytics_authz_evidence_reviewed",
  );
  if (!reviewed.ok) {
    return {
      name: "analytics_authz:live_review",
      status: "blocked",
      reason: reviewed.reason,
      configured: reviewed.configured,
    };
  }
  return {
    name: "analytics_authz:live_review",
    status: "ready",
    reviewed: true,
    requiredCheckCount: 12,
    adminReadbackReviewed: true,
    csvExportReviewed: true,
    evalGrantReviewed: true,
    nonAdminDenialReviewed: true,
    crossTenantDenialReviewed: true,
    apiKeysReturned: false,
    rawAnalyticsCsvRowsReturned: false,
    rawEvalInputsReturned: false,
    rawEvalOutputsReturned: false,
    rawEvidenceBodiesReturned: false,
    rawEvidencePathsReturned: false,
    rawJobPayloadsReturned: false,
    rawOrgNamesReturned: false,
    rawProviderConfigReturned: false,
    rawSecretRefsReturned: false,
    rawUsageMetadataReturned: false,
    rawUserEmailsReturned: false,
    rawWorkspaceNamesReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
  };
}

function browserAutomationLiveReviewCheck() {
  const reviewed = strictTrueEnv(
    "BROWSER_AUTOMATION_LIVE_EVIDENCE_REVIEWED",
    "browser_automation_live_evidence_reviewed",
  );
  if (!reviewed.ok) {
    return {
      name: "browser_automation:live_review",
      status: "blocked",
      reason: reviewed.reason,
      configured: reviewed.configured,
    };
  }
  return {
    name: "browser_automation:live_review",
    status: "ready",
    reviewed: true,
    requiredCheckCount: 5,
    rawRunnerUrlReturned: false,
    rawTaskTextReturned: false,
    rawPageContentReturned: false,
    rawEvidenceBodiesReturned: false,
  };
}

function dataConnectorLiveReviewCheck() {
  const reviewed = strictTrueEnv(
    "DATA_CONNECTOR_LIVE_EVIDENCE_REVIEWED",
    "data_connector_live_evidence_reviewed",
  );
  if (!reviewed.ok) {
    return {
      name: "data_connector:live_review",
      status: "blocked",
      reason: reviewed.reason,
      configured: reviewed.configured,
    };
  }
  return {
    name: "data_connector:live_review",
    status: "ready",
    reviewed: true,
    requiredCheckCount: 7,
    rawAllowedHostsReturned: false,
    rawConnectorConfigReturned: false,
    rawConnectorContentReturned: false,
    rawEndpointUrlsReturned: false,
    rawEvidenceBodiesReturned: false,
    rawSecretRefsReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
  };
}

function toolDispatchLiveReviewCheck() {
  const reviewed = strictTrueEnv(
    "TOOL_DISPATCH_LIVE_EVIDENCE_REVIEWED",
    "tool_dispatch_live_evidence_reviewed",
  );
  if (!reviewed.ok) {
    return {
      name: "tool_dispatch:live_review",
      status: "blocked",
      reason: reviewed.reason,
      configured: reviewed.configured,
    };
  }
  return {
    name: "tool_dispatch:live_review",
    status: "ready",
    reviewed: true,
    requiredCheckCount: 9,
    rawEvidenceBodiesReturned: false,
    rawEvidencePathsReturned: false,
    rawLogLinesReturned: false,
    rawObjectStoreKeysReturned: false,
    rawOperationHostsReturned: false,
    rawPayloadValuesReturned: false,
    rawResponseBodiesReturned: false,
    rawSecretRefsReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
  };
}

function voiceProviderLiveReviewCheck() {
  const reviewed = strictTrueEnv(
    "VOICE_PROVIDER_LIVE_EVIDENCE_REVIEWED",
    "voice_provider_live_evidence_reviewed",
  );
  if (!reviewed.ok) {
    return {
      name: "voice_provider:live_review",
      status: "blocked",
      reason: reviewed.reason,
      configured: reviewed.configured,
    };
  }
  return {
    name: "voice_provider:live_review",
    status: "ready",
    reviewed: true,
    requiredCheckCount: 8,
    artifactLifecycleReviewed: true,
    failureRedactionReviewed: true,
    liveTranscriptionReviewed: true,
    liveTtsPreviewReviewed: true,
    logRedactionReviewed: true,
    streamingConsentReviewed: true,
    rawAudioReturned: false,
    rawEvidenceBodiesReturned: false,
    rawEvidencePathsReturned: false,
    rawObjectStoreKeysReturned: false,
    rawProviderEndpointReturned: false,
    rawProviderResponseReturned: false,
    rawSpeechTextReturned: false,
    rawTranscriptTextReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
  };
}

function notificationAdapterLiveReviewCheck() {
  const reviewed = strictTrueEnv(
    "NOTIFICATION_ADAPTER_LIVE_EVIDENCE_REVIEWED",
    "notification_adapter_live_evidence_reviewed",
  );
  if (!reviewed.ok) {
    return {
      name: "notification_adapter:live_review",
      status: "blocked",
      reason: reviewed.reason,
      configured: reviewed.configured,
    };
  }
  return {
    name: "notification_adapter:live_review",
    status: "ready",
    reviewed: true,
    requiredCheckCount: 9,
    channelIsolationReviewed: true,
    egressPolicyReviewed: true,
    liveDeliveryReviewed: true,
    logRedactionReviewed: true,
    mixedChannelRoutingReviewed: true,
    retryDeadLetterReviewed: true,
    secretResolutionReviewed: true,
    rawDestinationsReturned: false,
    rawEndpointUrlsReturned: false,
    rawEvidenceBodiesReturned: false,
    rawEvidencePathsReturned: false,
    rawLogLinesReturned: false,
    rawMessageBodiesReturned: false,
    rawProviderResponsesReturned: false,
    rawSecretRefsReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
  };
}

function dataRightsRetentionLiveReviewCheck() {
  const logReview = strictTrueEnv(
    "DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_EVIDENCE_REVIEWED",
    "data_rights_operational_log_retention_evidence_reviewed",
  );
  if (!logReview.ok) {
    return {
      name: "data_rights_retention:live_review",
      status: "blocked",
      reason: logReview.reason,
      configured: logReview.configured,
    };
  }
  const backupReview = strictTrueEnv(
    "DATA_RIGHTS_BACKUP_RETENTION_EVIDENCE_REVIEWED",
    "data_rights_backup_retention_evidence_reviewed",
  );
  if (!backupReview.ok) {
    return {
      name: "data_rights_retention:live_review",
      status: "blocked",
      reason: backupReview.reason,
      configured: backupReview.configured,
    };
  }
  const operationalLogDays = boundedIntegerEnv(
    "DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_DAYS",
    1,
    36500,
    "data_rights_operational_log_retention_days",
  );
  if (!operationalLogDays.ok) {
    return {
      name: "data_rights_retention:live_review",
      status: "blocked",
      reason: operationalLogDays.reason,
      configured: operationalLogDays.configured,
    };
  }
  const backupDays = boundedIntegerEnv(
    "DATA_RIGHTS_BACKUP_RETENTION_DAYS",
    1,
    36500,
    "data_rights_backup_retention_days",
  );
  if (!backupDays.ok) {
    return {
      name: "data_rights_retention:live_review",
      status: "blocked",
      reason: backupDays.reason,
      configured: backupDays.configured,
    };
  }
  return {
    name: "data_rights_retention:live_review",
    status: "ready",
    reviewed: true,
    operationalLogRetentionDays: operationalLogDays.value,
    backupRetentionDays: backupDays.value,
    backupLocationsReturned: false,
    evidenceFileBodiesReturned: false,
    rawEvidencePathsReturned: false,
    rawLogDestinationsReturned: false,
    rawSystemNamesReturned: false,
    secretValuesReturned: false,
  };
}

function billingOperationsLiveReviewCheck() {
  const reviewed = strictTrueEnv(
    "BILLING_OPERATIONS_EVIDENCE_REVIEWED",
    "billing_operations_evidence_reviewed",
  );
  if (!reviewed.ok) {
    return {
      name: "billing_operations:live_review",
      status: "blocked",
      reason: reviewed.reason,
      configured: reviewed.configured,
    };
  }
  return {
    name: "billing_operations:live_review",
    status: "ready",
    reviewed: true,
    requiredCheckCount: 6,
    entitlementWorkerReviewed: true,
    lifecycleWorkerReviewed: true,
    apiReadbackReviewed: true,
    alertingReviewed: true,
    workerLogRedactionReviewed: true,
    evidenceFileBodiesReturned: false,
    rawAlertPayloadsReturned: false,
    rawApiKeysReturned: false,
    rawBillingProviderPayloadsReturned: false,
    rawCustomerIdentifiersReturned: false,
    rawEvidencePathsReturned: false,
    rawWorkerLogsReturned: false,
    secretValuesReturned: false,
  };
}

function auditIntegrityLiveReviewCheck() {
  const reviewed = strictTrueEnv(
    "AUDIT_INTEGRITY_EVIDENCE_REVIEWED",
    "audit_integrity_evidence_reviewed",
  );
  if (!reviewed.ok) {
    return {
      name: "audit_integrity:live_review",
      status: "blocked",
      reason: reviewed.reason,
      configured: reviewed.configured,
    };
  }
  return {
    name: "audit_integrity:live_review",
    status: "ready",
    reviewed: true,
    requiredCheckCount: 7,
    auditExportReviewed: true,
    siemDeliveryReviewed: true,
    immutableStorageReviewed: true,
    retentionPolicyReviewed: true,
    timeSyncReviewed: true,
    checksumChainReviewed: true,
    evidenceFileBodiesReturned: false,
    rawActorIdentifiersReturned: false,
    rawAuditMetadataReturned: false,
    rawDestinationReturned: false,
    rawEvidencePathsReturned: false,
    rawSiemPayloadsReturned: false,
    secretValuesReturned: false,
  };
}

function tenantPurgeLiveReviewCheck() {
  const reviewed = strictTrueEnv(
    "TENANT_PURGE_EVIDENCE_REVIEWED",
    "tenant_purge_evidence_reviewed",
  );
  if (!reviewed.ok) {
    return {
      name: "tenant_purge:live_review",
      status: "blocked",
      reason: reviewed.reason,
      configured: reviewed.configured,
    };
  }
  return {
    name: "tenant_purge:live_review",
    status: "ready",
    reviewed: true,
    requiredCheckCount: 8,
    appDatabasePurgeReviewed: true,
    appObjectStorePurgeReviewed: true,
    externalVectorReviewed: true,
    backupRetentionReviewed: true,
    operationalLogRetentionReviewed: true,
    supportBundleRetentionReviewed: true,
    externalSecretStoreReviewed: true,
    backupLocationsReturned: false,
    evidenceFileBodiesReturned: false,
    objectStoreKeysReturned: false,
    operationalLogBodiesReturned: false,
    rawEvidencePathsReturned: false,
    secretValuesReturned: false,
    supportBundleBodiesReturned: false,
    vectorValuesReturned: false,
  };
}

function supportBundleLiveReviewCheck() {
  const reviewed = strictTrueEnv(
    "SUPPORT_BUNDLE_EVIDENCE_REVIEWED",
    "support_bundle_evidence_reviewed",
  );
  if (!reviewed.ok) {
    return {
      name: "support_bundle:live_review",
      status: "blocked",
      reason: reviewed.reason,
      configured: reviewed.configured,
    };
  }
  return {
    name: "support_bundle:live_review",
    status: "ready",
    reviewed: true,
    requiredCheckCount: 7,
    bundleGeneratedReviewed: true,
    redactionEvidenceReviewed: true,
    accessReviewEvidenceLinked: true,
    dataRightsPostureReviewed: true,
    deploymentInventoryReviewed: true,
    migrationInventoryReviewed: true,
    configuredSecretPostureReviewed: true,
    backupLocationsReturned: false,
    connectorPayloadsReturned: false,
    environmentValuesReturned: false,
    evidenceFileBodiesReturned: false,
    logBodiesReturned: false,
    objectStoreKeysReturned: false,
    promptsReturned: false,
    providerPayloadsReturned: false,
    rawEvidencePathsReturned: false,
    reportBodiesReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
    vectorValuesReturned: false,
  };
}

function targetResilienceDrillsReviewCheck() {
  const reviewEnv = [
    ["PROVIDER_OUTAGE_EVIDENCE_REVIEWED", "provider_outage_evidence_reviewed"],
    ["MIGRATION_DRILL_EVIDENCE_REVIEWED", "migration_drill_evidence_reviewed"],
    [
      "NETWORK_PARTITION_EVIDENCE_REVIEWED",
      "network_partition_evidence_reviewed",
    ],
    [
      "SECRET_ROTATION_DRILL_EVIDENCE_REVIEWED",
      "secret_rotation_drill_evidence_reviewed",
    ],
  ];
  for (const [envName, label] of reviewEnv) {
    const reviewed = strictTrueEnv(envName, label);
    if (!reviewed.ok) {
      return {
        name: "target_resilience_drills:review",
        status: "blocked",
        reason: reviewed.reason,
        configured: reviewed.configured,
      };
    }
  }
  return {
    name: "target_resilience_drills:review",
    status: "ready",
    reviewed: true,
    requiredDrillCount: 4,
    providerOutageReviewed: true,
    migrationDrillReviewed: true,
    networkPartitionReviewed: true,
    secretRotationReviewed: true,
    evidenceFileBodiesReturned: false,
    keyMaterialReturned: false,
    rawDatabaseUrlsReturned: false,
    rawEvidencePathsReturned: false,
    rawLogLinesReturned: false,
    rawNetworkEndpointsReturned: false,
    rawProviderPayloadsReturned: false,
    rawSqlReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
  };
}

function postgresOperationsTargetCheck() {
  const tier = process.env.POSTGRES_OPERATIONAL_TARGET_TIER;
  if (tier === undefined || tier.length === 0) {
    return {
      name: "postgres_operations:target",
      status: "blocked",
      reason: "target_tier_missing",
      configured: false,
    };
  }
  if (!["small", "enterprise"].includes(tier)) {
    return {
      name: "postgres_operations:target",
      status: "blocked",
      reason: "target_tier_not_ga_scale",
      configured: true,
    };
  }
  const mode = process.env.POSTGRES_OPERATIONAL_MODE;
  if (mode === undefined || mode.length === 0) {
    return {
      name: "postgres_operations:target",
      status: "blocked",
      reason: "postgres_mode_missing",
      configured: false,
    };
  }
  if (!["cloudnativepg", "external-hosted-postgres"].includes(mode)) {
    return {
      name: "postgres_operations:target",
      status: "blocked",
      reason: "postgres_mode_invalid",
      configured: true,
    };
  }
  const databaseUrl = process.env.DATABASE_URL;
  const parsed = safeUrl(databaseUrl);
  if (parsed === undefined) {
    return {
      name: "postgres_operations:target",
      status: "blocked",
      reason: "database_url_invalid",
      databaseUrlConfigured: hasEnv("DATABASE_URL"),
    };
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return {
      name: "postgres_operations:target",
      status: "blocked",
      reason: "database_url_protocol_invalid",
      databaseUrlConfigured: true,
    };
  }
  const sslmode = parsed.searchParams.get("sslmode");
  if (mode === "external-hosted-postgres" && sslmode !== "verify-full") {
    return {
      name: "postgres_operations:target",
      status: "blocked",
      reason: "hosted_tls_verify_full_required",
      deploymentTier: tier,
      postgresMode: mode,
      databaseUrlConfigured: true,
      rawDatabaseUrlReturned: false,
      rawDatabaseHostReturned: false,
    };
  }
  return {
    name: "postgres_operations:target",
    status: "ready",
    deploymentTier: tier,
    postgresMode: mode,
    representativeVolumeRequired: true,
    databaseUrlConfigured: true,
    databaseUrlProtocolValid: true,
    hostedTlsVerifyFull: mode === "external-hosted-postgres" ? true : undefined,
    rawDatabaseUrlReturned: false,
    rawDatabaseHostReturned: false,
    secretValuesReturned: false,
  };
}

function postgresTelemetryThresholdsCheck() {
  const windowMinutes = boundedIntegerEnv(
    "POSTGRES_TELEMETRY_WINDOW_MINUTES",
    5,
    1_440,
    "postgres_telemetry_window_minutes",
  );
  if (!windowMinutes.ok) {
    return {
      name: "postgres_operations:telemetry_thresholds",
      status: "blocked",
      reason: windowMinutes.reason,
      configured: windowMinutes.configured,
    };
  }
  const slowThresholdMs = boundedIntegerEnv(
    "POSTGRES_SLOW_QUERY_THRESHOLD_MS",
    1,
    60_000,
    "postgres_slow_query_threshold_ms",
  );
  if (!slowThresholdMs.ok) {
    return {
      name: "postgres_operations:telemetry_thresholds",
      status: "blocked",
      reason: slowThresholdMs.reason,
      configured: slowThresholdMs.configured,
    };
  }
  const maxBlockedSessions = boundedIntegerEnv(
    "POSTGRES_MAX_BLOCKED_SESSIONS",
    0,
    1_000,
    "postgres_max_blocked_sessions",
  );
  if (!maxBlockedSessions.ok) {
    return {
      name: "postgres_operations:telemetry_thresholds",
      status: "blocked",
      reason: maxBlockedSessions.reason,
      configured: maxBlockedSessions.configured,
    };
  }
  const maxDeadlocks = boundedIntegerEnv(
    "POSTGRES_MAX_DEADLOCKS",
    0,
    1_000,
    "postgres_max_deadlocks",
  );
  if (!maxDeadlocks.ok) {
    return {
      name: "postgres_operations:telemetry_thresholds",
      status: "blocked",
      reason: maxDeadlocks.reason,
      configured: maxDeadlocks.configured,
    };
  }
  return {
    name: "postgres_operations:telemetry_thresholds",
    status: "ready",
    windowMinutes: windowMinutes.value,
    slowThresholdMs: slowThresholdMs.value,
    maxBlockedSessions: maxBlockedSessions.value,
    maxDeadlocks: maxDeadlocks.value,
    pgStatStatementsRequired: true,
    rawSqlReturned: false,
    rawTelemetryRowsReturned: false,
  };
}

function postgresArchivalDecisionCheck() {
  const decision = process.env.POSTGRES_ARCHIVAL_DECISION;
  if (decision === undefined || decision.length === 0) {
    return {
      name: "postgres_operations:archival_decision",
      status: "blocked",
      reason: "archival_decision_missing",
      configured: false,
    };
  }
  if (
    ![
      "no_runtime_partitioning_enabled",
      "partitioning_required",
      "archival_required",
      "partitioning_and_archival_required",
    ].includes(decision)
  ) {
    return {
      name: "postgres_operations:archival_decision",
      status: "blocked",
      reason: "archival_decision_invalid",
      configured: true,
    };
  }
  return {
    name: "postgres_operations:archival_decision",
    status: "ready",
    decision,
    acceptedDecisionRequired: true,
    migrationRequired: decision !== "no_runtime_partitioning_enabled",
    rawSqlReturned: false,
    rawTableRowsReturned: false,
    secretValuesReturned: false,
  };
}

function resolveCommand(command) {
  return typeof command === "function" ? command() : command;
}

function qdrantDrTargetCheck(label, envName) {
  const value = process.env[envName];
  if (value === undefined || value.length === 0) {
    return {
      name: `qdrant_dr:${label}`,
      status: "blocked",
      reason: "url_missing",
    };
  }
  const url = safeUrl(value);
  if (url === undefined) {
    return {
      name: `qdrant_dr:${label}`,
      status: "blocked",
      reason: "url_invalid",
      origin: "invalid_url",
    };
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return {
      name: `qdrant_dr:${label}`,
      status: "blocked",
      reason: "url_contains_unsafe_parts",
      origin: url.origin,
    };
  }
  return {
    name: `qdrant_dr:${label}`,
    status: "ready",
    origin: url.origin,
  };
}

function qdrantDrRunSecretCheck() {
  const value = process.env.QDRANT_DR_RUN_SECRET;
  if (value === undefined || value.length === 0) {
    return {
      name: "qdrant_dr:run_secret",
      status: "blocked",
      reason: "run_secret_missing",
      configured: false,
    };
  }
  return {
    name: "qdrant_dr:run_secret",
    status: value.length >= 32 ? "ready" : "blocked",
    reason: value.length >= 32 ? undefined : "run_secret_too_short",
    configured: true,
  };
}

function qdrantDrNamespacePolicyCheck() {
  const namespacePolicy = process.env.VECTOR_NAMESPACE_POLICY;
  const partitioningPolicy = process.env.VECTOR_PARTITIONING_POLICY;
  if (!validQdrantNamespacePolicy(namespacePolicy)) {
    return {
      name: "qdrant_dr:namespace_policy",
      status: "blocked",
      reason:
        namespacePolicy === undefined || namespacePolicy.length === 0
          ? "namespace_policy_missing"
          : namespacePolicy === "none"
            ? "namespace_policy_none"
            : "namespace_policy_invalid",
      namespacePolicyConfigured:
        namespacePolicy !== undefined && namespacePolicy.length > 0,
      partitioningPolicyConfigured:
        partitioningPolicy !== undefined && partitioningPolicy.length > 0,
      namespaceValuesReturned: false,
      partitionValuesReturned: false,
    };
  }
  if (!validQdrantPartitioningPolicy(partitioningPolicy)) {
    return {
      name: "qdrant_dr:namespace_policy",
      status: "blocked",
      reason:
        partitioningPolicy === undefined || partitioningPolicy.length === 0
          ? "partitioning_policy_missing"
          : "partitioning_policy_invalid",
      namespacePolicy,
      namespacePolicyConfigured: true,
      partitioningPolicyConfigured:
        partitioningPolicy !== undefined && partitioningPolicy.length > 0,
      namespaceValuesReturned: false,
      partitionValuesReturned: false,
    };
  }
  return {
    name: "qdrant_dr:namespace_policy",
    status: "ready",
    namespacePolicy,
    partitioningPolicy,
    namespacePolicyConfigured: true,
    partitioningPolicyConfigured: true,
    namespaceValuesReturned: false,
    partitionValuesReturned: false,
  };
}

function qdrantLiveReviewCheck() {
  const reviewed = strictTrueEnv(
    "QDRANT_LIVE_EVIDENCE_REVIEWED",
    "qdrant_live_evidence_reviewed",
  );
  if (!reviewed.ok) {
    return {
      name: "qdrant_live:review",
      status: "blocked",
      reason: reviewed.reason,
      configured: reviewed.configured,
    };
  }
  return {
    name: "qdrant_live:review",
    status: "ready",
    reviewed: true,
    evidenceFileBodiesReturned: false,
    rawEvidencePathsReturned: false,
  };
}

function qdrantLiveTargetCheck() {
  const urlValue = process.env.QDRANT_URL;
  const collectionConfigured = hasEnv("QDRANT_COLLECTION");
  if (urlValue === undefined || urlValue.length === 0) {
    return {
      name: "qdrant_live:target",
      status: "blocked",
      reason: "url_missing",
      endpointConfigured: false,
      collectionConfigured,
    };
  }
  const urlPosture = safeHttpUrlPosture(urlValue);
  if (urlPosture.status !== "ready") {
    return {
      name: "qdrant_live:target",
      status: "blocked",
      reason: urlPosture.reason,
      origin: urlPosture.origin,
      endpointConfigured: true,
      collectionConfigured,
      endpointReturned: false,
      collectionReturned: false,
    };
  }
  return {
    name: "qdrant_live:target",
    status: collectionConfigured ? "ready" : "blocked",
    reason: collectionConfigured ? undefined : "collection_missing",
    origin: urlPosture.origin,
    endpointConfigured: true,
    endpointValid: true,
    collectionConfigured,
    endpointReturned: false,
    collectionReturned: false,
  };
}

function qdrantLiveCredentialsCheck() {
  const configured = hasEnv("QDRANT_API_KEY");
  return {
    name: "qdrant_live:credentials",
    status: configured ? "ready" : "blocked",
    reason: configured ? undefined : "api_key_missing",
    credentialConfigured: configured,
    apiKeyReturned: false,
    secretValuesReturned: false,
  };
}

function qdrantLiveNamespacePolicyCheck() {
  const namespacePolicy = process.env.VECTOR_NAMESPACE_POLICY;
  const partitioningPolicy = process.env.VECTOR_PARTITIONING_POLICY;
  if (!validQdrantNamespacePolicy(namespacePolicy)) {
    return {
      name: "qdrant_live:namespace_policy",
      status: "blocked",
      reason:
        namespacePolicy === "none"
          ? "namespace_policy_none"
          : "namespace_policy_invalid",
      namespacePolicyConfigured:
        namespacePolicy !== undefined && namespacePolicy.length > 0,
      partitioningPolicyConfigured:
        partitioningPolicy !== undefined && partitioningPolicy.length > 0,
      namespaceValuesReturned: false,
      partitionValuesReturned: false,
    };
  }
  if (!validQdrantPartitioningPolicy(partitioningPolicy)) {
    return {
      name: "qdrant_live:namespace_policy",
      status: "blocked",
      reason:
        partitioningPolicy === undefined || partitioningPolicy.length === 0
          ? "partitioning_policy_missing"
          : "partitioning_policy_invalid",
      namespacePolicy,
      namespacePolicyConfigured: true,
      partitioningPolicyConfigured:
        partitioningPolicy !== undefined && partitioningPolicy.length > 0,
      namespaceValuesReturned: false,
      partitionValuesReturned: false,
    };
  }
  return {
    name: "qdrant_live:namespace_policy",
    status: "ready",
    namespacePolicy,
    partitioningPolicy,
    namespacePolicyConfigured: true,
    partitioningPolicyConfigured: true,
    namespaceValuesReturned: false,
    partitionValuesReturned: false,
  };
}

function validQdrantNamespacePolicy(value) {
  return value === "knowledge_base" || value === "org" || value === "workspace";
}

function validQdrantPartitioningPolicy(value) {
  return (
    value === "knowledge_base" ||
    value === "none" ||
    value === "org" ||
    value === "workspace"
  );
}

function commandCheck(command) {
  const result = run(command, ["--version"]);
  return {
    name: `command:${command}`,
    status: result.found ? "ready" : "blocked",
    reason: result.found ? undefined : "command_not_found",
  };
}

function envCheck(name) {
  return {
    name: `env:${name}`,
    status: hasEnv(name) ? "ready" : "blocked",
    configured: hasEnv(name),
  };
}

function optionalEnvCheck(name) {
  return {
    name: `env:${name}`,
    status: "optional",
    configured: hasEnv(name),
  };
}

function envAnyCheck(names) {
  return {
    name: `env_any:${names.join("|")}`,
    status: names.some(hasEnv) ? "ready" : "blocked",
    configuredNames: names.filter(hasEnv),
  };
}

function fileCheck(path) {
  return {
    name: `file:${path}`,
    status: existsSync(resolve(process.cwd(), path)) ? "ready" : "blocked",
    path,
  };
}

function hasEnv(name) {
  const value = process.env[name];
  return value !== undefined && value.length > 0;
}

function splitCsv(value) {
  if (typeof value !== "string" || value.length === 0) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return {
    found: result.error?.code !== "ENOENT",
    ok: result.status === 0,
    stdout: sanitizeLine(result.stdout),
  };
}

function readChecklist(path) {
  const resolved = resolve(process.cwd(), path);
  if (!existsSync(resolved)) {
    throw new Error(
      `GA checklist not found at ${path}. Run pnpm ga:checklist -- --output ${path} first.`,
    );
  }
  return JSON.parse(readFileSync(resolved, "utf8"));
}

function checklistSummary(checklist, path) {
  return {
    path,
    schemaVersion: checklist.schemaVersion,
    status: checklist.status,
    summary: checklist.summary,
  };
}

function missingEvidencePaths(gate) {
  return (Array.isArray(gate.evidence) ? gate.evidence : []).map((entry) => ({
    path: safeRelativePath(entry.path),
    status: entry.status,
    schemaVersion: entry.schemaVersion,
  }));
}

function summarize(gates) {
  return {
    total: gates.length,
    ready: gates.filter((gate) => gate.status === "ready").length,
    blocked: gates.filter((gate) => gate.status === "blocked").length,
    securityCriticalBlocked: gates.filter(
      (gate) => gate.status === "blocked" && gate.securityCritical,
    ).length,
  };
}

function safeHttpUrlPosture(value) {
  const url = safeUrl(value);
  if (url === undefined) {
    return { status: "blocked", reason: "url_invalid", origin: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      status: "blocked",
      reason: "url_protocol_unsupported",
      origin: "invalid_url",
    };
  }
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return {
      status: "blocked",
      reason: "url_contains_unsafe_parts",
      origin: url.origin,
    };
  }
  return { status: "ready", origin: url.origin };
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function safeRelativePath(path) {
  if (typeof path !== "string") return undefined;
  if (path.startsWith("/") || path.includes("..")) return "[redacted-path]";
  return path;
}

function sanitizeLine(value) {
  return value.split(/\r?\n/u)[0]?.trim().slice(0, 200) ?? "";
}
