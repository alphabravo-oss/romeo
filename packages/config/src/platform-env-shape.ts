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
  CAPABILITY_PLATFORM_DISABLED_IDS: platformDisabledCapabilityIdsSchema,
  TENANCY_MODE: z.enum(["single", "multi"]).default("single"),
  SCHEDULED_TENANT_WORK_OWNER: z
    .enum(["internal", "external"])
    .default("internal"),
  SCHEDULED_TENANT_WORK_EXTERNAL_EVIDENCE_PATH: z.string().default(""),
  SCHEDULED_TENANT_WORK_EXTERNAL_EVIDENCE_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86_400)
    .default(900),
  TOOL_DISPATCH_WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  TOOL_DISPATCH_BROKER_TOKEN: z.string().default(""),
  TOOL_DISPATCH_BROKER_TOKEN_PREVIOUS: z.string().default(""),
  TOOL_DISPATCH_NETWORK_POLICY_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  BROWSER_AUTOMATION_WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  BROWSER_AUTOMATION_BROKER_TOKEN: z.string().default(""),
  BROWSER_AUTOMATION_BROKER_TOKEN_PREVIOUS: z.string().default(""),
  KNOWLEDGE_EXTRACTION_BROKER_TOKEN: z.string().default(""),
  KNOWLEDGE_EXTRACTION_BROKER_TOKEN_PREVIOUS: z.string().default(""),
  KNOWLEDGE_EXTRACTION_WORKER_ENABLED: z
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
