import { z } from "zod";

import { isLoopbackOrigin } from "./loopback";
import { validateProductionCapabilities } from "./production-capability-validation";
import { validateProductionInfrastructure } from "./production-infrastructure-validation";
import {
  requireValue,
  requireStrongSecret,
  type ProductionEnvironment,
} from "./production-validation-support";

interface ToolDispatchPayloadEnvironment {
  TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY: string;
  TOOL_DISPATCH_PAYLOAD_STORE_DRIVER: string;
}

export function validateToolDispatchPayloadStore(
  env: ToolDispatchPayloadEnvironment,
  context: z.core.$RefinementCtx,
): void {
  if (
    env.TOOL_DISPATCH_PAYLOAD_STORE_DRIVER === "object-store" &&
    env.TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY.trim().length < 32
  ) {
    context.addIssue({
      code: "custom",
      message:
        "TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY must be at least 32 characters when object-store payload storage is enabled.",
      path: ["TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY"],
      input: env,
    });
  }
}

/**
 * The seeded login turns every unauthenticated request into a global admin, so
 * it is only allowed when the application is served on a loopback origin.
 */
export function validateDevSeededLogin(
  env: { APP_ORIGIN: string; DEV_SEEDED_LOGIN: boolean },
  context: z.core.$RefinementCtx,
): void {
  if (!env.DEV_SEEDED_LOGIN) return;
  requireValue(
    isLoopbackOrigin(env.APP_ORIGIN),
    "DEV_SEEDED_LOGIN requires a loopback APP_ORIGIN (localhost, 127.0.0.1, or [::1]).",
    "DEV_SEEDED_LOGIN",
    env,
    context,
  );
}

export function validateProductionEnvironment(
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  if (env.ROMEO_ENV !== "production") return;

  requireValue(
    env.APP_ORIGIN.startsWith("https://"),
    "APP_ORIGIN must use HTTPS in production.",
    "APP_ORIGIN",
    env,
    context,
  );
  for (const [field, actual, expected] of [
    ["REPOSITORY_DRIVER", env.REPOSITORY_DRIVER, "postgres"],
    ["OBJECT_STORE_DRIVER", env.OBJECT_STORE_DRIVER, "s3"],
    ["HTTP_RATE_LIMIT_DRIVER", env.HTTP_RATE_LIMIT_DRIVER, "valkey"],
    ["REALTIME_EVENT_DRIVER", env.REALTIME_EVENT_DRIVER, "valkey"],
    ["QUOTA_COORDINATION_DRIVER", env.QUOTA_COORDINATION_DRIVER, "valkey"],
    ["EDGE_TRUSTED_PROXY_MODE", env.EDGE_TRUSTED_PROXY_MODE, "trusted_proxy"],
  ] as const) {
    requireValue(
      actual === expected,
      `${field} must be ${expected} in production.`,
      field,
      env,
      context,
    );
  }
  requireValue(
    !env.DEV_SEEDED_LOGIN,
    "DEV_SEEDED_LOGIN cannot be enabled in production.",
    "DEV_SEEDED_LOGIN",
    env,
    context,
  );
  requireValue(
    env.EDGE_TRUSTED_PROXY_CIDRS.trim().length > 0,
    "EDGE_TRUSTED_PROXY_CIDRS must identify the exact reverse-proxy source networks in production.",
    "EDGE_TRUSTED_PROXY_CIDRS",
    env,
    context,
  );
  requireValue(
    env.SCHEDULED_TENANT_WORK_OWNER !== "external" ||
      env.SCHEDULED_TENANT_WORK_EXTERNAL_EVIDENCE_PATH.trim().length > 0,
    "SCHEDULED_TENANT_WORK_EXTERNAL_EVIDENCE_PATH is required when external scheduled-work ownership is selected in production.",
    "SCHEDULED_TENANT_WORK_EXTERNAL_EVIDENCE_PATH",
    env,
    context,
  );
  validateBrokerCredential(
    env,
    "TOOL_DISPATCH_BROKER_TOKEN",
    "TOOL_DISPATCH_BROKER_TOKEN_PREVIOUS",
    env.TOOL_DISPATCH_WORKER_ENABLED,
    context,
  );
  validateBrokerCredential(
    env,
    "KNOWLEDGE_EXTRACTION_BROKER_TOKEN",
    "KNOWLEDGE_EXTRACTION_BROKER_TOKEN_PREVIOUS",
    env.KNOWLEDGE_EXTRACTION_WORKER_ENABLED,
    context,
  );
  validateIndependentBrokerCredentials(env, context);
  validateBrokerCredential(
    env,
    "BROWSER_AUTOMATION_BROKER_TOKEN",
    "BROWSER_AUTOMATION_BROKER_TOKEN_PREVIOUS",
    env.BROWSER_AUTOMATION_WORKER_ENABLED,
    context,
  );

  validateProductionInfrastructure(env, context);
  validateProductionCapabilities(env, context);
}

function validateBrokerCredential(
  env: ProductionEnvironment,
  currentField:
    | "BROWSER_AUTOMATION_BROKER_TOKEN"
    | "KNOWLEDGE_EXTRACTION_BROKER_TOKEN"
    | "TOOL_DISPATCH_BROKER_TOKEN",
  previousField:
    | "BROWSER_AUTOMATION_BROKER_TOKEN_PREVIOUS"
    | "KNOWLEDGE_EXTRACTION_BROKER_TOKEN_PREVIOUS"
    | "TOOL_DISPATCH_BROKER_TOKEN_PREVIOUS",
  required: boolean,
  context: z.core.$RefinementCtx,
): void {
  const current = env[currentField];
  const previous = env[previousField];
  if (required || current.length > 0)
    requireStrongSecret(current, currentField, env, context);
  if (previous.length > 0) {
    requireStrongSecret(previous, previousField, env, context);
    requireValue(
      previous !== current,
      `${previousField} must be independent from ${currentField}.`,
      previousField,
      env,
      context,
    );
  }
}

function validateIndependentBrokerCredentials(
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  const credentials = [
    ["TOOL_DISPATCH_BROKER_TOKEN", env.TOOL_DISPATCH_BROKER_TOKEN],
    [
      "TOOL_DISPATCH_BROKER_TOKEN_PREVIOUS",
      env.TOOL_DISPATCH_BROKER_TOKEN_PREVIOUS,
    ],
    ["BROWSER_AUTOMATION_BROKER_TOKEN", env.BROWSER_AUTOMATION_BROKER_TOKEN],
    [
      "BROWSER_AUTOMATION_BROKER_TOKEN_PREVIOUS",
      env.BROWSER_AUTOMATION_BROKER_TOKEN_PREVIOUS,
    ],
    [
      "KNOWLEDGE_EXTRACTION_BROKER_TOKEN",
      env.KNOWLEDGE_EXTRACTION_BROKER_TOKEN,
    ],
    [
      "KNOWLEDGE_EXTRACTION_BROKER_TOKEN_PREVIOUS",
      env.KNOWLEDGE_EXTRACTION_BROKER_TOKEN_PREVIOUS,
    ],
  ] as const;
  for (let index = 0; index < credentials.length; index += 1) {
    const [field, value] = credentials[index]!;
    if (value.length === 0) continue;
    const duplicate = credentials
      .slice(0, index)
      .find(([, candidate]) => candidate.length > 0 && candidate === value);
    requireValue(
      duplicate === undefined,
      `${field} must be independent from every other worker broker credential.`,
      field,
      env,
      context,
    );
  }
}
