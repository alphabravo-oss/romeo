import { describe, expect, it } from "vitest";

import { readEnv } from "./index";

describe("Romeo config", () => {
  it("parses OIDC mapping configuration with safe empty defaults", () => {
    const env = readEnv({
      OIDC_ISSUER_URL: "https://keycloak.example.com/realms/romeo",
      OIDC_CLIENT_ID: "romeo",
      OIDC_GROUP_CLAIM: "groups",
      OIDC_ADMIN_GROUPS: "/romeo/admins,romeo-admin",
      OIDC_GROUP_MAP: "/romeo/users=group_users",
      OIDC_WORKSPACE_GROUP_MAP: "/romeo/finance=workspace_finance",
      OIDC_WORKSPACE_GROUP_PREFIX: "workspace:",
      DATA_CONNECTOR_EXECUTION_DRIVER: "s3-fetch",
      OPENWEBUI_COMPATIBILITY_ENABLED: "true",
      DATA_CONNECTOR_EGRESS_POLICY: "require_allowlist",
      DATA_CONNECTOR_FETCH_ALLOWED_HOSTS: "docs.example.com,*.trusted.example",
      DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS: "3",
      DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS: "750",
      DELEGATED_OAUTH_GITHUB_CLIENT_ID: "github-client-id",
      DELEGATED_OAUTH_GITHUB_CLIENT_SECRET: "github-client-secret",
      DELEGATED_OAUTH_GITHUB_SCOPES: "repo,read:user",
      DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY: "delegated-token-key-32-bytes-long",
      SECRET_RESOLVER_DRIVER: "cloud",
      VAULT_ADDR: "https://vault.example.com",
      VAULT_TOKEN: "vault-token",
      VAULT_NAMESPACE: "admin",
      VAULT_KV_MOUNT: "kv",
      VAULT_TIMEOUT_MS: "2500",
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "aws-access-key",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
      AWS_SESSION_TOKEN: "aws-session-token",
      AWS_SECRET_MANAGER_TIMEOUT_MS: "1500",
      GCP_SECRET_MANAGER_PROJECT: "romeo-prod1",
      GCP_ACCESS_TOKEN: "gcp-token",
      GCP_SECRET_MANAGER_TIMEOUT_MS: "1750",
      AZURE_KEY_VAULT_URL: "https://romeo.vault.azure.net",
      AZURE_ACCESS_TOKEN: "azure-token",
      AZURE_KEY_VAULT_TIMEOUT_MS: "2000",
      KNOWLEDGE_EXTRACTION_DRIVER: "local-documents",
      EXTERNAL_VECTOR_STORE_DRIVER: "qdrant",
      QDRANT_URL: "https://qdrant.example.com",
      QDRANT_COLLECTION: "romeo-prod",
      QDRANT_API_KEY_REF: "vault://romeo/qdrant/api-key",
      QDRANT_TIMEOUT_MS: "7500",
      VECTOR_NAMESPACE_POLICY: "org",
      VECTOR_PARTITIONING_POLICY: "workspace",
      VECTOR_ISOLATION_MODE: "external_namespace_per_org",
      NOTIFICATION_DELIVERY_DRIVER: "configured",
      NOTIFICATION_EMAIL_DELIVERY_DRIVER: "smtp",
      NOTIFICATION_EMAIL_FROM: "notify@romeo.example",
      NOTIFICATION_FCM_BASE_URL: "https://fcm.example.com",
      NOTIFICATION_FCM_PROJECT_ID: "romeo-prod",
      NOTIFICATION_FCM_SERVICE_ACCOUNT_REF: "vault://romeo/fcm",
      NOTIFICATION_FCM_TIMEOUT_MS: "8500",
      NOTIFICATION_FCM_TOKEN_URL: "https://oauth2.example.com/token",
      NOTIFICATION_PAGERDUTY_EVENTS_URL:
        "https://events.example.com/v2/enqueue",
      NOTIFICATION_PAGERDUTY_TIMEOUT_MS: "6500",
      NOTIFICATION_RESEND_API_KEY: "resend-key",
      NOTIFICATION_RESEND_BASE_URL: "https://email.example.com",
      NOTIFICATION_RESEND_TIMEOUT_MS: "3500",
      NOTIFICATION_SLACK_TIMEOUT_MS: "4500",
      NOTIFICATION_SMTP_HOST: "smtp.example.com",
      NOTIFICATION_SMTP_PASSWORD: "smtp-password",
      NOTIFICATION_SMTP_PORT: "465",
      NOTIFICATION_SMTP_SECURE: "true",
      NOTIFICATION_SMTP_TIMEOUT_MS: "5500",
      NOTIFICATION_SMTP_USER: "smtp-user",
      NOTIFICATION_TEAMS_TIMEOUT_MS: "7500",
      VOICE_PROVIDER_DRIVER: "openai-compatible",
      VOICE_OPENAI_BASE_URL: "https://voice.example.com/v1",
      VOICE_OPENAI_API_KEY: "voice-key",
      VOICE_OPENAI_MODEL: "tts-model",
      VOICE_OPENAI_VOICES: "alloy=Alloy,echo=Echo",
      VOICE_OPENAI_TIMEOUT_MS: "12000",
      BILLING_STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
      BILLING_STRIPE_WEBHOOK_TOLERANCE_SECONDS: "600",
      BILLING_GENERIC_WEBHOOK_SECRET: "generic_billing_secret",
      BILLING_GENERIC_WEBHOOK_TOLERANCE_SECONDS: "120",
      BILLING_WEBHOOK_ORG_ID: "org_billing",
      LOCAL_AUTH_SECRET_ENCRYPTION_KEY: "local-auth-secret-key-32-bytes-min",
      MANAGED_SECRET_ENCRYPTION_KEY: "managed-secret-key-32-bytes-min",
      SESSION_SECRET_PREVIOUS: "previous-session-secret-32-bytes",
      REPOSITORY_DRIVER: "postgres",
      TENANCY_MODE: "multi",
      GA_CHECKLIST_PATH: "/etc/romeo/ga-checklist.json",
      GA_TARGET_PREFLIGHT_PATH: "/etc/romeo/ga-target-preflight.json",
      GA_TARGET_PLAN_PATH: "/etc/romeo/ga-target-plan.json",
      GA_TARGET_EXECUTION_PATH: "/etc/romeo/ga-target-execution.json",
      GA_EVIDENCE_BUNDLE_PATH: "/etc/romeo/ga-evidence-bundle.json",
      RELEASE_PUBLISH_PLAN_PATH: "/etc/romeo/publish-plan.json",
      RELEASE_AIRGAP_VERIFICATION_PATH:
        "/etc/romeo/airgap-bundle-verification.json",
      RELEASE_READBACK_PLAN_PATH: "/etc/romeo/release-readback-plan.json",
      RELEASE_READBACK_VALIDATION_PATH: "/etc/romeo/readback-validation.json",
      SUPPORT_BUNDLE_PATH: "/etc/romeo/support-bundle.json",
      CI_BRANCH_PROTECTION_PLAN_PATH: "/etc/romeo/branch-protection-plan.json",
      CI_HOSTED_RUN_VERIFICATION_PATH:
        "/etc/romeo/hosted-ci-run-verification.json",
      CI_BRANCH_PROTECTION_VERIFICATION_PATH:
        "/etc/romeo/branch-protection-verification.json",
      EDGE_ENFORCEMENT_EVIDENCE_PATH: "/etc/romeo/live-edge-enforcement.json",
      POSTGRES_QUERY_PLAN_EVIDENCE_PATH: "/etc/romeo/postgres-query-plan.json",
      POSTGRES_SLOW_QUERY_TELEMETRY_EVIDENCE_PATH:
        "/etc/romeo/postgres-slow-query.json",
      POSTGRES_LOCK_TELEMETRY_EVIDENCE_PATH: "/etc/romeo/postgres-locks.json",
      POSTGRES_ARCHIVAL_PARTITIONING_DECISION_PATH:
        "/etc/romeo/postgres-archival-decision.json",
      PGVECTOR_PHYSICAL_ISOLATION_EVIDENCE_PATH:
        "/etc/romeo/pgvector-isolation.json",
      QDRANT_LIVE_EVIDENCE_PATH: "/etc/romeo/qdrant-live-evidence.json",
      DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_EVIDENCE_PATH:
        "/etc/romeo/log-retention-evidence.json",
      DATA_RIGHTS_BACKUP_RETENTION_EVIDENCE_PATH:
        "/etc/romeo/backup-retention-evidence.json",
      DATA_CONNECTOR_LIVE_EVIDENCE_PATH:
        "/etc/romeo/data-connector-live-evidence.json",
      DATA_CONNECTOR_WORKER_ENABLED: "true",
      DATA_CONNECTOR_NETWORK_POLICY_ENABLED: "true",
      TOOL_DISPATCH_WORKER_ENABLED: "true",
      TOOL_DISPATCH_NETWORK_POLICY_ENABLED: "true",
      POSTGRES_POOL_MAX: "7",
      REQUEST_BODY_MAX_BYTES: "75000000",
      FILE_INLINE_MAX_BYTES: "12000000",
      FILE_DIRECT_UPLOAD_MAX_BYTES: "250000000",
      FILE_RESUMABLE_UPLOAD_MAX_BYTES: "750000000",
      MESSAGE_ATTACHMENT_MAX_BYTES: "3000000",
      HTTP_RATE_LIMIT_DRIVER: "valkey",
      HTTP_RATE_LIMIT_KEY_PREFIX: "romeo:http:prod",
      HTTP_RATE_LIMIT_WINDOW_SECONDS: "120",
      HTTP_RATE_LIMIT_AUTH_MAX: "25",
      HTTP_RATE_LIMIT_PUBLIC_MAX: "250",
      HTTP_RATE_LIMIT_AUTHENTICATED_MAX: "5000",
      HTTP_RATE_LIMIT_WEBHOOK_MAX: "750",
      MODEL_PROVIDER_STREAM_TIMEOUT_MS: "45000",
      MODEL_PROVIDER_RETRY_ATTEMPTS: "2",
      MODEL_PROVIDER_RETRY_BACKOFF_MS: "500",
      MODEL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD: "3",
      MODEL_PROVIDER_CIRCUIT_COOLDOWN_MS: "120000",
      MODEL_PROVIDER_DISABLED_IDS: "provider_primary",
      MODEL_PROVIDER_FALLBACK_MODEL_ID: "model_fallback",
      QUOTA_COORDINATION_DRIVER: "valkey",
      QUOTA_COORDINATION_KEY_PREFIX: "romeo:quota:prod",
      QUOTA_COORDINATION_TIMEOUT_MS: "2500",
      EDGE_TLS_TERMINATION: "ingress",
      EDGE_TRUSTED_PROXY_MODE: "trusted_proxy",
      EDGE_WAF_MODE: "monitor",
      EDGE_ALLOWED_ORIGINS: "https://app.example.com,https://admin.example.com",
      EDGE_HSTS_ENABLED: "true",
      EDGE_HSTS_MAX_AGE_SECONDS: "31536000",
      EDGE_HSTS_INCLUDE_SUBDOMAINS: "true",
      EDGE_HSTS_PRELOAD: "true",
      TOOL_DISPATCH_PAYLOAD_STORE_DRIVER: "object-store",
      TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY:
        "managed-tool-payload-key-32-bytes-min",
      TOOL_DISPATCH_PAYLOAD_STORE_PREFIX: "tenant-tool-payloads/v1",
      SCIM_ENABLED: "true",
      DEV_SEEDED_LOGIN: "false",
    });

    expect(env.OIDC_ISSUER_URL).toBe(
      "https://keycloak.example.com/realms/romeo",
    );
    expect(env.OIDC_CLIENT_ID).toBe("romeo");
    expect(env.OIDC_GROUP_CLAIM).toBe("groups");
    expect(env.OIDC_ADMIN_GROUPS).toContain("/romeo/admins");
    expect(env.OIDC_GROUP_MAP).toBe("/romeo/users=group_users");
    expect(env.OIDC_WORKSPACE_GROUP_PREFIX).toBe("workspace:");
    expect(env.DATA_CONNECTOR_EXECUTION_DRIVER).toBe("s3-fetch");
    expect(env.OPENWEBUI_COMPATIBILITY_ENABLED).toBe(true);
    expect(env.DATA_CONNECTOR_EGRESS_POLICY).toBe("require_allowlist");
    expect(env.DATA_CONNECTOR_FETCH_ALLOWED_HOSTS).toBe(
      "docs.example.com,*.trusted.example",
    );
    expect(env.DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS).toBe(3);
    expect(env.DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS).toBe(750);
    expect(env.DELEGATED_OAUTH_GITHUB_CLIENT_ID).toBe("github-client-id");
    expect(env.DELEGATED_OAUTH_GITHUB_CLIENT_SECRET).toBe(
      "github-client-secret",
    );
    expect(env.DELEGATED_OAUTH_GITHUB_SCOPES).toBe("repo,read:user");
    expect(env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY).toBe(
      "delegated-token-key-32-bytes-long",
    );
    expect(env.SECRET_RESOLVER_DRIVER).toBe("cloud");
    expect(env.VAULT_ADDR).toBe("https://vault.example.com");
    expect(env.VAULT_NAMESPACE).toBe("admin");
    expect(env.VAULT_KV_MOUNT).toBe("kv");
    expect(env.VAULT_TIMEOUT_MS).toBe(2500);
    expect(env.AWS_REGION).toBe("us-east-1");
    expect(env.AWS_SECRET_MANAGER_TIMEOUT_MS).toBe(1500);
    expect(env.GCP_SECRET_MANAGER_PROJECT).toBe("romeo-prod1");
    expect(env.GCP_SECRET_MANAGER_TIMEOUT_MS).toBe(1750);
    expect(env.AZURE_KEY_VAULT_URL).toBe("https://romeo.vault.azure.net");
    expect(env.AZURE_KEY_VAULT_TIMEOUT_MS).toBe(2000);
    expect(env.KNOWLEDGE_EXTRACTION_DRIVER).toBe("local-documents");
    expect(env.EXTERNAL_VECTOR_STORE_DRIVER).toBe("qdrant");
    expect(env.QDRANT_URL).toBe("https://qdrant.example.com");
    expect(env.QDRANT_COLLECTION).toBe("romeo-prod");
    expect(env.QDRANT_API_KEY_REF).toBe("vault://romeo/qdrant/api-key");
    expect(env.QDRANT_TIMEOUT_MS).toBe(7500);
    expect(env.VECTOR_NAMESPACE_POLICY).toBe("org");
    expect(env.VECTOR_PARTITIONING_POLICY).toBe("workspace");
    expect(env.VECTOR_ISOLATION_MODE).toBe("external_namespace_per_org");
    expect(env.NOTIFICATION_DELIVERY_DRIVER).toBe("configured");
    expect(env.NOTIFICATION_EMAIL_DELIVERY_DRIVER).toBe("smtp");
    expect(env.NOTIFICATION_EMAIL_FROM).toBe("notify@romeo.example");
    expect(env.NOTIFICATION_FCM_BASE_URL).toBe("https://fcm.example.com");
    expect(env.NOTIFICATION_FCM_PROJECT_ID).toBe("romeo-prod");
    expect(env.NOTIFICATION_FCM_SERVICE_ACCOUNT_REF).toBe("vault://romeo/fcm");
    expect(env.NOTIFICATION_FCM_TIMEOUT_MS).toBe(8500);
    expect(env.NOTIFICATION_FCM_TOKEN_URL).toBe(
      "https://oauth2.example.com/token",
    );
    expect(env.NOTIFICATION_PAGERDUTY_EVENTS_URL).toBe(
      "https://events.example.com/v2/enqueue",
    );
    expect(env.NOTIFICATION_PAGERDUTY_TIMEOUT_MS).toBe(6500);
    expect(env.NOTIFICATION_RESEND_API_KEY).toBe("resend-key");
    expect(env.NOTIFICATION_RESEND_BASE_URL).toBe("https://email.example.com");
    expect(env.NOTIFICATION_RESEND_TIMEOUT_MS).toBe(3500);
    expect(env.NOTIFICATION_SLACK_TIMEOUT_MS).toBe(4500);
    expect(env.NOTIFICATION_SMTP_HOST).toBe("smtp.example.com");
    expect(env.NOTIFICATION_SMTP_PASSWORD).toBe("smtp-password");
    expect(env.NOTIFICATION_SMTP_PORT).toBe(465);
    expect(env.NOTIFICATION_SMTP_SECURE).toBe(true);
    expect(env.NOTIFICATION_SMTP_TIMEOUT_MS).toBe(5500);
    expect(env.NOTIFICATION_SMTP_USER).toBe("smtp-user");
    expect(env.NOTIFICATION_TEAMS_TIMEOUT_MS).toBe(7500);
    expect(env.VOICE_PROVIDER_DRIVER).toBe("openai-compatible");
    expect(env.VOICE_OPENAI_BASE_URL).toBe("https://voice.example.com/v1");
    expect(env.VOICE_OPENAI_MODEL).toBe("tts-model");
    expect(env.VOICE_OPENAI_VOICES).toBe("alloy=Alloy,echo=Echo");
    expect(env.VOICE_OPENAI_TIMEOUT_MS).toBe(12000);
    expect(env.BILLING_STRIPE_WEBHOOK_SECRET).toBe("whsec_test_secret");
    expect(env.BILLING_STRIPE_WEBHOOK_TOLERANCE_SECONDS).toBe(600);
    expect(env.BILLING_GENERIC_WEBHOOK_SECRET).toBe("generic_billing_secret");
    expect(env.BILLING_GENERIC_WEBHOOK_TOLERANCE_SECONDS).toBe(120);
    expect(env.BILLING_WEBHOOK_ORG_ID).toBe("org_billing");
    expect(env.LOCAL_AUTH_SECRET_ENCRYPTION_KEY).toBe(
      "local-auth-secret-key-32-bytes-min",
    );
    expect(env.MANAGED_SECRET_ENCRYPTION_KEY).toBe(
      "managed-secret-key-32-bytes-min",
    );
    expect(env.SESSION_SECRET_PREVIOUS).toBe(
      "previous-session-secret-32-bytes",
    );
    expect(env.REPOSITORY_DRIVER).toBe("postgres");
    expect(env.TENANCY_MODE).toBe("multi");
    expect(env.GA_CHECKLIST_PATH).toBe("/etc/romeo/ga-checklist.json");
    expect(env.GA_TARGET_PREFLIGHT_PATH).toBe(
      "/etc/romeo/ga-target-preflight.json",
    );
    expect(env.GA_TARGET_PLAN_PATH).toBe("/etc/romeo/ga-target-plan.json");
    expect(env.GA_TARGET_EXECUTION_PATH).toBe(
      "/etc/romeo/ga-target-execution.json",
    );
    expect(env.GA_EVIDENCE_BUNDLE_PATH).toBe(
      "/etc/romeo/ga-evidence-bundle.json",
    );
    expect(env.RELEASE_PUBLISH_PLAN_PATH).toBe("/etc/romeo/publish-plan.json");
    expect(env.RELEASE_AIRGAP_VERIFICATION_PATH).toBe(
      "/etc/romeo/airgap-bundle-verification.json",
    );
    expect(env.RELEASE_READBACK_PLAN_PATH).toBe(
      "/etc/romeo/release-readback-plan.json",
    );
    expect(env.RELEASE_READBACK_VALIDATION_PATH).toBe(
      "/etc/romeo/readback-validation.json",
    );
    expect(env.SUPPORT_BUNDLE_PATH).toBe("/etc/romeo/support-bundle.json");
    expect(env.CI_BRANCH_PROTECTION_PLAN_PATH).toBe(
      "/etc/romeo/branch-protection-plan.json",
    );
    expect(env.CI_HOSTED_RUN_VERIFICATION_PATH).toBe(
      "/etc/romeo/hosted-ci-run-verification.json",
    );
    expect(env.CI_BRANCH_PROTECTION_VERIFICATION_PATH).toBe(
      "/etc/romeo/branch-protection-verification.json",
    );
    expect(env.EDGE_ENFORCEMENT_EVIDENCE_PATH).toBe(
      "/etc/romeo/live-edge-enforcement.json",
    );
    expect(env.POSTGRES_QUERY_PLAN_EVIDENCE_PATH).toBe(
      "/etc/romeo/postgres-query-plan.json",
    );
    expect(env.POSTGRES_SLOW_QUERY_TELEMETRY_EVIDENCE_PATH).toBe(
      "/etc/romeo/postgres-slow-query.json",
    );
    expect(env.POSTGRES_LOCK_TELEMETRY_EVIDENCE_PATH).toBe(
      "/etc/romeo/postgres-locks.json",
    );
    expect(env.POSTGRES_ARCHIVAL_PARTITIONING_DECISION_PATH).toBe(
      "/etc/romeo/postgres-archival-decision.json",
    );
    expect(env.PGVECTOR_PHYSICAL_ISOLATION_EVIDENCE_PATH).toBe(
      "/etc/romeo/pgvector-isolation.json",
    );
    expect(env.QDRANT_LIVE_EVIDENCE_PATH).toBe(
      "/etc/romeo/qdrant-live-evidence.json",
    );
    expect(env.DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_EVIDENCE_PATH).toBe(
      "/etc/romeo/log-retention-evidence.json",
    );
    expect(env.DATA_RIGHTS_BACKUP_RETENTION_EVIDENCE_PATH).toBe(
      "/etc/romeo/backup-retention-evidence.json",
    );
    expect(env.DATA_CONNECTOR_LIVE_EVIDENCE_PATH).toBe(
      "/etc/romeo/data-connector-live-evidence.json",
    );
    expect(env.DATA_CONNECTOR_WORKER_ENABLED).toBe(true);
    expect(env.DATA_CONNECTOR_NETWORK_POLICY_ENABLED).toBe(true);
    expect(env.TOOL_DISPATCH_WORKER_ENABLED).toBe(true);
    expect(env.TOOL_DISPATCH_NETWORK_POLICY_ENABLED).toBe(true);
    expect(env.POSTGRES_POOL_MAX).toBe(7);
    expect(env.REQUEST_BODY_MAX_BYTES).toBe(75000000);
    expect(env.FILE_INLINE_MAX_BYTES).toBe(12000000);
    expect(env.FILE_DIRECT_UPLOAD_MAX_BYTES).toBe(250000000);
    expect(env.FILE_RESUMABLE_UPLOAD_MAX_BYTES).toBe(750000000);
    expect(env.MESSAGE_ATTACHMENT_MAX_BYTES).toBe(3000000);
    expect(env.HTTP_RATE_LIMIT_DRIVER).toBe("valkey");
    expect(env.HTTP_RATE_LIMIT_KEY_PREFIX).toBe("romeo:http:prod");
    expect(env.HTTP_RATE_LIMIT_WINDOW_SECONDS).toBe(120);
    expect(env.HTTP_RATE_LIMIT_AUTH_MAX).toBe(25);
    expect(env.HTTP_RATE_LIMIT_PUBLIC_MAX).toBe(250);
    expect(env.HTTP_RATE_LIMIT_AUTHENTICATED_MAX).toBe(5000);
    expect(env.HTTP_RATE_LIMIT_WEBHOOK_MAX).toBe(750);
    expect(env.MODEL_PROVIDER_STREAM_TIMEOUT_MS).toBe(45000);
    expect(env.MODEL_PROVIDER_RETRY_ATTEMPTS).toBe(2);
    expect(env.MODEL_PROVIDER_RETRY_BACKOFF_MS).toBe(500);
    expect(env.MODEL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD).toBe(3);
    expect(env.MODEL_PROVIDER_CIRCUIT_COOLDOWN_MS).toBe(120000);
    expect(env.MODEL_PROVIDER_DISABLED_IDS).toBe("provider_primary");
    expect(env.MODEL_PROVIDER_FALLBACK_MODEL_ID).toBe("model_fallback");
    expect(env.QUOTA_COORDINATION_DRIVER).toBe("valkey");
    expect(env.QUOTA_COORDINATION_KEY_PREFIX).toBe("romeo:quota:prod");
    expect(env.QUOTA_COORDINATION_TIMEOUT_MS).toBe(2500);
    expect(env.EDGE_TLS_TERMINATION).toBe("ingress");
    expect(env.EDGE_TRUSTED_PROXY_MODE).toBe("trusted_proxy");
    expect(env.EDGE_WAF_MODE).toBe("monitor");
    expect(env.EDGE_ALLOWED_ORIGINS).toBe(
      "https://app.example.com,https://admin.example.com",
    );
    expect(env.EDGE_HSTS_ENABLED).toBe(true);
    expect(env.EDGE_HSTS_MAX_AGE_SECONDS).toBe(31536000);
    expect(env.EDGE_HSTS_INCLUDE_SUBDOMAINS).toBe(true);
    expect(env.EDGE_HSTS_PRELOAD).toBe(true);
    expect(env.TOOL_DISPATCH_PAYLOAD_STORE_DRIVER).toBe("object-store");
    expect(env.TOOL_DISPATCH_PAYLOAD_STORE_PREFIX).toBe(
      "tenant-tool-payloads/v1",
    );
    expect(env.SCIM_ENABLED).toBe(true);
    expect(env.DEV_SEEDED_LOGIN).toBe(false);
  });

  it("requires a strong dispatch payload encryption key when object-store storage is enabled", () => {
    expect(() =>
      readEnv({
        TOOL_DISPATCH_PAYLOAD_STORE_DRIVER: "object-store",
        TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY: "short-key",
      }),
    ).toThrow(/TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY/);
  });

  it("allows provider resilience controls to be disabled explicitly", () => {
    const env = readEnv({
      MODEL_PROVIDER_RETRY_ATTEMPTS: "0",
      MODEL_PROVIDER_RETRY_BACKOFF_MS: "0",
      MODEL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD: "0",
      MODEL_PROVIDER_CIRCUIT_COOLDOWN_MS: "0",
    });

    expect(env.MODEL_PROVIDER_RETRY_ATTEMPTS).toBe(0);
    expect(env.MODEL_PROVIDER_RETRY_BACKOFF_MS).toBe(0);
    expect(env.MODEL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD).toBe(0);
    expect(env.MODEL_PROVIDER_CIRCUIT_COOLDOWN_MS).toBe(0);
  });

  it("keeps the OpenWebUI reference bridge disabled by default", () => {
    expect(readEnv().OPENWEBUI_COMPATIBILITY_ENABLED).toBe(false);
  });
});
