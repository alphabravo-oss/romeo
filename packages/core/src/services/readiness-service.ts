import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";

import type { EffectiveAuthProviderSetting } from "../domain/auth-provider-settings";
import type { ToolConnector } from "../domain/entities";
import {
  getRomeoRepositoryRuntime,
  type RomeoRepository,
  type RomeoRepositoryRuntime,
} from "../domain/repository";
import { AuthProviderSettingsService } from "./auth-provider-settings-service";
import type {
  KnowledgeVectorStoreReadinessProbe,
  KnowledgeVectorStoreReadinessReport,
} from "./knowledge-vector-store";
import { managedSecretKeyConfigured } from "./managed-secret-service";
import {
  qdrantEndpointValid,
  type VectorStoreDeploymentPosture,
  vectorStoreDeploymentFromEnv,
} from "./vector-store-deployment";
import {
  summarizePgvectorPhysicalIsolationEvidence,
  type PgvectorPhysicalIsolationEvidenceSummary,
} from "./pgvector-physical-isolation-evidence";
import {
  summarizeQdrantLiveEvidence,
  type QdrantLiveEvidenceSummary,
} from "./qdrant-live-evidence";
import { analyzePostgresConnectionSecurity } from "./postgres-connection-security";
import {
  GaEvidencePostureService,
  type GaEvidencePostureReport,
} from "./ga-evidence-posture-service";

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

export class ReadinessService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly env: RomeoEnv,
    private readonly vectorStoreDeployment: VectorStoreDeploymentPosture = vectorStoreDeploymentFromEnv(
      env,
    ),
    private readonly vectorStoreReadinessProbe?: KnowledgeVectorStoreReadinessProbe,
  ) {}

  async report(subject: AuthSubject): Promise<ReadinessReport> {
    assertScope(subject, "admin:read");
    const [
      providers,
      models,
      quotas,
      retentionPolicy,
      dataConnectors,
      toolConnectors,
      authProviderSettings,
    ] = await Promise.all([
      this.repository.listProviders(subject.orgId),
      this.repository.listModels(subject.orgId),
      this.repository.listQuotaBuckets(subject.orgId),
      this.repository.getRetentionPolicy(subject.orgId),
      this.repository.listDataConnectors(subject.orgId),
      this.repository.listToolConnectors(subject.orgId),
      new AuthProviderSettingsService(this.repository, this.env).report(
        subject,
      ),
    ]);

    const pgvectorPhysicalIsolationEvidence =
      await summarizePgvectorPhysicalIsolationEvidence(
        this.env.PGVECTOR_PHYSICAL_ISOLATION_EVIDENCE_PATH,
      );
    const qdrantLiveEvidence = await summarizeQdrantLiveEvidence(
      this.env.QDRANT_LIVE_EVIDENCE_PATH,
    );
    const vectorStoreCheck = await vectorStoreDeploymentCheck({
      deployment: this.vectorStoreDeployment,
      env: this.env,
      pgvectorPhysicalIsolationEvidence,
      qdrantLiveEvidence,
      readinessProbe: this.vectorStoreReadinessProbe,
    });
    const gaEvidencePosture = await new GaEvidencePostureService(
      this.env,
    ).report(subject);

    const checks: ReadinessCheck[] = [
      secretCheck(
        "session_secret",
        this.env.SESSION_SECRET,
        "Session secret must be rotated from the development default.",
      ),
      previousSecretCheck(
        "session_secret_previous",
        this.env.SESSION_SECRET_PREVIOUS,
        this.env.SESSION_SECRET,
        "Previous session secret is staged for OIDC PKCE rotation.",
      ),
      secretCheck(
        "webhook_signing_key",
        this.env.WEBHOOK_SIGNING_KEY,
        "Webhook signing key must be rotated from the development default.",
      ),
      this.env.DEV_SEEDED_LOGIN
        ? fail(
            "dev_seeded_login",
            "critical",
            "Seeded development login is enabled.",
            { required: "DEV_SEEDED_LOGIN=false" },
          )
        : pass("dev_seeded_login", "Seeded development login is disabled.", {}),
      repositoryPersistenceCheck(getRomeoRepositoryRuntime(this.repository)),
      databaseUrlCheck(this.env),
      postgresConnectionSecurityCheck(this.env),
      vectorStoreCheck,
      oidcCheck(this.env),
      localAuthSecretEncryptionKeyCheck(
        this.env,
        authProviderSettings.effective.providers,
      ),
      authProviderFallbackCheck(authProviderSettings.effective.providers),
      authProviderOidcConfigCheck(authProviderSettings.effective.providers),
      authProviderSecretRefCheck(
        this.env,
        authProviderSettings.effective.providers,
      ),
      managedSecretEncryptionKeyCheck(
        this.env,
        authProviderSettings.effective.providers,
      ),
      this.env.OBJECT_STORE_DRIVER === "memory"
        ? warn("object_storage", "Memory object storage is enabled.", {
            required: "OBJECT_STORE_DRIVER=s3",
          })
        : pass(
            "object_storage",
            "Durable object storage adapter is configured.",
            { driver: this.env.OBJECT_STORE_DRIVER },
          ),
      providers.length > 0
        ? pass("providers", "At least one provider is configured.", {
            count: providers.length,
          })
        : fail("providers", "critical", "No providers are configured.", {}),
      models.some((model) => model.enabled)
        ? pass("models", "At least one enabled model is available.", {
            enabled: models.filter((model) => model.enabled).length,
          })
        : fail("models", "critical", "No enabled models are available.", {}),
      retentionPolicy
        ? pass("retention_policy", "Audit retention policy is configured.", {
            auditLogRetentionDays: retentionPolicy.auditLogRetentionDays,
          })
        : warn("retention_policy", "Audit retention policy is missing.", {}),
      quotas.length > 0
        ? pass("quotas", "Quota buckets are configured.", {
            count: quotas.length,
          })
        : warn("quotas", "No quota buckets are configured.", {}),
      dataConnectors.some((connector) => connector.type !== "local_import") &&
      this.env.DATA_CONNECTOR_EXECUTION_DRIVER === "disabled"
        ? warn(
            "outbound_connectors",
            "Outbound connector metadata exists while execution is disabled.",
            {
              count: dataConnectors.filter(
                (connector) => connector.type !== "local_import",
              ).length,
            },
          )
        : pass(
            "outbound_connectors",
            "Outbound connector execution posture is explicit.",
            { driver: this.env.DATA_CONNECTOR_EXECUTION_DRIVER },
          ),
      connectorEgressCheck(this.env),
      toolOperationExecutionCheck(this.env, toolConnectors),
      gaEvidenceReadinessCheck(gaEvidencePosture),
    ];

    return {
      status: checks.some((check) => check.status !== "pass")
        ? "attention_required"
        : "ready",
      generatedAt: new Date().toISOString(),
      checks,
    };
  }
}

function gaEvidenceReadinessCheck(
  posture: GaEvidencePostureReport,
): ReadinessCheck {
  const details = {
    checklistConfigured: posture.checklist.configured,
    checklistStatus: posture.checklist.status,
    targetPreflightConfigured: posture.targetPreflight.configured,
    targetPreflightStatus: posture.targetPreflight.status,
    targetPlanConfigured: posture.targetPlan.configured,
    targetPlanStatus: posture.targetPlan.status,
    targetExecutionConfigured: posture.targetExecution.configured,
    targetExecutionStatus: posture.targetExecution.status,
    bundleConfigured: posture.bundle.configured,
    bundleStatus: posture.bundle.status,
    blockedGateCount: posture.checklist.summary.blocked,
    requiredLiveBlockerCount: posture.requiredLiveBlockers.length,
    liveGateReadinessCount: posture.liveGateReadiness.length,
    warningCodes: posture.warnings,
  };

  if (!posture.checklist.configured) {
    return pass(
      "ga_evidence",
      "GA evidence posture is not mounted for this runtime.",
      details,
    );
  }

  if (posture.status === "passed") {
    return pass(
      "ga_evidence",
      "Mounted GA evidence posture is passing.",
      details,
    );
  }

  return fail(
    "ga_evidence",
    "critical",
    "Mounted GA evidence posture is blocked or invalid.",
    details,
  );
}

async function vectorStoreDeploymentCheck(input: {
  env: RomeoEnv;
  deployment?: VectorStoreDeploymentPosture | undefined;
  pgvectorPhysicalIsolationEvidence: PgvectorPhysicalIsolationEvidenceSummary;
  qdrantLiveEvidence: QdrantLiveEvidenceSummary;
  readinessProbe?: KnowledgeVectorStoreReadinessProbe | undefined;
}): Promise<ReadinessCheck> {
  const env = input.env;
  const deployment =
    input.deployment ?? vectorStoreDeploymentFromEnv(input.env);
  const readinessProbe = input.readinessProbe;
  if (
    deployment.isolationMode === "pgvector_partitioned_by_org" &&
    input.pgvectorPhysicalIsolationEvidence.status !== "satisfied"
  ) {
    return fail(
      "vector_store",
      "critical",
      "pgvector partitioned vector isolation mode is configured but live database partition evidence is missing or unsatisfied.",
      {
        activeDriver: deployment.activeDriver,
        externalVectorStoreDriver: deployment.externalVectorStore.driver,
        isolationMode: deployment.isolationMode,
        required:
          "PGVECTOR_PHYSICAL_ISOLATION_EVIDENCE_PATH generated by pnpm review:pgvector-isolation in live mode",
        evidence: input.pgvectorPhysicalIsolationEvidence,
      },
    );
  }
  const external = deployment.externalVectorStore;
  if (externalIsolationMode(deployment.isolationMode)) {
    const missing = externalIsolationMissing({
      deployment,
      env,
      qdrantLiveEvidence: input.qdrantLiveEvidence,
    });
    if (missing.length > 0) {
      return fail(
        "vector_store",
        "critical",
        "External vector isolation mode is configured but active routing or reviewed live isolation evidence is incomplete.",
        {
          activeDriver: deployment.activeDriver,
          externalVectorStoreDriver: external.driver,
          externalVectorStoreConfigured: external.configured,
          externalVectorStoreRoutingActive: external.routingActive,
          isolationMode: deployment.isolationMode,
          credentialRefConfigured: external.credentialRefConfigured,
          credentialRefValid: external.credentialRefValid,
          credentialRefScheme: external.credentialRefScheme,
          namespacePolicy: external.namespacePolicy,
          partitioningPolicy: external.partitioningPolicy,
          secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
          qdrantLiveEvidence: input.qdrantLiveEvidence,
          missing,
          required:
            "active Qdrant routing plus QDRANT_LIVE_EVIDENCE_PATH generated by pnpm smoke:qdrant:live in live mode for the configured namespace and partition policies",
        },
      );
    }
  }
  if (external.driver === "disabled") {
    return pass("vector_store", "Default pgvector vector storage is active.", {
      activeDriver: deployment.activeDriver,
      externalVectorStoreDriver: external.driver,
      isolationMode: deployment.isolationMode,
      pgvectorPhysicalIsolationEvidence:
        input.pgvectorPhysicalIsolationEvidence,
    });
  }

  const missing = qdrantDeploymentMissing(deployment, env);

  if (missing.length > 0) {
    return fail(
      "vector_store",
      "critical",
      "Qdrant external vector-store mode is enabled but deployment wiring is incomplete.",
      {
        externalVectorStoreDriver: external.driver,
        missing,
        credentialRefConfigured: external.credentialRefConfigured,
        credentialRefValid: external.credentialRefValid,
        credentialRefScheme: external.credentialRefScheme,
        namespacePolicy: external.namespacePolicy,
        partitioningPolicy: external.partitioningPolicy,
        secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
        required:
          "QDRANT_URL, QDRANT_COLLECTION, QDRANT_API_KEY_REF, VECTOR_NAMESPACE_POLICY, and compatible secret resolution",
      },
    );
  }

  if (external.routingActive && readinessProbe === undefined) {
    return warn(
      "vector_store",
      "Qdrant external vector-store routing is active, but collection health probing is not configured for this service instance.",
      {
        activeDriver: deployment.activeDriver,
        externalVectorStoreDriver: external.driver,
        externalVectorStoreConfigured: external.configured,
        externalVectorStoreRoutingActive: external.routingActive,
        credentialRefScheme: external.credentialRefScheme,
        namespacePolicy: external.namespacePolicy,
        partitioningPolicy: external.partitioningPolicy,
        secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
      },
    );
  }

  if (external.routingActive && readinessProbe !== undefined) {
    const health = await readinessProbe.checkReadiness();
    if (health.status === "unavailable") {
      return fail(
        "vector_store",
        "critical",
        "Qdrant external vector-store routing is active but the collection health check failed.",
        {
          activeDriver: deployment.activeDriver,
          externalVectorStoreDriver: external.driver,
          externalVectorStoreConfigured: external.configured,
          externalVectorStoreRoutingActive: external.routingActive,
          credentialRefScheme: external.credentialRefScheme,
          namespacePolicy: external.namespacePolicy,
          partitioningPolicy: external.partitioningPolicy,
          secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
          health: sanitizedVectorStoreHealth(health),
        },
      );
    }
    return pass(
      "vector_store",
      "Qdrant external vector-store routing and collection health check are active.",
      {
        activeDriver: deployment.activeDriver,
        externalVectorStoreDriver: external.driver,
        externalVectorStoreConfigured: external.configured,
        externalVectorStoreRoutingActive: external.routingActive,
        credentialRefScheme: external.credentialRefScheme,
        namespacePolicy: external.namespacePolicy,
        partitioningPolicy: external.partitioningPolicy,
        secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
        health: sanitizedVectorStoreHealth(health),
      },
    );
  }

  return warn(
    "vector_store",
    "Qdrant external vector-store configuration is complete, but active retrieval routing is not enabled in this service instance.",
    {
      activeDriver: deployment.activeDriver,
      externalVectorStoreDriver: external.driver,
      externalVectorStoreConfigured: external.configured,
      externalVectorStoreRoutingActive: external.routingActive,
      credentialRefScheme: external.credentialRefScheme,
      namespacePolicy: external.namespacePolicy,
      partitioningPolicy: external.partitioningPolicy,
      secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
    },
  );
}

function externalIsolationMode(
  mode: VectorStoreDeploymentPosture["isolationMode"],
): boolean {
  return (
    mode === "external_namespace_per_org" ||
    mode === "external_collection_per_org" ||
    mode === "dedicated_vector_store_per_org"
  );
}

function externalIsolationMissing(input: {
  deployment: VectorStoreDeploymentPosture;
  env: RomeoEnv;
  qdrantLiveEvidence: QdrantLiveEvidenceSummary;
}): string[] {
  const external = input.deployment.externalVectorStore;
  const missing = qdrantDeploymentMissing(input.deployment, input.env);
  if (external.driver !== "qdrant") {
    missing.push("EXTERNAL_VECTOR_STORE_DRIVER=qdrant");
  }
  if (!external.routingActive) {
    missing.push("active Qdrant routing");
  }
  if (
    input.deployment.isolationMode === "external_namespace_per_org" &&
    external.namespacePolicy !== "org"
  ) {
    missing.push("VECTOR_NAMESPACE_POLICY=org");
  }
  if (input.qdrantLiveEvidence.status !== "satisfied") {
    missing.push("satisfied QDRANT_LIVE_EVIDENCE_PATH");
  }
  if (
    input.qdrantLiveEvidence.namespacePolicy !== undefined &&
    input.qdrantLiveEvidence.namespacePolicy !== external.namespacePolicy
  ) {
    missing.push("QDRANT_LIVE_EVIDENCE_PATH namespace policy match");
  }
  if (
    input.qdrantLiveEvidence.partitioningPolicy !== undefined &&
    input.qdrantLiveEvidence.partitioningPolicy !== external.partitioningPolicy
  ) {
    missing.push("QDRANT_LIVE_EVIDENCE_PATH partitioning policy match");
  }
  return Array.from(new Set(missing)).sort();
}

function qdrantDeploymentMissing(
  deployment: VectorStoreDeploymentPosture,
  env: RomeoEnv,
): string[] {
  const external = deployment.externalVectorStore;
  if (external.driver !== "qdrant") return [];
  const missing: string[] = [];
  if (!external.endpointConfigured) missing.push("QDRANT_URL");
  if (external.endpointConfigured && !qdrantEndpointValid(env.QDRANT_URL)) {
    missing.push("valid QDRANT_URL http(s) origin");
  }
  if (!external.collectionConfigured) missing.push("QDRANT_COLLECTION");
  if (!external.credentialRefConfigured) missing.push("QDRANT_API_KEY_REF");
  if (external.credentialRefConfigured && !external.credentialRefValid) {
    missing.push("valid QDRANT_API_KEY_REF managed secret URI");
  }
  if (
    external.credentialRefConfigured &&
    external.credentialRefValid &&
    external.credentialRefScheme !== "romeo-secret" &&
    env.SECRET_RESOLVER_DRIVER === "disabled"
  ) {
    missing.push("SECRET_RESOLVER_DRIVER");
  }
  if (external.namespacePolicy === "none") {
    missing.push("VECTOR_NAMESPACE_POLICY");
  }
  return missing;
}

function sanitizedVectorStoreHealth(
  health: KnowledgeVectorStoreReadinessReport,
): Record<string, unknown> {
  return {
    status: health.status,
    ...(health.collectionStatus === undefined
      ? {}
      : { collectionStatus: health.collectionStatus }),
    ...(health.failureCode === undefined
      ? {}
      : { failureCode: health.failureCode }),
    ...(health.httpStatus === undefined
      ? {}
      : { httpStatus: health.httpStatus }),
    ...(health.optimizerStatus === undefined
      ? {}
      : { optimizerStatus: health.optimizerStatus }),
  };
}

function repositoryPersistenceCheck(
  runtime: RomeoRepositoryRuntime,
): ReadinessCheck {
  if (!runtime.durable) {
    return fail(
      "repository_persistence",
      "critical",
      "Durable repository persistence is not configured.",
      {
        driver: runtime.driver,
        storageScope: runtime.storageScope,
        required: "Postgres-backed RomeoRepository",
      },
    );
  }
  return pass(
    "repository_persistence",
    "Durable repository persistence is configured.",
    {
      driver: runtime.driver,
      storageScope: runtime.storageScope,
    },
  );
}

function databaseUrlCheck(env: RomeoEnv): ReadinessCheck {
  const value = env.DATABASE_URL.trim();
  if (value.length === 0) {
    return fail("database_url", "critical", "Database URL is missing.", {
      required: "DATABASE_URL",
    });
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      return fail(
        "database_url",
        "critical",
        "Database URL must use the Postgres protocol.",
        {
          protocol: url.protocol.replace(":", ""),
          required: "postgres or postgresql",
        },
      );
    }
    return pass("database_url", "Database URL is configured.", {
      protocol: url.protocol.replace(":", ""),
      hostConfigured: url.host.length > 0,
      databaseConfigured: url.pathname.length > 1,
    });
  } catch {
    return fail(
      "database_url",
      "critical",
      "Database URL is not a valid URL.",
      { required: "valid Postgres DATABASE_URL" },
    );
  }
}

function postgresConnectionSecurityCheck(env: RomeoEnv): ReadinessCheck {
  const connectionSecurity = analyzePostgresConnectionSecurity(
    env.DATABASE_URL,
  );
  const details = {
    hostCategory: connectionSecurity.hostCategory,
    hostedPostgresTlsRecommended:
      connectionSecurity.hostedPostgresTlsRecommended,
    sslmodeSource: connectionSecurity.sslmodeSource,
    tlsConfigured: connectionSecurity.tlsConfigured,
    tlsMode: connectionSecurity.tlsMode,
    tlsVerification: connectionSecurity.tlsVerification,
    warningCodes: connectionSecurity.warningCodes,
    requiredForHostedPostgres: "sslmode=verify-full or provider equivalent",
  };
  if (!connectionSecurity.databaseUrlValid) {
    return warn(
      "postgres_connection_security",
      "Postgres connection security could not be evaluated.",
      details,
    );
  }
  if (connectionSecurity.warningCodes.length > 0) {
    return warn(
      "postgres_connection_security",
      "Remote Postgres connections should require provider TLS verification.",
      details,
    );
  }
  return pass(
    "postgres_connection_security",
    "Postgres connection security posture is configured.",
    details,
  );
}

function toolOperationExecutionCheck(
  env: RomeoEnv,
  connectors: ToolConnector[],
): ReadinessCheck {
  if (env.TOOL_OPERATION_EXECUTION_DRIVER === "disabled") {
    return pass(
      "tool_operation_execution",
      "Imported tool operation execution is disabled.",
      { driver: env.TOOL_OPERATION_EXECUTION_DRIVER },
    );
  }
  const enabledOpenApiConnectors = connectors.filter(
    (connector) => connector.type === "openapi" && connector.enabled,
  );
  const authConnectorCount = enabledOpenApiConnectors.filter(
    requiresConnectorAuth,
  ).length;
  const missingNetworkPolicyCount = enabledOpenApiConnectors.filter(
    (connector) =>
      connector.networkPolicy.mode !== "allow_hosts" ||
      connector.networkPolicy.allowedHosts.length === 0,
  ).length;
  if (authConnectorCount > 0 && env.SECRET_RESOLVER_DRIVER === "disabled") {
    return fail(
      "tool_operation_execution",
      "critical",
      "Tool operation execution has auth-enabled connectors but secret resolution is disabled.",
      {
        authConnectorCount,
        required: "SECRET_RESOLVER_DRIVER",
      },
    );
  }
  if (missingNetworkPolicyCount > 0) {
    return fail(
      "tool_operation_execution",
      "critical",
      "Tool operation execution has enabled connectors without host allowlists.",
      {
        missingNetworkPolicyCount,
        required: "tool connector network policy",
      },
    );
  }
  return pass(
    "tool_operation_execution",
    "Tool operation execution posture is explicit.",
    {
      driver: env.TOOL_OPERATION_EXECUTION_DRIVER,
      enabledOpenApiConnectorCount: enabledOpenApiConnectors.length,
      secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
    },
  );
}

function requiresConnectorAuth(connector: ToolConnector): boolean {
  return (
    typeof connector.authConfig.type === "string" &&
    connector.authConfig.type !== "none" &&
    connector.authConfig.configured === true
  );
}

function connectorEgressCheck(env: RomeoEnv): ReadinessCheck {
  const enabled = connectorDriverRequiresHostAllowlist(
    env.DATA_CONNECTOR_EXECUTION_DRIVER,
  );
  const hasAllowlist = env.DATA_CONNECTOR_FETCH_ALLOWED_HOSTS.trim().length > 0;
  if (!enabled) {
    return pass(
      "connector_egress_policy",
      "Connector egress policy is inactive while host-based connector execution is disabled.",
      {
        driver: env.DATA_CONNECTOR_EXECUTION_DRIVER,
      },
    );
  }
  if (
    env.DATA_CONNECTOR_EGRESS_POLICY === "require_allowlist" &&
    !hasAllowlist
  ) {
    return fail(
      "connector_egress_policy",
      "critical",
      "Connector egress policy requires a host allowlist.",
      {
        required: "DATA_CONNECTOR_FETCH_ALLOWED_HOSTS",
      },
    );
  }
  if (!hasAllowlist) {
    return warn(
      "connector_egress_policy",
      "Outbound connector execution allows public hosts without a host allowlist.",
      {
        policy: env.DATA_CONNECTOR_EGRESS_POLICY,
        recommended: "DATA_CONNECTOR_EGRESS_POLICY=require_allowlist",
      },
    );
  }
  return pass(
    "connector_egress_policy",
    "Connector egress host allowlist is configured.",
    {
      policy: env.DATA_CONNECTOR_EGRESS_POLICY,
    },
  );
}

function connectorDriverRequiresHostAllowlist(driver: string): boolean {
  return (
    driver === "website-fetch" ||
    driver === "atlassian-fetch" ||
    driver === "notion-fetch" ||
    driver === "linear-fetch" ||
    driver === "slack-fetch" ||
    driver === "managed-fetch"
  );
}

function localAuthSecretEncryptionKeyCheck(
  env: RomeoEnv,
  providers: EffectiveAuthProviderSetting[],
): ReadinessCheck {
  const localEnabled =
    providers.find((provider) => provider.providerId === "local")?.enabled ===
    true;
  if (!localEnabled) {
    return pass(
      "local_auth_secret_encryption_key",
      "Local auth is disabled for the effective provider policy.",
      { localAuthEnabled: false },
    );
  }
  if (unsafeSecretValue(env.LOCAL_AUTH_SECRET_ENCRYPTION_KEY)) {
    return fail(
      "local_auth_secret_encryption_key",
      "critical",
      "Local auth MFA secret encryption key must be rotated from the development default.",
      { localAuthEnabled: true, minLength: 32 },
    );
  }
  return pass(
    "local_auth_secret_encryption_key",
    "Local auth MFA secret encryption key is production-shaped.",
    { localAuthEnabled: true, minLength: 32 },
  );
}

function authProviderFallbackCheck(
  providers: EffectiveAuthProviderSetting[],
): ReadinessCheck {
  const enabledImplemented = providers.filter(
    (provider) => provider.enabled && provider.catalogStatus === "implemented",
  );
  const localEnabled = enabledImplemented.some(
    (provider) => provider.providerId === "local",
  );
  if (localEnabled) {
    return pass(
      "auth_provider_local_fallback",
      "Local authentication fallback is enabled.",
      { localAuthEnabled: true },
    );
  }
  const enabledProviderIds = enabledImplemented
    .map((provider) => provider.providerId)
    .sort();
  if (enabledProviderIds.length === 0) {
    return fail(
      "auth_provider_local_fallback",
      "critical",
      "No implemented authentication provider is enabled.",
      { required: "local auth or another implemented provider" },
    );
  }
  return warn(
    "auth_provider_local_fallback",
    "Local authentication fallback is disabled for the effective provider policy.",
    {
      enabledProviderCount: enabledProviderIds.length,
      enabledProviderIds,
    },
  );
}

function authProviderOidcConfigCheck(
  providers: EffectiveAuthProviderSetting[],
): ReadinessCheck {
  const enabledOidcProviders = providers.filter(
    (provider) =>
      provider.enabled &&
      provider.catalogStatus === "implemented" &&
      provider.protocol === "oidc",
  );
  const incompleteProviderIds = enabledOidcProviders
    .filter(
      (provider) =>
        provider.oidc?.issuerConfigured !== true ||
        provider.oidc?.clientIdConfigured !== true,
    )
    .map((provider) => provider.providerId)
    .sort();
  if (incompleteProviderIds.length > 0) {
    return fail(
      "auth_provider_oidc_config",
      "critical",
      "Enabled OIDC authentication providers have incomplete per-provider connection config.",
      {
        incompleteProviderCount: incompleteProviderIds.length,
        incompleteProviderIds,
        required: "issuer URL and client ID per enabled OIDC provider",
      },
    );
  }
  return pass(
    "auth_provider_oidc_config",
    "Enabled OIDC authentication provider config is complete.",
    { enabledOidcProviderCount: enabledOidcProviders.length },
  );
}

function authProviderSecretRefCheck(
  env: RomeoEnv,
  providers: EffectiveAuthProviderSetting[],
): ReadinessCheck {
  const configured = providers.filter(
    (provider) => provider.secretRefConfigured,
  );
  const invalidProviderIds = configured
    .filter(
      (provider) =>
        provider.secretRefScheme === undefined ||
        provider.secretRefScheme === "invalid",
    )
    .map((provider) => provider.providerId)
    .sort();
  if (invalidProviderIds.length > 0) {
    return fail(
      "auth_provider_secret_refs",
      "critical",
      "Authentication provider secret references include invalid managed-secret schemes.",
      {
        invalidProviderCount: invalidProviderIds.length,
        invalidProviderIds,
      },
    );
  }
  const schemes = [
    ...new Set(configured.map((provider) => provider.secretRefScheme)),
  ]
    .filter((scheme): scheme is string => typeof scheme === "string")
    .sort();
  const externalConfigured = configured.filter(
    (provider) => provider.secretRefScheme !== "romeo-secret",
  );
  if (
    externalConfigured.length > 0 &&
    env.SECRET_RESOLVER_DRIVER === "disabled"
  ) {
    return warn(
      "auth_provider_secret_refs",
      "Authentication provider secret refs are configured while runtime secret resolution is disabled.",
      {
        configuredProviderCount: configured.length,
        externalConfiguredProviderCount: externalConfigured.length,
        secretRefSchemes: schemes,
        secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
      },
    );
  }
  return pass(
    "auth_provider_secret_refs",
    "Authentication provider secret-ref posture is explicit.",
    {
      configuredProviderCount: configured.length,
      secretRefSchemes: schemes,
      secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
    },
  );
}

function managedSecretEncryptionKeyCheck(
  env: RomeoEnv,
  providers: EffectiveAuthProviderSetting[],
): ReadinessCheck {
  const configuredProviderIds = providers
    .filter((provider) => provider.secretRefScheme === "romeo-secret")
    .map((provider) => provider.providerId)
    .sort();
  if (configuredProviderIds.length === 0) {
    return pass(
      "managed_secret_encryption_key",
      "No locally managed encrypted auth-provider secrets are configured.",
      { managedSecretConfigured: false },
    );
  }
  if (!managedSecretKeyConfigured(env)) {
    return fail(
      "managed_secret_encryption_key",
      "critical",
      "Managed secret encryption key must be rotated from the development default.",
      {
        configuredProviderCount: configuredProviderIds.length,
        configuredProviderIds,
        minLength: 32,
      },
    );
  }
  return pass(
    "managed_secret_encryption_key",
    "Managed secret encryption key is production-shaped.",
    {
      configuredProviderCount: configuredProviderIds.length,
      configuredProviderIds,
      minLength: 32,
    },
  );
}

function secretCheck(
  id: string,
  value: string,
  message: string,
): ReadinessCheck {
  if (unsafeSecretValue(value)) {
    return fail(id, "critical", message, { minLength: 32 });
  }
  return pass(id, message, { minLength: 32 });
}

function unsafeSecretValue(value: string): boolean {
  return (
    value.startsWith("dev-") || value.includes("change-me") || value.length < 32
  );
}

function previousSecretCheck(
  id: string,
  value: string,
  currentValue: string,
  message: string,
): ReadinessCheck {
  if (value.length === 0) {
    return pass(id, "No previous session secret is staged.", {
      configured: false,
      mode: "not_staged",
    });
  }
  if (value === currentValue) {
    return fail(
      id,
      "critical",
      "Previous session secret must differ from the current secret.",
      {
        configured: true,
        required: "distinct previous secret",
      },
    );
  }
  if (
    value.startsWith("dev-") ||
    value.includes("change-me") ||
    value.length < 32
  ) {
    return fail(
      id,
      "critical",
      "Previous session secret is not production-safe.",
      {
        configured: true,
        minLength: 32,
      },
    );
  }
  return pass(id, message, {
    configured: true,
    mode: "dual_read_oidc_pkce_only",
    minLength: 32,
  });
}

function oidcCheck(env: RomeoEnv): ReadinessCheck {
  const issuerConfigured = env.OIDC_ISSUER_URL.length > 0;
  const clientConfigured = env.OIDC_CLIENT_ID.length > 0;
  if (issuerConfigured !== clientConfigured) {
    return warn("oidc_config", "OIDC is partially configured.", {
      required: ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID"],
    });
  }
  return pass(
    "oidc_config",
    issuerConfigured
      ? "OIDC issuer and client ID are configured."
      : "OIDC is not configured.",
    {
      configured: issuerConfigured,
      groupClaim: env.OIDC_GROUP_CLAIM,
      adminGroupMapping: env.OIDC_ADMIN_GROUPS.length > 0,
    },
  );
}

function pass(
  id: string,
  message: string,
  details: Record<string, unknown>,
): ReadinessCheck {
  return { id, status: "pass", severity: "info", message, details };
}

function warn(
  id: string,
  message: string,
  details: Record<string, unknown>,
): ReadinessCheck {
  return { id, status: "warn", severity: "warning", message, details };
}

function fail(
  id: string,
  severity: "critical",
  message: string,
  details: Record<string, unknown>,
): ReadinessCheck {
  return { id, status: "fail", severity, message, details };
}
