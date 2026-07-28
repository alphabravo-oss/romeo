import { writeFileSync } from "node:fs";

import {
  argInteger,
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

const command = argValue("--psql") ?? "psql";
const dryRun = hasFlag("--dry-run");
const confirmed = hasFlag("--confirm-synthetic-fixtures");
const allowRemoteTarget = hasFlag("--allow-remote-target");
const databaseUrlValue = argValue("--database-url") ?? process.env.DATABASE_URL;
const databaseUrl =
  databaseUrlValue === undefined || databaseUrlValue.length === 0
    ? "postgres://romeo@localhost:5432/romeo_query_plan"
    : databaseUrlValue;
if (!dryRun && databaseUrlValue === undefined) readDatabaseUrl();
const connection = new URL(databaseUrl);
const database = postgresEnvironment(databaseUrl).PGDATABASE;
const chatCount = argInteger("--chat-count", 100_000);
const outputValue = argValue("--output");
const output =
  outputValue === undefined
    ? undefined
    : outputValue.startsWith("/")
      ? outputValue
      : repoPath(outputValue);

if (chatCount < 100_000) {
  throw new Error(
    "--chat-count must be at least 100000 for representative evidence.",
  );
}

const targetIsLocal = ["127.0.0.1", "::1", "localhost"].includes(
  connection.hostname,
);
if (!dryRun && !targetIsLocal && !allowRemoteTarget) {
  throw new Error(
    "Remote fixture targets require --allow-remote-target in addition to explicit confirmation.",
  );
}
if (!dryRun && !confirmed) {
  throw new Error(
    "Live synthetic fixture insertion requires --confirm-synthetic-fixtures.",
  );
}

if (dryRun) {
  printPlan({
    operation: "postgres.query-plan-fixtures.seed",
    database: redactedConnection(databaseUrl),
    targetIsLocal,
    confirmationRequired: true,
    representativeRows: {
      chats: chatCount,
      messages: chatCount,
      messageParts: chatCount,
    },
    generatedCustomerData: false,
    rawFixtureContentPersistedInEvidence: false,
    output,
  });
  process.exit(0);
}

const sql = fixtureSql(chatCount);
runPostgresCommandCapture({
  command,
  args: [
    "--no-align",
    "--tuples-only",
    "--set",
    "ON_ERROR_STOP=1",
    "--dbname",
    database,
    "--command",
    sql,
  ],
  databaseUrl,
});

const counts = JSON.parse(
  runPostgresCommandCapture({
    command,
    args: [
      "--no-align",
      "--tuples-only",
      "--set",
      "ON_ERROR_STOP=1",
      "--dbname",
      database,
      "--command",
      `SELECT json_build_object(
        'chats', (SELECT count(*) FROM chats),
        'messages', (SELECT count(*) FROM messages),
        'messageParts', (SELECT count(*) FROM message_parts)
      );`,
    ],
    databaseUrl,
  }).trim(),
);
const evidence = {
  schemaVersion: "romeo.postgres-query-plan-fixtures.v1",
  generatedAt: new Date().toISOString(),
  database: redactedConnection(databaseUrl),
  status:
    counts.chats >= 100_000 &&
    counts.messages >= 100_000 &&
    counts.messageParts >= 100_000
      ? "passed"
      : "failed",
  classification: {
    dataOrigin: "generated",
    customerData: false,
    productionCredentials: false,
    rawFixtureContentReturned: false,
  },
  counts,
};

if (output !== undefined) {
  ensureParentDirectory(output);
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}
if (evidence.status !== "passed") {
  throw new Error(
    "Representative PostgreSQL query-plan fixture counts are incomplete.",
  );
}
console.log("Representative PostgreSQL query-plan fixtures seeded.");
if (output !== undefined) {
  console.log(`Wrote query-plan fixture evidence to ${output}`);
}

function fixtureSql(count) {
  return `
    INSERT INTO organizations (id, name, slug)
    VALUES ('org_default', 'Synthetic query-plan organization', 'synthetic-query-plan')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO workspaces (id, org_id, name, slug)
    VALUES ('workspace_default', 'org_default', 'Synthetic query-plan workspace', 'synthetic-query-plan')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO users (id, org_id, email, name, role)
    VALUES ('user_dev_admin', 'org_default', 'query-plan@example.invalid', 'Synthetic query-plan user', 'global_admin')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO chats (
      id, org_id, workspace_id, title, created_by, created_at, updated_at
    )
    SELECT
      'query_plan_chat_' || lpad(series::text, 6, '0'),
      'org_default',
      'workspace_default',
      CASE WHEN series % 997 = 0
        THEN 'Synthetic romeo-search-marker chat ' || series
        ELSE 'Synthetic representative chat ' || series
      END,
      'user_dev_admin',
      TIMESTAMPTZ '2026-01-01T00:00:00Z' + series * INTERVAL '1 second',
      TIMESTAMPTZ '2026-01-01T00:00:00Z' + series * INTERVAL '1 second'
    FROM generate_series(1, ${count}) AS series
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      updated_at = EXCLUDED.updated_at;

    INSERT INTO messages (id, chat_id, role, content, created_at)
    SELECT
      'query_plan_message_' || lpad(series::text, 6, '0'),
      'query_plan_chat_' || lpad(series::text, 6, '0'),
      'user',
      CASE WHEN series % 991 = 0
        THEN 'Synthetic romeo-search-marker message ' || series
        ELSE 'Synthetic representative message ' || series
      END,
      TIMESTAMPTZ '2026-01-01T00:00:00Z' + series * INTERVAL '1 second'
    FROM generate_series(1, ${count}) AS series
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content;

    INSERT INTO message_parts (id, message_id, position, type, content, metadata)
    SELECT
      'query_plan_part_' || lpad(series::text, 6, '0'),
      'query_plan_message_' || lpad(series::text, 6, '0'),
      0,
      'attachment',
      'Synthetic attachment metadata',
      jsonb_build_object(
        'fileName',
        CASE WHEN series % 983 = 0
          THEN 'romeo-search-marker-' || series || '.txt'
          ELSE 'synthetic-attachment-' || series || '.txt'
        END
      )
    FROM generate_series(1, ${count}) AS series
    ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata;

    ANALYZE chats;
    ANALYZE messages;
    ANALYZE message_parts;
  `;
}
