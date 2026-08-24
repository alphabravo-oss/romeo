import { isIP } from "node:net";

import { z } from "zod";

export const trustedProxyCidrsSchema = z
  .string()
  .max(2_048)
  .default("")
  .superRefine((value, context) => {
    if (value.length === 0) return;
    const entries = value.split(",");
    if (
      entries.some((entry) => entry.length === 0 || entry !== entry.trim()) ||
      new Set(entries).size !== entries.length ||
      entries.some((entry) => !validNetworkCidr(entry))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "EDGE_TRUSTED_PROXY_CIDRS must contain unique, normalized comma-separated IPv4 or IPv6 CIDRs.",
        input: value,
      });
    }
  });

export const s3EnvShape = {
  S3_ENDPOINT: z.string().default("http://localhost:9000"),
  S3_BUCKET: z.string().default("romeo"),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().default("romeo"),
  S3_SECRET_ACCESS_KEY: z.string().default("romeo-local-secret"),
  S3_READINESS_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(500)
    .max(30_000)
    .default(5_000),
  S3_READINESS_REQUIRE_ENCRYPTION: envBoolean(true),
  S3_READINESS_REQUIRE_VERSIONING: envBoolean(true),
  S3_READINESS_REQUIRE_LIFECYCLE: envBoolean(true),
  S3_READINESS_REQUIRE_REPLICATION: envBoolean(false),
};

function envBoolean(defaultValue: boolean) {
  return z
    .enum(["true", "false"])
    .default(defaultValue ? "true" : "false")
    .transform((value) => value === "true");
}

function validNetworkCidr(value: string): boolean {
  const separator = value.lastIndexOf("/");
  if (separator <= 0 || separator === value.length - 1) return false;
  const address = value.slice(0, separator);
  const family = isIP(address);
  const prefix = Number(value.slice(separator + 1));
  return (
    Number.isInteger(prefix) &&
    ((family === 4 && prefix >= 0 && prefix <= 32) ||
      (family === 6 && prefix >= 0 && prefix <= 128))
  );
}
