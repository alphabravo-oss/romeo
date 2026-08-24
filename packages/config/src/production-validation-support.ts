import { z } from "zod";

export interface ReviewedException {
  enabled: boolean;
  expiresAt: string;
  owner: string;
  reason: string;
}

export interface ProductionEnvironment {
  APP_ORIGIN: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_REGION: string;
  AWS_SECRET_ACCESS_KEY: string;
  AZURE_ACCESS_TOKEN: string;
  AZURE_KEY_VAULT_URL: string;
  BILLING_ENABLED: boolean;
  BILLING_GENERIC_WEBHOOK_SECRET: string;
  BILLING_STRIPE_WEBHOOK_SECRET: string;
  BROWSER_AUTOMATION_BROKER_TOKEN: string;
  BROWSER_AUTOMATION_BROKER_TOKEN_PREVIOUS: string;
  BROWSER_AUTOMATION_WORKER_ENABLED: boolean;
  CLAMAV_ADDRESS: string;
  DATABASE_URL: string;
  DELEGATED_OAUTH_GITHUB_CLIENT_ID: string;
  DELEGATED_OAUTH_GITHUB_CLIENT_SECRET: string;
  DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY: string;
  DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY_PREVIOUS: string;
  DEV_SEEDED_LOGIN: boolean;
  EDGE_TRUSTED_PROXY_CIDRS: string;
  EDGE_TRUSTED_PROXY_MODE: string;
  EXTERNAL_VECTOR_STORE_DRIVER: string;
  FILE_MALWARE_SCAN_ENABLED: boolean;
  FILE_MALWARE_SCAN_EXCEPTION_ENABLED: boolean;
  FILE_MALWARE_SCAN_EXCEPTION_EXPIRES_AT: string;
  FILE_MALWARE_SCAN_EXCEPTION_OWNER: string;
  FILE_MALWARE_SCAN_EXCEPTION_REASON: string;
  FILE_MALWARE_SCAN_POLICY: string;
  GCP_ACCESS_TOKEN: string;
  GCP_SECRET_MANAGER_PROJECT: string;
  HTTP_RATE_LIMIT_DRIVER: string;
  LOCAL_AUTH_SECRET_ENCRYPTION_KEY: string;
  LOCAL_AUTH_SECRET_ENCRYPTION_KEY_PREVIOUS: string;
  MANAGED_SECRET_ENCRYPTION_KEY: string;
  MANAGED_SECRET_ENCRYPTION_KEY_PREVIOUS: string;
  KNOWLEDGE_EXTRACTION_BROKER_TOKEN: string;
  KNOWLEDGE_EXTRACTION_BROKER_TOKEN_PREVIOUS: string;
  KNOWLEDGE_EXTRACTION_WORKER_ENABLED: boolean;
  NOTIFICATION_DELIVERY_DRIVER: string;
  NOTIFICATION_EMAIL_DELIVERY_DRIVER: string;
  NOTIFICATION_EMAIL_FROM: string;
  NOTIFICATION_FCM_PROJECT_ID: string;
  NOTIFICATION_FCM_SERVICE_ACCOUNT_REF: string;
  NOTIFICATION_PAGERDUTY_EVENTS_URL: string;
  NOTIFICATION_RESEND_API_KEY: string;
  NOTIFICATION_SMTP_HOST: string;
  NOTIFICATION_SMTP_PASSWORD: string;
  NOTIFICATION_SMTP_USER: string;
  NOTIFICATION_WEBHOOK_ALLOWED_HOSTS: string;
  NOTIFICATION_WEBHOOK_EGRESS_POLICY: string;
  OBJECT_STORE_DRIVER: string;
  POSTGRES_TLS_EXCEPTION_ENABLED: boolean;
  POSTGRES_TLS_EXCEPTION_EXPIRES_AT: string;
  POSTGRES_TLS_EXCEPTION_OWNER: string;
  POSTGRES_TLS_EXCEPTION_REASON: string;
  POSTGRES_TLS_EXCEPTION_SCOPE: string;
  QDRANT_API_KEY_REF: string;
  QDRANT_URL: string;
  QUOTA_COORDINATION_DRIVER: string;
  REALTIME_EVENT_DRIVER: string;
  REPOSITORY_DRIVER: string;
  ROMEO_ENV: string;
  SCHEDULED_TENANT_WORK_EXTERNAL_EVIDENCE_PATH: string;
  SCHEDULED_TENANT_WORK_OWNER: string;
  S3_ACCESS_KEY_ID: string;
  S3_ENDPOINT: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_READINESS_REQUIRE_ENCRYPTION: boolean;
  S3_READINESS_REQUIRE_LIFECYCLE: boolean;
  S3_READINESS_REQUIRE_VERSIONING: boolean;
  SECRET_RESOLVER_DRIVER: string;
  SESSION_SECRET: string;
  SESSION_SECRET_PREVIOUS: string;
  TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY: string;
  TOOL_DISPATCH_PAYLOAD_STORE_DRIVER: string;
  TOOL_DISPATCH_BROKER_TOKEN: string;
  TOOL_DISPATCH_BROKER_TOKEN_PREVIOUS: string;
  TOOL_DISPATCH_WORKER_ENABLED: boolean;
  VALKEY_IN_CLUSTER_NETWORK_POLICY_ENABLED: boolean;
  VALKEY_SECURITY_EXCEPTION_ENABLED: boolean;
  VALKEY_SECURITY_EXCEPTION_EXPIRES_AT: string;
  VALKEY_SECURITY_EXCEPTION_OWNER: string;
  VALKEY_SECURITY_EXCEPTION_REASON: string;
  VALKEY_SECURITY_EXCEPTION_SCOPE: string;
  VALKEY_URL: string;
  VAULT_ADDR: string;
  VAULT_TOKEN: string;
  VECTOR_ISOLATION_MODE: string;
  VECTOR_NAMESPACE_POLICY: string;
  VOICE_OPENAI_API_KEY: string;
  VOICE_OPENAI_BASE_URL: string;
  VOICE_PROVIDER_DRIVER: string;
  WEBHOOK_SIGNING_KEY: string;
  WEBHOOK_SIGNING_KEY_PREVIOUS: string;
}

const exceptionMaximumLifetimeMs = 90 * 24 * 60 * 60 * 1000;
export const placeholderPattern =
  /(change-me|replace-with|dev-|romeo-local-secret|example|password|secret-key)/iu;

export function productionException(
  env: ProductionEnvironment,
  prefix:
    | "FILE_MALWARE_SCAN_EXCEPTION"
    | "POSTGRES_TLS_EXCEPTION"
    | "VALKEY_SECURITY_EXCEPTION",
): ReviewedException {
  if (prefix === "FILE_MALWARE_SCAN_EXCEPTION")
    return {
      enabled: env.FILE_MALWARE_SCAN_EXCEPTION_ENABLED,
      expiresAt: env.FILE_MALWARE_SCAN_EXCEPTION_EXPIRES_AT,
      owner: env.FILE_MALWARE_SCAN_EXCEPTION_OWNER,
      reason: env.FILE_MALWARE_SCAN_EXCEPTION_REASON,
    };
  if (prefix === "POSTGRES_TLS_EXCEPTION")
    return {
      enabled: env.POSTGRES_TLS_EXCEPTION_ENABLED,
      expiresAt: env.POSTGRES_TLS_EXCEPTION_EXPIRES_AT,
      owner: env.POSTGRES_TLS_EXCEPTION_OWNER,
      reason: env.POSTGRES_TLS_EXCEPTION_REASON,
    };
  return {
    enabled: env.VALKEY_SECURITY_EXCEPTION_ENABLED,
    expiresAt: env.VALKEY_SECURITY_EXCEPTION_EXPIRES_AT,
    owner: env.VALKEY_SECURITY_EXCEPTION_OWNER,
    reason: env.VALKEY_SECURITY_EXCEPTION_REASON,
  };
}

export function validateReviewedException(
  exception: ReviewedException,
  prefix: string,
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): boolean {
  if (!exception.enabled) return false;
  const ownerValid =
    exception.owner === exception.owner.trim() && exception.owner.length >= 3;
  const reasonValid =
    exception.reason === exception.reason.trim() &&
    exception.reason.length >= 16;
  const expiry = Date.parse(exception.expiresAt);
  const now = Date.now();
  const expiryValid =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(
      exception.expiresAt,
    ) &&
    Number.isFinite(expiry) &&
    expiry > now &&
    expiry <= now + exceptionMaximumLifetimeMs;
  requireValue(
    ownerValid,
    `${prefix}_OWNER must identify the accountable owner (minimum 3 characters, no surrounding whitespace).`,
    `${prefix}_OWNER`,
    env,
    context,
  );
  requireValue(
    reasonValid,
    `${prefix}_REASON must document the reviewed exception (minimum 16 characters, no surrounding whitespace).`,
    `${prefix}_REASON`,
    env,
    context,
  );
  requireValue(
    expiryValid,
    `${prefix}_EXPIRES_AT must be a future UTC timestamp no more than 90 days away.`,
    `${prefix}_EXPIRES_AT`,
    env,
    context,
  );
  return ownerValid && reasonValid && expiryValid;
}

export function rejectUnnecessaryException(
  exception: ReviewedException,
  prefix: string,
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  requireValue(
    !exception.enabled,
    `${prefix}_ENABLED must be false when the hardened control is configured.`,
    `${prefix}_ENABLED`,
    env,
    context,
  );
}

export function requireStrongSecret(
  value: string,
  field: string,
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  requireValue(
    value.length >= 32 &&
      !placeholderPattern.test(value) &&
      new Set(value).size >= 10,
    `${field} must be a non-placeholder, high-entropy secret of at least 32 characters in production.`,
    field,
    env,
    context,
  );
}

export function requireNonPlaceholderCredential(
  value: string,
  minimumLength: number,
  field: string,
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  requireValue(
    value.trim().length >= minimumLength && !placeholderPattern.test(value),
    `${field} must be a non-placeholder production credential.`,
    field,
    env,
    context,
  );
}

export function requireNonEmpty(
  value: string,
  field: string,
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  requireValue(
    value.trim().length > 0,
    `${field} is required for the enabled production capability.`,
    field,
    env,
    context,
  );
}

export function delegatedOAuthConfigured(env: ProductionEnvironment): boolean {
  return [
    env.DELEGATED_OAUTH_GITHUB_CLIENT_ID,
    env.DELEGATED_OAUTH_GITHUB_CLIENT_SECRET,
    env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY,
  ].some((value) => value.trim().length > 0);
}

export function parseUrl(value: string, protocols: string[]): URL | undefined {
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

export function decodeUrlCredential(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function isHttpsUrl(value: string): boolean {
  const url = parseUrl(value, ["https:"]);
  return url !== undefined && url.hostname.length > 0;
}

export function isInternalServiceHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/u, "");
  return (
    host.length > 0 &&
    host !== "localhost" &&
    !host.startsWith("127.") &&
    host !== "::1" &&
    (!host.includes(".") ||
      host.endsWith(".svc") ||
      host.endsWith(".svc.cluster.local") ||
      host.endsWith(".cluster.local"))
  );
}

export function allowedHostMatches(rules: string, hostname: string): boolean {
  return rules
    .split(",")
    .some((rule) =>
      rule.startsWith("*.")
        ? hostname.endsWith(rule.slice(1)) && hostname !== rule.slice(2)
        : hostname === rule,
    );
}

export function requireValue(
  condition: boolean,
  message: string,
  field: string,
  input: unknown,
  context: z.core.$RefinementCtx,
): void {
  if (condition) return;
  context.addIssue({ code: "custom", message, path: [field], input });
}
