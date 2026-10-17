import { describe, expect, it } from "vitest";

import { readEnv } from "./index";

function hardenedProductionEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    ROMEO_ENV: "production",
    APP_ORIGIN: "https://romeo.prod.invalid",
    REPOSITORY_DRIVER: "postgres",
    DATABASE_URL:
      "postgres://romeo:database-credential@db.prod.invalid/romeo?sslmode=verify-full",
    OBJECT_STORE_DRIVER: "s3",
    S3_ENDPOINT: "https://objects.prod.invalid",
    S3_ACCESS_KEY_ID: "prod-object-access-id",
    S3_SECRET_ACCESS_KEY: "S3-prod-credential-4hQ8wZ2m",
    HTTP_RATE_LIMIT_DRIVER: "valkey",
    REALTIME_EVENT_DRIVER: "valkey",
    QUOTA_COORDINATION_DRIVER: "valkey",
    VALKEY_URL:
      "rediss://romeo-app:vK-4hQ8wZ2mN7cR5tY9p@cache.prod.invalid:6379/0",
    EDGE_TRUSTED_PROXY_MODE: "trusted_proxy",
    EDGE_TRUSTED_PROXY_CIDRS: "10.42.0.0/16,2001:db8:42::/48",
    FILE_MALWARE_SCAN_ENABLED: "true",
    FILE_MALWARE_SCAN_POLICY: "required",
    CLAMAV_ADDRESS: "tcp://clamav.security.svc:3310",
    BILLING_ENABLED: "false",
    DEV_SEEDED_LOGIN: "false",
    SESSION_SECRET: "Sess!on-7mQ2vK9xR4tY8pW3cN6bL1dF",
    LOCAL_AUTH_SECRET_ENCRYPTION_KEY: "Loc4l-Auth!8pW3cN6bL1dF7mQ2vK9xR5tY",
    MANAGED_SECRET_ENCRYPTION_KEY: "Man4ged!2vK9xR5tY8pW3cN6bL1dF7mQ",
    WEBHOOK_SIGNING_KEY: "Webh00k!5tY8pW3cN6bL1dF7mQ2vK9xR",
    ...overrides,
  };
}

function exceptionExpiry(days = 30): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function reviewedException(prefix: string): Record<string, string> {
  return {
    [`${prefix}_ENABLED`]: "true",
    [`${prefix}_OWNER`]: "platform-security",
    [`${prefix}_REASON`]: "Reviewed temporary in-cluster deployment exception.",
    [`${prefix}_EXPIRES_AT`]: exceptionExpiry(),
  };
}

describe("Romeo config", () => {
  it("strictly parses the bounded platform capability kill-switch list", () => {
    const allHighRiskCapabilities = [
      "realtime_voice",
      "external_provider_use",
      "secure_compute",
      "image_generation",
      "image_editing",
      "multi_model_compare",
      "streamed_output_policy",
    ];
    expect(
      readEnv({
        CAPABILITY_PLATFORM_DISABLED_IDS: allHighRiskCapabilities.join(","),
      }).CAPABILITY_PLATFORM_DISABLED_IDS,
    ).toEqual(allHighRiskCapabilities);
    expect(readEnv({}).CAPABILITY_PLATFORM_DISABLED_IDS).toEqual(
      allHighRiskCapabilities.filter((id) => id !== "image_generation"),
    );
    expect(
      readEnv({ CAPABILITY_PLATFORM_DISABLED_IDS: "" })
        .CAPABILITY_PLATFORM_DISABLED_IDS,
    ).toEqual([]);
    expect(() =>
      readEnv({ CAPABILITY_PLATFORM_DISABLED_IDS: "image_generation, typo" }),
    ).toThrow(/without empty entries or whitespace/);
    expect(() =>
      readEnv({ CAPABILITY_PLATFORM_DISABLED_IDS: "unknown_capability" }),
    ).toThrow(/unsupported capability IDs/);
    expect(() =>
      readEnv({
        CAPABILITY_PLATFORM_DISABLED_IDS: "image_generation,image_generation",
      }),
    ).toThrow(/duplicate capability IDs/);
  });

  it("keeps OCR opt-in when no deployment override is provided", () => {
    expect(readEnv({}).FILE_OCR_DRIVER).toBe("disabled");
  });

  it("fails closed when production uses development infrastructure or secrets", () => {
    expect(() => readEnv({ ROMEO_ENV: "production" })).toThrow(/APP_ORIGIN/);
    expect(() =>
      readEnv(hardenedProductionEnv({ SESSION_SECRET: "dev-shared-key" })),
    ).toThrow(/SESSION_SECRET/);
  });

  it("accepts an explicitly hardened production environment", () => {
    const env = readEnv(
      hardenedProductionEnv({ EDGE_TRUSTED_PROXY_HOPS: "2" }),
    );

    expect(env.ROMEO_ENV).toBe("production");
    expect(env.EDGE_TRUSTED_PROXY_HOPS).toBe(2);
  });

  it("requires bounded evidence for external scheduled-work ownership", () => {
    expect(() =>
      readEnv(
        hardenedProductionEnv({ SCHEDULED_TENANT_WORK_OWNER: "external" }),
      ),
    ).toThrow(/SCHEDULED_TENANT_WORK_EXTERNAL_EVIDENCE_PATH/);
    const env = readEnv(
      hardenedProductionEnv({
        SCHEDULED_TENANT_WORK_OWNER: "external",
        SCHEDULED_TENANT_WORK_EXTERNAL_EVIDENCE_PATH:
          "/var/run/romeo/external-scheduler-evidence.json",
        SCHEDULED_TENANT_WORK_EXTERNAL_EVIDENCE_MAX_AGE_SECONDS: "600",
      }),
    );
    expect(env.SCHEDULED_TENANT_WORK_EXTERNAL_EVIDENCE_MAX_AGE_SECONDS).toBe(
      600,
    );
    expect(() =>
      readEnv({
        SCHEDULED_TENANT_WORK_EXTERNAL_EVIDENCE_MAX_AGE_SECONDS: "59",
      }),
    ).toThrow(/SCHEDULED_TENANT_WORK_EXTERNAL_EVIDENCE_MAX_AGE_SECONDS/);
  });

  it("requires independent rotatable broker credentials for external workers", () => {
    const external = {
      SCHEDULED_TENANT_WORK_OWNER: "external",
      SCHEDULED_TENANT_WORK_EXTERNAL_EVIDENCE_PATH:
        "/var/run/romeo/external-scheduler-evidence.json",
      TOOL_DISPATCH_WORKER_ENABLED: "true",
      BROWSER_AUTOMATION_WORKER_ENABLED: "true",
      KNOWLEDGE_EXTRACTION_WORKER_ENABLED: "true",
    };
    expect(() => readEnv(hardenedProductionEnv(external))).toThrow(
      /TOOL_DISPATCH_BROKER_TOKEN/,
    );
    const credentials = {
      TOOL_DISPATCH_BROKER_TOKEN: "Tool-Dispatch!4hQ8wZ2mN7cR5tY9pL6dF3kS",
      TOOL_DISPATCH_BROKER_TOKEN_PREVIOUS:
        "Tool-Previous!7mQ2vK9xR4tY8pW3cN6bL1dF",
      BROWSER_AUTOMATION_BROKER_TOKEN:
        "Browser-Current!8pW3cN6bL1dF7mQ2vK9xR5tY",
      BROWSER_AUTOMATION_BROKER_TOKEN_PREVIOUS:
        "Browser-Previous!2vK9xR5tY8pW3cN6bL1dF7mQ",
      KNOWLEDGE_EXTRACTION_BROKER_TOKEN:
        "Knowledge-Current!5tY8pW3cN6bL1dF7mQ2vK9xR",
      KNOWLEDGE_EXTRACTION_BROKER_TOKEN_PREVIOUS:
        "Knowledge-Previous!3cN6bL1dF7mQ2vK9xR5tY8pW",
    };
    const env = readEnv(hardenedProductionEnv({ ...external, ...credentials }));
    expect(env.KNOWLEDGE_EXTRACTION_BROKER_TOKEN).toBe(
      credentials.KNOWLEDGE_EXTRACTION_BROKER_TOKEN,
    );
    expect(() =>
      readEnv(
        hardenedProductionEnv({
          ...external,
          ...credentials,
          BROWSER_AUTOMATION_BROKER_TOKEN:
            credentials.TOOL_DISPATCH_BROKER_TOKEN,
        }),
      ),
    ).toThrow(/independent from every other worker broker credential/);
    expect(() =>
      readEnv(
        hardenedProductionEnv({
          ...external,
          ...credentials,
          TOOL_DISPATCH_BROKER_TOKEN_PREVIOUS:
            credentials.TOOL_DISPATCH_BROKER_TOKEN,
        }),
      ),
    ).toThrow(/must be independent/);
  });

  it("requires normalized trusted-proxy source networks in production", () => {
    for (const value of [
      "",
      "10.42.0.0",
      "10.42.0.0/33",
      "2001:db8::/129",
      "10.42.0.0/16, 2001:db8::/48",
      "10.42.0.0/16,10.42.0.0/16",
    ]) {
      expect(() =>
        readEnv(hardenedProductionEnv({ EDGE_TRUSTED_PROXY_CIDRS: value })),
      ).toThrow(/EDGE_TRUSTED_PROXY_CIDRS/);
    }
    expect(
      readEnv(
        hardenedProductionEnv({
          EDGE_TRUSTED_PROXY_CIDRS: "10.42.0.0/16,2001:db8:42::/48",
        }),
      ).EDGE_TRUSTED_PROXY_CIDRS,
    ).toBe("10.42.0.0/16,2001:db8:42::/48");
  });

  it("requires live S3 encryption, versioning, and lifecycle posture in production", () => {
    for (const field of [
      "S3_READINESS_REQUIRE_ENCRYPTION",
      "S3_READINESS_REQUIRE_VERSIONING",
      "S3_READINESS_REQUIRE_LIFECYCLE",
    ]) {
      expect(() =>
        readEnv(hardenedProductionEnv({ [field]: "false" })),
      ).toThrow(field);
    }
    expect(
      readEnv(
        hardenedProductionEnv({ S3_READINESS_REQUIRE_REPLICATION: "true" }),
      ).S3_READINESS_REQUIRE_REPLICATION,
    ).toBe(true);
  });

  it("accepts narrowly scoped active exceptions for in-cluster TLS and malware scanning", () => {
    const env = readEnv(
      hardenedProductionEnv({
        DATABASE_URL: "postgres://romeo:db-credential@postgres/romeo",
        ...reviewedException("POSTGRES_TLS_EXCEPTION"),
        POSTGRES_TLS_EXCEPTION_SCOPE: "in_cluster",
        VALKEY_URL: "redis://romeo-app:vK-4hQ8wZ2mN7cR5tY9p@valkey:6379/0",
        ...reviewedException("VALKEY_SECURITY_EXCEPTION"),
        VALKEY_SECURITY_EXCEPTION_SCOPE: "in_cluster",
        VALKEY_IN_CLUSTER_NETWORK_POLICY_ENABLED: "true",
        FILE_MALWARE_SCAN_ENABLED: "false",
        FILE_MALWARE_SCAN_POLICY: "off",
        CLAMAV_ADDRESS: "",
        ...reviewedException("FILE_MALWARE_SCAN_EXCEPTION"),
      }),
    );

    expect(env.POSTGRES_TLS_EXCEPTION_SCOPE).toBe("in_cluster");
    expect(env.VALKEY_IN_CLUSTER_NETWORK_POLICY_ENABLED).toBe(true);
    expect(env.FILE_MALWARE_SCAN_EXCEPTION_ENABLED).toBe(true);
  });

  it("accepts a credential-complete production capability profile", () => {
    const env = readEnv(
      hardenedProductionEnv({
        BILLING_ENABLED: "true",
        BILLING_STRIPE_WEBHOOK_SECRET: "whsec_prod_4hQ8wZ2mN7cR5tY9p",
        BILLING_GENERIC_WEBHOOK_SECRET: "generic_prod_9pT3dF6kL2sV8xC4m",
        EXTERNAL_VECTOR_STORE_DRIVER: "qdrant",
        QDRANT_URL: "https://vectors.prod.invalid",
        QDRANT_API_KEY_REF: "romeo-secret://qdrant/api-key",
        VECTOR_NAMESPACE_POLICY: "org",
        VECTOR_ISOLATION_MODE: "external_namespace_per_org",
        SECRET_RESOLVER_DRIVER: "vault",
        VAULT_ADDR: "https://vault.prod.invalid",
        VAULT_TOKEN: "vault-prod-4hQ8wZ2mN7cR5tY9p",
        TOOL_DISPATCH_PAYLOAD_STORE_DRIVER: "object-store",
        TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY:
          "T00l-Payload!6bL1dF7mQ2vK9xR5tY8pW3cN",
        VOICE_PROVIDER_DRIVER: "openai-compatible",
        VOICE_OPENAI_BASE_URL: "https://voice.prod.invalid/v1",
        VOICE_OPENAI_API_KEY: "voice-prod-7mQ2vK9xR4tY8pW3c",
        NOTIFICATION_DELIVERY_DRIVER: "configured",
        NOTIFICATION_EMAIL_DELIVERY_DRIVER: "resend",
        NOTIFICATION_EMAIL_FROM: "notify@prod.invalid",
        NOTIFICATION_RESEND_API_KEY: "resend-prod-8pW3cN6bL1dF7mQ2",
        NOTIFICATION_FCM_PROJECT_ID: "romeo-prod",
        NOTIFICATION_FCM_SERVICE_ACCOUNT_REF:
          "romeo-secret://notifications/fcm-service-account",
        NOTIFICATION_WEBHOOK_EGRESS_POLICY: "require_allowlist",
        NOTIFICATION_WEBHOOK_ALLOWED_HOSTS:
          "events.pagerduty.com,hooks.slack.com,*.webhook.office.com,hooks.prod.invalid",
      }),
    );

    expect(env.SECRET_RESOLVER_DRIVER).toBe("vault");
    expect(env.EXTERNAL_VECTOR_STORE_DRIVER).toBe("qdrant");
    expect(env.NOTIFICATION_DELIVERY_DRIVER).toBe("configured");
  });

  it.each([
    ["REPOSITORY_DRIVER", "memory", /REPOSITORY_DRIVER/],
    ["OBJECT_STORE_DRIVER", "memory", /OBJECT_STORE_DRIVER/],
    ["HTTP_RATE_LIMIT_DRIVER", "memory", /HTTP_RATE_LIMIT_DRIVER/],
    ["REALTIME_EVENT_DRIVER", "memory", /REALTIME_EVENT_DRIVER/],
    ["QUOTA_COORDINATION_DRIVER", "disabled", /QUOTA_COORDINATION_DRIVER/],
  ])("rejects unsafe production driver %s=%s", (field, value, message) => {
    expect(() => readEnv(hardenedProductionEnv({ [field]: value }))).toThrow(
      message,
    );
  });

  it.each([
    ["SESSION_SECRET"],
    ["LOCAL_AUTH_SECRET_ENCRYPTION_KEY"],
    ["MANAGED_SECRET_ENCRYPTION_KEY"],
    ["WEBHOOK_SIGNING_KEY"],
  ])("rejects placeholder or low-entropy production key %s", (field) => {
    expect(() =>
      readEnv(hardenedProductionEnv({ [field]: "a".repeat(40) })),
    ).toThrow(new RegExp(field));
  });

  it("rejects key reuse across production signing and encryption purposes", () => {
    const shared = "Shared!7mQ2vK9xR4tY8pW3cN6bL1dF";
    expect(() =>
      readEnv(
        hardenedProductionEnv({
          SESSION_SECRET: shared,
          WEBHOOK_SIGNING_KEY: shared,
        }),
      ),
    ).toThrow(/WEBHOOK_SIGNING_KEY.*independent/);
  });

  it.each([
    ["postgres://romeo:cred@db.prod.invalid/romeo", /sslmode=verify-full/],
    [
      "postgres://romeo:cred@db.prod.invalid/romeo?sslmode=require",
      /sslmode=verify-full/,
    ],
    [
      "postgres://romeo:cred@db.prod.invalid/romeo?sslmode=verify-ca",
      /sslmode=verify-full/,
    ],
  ])("rejects unverifiable production Postgres URL %s", (url, message) => {
    expect(() => readEnv(hardenedProductionEnv({ DATABASE_URL: url }))).toThrow(
      message,
    );
  });

  it("rejects remote, expired, overlong, and incomplete Postgres TLS exceptions", () => {
    const base = {
      DATABASE_URL: "postgres://romeo:cred@postgres/romeo",
      ...reviewedException("POSTGRES_TLS_EXCEPTION"),
      POSTGRES_TLS_EXCEPTION_SCOPE: "in_cluster",
    };
    for (const override of [
      { POSTGRES_TLS_EXCEPTION_OWNER: "" },
      { POSTGRES_TLS_EXCEPTION_REASON: "short" },
      { POSTGRES_TLS_EXCEPTION_EXPIRES_AT: "2020-01-01T00:00:00.000Z" },
      { POSTGRES_TLS_EXCEPTION_EXPIRES_AT: exceptionExpiry(91) },
      { POSTGRES_TLS_EXCEPTION_SCOPE: "" },
      { DATABASE_URL: "postgres://romeo:cred@db.prod.invalid/romeo" },
    ]) {
      expect(() =>
        readEnv(hardenedProductionEnv({ ...base, ...override })),
      ).toThrow(/POSTGRES_TLS_EXCEPTION|sslmode=verify-full/);
    }
  });

  it.each([
    ["redis://romeo-app:abcdefghijklmnop@cache.prod.invalid:6379", /rediss/],
    ["rediss://cache.prod.invalid:6379", /ACL/],
    ["rediss://:abcdefghijklmnop@cache.prod.invalid:6379", /ACL/],
    ["rediss://romeo-app:short@cache.prod.invalid:6379", /ACL/],
    ["rediss://romeo-app:%61%62%63%64%65%66@cache.prod.invalid:6379", /ACL/],
  ])("rejects unsafe production Valkey URL %s", (url, message) => {
    expect(() => readEnv(hardenedProductionEnv({ VALKEY_URL: url }))).toThrow(
      message,
    );
  });

  it("rejects exceptions when the corresponding production control is hardened", () => {
    for (const prefix of [
      "POSTGRES_TLS_EXCEPTION",
      "VALKEY_SECURITY_EXCEPTION",
      "FILE_MALWARE_SCAN_EXCEPTION",
    ]) {
      expect(() =>
        readEnv(
          hardenedProductionEnv({
            ...reviewedException(prefix),
            ...(prefix === "POSTGRES_TLS_EXCEPTION"
              ? { POSTGRES_TLS_EXCEPTION_SCOPE: "in_cluster" }
              : {}),
            ...(prefix === "VALKEY_SECURITY_EXCEPTION"
              ? {
                  VALKEY_SECURITY_EXCEPTION_SCOPE: "in_cluster",
                  VALKEY_IN_CLUSTER_NETWORK_POLICY_ENABLED: "true",
                }
              : {}),
          }),
        ),
      ).toThrow(new RegExp(`${prefix}_ENABLED`));
    }
  });

  it("rejects plaintext Valkey exceptions without scope, NetworkPolicy, or valid approval", () => {
    const base = {
      VALKEY_URL: "redis://romeo-app:abcdefghijklmnop@valkey:6379",
      ...reviewedException("VALKEY_SECURITY_EXCEPTION"),
      VALKEY_SECURITY_EXCEPTION_SCOPE: "in_cluster",
      VALKEY_IN_CLUSTER_NETWORK_POLICY_ENABLED: "true",
    };
    for (const override of [
      { VALKEY_SECURITY_EXCEPTION_SCOPE: "" },
      { VALKEY_IN_CLUSTER_NETWORK_POLICY_ENABLED: "false" },
      { VALKEY_SECURITY_EXCEPTION_EXPIRES_AT: "2020-01-01T00:00:00.000Z" },
      { VALKEY_SECURITY_EXCEPTION_OWNER: "" },
      { VALKEY_URL: "redis://romeo-app:abcdefghijklmnop@cache.prod.invalid" },
    ]) {
      expect(() =>
        readEnv(hardenedProductionEnv({ ...base, ...override })),
      ).toThrow(/VALKEY_SECURITY_EXCEPTION|rediss/);
    }
  });

  it("requires ClamAV or a complete, active malware-scanning exception", () => {
    expect(() =>
      readEnv(
        hardenedProductionEnv({
          FILE_MALWARE_SCAN_ENABLED: "true",
          FILE_MALWARE_SCAN_POLICY: "required",
          CLAMAV_ADDRESS: "",
        }),
      ),
    ).toThrow(/CLAMAV_ADDRESS/);
    for (const override of [
      {},
      {
        ...reviewedException("FILE_MALWARE_SCAN_EXCEPTION"),
        FILE_MALWARE_SCAN_EXCEPTION_OWNER: "",
      },
      {
        ...reviewedException("FILE_MALWARE_SCAN_EXCEPTION"),
        FILE_MALWARE_SCAN_EXCEPTION_EXPIRES_AT: "2020-01-01T00:00:00.000Z",
      },
    ]) {
      expect(() =>
        readEnv(
          hardenedProductionEnv({
            FILE_MALWARE_SCAN_ENABLED: "false",
            FILE_MALWARE_SCAN_POLICY: "off",
            CLAMAV_ADDRESS: "",
            ...override,
          }),
        ),
      ).toThrow(/FILE_MALWARE_SCAN_EXCEPTION|malware scanning/);
    }
  });

  it("requires provider-specific credentials for enabled production capabilities", () => {
    for (const [override, message] of [
      [{ VOICE_PROVIDER_DRIVER: "openai-compatible" }, /VOICE_OPENAI_API_KEY/],
      [{ SECRET_RESOLVER_DRIVER: "vault" }, /VAULT_ADDR/],
      [{ SECRET_RESOLVER_DRIVER: "aws-sm" }, /AWS_REGION/],
      [{ SECRET_RESOLVER_DRIVER: "gcp-sm" }, /GCP_SECRET_MANAGER_PROJECT/],
      [{ SECRET_RESOLVER_DRIVER: "azure-kv" }, /AZURE_KEY_VAULT_URL/],
      [{ EXTERNAL_VECTOR_STORE_DRIVER: "qdrant" }, /QDRANT_URL/],
      [{ BILLING_ENABLED: "true" }, /BILLING_STRIPE_WEBHOOK_SECRET/],
      [
        { NOTIFICATION_DELIVERY_DRIVER: "resend-email" },
        /NOTIFICATION_EMAIL_FROM/,
      ],
      [
        { NOTIFICATION_DELIVERY_DRIVER: "fcm-mobile-push" },
        /NOTIFICATION_FCM_PROJECT_ID/,
      ],
    ] as const) {
      expect(() => readEnv(hardenedProductionEnv(override))).toThrow(message);
    }
  });

  it("requires normalized notification webhook egress allowlists", () => {
    expect(() =>
      readEnv(
        hardenedProductionEnv({ NOTIFICATION_DELIVERY_DRIVER: "webhook" }),
      ),
    ).toThrow(/NOTIFICATION_WEBHOOK_EGRESS_POLICY/);
    expect(() =>
      readEnv(
        hardenedProductionEnv({
          NOTIFICATION_DELIVERY_DRIVER: "webhook",
          NOTIFICATION_WEBHOOK_EGRESS_POLICY: "require_allowlist",
          NOTIFICATION_WEBHOOK_ALLOWED_HOSTS: "Hooks.Prod.Invalid",
        }),
      ),
    ).toThrow(/unique, lowercase/);
    expect(
      readEnv(
        hardenedProductionEnv({
          NOTIFICATION_DELIVERY_DRIVER: "webhook",
          NOTIFICATION_WEBHOOK_EGRESS_POLICY: "require_allowlist",
          NOTIFICATION_WEBHOOK_ALLOWED_HOSTS:
            "hooks.prod.invalid,*.notifications.prod.invalid",
        }),
      ).NOTIFICATION_WEBHOOK_ALLOWED_HOSTS,
    ).toBe("hooks.prod.invalid,*.notifications.prod.invalid");
  });

  it("parses OIDC mapping configuration with safe empty defaults", () => {
    const env = readEnv({
      OIDC_ISSUER_URL: "https://keycloak.example.com/realms/romeo",
      OIDC_CLIENT_ID: "romeo",
      OIDC_ENDPOINT_ALLOWED_ORIGINS:
        "https://keys.example.com,https://login.example.net:8443",
      OIDC_FETCH_MAX_BYTES: "131072",
      OIDC_FETCH_TIMEOUT_MS: "5000",
      OIDC_CACHE_TTL_MS: "600000",
      OIDC_GROUP_CLAIM: "groups",
      OIDC_ADMIN_GROUPS: "/romeo/admins,romeo-admin",
      OIDC_GROUP_MAP: "/romeo/users=group_users",
      OIDC_WORKSPACE_GROUP_MAP: "/romeo/finance=workspace_finance",
      OIDC_WORKSPACE_GROUP_PREFIX: "workspace:",
      OPENWEBUI_COMPATIBILITY_ENABLED: "true",
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
      NOTIFICATION_FCM_PROJECT_ID: "romeo-prod",
      NOTIFICATION_FCM_SERVICE_ACCOUNT_REF: "vault://romeo/fcm",
      NOTIFICATION_FCM_TIMEOUT_MS: "8500",
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
      WEB_SEARCH_TIMEOUT_MS: "45000",
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
      MODEL_CATALOG_SYNC_ENABLED: "false",
      MODEL_CATALOG_SYNC_INTERVAL_MS: "70000",
      MODEL_CATALOG_SYNC_TTL_MS: "360000",
      MODEL_CATALOG_SYNC_TIMEOUT_MS: "12000",
      RUN_EXECUTION_LEASE_SECONDS: "45",
      RUN_RECOVERY_STALE_MS: "90000",
      MODEL_PROVIDER_RETRY_ATTEMPTS: "2",
      MODEL_PROVIDER_RETRY_BACKOFF_MS: "500",
      MODEL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD: "3",
      MODEL_PROVIDER_CIRCUIT_COOLDOWN_MS: "120000",
      MODEL_PROVIDER_DISABLED_IDS: "provider_primary",
      MODEL_PROVIDER_FALLBACK_MODEL_ID: "model_fallback",
      REALTIME_EVENT_DRIVER: "valkey",
      REALTIME_EVENT_KEY_PREFIX: "romeo:chat-events:prod",
      REALTIME_EVENT_TIMEOUT_MS: "2250",
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
    expect(env.OIDC_ENDPOINT_ALLOWED_ORIGINS).toBe(
      "https://keys.example.com,https://login.example.net:8443",
    );
    expect(env.OIDC_FETCH_MAX_BYTES).toBe(131_072);
    expect(env.OIDC_FETCH_TIMEOUT_MS).toBe(5_000);
    expect(env.OIDC_CACHE_TTL_MS).toBe(600_000);
    expect(env.OIDC_GROUP_CLAIM).toBe("groups");
    expect(env.OIDC_ADMIN_GROUPS).toContain("/romeo/admins");
    expect(env.OIDC_GROUP_MAP).toBe("/romeo/users=group_users");
    expect(env.OIDC_WORKSPACE_GROUP_PREFIX).toBe("workspace:");
    expect(env.WEB_SEARCH_TIMEOUT_MS).toBe(45_000);
    expect(env.OPENWEBUI_COMPATIBILITY_ENABLED).toBe(true);
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
    expect(env.NOTIFICATION_FCM_PROJECT_ID).toBe("romeo-prod");
    expect(env.NOTIFICATION_FCM_SERVICE_ACCOUNT_REF).toBe("vault://romeo/fcm");
    expect(env.NOTIFICATION_FCM_TIMEOUT_MS).toBe(8500);
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
    expect(env.MODEL_CATALOG_SYNC_ENABLED).toBe(false);
    expect(env.MODEL_CATALOG_SYNC_INTERVAL_MS).toBe(70000);
    expect(env.MODEL_CATALOG_SYNC_TTL_MS).toBe(360000);
    expect(env.MODEL_CATALOG_SYNC_TIMEOUT_MS).toBe(12000);
    expect(env.RUN_EXECUTION_LEASE_SECONDS).toBe(45);
    expect(env.RUN_RECOVERY_STALE_MS).toBe(90000);
    expect(env.MODEL_PROVIDER_RETRY_ATTEMPTS).toBe(2);
    expect(env.MODEL_PROVIDER_RETRY_BACKOFF_MS).toBe(500);
    expect(env.MODEL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD).toBe(3);
    expect(env.MODEL_PROVIDER_CIRCUIT_COOLDOWN_MS).toBe(120000);
    expect(env.MODEL_PROVIDER_DISABLED_IDS).toBe("provider_primary");
    expect(env.MODEL_PROVIDER_FALLBACK_MODEL_ID).toBe("model_fallback");
    expect(env.REALTIME_EVENT_DRIVER).toBe("valkey");
    expect(env.REALTIME_EVENT_KEY_PREFIX).toBe("romeo:chat-events:prod");
    expect(env.REALTIME_EVENT_TIMEOUT_MS).toBe(2250);
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

  it("rejects unsafe OIDC endpoint allowlists and unbounded fetch policy", () => {
    for (const value of [
      "http://keys.example.com",
      "https://user:secret@keys.example.com",
      "https://keys.example.com/path",
      "https://keys.example.com, https://login.example.com",
    ]) {
      expect(() => readEnv({ OIDC_ENDPOINT_ALLOWED_ORIGINS: value })).toThrow(
        /exact HTTPS origins/,
      );
    }
    expect(() => readEnv({ OIDC_FETCH_MAX_BYTES: "1048577" })).toThrow(
      "OIDC_FETCH_MAX_BYTES",
    );
    expect(() => readEnv({ OIDC_FETCH_TIMEOUT_MS: "30001" })).toThrow(
      "OIDC_FETCH_TIMEOUT_MS",
    );
    expect(() => readEnv({ OIDC_CACHE_TTL_MS: "3600001" })).toThrow(
      "OIDC_CACHE_TTL_MS",
    );
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
