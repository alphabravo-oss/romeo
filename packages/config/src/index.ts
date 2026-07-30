import { z } from "zod";
import { platformEnvShape } from "./platform-env-shape";
import { validateToolDispatchPayloadStore } from "./env-validation";

export const envSchema = z
  .object({
    ...platformEnvShape,
    POSTGRES_POOL_MAX: z.coerce.number().int().min(1).max(1_000).default(10),
    REQUEST_BODY_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(250_000_000)
      .default(50_000_000),
    FILE_INLINE_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(250_000_000)
      .default(25_000_000),
    FILE_DIRECT_UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(1_000_000_000)
      .default(100_000_000),
    FILE_RESUMABLE_UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(5_000_000_000)
      .default(500_000_000),
    FILE_MALWARE_SCAN_POLICY: z.enum(["off", "required"]).default("off"),
    MESSAGE_ATTACHMENT_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(100_000_000)
      .default(5_000_000),
    TEMPORARY_CHAT_CLEANUP_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    TEMPORARY_CHAT_CLEANUP_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .default(60_000),
    TEMPORARY_CHAT_CLEANUP_BATCH_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000)
      .default(100),
    TEMPORARY_CHAT_CLEANUP_LEASE_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .default(300),
    HTTP_RATE_LIMIT_DRIVER: z
      .enum(["disabled", "memory", "valkey"])
      .default("memory"),
    HTTP_RATE_LIMIT_KEY_PREFIX: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9:._-]+$/)
      .default("romeo:http-rate-limit:v1"),
    HTTP_RATE_LIMIT_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(86_400)
      .default(60),
    HTTP_RATE_LIMIT_AUTH_MAX: z.coerce
      .number()
      .int()
      .min(1)
      .max(100_000)
      .default(60),
    HTTP_RATE_LIMIT_PUBLIC_MAX: z.coerce
      .number()
      .int()
      .min(1)
      .max(100_000)
      .default(600),
    HTTP_RATE_LIMIT_AUTHENTICATED_MAX: z.coerce
      .number()
      .int()
      .min(1)
      .max(250_000)
      .default(6_000),
    HTTP_RATE_LIMIT_WEBHOOK_MAX: z.coerce
      .number()
      .int()
      .min(1)
      .max(250_000)
      .default(1_200),
    MODEL_PROVIDER_STREAM_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60_000),
    RUN_EXECUTION_LEASE_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3_600)
      .default(60),
    RUN_RECOVERY_STALE_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(120_000),
    MODEL_PROVIDER_RETRY_ATTEMPTS: z.coerce.number().int().min(0).default(1),
    MODEL_PROVIDER_RETRY_BACKOFF_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(250),
    MODEL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD: z.coerce
      .number()
      .int()
      .min(0)
      .default(5),
    MODEL_PROVIDER_CIRCUIT_COOLDOWN_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(60_000),
    MODEL_PROVIDER_DISABLED_IDS: z.string().default(""),
    MODEL_PROVIDER_FALLBACK_MODEL_ID: z.string().default(""),
    VALKEY_URL: z.string().default("redis://localhost:6379"),
    REALTIME_EVENT_DRIVER: z.enum(["memory", "valkey"]).default("memory"),
    REALTIME_EVENT_KEY_PREFIX: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9:._-]+$/)
      .default("romeo:chat-events:v1"),
    REALTIME_EVENT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(2_000),
    QUOTA_COORDINATION_DRIVER: z
      .enum(["disabled", "valkey"])
      .default("disabled"),
    QUOTA_COORDINATION_KEY_PREFIX: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9:._-]+$/)
      .default("romeo:quota:v1"),
    QUOTA_COORDINATION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(2_000),
    EDGE_TLS_TERMINATION: z
      .enum(["app", "ingress", "external_lb"])
      .default("app"),
    EDGE_TRUSTED_PROXY_MODE: z
      .enum(["direct", "trusted_proxy"])
      .default("direct"),
    EDGE_WAF_MODE: z.enum(["disabled", "monitor", "block"]).default("disabled"),
    EDGE_ALLOWED_ORIGINS: z.string().default(""),
    EDGE_HSTS_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    EDGE_HSTS_MAX_AGE_SECONDS: z.coerce.number().int().min(0).default(0),
    EDGE_HSTS_INCLUDE_SUBDOMAINS: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    EDGE_HSTS_PRELOAD: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    OBJECT_STORE_DRIVER: z.enum(["memory", "s3"]).default("memory"),
    DATA_CONNECTOR_EXECUTION_DRIVER: z
      .enum([
        "disabled",
        "website-fetch",
        "github-fetch",
        "s3-fetch",
        "atlassian-fetch",
        "notion-fetch",
        "linear-fetch",
        "slack-fetch",
        "managed-fetch",
      ])
      .default("disabled"),
    TOOL_OPERATION_EXECUTION_DRIVER: z
      .enum(["disabled", "http-fetch"])
      .default("disabled"),
    TOOL_DISPATCH_PAYLOAD_STORE_DRIVER: z
      .enum(["disabled", "object-store"])
      .default("disabled"),
    TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY: z.string().default(""),
    TOOL_DISPATCH_PAYLOAD_STORE_PREFIX: z
      .string()
      .min(1)
      .default("tool-dispatch-payloads/v1"),
    TOOL_OPERATION_FETCH_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10_000),
    TOOL_OPERATION_FETCH_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(1_000_000),
    DATA_CONNECTOR_EGRESS_POLICY: z
      .enum(["allow_public", "require_allowlist"])
      .default("allow_public"),
    DATA_CONNECTOR_FETCH_ALLOWED_HOSTS: z.string().default(""),
    DATA_CONNECTOR_FETCH_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(2_000_000),
    DATA_CONNECTOR_FETCH_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10_000),
    WEB_SEARCH_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(300_000)
      .default(12_000),
    DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(0)
      .max(5)
      .default(1),
    DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(60_000)
      .default(250),
    DATA_CONNECTOR_GITHUB_TOKEN: z.string().default(""),
    DELEGATED_OAUTH_GITHUB_CLIENT_ID: z.string().default(""),
    DELEGATED_OAUTH_GITHUB_CLIENT_SECRET: z.string().default(""),
    DELEGATED_OAUTH_GITHUB_SCOPES: z
      .string()
      .default("repo,read:user,user:email"),
    DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY: z.string().default(""),
    KNOWLEDGE_EXTRACTION_DRIVER: z
      .enum(["disabled", "local-pdftotext", "local-documents"])
      .default("disabled"),
    EXTERNAL_VECTOR_STORE_DRIVER: z
      .enum(["disabled", "qdrant"])
      .default("disabled"),
    QDRANT_URL: z.union([z.string().url(), z.literal("")]).default(""),
    QDRANT_COLLECTION: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._-]+$/)
      .default("romeo_knowledge_chunks"),
    QDRANT_API_KEY_REF: z.string().default(""),
    QDRANT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    VECTOR_NAMESPACE_POLICY: z
      .enum(["none", "org", "workspace", "knowledge_base"])
      .default("none"),
    VECTOR_PARTITIONING_POLICY: z
      .enum(["none", "org", "workspace", "knowledge_base"])
      .default("none"),
    VECTOR_ISOLATION_MODE: z
      .enum([
        "shared_row_scope",
        "pgvector_partitioned_by_org",
        "external_namespace_per_org",
        "external_collection_per_org",
        "dedicated_vector_store_per_org",
      ])
      .default("shared_row_scope"),
    KNOWLEDGE_EXTRACTION_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(20_000_000),
    KNOWLEDGE_EXTRACTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15_000),
    PDFTOTEXT_PATH: z.string().min(1).default("pdftotext"),
    FILE_OCR_DRIVER: z
      .enum(["disabled", "local-tesseract"])
      .default("disabled"),
    FILE_OCR_TESSERACT_PATH: z.string().min(1).default("tesseract"),
    FILE_OCR_PDFTOPPM_PATH: z.string().min(1).default("pdftoppm"),
    FILE_OCR_LANGUAGE: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9_+.-]+$/u)
      .default("eng"),
    FILE_OCR_MAX_PAGES: z.coerce.number().int().positive().max(100).default(20),
    SECRET_RESOLVER_DRIVER: z
      .enum([
        "disabled",
        "env",
        "vault",
        "aws-sm",
        "gcp-sm",
        "azure-kv",
        "cloud",
      ])
      .default("disabled"),
    VAULT_ADDR: z.string().default(""),
    VAULT_TOKEN: z.string().default(""),
    VAULT_NAMESPACE: z.string().default(""),
    VAULT_KV_MOUNT: z.string().min(1).default("secret"),
    VAULT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
    AWS_REGION: z.string().default(""),
    AWS_ACCESS_KEY_ID: z.string().default(""),
    AWS_SECRET_ACCESS_KEY: z.string().default(""),
    AWS_SESSION_TOKEN: z.string().default(""),
    AWS_SECRET_MANAGER_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(5_000),
    GCP_SECRET_MANAGER_PROJECT: z.string().default(""),
    GCP_ACCESS_TOKEN: z.string().default(""),
    GCP_SECRET_MANAGER_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(5_000),
    AZURE_KEY_VAULT_URL: z.string().default(""),
    AZURE_ACCESS_TOKEN: z.string().default(""),
    AZURE_KEY_VAULT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(5_000),
    NOTIFICATION_DELIVERY_DRIVER: z
      .enum([
        "disabled",
        "configured",
        "fcm-mobile-push",
        "pagerduty-events",
        "resend-email",
        "slack-webhook",
        "smtp-email",
        "teams-webhook",
        "webhook",
      ])
      .default("disabled"),
    NOTIFICATION_EMAIL_DELIVERY_DRIVER: z
      .enum(["resend", "smtp"])
      .default("resend"),
    NOTIFICATION_EMAIL_FROM: z.string().default(""),
    NOTIFICATION_FCM_PROJECT_ID: z.string().default(""),
    NOTIFICATION_FCM_SERVICE_ACCOUNT_REF: z.string().default(""),
    NOTIFICATION_FCM_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10_000),
    NOTIFICATION_PAGERDUTY_EVENTS_URL: z
      .string()
      .url()
      .default("https://events.pagerduty.com/v2/enqueue"),
    NOTIFICATION_PAGERDUTY_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10_000),
    NOTIFICATION_RESEND_API_KEY: z.string().default(""),
    NOTIFICATION_RESEND_BASE_URL: z
      .string()
      .url()
      .default("https://api.resend.com"),
    NOTIFICATION_RESEND_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10_000),
    NOTIFICATION_SLACK_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10_000),
    NOTIFICATION_SMTP_HOST: z.string().default(""),
    NOTIFICATION_SMTP_PASSWORD: z.string().default(""),
    NOTIFICATION_SMTP_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65_535)
      .default(587),
    NOTIFICATION_SMTP_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    NOTIFICATION_SMTP_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10_000),
    NOTIFICATION_SMTP_USER: z.string().default(""),
    NOTIFICATION_TEAMS_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10_000),
    VOICE_PROVIDER_DRIVER: z
      .enum(["disabled", "dev", "openai-compatible"])
      .default("disabled"),
    VOICE_OPENAI_BASE_URL: z
      .string()
      .url()
      .default("https://api.openai.com/v1"),
    VOICE_OPENAI_API_KEY: z.string().default(""),
    VOICE_OPENAI_MODEL: z.string().min(1).default("tts-1"),
    VOICE_OPENAI_TRANSCRIPTION_MODEL: z.string().min(1).default("whisper-1"),
    VOICE_OPENAI_VOICES: z
      .string()
      .default("alloy,echo,fable,onyx,nova,shimmer"),
    VOICE_OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    S3_ENDPOINT: z.string().default("http://localhost:9000"),
    S3_BUCKET: z.string().default("romeo"),
    S3_REGION: z.string().default("us-east-1"),
    S3_ACCESS_KEY_ID: z.string().default("romeo"),
    S3_SECRET_ACCESS_KEY: z.string().default("romeo-local-secret"),
    SESSION_SECRET: z.string().min(16).default("dev-session-secret-change-me"),
    SESSION_SECRET_PREVIOUS: z
      .union([z.string().min(16), z.literal("")])
      .default(""),
    LOCAL_AUTH_SECRET_ENCRYPTION_KEY: z
      .string()
      .default("dev-local-auth-secret-key-change-me"),
    LOCAL_AUTH_SECRET_ENCRYPTION_KEY_PREVIOUS: z.string().default(""),
    MANAGED_SECRET_ENCRYPTION_KEY: z
      .string()
      .default("dev-managed-secret-key-change-me"),
    MANAGED_SECRET_ENCRYPTION_KEY_PREVIOUS: z.string().default(""),
    WEBHOOK_SIGNING_KEY: z
      .string()
      .min(16)
      .default("dev-webhook-signing-key-change-me"),
    BILLING_STRIPE_WEBHOOK_SECRET: z.string().default(""),
    BILLING_STRIPE_WEBHOOK_TOLERANCE_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(300),
    BILLING_GENERIC_WEBHOOK_SECRET: z.string().default(""),
    BILLING_GENERIC_WEBHOOK_TOLERANCE_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(300),
    BILLING_WEBHOOK_ORG_ID: z.string().min(1).default("org_default"),
    OIDC_ISSUER_URL: z.union([z.string().url(), z.literal("")]).default(""),
    OIDC_CLIENT_ID: z.string().default(""),
    OIDC_GROUP_CLAIM: z.string().min(1).default("groups"),
    OIDC_ADMIN_GROUPS: z.string().default(""),
    OIDC_GROUP_MAP: z.string().default(""),
    OIDC_WORKSPACE_GROUP_MAP: z.string().default(""),
    OIDC_WORKSPACE_GROUP_PREFIX: z.string().default(""),
    SCIM_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    DEV_SEEDED_LOGIN: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
  })
  .superRefine(validateToolDispatchPayloadStore);

export type RomeoEnv = z.infer<typeof envSchema>;

export function readEnv(input: NodeJS.ProcessEnv = process.env): RomeoEnv {
  return envSchema.parse(input);
}

export const featureFlags = {
  milestone1Api: true,
  devSeededLogin: true,
  toolApprovals: false,
  rag: false,
  voice: false,
  webhooks: false,
} as const;
