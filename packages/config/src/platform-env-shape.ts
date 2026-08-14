import { z } from "zod";
import { platformDisabledCapabilityIdsSchema } from "./capability-platform-policy";

export const platformEnvShape = {
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  REPOSITORY_DRIVER: z.enum(["memory", "postgres"]).default("memory"),
  MODEL_CATALOG_SYNC_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  MODEL_CATALOG_SYNC_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .default(60_000),
  MODEL_CATALOG_SYNC_TTL_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .default(300_000),
  MODEL_CATALOG_SYNC_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(10_000),
  DATABASE_URL: z
    .string()
    .default("postgres://romeo:romeo@localhost:5432/romeo"),
  OPENWEBUI_COMPATIBILITY_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  CAPABILITY_PLATFORM_DISABLED_IDS: platformDisabledCapabilityIdsSchema,
  TENANCY_MODE: z.enum(["single", "multi"]).default("single"),
  GA_CHECKLIST_PATH: z.string().default(""),
  GA_TARGET_PREFLIGHT_PATH: z.string().default(""),
  GA_TARGET_PLAN_PATH: z.string().default(""),
  GA_TARGET_EXECUTION_PATH: z.string().default(""),
  GA_EVIDENCE_BUNDLE_PATH: z.string().default(""),
  RELEASE_PUBLISH_PLAN_PATH: z.string().default(""),
  RELEASE_AIRGAP_VERIFICATION_PATH: z.string().default(""),
  RELEASE_READBACK_PLAN_PATH: z.string().default(""),
  RELEASE_READBACK_VALIDATION_PATH: z.string().default(""),
  SUPPORT_BUNDLE_PATH: z.string().default(""),
  CI_BRANCH_PROTECTION_PLAN_PATH: z.string().default(""),
  CI_HOSTED_RUN_VERIFICATION_PATH: z.string().default(""),
  CI_BRANCH_PROTECTION_VERIFICATION_PATH: z.string().default(""),
  EDGE_ENFORCEMENT_EVIDENCE_PATH: z.string().default(""),
  POSTGRES_QUERY_PLAN_EVIDENCE_PATH: z.string().default(""),
  POSTGRES_SLOW_QUERY_TELEMETRY_EVIDENCE_PATH: z.string().default(""),
  POSTGRES_LOCK_TELEMETRY_EVIDENCE_PATH: z.string().default(""),
  POSTGRES_ARCHIVAL_PARTITIONING_DECISION_PATH: z.string().default(""),
  PGVECTOR_PHYSICAL_ISOLATION_EVIDENCE_PATH: z.string().default(""),
  QDRANT_LIVE_EVIDENCE_PATH: z.string().default(""),
  DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_EVIDENCE_PATH: z.string().default(""),
  DATA_RIGHTS_BACKUP_RETENTION_EVIDENCE_PATH: z.string().default(""),
  DATA_CONNECTOR_LIVE_EVIDENCE_PATH: z.string().default(""),
  DATA_CONNECTOR_WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DATA_CONNECTOR_NETWORK_POLICY_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  TOOL_DISPATCH_WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  TOOL_DISPATCH_NETWORK_POLICY_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  BROWSER_AUTOMATION_LIVE_EVIDENCE_PATH: z.string().default(""),
  BROWSER_AUTOMATION_WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  BROWSER_AUTOMATION_RUNNER_URL: z
    .union([z.string().url(), z.literal("")])
    .default(""),
  BROWSER_AUTOMATION_NETWORK_POLICY_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  BROWSER_AUTOMATION_MAX_JOBS: z.coerce.number().int().positive().default(5),
  BROWSER_AUTOMATION_LEASE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),
  BROWSER_AUTOMATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30_000),
  BROWSER_AUTOMATION_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(20_000),
} as const;
