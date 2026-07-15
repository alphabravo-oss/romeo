import { writeFileSync } from "node:fs";

import {
  argValue,
  ensureParentDirectory,
  hasFlag,
  postgresEnvironment,
  printPlan,
  readDatabaseUrl,
  redactedConnection,
  repoPath,
  runPostgresCommandCapture,
} from "./lib/postgres-maintenance.mjs";
import {
  REQUIRED_EXTENSIONS,
  REQUIRED_INDEXES,
  REQUIRED_TABLES,
} from "./lib/postgres-schema-contract.mjs";

const command = argValue("--psql") ?? "psql";
const dryRun = hasFlag("--dry-run");
const configuredDatabaseUrlValue =
  argValue("--database-url") ?? process.env.DATABASE_URL;
const configuredDatabaseUrl =
  configuredDatabaseUrlValue === undefined ||
  configuredDatabaseUrlValue.length === 0
    ? undefined
    : configuredDatabaseUrlValue;
const databaseUrl =
  configuredDatabaseUrl ?? "postgres://romeo@localhost:5432/romeo";
if (!dryRun && configuredDatabaseUrl === undefined) readDatabaseUrl();
const database = postgresEnvironment(databaseUrl).PGDATABASE;
const outputValue = argValue("--output");
const output =
  outputValue === undefined ? undefined : resolveRepoPath(outputValue);
const sql = validationSql();
const args = [
  "--no-align",
  "--tuples-only",
  "--set",
  "ON_ERROR_STOP=1",
  "--dbname",
  database,
  "--command",
  sql,
];

if (dryRun) {
  printPlan({
    operation: "postgres.schema.validate",
    command,
    args: [
      "--no-align",
      "--tuples-only",
      "--set",
      "ON_ERROR_STOP=1",
      "--dbname",
      database,
      "--command",
      "<validation-sql>",
    ],
    env: {
      PGCONNECTION:
        configuredDatabaseUrl === undefined
          ? "<DATABASE_URL required for live validation>"
          : redactedConnection(databaseUrl),
    },
    required: {
      extensions: REQUIRED_EXTENSIONS,
      tableCount: REQUIRED_TABLES.length,
      indexes: REQUIRED_INDEXES,
    },
    output,
  });
  process.exit(0);
}

const missing = runPostgresCommandCapture({ command, args, databaseUrl })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const evidence = {
  schemaVersion: "romeo.postgres-schema-validation.v1",
  generatedAt: new Date().toISOString(),
  database: redactedConnection(databaseUrl),
  status: missing.length === 0 ? "passed" : "failed",
  missing,
  required: {
    extensions: REQUIRED_EXTENSIONS,
    tables: REQUIRED_TABLES,
    indexes: REQUIRED_INDEXES,
  },
};

if (output !== undefined) {
  ensureParentDirectory(output);
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

if (missing.length > 0) {
  console.error(`PostgreSQL schema validation failed: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("PostgreSQL schema validation passed.");
if (output !== undefined)
  console.log(`Wrote PostgreSQL schema validation evidence to ${output}`);

function resolveRepoPath(path) {
  return path.startsWith("/") ? path : repoPath(path);
}

function validationSql() {
  return `
WITH
required_extensions(name) AS (
  VALUES ${values(REQUIRED_EXTENSIONS)}
),
required_tables(name) AS (
  VALUES ${values(REQUIRED_TABLES)}
),
required_indexes(name) AS (
  VALUES ${values(REQUIRED_INDEXES)}
)
SELECT 'missing_extension:' || name
FROM required_extensions
WHERE NOT EXISTS (
  SELECT 1 FROM pg_extension WHERE extname = required_extensions.name
)
UNION ALL
SELECT 'missing_table:' || name
FROM required_tables
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = required_tables.name
)
UNION ALL
SELECT 'missing_index:' || name
FROM required_indexes
WHERE NOT EXISTS (
  SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = required_indexes.name
)
ORDER BY 1;
`.trim();
}

function values(items) {
  return items.map((item) => `('${item}')`).join(", ");
}
