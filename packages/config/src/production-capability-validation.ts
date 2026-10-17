import { z } from "zod";

import {
  allowedHostMatches,
  isHttpsUrl,
  parseUrl,
  requireNonEmpty,
  requireNonPlaceholderCredential,
  requireStrongSecret,
  requireValue,
  type ProductionEnvironment,
} from "./production-validation-support";

export function validateProductionCapabilities(
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  validateIndependentSecrets(env, context);
  validateSecretResolver(env, context);
  validateVectorStore(env, context);
  validateVoiceProvider(env, context);
  validateBilling(env, context);
  validateNotifications(env, context);
}

function validateIndependentSecrets(
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  const active: Array<readonly [string, string]> = [
    ["SESSION_SECRET", env.SESSION_SECRET],
    ["LOCAL_AUTH_SECRET_ENCRYPTION_KEY", env.LOCAL_AUTH_SECRET_ENCRYPTION_KEY],
    ["MANAGED_SECRET_ENCRYPTION_KEY", env.MANAGED_SECRET_ENCRYPTION_KEY],
    ["WEBHOOK_SIGNING_KEY", env.WEBHOOK_SIGNING_KEY],
  ];
  if (env.TOOL_DISPATCH_PAYLOAD_STORE_DRIVER === "object-store")
    active.push([
      "TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY",
      env.TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY,
    ]);
  for (const [field, value] of active)
    requireStrongSecret(value, field, env, context);

  const previous: Array<readonly [string, string]> = [
    ["SESSION_SECRET_PREVIOUS", env.SESSION_SECRET_PREVIOUS],
    [
      "LOCAL_AUTH_SECRET_ENCRYPTION_KEY_PREVIOUS",
      env.LOCAL_AUTH_SECRET_ENCRYPTION_KEY_PREVIOUS,
    ],
    [
      "MANAGED_SECRET_ENCRYPTION_KEY_PREVIOUS",
      env.MANAGED_SECRET_ENCRYPTION_KEY_PREVIOUS,
    ],
    ["WEBHOOK_SIGNING_KEY_PREVIOUS", env.WEBHOOK_SIGNING_KEY_PREVIOUS],
  ];
  for (const [field, value] of previous) {
    if (value.length === 0) continue;
    requireStrongSecret(value, field, env, context);
    active.push([field, value]);
  }

  const values = new Map<string, string>();
  for (const [field, value] of active) {
    const duplicate = values.get(value);
    requireValue(
      duplicate === undefined,
      `${field} must be independent from every other production signing/encryption key.`,
      field,
      env,
      context,
    );
    if (duplicate === undefined) values.set(value, field);
  }
}

function validateSecretResolver(
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  const drivers =
    env.SECRET_RESOLVER_DRIVER === "cloud"
      ? ["aws-sm", "gcp-sm", "azure-kv"]
      : [env.SECRET_RESOLVER_DRIVER];
  for (const driver of drivers) {
    if (driver === "vault") {
      requireValue(
        isHttpsUrl(env.VAULT_ADDR),
        "VAULT_ADDR must use HTTPS when the Vault resolver is enabled.",
        "VAULT_ADDR",
        env,
        context,
      );
      requireNonPlaceholderCredential(
        env.VAULT_TOKEN,
        16,
        "VAULT_TOKEN",
        env,
        context,
      );
    } else if (driver === "aws-sm") {
      requireNonEmpty(env.AWS_REGION, "AWS_REGION", env, context);
      requireNonPlaceholderCredential(
        env.AWS_ACCESS_KEY_ID,
        8,
        "AWS_ACCESS_KEY_ID",
        env,
        context,
      );
      requireNonPlaceholderCredential(
        env.AWS_SECRET_ACCESS_KEY,
        16,
        "AWS_SECRET_ACCESS_KEY",
        env,
        context,
      );
    } else if (driver === "gcp-sm") {
      requireNonEmpty(
        env.GCP_SECRET_MANAGER_PROJECT,
        "GCP_SECRET_MANAGER_PROJECT",
        env,
        context,
      );
      requireNonPlaceholderCredential(
        env.GCP_ACCESS_TOKEN,
        16,
        "GCP_ACCESS_TOKEN",
        env,
        context,
      );
    } else if (driver === "azure-kv") {
      requireValue(
        isHttpsUrl(env.AZURE_KEY_VAULT_URL),
        "AZURE_KEY_VAULT_URL must use HTTPS when Azure Key Vault is enabled.",
        "AZURE_KEY_VAULT_URL",
        env,
        context,
      );
      requireNonPlaceholderCredential(
        env.AZURE_ACCESS_TOKEN,
        16,
        "AZURE_ACCESS_TOKEN",
        env,
        context,
      );
    }
  }
}

function validateVectorStore(
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  if (env.EXTERNAL_VECTOR_STORE_DRIVER !== "qdrant") return;
  requireValue(
    isHttpsUrl(env.QDRANT_URL),
    "QDRANT_URL must use HTTPS when the external Qdrant store is enabled.",
    "QDRANT_URL",
    env,
    context,
  );
  requireNonEmpty(env.QDRANT_API_KEY_REF, "QDRANT_API_KEY_REF", env, context);
  requireValue(
    env.VECTOR_NAMESPACE_POLICY !== "none",
    "VECTOR_NAMESPACE_POLICY must isolate external Qdrant data.",
    "VECTOR_NAMESPACE_POLICY",
    env,
    context,
  );
  requireValue(
    env.VECTOR_ISOLATION_MODE.startsWith("external_"),
    "VECTOR_ISOLATION_MODE must use an external isolation mode with Qdrant.",
    "VECTOR_ISOLATION_MODE",
    env,
    context,
  );
}

function validateVoiceProvider(
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  if (env.VOICE_PROVIDER_DRIVER !== "openai-compatible") return;
  requireValue(
    isHttpsUrl(env.VOICE_OPENAI_BASE_URL),
    "VOICE_OPENAI_BASE_URL must use HTTPS in production.",
    "VOICE_OPENAI_BASE_URL",
    env,
    context,
  );
  requireNonPlaceholderCredential(
    env.VOICE_OPENAI_API_KEY,
    16,
    "VOICE_OPENAI_API_KEY",
    env,
    context,
  );
}

function validateBilling(
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  if (!env.BILLING_ENABLED) return;
  requireNonPlaceholderCredential(
    env.BILLING_STRIPE_WEBHOOK_SECRET,
    16,
    "BILLING_STRIPE_WEBHOOK_SECRET",
    env,
    context,
  );
  requireNonPlaceholderCredential(
    env.BILLING_GENERIC_WEBHOOK_SECRET,
    16,
    "BILLING_GENERIC_WEBHOOK_SECRET",
    env,
    context,
  );
  requireValue(
    env.BILLING_STRIPE_WEBHOOK_SECRET !== env.BILLING_GENERIC_WEBHOOK_SECRET,
    "Billing webhook secrets must be independent.",
    "BILLING_GENERIC_WEBHOOK_SECRET",
    env,
    context,
  );
}

function validateNotifications(
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  const driver = env.NOTIFICATION_DELIVERY_DRIVER;
  const webhookEnabled = [
    "configured",
    "pagerduty-events",
    "slack-webhook",
    "teams-webhook",
    "webhook",
  ].includes(driver);
  if (webhookEnabled) {
    requireValue(
      env.NOTIFICATION_WEBHOOK_EGRESS_POLICY === "require_allowlist",
      "NOTIFICATION_WEBHOOK_EGRESS_POLICY must be require_allowlist for webhook-capable notification delivery.",
      "NOTIFICATION_WEBHOOK_EGRESS_POLICY",
      env,
      context,
    );
    requireValue(
      env.NOTIFICATION_WEBHOOK_ALLOWED_HOSTS.length > 0,
      "NOTIFICATION_WEBHOOK_ALLOWED_HOSTS must be nonempty for webhook-capable notification delivery.",
      "NOTIFICATION_WEBHOOK_ALLOWED_HOSTS",
      env,
      context,
    );
  }
  if (driver === "configured" || driver === "fcm-mobile-push") {
    requireNonEmpty(
      env.NOTIFICATION_FCM_PROJECT_ID,
      "NOTIFICATION_FCM_PROJECT_ID",
      env,
      context,
    );
    requireNonEmpty(
      env.NOTIFICATION_FCM_SERVICE_ACCOUNT_REF,
      "NOTIFICATION_FCM_SERVICE_ACCOUNT_REF",
      env,
      context,
    );
  }
  const emailDriver =
    driver === "configured" ? env.NOTIFICATION_EMAIL_DELIVERY_DRIVER : driver;
  if (emailDriver === "resend" || emailDriver === "resend-email") {
    requireNonEmpty(
      env.NOTIFICATION_EMAIL_FROM,
      "NOTIFICATION_EMAIL_FROM",
      env,
      context,
    );
    requireNonPlaceholderCredential(
      env.NOTIFICATION_RESEND_API_KEY,
      16,
      "NOTIFICATION_RESEND_API_KEY",
      env,
      context,
    );
  } else if (emailDriver === "smtp" || emailDriver === "smtp-email") {
    for (const [field, value] of [
      ["NOTIFICATION_EMAIL_FROM", env.NOTIFICATION_EMAIL_FROM],
      ["NOTIFICATION_SMTP_HOST", env.NOTIFICATION_SMTP_HOST],
      ["NOTIFICATION_SMTP_USER", env.NOTIFICATION_SMTP_USER],
    ] as const)
      requireNonEmpty(value, field, env, context);
    requireNonPlaceholderCredential(
      env.NOTIFICATION_SMTP_PASSWORD,
      16,
      "NOTIFICATION_SMTP_PASSWORD",
      env,
      context,
    );
  }
  if (driver === "pagerduty-events" || driver === "configured") {
    const pagerDutyHost = parseUrl(env.NOTIFICATION_PAGERDUTY_EVENTS_URL, [
      "https:",
    ])?.hostname;
    requireValue(
      pagerDutyHost !== undefined &&
        allowedHostMatches(
          env.NOTIFICATION_WEBHOOK_ALLOWED_HOSTS,
          pagerDutyHost,
        ),
      "NOTIFICATION_WEBHOOK_ALLOWED_HOSTS must include the configured PagerDuty events host.",
      "NOTIFICATION_WEBHOOK_ALLOWED_HOSTS",
      env,
      context,
    );
  }
}
