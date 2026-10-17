import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import type { ObjectStore } from "@romeo/storage";

import {
  getRomeoRepositoryRuntime,
  type RomeoRepository,
} from "../domain/repository";
import { AuthProviderSettingsService } from "./auth-provider-settings-service";
import { capabilityPlatformPolicyCheck } from "./capability-platform-policy";
import type { KnowledgeVectorStoreReadinessProbe } from "./knowledge-vector-store";
import {
  type VectorStoreDeploymentPosture,
  vectorStoreDeploymentFromEnv,
} from "./vector-store-deployment";
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
import { vectorStoreDeploymentCheck } from "./readiness-vector-store-checks";
import { objectStorageReadinessCheck } from "./readiness-object-storage";

export * from "./readiness-result";

export class ReadinessService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly env: RomeoEnv,
    private readonly vectorStoreDeployment: VectorStoreDeploymentPosture = vectorStoreDeploymentFromEnv(
      env,
    ),
    private readonly vectorStoreReadinessProbe?: KnowledgeVectorStoreReadinessProbe,
    private readonly objectStore?: ObjectStore,
  ) {}

  async objectStorageDependencyReady(): Promise<boolean> {
    return (
      (await objectStorageReadinessCheck(this.env, this.objectStore)).status ===
      "pass"
    );
  }

  async report(subject: AuthSubject): Promise<ReadinessReport> {
    assertScope(subject, "admin:read");
    const [
      providers,
      models,
      quotas,
      retentionPolicy,
      toolConnectors,
      authProviderSettings,
    ] = await Promise.all([
      this.repository.listProviders(subject.orgId),
      this.repository.listModels(subject.orgId),
      this.repository.listQuotaBuckets(subject.orgId),
      this.repository.getRetentionPolicy(subject.orgId),
      this.repository.listToolConnectors(subject.orgId),
      new AuthProviderSettingsService(this.repository, this.env).report(
        subject,
      ),
    ]);

    const objectStorageCheck = await objectStorageReadinessCheck(
      this.env,
      this.objectStore,
    );
    const vectorStoreCheck = await vectorStoreDeploymentCheck({
      deployment: this.vectorStoreDeployment,
      env: this.env,
      readinessProbe: this.vectorStoreReadinessProbe,
    });
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
      capabilityPlatformPolicyCheck(this.env),
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
      objectStorageCheck,
      providers.length > 0
        ? pass("providers", "At least one provider is configured.", {
            count: providers.length,
          })
        : fail("providers", "critical", "No providers are configured.", {}),
      models.some((model) => model.enabled && model.available !== false)
        ? pass("models", "At least one enabled model is available.", {
            enabled: models.filter(
              (model) => model.enabled && model.available !== false,
            ).length,
          })
        : fail("models", "critical", "No enabled models are available.", {}),
      retentionPolicy
        ? pass("retention_policy", "Audit retention policy is configured.", {
            auditLogRetentionDays: retentionPolicy.auditLogRetentionDays,
            runEventRetentionDays: retentionPolicy.runEventRetentionDays,
          })
        : warn("retention_policy", "Audit retention policy is missing.", {}),
      quotas.length > 0
        ? pass("quotas", "Quota buckets are configured.", {
            count: quotas.length,
          })
        : warn("quotas", "No quota buckets are configured.", {}),
      toolOperationExecutionCheck(this.env, toolConnectors),
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
