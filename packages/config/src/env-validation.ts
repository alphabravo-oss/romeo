import { z } from "zod";

interface ToolDispatchPayloadEnvironment {
  TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY: string;
  TOOL_DISPATCH_PAYLOAD_STORE_DRIVER: string;
}

interface ProductionEnvironment {
  APP_ORIGIN: string;
  DEV_SEEDED_LOGIN: boolean;
  EDGE_TRUSTED_PROXY_MODE: string;
  FILE_MALWARE_SCAN_POLICY: string;
  HTTP_RATE_LIMIT_DRIVER: string;
  MANAGED_SECRET_ENCRYPTION_KEY: string;
  REPOSITORY_DRIVER: string;
  ROMEO_ENV: string;
  SESSION_SECRET: string;
  WEBHOOK_SIGNING_KEY: string;
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
  requireValue(
    env.REPOSITORY_DRIVER === "postgres",
    "REPOSITORY_DRIVER must be postgres in production.",
    "REPOSITORY_DRIVER",
    env,
    context,
  );
  requireValue(
    env.HTTP_RATE_LIMIT_DRIVER === "valkey",
    "HTTP_RATE_LIMIT_DRIVER must be valkey in production.",
    "HTTP_RATE_LIMIT_DRIVER",
    env,
    context,
  );
  requireValue(
    env.EDGE_TRUSTED_PROXY_MODE === "trusted_proxy",
    "EDGE_TRUSTED_PROXY_MODE must be trusted_proxy in production.",
    "EDGE_TRUSTED_PROXY_MODE",
    env,
    context,
  );
  requireValue(
    env.FILE_MALWARE_SCAN_POLICY === "required",
    "FILE_MALWARE_SCAN_POLICY must be required in production.",
    "FILE_MALWARE_SCAN_POLICY",
    env,
    context,
  );
  requireValue(
    !env.DEV_SEEDED_LOGIN,
    "DEV_SEEDED_LOGIN cannot be enabled in production.",
    "DEV_SEEDED_LOGIN",
    env,
    context,
  );
  for (const [field, value] of [
    ["SESSION_SECRET", env.SESSION_SECRET],
    ["MANAGED_SECRET_ENCRYPTION_KEY", env.MANAGED_SECRET_ENCRYPTION_KEY],
    ["WEBHOOK_SIGNING_KEY", env.WEBHOOK_SIGNING_KEY],
  ] as const) {
    requireValue(
      value.length >= 32 &&
        !/(change-me|replace-with|dev-|romeo-local-secret)/iu.test(value),
      `${field} must be a non-placeholder secret of at least 32 characters in production.`,
      field,
      env,
      context,
    );
  }
}

function requireValue(
  condition: boolean,
  message: string,
  field: string,
  input: unknown,
  context: z.core.$RefinementCtx,
): void {
  if (condition) return;
  context.addIssue({ code: "custom", message, path: [field], input });
}
