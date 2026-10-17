import { z } from "@hono/zod-openapi";

const id = z.string().min(1);
const timestamp = z.string().datetime();
export const PostgresOperationalPostureReportSchema = z
  .strictObject({
    schema: z.literal("romeo.postgres-operational-posture.v1"),
    generatedAt: timestamp,
    orgId: id,
    status: z.enum(["attention_required", "ready"]),
    repository: z.strictObject({
      driver: z.enum(["memory", "postgres"]),
      databaseUrlConfigured: z.boolean(),
      postgresRequiredForProduction: z.boolean(),
    }),
    pool: z.strictObject({
      maxConnectionsPerProcess: z.number().int().nonnegative(),
      source: z.literal("POSTGRES_POOL_MAX"),
      sizingGuide: z.literal("docs/deployment-sizing.md"),
      budgetFormula: z.string(),
    }),
    connectionSecurity: z.strictObject({
      databaseUrlValid: z.boolean(),
      hostCategory: z.enum([
        "invalid",
        "internal",
        "local",
        "missing",
        "remote",
      ]),
      hostedPostgresTlsRecommended: z.boolean(),
      sslmodeSource: z.enum(["none", "ssl", "sslmode"]),
      tlsConfigured: z.boolean(),
      tlsMode: z.enum([
        "allow",
        "disable",
        "prefer",
        "require",
        "unknown",
        "verify_ca",
        "verify_full",
      ]),
      tlsVerification: z.enum([
        "certificate_authority",
        "full",
        "none",
        "opportunistic",
        "unknown",
      ]),
      warningCodes: z.array(
        z.enum([
          "postgres_database_url_invalid",
          "postgres_hosted_tls_not_configured",
          "postgres_hosted_tls_verification_recommended",
        ]),
      ),
      redaction: z.strictObject({
        databaseUrlReturned: z.literal(false),
        hostReturned: z.literal(false),
        passwordReturned: z.literal(false),
        usernameReturned: z.literal(false),
      }),
    }),
    redaction: z.strictObject({
      databaseUrlReturned: z.literal(false),
      queryParameterValuesReturned: z.literal(false),
      rawSqlReturned: z.literal(false),
      rowDataReturned: z.literal(false),
      secretValuesReturned: z.literal(false),
    }),
    warnings: z.array(z.enum(["postgres_connection_security_warning"])),
  })
  .openapi("PostgresOperationalPostureReport");
