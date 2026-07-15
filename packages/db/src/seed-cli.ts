import { createDatabaseConnection } from "./client";
import { seedPostgresDevelopmentData } from "./development-seed";

const confirmFlag = "--confirm-development-seed";
const dryRun = process.argv.includes("--dry-run");
const confirmed = process.argv.includes(confirmFlag);
const databaseUrl = argValue("--database-url") ?? process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL or --database-url is required.");
}

if (dryRun) {
  process.stdout.write(
    `${JSON.stringify(
      {
        operation: "postgres.seed.development",
        schemaVersion: "romeo.postgres-development-seed.v1",
        database: redactedConnection(databaseUrl),
        requiredFlag: confirmFlag,
        mode: "development",
        creates: [
          "organization",
          "workspace",
          "admin_user",
          "admin_group",
          "providers",
          "models",
          "voice_profile",
          "knowledge_base",
          "agent",
          "chat",
          "retention_policy",
          "quota_bucket",
          "resource_grants",
        ],
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

if (!confirmed) {
  throw new Error(
    `Refusing to seed Postgres without ${confirmFlag}. This command is for development and smoke-test bootstrap only.`,
  );
}

const connection = createDatabaseConnection(databaseUrl);
try {
  const result = await seedPostgresDevelopmentData(connection.db);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await connection.close();
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function redactedConnection(value: string): string {
  const parsed = new URL(value);
  const user =
    parsed.username.length > 0 ? `${decodeURIComponent(parsed.username)}@` : "";
  const port = parsed.port.length > 0 ? `:${parsed.port}` : "";
  const database = parsed.pathname.replace(/^\//u, "");
  return `${parsed.protocol}//${user}${parsed.hostname}${port}/${database}`;
}
