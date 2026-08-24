import { z } from "zod";

const productionExceptionTextSchema = z.string().max(500).default("");
const productionExceptionEnabledSchema = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const oidcEndpointAllowedOriginsSchema = z
  .string()
  .default("")
  .superRefine((value, context) => {
    for (const candidate of value
      .split(",")
      .filter((item) => item.length > 0)) {
      try {
        const url = new URL(candidate);
        if (
          candidate !== candidate.trim() ||
          url.protocol !== "https:" ||
          url.username.length > 0 ||
          url.password.length > 0 ||
          url.pathname !== "/" ||
          url.search.length > 0 ||
          url.hash.length > 0 ||
          url.toString() !== url.origin + "/"
        ) {
          throw new Error("invalid origin");
        }
      } catch {
        context.addIssue({
          code: "custom",
          message:
            "OIDC_ENDPOINT_ALLOWED_ORIGINS must be a comma-separated list of exact HTTPS origins without credentials, paths, queries, fragments, or whitespace.",
        });
      }
    }
  });

const notificationAllowedHostsSchema = z
  .string()
  .default("")
  .superRefine((value, context) => {
    if (value.length === 0) return;
    const hosts = value.split(",");
    const normalized = hosts.map((host) => host.toLowerCase());
    if (
      hosts.some(
        (host) =>
          host.length === 0 ||
          host !== host.trim() ||
          host !== host.toLowerCase() ||
          !/^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
            host,
          ),
      ) ||
      new Set(normalized).size !== normalized.length
    ) {
      context.addIssue({
        code: "custom",
        message:
          "NOTIFICATION_WEBHOOK_ALLOWED_HOSTS must contain unique, lowercase comma-separated DNS hosts or wildcard subdomain rules without whitespace.",
      });
    }
  });

export const productionSecurityEnvShape = {
  POSTGRES_TLS_EXCEPTION_ENABLED: productionExceptionEnabledSchema,
  POSTGRES_TLS_EXCEPTION_SCOPE: z.enum(["", "in_cluster"]).default(""),
  POSTGRES_TLS_EXCEPTION_OWNER: productionExceptionTextSchema,
  POSTGRES_TLS_EXCEPTION_REASON: productionExceptionTextSchema,
  POSTGRES_TLS_EXCEPTION_EXPIRES_AT: productionExceptionTextSchema,
  FILE_MALWARE_SCAN_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  FILE_MALWARE_SCAN_POLICY: z.enum(["off", "required"]).default("off"),
  FILE_MALWARE_SCAN_EXCEPTION_ENABLED: productionExceptionEnabledSchema,
  FILE_MALWARE_SCAN_EXCEPTION_OWNER: productionExceptionTextSchema,
  FILE_MALWARE_SCAN_EXCEPTION_REASON: productionExceptionTextSchema,
  FILE_MALWARE_SCAN_EXCEPTION_EXPIRES_AT: productionExceptionTextSchema,
  CLAMAV_ADDRESS: z.string().default(""),
  VALKEY_URL: z.string().default("redis://localhost:6379"),
  VALKEY_SECURITY_EXCEPTION_ENABLED: productionExceptionEnabledSchema,
  VALKEY_SECURITY_EXCEPTION_SCOPE: z.enum(["", "in_cluster"]).default(""),
  VALKEY_SECURITY_EXCEPTION_OWNER: productionExceptionTextSchema,
  VALKEY_SECURITY_EXCEPTION_REASON: productionExceptionTextSchema,
  VALKEY_SECURITY_EXCEPTION_EXPIRES_AT: productionExceptionTextSchema,
  VALKEY_IN_CLUSTER_NETWORK_POLICY_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  NOTIFICATION_WEBHOOK_EGRESS_POLICY: z
    .enum(["allow_public", "require_allowlist"])
    .default("allow_public"),
  NOTIFICATION_WEBHOOK_ALLOWED_HOSTS: notificationAllowedHostsSchema,
  OIDC_ENDPOINT_ALLOWED_ORIGINS: oidcEndpointAllowedOriginsSchema,
  OIDC_FETCH_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(1_048_576)
    .default(262_144),
  OIDC_FETCH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30_000)
    .default(10_000),
  OIDC_CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(300_000),
} as const;
