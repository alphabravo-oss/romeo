import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";

import {
  getRomeoRepositoryRuntime,
  type RomeoRepository,
} from "../domain/repository";
import { AuthProviderSettingsService } from "./auth-provider-settings-service";
import type { KnowledgeVectorStoreReadinessProbe } from "./knowledge-vector-store";
import {
  type VectorStoreDeploymentPosture,
  vectorStoreDeploymentFromEnv,
} from "./vector-store-deployment";
import { summarizePgvectorPhysicalIsolationEvidence } from "./pgvector-physical-isolation-evidence";
import { summarizeQdrantLiveEvidence } from "./qdrant-live-evidence";
import { GaEvidencePostureService } from "./ga-evidence-posture-service";
import {
  authProviderFallbackCheck,
  authProviderOidcConfigCheck,
  authProviderSecretRefCheck,
  localAuthSecretEncryptionKeyCheck,
  managedSecretEncryptionKeyCheck,
  oidcCheck,
  previousSecretCheck,
  secretCheck,
} from "./readiness-auth-checks";
import {
  connectorEgressCheck,
  databaseUrlCheck,
  postgresConnectionSecurityCheck,
  repositoryPersistenceCheck,
  toolOperationExecutionCheck,
} from "./readiness-infrastructure-checks";
import {
  fail,
  pass,
  warn,
  type ReadinessCheck,
  type ReadinessReport,
} from "./readiness-result";
import {
  gaEvidenceReadinessCheck,
  vectorStoreDeploymentCheck,
} from "./readiness-vector-store-checks";

export * from "./readiness-result";

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
